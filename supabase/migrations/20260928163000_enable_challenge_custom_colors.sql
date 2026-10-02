alter table public.weekly_drafts
  drop constraint weekly_drafts_palette,
  add constraint weekly_drafts_palette
    check (palette_id in ('base-12-v1', 'editor-32-v1', 'custom-v1'));

alter table public.weekly_entries
  drop constraint weekly_entries_palette,
  add constraint weekly_entries_palette
    check (palette_id in ('base-12-v1', 'editor-32-v1', 'custom-v1'));

alter table public.monthly_entries
  drop constraint monthly_entries_palette,
  add constraint monthly_entries_palette
    check (palette_id in ('base-12-v1', 'editor-32-v1', 'custom-v1'));

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
          or not (
            pixel.value #>> '{}' = 'transparent'
            or pixel.value #>> '{}' ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
          )
      )
  end;
$$;

create or replace function private.challenge_palette_id(candidate jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from jsonb_array_elements_text(candidate) as pixel(value)
      where pixel.value <> 'transparent'
        and (
          char_length(pixel.value) = 9
          or lower(pixel.value) not in (
            '#f7f3e8', '#d8cfbd', '#999ea1', '#66707a', '#3f4650', '#242630', '#230a19', '#0f111a',
            '#7d2d3b', '#d3493b', '#f25c54', '#da7149', '#e29958', '#f2b35d', '#f5e57a', '#fff1a8',
            '#4d5b32', '#718441', '#a5d967', '#d4eb7a', '#2e6b4f', '#67ba62', '#549d8c', '#79cbb8',
            '#1e4957', '#347f8c', '#33567e', '#4b79b8', '#221a5f', '#51439a', '#8d5a9f', '#c57ca8'
          )
        )
    ) then 'custom-v1'
    when exists (
      select 1
      from jsonb_array_elements_text(candidate) as pixel(value)
      where lower(pixel.value) not in (
        'transparent', '#d3493b', '#e29958', '#f5e57a', '#a5d967', '#67ba62', '#549d8c',
        '#347f8c', '#33567e', '#51439a', '#999ea1', '#242630', '#230a19'
      )
    ) then 'editor-32-v1'
    else 'base-12-v1'
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
  selected_palette_id text;
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

  selected_palette_id := private.challenge_palette_id(drawing_pixels);
  insert into public.weekly_drafts (challenge_id, user_id, pixels, palette_id, updated_at)
  values (target_challenge_id, current_user_id, drawing_pixels, selected_palette_id, saved_at)
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
  selected_palette_id text;
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

  selected_palette_id := private.challenge_palette_id(drawing_pixels);
  insert into public.weekly_entries (challenge_id, user_id, pixels, palette_id)
  values (target_challenge_id, current_user_id, drawing_pixels, selected_palette_id)
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

create or replace function private.save_monthly_entry(target_challenge_id bigint, drawing_pixels jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  saved_entry_id bigint;
  challenge_start timestamptz;
  challenge_edit_cutoff timestamptz;
  challenge_end timestamptz;
  existing_submission timestamptz;
  selected_palette_id text;
begin
  select challenge.starts_at, challenge.submission_ends_at, challenge.ends_at
  into challenge_start, challenge_edit_cutoff, challenge_end
  from public.monthly_challenges challenge
  where challenge.id = target_challenge_id;

  if challenge_start is null
    or clock_timestamp() < challenge_start
    or clock_timestamp() >= challenge_end
  then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;

  select entry.submitted_at
  into existing_submission
  from public.monthly_entries entry
  where entry.challenge_id = target_challenge_id
    and entry.user_id = current_user_id
  for update;

  if existing_submission is not null and clock_timestamp() >= challenge_edit_cutoff then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;
  if not private.weekly_pixels_valid(drawing_pixels) then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_INVALID';
  end if;
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  selected_palette_id := private.challenge_palette_id(drawing_pixels);
  insert into public.monthly_entries (challenge_id, user_id, pixels, palette_id)
  values (target_challenge_id, current_user_id, drawing_pixels, selected_palette_id)
  on conflict (challenge_id, user_id) do update
    set pixels = excluded.pixels,
      palette_id = excluded.palette_id,
      updated_at = clock_timestamp()
  returning id into saved_entry_id;
  return saved_entry_id;
end;
$$;

revoke all on function private.challenge_palette_id(jsonb) from public, anon, authenticated;

comment on function private.weekly_pixels_valid(jsonb) is
  'Validates 32 by 32 weekly and monthly drawings with transparent, RGB, or RGBA hex pixels.';
comment on function private.challenge_palette_id(jsonb) is
  'Classifies valid challenge pixels as base-12-v1, editor-32-v1, or custom-v1.';
comment on column public.weekly_drafts.palette_id is
  'Palette class used by a weekly draft: base-12-v1, editor-32-v1, or custom-v1.';
comment on column public.weekly_entries.palette_id is
  'Palette class used by a weekly submission: base-12-v1, editor-32-v1, or custom-v1.';
comment on column public.monthly_entries.palette_id is
  'Palette class used by a monthly submission: base-12-v1, editor-32-v1, or custom-v1.';
