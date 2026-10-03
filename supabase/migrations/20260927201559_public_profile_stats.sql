create function public.get_public_profile_stats(target_profile_name text)
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
as $$
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
    (
      select count(*)::integer
      from private.weekly_score_awards award
      where award.user_id = target_profile.user_id
        and award.excluded_at is null
        and award.placement between 1 and 3
    ),
    (
      select count(*)::integer
      from private.weekly_score_awards award
      where award.user_id = target_profile.user_id
        and award.excluded_at is null
        and award.placement = 1
    ),
    (
      select count(*)::integer
      from private.weekly_score_awards award
      where award.user_id = target_profile.user_id
        and award.excluded_at is null
        and award.placement = 2
    ),
    (
      select count(*)::integer
      from private.weekly_score_awards award
      where award.user_id = target_profile.user_id
        and award.excluded_at is null
        and award.placement = 3
    );
end;
$$;

revoke all on function public.get_public_profile_stats(text) from public;
grant execute on function public.get_public_profile_stats(text) to anon, authenticated;

comment on function public.get_public_profile_stats(text) is
  'Returns public aggregate likes and podium counts for one player without exposing account identifiers.';
