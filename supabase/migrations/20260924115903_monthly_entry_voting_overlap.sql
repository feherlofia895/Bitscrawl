alter table public.monthly_challenges
  add column if not exists submission_ends_at timestamptz;

update public.monthly_challenges
set submission_ends_at = voting_starts_at;

alter table public.monthly_challenges
  alter column submission_ends_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.monthly_challenges'::regclass
      and constraint_row.conname = 'monthly_challenges_submission_time_order'
  ) then
    alter table public.monthly_challenges
      add constraint monthly_challenges_submission_time_order check (
        starts_at < submission_ends_at and submission_ends_at <= ends_at
      );
  end if;
end;
$$;

update public.monthly_challenges
set submission_ends_at = ('2026-09-25 00:00:00 Europe/Budapest')::timestamptz
where month_key = '2026-09';

create or replace function private.ensure_monthly_challenge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts_local timestamp := date_trunc('month', clock_timestamp() at time zone 'Europe/Budapest');
  ends_local timestamp := starts_local + interval '1 month';
  current_month_key text := to_char(starts_local, 'YYYY-MM');
  prompts text[] := array[
    'Béka', 'Bagoly', 'Űrállomás', 'Kalózhajó', 'Varázserdő', 'Tengeri szörny',
    'Robotváros', 'Sárkánytojás', 'Kísértetház', 'Hóember', 'Vidámpark', 'Víz alatti kastély'
  ];
  chosen_prompt text;
begin
  chosen_prompt := case when current_month_key = '2026-09' then 'Béka'
    else prompts[1 + mod(
      extract(year from starts_local)::integer * 12 + extract(month from starts_local)::integer - 1,
      array_length(prompts, 1)
    )]
  end;

  insert into public.monthly_challenges (
    month_key, prompt, description, starts_at, voting_starts_at, submission_ends_at, ends_at
  ) values (
    current_month_key,
    chosen_prompt,
    format('Készíts egy 32×32 pixeles %s témájú rajzot a Bitscrawl palettájával.', lower(chosen_prompt)),
    starts_local at time zone 'Europe/Budapest',
    (ends_local - interval '7 days') at time zone 'Europe/Budapest',
    (ends_local - interval '7 days') at time zone 'Europe/Budapest',
    ends_local at time zone 'Europe/Budapest'
  )
  on conflict (month_key) do nothing;
end;
$$;

create or replace function private.save_monthly_entry(target_challenge_id bigint, drawing_pixels jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  saved_entry_id bigint;
begin
  if not exists (
    select 1 from public.monthly_challenges challenge
    where challenge.id = target_challenge_id
      and clock_timestamp() >= challenge.starts_at
      and clock_timestamp() < challenge.submission_ends_at
  ) then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;
  if not private.weekly_pixels_valid(drawing_pixels) then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_INVALID';
  end if;
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  insert into public.monthly_entries (challenge_id, user_id, pixels)
  values (target_challenge_id, current_user_id, drawing_pixels)
  on conflict (challenge_id, user_id) do update
    set pixels = excluded.pixels, updated_at = clock_timestamp()
  returning id into saved_entry_id;
  return saved_entry_id;
end;
$$;

create or replace function private.submit_monthly_entry(target_challenge_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  submission_time timestamptz;
begin
  if not exists (
    select 1 from public.monthly_challenges challenge
    where challenge.id = target_challenge_id
      and clock_timestamp() >= challenge.starts_at
      and clock_timestamp() < challenge.submission_ends_at
  ) then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;

  update public.monthly_entries entry
  set submitted_at = coalesce(entry.submitted_at, clock_timestamp())
  where entry.challenge_id = target_challenge_id
    and entry.user_id = current_user_id
    and entry.excluded_at is null
    and private.weekly_pixels_valid(entry.pixels)
    and exists (
      select 1 from jsonb_array_elements_text(entry.pixels) pixel(value)
      where pixel.value <> 'transparent'
    )
  returning entry.submitted_at into submission_time;

  if submission_time is null then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_INVALID';
  end if;

  return submission_time;
end;
$$;

drop function public.get_monthly_challenges();

create function public.get_monthly_challenges()
returns table (
  challenge_id bigint, month_key text, prompt text, description text,
  starts_at timestamptz, voting_starts_at timestamptz, submission_ends_at timestamptz,
  ends_at timestamptz, challenge_status text, server_now timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.ensure_monthly_challenge();
  return query
  select challenge.id, challenge.month_key, challenge.prompt, challenge.description,
    challenge.starts_at, challenge.voting_starts_at, challenge.submission_ends_at, challenge.ends_at,
    private.monthly_challenge_status(challenge.id), clock_timestamp()
  from public.monthly_challenges challenge
  order by challenge.starts_at desc;
end;
$$;

revoke all on function public.get_monthly_challenges() from public;
grant execute on function public.get_monthly_challenges() to anon, authenticated;
