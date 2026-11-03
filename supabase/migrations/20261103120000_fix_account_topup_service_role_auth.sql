create or replace function public.ah_create_account_topup(
  p_user_id uuid, p_amount_minor bigint, p_idempotency_key text
) returns uuid
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_order_id uuid;
  v_existing public.ah_orders%rowtype;
  v_fingerprint text;
  v_topup_id uuid;
begin
  -- EXECUTE privileges enforce the caller role. sb_secret keys are not JWTs,
  -- so request.jwt.claim.role is not a reliable authorization signal.
  if p_user_id is null
     or p_amount_minor not in (1000,2500,5000,10000,25000,50000)
     or p_idempotency_key is null
     or p_idempotency_key !~ '^topup:[0-9a-f-]{36}$' then
    raise exception 'invalid_topup_request' using errcode='22023';
  end if;
  v_fingerprint:=md5('account-topup|'||p_amount_minor::text);
  select * into v_existing from public.ah_orders
   where user_id=p_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint
       or v_existing.total_minor is distinct from p_amount_minor
       or v_existing.currency <> 'USDT' then
      raise exception 'topup_idempotency_conflict' using errcode='23505';
    end if;
    v_order_id:=v_existing.id;
  else
    insert into public.ah_orders(
      user_id,status,currency,subtotal_minor,total_minor,idempotency_key,
      request_fingerprint,customer_note,payment_provider
    ) values (
      p_user_id,'pending','USDT',p_amount_minor,p_amount_minor,p_idempotency_key,
      v_fingerprint,'账户余额充值','direct_wallet_crypto'
    ) returning id into v_order_id;
  end if;
  insert into public.ah_account_topups(user_id,order_id,amount_minor)
    values(p_user_id,v_order_id,p_amount_minor)
    on conflict(order_id) do nothing
    returning id into v_topup_id;
  if v_topup_id is null and not exists(
    select 1 from public.ah_account_topups
    where order_id=v_order_id and user_id=p_user_id and amount_minor=p_amount_minor
  ) then
    raise exception 'topup_record_conflict' using errcode='23505';
  end if;
  return v_order_id;
end;
$$;
revoke all on function public.ah_create_account_topup(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.ah_create_account_topup(uuid,bigint,text) to service_role;
