begin;

alter table public.ah_provisioning_jobs
  add column if not exists lease_token uuid;

update public.ah_provisioning_jobs
set lease_token = case when status = 'processing' then gen_random_uuid() else null end
where (status = 'processing' and lease_token is null)
   or (status <> 'processing' and lease_token is not null);

alter table public.ah_provisioning_jobs
  drop constraint if exists ah_provisioning_lease_token_state;
alter table public.ah_provisioning_jobs
  add constraint ah_provisioning_lease_token_state check (
    (status = 'processing' and lease_expires_at is not null and lease_token is not null)
    or (status <> 'processing' and lease_expires_at is null and lease_token is null)
  );

create or replace function public.ah_claim_provisioning_job()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.ah_provisioning_jobs%rowtype;
  v_order public.ah_orders%rowtype;
  v_region jsonb;
  v_items jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.ah_provisioning_jobs
  set status = 'failed',
      lease_expires_at = null,
      lease_token = null,
      last_error_code = 'max_attempts_exceeded',
      completed_at = now()
  where status = 'processing'
    and lease_expires_at < now()
    and attempts >= max_attempts;

  with candidate as (
    select id
    from public.ah_provisioning_jobs
    where attempts < max_attempts
      and (
        (status in ('queued', 'retry_wait') and next_attempt_at <= now())
        or (status = 'processing' and lease_expires_at < now())
      )
    order by next_attempt_at, created_at
    for update skip locked
    limit 1
  )
  update public.ah_provisioning_jobs j
  set status = 'processing',
      attempts = j.attempts + 1,
      lease_expires_at = now() + interval '2 minutes',
      lease_token = gen_random_uuid(),
      last_error_code = null
  from candidate
  where j.id = candidate.id
  returning j.* into v_job;

  if not found then
    return null;
  end if;

  select * into v_order
  from public.ah_orders
  where id = v_job.order_id
  for update;

  if not found or v_order.status not in ('paid', 'provisioning') then
    update public.ah_provisioning_jobs
    set status = 'failed',
        lease_expires_at = null,
        lease_token = null,
        last_error_code = 'order_not_provisionable',
        completed_at = now()
    where id = v_job.id;
    return jsonb_build_object('job_id', v_job.id, 'rejected', true);
  end if;

  update public.ah_orders
  set status = 'provisioning'
  where id = v_order.id and status = 'paid';

  select case when r.id is null then null else
    jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name,
      'city', r.city, 'country_code', r.country_code) end
  into v_region
  from (select v_order.region_id as region_id) x
  left join public.ah_regions r on r.id = x.region_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'description', oi.description_snapshot,
    'quantity', oi.quantity,
    'configuration', oi.configuration,
    'plan_id', oi.plan_id,
    'plan_code', pl.code,
    'plan_name', pl.name,
    'specs', pl.specs
  ) order by oi.created_at), '[]'::jsonb)
  into v_items
  from public.ah_order_items oi
  left join public.ah_plans pl on pl.id = oi.plan_id
  where oi.order_id = v_order.id;

  return jsonb_build_object(
    'job_id', v_job.id,
    'lease_token', v_job.lease_token,
    'order_id', v_order.id,
    'user_id', v_order.user_id,
    'attempt', v_job.attempts,
    'currency', v_order.currency,
    'total_minor', v_order.total_minor,
    'region', v_region,
    'items', v_items
  );
end;
$$;

drop function public.ah_finish_provisioning_job(uuid, boolean, text, text);

create function public.ah_finish_provisioning_job(
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
  v_order_id uuid;
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

  v_order_id := v_job.order_id;

  if p_success then
    if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then
      raise exception 'provider_reference_required' using errcode = '22023';
    end if;
    update public.ah_provisioning_jobs
    set status = 'succeeded',
        lease_expires_at = null,
        lease_token = null,
        provider_reference = p_provider_reference,
        last_error_code = null,
        completed_at = now()
    where id = p_job_id;

    update public.ah_orders
    set status = 'active'
    where id = v_order_id and status = 'provisioning';

    return jsonb_build_object('job_id', p_job_id, 'status', 'succeeded', 'order_status', 'active');
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
    where id = v_order_id and status = 'provisioning';

    return jsonb_build_object('job_id', p_job_id, 'status', 'failed', 'order_status', 'failed');
  end if;

  update public.ah_provisioning_jobs
  set status = 'retry_wait',
      lease_expires_at = null,
      lease_token = null,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * (2 ^ least(v_job.attempts - 1, 7))::integer)),
      last_error_code = coalesce(nullif(p_error_code, ''), 'provider_request_failed')
  where id = p_job_id;

  return jsonb_build_object('job_id', p_job_id, 'status', 'retry_wait');
end;
$$;

revoke all on function public.ah_claim_provisioning_job() from public, anon, authenticated;
revoke all on function public.ah_finish_provisioning_job(uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.ah_claim_provisioning_job() to service_role;
grant execute on function public.ah_finish_provisioning_job(uuid, uuid, boolean, text, text) to service_role;

commit;
