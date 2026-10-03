-- Parallel drawing competition. Classic rounds and their data remain untouched.
create table public.competition_rounds (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id) on delete cascade,
  round_number smallint not null,
  status text not null default 'drawing',
  word text not null,
  drawing_started_at timestamptz not null,
  drawing_ends_at timestamptz not null,
  voting_started_at timestamptz,
  voting_ends_at timestamptz,
  finished_at timestamptz,
  constraint competition_rounds_number_positive check (round_number > 0),
  constraint competition_rounds_status_values check (status in ('drawing', 'voting', 'finished')),
  constraint competition_rounds_word_format check (
    char_length(word) between 2 and 24 and word = lower(btrim(word))
  ),
  constraint competition_rounds_draw_window check (drawing_ends_at > drawing_started_at),
  constraint competition_rounds_room_number_unique unique (room_id, round_number)
);

create unique index competition_rounds_one_active_per_room_idx
  on public.competition_rounds (room_id)
  where status in ('drawing', 'voting');

create table public.competition_draw_events (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.competition_rounds (id) on delete cascade,
  room_id bigint not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  changes jsonb not null,
  created_at timestamptz not null default now(),
  constraint competition_draw_events_changes_array check (
    jsonb_typeof(changes) = 'array' and jsonb_array_length(changes) between 1 and 64
  )
);

create index competition_draw_events_round_user_id_idx
  on public.competition_draw_events (round_id, user_id, id);

create index competition_draw_events_room_id_idx
  on public.competition_draw_events (room_id);

create table private.competition_entries (
  drawing_id text primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  round_id bigint not null references public.competition_rounds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  constraint competition_entries_round_user_unique unique (round_id, user_id),
  constraint competition_entries_public_id_format check (drawing_id ~ '^[0-9a-f]{32}$')
);

create table private.competition_votes (
  round_id bigint not null references public.competition_rounds (id) on delete cascade,
  voter_user_id uuid not null references auth.users (id) on delete cascade,
  drawing_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (round_id, voter_user_id),
  constraint competition_votes_not_self check (voter_user_id <> drawing_user_id)
);

create index competition_votes_round_drawing_idx
  on private.competition_votes (round_id, drawing_user_id);

alter table public.competition_rounds enable row level security;
alter table public.competition_draw_events enable row level security;

create policy competition_rounds_member_select
on public.competition_rounds
for select
to authenticated
using ((select private.is_room_member(room_id)));

revoke all on public.competition_rounds from anon, authenticated;
revoke all on public.competition_draw_events from anon, authenticated;
grant select on public.competition_rounds to authenticated;
revoke all on private.competition_entries from public, anon, authenticated;
revoke all on private.competition_votes from public, anon, authenticated;

