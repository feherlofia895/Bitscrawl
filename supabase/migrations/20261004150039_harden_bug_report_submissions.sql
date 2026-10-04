-- Route feedback through a validated, rate-limited RPC. Browser clients must not
-- be able to choose the owner id or insert into the private inbox directly.
create index bug_reports_user_id_created_at_idx
on public.bug_reports (user_id, created_at desc);

drop policy if exists "Players can submit their own bug reports"
on public.bug_reports;

revoke insert (
  user_id,
  room_id,
  room_code,
  reporter_name,
  category,
  description,
  steps,
  technical_context
) on table public.bug_reports from authenticated;
revoke usage, select on sequence public.bug_reports_id_seq from authenticated;

create function private.submit_bug_report(
  requested_category text,
  requested_description text,
  requested_reporter_name text,
  requested_room_code text,
  requested_room_id bigint,
  requested_steps text,
  requested_technical_context jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_category text := lower(btrim(requested_category));
  clean_description text := btrim(requested_description);
  clean_reporter_name text := nullif(btrim(requested_reporter_name), '');
  clean_room_code text := nullif(upper(btrim(requested_room_code)), '');
  clean_steps text := nullif(btrim(requested_steps), '');
  clean_context jsonb := coalesce(requested_technical_context, '{}'::jsonb);
  report_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if clean_category is null
    or clean_category not in ('bug', 'ui', 'connection', 'idea') then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_CATEGORY_INVALID';
  end if;
  if clean_description is null
    or char_length(clean_description) not between 10 and 1500 then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_DESCRIPTION_INVALID';
  end if;
  if clean_reporter_name is not null
    and char_length(clean_reporter_name) > 64 then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_REPORTER_INVALID';
  end if;
  if clean_room_code is not null
    and clean_room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_ROOM_INVALID';
  end if;
  if requested_room_id is not null and requested_room_id < 1 then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_ROOM_INVALID';
  end if;
  if clean_steps is not null and char_length(clean_steps) > 1500 then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_STEPS_INVALID';
  end if;
  if jsonb_typeof(clean_context) <> 'object'
    or octet_length(clean_context::text) > 16384 then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_CONTEXT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text || ':bug-report', 0)
  );

  if exists (
    select 1
    from public.bug_reports report
    where report.user_id = current_user_id
      and report.created_at > clock_timestamp() - interval '30 seconds'
  ) or (
    select count(*)
    from public.bug_reports report
    where report.user_id = current_user_id
      and report.created_at > clock_timestamp() - interval '1 hour'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'BUG_REPORT_RATE_LIMIT';
  end if;

  insert into public.bug_reports (
    user_id,
    room_id,
    room_code,
    reporter_name,
    category,
    description,
    steps,
    technical_context
  ) values (
    current_user_id,
    requested_room_id,
    clean_room_code,
    clean_reporter_name,
    clean_category,
    clean_description,
    clean_steps,
    clean_context
  )
  returning id into report_id;

  return report_id;
end;
$$;

create function public.submit_bug_report(
  requested_category text,
  requested_description text,
  requested_reporter_name text,
  requested_room_code text,
  requested_room_id bigint,
  requested_steps text,
  requested_technical_context jsonb
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.submit_bug_report(
    requested_category,
    requested_description,
    requested_reporter_name,
    requested_room_code,
    requested_room_id,
    requested_steps,
    requested_technical_context
  )
$$;

revoke all on function private.submit_bug_report(text, text, text, text, bigint, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_bug_report(text, text, text, text, bigint, text, jsonb)
  to authenticated, service_role;
revoke all on function public.submit_bug_report(text, text, text, text, bigint, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_bug_report(text, text, text, text, bigint, text, jsonb)
  to authenticated, service_role;

comment on function public.submit_bug_report(text, text, text, text, bigint, text, jsonb) is
  'Submits validated private feedback for the current player with server-side rate limits.';
comment on table public.bug_reports is
  'Private tester feedback. Browser clients submit through a rate-limited RPC and cannot read the inbox.';
