do $$
declare
  target_challenge_id bigint;
  related_row_count bigint;
  changed_rows integer;
begin
  update public.weekly_challenges
  set ends_at = ('2026-10-04 22:00:00 Europe/Budapest')::timestamptz
  where week_key = '2026-W40'
    and prompt = 'Boszorkány'
    and finalized_at is null;

  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'EXPECTED_ONE_OPEN_WITCH_CHALLENGE_UPDATED_%', changed_rows;
  end if;

  select challenge.id
  into target_challenge_id
  from public.weekly_challenges challenge
  where challenge.week_key = '2026-W41';

  if target_challenge_id is null then
    insert into public.weekly_challenges (
      week_key,
      prompt,
      description,
      starts_at,
      ends_at
    ) values (
      '2026-W41',
      'Szellem',
      'Készíts egy 32×32 pixeles szellem témájú rajzot a Bitscrawl 32 színű bővített palettájával.',
      ('2026-10-05 00:00:00 Europe/Budapest')::timestamptz,
      ('2026-10-11 20:00:00 Europe/Budapest')::timestamptz
    );
  else
    select
      (select count(*) from public.weekly_drafts draft
        where draft.challenge_id = target_challenge_id)
      + (select count(*) from public.weekly_entries entry
        where entry.challenge_id = target_challenge_id)
      + (select count(*) from public.weekly_votes vote
        where vote.challenge_id = target_challenge_id)
    into related_row_count;

    if related_row_count > 0 then
      raise exception 'WEEKLY_W41_HAS_USER_DATA';
    end if;

    update public.weekly_challenges
    set prompt = 'Szellem',
        description = 'Készíts egy 32×32 pixeles szellem témájú rajzot a Bitscrawl 32 színű bővített palettájával.'
    where id = target_challenge_id;
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
    'Gomba', 'Polip', 'Vulkán', 'Szellem',
    'Kastély', 'Macska', 'Hőlégballon', 'Tengeralattjáró'
  ];
  chosen_prompt text;
begin
  starts_local := date_trunc('week', local_now);

  if local_now >= starts_local + interval '6 days 20 hours' then
    starts_local := starts_local + interval '7 days';
  end if;

  if exists (
    select 1
    from public.weekly_challenges challenge
    where challenge.starts_at <= clock_timestamp()
      and challenge.ends_at > clock_timestamp()
  ) then
    return;
  end if;

  current_week_key := to_char(starts_local, 'IYYY-"W"IW');
  chosen_prompt := prompts[1 + mod(
    extract(isoyear from starts_local)::integer * 53
      + extract(week from starts_local)::integer,
    array_length(prompts, 1)
  )];

  insert into public.weekly_challenges (
    week_key,
    prompt,
    description,
    starts_at,
    ends_at
  ) values (
    current_week_key,
    chosen_prompt,
    format(
      'Készíts egy 32×32 pixeles %s témájú rajzot a Bitscrawl 32 színű bővített palettájával.',
      lower(chosen_prompt)
    ),
    starts_local at time zone 'Europe/Budapest',
    (starts_local + interval '6 days 20 hours') at time zone 'Europe/Budapest'
  )
  on conflict (week_key) do nothing;
end;
$$;

comment on function private.ensure_weekly_challenge() is
  'Creates the current or next weekly challenge from the reviewed visual prompt rotation.';
