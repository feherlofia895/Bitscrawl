alter table public.monthly_challenges
  add column canvas_size smallint not null default 32,
  add constraint monthly_challenges_canvas_size check (canvas_size in (32, 128));

-- Preserve Vivi's already submitted snowman on the community wall before the
-- October challenge is changed. The source row makes this naturally idempotent.
insert into public.feed_posts (
  user_id,
  post_date,
  pixels,
  description,
  created_at,
  updated_at
)
select
  entry.user_id,
  (entry.submitted_at at time zone 'Europe/Budapest')::date,
  entry.pixels,
  'Hóember – a korábbi havi kihívásra készült rajz.',
  entry.submitted_at,
  entry.updated_at
from public.monthly_entries entry
join public.monthly_challenges challenge on challenge.id = entry.challenge_id
join public.profiles profile on profile.user_id = entry.user_id
where challenge.month_key = '2026-10'
  and challenge.prompt = 'Hóember'
  and profile.display_name = 'Vivi'
  and entry.submitted_at is not null
  and entry.excluded_at is null
  and jsonb_array_length(entry.pixels) = 1024
  and not exists (
    select 1
    from public.feed_posts post
    where post.user_id = entry.user_id
      and post.pixels = entry.pixels
      and post.description = 'Hóember – a korábbi havi kihívásra készült rajz.'
  );

delete from public.gallery_comments comment_row
using public.monthly_entries entry, public.monthly_challenges challenge, public.profiles profile
where comment_row.monthly_entry_id = entry.id
  and challenge.id = entry.challenge_id
  and profile.user_id = entry.user_id
  and challenge.month_key = '2026-10'
  and challenge.prompt = 'Hóember'
  and profile.display_name = 'Vivi';

delete from public.monthly_votes vote
using public.monthly_entries entry, public.monthly_challenges challenge, public.profiles profile
where vote.entry_id = entry.id
  and challenge.id = entry.challenge_id
  and profile.user_id = entry.user_id
  and challenge.month_key = '2026-10'
  and challenge.prompt = 'Hóember'
  and profile.display_name = 'Vivi';

delete from public.monthly_entries entry
using public.monthly_challenges challenge, public.profiles profile
where challenge.id = entry.challenge_id
  and profile.user_id = entry.user_id
  and challenge.month_key = '2026-10'
  and challenge.prompt = 'Hóember'
  and profile.display_name = 'Vivi';

update public.monthly_challenges challenge
set prompt = 'Halloween',
  description = 'Készíts egy 128×128 pixeles Halloween témájú rajzot a Bitscrawl palettájával.',
  canvas_size = 128
where challenge.month_key = '2026-10';

alter table public.monthly_challenges
  alter column canvas_size set default 128;

create function private.monthly_pixels_valid(candidate jsonb, expected_size integer)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when expected_size not in (32, 128)
      or candidate is null
      or jsonb_typeof(candidate) <> 'array'
    then false
    else jsonb_array_length(candidate) = expected_size * expected_size
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
    'Robotváros', 'Sárkánytojás', 'Kísértetház', 'Halloween', 'Vidámpark', 'Víz alatti kastély'
  ];
  chosen_prompt text;
