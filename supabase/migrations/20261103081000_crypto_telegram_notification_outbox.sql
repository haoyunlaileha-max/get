-- Transactional Telegram notification outbox for crypto deposit lifecycle events.
begin;
create table if not exists public.ah_crypto_telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.ah_crypto_deposits(id) on delete restrict,
  dedupe_key text not null unique,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','sending','delivered','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists ah_crypto_telegram_outbox_dispatch_idx
  on public.ah_crypto_telegram_outbox(status,next_attempt_at,created_at)
  where status in ('pending','sending');
alter table public.ah_crypto_telegram_outbox enable row level security;
revoke all on public.ah_crypto_telegram_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.ah_crypto_telegram_outbox to service_role;

create or replace function public.ah_enqueue_crypto_telegram_event()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_event text; v_key text;
begin
  if tg_op='INSERT' then
    if new.status not in ('detected','confirming','confirmed','underpaid','overpaid','manual_review','expired') then return new; end if;
  elsif new.status is not distinct from old.status
     and new.received_amount_atomic is not distinct from old.received_amount_atomic
     and new.transaction_hash is not distinct from old.transaction_hash then
    return new;
  end if;
  v_event:=new.status;
  v_key:=new.id::text||':'||v_event||':'||coalesce(new.transaction_hash,'')||':'||coalesce(new.received_amount_atomic::text,'0');
  insert into public.ah_crypto_telegram_outbox(deposit_id,dedupe_key,event_type,payload)
  values(new.id,v_key,v_event,jsonb_build_object(
    'deposit_id',new.id,'order_id',new.order_id,'asset_code',new.asset_code,
    'expected_amount_atomic',new.expected_amount_atomic::text,
    'received_amount_atomic',new.received_amount_atomic::text,'status',new.status,
    'transaction_hash',new.transaction_hash,'confirmed_at',new.confirmed_at,
    'expires_at',new.expires_at,'occurred_at',now()
  )) on conflict(dedupe_key) do nothing;
  return new;
end; $$;

drop trigger if exists ah_crypto_deposit_telegram_event on public.ah_crypto_deposits;
create trigger ah_crypto_deposit_telegram_event
after insert or update of status,received_amount_atomic,transaction_hash
on public.ah_crypto_deposits for each row execute function public.ah_enqueue_crypto_telegram_event();

create or replace function public.ah_claim_crypto_telegram_notifications(p_limit integer default 20)
returns table(id uuid,payload jsonb,attempts integer)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  return query
  with picked as (
    select q.id from public.ah_crypto_telegram_outbox q
    where q.status in ('pending','sending') and q.next_attempt_at<=now() and q.attempts<10
    order by q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.ah_crypto_telegram_outbox q
  set status='sending',attempts=q.attempts+1,last_error=null
  from picked where q.id=picked.id
  returning q.id,q.payload,q.attempts;
end; $$;

create or replace function public.ah_finish_crypto_telegram_notification(p_id uuid,p_success boolean,p_error text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_attempts integer;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
  select attempts into v_attempts from public.ah_crypto_telegram_outbox where id=p_id for update;
  if not found then return; end if;
  if p_success then
    update public.ah_crypto_telegram_outbox set status='delivered',delivered_at=now(),last_error=null where id=p_id;
  else
    update public.ah_crypto_telegram_outbox
    set status=case when v_attempts>=10 then 'dead' else 'pending' end,
        next_attempt_at=now()+make_interval(secs=>least(3600,15*(2^least(v_attempts,8))::integer)),
        last_error=left(coalesce(p_error,'telegram_delivery_failed'),500)
    where id=p_id;
  end if;
end; $$;

revoke all on function public.ah_enqueue_crypto_telegram_event() from public,anon,authenticated;
revoke all on function public.ah_claim_crypto_telegram_notifications(integer) from public,anon,authenticated;
revoke all on function public.ah_finish_crypto_telegram_notification(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.ah_claim_crypto_telegram_notifications(integer) to service_role;
grant execute on function public.ah_finish_crypto_telegram_notification(uuid,boolean,text) to service_role;
commit;
