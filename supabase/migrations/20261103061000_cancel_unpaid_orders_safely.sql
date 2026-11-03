-- Safe cancellation boundary for unpaid orders only.
-- Paid or provisioned orders require a verified refund and provider cleanup workflow.

begin;

create or replace function public.ah_cancel_unpaid_order(p_order_id uuid)
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

  if p_order_id is null then
    raise exception 'invalid_order_id' using errcode = '22023';
  end if;

  select * into v_order
  from public.ah_orders
  where id = p_order_id
  for update;

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
      using errcode = '22023',
      detail = 'Only unpaid pending orders can use this cancellation function. Paid, provisioning, active, suspended, failed, and refunded orders require their dedicated workflow.';
  end if;

  update public.ah_orders
  set status = 'cancelled'
  where id = v_order.id;

  -- ah_orders_release_inventory performs the once-only reservation release.
  -- No provisioning job is force-cancelled here: an in-flight provider request
  -- must retain its lease so a late success can be flagged for reconciliation.

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

revoke all on function public.ah_cancel_unpaid_order(uuid) from public, anon, authenticated;
grant execute on function public.ah_cancel_unpaid_order(uuid) to service_role;

comment on function public.ah_cancel_unpaid_order(uuid) is
  'Service-role-only cancellation for unpaid pending/awaiting_payment orders. Paid or provisioned orders require separate verified refund and provider cleanup workflows.';

commit;
