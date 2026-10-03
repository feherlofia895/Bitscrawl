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
    select 1
    from public.monthly_challenges challenge
    where challenge.id = target_challenge_id
      and clock_timestamp() >= challenge.starts_at
      and clock_timestamp() < challenge.ends_at
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

comment on function private.save_monthly_entry(bigint, jsonb) is
  'Allows new or unsubmitted monthly entries until challenge end; submitted entries remain editable only until submission_ends_at.';
comment on function private.submit_monthly_entry(bigint) is
  'Allows a valid unsubmitted monthly entry to be submitted until challenge end.';
