-- PL/pgSQL output column names are variables too. Prefer table columns when
-- an output name (for example room_id) matches a column used in the function.
create or replace function public.create_room(player_name text)
returns table (room_id bigint, room_code text, player_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  clean_name text := btrim(player_name);
  generated_code text;
  random_bytes bytea;
  created_room_id bigint;
  created_player_id bigint;
  attempt integer;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_name is null or char_length(clean_name) not between 2 and 16 then
    raise exception using errcode = 'P0001', message = 'PLAYER_NAME_INVALID';
  end if;

  for attempt in 1..10 loop
    random_bytes := extensions.gen_random_bytes(6);

    select string_agg(
      substr(
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
        (get_byte(random_bytes, byte_position) % 32) + 1,
        1
      ),
      '' order by byte_position
    )
    into generated_code
    from generate_series(0, 5) as byte_position;

    begin
      insert into public.rooms (code, host_user_id)
      values (generated_code, current_user_id)
      returning id into created_room_id;

      exit;
    exception
      when unique_violation then
        if attempt = 10 then
          raise exception using errcode = 'P0001', message = 'ROOM_CODE_GENERATION_FAILED';
        end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, display_name)
  values (created_room_id, current_user_id, clean_name)
  returning id into created_player_id;

  return query
  select created_room_id, generated_code, created_player_id;
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

  select id
  into joined_player_id
  from public.room_players
  where room_id = target_room_id
    and user_id = current_user_id;

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
