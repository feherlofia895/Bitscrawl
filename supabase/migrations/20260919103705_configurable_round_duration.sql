-- Normal round length is a room setting. Existing rooms keep 90 seconds.
alter table public.rooms
  add column round_duration_seconds integer not null default 90
  constraint rooms_round_duration_seconds_values check (round_duration_seconds in (30, 45, 60, 75, 90));

-- The exposed RPC is invoker-only; the privileged write stays in private.
create function private.set_room_round_duration(target_room_id bigint, duration_seconds integer)
returns table (room_id bigint, round_duration_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_status text;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if duration_seconds is null or duration_seconds not in (30, 45, 60, 75, 90) then
    raise exception using errcode = 'P0001', message = 'ROUND_DURATION_INVALID';
  end if;

  select r.host_user_id, r.status into target_host_user_id, target_status
  from public.rooms as r where r.id = target_room_id for update;
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

  update public.rooms as r set round_duration_seconds = duration_seconds
  where r.id = target_room_id;
  return query select target_room_id, duration_seconds;
end;
$$;

create function public.set_room_round_duration(target_room_id bigint, duration_seconds integer)
returns table (room_id bigint, round_duration_seconds integer)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_room_round_duration(target_room_id, duration_seconds);
$$;

-- Separate RPC keeps the one-argument create_room API compatible with older clients.
-- Room creation and its chosen duration either both succeed or both roll back.
create function public.create_room_with_duration(player_name text, duration_seconds integer default 90)
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
  if duration_seconds is null or duration_seconds not in (30, 45, 60, 75, 90) then
    raise exception using errcode = 'P0001', message = 'ROUND_DURATION_INVALID';
  end if;
  select * into created_room from public.create_room(player_name);
  perform private.set_room_round_duration(created_room.room_id, duration_seconds);
  return query select created_room.room_id, created_room.room_code, created_room.player_id;
end;
$$;

revoke all on function private.set_room_round_duration(bigint, integer) from public, anon;
revoke all on function public.set_room_round_duration(bigint, integer) from public, anon;
revoke all on function public.create_room_with_duration(text, integer) from public, anon;
grant execute on function private.set_room_round_duration(bigint, integer) to authenticated;
grant execute on function public.set_room_round_duration(bigint, integer) to authenticated;
grant execute on function public.create_room_with_duration(text, integer) to authenticated;

create or replace function public.choose_round_word(target_round_id bigint, selected_word text)
returns table (round_id bigint, round_status text, chosen_word text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_drawer_user_id uuid;
  target_round_status text;
  target_test_mode boolean;
  target_duration_seconds integer;
  target_player_count integer;
  available_words text[];
  clean_word text := lower(btrim(selected_word));
  round_started_at timestamptz;
  round_ends_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, r.test_mode, r.round_duration_seconds
  into target_room_id, target_drawer_user_id, target_round_status,
       target_test_mode, target_duration_seconds
  from public.game_rounds as gr
  join public.rooms as r on r.id = gr.room_id
  where gr.id = target_round_id
  for update of gr;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;
  if target_drawer_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROUND_DRAWER';
  end if;
  if target_round_status <> 'choosing' then
    raise exception using errcode = 'P0001', message = 'ROUND_ALREADY_STARTED';
  end if;

  select count(*)::integer into target_player_count
  from public.room_players where room_id = target_room_id;
  select word_options into available_words
  from private.round_secrets where round_id = target_round_id;

  if clean_word is null or available_words is null or not (clean_word = any(available_words)) then
    raise exception using errcode = 'P0001', message = 'WORD_NOT_AVAILABLE';
  end if;

  round_started_at := clock_timestamp();
  round_ends_at := case
    when target_test_mode and target_player_count = 1 then null
    when target_test_mode then round_started_at + interval '15 seconds'
    else round_started_at + make_interval(secs => target_duration_seconds)
  end;

  update private.round_secrets set chosen_word = clean_word where round_id = target_round_id;
  update public.game_rounds
  set status = 'drawing', drawing_started_at = round_started_at, drawing_ends_at = round_ends_at
  where id = target_round_id;

  return query select target_round_id, 'drawing'::text, clean_word;
end;
$$;

revoke all on function public.choose_round_word(bigint, text) from public, anon;
grant execute on function public.choose_round_word(bigint, text) to authenticated;