create function private.start_competition_game(target_room_id bigint)
returns table (room_id bigint, room_status text, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_room_status text;
  target_game_mode text;
  target_draw_seconds integer;
  current_player_count integer;
  selected_word text;
  game_started_at timestamptz;
  created_round_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select host_user_id, status, game_mode, competition_draw_seconds
  into target_host_user_id, target_room_status, target_game_mode, target_draw_seconds
  from public.rooms
  where id = target_room_id
  for update;

  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if target_host_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;
  if target_game_mode <> 'competition' then
    raise exception using errcode = 'P0001', message = 'GAME_MODE_INVALID';
  end if;
  if target_room_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  select count(*)::integer into current_player_count
  from public.room_players where room_id = target_room_id;
  if current_player_count < 3 then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;

  select wb.word into selected_word
  from private.word_bank as wb order by random() limit 1;
  if selected_word is null then
    raise exception using errcode = 'P0001', message = 'WORD_BANK_TOO_SMALL';
  end if;

  game_started_at := clock_timestamp();
  update public.room_players set score = 0 where room_id = target_room_id;
  update public.rooms
  set status = 'playing', started_at = game_started_at, finished_at = null
  where id = target_room_id;

  insert into public.competition_rounds (
    room_id, round_number, word, drawing_started_at, drawing_ends_at
  ) values (
    target_room_id, 1, selected_word, game_started_at,
    game_started_at + make_interval(secs => target_draw_seconds)
  ) returning id into created_round_id;

  insert into private.competition_entries (round_id, user_id)
  select created_round_id, rp.user_id
  from public.room_players as rp
  where rp.room_id = target_room_id
  order by random();

  return query select target_room_id, 'playing'::text, game_started_at;
end;
$$;

create function public.start_competition_game(target_room_id bigint)
returns table (room_id bigint, room_status text, started_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.start_competition_game(target_room_id); $$;

create function private.get_competition_round_view(target_room_id bigint)
returns table (
  round_id bigint,
  round_number smallint,
  total_rounds integer,
  round_status text,
  chosen_word text,
  drawing_ends_at timestamptz,
  voting_ends_at timestamptz,
  finished_at timestamptz,
  next_round_at timestamptz,
  voted_for_drawing_id text,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  return query
  select cr.id, cr.round_number, r.competition_round_count, cr.status, cr.word,
    cr.drawing_ends_at, cr.voting_ends_at, cr.finished_at,
    case when cr.status = 'finished' then cr.finished_at + interval '5 seconds' end,
    voted_entry.drawing_id, clock_timestamp()
  from public.competition_rounds as cr
  join public.rooms as r on r.id = cr.room_id
  left join private.competition_votes as cv
    on cv.round_id = cr.id and cv.voter_user_id = current_user_id
  left join private.competition_entries as voted_entry
    on voted_entry.round_id = cr.id and voted_entry.user_id = cv.drawing_user_id
  where cr.room_id = target_room_id
  order by cr.round_number desc
  limit 1;

  if not found then raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND'; end if;
end;
$$;

create function public.get_competition_round_view(target_room_id bigint)
returns table (
  round_id bigint, round_number smallint, total_rounds integer, round_status text,
  chosen_word text, drawing_ends_at timestamptz, voting_ends_at timestamptz,
  finished_at timestamptz, next_round_at timestamptz, voted_for_drawing_id text,
  server_now timestamptz
)
language sql security invoker set search_path = ''
as $$ select * from private.get_competition_round_view(target_room_id); $$;

create function private.submit_competition_pixel_changes(
  target_round_id bigint,
  pixel_changes jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_status text;
  target_drawing_ends_at timestamptz;
  target_palette_size smallint;
  created_event_id bigint;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;

  select cr.room_id, cr.status, cr.drawing_ends_at, r.palette_size
  into target_room_id, target_status, target_drawing_ends_at, target_palette_size
  from public.competition_rounds as cr
  join public.rooms as r on r.id = cr.room_id
  where cr.id = target_round_id;

  if not found then raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND'; end if;
  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if target_status <> 'drawing' then raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING'; end if;
  if clock_timestamp() >= target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
  end if;
  if pixel_changes is null or jsonb_typeof(pixel_changes) <> 'array'
     or jsonb_array_length(pixel_changes) not between 1 and 64 then
    raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID';
  end if;

  if exists (
    select 1 from jsonb_array_elements(pixel_changes) as pixel(change)
    where jsonb_typeof(pixel.change) <> 'object'
      or not (pixel.change ? 'x' and pixel.change ? 'y' and pixel.change ? 'color')
      or coalesce(pixel.change->>'x', '') !~ '^(0|[1-9]|[12][0-9]|3[01])$'
      or coalesce(pixel.change->>'y', '') !~ '^(0|[1-9]|[12][0-9]|3[01])$'
      or (
        coalesce(pixel.change->>'color', '') <> 'transparent'
        and (
          (target_palette_size = 12 and coalesce(pixel.change->>'color', '') not in (
            '#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967', '#67ba62',
            '#549d8c', '#33567e', '#221a5f', '#999ea1', '#242630', '#230a19'
          ))
          or (target_palette_size = 16 and coalesce(pixel.change->>'color', '') not in (
            '#e8d7b8', '#241a35', '#5f7443', '#8fa66a', '#6446a6', '#9b7ede',
            '#247f7a', '#4ecdc4', '#b97818', '#ffd166', '#b83f4d', '#ff6b6b',
            '#285bb8', '#4d96ff', '#8f4f35', '#c9825b'
          ))
        )
      )
  ) then raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID'; end if;

  insert into public.competition_draw_events (round_id, room_id, user_id, changes)
  values (target_round_id, target_room_id, current_user_id, pixel_changes)
  returning id into created_event_id;
  return created_event_id;
end;
$$;

create function public.submit_competition_pixel_changes(target_round_id bigint, pixel_changes jsonb)
returns bigint language sql security invoker set search_path = ''
as $$ select private.submit_competition_pixel_changes(target_round_id, pixel_changes); $$;

create function private.get_competition_draw_updates(
  target_round_id bigint,
  after_event_id bigint default null,
  requested_limit integer default 500
)
returns table (id bigint, round_id bigint, drawing_id text, changes jsonb)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_status text;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  if requested_limit is null or requested_limit not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'LIMIT_INVALID';
  end if;
  select cr.room_id, cr.status into target_room_id, target_status
  from public.competition_rounds as cr where cr.id = target_round_id;
  if not found or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  return query
  select e.id, e.round_id, entry.drawing_id, e.changes
  from public.competition_draw_events as e
  join private.competition_entries as entry
    on entry.round_id = e.round_id and entry.user_id = e.user_id
  where e.round_id = target_round_id
    and (after_event_id is null or e.id > after_event_id)
    and (target_status <> 'drawing' or e.user_id = current_user_id)
  order by e.id
  limit requested_limit;
end;
$$;

create function public.get_competition_draw_updates(
  target_round_id bigint, after_event_id bigint default null, requested_limit integer default 500
)
returns table (id bigint, round_id bigint, drawing_id text, changes jsonb)
language sql security invoker set search_path = ''
as $$ select * from private.get_competition_draw_updates(target_round_id, after_event_id, requested_limit); $$;

create function private.finish_competition_drawing(target_round_id bigint)
returns table (round_id bigint, round_status text, voting_ends_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_status text;
  target_drawing_ends_at timestamptz;
  vote_end timestamptz;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  select cr.room_id, cr.status, cr.drawing_ends_at
  into target_room_id, target_status, target_drawing_ends_at
  from public.competition_rounds as cr where cr.id = target_round_id for update;
  if not found or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;
  if target_status = 'voting' then
    return query select cr.id, cr.status, cr.voting_ends_at
    from public.competition_rounds as cr where cr.id = target_round_id;
    return;
  end if;
  if target_status <> 'drawing' then raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING'; end if;
  if clock_timestamp() < target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_REMAINING';
  end if;
  vote_end := clock_timestamp() + interval '30 seconds';
  update public.competition_rounds
  set status = 'voting', voting_started_at = clock_timestamp(), voting_ends_at = vote_end
  where id = target_round_id;
  return query select target_round_id, 'voting'::text, vote_end;
end;
$$;

create function public.finish_competition_drawing(target_round_id bigint)
returns table (round_id bigint, round_status text, voting_ends_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.finish_competition_drawing(target_round_id); $$;

create function private.set_competition_vote(target_round_id bigint, target_drawing_id text)
returns table (round_id bigint, voted_for_drawing_id text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_status text;
  target_voting_ends_at timestamptz;
  target_drawing_user_id uuid;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  select cr.room_id, cr.status, cr.voting_ends_at
  into target_room_id, target_status, target_voting_ends_at
  from public.competition_rounds as cr where cr.id = target_round_id for update;
  if not found or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;
  if target_status <> 'voting' then raise exception using errcode = 'P0001', message = 'VOTING_NOT_OPEN'; end if;
  if target_voting_ends_at is null or clock_timestamp() >= target_voting_ends_at then
    raise exception using errcode = 'P0001', message = 'VOTING_TIME_EXPIRED';
  end if;
  select entry.user_id into target_drawing_user_id
  from private.competition_entries as entry
  where entry.round_id = target_round_id and entry.drawing_id = target_drawing_id;
  if not found then raise exception using errcode = 'P0001', message = 'DRAWING_NOT_FOUND'; end if;
  if target_drawing_user_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'SELF_VOTE_FORBIDDEN';
  end if;
  insert into private.competition_votes (round_id, voter_user_id, drawing_user_id)
  values (target_round_id, current_user_id, target_drawing_user_id)
  on conflict (round_id, voter_user_id) do update
  set drawing_user_id = excluded.drawing_user_id, updated_at = clock_timestamp();
  return query select target_round_id, target_drawing_id;
end;
$$;

create function public.set_competition_vote(target_round_id bigint, target_drawing_id text)
returns table (round_id bigint, voted_for_drawing_id text)
language sql security invoker set search_path = ''
as $$ select * from private.set_competition_vote(target_round_id, target_drawing_id); $$;

create function private.get_competition_results(target_round_id bigint)
returns table (drawing_id text, display_name text, vote_count integer, is_own boolean)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_status text;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  select cr.room_id, cr.status into target_room_id, target_status
  from public.competition_rounds as cr where cr.id = target_round_id;
  if not found or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;
  if target_status = 'drawing' then
    raise exception using errcode = 'P0001', message = 'VOTING_NOT_OPEN';
  end if;

  return query
  select entry.drawing_id,
    case when target_status = 'finished' then rp.display_name else null::text end,
    case when target_status = 'finished' then count(cv.voter_user_id)::integer else null::integer end,
    rp.user_id = current_user_id
  from private.competition_entries as entry
  join public.room_players as rp on rp.room_id = target_room_id and rp.user_id = entry.user_id
  left join private.competition_votes as cv
    on cv.round_id = target_round_id and cv.drawing_user_id = rp.user_id
  where entry.round_id = target_round_id
  group by entry.drawing_id, rp.user_id, rp.display_name, rp.joined_at, rp.id
  order by
    case when target_status = 'finished' then count(cv.voter_user_id) end desc nulls last,
    case when target_status <> 'finished' then entry.drawing_id end,
    case when target_status = 'finished' then rp.joined_at end,
    rp.id;
end;
$$;

create function public.get_competition_results(target_round_id bigint)
returns table (drawing_id text, display_name text, vote_count integer, is_own boolean)
language sql security invoker set search_path = ''
as $$ select * from private.get_competition_results(target_round_id); $$;

create function private.finish_competition_voting(target_round_id bigint)
returns table (round_id bigint, round_status text, finished_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_status text;
  target_voting_ends_at timestamptz;
  completed_at timestamptz;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  select cr.room_id, cr.status, cr.voting_ends_at
  into target_room_id, target_status, target_voting_ends_at
  from public.competition_rounds as cr where cr.id = target_round_id for update;
  if not found or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;
  if target_status = 'finished' then
    return query select cr.id, cr.status, cr.finished_at
    from public.competition_rounds as cr where cr.id = target_round_id;
    return;
  end if;
  if target_status <> 'voting' then raise exception using errcode = 'P0001', message = 'VOTING_NOT_OPEN'; end if;
  if target_voting_ends_at is null or clock_timestamp() < target_voting_ends_at then
    raise exception using errcode = 'P0001', message = 'VOTING_TIME_REMAINING';
  end if;

  update public.room_players as rp
  set score = rp.score + votes.vote_count
  from (
    select cv.drawing_user_id, count(*)::integer as vote_count
    from private.competition_votes as cv
    where cv.round_id = target_round_id
    group by cv.drawing_user_id
  ) as votes
  where rp.room_id = target_room_id and rp.user_id = votes.drawing_user_id;

  completed_at := clock_timestamp();
  update public.competition_rounds
  set status = 'finished', finished_at = completed_at
  where id = target_round_id;
  return query select target_round_id, 'finished'::text, completed_at;
end;
$$;

create function public.finish_competition_voting(target_round_id bigint)
returns table (round_id bigint, round_status text, finished_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.finish_competition_voting(target_round_id); $$;

create function private.advance_competition_game(target_round_id bigint)
returns table (room_id bigint, room_status text, next_round_id bigint, next_round_number smallint)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_room_status text;
  latest_round_id bigint;
  latest_round_number smallint;
  latest_status text;
  latest_finished_at timestamptz;
  total_round_count integer;
  draw_seconds integer;
  created_round_id bigint;
  selected_word text;
  started_at timestamptz;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  select cr.room_id into target_room_id from public.competition_rounds as cr where cr.id = target_round_id;
  if not found or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  select r.status, r.competition_round_count, r.competition_draw_seconds
  into target_room_status, total_round_count, draw_seconds
  from public.rooms as r where r.id = target_room_id for update;
  if target_room_status = 'finished' then
    return query select target_room_id, 'finished'::text, null::bigint, null::smallint;
    return;
  end if;
  if target_room_status <> 'playing' then raise exception using errcode = 'P0001', message = 'GAME_NOT_PLAYING'; end if;

  select cr.id, cr.round_number, cr.status, cr.finished_at
  into latest_round_id, latest_round_number, latest_status, latest_finished_at
  from public.competition_rounds as cr
  where cr.room_id = target_room_id order by cr.round_number desc limit 1 for update;
  if latest_round_id <> target_round_id then
    return query select target_room_id, 'playing'::text, latest_round_id, latest_round_number;
    return;
  end if;
  if latest_status <> 'finished' or latest_finished_at is null then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FINISHED';
  end if;
  if clock_timestamp() < latest_finished_at + interval '5 seconds' then
    raise exception using errcode = 'P0001', message = 'ROUND_TRANSITION_PENDING';
  end if;
  if latest_round_number >= total_round_count then
    update public.rooms set status = 'finished', finished_at = clock_timestamp()
    where id = target_room_id;
    return query select target_room_id, 'finished'::text, null::bigint, null::smallint;
    return;
  end if;

  select wb.word into selected_word from private.word_bank as wb order by random() limit 1;
  started_at := clock_timestamp();
  insert into public.competition_rounds (
    room_id, round_number, word, drawing_started_at, drawing_ends_at
  ) values (
    target_room_id, (latest_round_number + 1)::smallint, selected_word, started_at,
    started_at + make_interval(secs => draw_seconds)
  ) returning id into created_round_id;
  insert into private.competition_entries (round_id, user_id)
  select created_round_id, rp.user_id
  from public.room_players as rp
  where rp.room_id = target_room_id
  order by random();
  return query select target_room_id, 'playing'::text, created_round_id,
    (latest_round_number + 1)::smallint;
end;
$$;

create function public.advance_competition_game(target_round_id bigint)
returns table (room_id bigint, room_status text, next_round_id bigint, next_round_number smallint)
language sql security invoker set search_path = ''
as $$ select * from private.advance_competition_game(target_round_id); $$;

create function private.restart_competition_game(target_room_id bigint)
returns table (room_id bigint, room_status text, started_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_status text;
begin
  if current_user_id is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  select r.host_user_id, r.status into target_host_user_id, target_status
  from public.rooms as r where r.id = target_room_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND'; end if;
  if target_host_user_id <> current_user_id then raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST'; end if;
  if target_status <> 'finished' then raise exception using errcode = 'P0001', message = 'GAME_NOT_FINISHED'; end if;
  delete from public.competition_rounds where room_id = target_room_id;
  update public.rooms set status = 'waiting', started_at = null, finished_at = null
  where id = target_room_id;
  return query select * from private.start_competition_game(target_room_id);
end;
$$;

create function public.restart_competition_game(target_room_id bigint)
returns table (room_id bigint, room_status text, started_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.restart_competition_game(target_room_id); $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'competition_rounds'
  ) then alter publication supabase_realtime add table public.competition_rounds; end if;
end;
$$;

revoke all on function private.start_competition_game(bigint) from public, anon;
revoke all on function private.get_competition_round_view(bigint) from public, anon;
revoke all on function private.submit_competition_pixel_changes(bigint, jsonb) from public, anon;
revoke all on function private.get_competition_draw_updates(bigint, bigint, integer) from public, anon;
revoke all on function private.finish_competition_drawing(bigint) from public, anon;
revoke all on function private.set_competition_vote(bigint, text) from public, anon;
revoke all on function private.get_competition_results(bigint) from public, anon;
revoke all on function private.finish_competition_voting(bigint) from public, anon;
revoke all on function private.advance_competition_game(bigint) from public, anon;
revoke all on function private.restart_competition_game(bigint) from public, anon;

grant execute on function private.start_competition_game(bigint) to authenticated;
grant execute on function private.get_competition_round_view(bigint) to authenticated;
grant execute on function private.submit_competition_pixel_changes(bigint, jsonb) to authenticated;
grant execute on function private.get_competition_draw_updates(bigint, bigint, integer) to authenticated;
grant execute on function private.finish_competition_drawing(bigint) to authenticated;
grant execute on function private.set_competition_vote(bigint, text) to authenticated;
grant execute on function private.get_competition_results(bigint) to authenticated;
grant execute on function private.finish_competition_voting(bigint) to authenticated;
grant execute on function private.advance_competition_game(bigint) to authenticated;
grant execute on function private.restart_competition_game(bigint) to authenticated;

revoke all on function public.start_competition_game(bigint) from public, anon;
revoke all on function public.get_competition_round_view(bigint) from public, anon;
revoke all on function public.submit_competition_pixel_changes(bigint, jsonb) from public, anon;
revoke all on function public.get_competition_draw_updates(bigint, bigint, integer) from public, anon;
revoke all on function public.finish_competition_drawing(bigint) from public, anon;
revoke all on function public.set_competition_vote(bigint, text) from public, anon;
revoke all on function public.get_competition_results(bigint) from public, anon;
revoke all on function public.finish_competition_voting(bigint) from public, anon;
revoke all on function public.advance_competition_game(bigint) from public, anon;
revoke all on function public.restart_competition_game(bigint) from public, anon;

grant execute on function public.start_competition_game(bigint) to authenticated;
grant execute on function public.get_competition_round_view(bigint) to authenticated;
grant execute on function public.submit_competition_pixel_changes(bigint, jsonb) to authenticated;
grant execute on function public.get_competition_draw_updates(bigint, bigint, integer) to authenticated;
grant execute on function public.finish_competition_drawing(bigint) to authenticated;
grant execute on function public.set_competition_vote(bigint, text) to authenticated;
grant execute on function public.get_competition_results(bigint) to authenticated;
grant execute on function public.finish_competition_voting(bigint) to authenticated;
grant execute on function public.advance_competition_game(bigint) to authenticated;
grant execute on function public.restart_competition_game(bigint) to authenticated;
