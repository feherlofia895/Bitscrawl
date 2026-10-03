alter table private.weekly_score_awards
  add column excluded_at timestamptz,
  add column exclusion_reason text,
  add constraint weekly_score_awards_exclusion_reason_length
    check (exclusion_reason is null or char_length(exclusion_reason) between 1 and 200),
  add constraint weekly_score_awards_exclusion_consistent
    check (
      (excluded_at is null and exclusion_reason is null)
      or (excluded_at is not null and exclusion_reason is not null)
    );

create index weekly_score_awards_podium_idx
  on private.weekly_score_awards (challenge_id, placement)
  where excluded_at is null and placement is not null;

create function private.recalculate_weekly_score_placements(target_challenge_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.weekly_score_awards award
  set placement = null
  where award.challenge_id = target_challenge_id;

  with ranked as (
    select
      award.user_id,
      award.vote_points,
      rank() over (order by award.vote_points desc) as new_placement
    from private.weekly_score_awards award
    where award.challenge_id = target_challenge_id
      and award.excluded_at is null
  )
  update private.weekly_score_awards award
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

revoke all on function private.recalculate_weekly_score_placements(bigint)
  from public, anon, authenticated;

do $$
declare
  corrected_challenge_id bigint;
begin
  update private.weekly_score_awards award
  set
    excluded_at = clock_timestamp(),
    exclusion_reason = 'Nem vett részt az első heti kihívás hivatalos rangsorában.'
  from public.profiles profile, public.weekly_challenges challenge
  where profile.user_id = award.user_id
    and challenge.id = award.challenge_id
    and lower(profile.display_name) = 'martinteteme'
    and challenge.week_key = '2026-W38'
    and challenge.prompt = 'Gomba'
    and award.excluded_at is null
  returning award.challenge_id into corrected_challenge_id;

  if corrected_challenge_id is not null then
    perform private.recalculate_weekly_score_placements(corrected_challenge_id);
  end if;
end;
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
  with profile_scores as (
    select
      profile.user_id,
      profile.display_name,
      profile.avatar_pixels,
      sum(award.vote_points + award.bonus_points)::bigint as total_points,
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
    having sum(award.vote_points + award.bonus_points) > 0
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

create function private.get_weekly_hall_of_fame(requested_limit integer default 30)
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
    (award.vote_points + award.bonus_points)::bigint,
    award.awarded_at
  from private.weekly_score_awards award
  join public.weekly_challenges challenge on challenge.id = award.challenge_id
  join public.profiles profile on profile.user_id = award.user_id
  where award.excluded_at is null
    and award.placement between 1 and 3
    and award.vote_points + award.bonus_points > 0
  order by challenge.ends_at desc, award.placement, lower(profile.display_name)
  limit least(greatest(coalesce(requested_limit, 30), 1), 100);
$$;

create function public.get_weekly_hall_of_fame(requested_limit integer default 30)
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
security invoker
set search_path = ''
as $$
  select * from private.get_weekly_hall_of_fame(requested_limit)
$$;

revoke all on function private.get_weekly_hall_of_fame(integer) from public;
grant execute on function private.get_weekly_hall_of_fame(integer) to anon, authenticated;
revoke all on function public.get_weekly_hall_of_fame(integer) from public;
grant execute on function public.get_weekly_hall_of_fame(integer) to anon, authenticated;

comment on column private.weekly_score_awards.excluded_at is
  'Keeps non-participating or invalid awards auditable while removing them from public ranking calculations.';
comment on function public.get_weekly_hall_of_fame(integer) is
  'Returns podium placements from finalized weekly challenges without exposing account identifiers.';
