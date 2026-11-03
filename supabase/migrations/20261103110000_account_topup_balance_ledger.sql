begin;
-- Account top-ups are credited only after the existing crypto listener confirms payment.
create table if not exists public.ah_account_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  order_id uuid not null unique references public.ah_orders(id) on delete restrict,
  amount_minor bigint not null check (amount_minor in (1000,2500,5000,10000,25000,50000)),
  currency varchar(4) not null default 'USDT' check (currency='USDT'),
  status text not null default 'awaiting' check (status in ('awaiting','credited','manual_review')),
  created_at timestamptz not null default now(),
  credited_at timestamptz
);
create index if not exists ah_account_topups_user_created_idx on public.ah_account_topups(user_id,created_at desc);
create table if not exists public.ah_account_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  topup_id uuid not null unique references public.ah_account_topups(id) on delete restrict,
  entry_type text not null check (entry_type='topup_credit'),
  amount_minor bigint not null check (amount_minor > 0),
  currency varchar(4) not null default 'USDT' check (currency='USDT'),
  created_at timestamptz not null default now()
);
create index if not exists ah_account_ledger_user_created_idx on public.ah_account_ledger(user_id,created_at desc);
alter table public.ah_account_topups enable row level security;
alter table public.ah_account_ledger enable row level security;
drop policy if exists ah_account_topups_owner_read on public.ah_account_topups;
create policy ah_account_topups_owner_read on public.ah_account_topups for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists ah_account_ledger_owner_read on public.ah_account_ledger;
create policy ah_account_ledger_owner_read on public.ah_account_ledger for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.ah_account_topups, public.ah_account_ledger from anon, authenticated;
grant select on public.ah_account_topups, public.ah_account_ledger to authenticated;
create or replace function public.ah_create_account_topup(p_user_id uuid,p_amount_minor bigint,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_order_id uuid; v_existing public.ah_orders%rowtype; v_fingerprint text; v_topup_id uuid;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
 if p_user_id is null or p_amount_minor not in (1000,2500,5000,10000,25000,50000)
   or p_idempotency_key is null or p_idempotency_key !~ '^topup:[0-9a-f-]{36}$' then
   raise exception 'invalid_topup_request' using errcode='22023';
 end if;
 v_fingerprint:=md5('account-topup|'||p_amount_minor::text);
 select * into v_existing from public.ah_orders where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
 if found then
  if v_existing.request_fingerprint is distinct from v_fingerprint or v_existing.total_minor is distinct from p_amount_minor or v_existing.currency<>'USDT' then
   raise exception 'topup_idempotency_conflict' using errcode='23505';
  end if;
  v_order_id:=v_existing.id;
 else
  insert into public.ah_orders(user_id,status,currency,subtotal_minor,total_minor,idempotency_key,request_fingerprint,customer_note,payment_provider)
  values(p_user_id,'pending','USDT',p_amount_minor,p_amount_minor,p_idempotency_key,v_fingerprint,'账户余额充值','direct_wallet_crypto')
  returning id into v_order_id;
 end if;
 insert into public.ah_account_topups(user_id,order_id,amount_minor) values(p_user_id,v_order_id,p_amount_minor)
 on conflict(order_id) do nothing returning id into v_topup_id;
 if v_topup_id is null and not exists(select 1 from public.ah_account_topups where order_id=v_order_id and user_id=p_user_id and amount_minor=p_amount_minor) then
  raise exception 'topup_record_conflict' using errcode='23505';
 end if;
 return v_order_id;
end; $$;
revoke all on function public.ah_create_account_topup(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.ah_create_account_topup(uuid,bigint,text) to service_role;
create or replace function public.ah_credit_account_topup_on_paid()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_topup public.ah_account_topups%rowtype;
begin
 if new.status='paid' and old.status is distinct from 'paid' and new.payment_provider='direct_wallet_crypto' then
  select * into v_topup from public.ah_account_topups where order_id=new.id and user_id=new.user_id for update;
  if found then
   if v_topup.amount_minor<>new.total_minor or new.currency<>'USDT' then
    update public.ah_account_topups set status='manual_review' where id=v_topup.id;
   else
    insert into public.ah_account_ledger(user_id,topup_id,entry_type,amount_minor,currency)
    values(v_topup.user_id,v_topup.id,'topup_credit',v_topup.amount_minor,'USDT') on conflict(topup_id) do nothing;
    update public.ah_account_topups set status='credited',credited_at=coalesce(credited_at,now()) where id=v_topup.id;
   end if;
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.ah_credit_account_topup_on_paid() from public,anon,authenticated;
drop trigger if exists ah_credit_account_topup_after_order_paid on public.ah_orders;
create trigger ah_credit_account_topup_after_order_paid after update of status on public.ah_orders for each row execute function public.ah_credit_account_topup_on_paid();
commit;
