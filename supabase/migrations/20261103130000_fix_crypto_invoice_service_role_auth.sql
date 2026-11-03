create or replace function public.ah_create_crypto_invoice(
 p_user_id uuid,p_order_id uuid,p_asset_code text,p_base_amount_atomic numeric,
 p_quoted_usdt_minor bigint,p_quote_price_usdt numeric,p_expires_at timestamptz
) returns uuid language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $$
declare v_order public.ah_orders%rowtype; v_existing public.ah_crypto_deposits%rowtype;
 v_amount numeric(78,0); v_deposit_id uuid; v_attempt integer:=0;
begin
 if p_user_id is null or p_order_id is null or p_asset_code is null
 or p_base_amount_atomic is null or p_quoted_usdt_minor is null
 or p_quote_price_usdt is null or p_expires_at is null then
 raise exception 'invalid_invoice_request' using errcode='22023'; end if;
 select * into v_order from public.ah_orders where id=p_order_id and user_id=p_user_id for update;
 if not found then raise exception 'order_not_found' using errcode='P0002'; end if;
 if v_order.currency<>'USDT' or v_order.total_minor<=0 then raise exception 'order_must_be_priced_in_usdt' using errcode='22023'; end if;
 if v_order.status not in ('pending','awaiting_payment') then raise exception 'order_not_payable' using errcode='22023'; end if;
 if p_expires_at<=now() or p_expires_at>now()+interval '30 minutes' then raise exception 'invalid_quote_expiry' using errcode='22023'; end if;
 if p_quoted_usdt_minor<>v_order.total_minor or p_base_amount_atomic<=0 or p_quote_price_usdt<=0 then raise exception 'invalid_quote' using errcode='22023'; end if;
 if not exists(select 1 from public.ah_crypto_assets where asset_code=p_asset_code and listener_enabled and listener_status='ready') then raise exception 'asset_monitoring_unavailable' using errcode='22023'; end if;
 select * into v_existing from public.ah_crypto_deposits where order_id=p_order_id and asset_code=p_asset_code and status in ('awaiting','detected','confirming') and expires_at>now() order by created_at desc limit 1;
 if found then return v_existing.id; end if;
 loop
  v_amount:=p_base_amount_atomic+v_attempt;
  begin
   insert into public.ah_crypto_deposits(order_id,user_id,asset_code,expected_amount_atomic,quoted_usdt_minor,quote_price_usdt,quote_expires_at,expires_at,status)
   values(p_order_id,p_user_id,p_asset_code,v_amount,p_quoted_usdt_minor,p_quote_price_usdt,p_expires_at,p_expires_at,'awaiting') returning id into v_deposit_id;
   exit;
  exception when unique_violation then v_attempt:=v_attempt+1; if v_attempt>100 then raise exception 'invoice_amount_allocation_exhausted' using errcode='23505'; end if;
  end;
 end loop;
 update public.ah_orders set status='awaiting_payment',payment_provider='direct_wallet_crypto',updated_at=now() where id=p_order_id;
 return v_deposit_id;
end; $$;
revoke all on function public.ah_create_crypto_invoice(uuid,uuid,text,numeric,bigint,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.ah_create_crypto_invoice(uuid,uuid,text,numeric,bigint,numeric,timestamptz) to service_role;
