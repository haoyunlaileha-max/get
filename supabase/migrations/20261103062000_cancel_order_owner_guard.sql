-- Bind unpaid-order cancellation to the authenticated owner.
-- The caller identity is supplied only by the trusted Edge Function after auth.getUser().

begin;

drop function public.ah_cancel_unpaid_order(uuid);

create function public.ah_cancel_unpaid_order(
  p_order_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.ah_orders%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_order_id is null or p_user_id is null then
    raise exception 'invalid_order_request' using errcode = '22023';
  end if;

  select * into v_order
  from public.ah_orders
  where id = p_order_id
    and user_id = p_user_id
  for update;

  -- Do not reveal whether another customer's order ID exists.
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'order_id', v_order.id,
      'status', 'cancelled',
      'duplicate', true,
      'inventory_released_at', v_order.inventory_released_at
    );
  end if;

  if v_order.status not in ('pending', 'awaiting_payment') then
    raise exception 'order_requires_payment_or_provider_workflow'
      using errcode = '22023';
  end if;

  update public.ah_orders
  set status = 'cancelled'
  where id = v_order.id;

  -- Existing trigger releases reserved inventory exactly once.
  -- In-flight provisioning leases remain intact for late-success reconciliation.
  return jsonb_build_object(
    'order_id', v_order.id,
    'status', 'cancelled',
    'duplicate', false,
    'inventory_released_at', (
      select inventory_released_at from public.ah_orders where id = v_order.id
    )
  );
end;
$$;

revoke all on function public.ah_cancel_unpaid_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ah_cancel_unpaid_order(uuid, uuid) to service_role;

comment on function public.ah_cancel_unpaid_order(uuid, uuid) is
  'Service-role-only cancellation for the authenticated owner of unpaid pending/awaiting_payment orders.';

commit;
