alter table public.room_players
  add column last_seen_at timestamptz not null default clock_timestamp();

create index room_players_room_last_seen_idx
  on public.room_players (room_id, last_seen_at desc);

create function public.resume_room(room_code text)
returns table (
  room_id bigint,
  normalized_room_code text,
  player_id bigint,
  player_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  clean_code text := upper(btrim(room_code));
  target_room_id bigint;
  resumed_player_id bigint;
  resumed_player_name text;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_code is null or clean_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception using errcode = 'P0001', message = 'ROOM_CODE_INVALID';
  end if;

  select id
  into target_room_id
  from public.rooms
  where code = clean_code;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  update public.room_players
  set last_seen_at = clock_timestamp()
  where room_id = target_room_id
    and user_id = current_user_id
  returning id, display_name
  into resumed_player_id, resumed_player_name;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_MEMBERSHIP_NOT_FOUND';
  end if;

  return query
  select target_room_id, clean_code, resumed_player_id, resumed_player_name;
end;
$$;

create function public.touch_room_presence(target_room_id bigint)
returns table (
  host_user_id uuid,
  host_changed boolean,
  round_finished boolean,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  presence_time timestamptz := clock_timestamp();
  stale_before timestamptz := presence_time - interval '45 seconds';
  target_host_user_id uuid;
  replacement_host_user_id uuid;
  active_round_id bigint;
  active_drawer_user_id uuid;
  active_round_status text;
  host_was_changed boolean := false;
  round_was_finished boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select rooms.host_user_id
  into target_host_user_id
  from public.rooms
  where id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  update public.room_players
  set last_seen_at = presence_time
  where room_id = target_room_id
    and user_id = current_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = target_room_id
      and user_id = target_host_user_id
      and last_seen_at >= stale_before
  ) then
    select user_id
    into replacement_host_user_id
    from public.room_players
    where room_id = target_room_id
      and last_seen_at >= stale_before
    order by joined_at, id
    limit 1;

    if replacement_host_user_id is not null
      and replacement_host_user_id <> target_host_user_id
    then
      update public.rooms
      set host_user_id = replacement_host_user_id
      where id = target_room_id;

      target_host_user_id := replacement_host_user_id;
      host_was_changed := true;
    end if;
  end if;

  select id, drawer_user_id, status
  into active_round_id, active_drawer_user_id, active_round_status
  from public.game_rounds
  where room_id = target_room_id
    and status in ('choosing', 'drawing')
  order by round_number desc
  limit 1
  for update;

  if found and not exists (
    select 1
    from public.room_players
    where room_id = target_room_id
      and user_id = active_drawer_user_id
      and last_seen_at >= stale_before
  ) then
    update public.game_rounds
    set status = 'finished',
        finished_at = presence_time
    where id = active_round_id;

    round_was_finished := true;
  end if;

  return query
  select target_host_user_id, host_was_changed, round_was_finished,
         presence_time;
end;
$$;

create or replace function public.join_room(room_code text, player_name text)
returns table (room_id bigint, normalized_room_code text, player_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  clean_name text := btrim(player_name);
  clean_code text := upper(btrim(room_code));
  target_room_id bigint;
  target_room_status text;
  target_max_players smallint;
  joined_player_id bigint;
  current_player_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_name is null or char_length(clean_name) not between 2 and 16 then
    raise exception using errcode = 'P0001', message = 'PLAYER_NAME_INVALID';
  end if;

  if clean_code is null or clean_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception using errcode = 'P0001', message = 'ROOM_CODE_INVALID';
  end if;

  select id, status, max_players
  into target_room_id, target_room_status, target_max_players
  from public.rooms
  where code = clean_code
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  update public.room_players
  set last_seen_at = clock_timestamp()
  where room_id = target_room_id
    and user_id = current_user_id
  returning id into joined_player_id;

  if found then
    return query
    select target_room_id, clean_code, joined_player_id;
    return;
  end if;

  if target_room_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'ROOM_ALREADY_STARTED';
  end if;

  select count(*)::integer
  into current_player_count
  from public.room_players
  where room_id = target_room_id;

  if current_player_count >= target_max_players then
    raise exception using errcode = 'P0001', message = 'ROOM_FULL';
  end if;

  if exists (
    select 1
    from public.room_players
    where room_id = target_room_id
      and lower(display_name) = lower(clean_name)
  ) then
    raise exception using errcode = 'P0001', message = 'PLAYER_NAME_TAKEN';
  end if;

  begin
    insert into public.room_players (room_id, user_id, display_name)
    values (target_room_id, current_user_id, clean_name)
    returning id into joined_player_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'PLAYER_NAME_TAKEN';
  end;

  return query
  select target_room_id, clean_code, joined_player_id;
end;
$$;

create or replace function public.start_game(target_room_id bigint)
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
  target_test_mode boolean;
  current_player_count integer;
  first_drawer_user_id uuid;
  round_word_options text[];
  created_round_id bigint;
  game_started_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select host_user_id, status, test_mode
  into target_host_user_id, target_room_status, target_test_mode
  from public.rooms
  where id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_host_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;

  if target_room_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  select count(*)::integer
  into current_player_count
  from public.room_players
  where room_id = target_room_id
    and last_seen_at >= clock_timestamp() - interval '45 seconds';

  if current_player_count < (case when target_test_mode then 1 else 2 end) then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_ACTIVE_PLAYERS';
  end if;

  select user_id
  into first_drawer_user_id
  from public.room_players
  where room_id = target_room_id
    and last_seen_at >= clock_timestamp() - interval '45 seconds'
  order by joined_at, id
  limit 1;

  select array_agg(random_words.word)
  into round_word_options
  from (
    select word
    from private.word_bank
    order by random()
    limit 3
  ) as random_words;

  if cardinality(round_word_options) <> 3 then
    raise exception using errcode = 'P0001', message = 'WORD_BANK_TOO_SMALL';
  end if;

  game_started_at := clock_timestamp();

  update public.room_players
  set score = 0
  where room_id = target_room_id;

  update public.rooms
  set status = 'playing',
      started_at = game_started_at,
      finished_at = null
  where id = target_room_id;

  insert into public.game_rounds (room_id, round_number, drawer_user_id)
  values (target_room_id, 1, first_drawer_user_id)
  returning id into created_round_id;

  insert into private.round_secrets (round_id, word_options)
  values (created_round_id, round_word_options);

  return query
  select target_room_id, 'playing'::text, game_started_at;
end;
$$;

create or replace function public.advance_game(target_round_id bigint)
returns table (
  room_id bigint,
  room_status text,
  next_round_id bigint,
  next_round_number smallint
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_room_status text;
  latest_round_id bigint;
  latest_round_number smallint;
  latest_round_status text;
  latest_finished_at timestamptz;
  current_player_count integer;
  active_player_count integer;
  created_round_number smallint;
  next_drawer_user_id uuid;
  round_word_options text[];
  created_round_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select gr.room_id
  into target_room_id
  from public.game_rounds as gr
  where gr.id = target_round_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  select status
  into target_room_status
  from public.rooms
  where id = target_room_id
  for update;

  if target_room_status = 'finished' then
    return query
    select target_room_id, 'finished'::text, null::bigint, null::smallint;
    return;
  end if;

  if target_room_status <> 'playing' then
    raise exception using errcode = 'P0001', message = 'GAME_NOT_PLAYING';
  end if;

  select id, round_number, status, finished_at
  into latest_round_id, latest_round_number, latest_round_status,
       latest_finished_at
  from public.game_rounds
  where room_id = target_room_id
  order by round_number desc
  limit 1
  for update;

  if latest_round_id <> target_round_id then
    return query
    select target_room_id, 'playing'::text, latest_round_id,
           latest_round_number;
    return;
  end if;

  if latest_round_status <> 'finished' or latest_finished_at is null then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FINISHED';
  end if;

  if clock_timestamp() < latest_finished_at + interval '5 seconds' then
    raise exception using errcode = 'P0001', message = 'ROUND_TRANSITION_PENDING';
  end if;

  select count(*)::integer
  into current_player_count
  from public.room_players
  where room_id = target_room_id;

  if latest_round_number >= current_player_count * 3 then
    update public.rooms
    set status = 'finished',
        finished_at = clock_timestamp()
    where id = target_room_id;

    return query
    select target_room_id, 'finished'::text, null::bigint, null::smallint;
    return;
  end if;

  select count(*)::integer
  into active_player_count
  from public.room_players
  where room_id = target_room_id
    and last_seen_at >= clock_timestamp() - interval '45 seconds';

  if active_player_count = 0 then
    raise exception using errcode = 'P0001', message = 'NO_ACTIVE_PLAYERS';
  end if;

  created_round_number := (latest_round_number + 1)::smallint;

  select user_id
  into next_drawer_user_id
  from public.room_players
  where room_id = target_room_id
    and last_seen_at >= clock_timestamp() - interval '45 seconds'
  order by joined_at, id
  offset ((created_round_number - 1) % active_player_count)
  limit 1;

  select array_agg(random_words.word)
  into round_word_options
  from (
    select word
    from private.word_bank
    order by random()
    limit 3
  ) as random_words;

  if cardinality(round_word_options) <> 3 then
    raise exception using errcode = 'P0001', message = 'WORD_BANK_TOO_SMALL';
  end if;

  insert into public.game_rounds (room_id, round_number, drawer_user_id)
  values (target_room_id, created_round_number, next_drawer_user_id)
  returning id into created_round_id;

  insert into private.round_secrets (round_id, word_options)
  values (created_round_id, round_word_options);

  return query
  select target_room_id, 'playing'::text, created_round_id,
         created_round_number;
end;
$$;

create or replace function public.restart_game(target_room_id bigint)
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
  target_test_mode boolean;
  current_player_count integer;
  first_drawer_user_id uuid;
  round_word_options text[];
  created_round_id bigint;
  game_started_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select host_user_id, status, test_mode
  into target_host_user_id, target_room_status, target_test_mode
  from public.rooms
  where id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_host_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;

  if target_room_status <> 'finished' then
    raise exception using errcode = 'P0001', message = 'GAME_NOT_FINISHED';
  end if;

  select count(*)::integer
  into current_player_count
  from public.room_players
  where room_id = target_room_id
    and last_seen_at >= clock_timestamp() - interval '45 seconds';

  if current_player_count < (case when target_test_mode then 1 else 2 end) then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_ACTIVE_PLAYERS';
  end if;

  select user_id
  into first_drawer_user_id
  from public.room_players
  where room_id = target_room_id
    and last_seen_at >= clock_timestamp() - interval '45 seconds'
  order by joined_at, id
  limit 1;

  select array_agg(random_words.word)
  into round_word_options
  from (
    select word
    from private.word_bank
    order by random()
    limit 3
  ) as random_words;

  if cardinality(round_word_options) <> 3 then
    raise exception using errcode = 'P0001', message = 'WORD_BANK_TOO_SMALL';
  end if;

  game_started_at := clock_timestamp();

  delete from public.game_rounds
  where room_id = target_room_id;

  update public.room_players
  set score = 0
  where room_id = target_room_id;

  update public.rooms
  set status = 'playing',
      started_at = game_started_at,
      finished_at = null
  where id = target_room_id;

  insert into public.game_rounds (room_id, round_number, drawer_user_id)
  values (target_room_id, 1, first_drawer_user_id)
  returning id into created_round_id;

  insert into private.round_secrets (round_id, word_options)
  values (created_round_id, round_word_options);

  return query
  select target_room_id, 'playing'::text, game_started_at;
end;
$$;

revoke all on function public.resume_room(text) from public, anon;
revoke all on function public.touch_room_presence(bigint) from public, anon;

grant execute on function public.resume_room(text) to authenticated;
grant execute on function public.touch_room_presence(bigint) to authenticated;
