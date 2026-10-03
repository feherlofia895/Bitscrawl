do $$
declare
  wrong_challenge_id bigint;
  target_challenge_id bigint;
  related_row_count bigint;
begin
  select c.id
  into wrong_challenge_id
  from public.weekly_challenges as c
  where c.week_key = '2026-W39'
    and c.prompt = 'Polip';

  if wrong_challenge_id is not null then
    select
      (select count(*) from public.weekly_drafts as d where d.challenge_id = wrong_challenge_id)
      + (select count(*) from public.weekly_entries as e where e.challenge_id = wrong_challenge_id)
      + (select count(*) from public.weekly_votes as v where v.challenge_id = wrong_challenge_id)
    into related_row_count;

    if related_row_count = 0 then
      delete from public.weekly_challenges
      where id = wrong_challenge_id;
    end if;
  end if;

  select c.id
  into target_challenge_id
  from public.weekly_challenges as c
  where c.week_key = '2026-W40';

  if target_challenge_id is not null then
    select
      (select count(*) from public.weekly_drafts as d where d.challenge_id = target_challenge_id)
      + (select count(*) from public.weekly_entries as e where e.challenge_id = target_challenge_id)
      + (select count(*) from public.weekly_votes as v where v.challenge_id = target_challenge_id)
    into related_row_count;

    if related_row_count > 0 then
      raise exception 'WEEKLY_W40_HAS_USER_DATA';
    end if;

    update public.weekly_challenges
    set prompt = 'Boszorkány',
        description = 'Készíts egy 32×32 pixeles boszorkány témájú rajzot a Bitscrawl tizenkét színű palettájával.',
        starts_at = ('2026-09-28 00:00:00 Europe/Budapest')::timestamptz,
        ends_at = ('2026-10-04 20:00:00 Europe/Budapest')::timestamptz,
        finalized_at = null
    where id = target_challenge_id;
  else
    insert into public.weekly_challenges (week_key, prompt, description, starts_at, ends_at)
    values (
      '2026-W40',
      'Boszorkány',
      'Készíts egy 32×32 pixeles boszorkány témájú rajzot a Bitscrawl tizenkét színű palettájával.',
      ('2026-09-28 00:00:00 Europe/Budapest')::timestamptz,
      ('2026-10-04 20:00:00 Europe/Budapest')::timestamptz
    );
  end if;
end;
$$;

create or replace function private.ensure_weekly_challenge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := clock_timestamp() at time zone 'Europe/Budapest';
  starts_local timestamp;
  current_week_key text;
  prompts text[] := array[
    'Sárkány', 'Világítótorony', 'Űrhajó', 'Gombaház',
    'Gomba', 'Polip', 'Vulkán', 'Robot',
    'Kastély', 'Macska', 'Hőlégballon', 'Tengeralattjáró'
  ];
  chosen_prompt text;
begin
  starts_local := date_trunc('week', local_now);

  -- Vasárnap 20:00 után már a következő hét kihívását készítjük elő.
  if local_now >= starts_local + interval '6 days 20 hours' then
    starts_local := starts_local + interval '7 days';
  end if;

  if exists (
    select 1
    from public.weekly_challenges as c
    where c.starts_at <= clock_timestamp() and c.ends_at > clock_timestamp()
  ) then
    return;
  end if;

  current_week_key := to_char(starts_local, 'IYYY-"W"IW');
  chosen_prompt := prompts[1 + mod(
    extract(isoyear from starts_local)::integer * 53 + extract(week from starts_local)::integer,
    array_length(prompts, 1)
  )];

  insert into public.weekly_challenges (week_key, prompt, description, starts_at, ends_at)
  values (
    current_week_key,
    chosen_prompt,
    format('Készíts egy 32×32 pixeles %s témájú rajzot a Bitscrawl tizenkét színű palettájával.', lower(chosen_prompt)),
    starts_local at time zone 'Europe/Budapest',
    (starts_local + interval '6 days 20 hours') at time zone 'Europe/Budapest'
  )
  on conflict (week_key) do nothing;
end;
$$;

revoke all on function private.ensure_weekly_challenge() from public;
grant execute on function private.ensure_weekly_challenge() to anon, authenticated;
