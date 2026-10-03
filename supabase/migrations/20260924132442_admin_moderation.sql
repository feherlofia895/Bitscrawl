create table private.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default clock_timestamp()
);

revoke all on table private.app_admins from public, anon, authenticated;

insert into private.app_admins (user_id)
select profile.user_id
from public.profiles profile
where lower(profile.display_name) = 'martinteteme'
on conflict (user_id) do nothing;

create function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean, true)
    and exists (
      select 1
      from private.app_admins admin
      where admin.user_id = auth.uid()
    )
$$;

create function public.is_app_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_app_admin() $$;

create function private.moderate_delete_content(target_kind text, target_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_id bigint;
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  case target_kind
    when 'feed-post' then
      delete from public.feed_posts post
      where post.id = target_id
      returning post.id into affected_id;
    when 'weekly-entry' then
      update public.weekly_entries entry
      set excluded_at = coalesce(entry.excluded_at, clock_timestamp())
      where entry.id = target_id
      returning entry.id into affected_id;
    when 'monthly-entry' then
      update public.monthly_entries entry
      set excluded_at = coalesce(entry.excluded_at, clock_timestamp())
      where entry.id = target_id
      returning entry.id into affected_id;
    when 'feed-comment' then
      delete from public.feed_comments comment
      where comment.id = target_id
      returning comment.id into affected_id;
    when 'gallery-comment' then
      delete from public.gallery_comments comment
      where comment.id = target_id
      returning comment.id into affected_id;
    else
      raise exception using errcode = 'P0001', message = 'MODERATION_KIND_INVALID';
  end case;

  if affected_id is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
  end if;
  return true;
end;
$$;

create function public.moderate_delete_content(target_kind text, target_id bigint)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.moderate_delete_content(target_kind, target_id) $$;

revoke all on function private.is_app_admin() from public, anon;
grant execute on function private.is_app_admin() to authenticated;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

revoke all on function private.moderate_delete_content(text, bigint) from public, anon;
grant execute on function private.moderate_delete_content(text, bigint) to authenticated;
revoke all on function public.moderate_delete_content(text, bigint) from public, anon;
grant execute on function public.moderate_delete_content(text, bigint) to authenticated;

comment on table private.app_admins is 'Server-side allowlist for Bitscrawl content moderators.';
comment on function public.moderate_delete_content(text, bigint) is
  'Deletes a feed post or comment, or excludes a weekly/monthly entry, after server-side admin authorization.';
