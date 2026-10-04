-- Public room discovery deliberately exposes a separate random listing token,
-- never the invite code or the internal room id. Existing rooms stay private.
alter table public.rooms
  add column room_name text,
  add column is_public boolean not null default false,
  add column listing_id uuid not null
    default (encode(extensions.gen_random_bytes(16), 'hex')::uuid),
  add column public_listed_at timestamptz,
  add constraint rooms_public_name_required check (
    not is_public or room_name is not null
  ),
  add constraint rooms_room_name_format check (
    room_name is null or (
      room_name = btrim(room_name)
      and char_length(room_name) between 3 and 28
      and room_name ~ '^[[:alnum:]ÁÉÍÓÖŐÚÜŰáéíóöőúüű _-]+$'
      and room_name ~ '[[:alnum:]ÁÉÍÓÖŐÚÜŰáéíóöőúüű]'
      and room_name !~ '[[:space:]]{2,}'
    )
  );

create unique index rooms_listing_id_unique
  on public.rooms (listing_id);

create unique index rooms_one_public_waiting_room_per_host
  on public.rooms (host_user_id)
  where is_public and status = 'waiting';

create index rooms_public_waiting_list_idx
  on public.rooms (public_listed_at desc, id desc)
  where is_public and status = 'waiting';

create function private.set_room_listing(
  target_room_id bigint,
  requested_room_name text,
  requested_is_public boolean
)
returns table (room_id bigint, room_name text, is_public boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_room_status text;
  clean_name text := nullif(btrim(requested_room_name), '');
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if requested_is_public is null then
    raise exception using errcode = 'P0001', message = 'ROOM_LISTING_INVALID';
  end if;

  select room.host_user_id, room.status
  into target_host_user_id, target_room_status
  from public.rooms room
  where room.id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;
  if target_host_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;
  if target_room_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'ROOM_ALREADY_STARTED';
  end if;

  if requested_is_public and (
    clean_name is null
    or char_length(clean_name) not between 3 and 28
    or clean_name !~ '^[[:alnum:]ÁÉÍÓÖŐÚÜŰáéíóöőúüű _-]+$'
    or clean_name !~ '[[:alnum:]ÁÉÍÓÖŐÚÜŰáéíóöőúüű]'
    or clean_name ~ '[[:space:]]{2,}'
  ) then
    raise exception using errcode = 'P0001', message = 'ROOM_NAME_INVALID';
  end if;

  if requested_is_public and exists (
    select 1
    from public.rooms other_room
    where other_room.host_user_id = current_user_id
      and other_room.is_public
      and other_room.status = 'waiting'
      and other_room.id <> target_room_id
  ) then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ROOM_LIMIT';
  end if;

  begin
    update public.rooms room
    set room_name = case when requested_is_public then clean_name else null end,
        is_public = requested_is_public,
        public_listed_at = case
          when requested_is_public and not room.is_public then clock_timestamp()
          when requested_is_public then room.public_listed_at
          else null
        end
    where room.id = target_room_id;
  exception
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'PUBLIC_ROOM_LIMIT';
  end;

  return query
  select room.id, room.room_name, room.is_public
  from public.rooms room
  where room.id = target_room_id;
end;
$$;

create function public.set_room_listing(
  target_room_id bigint,
  requested_room_name text,
  requested_is_public boolean
)
returns table (room_id bigint, room_name text, is_public boolean)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.set_room_listing(
    target_room_id,
    requested_room_name,
    requested_is_public
  )
$$;

create function public.create_room_with_listing_settings(
  player_name text,
  duration_seconds integer default 90,
  requested_game_mode text default 'classic',
  requested_competition_draw_seconds integer default 90,
  requested_competition_round_count integer default 2,
  requested_palette_size smallint default 12,
  requested_room_name text default null,
  requested_is_public boolean default false
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
  from public.create_room_with_palette_settings(
    player_name,
    duration_seconds,
    requested_game_mode,
    requested_competition_draw_seconds,
    requested_competition_round_count,
    requested_palette_size
  );

  perform private.set_room_listing(
    created_room.room_id,
    requested_room_name,
    requested_is_public
  );

  return query
  select created_room.room_id, created_room.room_code, created_room.player_id;
end;
$$;

create function private.list_public_rooms(search_term text default null)
returns table (
  listing_id uuid,
  room_name text,
  host_name text,
  player_count integer,
  max_players smallint,
  game_mode text,
  palette_size smallint,
  public_listed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clean_search text := nullif(btrim(search_term), '');
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if clean_search is not null and char_length(clean_search) > 40 then
    raise exception using errcode = 'P0001', message = 'ROOM_SEARCH_INVALID';
  end if;

  return query
  select
    room.listing_id,
    room.room_name,
    host_player.display_name,
    members.player_count,
    room.max_players,
    room.game_mode,
    room.palette_size,
    room.public_listed_at
  from public.rooms room
  join public.room_players host_player
    on host_player.room_id = room.id
   and host_player.user_id = room.host_user_id
  cross join lateral (
    select count(*)::integer as player_count
    from public.room_players player
    where player.room_id = room.id
  ) members
  where room.is_public
    and room.status = 'waiting'
    and members.player_count < room.max_players
    and (
      clean_search is null
      or position(lower(clean_search) in lower(room.room_name)) > 0
      or position(lower(clean_search) in lower(host_player.display_name)) > 0
    )
  order by room.public_listed_at desc, room.id desc
  limit 30;
end;
$$;

create function public.list_public_rooms(search_term text default null)
returns table (
  listing_id uuid,
  room_name text,
  host_name text,
  player_count integer,
  max_players smallint,
  game_mode text,
  palette_size smallint,
  public_listed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_public_rooms(search_term)
$$;

create function private.join_public_room(
  requested_listing_id uuid,
  player_name text
)
returns table (room_id bigint, normalized_room_code text, player_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room_code text;
  joined_room record;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;
  if requested_listing_id is null then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ROOM_NOT_FOUND';
  end if;

  select room.code
  into target_room_code
  from public.rooms room
  where room.listing_id = requested_listing_id
    and room.is_public
    and room.status = 'waiting'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLIC_ROOM_NOT_FOUND';
  end if;

  select * into joined_room
  from private.join_room(target_room_code, player_name);

  return query
  select joined_room.room_id, joined_room.normalized_room_code, joined_room.player_id;
end;
$$;

create function public.join_public_room(
  requested_listing_id uuid,
  player_name text
)
returns table (room_id bigint, normalized_room_code text, player_id bigint)
language sql
security invoker
set search_path = ''
as $$
  select * from private.join_public_room(requested_listing_id, player_name)
$$;

revoke all on function private.set_room_listing(bigint, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.list_public_rooms(text)
  from public, anon, authenticated, service_role;
revoke all on function private.join_public_room(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.set_room_listing(bigint, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.create_room_with_listing_settings(text, integer, text, integer, integer, smallint, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.list_public_rooms(text)
  from public, anon, authenticated, service_role;
revoke all on function public.join_public_room(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function private.set_room_listing(bigint, text, boolean)
  to authenticated, service_role;
grant execute on function private.list_public_rooms(text)
  to authenticated, service_role;
grant execute on function private.join_public_room(uuid, text)
  to authenticated, service_role;
grant execute on function public.set_room_listing(bigint, text, boolean)
  to authenticated, service_role;
grant execute on function public.create_room_with_listing_settings(text, integer, text, integer, integer, smallint, text, boolean)
  to authenticated, service_role;
grant execute on function public.list_public_rooms(text)
  to authenticated, service_role;
grant execute on function public.join_public_room(uuid, text)
  to authenticated, service_role;

comment on column public.rooms.listing_id is
  'Opaque identifier used for public discovery without exposing the invite code or room id.';
comment on function public.list_public_rooms(text) is
  'Lists safe metadata for waiting, non-full public rooms, up to 30 results.';
comment on function public.join_public_room(uuid, text) is
  'Joins a currently listed public room without revealing its invite code beforehand.';
