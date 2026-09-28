create or replace function private.start_competition_game(target_room_id bigint)
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
  if current_player_count < 2 then
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

comment on function private.start_competition_game(bigint) is
  'Starts a parallel drawing competition when the room has at least two players.';
