do $$
declare
  updated_rows integer;
begin
  update private.weekly_score_awards award
  set
    entry_points = 1,
    vote_points = 0,
    bonus_points = 0,
    placement = null,
    excluded_at = null,
    exclusion_reason = null
  from public.profiles profile, public.weekly_challenges challenge
  where profile.user_id = award.user_id
    and challenge.id = award.challenge_id
    and lower(profile.display_name) = 'martinteteme'
    and challenge.week_key = '2026-W38'
    and challenge.prompt = 'Gomba'
    and award.excluded_at is not null;

  get diagnostics updated_rows = row_count;

  if updated_rows > 1 then
    raise exception 'Expected at most one martinteteme award, restored %', updated_rows;
  end if;
end;
$$;
