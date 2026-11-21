-- ===========================================================================
-- Hasswell London — Operational support
-- Migration 0007
-- ===========================================================================

-- Database-backed rate limiting so limits hold across serverless instances.
create table if not exists rate_limits (
  key          text primary key,
  count        integer not null default 0,
  window_start timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_limit <= 0 then
    return false;
  end if;

  insert into rate_limits as rl (key, count, window_start, updated_at)
  values (p_key, 1, now(), now())
  on conflict (key) do update
    set count = case
          when rl.window_start < now() - make_interval(secs => greatest(p_window_seconds, 1))
          then 1 else rl.count + 1 end,
        window_start = case
          when rl.window_start < now() - make_interval(secs => greatest(p_window_seconds, 1))
          then now() else rl.window_start end,
        updated_at = now()
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function consume_rate_limit(text, integer, integer) to service_role;

-- Transactional email audit trail (no message bodies containing personal data
-- beyond the recipient address and template name).
create table if not exists email_log (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders (id) on delete set null,
  to_email   text not null,
  template   text not null,
  subject    text,
  status     text not null default 'queued',
  provider   text,
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists email_log_order_idx on email_log (order_id, created_at desc);
create index if not exists email_log_created_idx on email_log (created_at desc);

alter table email_log enable row level security;

drop policy if exists "email_log_admin_read" on email_log;
create policy "email_log_admin_read" on email_log
  for select to authenticated using (is_admin());

-- Housekeeping for rate limit rows.
create or replace function prune_operational_tables()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from rate_limits where updated_at < now() - interval '2 days';
  delete from email_log where created_at < now() - interval '180 days';
end;
$$;

revoke all on function prune_operational_tables() from public, anon, authenticated;
grant execute on function prune_operational_tables() to service_role;
