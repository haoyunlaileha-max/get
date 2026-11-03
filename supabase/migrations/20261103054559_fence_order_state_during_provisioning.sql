-- Preserve truth and surface reconciliation when an order changes during provisioning.
-- A provider may finish creating a resource after an order has entered a terminal state.

begin;

alter table public.ah_provisioning_jobs
  add column if not exists requires_reconciliation boolean not null default false;

comment on column public.ah_provisioning_jobs.requires_reconciliation is
  'True when provider provisioning succeeded after the related order left provisioning; manual provider-side reconciliation is required.';

create or replace function public.ah_finish_provisioning_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_success boolean,
  p_provider_reference text,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.ah_provisioning_jobs%rowtype;
  v_order public.ah_orders%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_job_id is null or p_lease_token is null or p_success is null then
    raise exception 'invalid_provisioning_result' using errcode = '22023';
  end if;
  if p_provider_reference is not null and length(p_provider_reference) > 200 then
    raise exception 'invalid_provider_reference' using errcode = '22023';
  end if;

  select * into v_job
  from public.ah_provisioning_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'provisioning_job_not_found' using errcode = 'P0002';
  end if;
  if v_job.status <> 'processing'
     or v_job.lease_token is distinct from p_lease_token
     or v_job.lease_expires_at <= now() then
    return jsonb_build_object(
      'job_id', v_job.id,
      'status', v_job.status,
      'stale_lease', true
    );
  end if;

  select * into v_order
  from public.ah_orders
  where id = v_job.order_id
  for update;

  if not found then
    raise exception 'provisioning_order_not_found' using errcode = 'P0002';
  end if;

  if p_success then
    if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then
      raise exception 'provider_reference_required' using errcode = '22023';
    end if;

    update public.ah_provisioning_jobs
    set status = 'succeeded',
        lease_expires_at = null,
        lease_token = null,
        provider_reference = p_provider_reference,
        requires_reconciliation = (v_order.status <> 'provisioning'),
        last_error_code = case
          when v_order.status = 'provisioning' then null
          else 'order_status_changed_after_provider_success'
        end,
        completed_at = now()
    where id = p_job_id;

    if v_order.status = 'provisioning' then
      update public.ah_orders
      set status = 'active'
      where id = v_order.id;
      v_order.status := 'active';
    end if;

    return jsonb_build_object(
      'job_id', p_job_id,
      'status', 'succeeded',
      'order_status', v_order.status,
      'requires_reconciliation', (v_order.status <> 'active')
    );
  end if;

  -- Do not retry a provider failure when the order has already left the
  -- provisioning lifecycle (for example, cancellation or refund).
  if v_order.status <> 'provisioning' then
    update public.ah_provisioning_jobs
    set status = 'failed',
        lease_expires_at = null,
        lease_token = null,
        last_error_code = 'order_not_provisioning_retry_suppressed',
        completed_at = now()
    where id = p_job_id;

    return jsonb_build_object(
      'job_id', p_job_id,
      'status', 'failed',
      'order_status', v_order.status,
      'retry_suppressed', true
    );
  end if;

  if v_job.attempts >= v_job.max_attempts then
    update public.ah_provisioning_jobs
    set status = 'failed',
        lease_expires_at = null,
        lease_token = null,
        last_error_code = coalesce(nullif(p_error_code, ''), 'provider_request_failed'),
        completed_at = now()
    where id = p_job_id;

    update public.ah_orders
    set status = 'failed'
    where id = v_order.id;

    return jsonb_build_object('job_id', p_job_id, 'status', 'failed', 'order_status', 'failed');
  end if;

  update public.ah_provisioning_jobs
  set status = 'retry_wait',
      lease_expires_at = null,
      lease_token = null,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * (2 ^ least(v_job.attempts - 1, 7))::integer)),
      last_error_code = coalesce(nullif(p_error_code, ''), 'provider_request_failed')
  where id = p_job_id;

  return jsonb_build_object('job_id', p_job_id, 'status', 'retry_wait', 'order_status', v_order.status);
end;
$$;

revoke all on function public.ah_finish_provisioning_job(uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.ah_finish_provisioning_job(uuid, uuid, boolean, text, text)
  to service_role;

commit;
