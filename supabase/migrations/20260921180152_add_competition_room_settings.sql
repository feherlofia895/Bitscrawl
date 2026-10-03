-- Competition rooms keep their settings separate from the classic round timer.
-- Existing rooms remain classic and retain all current behavior.
alter table public.rooms
  add column game_mode text not null default 'classic'
    constraint rooms_game_mode_values check (game_mode in ('classic', 'competition')),
  add column competition_draw_seconds integer not null default 90
    constraint rooms_competition_draw_seconds_values check (competition_draw_seconds in (60, 90, 120)),
  add column competition_round_count integer not null default 2
    constraint rooms_competition_round_count_values check (competition_round_count between 1 and 5);

create function private.set_room_game_settings(
  target_room_id bigint,
  requested_game_mode text,
  requested_competition_draw_seconds integer default 90,
  requested_competition_round_count integer default 2
)
returns table (
  room_id bigint,
  game_mode text,
  competition_draw_seconds integer,
  competition_round_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_status text;
  clean_game_mode text := lower(btrim(requested_game_mode));
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if clean_game_mode is null or clean_game_mode not in ('classic', 'competition') then
    raise exception using errcode = 'P0001', message = 'GAME_MODE_INVALID';
  end if;
  if requested_competition_draw_seconds is null
     or requested_competition_draw_seconds not in (60, 90, 120) then
    raise exception using errcode = 'P0001', message = 'COMPETITION_DRAW_TIME_INVALID';
  end if;
  if requested_competition_round_count is null
     or requested_competition_round_count not between 1 and 5 then
    raise exception using errcode = 'P0001', message = 'COMPETITION_ROUND_COUNT_INVALID';
  end if;

  select r.host_user_id, r.status
  into target_host_user_id, target_status
  from public.rooms as r
  where r.id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if target_host_user_id <> current_user_id or not exists (
    select 1 from public.room_players as rp
    where rp.room_id = target_room_id and rp.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;
  if target_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  update public.rooms as r
  set game_mode = clean_game_mode,
      competition_draw_seconds = requested_competition_draw_seconds,
      competition_round_count = requested_competition_round_count
  where r.id = target_room_id;

  return query
  select target_room_id, clean_game_mode,
    requested_competition_draw_seconds, requested_competition_round_count;
end;
$$;

create function public.set_room_game_settings(
  target_room_id bigint,
  requested_game_mode text,
  requested_competition_draw_seconds integer default 90,
  requested_competition_round_count integer default 2
)
returns table (
  room_id bigint,
  game_mode text,
  competition_draw_seconds integer,
  competition_round_count integer
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_room_game_settings(
    target_room_id,
    requested_game_mode,
    requested_competition_draw_seconds,
    requested_competition_round_count
  );
$$;

create function public.create_room_with_settings(
  player_name text,
  duration_seconds integer default 90,
  requested_game_mode text default 'classic',
  requested_competition_draw_seconds integer default 90,
  requested_competition_round_count integer default 2
)
returns table (room_id bigint, room_code text, player_id bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_room record;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select * into created_room
  from public.create_room_with_duration(player_name, duration_seconds);

  perform private.set_room_game_settings(
    created_room.room_id,
    requested_game_mode,
    requested_competition_draw_seconds,
    requested_competition_round_count
  );

  return query
  select created_room.room_id, created_room.room_code, created_room.player_id;
end;
$$;

revoke all on function private.set_room_game_settings(bigint, text, integer, integer) from public, anon;
revoke all on function public.set_room_game_settings(bigint, text, integer, integer) from public, anon;
revoke all on function public.create_room_with_settings(text, integer, text, integer, integer) from public, anon;
grant execute on function private.set_room_game_settings(bigint, text, integer, integer) to authenticated;
grant execute on function public.set_room_game_settings(bigint, text, integer, integer) to authenticated;
grant execute on function public.create_room_with_settings(text, integer, text, integer, integer) to authenticated;
