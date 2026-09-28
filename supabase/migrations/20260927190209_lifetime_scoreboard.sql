alter table public.weekly_challenges
  add column finalized_at timestamptz;

create table private.weekly_score_awards (
  challenge_id bigint not null references public.weekly_challenges(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote_points integer not null,
  bonus_points integer not null default 0,
  placement smallint,
  awarded_at timestamptz not null default clock_timestamp(),
  primary key (challenge_id, user_id),
  constraint weekly_score_awards_vote_points_nonnegative check (vote_points >= 0),
  constraint weekly_score_awards_bonus_points_nonnegative check (bonus_points >= 0),
  constraint weekly_score_awards_placement_range check (placement is null or placement between 1 and 3)
);

create index weekly_score_awards_user_idx
  on private.weekly_score_awards (user_id, awarded_at desc);

revoke all on table private.weekly_score_awards from public, anon, authenticated;

create function private.finalize_weekly_challenge(target_challenge_id bigint)
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
  current_finalized_at timestamptz;
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  select challenge.finalized_at
  into current_finalized_at
  from public.weekly_challenges challenge
  where challenge.id = target_challenge_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_CHALLENGE_NOT_FOUND';
  end if;

  if current_finalized_at is not null then
    return query
    select
      target_challenge_id,
      count(*)::integer,
      coalesce(sum(award.vote_points), 0)::bigint,
      true
    from private.weekly_score_awards award
    where award.challenge_id = target_challenge_id;
    return;
  end if;

  update public.weekly_challenges challenge
  set
    ends_at = least(challenge.ends_at, clock_timestamp()),
    finalized_at = clock_timestamp()
  where challenge.id = target_challenge_id;

  with vote_totals as (
    select
      entry.user_id,
      count(vote.entry_id)::integer as vote_points
    from public.weekly_entries entry
    left join public.weekly_votes vote
      on vote.challenge_id = entry.challenge_id
      and vote.entry_id = entry.id
    where entry.challenge_id = target_challenge_id
      and entry.excluded_at is null
    group by entry.user_id
  ), ranked as (
    select
      totals.user_id,
      totals.vote_points,
      rank() over (order by totals.vote_points desc) as placement
    from vote_totals totals
  )
  insert into private.weekly_score_awards (
    challenge_id,
    user_id,
    vote_points,
    bonus_points,
    placement
  )
  select
    target_challenge_id,
    ranked.user_id,
    ranked.vote_points,
    0,
    case
      when ranked.vote_points > 0 and ranked.placement <= 3 then ranked.placement::smallint
      else null
    end
  from ranked;

  return query
  select
    target_challenge_id,
    count(*)::integer,
    coalesce(sum(award.vote_points), 0)::bigint,
    false
  from private.weekly_score_awards award
  where award.challenge_id = target_challenge_id;
end;
$$;

create function public.finalize_weekly_challenge(target_challenge_id bigint)
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
  select * from private.finalize_weekly_challenge(target_challenge_id)
$$;

create function private.get_lifetime_scoreboard(requested_limit integer default 100)
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
    group by profile.user_id, profile.display_name, profile.avatar_pixels
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

create function public.get_lifetime_scoreboard(requested_limit integer default 100)
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
security invoker
set search_path = ''
as $$
  select * from private.get_lifetime_scoreboard(requested_limit)
$$;

grant usage on schema private to anon, authenticated;

revoke all on function private.finalize_weekly_challenge(bigint) from public, anon;
grant execute on function private.finalize_weekly_challenge(bigint) to authenticated;
revoke all on function public.finalize_weekly_challenge(bigint) from public, anon;
grant execute on function public.finalize_weekly_challenge(bigint) to authenticated;

revoke all on function private.get_lifetime_scoreboard(integer) from public;
grant execute on function private.get_lifetime_scoreboard(integer) to anon, authenticated;
revoke all on function public.get_lifetime_scoreboard(integer) from public;
grant execute on function public.get_lifetime_scoreboard(integer) to anon, authenticated;

comment on table private.weekly_score_awards is
  'Immutable, idempotent weekly challenge point awards used by the lifetime scoreboard.';
comment on function public.finalize_weekly_challenge(bigint) is
  'Admin-only atomic weekly close: freezes voting and records one point per received vote exactly once.';
comment on function public.get_lifetime_scoreboard(integer) is
  'Returns the public lifetime weekly-challenge scoreboard without exposing account identifiers.';