begin
  chosen_prompt := case
    when current_month_key = '2026-09' then 'Béka'
    when current_month_key = '2026-10' then 'Halloween'
    else prompts[1 + mod(
      extract(year from starts_local)::integer * 12 + extract(month from starts_local)::integer - 1,
      array_length(prompts, 1)
    )]
  end;

  insert into public.monthly_challenges (
    month_key,
    prompt,
    description,
    canvas_size,
    starts_at,
    voting_starts_at,
    submission_ends_at,
    ends_at
  ) values (
    current_month_key,
    chosen_prompt,
    format('Készíts egy 128×128 pixeles %s témájú rajzot a Bitscrawl palettájával.', lower(chosen_prompt)),
    128,
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
  challenge_start timestamptz;
  challenge_edit_cutoff timestamptz;
  challenge_end timestamptz;
  challenge_canvas_size smallint;
  existing_submission timestamptz;
  selected_palette_id text;
begin
  select challenge.starts_at, challenge.submission_ends_at, challenge.ends_at, challenge.canvas_size
  into challenge_start, challenge_edit_cutoff, challenge_end, challenge_canvas_size
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
  if not private.monthly_pixels_valid(drawing_pixels, challenge_canvas_size) then
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

create or replace function private.submit_monthly_entry(target_challenge_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  submission_time timestamptz;
  challenge_canvas_size smallint;
begin
  select challenge.canvas_size
  into challenge_canvas_size
  from public.monthly_challenges challenge
  where challenge.id = target_challenge_id
    and clock_timestamp() >= challenge.starts_at
    and clock_timestamp() < challenge.ends_at;

  if challenge_canvas_size is null then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;

  update public.monthly_entries entry
  set submitted_at = coalesce(entry.submitted_at, clock_timestamp())
  where entry.challenge_id = target_challenge_id
    and entry.user_id = current_user_id
    and entry.excluded_at is null
    and private.monthly_pixels_valid(entry.pixels, challenge_canvas_size)
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
  challenge_id bigint,
  month_key text,
  prompt text,
  description text,
  canvas_size smallint,
  starts_at timestamptz,
  voting_starts_at timestamptz,
  submission_ends_at timestamptz,
  ends_at timestamptz,
  challenge_status text,
  server_now timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.ensure_monthly_challenge();
  return query
  select
    challenge.id,
    challenge.month_key,
    challenge.prompt,
    challenge.description,
    challenge.canvas_size,
    challenge.starts_at,
    challenge.voting_starts_at,
    challenge.submission_ends_at,
    challenge.ends_at,
    private.monthly_challenge_status(challenge.id),
    clock_timestamp()
  from public.monthly_challenges challenge
  order by challenge.starts_at desc;
end;
$$;

revoke all on function private.monthly_pixels_valid(jsonb, integer) from public, anon, authenticated;
revoke all on function public.get_monthly_challenges() from public;
grant execute on function public.get_monthly_challenges() to anon, authenticated;

-- The September challenge is over, so award one entry point plus one point per
-- received vote to every valid entrant. The guarded insert keeps this safe if
-- production was finalized manually before this migration reached it.
with target as (
  select challenge.id
  from public.monthly_challenges challenge
  where challenge.month_key = '2026-09'
    and challenge.finalized_at is null
    and challenge.ends_at <= clock_timestamp()
), vote_totals as (
  select
    target.id as challenge_id,
    entry.user_id,
    count(vote.entry_id)::integer as vote_points
  from target
  join public.monthly_entries entry on entry.challenge_id = target.id
  left join public.monthly_votes vote
    on vote.challenge_id = entry.challenge_id
    and vote.entry_id = entry.id
  where entry.submitted_at is not null
    and entry.excluded_at is null
  group by target.id, entry.user_id
)
insert into private.monthly_score_awards (
  challenge_id,
  user_id,
  entry_points,
  vote_points,
  bonus_points,
  placement
)
select challenge_id, user_id, 1, vote_points, 0, null
from vote_totals
on conflict (challenge_id, user_id) do nothing;

do $$
declare
  target_challenge_id bigint;
begin
  select challenge.id
  into target_challenge_id
  from public.monthly_challenges challenge
  where challenge.month_key = '2026-09'
    and challenge.ends_at <= clock_timestamp();

  if target_challenge_id is not null then
    perform private.recalculate_monthly_score_placements(target_challenge_id);
    update public.monthly_challenges challenge
    set finalized_at = coalesce(challenge.finalized_at, clock_timestamp())
    where challenge.id = target_challenge_id;
  end if;
end;
$$;

comment on column public.monthly_challenges.canvas_size is
  'Square pixel-canvas side length. Historical monthly challenges are 32; October 2026 and later are 128.';
comment on function private.monthly_pixels_valid(jsonb, integer) is
  'Validates monthly drawings against the canvas size stored on their challenge.';
