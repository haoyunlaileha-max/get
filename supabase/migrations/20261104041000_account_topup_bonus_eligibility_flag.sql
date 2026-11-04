
drop function if exists public.ah_create_account_topup(uuid,bigint,text);
create function public.ah_create_account_topup(
 p_user_id uuid,p_amount_minor bigint,p_bonus_eligible boolean,p_idempotency_key text
) returns uuid
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_order_id uuid; v_existing public.ah_orders%rowtype; v_fingerprint text; v_topup_id uuid; v_bonus_minor bigint:=0;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not_authorized' using errcode='42501'; end if;
 if p_user_id is null or p_amount_minor is null or p_amount_minor<3000 or p_amount_minor>9007199254740991
   or p_bonus_eligible is null or p_idempotency_key is null or p_idempotency_key !~ '^topup:[0-9a-f-]{36}$' then
   raise exception 'invalid_topup_request' using errcode='22023';
 end if;
 if p_bonus_eligible then
  v_bonus_minor:=case p_amount_minor when 10000 then 2500 when 25000 then 7500 when 50000 then 20000 when 100000 then 50000 when 200000 then 200000 else 0 end;
 end if;
 v_fingerprint:=md5('account-topup|'||p_amount_minor::text||'|'||v_bonus_minor::text);
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
 insert into public.ah_account_topups(user_id,order_id,amount_minor,bonus_minor)
 values(p_user_id,v_order_id,p_amount_minor,v_bonus_minor) on conflict(order_id) do nothing returning id into v_topup_id;
 if v_topup_id is null and not exists(select 1 from public.ah_account_topups where order_id=v_order_id and user_id=p_user_id and amount_minor=p_amount_minor and bonus_minor=v_bonus_minor) then
  raise exception 'topup_record_conflict' using errcode='23505';
 end if;
 return v_order_id;
end; $$;
revoke all on function public.ah_create_account_topup(uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.ah_create_account_topup(uuid,bigint,boolean,text) to service_role;
