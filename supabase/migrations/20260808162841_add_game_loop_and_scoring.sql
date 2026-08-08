alter table public.game_rounds
  add column finished_at timestamptz;

update public.game_rounds
set finished_at = coalesce(drawing_ends_at, drawing_started_at, created_at)
where status = 'finished'
  and finished_at is null;

alter table public.game_rounds
  add constraint game_rounds_finished_state check (
    (status = 'finished') = (finished_at is not null)
  );

alter table public.rooms
  add column finished_at timestamptz;

update public.rooms
set finished_at = coalesce(started_at, created_at)
where status = 'finished'
  and finished_at is null;

alter table public.rooms
  add constraint rooms_finished_state check (
    (status = 'finished') = (finished_at is not null)
  );

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
  where room_id = target_room_id;

  if current_player_count < (case when target_test_mode then 1 else 2 end) then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;

  select user_id
  into first_drawer_user_id
  from public.room_players
  where room_id = target_room_id
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

drop function public.get_round_view(bigint);

create function public.get_round_view(target_room_id bigint)
returns table (
  round_id bigint,
  round_number smallint,
  total_rounds integer,
  round_status text,
  drawer_user_id uuid,
  is_drawer boolean,
  word_options text[],
  chosen_word text,
  drawing_ends_at timestamptz,
  finished_at timestamptz,
  next_round_at timestamptz,
  correct_guess_count integer,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  active_round_id bigint;
  active_round_number smallint;
  active_round_status text;
  active_drawer_user_id uuid;
  active_word_options text[];
  active_chosen_word text;
  active_drawing_ends_at timestamptz;
  active_finished_at timestamptz;
  room_total_rounds integer;
  room_correct_guess_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  select count(*)::integer * 3
  into room_total_rounds
  from public.room_players
  where room_id = target_room_id;

  select gr.id, gr.round_number, gr.status, gr.drawer_user_id,
         secrets.word_options, secrets.chosen_word, gr.drawing_ends_at,
         gr.finished_at
  into active_round_id, active_round_number, active_round_status,
       active_drawer_user_id, active_word_options, active_chosen_word,
       active_drawing_ends_at, active_finished_at
  from public.game_rounds as gr
  join private.round_secrets as secrets on secrets.round_id = gr.id
  where gr.room_id = target_room_id
  order by gr.round_number desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  select count(*)::integer
  into room_correct_guess_count
  from public.round_messages
  where round_id = active_round_id
    and kind = 'correct';

  return query
  select
    active_round_id,
    active_round_number,
    room_total_rounds,
    active_round_status,
    active_drawer_user_id,
    current_user_id = active_drawer_user_id,
    case
      when current_user_id = active_drawer_user_id
        and active_round_status = 'choosing'
      then active_word_options
      else null::text[]
    end,
    case
      when current_user_id = active_drawer_user_id
        or active_round_status = 'finished'
      then active_chosen_word
      else null::text
    end,
    active_drawing_ends_at,
    active_finished_at,
    case
      when active_round_status = 'finished'
      then active_finished_at + interval '5 seconds'
      else null::timestamptz
    end,
    room_correct_guess_count,
    clock_timestamp();
end;
$$;

drop function public.submit_guess(bigint, text);

create function public.submit_guess(
  target_round_id bigint,
  submitted_guess text
)
returns table (
  message_id bigint,
  is_correct boolean,
  awarded_points integer,
  round_finished boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  clean_guess text := btrim(submitted_guess);
  target_room_id bigint;
  target_drawer_user_id uuid;
  target_round_status text;
  target_drawing_started_at timestamptz;
  target_drawing_ends_at timestamptz;
  target_word text;
  guess_is_correct boolean;
  guess_time timestamptz;
  guesser_points integer := 0;
  created_message_id bigint;
  current_player_count integer;
  current_correct_count integer;
  round_was_finished boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_guess is null or char_length(clean_guess) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'GUESS_INVALID';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, gr.drawing_started_at,
         gr.drawing_ends_at, secrets.chosen_word
  into target_room_id, target_drawer_user_id, target_round_status,
       target_drawing_started_at, target_drawing_ends_at, target_word
  from public.game_rounds as gr
  join private.round_secrets as secrets on secrets.round_id = gr.id
  where gr.id = target_round_id
  for update of gr;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_drawer_user_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'DRAWER_CANNOT_GUESS';
  end if;

  if target_round_status <> 'drawing' or target_word is null then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  guess_time := clock_timestamp();

  if target_drawing_ends_at is null or guess_time >= target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
  end if;

  if exists (
    select 1
    from public.round_messages
    where round_id = target_round_id
      and sender_user_id = current_user_id
      and kind = 'correct'
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_GUESSED';
  end if;

  guess_is_correct :=
    private.normalize_answer(clean_guess) = private.normalize_answer(target_word);

  if guess_is_correct then
    guesser_points := least(
      500,
      greatest(
        100,
        100 + round(
          400 * greatest(
            0,
            extract(epoch from (target_drawing_ends_at - guess_time))
          ) / nullif(
            extract(epoch from (
              target_drawing_ends_at - target_drawing_started_at
            )),
            0
          )
        )::integer
      )
    );
  end if;

  insert into public.round_messages (
    round_id,
    room_id,
    sender_user_id,
    kind,
    content
  )
  values (
    target_round_id,
    target_room_id,
    current_user_id,
    case when guess_is_correct then 'correct' else 'guess' end,
    case when guess_is_correct then null else clean_guess end
  )
  returning id into created_message_id;

  if guess_is_correct then
    update public.room_players
    set score = score + case
      when user_id = current_user_id then guesser_points
      when user_id = target_drawer_user_id then 100
      else 0
    end
    where room_id = target_room_id
      and user_id in (current_user_id, target_drawer_user_id);

    select count(*)::integer
    into current_player_count
    from public.room_players
    where room_id = target_room_id;

    select count(*)::integer
    into current_correct_count
    from public.round_messages
    where round_id = target_round_id
      and kind = 'correct';

    if current_player_count > 1
      and current_correct_count >= current_player_count - 1
    then
      update public.game_rounds
      set status = 'finished',
          finished_at = guess_time
      where id = target_round_id;

      round_was_finished := true;
    end if;
  end if;

  return query
  select created_message_id, guess_is_correct, guesser_points,
         round_was_finished;
end;
$$;

create or replace function public.finish_expired_round(target_round_id bigint)
returns table (round_id bigint, round_status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_round_status text;
  target_drawing_ends_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select room_id, status, drawing_ends_at
  into target_room_id, target_round_status, target_drawing_ends_at
  from public.game_rounds
  where id = target_round_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_round_status = 'finished' then
    return query select target_round_id, 'finished'::text;
    return;
  end if;

  if target_round_status <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  if target_drawing_ends_at is null or clock_timestamp() < target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_REMAINING';
  end if;

  update public.game_rounds
  set status = 'finished',
      finished_at = clock_timestamp()
  where id = target_round_id;

  return query select target_round_id, 'finished'::text;
end;
$$;

create function public.advance_game(target_round_id bigint)
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

  created_round_number := (latest_round_number + 1)::smallint;

  select user_id
  into next_drawer_user_id
  from public.room_players
  where room_id = target_room_id
  order by joined_at, id
  offset ((created_round_number - 1) % current_player_count)
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

create function public.restart_game(target_room_id bigint)
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
  where room_id = target_room_id;

  if current_player_count < (case when target_test_mode then 1 else 2 end) then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;

  select user_id
  into first_drawer_user_id
  from public.room_players
  where room_id = target_room_id
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

revoke all on function public.get_round_view(bigint) from public, anon;
revoke all on function public.submit_guess(bigint, text) from public, anon;
revoke all on function public.advance_game(bigint) from public, anon;
revoke all on function public.restart_game(bigint) from public, anon;

grant execute on function public.get_round_view(bigint) to authenticated;
grant execute on function public.submit_guess(bigint, text) to authenticated;
grant execute on function public.advance_game(bigint) to authenticated;
grant execute on function public.restart_game(bigint) to authenticated;
