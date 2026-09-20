create table public.monthly_challenges (
  id bigint generated always as identity primary key,
  month_key text not null unique,
  prompt text not null,
  description text,
  starts_at timestamptz not null,
  voting_starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint monthly_challenges_prompt_length check (char_length(btrim(prompt)) between 1 and 80),
  constraint monthly_challenges_time_order check (
    starts_at < voting_starts_at and voting_starts_at < ends_at
  )
);

create index monthly_challenges_time_idx
  on public.monthly_challenges (starts_at desc, ends_at desc);

create table public.monthly_entries (
  id bigint generated always as identity primary key,
  challenge_id bigint not null references public.monthly_challenges(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  pixels jsonb not null,
  palette_id text not null default 'base-12-v1',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  excluded_at timestamptz,
  unique (challenge_id, user_id),
  unique (id, challenge_id),
  constraint monthly_entries_palette check (palette_id = 'base-12-v1')
);

create index monthly_entries_challenge_updated_idx
  on public.monthly_entries (challenge_id, updated_at desc) where excluded_at is null;
create index monthly_entries_user_idx on public.monthly_entries (user_id, updated_at desc);

create table public.monthly_votes (
  challenge_id bigint not null references public.monthly_challenges(id) on delete restrict,
  entry_id bigint not null,
  voter_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (entry_id, voter_user_id),
  foreign key (entry_id, challenge_id)
    references public.monthly_entries(id, challenge_id) on delete restrict
);

create index monthly_votes_voter_challenge_idx
  on public.monthly_votes (voter_user_id, challenge_id);
create index monthly_votes_challenge_entry_idx
  on public.monthly_votes (challenge_id, entry_id);

alter table public.monthly_challenges enable row level security;
alter table public.monthly_entries enable row level security;
alter table public.monthly_votes enable row level security;

create policy monthly_challenges_public_read on public.monthly_challenges
  for select to anon, authenticated using (true);
create policy monthly_entries_owner_read on public.monthly_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy monthly_votes_owner_read on public.monthly_votes
  for select to authenticated using ((select auth.uid()) = voter_user_id);

grant select on public.monthly_challenges to anon, authenticated;
grant select on public.monthly_entries, public.monthly_votes to authenticated;
revoke insert, update, delete on public.monthly_challenges, public.monthly_entries,
  public.monthly_votes from public, anon, authenticated;

create function private.monthly_challenge_status(target_challenge_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when clock_timestamp() < c.starts_at then 'upcoming'
    when clock_timestamp() < c.voting_starts_at then 'drawing'
    when clock_timestamp() < c.ends_at then 'voting'
    else 'closed'
  end
  from public.monthly_challenges c
  where c.id = target_challenge_id;
$$;

create function private.ensure_monthly_challenge()
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
    month_key, prompt, description, starts_at, voting_starts_at, ends_at
  ) values (
    current_month_key,
    chosen_prompt,
    format('Készíts egy 32×32 pixeles %s témájú rajzot a Bitscrawl palettájával.', lower(chosen_prompt)),
    starts_local at time zone 'Europe/Budapest',
    (ends_local - interval '7 days') at time zone 'Europe/Budapest',
    ends_local at time zone 'Europe/Budapest'
  )
  on conflict (month_key) do nothing;
end;
$$;

create function private.save_monthly_entry(target_challenge_id bigint, drawing_pixels jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  saved_entry_id bigint;
begin
  if private.monthly_challenge_status(target_challenge_id) <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_LOCKED';
  end if;
  if not private.weekly_pixels_valid(drawing_pixels) then
    raise exception using errcode = 'P0001', message = 'MONTHLY_DRAWING_INVALID';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = current_user_id) then
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

create function private.set_monthly_vote(target_entry_id bigint, vote_enabled boolean)
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
  select e.challenge_id, e.user_id into target_challenge_id, entry_owner_id
  from public.monthly_entries e
  where e.id = target_entry_id and e.excluded_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'MONTHLY_ENTRY_NOT_FOUND';
  end if;
  if private.monthly_challenge_status(target_challenge_id) <> 'voting' then
    raise exception using errcode = 'P0001', message = 'MONTHLY_VOTING_CLOSED';
  end if;
  if entry_owner_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'MONTHLY_OWN_VOTE_FORBIDDEN';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if vote_enabled then
    if not exists (
      select 1 from public.monthly_votes v
      where v.entry_id = target_entry_id and v.voter_user_id = current_user_id
    ) and (
      select count(*) from public.monthly_votes v
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

  select count(*)::integer into vote_count from public.monthly_votes v
  where v.challenge_id = target_challenge_id and v.voter_user_id = current_user_id;
  return query select vote_enabled, vote_count;
end;
$$;

create function private.get_monthly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint, author_name text, author_avatar jsonb, pixels jsonb,
  updated_at timestamptz, vote_count bigint, has_voted boolean,
  is_own boolean, is_winner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with challenge as (
    select c.ends_at, c.voting_starts_at from public.monthly_challenges c
    where c.id = target_challenge_id and clock_timestamp() >= c.voting_starts_at
  ), entries_with_votes as (
    select e.id, e.user_id, e.pixels, e.updated_at, p.display_name, p.avatar_pixels,
      count(v.entry_id)::bigint as votes
    from public.monthly_entries e
    join public.profiles p on p.user_id = e.user_id
    left join public.monthly_votes v on v.entry_id = e.id
    cross join challenge c
    where e.challenge_id = target_challenge_id and e.excluded_at is null
    group by e.id, e.user_id, e.pixels, e.updated_at, p.display_name, p.avatar_pixels
  ), totals as (
    select coalesce(max(votes), 0) as top_votes from entries_with_votes
  )
  select e.id, e.display_name, e.avatar_pixels, e.pixels, e.updated_at, e.votes,
    exists (select 1 from public.monthly_votes v where v.entry_id = e.id and v.voter_user_id = auth.uid()),
    e.user_id = auth.uid(),
    clock_timestamp() >= c.ends_at and e.votes = t.top_votes
  from entries_with_votes e cross join totals t cross join challenge c;
$$;

create function public.get_monthly_challenges()
returns table (
  challenge_id bigint, month_key text, prompt text, description text,
  starts_at timestamptz, voting_starts_at timestamptz, ends_at timestamptz,
  challenge_status text, server_now timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.ensure_monthly_challenge();
  return query
  select c.id, c.month_key, c.prompt, c.description, c.starts_at, c.voting_starts_at, c.ends_at,
    private.monthly_challenge_status(c.id), clock_timestamp()
  from public.monthly_challenges c
  order by c.starts_at desc;
end;
$$;

create function public.get_monthly_gallery(target_challenge_id bigint)
returns table (
  entry_id bigint, author_name text, author_avatar jsonb, pixels jsonb,
  updated_at timestamptz, vote_count bigint, has_voted boolean,
  is_own boolean, is_winner boolean
)
language sql security invoker set search_path = ''
as $$ select * from private.get_monthly_gallery(target_challenge_id) $$;

create function public.get_monthly_account_state(target_challenge_id bigint)
returns table (profile_name text, entry_id bigint, entry_pixels jsonb, updated_at timestamptz, votes_used integer)
language sql security invoker set search_path = ''
as $$
  select p.display_name, e.id, e.pixels, e.updated_at,
    (select count(*)::integer from public.monthly_votes v
      where v.challenge_id = target_challenge_id and v.voter_user_id = private.weekly_user_id())
  from (select private.weekly_user_id() as user_id) u
  left join public.profiles p on p.user_id = u.user_id
  left join public.monthly_entries e
    on e.challenge_id = target_challenge_id and e.user_id = u.user_id;
$$;

create function public.save_monthly_entry(target_challenge_id bigint, drawing_pixels jsonb)
returns bigint language sql security invoker set search_path = ''
as $$ select private.save_monthly_entry(target_challenge_id, drawing_pixels) $$;

create function public.set_monthly_vote(target_entry_id bigint, vote_enabled boolean)
returns table (voted boolean, active_vote_count integer)
language sql security invoker set search_path = ''
as $$ select * from private.set_monthly_vote(target_entry_id, vote_enabled) $$;

revoke all on function private.monthly_challenge_status(bigint) from public, anon;
revoke all on function private.ensure_monthly_challenge() from public;
revoke all on function private.save_monthly_entry(bigint, jsonb) from public, anon;
revoke all on function private.set_monthly_vote(bigint, boolean) from public, anon;
revoke all on function private.get_monthly_gallery(bigint) from public;
grant execute on function private.monthly_challenge_status(bigint) to anon, authenticated;
grant execute on function private.ensure_monthly_challenge() to anon, authenticated;
grant execute on function private.save_monthly_entry(bigint, jsonb) to authenticated;
grant execute on function private.set_monthly_vote(bigint, boolean) to authenticated;
grant execute on function private.get_monthly_gallery(bigint) to anon, authenticated;

revoke all on function public.get_monthly_challenges() from public;
revoke all on function public.get_monthly_gallery(bigint) from public;
revoke all on function public.get_monthly_account_state(bigint) from public, anon;
revoke all on function public.save_monthly_entry(bigint, jsonb) from public, anon;
revoke all on function public.set_monthly_vote(bigint, boolean) from public, anon;
grant execute on function public.get_monthly_challenges() to anon, authenticated;
grant execute on function public.get_monthly_gallery(bigint) to anon, authenticated;
grant execute on function public.get_monthly_account_state(bigint) to authenticated;
grant execute on function public.save_monthly_entry(bigint, jsonb) to authenticated;
grant execute on function public.set_monthly_vote(bigint, boolean) to authenticated;

select private.ensure_monthly_challenge();
