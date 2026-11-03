-- Durable, idempotent provisioning queue for paid Anonymous Hosting orders.
-- Additive: creates only ah_* objects and does not provision any real server by itself.

begin;

create table if not exists public.ah_provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.ah_orders(id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'retry_wait', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  provider_reference text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ah_provisioning_lease_state check (
    (status = 'processing' and lease_expires_at is not null)
    or (status <> 'processing' and lease_expires_at is null)
  )
);

create index if not exists ah_provisioning_jobs_ready_idx
  on public.ah_provisioning_jobs (next_attempt_at, created_at)
  where status in ('queued', 'retry_wait', 'processing');

create index if not exists ah_provisioning_jobs_order_idx
  on public.ah_provisioning_jobs (order_id);

alter table public.ah_provisioning_jobs enable row level security;
revoke all on public.ah_provisioning_jobs from public, anon, authenticated;
grant select, insert, update on public.ah_provisioning_jobs to service_role;

drop trigger if exists ah_provisioning_jobs_set_updated_at on public.ah_provisioning_jobs;
create trigger ah_provisioning_jobs_set_updated_at
before update on public.ah_provisioning_jobs
for each row execute function public.ah_set_updated_at();

create or replace function public.ah_enqueue_paid_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.ah_provisioning_jobs (order_id)
    values (new.id)
    on conflict (order_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists ah_orders_enqueue_provisioning on public.ah_orders;
create trigger ah_orders_enqueue_provisioning
after insert or update of status on public.ah_orders
for each row execute function public.ah_enqueue_paid_order();

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

create or replace function public.ah_finish_provisioning_job(
  p_job_id uuid,
  p_success boolean,
  p_provider_reference text default null,
  p_error_code text default null
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
  if p_job_id is null or p_success is null then
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
  if v_job.status <> 'processing' then
    return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'duplicate', true);
  end if;

  v_order_id := v_job.order_id;

  if p_success then
    if p_provider_reference is null or length(trim(p_provider_reference)) = 0 then
      raise exception 'provider_reference_required' using errcode = '22023';
    end if;
    update public.ah_provisioning_jobs
    set status = 'succeeded',
        lease_expires_at = null,
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
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * (2 ^ least(v_job.attempts - 1, 7))::integer)),
      last_error_code = coalesce(nullif(p_error_code, ''), 'provider_request_failed')
  where id = p_job_id;

  return jsonb_build_object('job_id', p_job_id, 'status', 'retry_wait');
end;
$$;

revoke all on function public.ah_claim_provisioning_job() from public, anon, authenticated;
revoke all on function public.ah_finish_provisioning_job(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.ah_claim_provisioning_job() to service_role;
grant execute on function public.ah_finish_provisioning_job(uuid, boolean, text, text) to service_role;


-- Trigger-only privileged function; prevent direct RPC invocation by browser roles.
revoke all on function public.ah_enqueue_paid_order() from public, anon, authenticated;

commit;
