-- Supabase Secret API keys are validated at the API gateway and may not populate
-- the legacy request.jwt.claim.role setting. Restrict these SECURITY DEFINER RPCs
-- by EXECUTE grants instead of a second, legacy JWT-claim check.
begin;

create or replace function public.ah_claim_crypto_telegram_notifications(p_limit integer default 20)
returns table(id uuid,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  return query
  with picked as (
    select q.id
    from public.ah_crypto_telegram_outbox q
    where q.status in ('pending','sending')
      and q.next_attempt_at<=now()
      and q.attempts<10
    order by q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.ah_crypto_telegram_outbox q
  set status='sending',attempts=q.attempts+1,last_error=null
  from picked
  where q.id=picked.id
  returning q.id,q.payload,q.attempts;
end;
$$;

create or replace function public.ah_finish_crypto_telegram_notification(p_id uuid,p_success boolean,p_error text default null)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_attempts integer;
begin
  select attempts into v_attempts
  from public.ah_crypto_telegram_outbox
  where id=p_id
  for update;
  if not found then return; end if;

  if p_success then
    update public.ah_crypto_telegram_outbox
    set status='delivered',delivered_at=now(),last_error=null
    where id=p_id;
  else
    update public.ah_crypto_telegram_outbox
    set status=case when v_attempts>=10 then 'dead' else 'pending' end,
        next_attempt_at=now()+make_interval(secs=>least(3600,15*(2^least(v_attempts,8))::integer)),
        last_error=left(coalesce(p_error,'telegram_delivery_failed'),500)
    where id=p_id;
  end if;
end;
$$;

revoke all on function public.ah_claim_crypto_telegram_notifications(integer) from public,anon,authenticated;
grant execute on function public.ah_claim_crypto_telegram_notifications(integer) to service_role;
revoke all on function public.ah_finish_crypto_telegram_notification(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.ah_finish_crypto_telegram_notification(uuid,boolean,text) to service_role;

commit;