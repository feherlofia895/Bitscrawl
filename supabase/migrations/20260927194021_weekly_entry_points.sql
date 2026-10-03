alter table private.weekly_score_awards
  add column entry_points integer not null default 1,
  add constraint weekly_score_awards_entry_points_one check (entry_points = 1);

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
  with profile_scores as (
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
    from private.weekly_score_awards award
    join public.profiles profile on profile.user_id = award.user_id
    where award.excluded_at is null
    group by profile.user_id, profile.display_name, profile.avatar_pixels
    having sum(award.entry_points + award.vote_points + award.bonus_points) > 0
  ), ranked_scores as (
    select
      rank() over (order by score.total_points desc) as score_rank,
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

create or replace function private.get_weekly_hall_of_fame(requested_limit integer default 30)
returns table (
  week_key text,
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
  select
    challenge.week_key,
    challenge.prompt,
    award.placement,
    profile.display_name,
    profile.avatar_pixels,
    (award.entry_points + award.vote_points + award.bonus_points)::bigint,
    award.awarded_at
  from private.weekly_score_awards award
  join public.weekly_challenges challenge on challenge.id = award.challenge_id
  join public.profiles profile on profile.user_id = award.user_id
  where award.excluded_at is null
    and award.placement between 1 and 3
  order by challenge.ends_at desc, award.placement, lower(profile.display_name)
  limit least(greatest(coalesce(requested_limit, 30), 1), 100);
$$;

comment on column private.weekly_score_awards.entry_points is
  'One participation point awarded for every eligible finalized weekly challenge entry.';
