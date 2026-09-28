alter table public.monthly_challenges
  add column finalized_at timestamptz;

create table private.monthly_score_awards (
  challenge_id bigint not null references public.monthly_challenges(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_points integer not null default 1,
  vote_points integer not null,
  bonus_points integer not null default 0,
  placement smallint,
  awarded_at timestamptz not null default clock_timestamp(),
  excluded_at timestamptz,
  exclusion_reason text,
  primary key (challenge_id, user_id),
  constraint monthly_score_awards_entry_points_one check (entry_points = 1),
  constraint monthly_score_awards_vote_points_nonnegative check (vote_points >= 0),
  constraint monthly_score_awards_bonus_points_nonnegative check (bonus_points >= 0),
  constraint monthly_score_awards_placement_range check (placement is null or placement between 1 and 3),
  constraint monthly_score_awards_exclusion_reason_length
    check (exclusion_reason is null or char_length(exclusion_reason) between 1 and 200),
  constraint monthly_score_awards_exclusion_consistent check (
    (excluded_at is null and exclusion_reason is null)
    or (excluded_at is not null and exclusion_reason is not null)
  )
);

create index monthly_score_awards_user_idx
  on private.monthly_score_awards (user_id, awarded_at desc);

create index monthly_score_awards_podium_idx
  on private.monthly_score_awards (challenge_id, placement)
  where excluded_at is null and placement is not null;

revoke all on table private.monthly_score_awards from public, anon, authenticated;

create function private.recalculate_monthly_score_placements(target_challenge_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.monthly_score_awards award
  set placement = null
  where award.challenge_id = target_challenge_id;

  with ranked as (
    select
      award.user_id,
      award.vote_points,
      rank() over (order by award.vote_points desc) as new_placement
    from private.monthly_score_awards award
    where award.challenge_id = target_challenge_id
      and award.excluded_at is null
  )
  update private.monthly_score_awards award
  set placement = case
    when ranked.vote_points > 0 and ranked.new_placement <= 3
      then ranked.new_placement::smallint
    else null
  end
  from ranked
  where award.challenge_id = target_challenge_id
    and award.user_id = ranked.user_id;
end;
$$;

create function private.finalize_monthly_challenge(target_challenge_id bigint)
returns table (
  challenge_id bigint,
  awards_count integer,
  total_vote_points bigint,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_ends_at timestamptz;
  current_finalized_at timestamptz;
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  select challenge.ends_at, challenge.finalized_at
  into current_ends_at, current_finalized_at
  from public.monthly_challenges challenge
  where challenge.id = target_challenge_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MONTHLY_CHALLENGE_NOT_FOUND';
  end if;

  if current_finalized_at is not null then
    return query
    select
      target_challenge_id,
      count(*)::integer,
      coalesce(sum(award.vote_points), 0)::bigint,
      true
    from private.monthly_score_awards award
    where award.challenge_id = target_challenge_id;
    return;
  end if;

  if clock_timestamp() < current_ends_at then
    raise exception using errcode = 'P0001', message = 'MONTHLY_CHALLENGE_ACTIVE';
  end if;

  update public.monthly_challenges challenge
  set finalized_at = clock_timestamp()
  where challenge.id = target_challenge_id;

  with vote_totals as (
    select
      entry.user_id,
      count(vote.entry_id)::integer as vote_points
    from public.monthly_entries entry
    left join public.monthly_votes vote
      on vote.challenge_id = entry.challenge_id
      and vote.entry_id = entry.id
    where entry.challenge_id = target_challenge_id
      and entry.submitted_at is not null
      and entry.excluded_at is null
    group by entry.user_id
  )
  insert into private.monthly_score_awards (
    challenge_id,
    user_id,
    entry_points,
    vote_points,
    bonus_points,
    placement
  )
  select
    target_challenge_id,
    totals.user_id,
    1,
    totals.vote_points,
    0,
    null
  from vote_totals totals;

  perform private.recalculate_monthly_score_placements(target_challenge_id);

  return query
  select
    target_challenge_id,
    count(*)::integer,
    coalesce(sum(award.vote_points), 0)::bigint,
    false
  from private.monthly_score_awards award
  where award.challenge_id = target_challenge_id;
end;
$$;

create function public.finalize_monthly_challenge(target_challenge_id bigint)
returns table (
  challenge_id bigint,
  awards_count integer,
  total_vote_points bigint,
  already_finalized boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.finalize_monthly_challenge(target_challenge_id)
$$;

create or replace function private.get_lifetime_scoreboard(requested_limit integer default 100)
returns table (
  score_rank bigint,
  display_name text,
  avatar_pixels jsonb,
  total_points bigint,
  vote_points bigint,
  bonus_points bigint,
  gold_count bigint,
  silver_count bigint,
  bronze_count bigint,
  challenges_entered bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with all_awards as (
    select
      award.user_id,
      award.entry_points,
      award.vote_points,
      award.bonus_points,
      award.placement
    from private.weekly_score_awards award
    where award.excluded_at is null
    union all
    select
      award.user_id,
      award.entry_points,
      award.vote_points,
      award.bonus_points,
      award.placement
    from private.monthly_score_awards award
    where award.excluded_at is null
  ), profile_scores as (
    select
      profile.user_id,
      profile.display_name,
      profile.avatar_pixels,
      sum(award.entry_points + award.vote_points + award.bonus_points)::bigint as total_points,
      sum(award.vote_points)::bigint as vote_points,
      sum(award.bonus_points)::bigint as bonus_points,
      count(*) filter (where award.placement = 1)::bigint as gold_count,
      count(*) filter (where award.placement = 2)::bigint as silver_count,
      count(*) filter (where award.placement = 3)::bigint as bronze_count,
      count(*)::bigint as challenges_entered
    from all_awards award
    join public.profiles profile on profile.user_id = award.user_id
    group by profile.user_id, profile.display_name, profile.avatar_pixels
    having sum(award.entry_points + award.vote_points + award.bonus_points) > 0
  ), ranked_scores as (
    select
      dense_rank() over (order by score.total_points desc) as score_rank,
      score.*
    from profile_scores score
  )
  select
    score.score_rank,
    score.display_name,
    score.avatar_pixels,
    score.total_points,
    score.vote_points,
    score.bonus_points,
    score.gold_count,
    score.silver_count,
    score.bronze_count,
    score.challenges_entered
  from ranked_scores score
  order by
    score.total_points desc,
    score.gold_count desc,
    score.silver_count desc,
    score.bronze_count desc,
    lower(score.display_name)
  limit least(greatest(coalesce(requested_limit, 100), 1), 100);
$$;

create function private.get_challenge_hall_of_fame(requested_limit integer default 30)
returns table (
  challenge_kind text,
  period_key text,
  challenge_prompt text,
  placement smallint,
  display_name text,
  avatar_pixels jsonb,
  points bigint,
  awarded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with podiums as (
    select
      'weekly'::text as challenge_kind,
      challenge.week_key as period_key,
      challenge.prompt as challenge_prompt,
      challenge.ends_at,
      award.placement,
      profile.display_name,
      profile.avatar_pixels,
      (award.entry_points + award.vote_points + award.bonus_points)::bigint as points,
      award.awarded_at
    from private.weekly_score_awards award
    join public.weekly_challenges challenge on challenge.id = award.challenge_id
    join public.profiles profile on profile.user_id = award.user_id
    where award.excluded_at is null
      and award.placement between 1 and 3
    union all
    select
      'monthly'::text,
      challenge.month_key,
      challenge.prompt,
      challenge.ends_at,
      award.placement,
      profile.display_name,
      profile.avatar_pixels,
      (award.entry_points + award.vote_points + award.bonus_points)::bigint,
      award.awarded_at
    from private.monthly_score_awards award
    join public.monthly_challenges challenge on challenge.id = award.challenge_id
    join public.profiles profile on profile.user_id = award.user_id
    where award.excluded_at is null
      and award.placement between 1 and 3
  )
  select
    podium.challenge_kind,
    podium.period_key,
    podium.challenge_prompt,
    podium.placement,
    podium.display_name,
    podium.avatar_pixels,
    podium.points,
    podium.awarded_at
  from podiums podium
  order by podium.ends_at desc, podium.placement, lower(podium.display_name)
  limit least(greatest(coalesce(requested_limit, 30), 1), 100);
$$;

create function public.get_challenge_hall_of_fame(requested_limit integer default 30)
returns table (
  challenge_kind text,
  period_key text,
  challenge_prompt text,
  placement smallint,
  display_name text,
  avatar_pixels jsonb,
  points bigint,
  awarded_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_challenge_hall_of_fame(requested_limit)
$$;

create or replace function private.get_monthly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  updated_at timestamptz,
  vote_count bigint,
  has_voted boolean,
  is_own boolean,
  is_winner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with challenge as (
    select monthly_challenge.id
    from public.monthly_challenges monthly_challenge
    where monthly_challenge.id = target_challenge_id
  ), entries_with_votes as (
    select
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.updated_at,
      profile.display_name,
      profile.avatar_pixels,
      count(vote.entry_id)::bigint as votes
    from public.monthly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    left join public.monthly_votes vote on vote.entry_id = entry.id
    cross join challenge
    where entry.challenge_id = target_challenge_id
      and entry.submitted_at is not null
      and entry.excluded_at is null
    group by
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.updated_at,
      profile.display_name,
      profile.avatar_pixels
  )
  select
    entry.id,
    entry.display_name,
    entry.avatar_pixels,
    entry.pixels,
    entry.updated_at,
    entry.votes,
    exists (
      select 1
      from public.monthly_votes own_vote
      where own_vote.entry_id = entry.id
        and own_vote.voter_user_id = auth.uid()
    ),
    entry.user_id = auth.uid(),
    exists (
      select 1
      from private.monthly_score_awards award
      join public.monthly_challenges monthly_challenge
        on monthly_challenge.id = award.challenge_id
      where award.challenge_id = target_challenge_id
        and award.user_id = entry.user_id
        and award.excluded_at is null
        and award.placement = 1
        and monthly_challenge.finalized_at is not null
    )
  from entries_with_votes entry;
$$;

create or replace function private.get_monthly_gallery_page(
  target_challenge_id bigint,
  requested_sort text,
  discovery_seed bigint,
  requested_limit integer,
  requested_offset integer
)
returns table (
  entry_id bigint,
  author_name text,
  author_avatar jsonb,
  pixels jsonb,
  updated_at timestamptz,
  vote_count bigint,
  comment_count integer,
  has_voted boolean,
  is_own boolean,
  is_winner boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_sort text := coalesce(requested_sort, 'likes');
  safe_seed bigint := coalesce(discovery_seed, 0);
  safe_limit integer := least(greatest(coalesce(requested_limit, 6), 1), 6);
  safe_offset integer := greatest(coalesce(requested_offset, 0), 0);
begin
  if safe_sort not in ('likes', 'discovery', 'newest') then
    raise exception using errcode = 'P0001', message = 'GALLERY_SORT_INVALID';
  end if;

  return query
  with challenge as (
    select monthly_challenge.id
    from public.monthly_challenges monthly_challenge
    where monthly_challenge.id = target_challenge_id
  ), entries_with_votes as (
    select
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.updated_at,
      profile.display_name,
      profile.avatar_pixels,
      count(vote.entry_id)::bigint as votes
    from public.monthly_entries entry
    join public.profiles profile on profile.user_id = entry.user_id
    left join public.monthly_votes vote on vote.entry_id = entry.id
    cross join challenge
    where entry.challenge_id = target_challenge_id
      and entry.submitted_at is not null
      and entry.excluded_at is null
    group by
      entry.id,
      entry.user_id,
      entry.pixels,
      entry.updated_at,
      profile.display_name,
      profile.avatar_pixels
  ), prepared as (
    select
      entry.*,
      count(*) over () as all_entries
    from entries_with_votes entry
  )
  select
    entry.id,
    entry.display_name,
    entry.avatar_pixels,
    entry.pixels,
    entry.updated_at,
    entry.votes,
    (
      select count(*)::integer
      from public.gallery_comments comment_row
      where comment_row.monthly_entry_id = entry.id
    ),
    exists (
      select 1
      from public.monthly_votes own_vote
      where own_vote.entry_id = entry.id
        and own_vote.voter_user_id = auth.uid()
    ),
    entry.user_id = auth.uid(),
    exists (
      select 1
      from private.monthly_score_awards award
      join public.monthly_challenges monthly_challenge
        on monthly_challenge.id = award.challenge_id
      where award.challenge_id = target_challenge_id
        and award.user_id = entry.user_id
        and award.excluded_at is null
        and award.placement = 1
        and monthly_challenge.finalized_at is not null
    ),
    entry.all_entries
  from prepared entry
  order by
    case when safe_sort = 'likes' then entry.votes end desc,
    case when safe_sort = 'likes' then entry.updated_at end desc,
    case when safe_sort = 'newest' then entry.updated_at end desc,
    case when safe_sort = 'discovery' then md5(entry.id::text || ':' || safe_seed::text) end,
    entry.id desc
  limit safe_limit
  offset safe_offset;
end;
$$;

create or replace function private.moderate_delete_content(target_kind text, target_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_id bigint;
  affected_challenge_id bigint;
  affected_user_id uuid;
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
      select entry.challenge_id, entry.user_id
      into affected_challenge_id, affected_user_id
      from public.weekly_entries entry
      where entry.id = target_id;

      if not found then
        raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
      end if;

      perform 1
      from public.weekly_challenges challenge
      where challenge.id = affected_challenge_id
      for update;

      update public.weekly_entries entry
      set excluded_at = coalesce(entry.excluded_at, clock_timestamp())
      where entry.id = target_id
      returning entry.id into affected_id;

      update private.weekly_score_awards award
      set
        excluded_at = coalesce(award.excluded_at, clock_timestamp()),
        exclusion_reason = coalesce(
          award.exclusion_reason,
          'Moderált heti nevezés miatt érvénytelenített eredmény.'
        ),
        placement = null
      where award.challenge_id = affected_challenge_id
        and award.user_id = affected_user_id;

      perform private.recalculate_weekly_score_placements(affected_challenge_id);
    when 'monthly-entry' then
      select entry.challenge_id, entry.user_id
      into affected_challenge_id, affected_user_id
      from public.monthly_entries entry
      where entry.id = target_id;

      if not found then
        raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
      end if;

      perform 1
      from public.monthly_challenges challenge
      where challenge.id = affected_challenge_id
      for update;

      update public.monthly_entries entry
      set excluded_at = coalesce(entry.excluded_at, clock_timestamp())
      where entry.id = target_id
      returning entry.id into affected_id;

      update private.monthly_score_awards award
      set
        excluded_at = coalesce(award.excluded_at, clock_timestamp()),
        exclusion_reason = coalesce(
          award.exclusion_reason,
          'Moderált havi nevezés miatt érvénytelenített eredmény.'
        ),
        placement = null
      where award.challenge_id = affected_challenge_id
        and award.user_id = affected_user_id;

      perform private.recalculate_monthly_score_placements(affected_challenge_id);
    when 'feed-comment' then
      delete from public.feed_comments comment_row
      where comment_row.id = target_id
      returning comment_row.id into affected_id;
    when 'gallery-comment' then
      delete from public.gallery_comments comment_row
      where comment_row.id = target_id
      returning comment_row.id into affected_id;
    else
      raise exception using errcode = 'P0001', message = 'MODERATION_KIND_INVALID';
  end case;

  if affected_id is null then
    raise exception using errcode = 'P0001', message = 'MODERATION_TARGET_NOT_FOUND';
  end if;

  return true;
end;
$$;

create or replace function public.get_public_profile_stats(target_profile_name text)
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
$$;

revoke all on function private.recalculate_monthly_score_placements(bigint)
  from public, anon, authenticated;

revoke all on function private.finalize_monthly_challenge(bigint) from public, anon;
grant execute on function private.finalize_monthly_challenge(bigint) to authenticated;
revoke all on function public.finalize_monthly_challenge(bigint) from public, anon;
grant execute on function public.finalize_monthly_challenge(bigint) to authenticated;

revoke all on function private.get_challenge_hall_of_fame(integer) from public;
grant execute on function private.get_challenge_hall_of_fame(integer) to anon, authenticated;
revoke all on function public.get_challenge_hall_of_fame(integer) from public;
grant execute on function public.get_challenge_hall_of_fame(integer) to anon, authenticated;

revoke all on function private.get_monthly_gallery(bigint) from public;
grant execute on function private.get_monthly_gallery(bigint) to anon, authenticated;
revoke all on function private.get_monthly_gallery_page(bigint, text, bigint, integer, integer) from public;
grant execute on function private.get_monthly_gallery_page(bigint, text, bigint, integer, integer)
  to anon, authenticated;

revoke all on function private.moderate_delete_content(text, bigint) from public, anon;
grant execute on function private.moderate_delete_content(text, bigint) to authenticated;

revoke all on function public.get_public_profile_stats(text) from public;
grant execute on function public.get_public_profile_stats(text) to anon, authenticated;

comment on table private.monthly_score_awards is
  'Idempotent monthly challenge point awards combined with weekly awards in the lifetime scoreboard.';
comment on function public.finalize_monthly_challenge(bigint) is
  'Admin-only monthly close after the challenge end: records one entry point and one point per received vote exactly once.';
comment on function public.get_lifetime_scoreboard(integer) is
  'Returns the public lifetime weekly and monthly challenge scoreboard without account identifiers.';
comment on function public.get_challenge_hall_of_fame(integer) is
  'Returns weekly and monthly podium placements without exposing account identifiers.';
