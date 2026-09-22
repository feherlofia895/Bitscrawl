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
            'transparent', '#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967',
            '#67ba62', '#549d8c', '#33567e', '#221a5f', '#999ea1', '#242630', '#230a19'
          )
      )
  end;
$$;

create or replace function private.profile_avatar_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when candidate is null then true
    when jsonb_typeof(candidate) <> 'array' then false
    else jsonb_array_length(candidate) = 1024
      and not exists (
        select 1
        from jsonb_array_elements(candidate) as pixel(value)
        where jsonb_typeof(pixel.value) <> 'string'
          or (pixel.value #>> '{}') not in (
            'transparent', '#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967',
            '#67ba62', '#549d8c', '#33567e', '#221a5f', '#999ea1', '#242630', '#230a19'
          )
      )
  end;
$$;

create or replace function private.set_monthly_vote(target_entry_id bigint, vote_enabled boolean)
returns table (voted boolean, active_vote_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  target_challenge_id bigint;
  entry_owner_id uuid;
  vote_count integer;
  vote_is_active boolean;
begin
  select e.challenge_id, e.user_id
  into target_challenge_id, entry_owner_id
  from public.monthly_entries as e
  where e.id = target_entry_id
    and e.submitted_at is not null
    and e.excluded_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'MONTHLY_ENTRY_NOT_FOUND';
  end if;
  if private.monthly_challenge_status(target_challenge_id) <> 'voting' then
    raise exception using errcode = 'P0001', message = 'MONTHLY_VOTING_CLOSED';
  end if;
  if entry_owner_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'MONTHLY_OWN_VOTE_FORBIDDEN';
  end if;

  perform 1
  from public.profiles as p
  where p.user_id = current_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if vote_enabled then
    if not exists (
      select 1 from public.monthly_votes as v
      where v.entry_id = target_entry_id and v.voter_user_id = current_user_id
    ) and (
      select count(*) from public.monthly_votes as v
      where v.challenge_id = target_challenge_id and v.voter_user_id = current_user_id
    ) >= 3 then
      raise exception using errcode = 'P0001', message = 'MONTHLY_VOTE_LIMIT';
    end if;

    insert into public.monthly_votes (challenge_id, entry_id, voter_user_id)
    values (target_challenge_id, target_entry_id, current_user_id)
    on conflict (entry_id, voter_user_id) do nothing;
  else
    delete from public.monthly_votes
    where entry_id = target_entry_id and voter_user_id = current_user_id;
  end if;

  select exists (
    select 1 from public.monthly_votes as v
    where v.entry_id = target_entry_id and v.voter_user_id = current_user_id
  ) into vote_is_active;

  select count(*)::integer
  into vote_count
  from public.monthly_votes as v
  where v.challenge_id = target_challenge_id and v.voter_user_id = current_user_id;

  return query select vote_is_active, vote_count;
end;
$$;

revoke all on function private.weekly_pixels_valid(jsonb) from public, anon, authenticated;
revoke all on function private.profile_avatar_pixels_valid(jsonb) from public, anon, authenticated;
revoke all on function private.set_monthly_vote(bigint, boolean) from public, anon;
grant execute on function private.set_monthly_vote(bigint, boolean) to authenticated;

insert into public.weekly_challenges (week_key, prompt, description, starts_at, ends_at)
values (
  '2026-W38',
  'Gomba',
  'Készíts egy 32×32 pixeles gomba témájú rajzot a Bitscrawl tizenkét színű palettájával.',
  ('2026-09-14 00:00:00 Europe/Budapest')::timestamptz,
  ('2026-09-27 23:59:59 Europe/Budapest')::timestamptz
)
on conflict (week_key) do update
set prompt = excluded.prompt,
    description = excluded.description,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at;

create or replace function private.ensure_weekly_challenge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  starts_local timestamp := date_trunc('week', clock_timestamp() at time zone 'Europe/Budapest');
  current_week_key text;
  prompts text[] := array[
    'Sárkány', 'Világítótorony', 'Űrhajó', 'Gombaház',
    'Gomba', 'Polip', 'Vulkán', 'Robot',
    'Kastély', 'Macska', 'Hőlégballon', 'Tengeralattjáró'
  ];
  chosen_prompt text;
begin
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
    (starts_local + interval '7 days') at time zone 'Europe/Budapest'
  )
  on conflict (week_key) do nothing;
end;
$$;

revoke all on function private.ensure_weekly_challenge() from public;
grant execute on function private.ensure_weekly_challenge() to anon, authenticated;

create or replace function private.add_gallery_comment(target_kind text, target_entry_id bigint, requested_content text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  clean_content text := regexp_replace(btrim(coalesce(requested_content, '')), '[[:space:]]+', ' ', 'g');
  saved_comment_id bigint;
begin
  if char_length(clean_content) not between 1 and 280 then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_INVALID';
  end if;

  perform 1
  from public.profiles as p
  where p.user_id = current_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
  if target_kind = 'weekly' then
    if not exists (
      select 1 from public.weekly_entries as e
      where e.id = target_entry_id and e.excluded_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'WEEKLY_ENTRY_NOT_FOUND';
    end if;
  elsif target_kind = 'monthly' then
    if not exists (
      select 1
      from public.monthly_entries as e
      join public.monthly_challenges as c on c.id = e.challenge_id
      where e.id = target_entry_id
        and e.submitted_at is not null
        and e.excluded_at is null
        and clock_timestamp() >= c.voting_starts_at
    ) then
      raise exception using errcode = 'P0001', message = 'MONTHLY_ENTRY_NOT_FOUND';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'GALLERY_KIND_INVALID';
  end if;

  if exists (
    select 1
    from public.gallery_comments as c
    where c.user_id = current_user_id
      and c.created_at > clock_timestamp() - interval '2 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'GALLERY_COMMENT_RATE_LIMIT';
  end if;

  if target_kind = 'weekly' then
    insert into public.gallery_comments (user_id, weekly_entry_id, content)
    values (current_user_id, target_entry_id, clean_content)
    returning id into saved_comment_id;
  else
    insert into public.gallery_comments (user_id, monthly_entry_id, content)
    values (current_user_id, target_entry_id, clean_content)
    returning id into saved_comment_id;
  end if;

  return saved_comment_id;
end;
$$;

revoke all on function private.add_gallery_comment(text, bigint, text) from public, anon;
grant execute on function private.add_gallery_comment(text, bigint, text) to authenticated;
