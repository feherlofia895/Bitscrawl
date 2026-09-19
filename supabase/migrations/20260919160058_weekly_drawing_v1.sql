create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint profiles_display_name_length check (char_length(display_name) between 2 and 16),
  constraint profiles_display_name_trimmed check (display_name = btrim(display_name))
);

create unique index profiles_display_name_unique on public.profiles (lower(display_name));

create table public.weekly_challenges (
  id bigint generated always as identity primary key,
  week_key text not null unique,
  prompt text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint weekly_challenges_prompt_length check (char_length(btrim(prompt)) between 1 and 80),
  constraint weekly_challenges_time_order check (ends_at > starts_at)
);

create index weekly_challenges_time_idx on public.weekly_challenges (starts_at desc, ends_at desc);

create table public.weekly_drafts (
  challenge_id bigint not null references public.weekly_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pixels jsonb not null,
  palette_id text not null default 'base-12-v1',
  updated_at timestamptz not null default clock_timestamp(),
  primary key (challenge_id, user_id),
  constraint weekly_drafts_palette check (palette_id = 'base-12-v1')
);

create index weekly_drafts_user_idx on public.weekly_drafts (user_id, updated_at desc);

create table public.weekly_entries (
  id bigint generated always as identity primary key,
  challenge_id bigint not null references public.weekly_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pixels jsonb not null,
  palette_id text not null default 'base-12-v1',
  submitted_at timestamptz not null default clock_timestamp(),
  excluded_at timestamptz,
  unique (challenge_id, user_id),
  unique (id, challenge_id),
  constraint weekly_entries_palette check (palette_id = 'base-12-v1')
);

create index weekly_entries_challenge_submitted_idx
  on public.weekly_entries (challenge_id, submitted_at desc) where excluded_at is null;
create index weekly_entries_user_idx on public.weekly_entries (user_id, submitted_at desc);

create table public.weekly_votes (
  challenge_id bigint not null references public.weekly_challenges(id) on delete cascade,
  entry_id bigint not null,
  voter_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (entry_id, voter_user_id),
  foreign key (entry_id, challenge_id)
    references public.weekly_entries(id, challenge_id) on delete cascade
);

create index weekly_votes_voter_challenge_idx
  on public.weekly_votes (voter_user_id, challenge_id);
create index weekly_votes_challenge_entry_idx
  on public.weekly_votes (challenge_id, entry_id);

alter table public.profiles enable row level security;
alter table public.weekly_challenges enable row level security;
alter table public.weekly_drafts enable row level security;
alter table public.weekly_entries enable row level security;
alter table public.weekly_votes enable row level security;

create policy profiles_owner_read on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy weekly_challenges_public_read on public.weekly_challenges for select to anon, authenticated using (true);
create policy weekly_entries_owner_read on public.weekly_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy weekly_drafts_owner_read on public.weekly_drafts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy weekly_votes_owner_read on public.weekly_votes for select to authenticated
  using ((select auth.uid()) = voter_user_id);

grant select on public.weekly_challenges to anon, authenticated;
grant select on public.profiles, public.weekly_entries to authenticated;
grant select on public.weekly_drafts, public.weekly_votes to authenticated;
revoke insert, update, delete on public.profiles, public.weekly_challenges, public.weekly_drafts,
  public.weekly_entries, public.weekly_votes from public, anon, authenticated;

create function private.weekly_user_id()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null
    or coalesce((auth.jwt()->>'is_anonymous')::boolean, true)
  then
    raise exception using errcode = 'P0001', message = 'WEEKLY_ACCOUNT_REQUIRED';
  end if;
  return current_user_id;
end;
$$;

create function private.weekly_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select candidate is not null
    and jsonb_typeof(candidate) = 'array'
    and jsonb_array_length(candidate) = 1024
    and not exists (
      select 1 from jsonb_array_elements_text(candidate) as pixel(color)
      where pixel.color not in (
        'transparent', '#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967',
        '#67ba62', '#549d8c', '#33567e', '#221a5f', '#999ea1', '#242630', '#230a19'
      )
    );
$$;

create function private.weekly_challenge_is_active(target_challenge_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.weekly_challenges as c
    where c.id = target_challenge_id
      and c.starts_at <= clock_timestamp()
      and c.ends_at > clock_timestamp()
  );
$$;

