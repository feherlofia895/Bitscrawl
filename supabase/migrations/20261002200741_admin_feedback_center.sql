create function private.get_admin_feedback_reports(requested_status text default null)
returns table (
  report_id bigint,
  created_at timestamptz,
  reporter_name text,
  category text,
  description text,
  steps text,
  technical_context jsonb,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  if requested_status is not null
    and requested_status not in ('new', 'reviewed', 'fixed', 'closed') then
    raise exception using errcode = 'P0001', message = 'FEEDBACK_STATUS_INVALID';
  end if;

  return query
  select
    report.id,
    report.created_at,
    report.reporter_name,
    report.category,
    report.description,
    report.steps,
    report.technical_context,
    report.status
  from public.bug_reports report
  where requested_status is null or report.status = requested_status
  order by report.created_at desc, report.id desc
  limit 200;
end;
$$;

create function public.get_admin_feedback_reports(requested_status text default null)
returns table (
  report_id bigint,
  created_at timestamptz,
  reporter_name text,
  category text,
  description text,
  steps text,
  technical_context jsonb,
  status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_admin_feedback_reports(requested_status)
$$;

create function private.get_admin_feedback_summary()
returns table (new_count bigint, bug_count bigint, idea_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  return query
  select
    count(*) filter (where report.status = 'new'),
    count(*) filter (where report.status = 'new' and report.category <> 'idea'),
    count(*) filter (where report.status = 'new' and report.category = 'idea')
  from public.bug_reports report;
end;
$$;

create function public.get_admin_feedback_summary()
returns table (new_count bigint, bug_count bigint, idea_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_admin_feedback_summary()
$$;

create function private.set_admin_feedback_status(target_report_id bigint, requested_status text)
returns table (report_id bigint, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  if requested_status not in ('new', 'reviewed', 'fixed', 'closed') then
    raise exception using errcode = 'P0001', message = 'FEEDBACK_STATUS_INVALID';
  end if;

  return query
  update public.bug_reports report
  set status = requested_status
  where report.id = target_report_id
  returning report.id, report.status;

  if not found then
    raise exception using errcode = 'P0001', message = 'FEEDBACK_REPORT_NOT_FOUND';
  end if;
end;
$$;

create function public.set_admin_feedback_status(target_report_id bigint, requested_status text)
returns table (report_id bigint, status text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_admin_feedback_status(target_report_id, requested_status)
$$;

revoke all on function private.get_admin_feedback_reports(text) from public, anon;
grant execute on function private.get_admin_feedback_reports(text) to authenticated;
revoke all on function public.get_admin_feedback_reports(text) from public, anon;
grant execute on function public.get_admin_feedback_reports(text) to authenticated;

revoke all on function private.get_admin_feedback_summary() from public, anon;
grant execute on function private.get_admin_feedback_summary() to authenticated;
revoke all on function public.get_admin_feedback_summary() from public, anon;
grant execute on function public.get_admin_feedback_summary() to authenticated;

revoke all on function private.set_admin_feedback_status(bigint, text) from public, anon;
grant execute on function private.set_admin_feedback_status(bigint, text) to authenticated;
revoke all on function public.set_admin_feedback_status(bigint, text) from public, anon;
grant execute on function public.set_admin_feedback_status(bigint, text) to authenticated;

comment on function public.get_admin_feedback_reports(text) is
  'Lists private tester feedback after server-side admin authorization without exposing account identifiers.';
comment on function public.get_admin_feedback_summary() is
  'Returns admin-only new feedback counts for the top bar notification.';
comment on function public.set_admin_feedback_status(bigint, text) is
  'Changes tester feedback workflow status after server-side admin authorization.';
