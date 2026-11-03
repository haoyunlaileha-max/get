begin;

-- Keep expired per-IP buckets bounded without exposing or storing raw IP addresses.
create index if not exists ah_token_auth_rate_limits_updated_idx
  on public.ah_token_auth_rate_limits (updated_at);

create or replace function public.ah_consume_token_auth_attempt(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if current_user <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_bucket_key is null or p_bucket_key !~ '^(register|login):[a-f0-9]{64}$'
     or p_limit is null or p_limit < 1 or p_limit > 100
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit_parameters' using errcode = '22023';
  end if;

  -- Old buckets no longer contribute to any active rate-limit window.
  delete from public.ah_token_auth_rate_limits
  where updated_at < now() - interval '24 hours';

  insert into public.ah_token_auth_rate_limits as limits
    (bucket_key, window_started_at, request_count, updated_at)
  values (p_bucket_key, now(), 1, now())
  on conflict (bucket_key) do update
  set window_started_at = case
        when limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
        then now() else limits.window_started_at end,
      request_count = case
        when limits.window_started_at + make_interval(secs => p_window_seconds) <= now()
        then 1 else limits.request_count + 1 end,
      updated_at = now()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.ah_consume_token_auth_attempt(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ah_consume_token_auth_attempt(text, integer, integer)
  to service_role;

commit;