create function private.set_weekly_profile(requested_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  clean_name text := btrim(requested_name);
begin
  if clean_name is null or char_length(clean_name) not between 2 and 16
    or clean_name ~ '[[:cntrl:]]'
  then
    raise exception using errcode = 'P0001', message = 'WEEKLY_NAME_INVALID';
  end if;
  if exists (
    select 1 from public.profiles as p
    where lower(p.display_name) = lower(clean_name) and p.user_id <> current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_NAME_TAKEN';
  end if;

  insert into public.profiles (user_id, display_name)
  values (current_user_id, clean_name)
  on conflict (user_id) do update set display_name = excluded.display_name;
  return clean_name;
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'WEEKLY_NAME_TAKEN';
end;
$$;

create function private.save_weekly_draft(target_challenge_id bigint, drawing_pixels jsonb)
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

  insert into public.weekly_drafts (challenge_id, user_id, pixels, updated_at)
  values (target_challenge_id, current_user_id, drawing_pixels, saved_at)
  on conflict (challenge_id, user_id)
  do update set pixels = excluded.pixels, updated_at = excluded.updated_at;
  return saved_at;
end;
$$;

create function private.submit_weekly_entry(target_challenge_id bigint, drawing_pixels jsonb)
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

  insert into public.weekly_entries (challenge_id, user_id, pixels)
  values (target_challenge_id, current_user_id, drawing_pixels)
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

create function private.set_weekly_vote(target_entry_id bigint, vote_enabled boolean)
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
begin
  select e.challenge_id, e.user_id
  into target_challenge_id, entry_owner_id
  from public.weekly_entries as e
  where e.id = target_entry_id and e.excluded_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_ENTRY_NOT_FOUND';
  end if;
  if not private.weekly_challenge_is_active(target_challenge_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_CHALLENGE_CLOSED';
  end if;
  if entry_owner_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'WEEKLY_OWN_VOTE_FORBIDDEN';
  end if;

  perform 1 from public.profiles as p where p.user_id = current_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if vote_enabled then
    if not exists (
      select 1 from public.weekly_votes as v
      where v.entry_id = target_entry_id and v.voter_user_id = current_user_id
    ) and (
      select count(*) from public.weekly_votes as v
      where v.challenge_id = target_challenge_id and v.voter_user_id = current_user_id
    ) >= 3 then
      raise exception using errcode = 'P0001', message = 'WEEKLY_VOTE_LIMIT';
    end if;
    insert into public.weekly_votes (challenge_id, entry_id, voter_user_id)
    values (target_challenge_id, target_entry_id, current_user_id)
    on conflict (entry_id, voter_user_id) do nothing;
  else
    delete from public.weekly_votes
    where entry_id = target_entry_id and voter_user_id = current_user_id;
  end if;

  select count(*)::integer into vote_count
  from public.weekly_votes as v
  where v.challenge_id = target_challenge_id and v.voter_user_id = current_user_id;
  return query select vote_enabled, vote_count;
end;
$$;

create function private.get_weekly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint,
  author_name text,
  pixels jsonb,
  submitted_at timestamptz,
  vote_count bigint,
  has_voted boolean,
  is_own boolean,
  is_winner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with entries_with_votes as (
    select e.id, e.user_id, e.pixels, e.submitted_at, p.display_name,
      count(v.entry_id)::bigint as votes
    from public.weekly_entries as e
    join public.profiles as p on p.user_id = e.user_id
    left join public.weekly_votes as v on v.entry_id = e.id
    where e.challenge_id = target_challenge_id and e.excluded_at is null
    group by e.id, e.user_id, e.pixels, e.submitted_at, p.display_name
  ), totals as (select coalesce(max(votes), 0) as top_votes from entries_with_votes),
  challenge as (select ends_at from public.weekly_challenges where id = target_challenge_id)
  select e.id, e.display_name, e.pixels, e.submitted_at, e.votes,
    exists (select 1 from public.weekly_votes v where v.entry_id = e.id and v.voter_user_id = auth.uid()),
    e.user_id = auth.uid(),
    clock_timestamp() >= c.ends_at and e.votes = t.top_votes
  from entries_with_votes e cross join totals t cross join challenge c;
$$;

create function private.ensure_weekly_challenge()
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
    'Kincsesláda', 'Polip', 'Vulkán', 'Robot',
    'Kastély', 'Macska', 'Hőlégballon', 'Tengeralattjáró'
  ];
  chosen_prompt text;
begin
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

create function public.get_weekly_challenges()
returns table (
  challenge_id bigint, week_key text, prompt text, description text,
  starts_at timestamptz, ends_at timestamptz, challenge_status text,
  server_now timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.ensure_weekly_challenge();
  return query select c.id, c.week_key, c.prompt, c.description, c.starts_at, c.ends_at,
    case when clock_timestamp() < c.starts_at then 'upcoming'
      when clock_timestamp() < c.ends_at then 'active' else 'closed' end,
    clock_timestamp()
  from public.weekly_challenges c
  order by c.starts_at desc;
end;
$$;

create function public.get_weekly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint, author_name text, pixels jsonb, submitted_at timestamptz,
  vote_count bigint, has_voted boolean, is_own boolean, is_winner boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.get_weekly_gallery(target_challenge_id) $$;

create function public.get_weekly_account_state(target_challenge_id bigint)
returns table (
  profile_name text, draft_pixels jsonb, entry_id bigint,
  entry_pixels jsonb, votes_used integer
)
language sql security invoker set search_path = ''
as $$
  select p.display_name, d.pixels, e.id, e.pixels,
    (select count(*)::integer from public.weekly_votes v
      where v.challenge_id = target_challenge_id and v.voter_user_id = private.weekly_user_id())
  from (select private.weekly_user_id() as user_id) u
  left join public.profiles p on p.user_id = u.user_id
  left join public.weekly_drafts d on d.challenge_id = target_challenge_id and d.user_id = u.user_id
  left join public.weekly_entries e on e.challenge_id = target_challenge_id and e.user_id = u.user_id;
$$;

create function public.set_weekly_profile(requested_name text)
returns text language sql security invoker set search_path = ''
as $$ select private.set_weekly_profile(requested_name) $$;
create function public.save_weekly_draft(target_challenge_id bigint, drawing_pixels jsonb)
returns timestamptz language sql security invoker set search_path = ''
as $$ select private.save_weekly_draft(target_challenge_id, drawing_pixels) $$;
create function public.submit_weekly_entry(target_challenge_id bigint, drawing_pixels jsonb)
returns bigint language sql security invoker set search_path = ''
as $$ select private.submit_weekly_entry(target_challenge_id, drawing_pixels) $$;
create function public.set_weekly_vote(target_entry_id bigint, vote_enabled boolean)
returns table (voted boolean, active_vote_count integer)
language sql security invoker set search_path = ''
as $$ select * from private.set_weekly_vote(target_entry_id, vote_enabled) $$;

grant usage on schema private to anon, authenticated;
revoke all on function private.weekly_user_id() from public, anon;
revoke all on function private.weekly_pixels_valid(jsonb) from public, anon, authenticated;
revoke all on function private.weekly_challenge_is_active(bigint) from public, anon;
revoke all on function private.set_weekly_profile(text) from public, anon;
revoke all on function private.save_weekly_draft(bigint, jsonb) from public, anon;
revoke all on function private.submit_weekly_entry(bigint, jsonb) from public, anon;
revoke all on function private.set_weekly_vote(bigint, boolean) from public, anon;
revoke all on function private.get_weekly_gallery(bigint) from public;
revoke all on function private.ensure_weekly_challenge() from public;
grant execute on function private.weekly_user_id() to authenticated;
grant execute on function private.weekly_challenge_is_active(bigint) to authenticated;
grant execute on function private.set_weekly_profile(text) to authenticated;
grant execute on function private.save_weekly_draft(bigint, jsonb) to authenticated;
grant execute on function private.submit_weekly_entry(bigint, jsonb) to authenticated;
grant execute on function private.set_weekly_vote(bigint, boolean) to authenticated;
grant execute on function private.get_weekly_gallery(bigint) to anon, authenticated;
grant execute on function private.ensure_weekly_challenge() to anon, authenticated;

revoke all on function public.get_weekly_challenges() from public;
revoke all on function public.get_weekly_gallery(bigint) from public;
revoke all on function public.get_weekly_account_state(bigint) from public, anon;
revoke all on function public.set_weekly_profile(text) from public, anon;
revoke all on function public.save_weekly_draft(bigint, jsonb) from public, anon;
revoke all on function public.submit_weekly_entry(bigint, jsonb) from public, anon;
revoke all on function public.set_weekly_vote(bigint, boolean) from public, anon;
grant execute on function public.get_weekly_challenges() to anon, authenticated;
grant execute on function public.get_weekly_gallery(bigint) to anon, authenticated;
grant execute on function public.get_weekly_account_state(bigint) to authenticated;
grant execute on function public.set_weekly_profile(text) to authenticated;
grant execute on function public.save_weekly_draft(bigint, jsonb) to authenticated;
grant execute on function public.submit_weekly_entry(bigint, jsonb) to authenticated;
grant execute on function public.set_weekly_vote(bigint, boolean) to authenticated;

select private.ensure_weekly_challenge();
