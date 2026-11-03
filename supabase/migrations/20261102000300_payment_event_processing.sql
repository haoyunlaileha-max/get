-- Verified payment notification processing for Anonymous Hosting.
-- This migration is additive and touches only ah_* objects.
-- The webhook accepts a normalized, HMAC-signed event envelope; integrate a
-- provider-specific signature adapter before exposing it to a payment vendor.

begin;

alter table public.ah_orders
  add column if not exists paid_at timestamptz,
  add column if not exists payment_provider text;

create table if not exists public.ah_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  order_id uuid not null references public.ah_orders(id) on delete restrict,
  event_type text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists ah_payment_events_order_idx
  on public.ah_payment_events (order_id, received_at desc);

alter table public.ah_payment_events enable row level security;
revoke all on public.ah_payment_events from public, anon, authenticated;
grant select, insert on public.ah_payment_events to service_role;

create or replace function public.ah_apply_payment_event(
  p_provider text,
  p_event_id text,
  p_order_id uuid,
  p_event_type text,
  p_amount_minor bigint,
  p_currency text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_order public.ah_orders%rowtype;
  v_event public.ah_payment_events%rowtype;
  v_event_row_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_provider is null or p_provider !~ '^[a-z0-9_-]{2,40}$'
     or p_event_id is null or length(p_event_id) < 1 or length(p_event_id) > 200
     or p_order_id is null
     or p_event_type is distinct from 'payment.succeeded'
     or p_amount_minor is null or p_amount_minor < 0
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_payment_event' using errcode = '22023';
  end if;

  select * into v_order
  from public.ah_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if v_order.total_minor <> p_amount_minor
     or upper(v_order.currency::text) <> p_currency then
    raise exception 'payment_amount_or_currency_mismatch' using errcode = '22023';
  end if;

  insert into public.ah_payment_events (
    provider, event_id, order_id, event_type,
    amount_minor, currency, payload_sha256
  ) values (
    p_provider, p_event_id, p_order_id, p_event_type,
    p_amount_minor, p_currency, p_payload_sha256
  )
  on conflict (provider, event_id) do nothing
  returning id into v_event_row_id;

  if v_event_row_id is null then
    select * into v_event
    from public.ah_payment_events
    where provider = p_provider and event_id = p_event_id;

    if v_event.order_id is distinct from p_order_id
       or v_event.amount_minor is distinct from p_amount_minor
       or v_event.currency is distinct from p_currency
       or v_event.payload_sha256 is distinct from p_payload_sha256 then
      raise exception 'payment_event_conflict' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'order_id', p_order_id,
      'status', v_order.status,
      'duplicate', true
    );
  end if;

  if v_order.status not in ('pending', 'awaiting_payment') then
    raise exception 'order_not_payable' using errcode = '22023';
  end if;

  update public.ah_orders
  set status = 'paid',
      paid_at = now(),
      payment_provider = p_provider
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', 'paid',
    'duplicate', false
  );
end;
$$;

revoke all on function public.ah_apply_payment_event(text, text, uuid, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.ah_apply_payment_event(text, text, uuid, text, bigint, text, text)
  to service_role;


commit;
