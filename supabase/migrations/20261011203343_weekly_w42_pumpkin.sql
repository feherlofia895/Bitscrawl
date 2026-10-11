update public.weekly_challenges
set prompt = 'Tök',
    description = 'Készíts egy 32×32 pixeles tök témájú rajzot a Bitscrawl 32 színű bővített palettájával.'
where week_key = '2026-W42'
  and prompt = 'Kastély'
  and finalized_at is null;

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
    'Tök', 'Macska', 'Hőlégballon', 'Tengeralattjáró'
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
