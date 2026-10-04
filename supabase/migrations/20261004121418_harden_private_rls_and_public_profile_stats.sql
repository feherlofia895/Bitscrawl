alter table private.competition_entries enable row level security;
alter table private.competition_votes enable row level security;
alter table private.app_admins enable row level security;
alter table private.weekly_score_awards enable row level security;
alter table private.monthly_score_awards enable row level security;

revoke all on table
  private.competition_entries,
  private.competition_votes,
  private.app_admins,
  private.weekly_score_awards,
  private.monthly_score_awards
from public, anon, authenticated, service_role;

create or replace function private.get_public_profile_stats(target_profile_name text)
returns table (
  received_like_count integer,
  avatar_like_count integer,
  trophy_count integer,
  gold_count integer,
  silver_count integer,
  bronze_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_profile public.profiles%rowtype;
begin
  if btrim(coalesce(target_profile_name, '')) = '' then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  select profile.*
  into target_profile
  from public.profiles profile
  where lower(profile.display_name) = lower(btrim(target_profile_name));

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  return query
  with all_placements as (
    select award.placement
    from private.weekly_score_awards award
    where award.user_id = target_profile.user_id
      and award.excluded_at is null
    union all
    select award.placement
    from private.monthly_score_awards award
    where award.user_id = target_profile.user_id
      and award.excluded_at is null
  )
  select
    (
      select count(*)::integer
      from public.feed_likes feed_like
      join public.feed_posts post on post.id = feed_like.post_id
      where post.user_id = target_profile.user_id
    ),
    (
      select count(*)::integer
      from private.profile_avatar_likes avatar_like
      where avatar_like.target_user_id = target_profile.user_id
        and avatar_like.avatar_version = target_profile.avatar_version
    ),
    count(*) filter (where placement between 1 and 3)::integer,
    count(*) filter (where placement = 1)::integer,
    count(*) filter (where placement = 2)::integer,
    count(*) filter (where placement = 3)::integer
  from all_placements;
end;
$function$;

revoke all on function private.get_public_profile_stats(text) from public;
grant execute on function private.get_public_profile_stats(text)
  to anon, authenticated, service_role;
grant usage on schema private to service_role;

create or replace function public.get_public_profile_stats(target_profile_name text)
returns table (
  received_like_count integer,
  avatar_like_count integer,
  trophy_count integer,
  gold_count integer,
  silver_count integer,
  bronze_count integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select *
  from private.get_public_profile_stats(target_profile_name);
$function$;

revoke all on function public.get_public_profile_stats(text) from public;
grant execute on function public.get_public_profile_stats(text)
  to anon, authenticated, service_role;

comment on function private.get_public_profile_stats(text) is
  'Privileged implementation for public aggregate profile statistics; kept outside exposed API schemas.';
comment on function public.get_public_profile_stats(text) is
  'Security-invoker API wrapper returning public aggregate likes and podium counts without account identifiers.';
