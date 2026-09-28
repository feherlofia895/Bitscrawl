alter table public.weekly_drafts
  drop constraint weekly_drafts_palette,
  add constraint weekly_drafts_palette
    check (palette_id in ('base-12-v1', 'editor-32-v1'));

alter table public.weekly_entries
  drop constraint weekly_entries_palette,
  add constraint weekly_entries_palette
    check (palette_id in ('base-12-v1', 'editor-32-v1'));

create or replace function private.weekly_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when candidate is null or jsonb_typeof(candidate) <> 'array' then false
    else jsonb_array_length(candidate) = 1024
      and not exists (
        select 1
        from jsonb_array_elements(candidate) as pixel(value)
        where jsonb_typeof(pixel.value) <> 'string'
          or (pixel.value #>> '{}') not in (
            'transparent',
            '#f7f3e8', '#d8cfbd', '#999ea1', '#66707a', '#3f4650', '#242630', '#230a19', '#0f111a',
            '#7d2d3b', '#d3493b', '#f25c54', '#da7149', '#e29958', '#f2b35d', '#f5e57a', '#fff1a8',
            '#4d5b32', '#718441', '#a5d967', '#d4eb7a', '#2e6b4f', '#67ba62', '#549d8c', '#79cbb8',
            '#1e4957', '#347f8c', '#33567e', '#4b79b8', '#221a5f', '#51439a', '#8d5a9f', '#c57ca8'
          )
      )
  end;
$$;

create or replace function private.save_weekly_draft(target_challenge_id bigint, drawing_pixels jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  saved_at timestamptz := clock_timestamp();
begin
  if not private.weekly_challenge_is_active(target_challenge_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_CHALLENGE_CLOSED';
  end if;
  if not private.weekly_pixels_valid(drawing_pixels) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_DRAWING_INVALID';
  end if;
  if not exists (select 1 from public.profiles as p where p.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
  if exists (
    select 1 from public.weekly_entries as e
    where e.challenge_id = target_challenge_id and e.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_ALREADY_SUBMITTED';
  end if;

  insert into public.weekly_drafts (challenge_id, user_id, pixels, palette_id, updated_at)
  values (target_challenge_id, current_user_id, drawing_pixels, 'editor-32-v1', saved_at)
  on conflict (challenge_id, user_id)
  do update set
    pixels = excluded.pixels,
    palette_id = excluded.palette_id,
    updated_at = excluded.updated_at;
  return saved_at;
end;
$$;

create or replace function private.submit_weekly_entry(target_challenge_id bigint, drawing_pixels jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  created_entry_id bigint;
begin
  if not private.weekly_challenge_is_active(target_challenge_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_CHALLENGE_CLOSED';
  end if;
  if not private.weekly_pixels_valid(drawing_pixels) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_DRAWING_INVALID';
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(drawing_pixels) as pixel(value)
    where pixel.value <> 'transparent'
  ) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_DRAWING_INVALID';
  end if;
  if not exists (select 1 from public.profiles as p where p.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  insert into public.weekly_entries (challenge_id, user_id, pixels, palette_id)
  values (target_challenge_id, current_user_id, drawing_pixels, 'editor-32-v1')
  on conflict (challenge_id, user_id) do nothing
  returning id into created_entry_id;
  if created_entry_id is null then
    raise exception using errcode = 'P0001', message = 'WEEKLY_ALREADY_SUBMITTED';
  end if;
  delete from public.weekly_drafts
  where challenge_id = target_challenge_id and user_id = current_user_id;
  return created_entry_id;
end;
$$;

update public.weekly_challenges
set description = replace(
  description,
  'Bitscrawl tizenkét színű palettájával',
  'Bitscrawl 32 színű bővített palettájával'
)
where description like '%Bitscrawl tizenkét színű palettájával%';

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
    format('Készíts egy 32×32 pixeles %s témájú rajzot a Bitscrawl 32 színű bővített palettájával.', lower(chosen_prompt)),
    starts_local at time zone 'Europe/Budapest',
    (starts_local + interval '6 days 20 hours') at time zone 'Europe/Budapest'
  )
  on conflict (week_key) do nothing;
end;
$$;

comment on function private.weekly_pixels_valid(jsonb) is
  'Validates 32 by 32 weekly drawings against the 32-color editor palette.';
comment on column public.weekly_drafts.palette_id is
  'Legacy entries use base-12-v1; new weekly drafts use editor-32-v1.';
comment on column public.weekly_entries.palette_id is
  'Legacy entries use base-12-v1; new weekly submissions use editor-32-v1.';
