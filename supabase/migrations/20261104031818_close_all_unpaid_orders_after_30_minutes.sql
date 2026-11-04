-- Close every unpaid order at its 30-minute deadline. Transfers detected before closure are retained for manual review.
CREATE OR REPLACE FUNCTION public.ah_expire_unpaid_orders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare v_count integer;
begin
  with expired_candidates as (
    select o.id
    from public.ah_orders o
    where o.status in ('pending','awaiting_payment')
      and o.expires_at <= now()
    order by o.expires_at
    for update skip locked
    limit 500
  ), expired_deposits as (
    update public.ah_crypto_deposits d
    set status = case
      when d.status in ('detected','confirming') then 'manual_review'
      else 'expired'
    end,
    updated_at = now()
    from expired_candidates e
    where d.order_id=e.id
      and d.status in ('awaiting','detected','confirming')
    returning d.id
  ), closed_orders as (
    update public.ah_orders o
    set status='cancelled',updated_at=now()
    from expired_candidates e
    where o.id=e.id and o.status in ('pending','awaiting_payment')
    returning o.id
  )
  select count(*)::integer into v_count from closed_orders;
  return coalesce(v_count,0);
end;
$function$

revoke all on function public.ah_expire_unpaid_orders() from public, anon, authenticated;
grant execute on function public.ah_expire_unpaid_orders() to postgres;
select cron.schedule('ah-expire-unpaid-orders','30 seconds','select public.ah_expire_unpaid_orders();');
select public.ah_expire_unpaid_orders();
