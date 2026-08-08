alter table public.rooms
  add column started_at timestamptz;

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
  current_player_count integer;
  game_started_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select host_user_id, status
  into target_host_user_id, target_room_status
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

  if current_player_count < 2 then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;

  game_started_at := now();

  update public.rooms
  set status = 'playing',
      started_at = game_started_at
  where id = target_room_id;

  return query
  select target_room_id, 'playing'::text, game_started_at;
end;
$$;

revoke all on function public.start_game(bigint) from public, anon;
grant execute on function public.start_game(bigint) to authenticated;
