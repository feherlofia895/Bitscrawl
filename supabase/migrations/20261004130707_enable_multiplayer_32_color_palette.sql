-- Version room palettes explicitly so multiplayer validation stays stable when
-- the editor palette changes in a later release.
alter table public.rooms
  add column palette_id text;

update public.rooms
set palette_id = case palette_size
  when 16 then 'legacy-16-v1'
  else 'base-12-v1'
end;

alter table public.rooms
  alter column palette_id set default 'base-12-v1',
  alter column palette_id set not null,
  add constraint rooms_palette_id_values
    check (palette_id in ('base-12-v1', 'legacy-16-v1', 'editor-32-v1'));

alter table public.rooms
  drop constraint rooms_palette_size_check,
  add constraint rooms_palette_size_check check (palette_size in (12, 16, 32)),
  add constraint rooms_palette_version_matches_size check (
    (palette_size = 12 and palette_id = 'base-12-v1')
    or (palette_size = 16 and palette_id = 'legacy-16-v1')
    or (palette_size = 32 and palette_id = 'editor-32-v1')
  );

create function private.room_palette_color_valid(
  requested_palette_id text,
  candidate_color text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when candidate_color = 'transparent' then true
    when requested_palette_id = 'base-12-v1' then candidate_color in (
      '#d3493b', '#da7149', '#e29958', '#f5e57a',
      '#a5d967', '#67ba62', '#549d8c', '#33567e',
      '#221a5f', '#999ea1', '#242630', '#230a19'
    )
    when requested_palette_id = 'legacy-16-v1' then candidate_color in (
      '#e8d7b8', '#241a35', '#5f7443', '#8fa66a',
      '#6446a6', '#9b7ede', '#247f7a', '#4ecdc4',
      '#b97818', '#ffd166', '#b83f4d', '#ff6b6b',
      '#285bb8', '#4d96ff', '#8f4f35', '#c9825b'
    )
    when requested_palette_id = 'editor-32-v1' then candidate_color in (
      '#f7f3e8', '#d8cfbd', '#999ea1', '#66707a',
      '#3f4650', '#242630', '#230a19', '#0f111a',
      '#7d2d3b', '#d3493b', '#f25c54', '#da7149',
      '#e29958', '#f2b35d', '#f5e57a', '#fff1a8',
      '#4d5b32', '#718441', '#a5d967', '#d4eb7a',
      '#2e6b4f', '#67ba62', '#549d8c', '#79cbb8',
      '#1e4957', '#347f8c', '#33567e', '#4b79b8',
      '#221a5f', '#51439a', '#8d5a9f', '#c57ca8'
    )
    else false
  end
$$;

-- A shared trigger covers classic and competition draw streams. The older RPCs
-- continue checking coordinates and payload size; this central guard owns the
-- versioned color allowlist and also protects future write paths.
create function private.validate_room_palette_draw_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_palette_id text;
begin
  select room.palette_id
  into target_palette_id
  from public.rooms room
  where room.id = new.room_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.changes) as pixel(change)
    where not private.room_palette_color_valid(
      target_palette_id,
      coalesce(pixel.change->>'color', '')
    )
  ) then
    raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID';
  end if;

  return new;
end;
$$;

create trigger round_draw_events_palette_guard
before insert or update of room_id, changes
on public.round_draw_events
for each row execute function private.validate_room_palette_draw_event();

create trigger competition_draw_events_palette_guard
before insert or update of room_id, changes
on public.competition_draw_events
for each row execute function private.validate_room_palette_draw_event();

create or replace function private.set_room_palette_size(
  target_room_id bigint,
  palette_size_value smallint
)
returns table (room_id bigint, palette_size smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_room_status text;
  requested_palette_id text;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
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
  if palette_size_value = 16 then
    raise exception using errcode = 'P0001', message = 'PALETTE_SIZE_UNAVAILABLE';
  end if;
  if palette_size_value is null or palette_size_value not in (12, 32) then
    raise exception using errcode = 'P0001', message = 'PALETTE_SIZE_INVALID';
  end if;

  requested_palette_id := case palette_size_value
    when 32 then 'editor-32-v1'
    else 'base-12-v1'
  end;

  update public.rooms room
  set palette_size = palette_size_value,
      palette_id = requested_palette_id
  where room.id = target_room_id;

  return query select target_room_id, palette_size_value;
end;
$$;

create function public.create_room_with_palette_settings(
  player_name text,
  duration_seconds integer default 90,
  requested_game_mode text default 'classic',
  requested_competition_draw_seconds integer default 90,
  requested_competition_round_count integer default 2,
  requested_palette_size smallint default 12
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
  from public.create_room_with_settings(
    player_name,
    duration_seconds,
    requested_game_mode,
    requested_competition_draw_seconds,
    requested_competition_round_count
  );

  perform private.set_room_palette_size(created_room.room_id, requested_palette_size);

  return query
  select created_room.room_id, created_room.room_code, created_room.player_id;
end;
$$;

revoke all on function private.room_palette_color_valid(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_room_palette_draw_event()
  from public, anon, authenticated, service_role;
revoke all on function private.set_room_palette_size(bigint, smallint)
  from public, anon, authenticated, service_role;
revoke all on function public.create_room_with_palette_settings(text, integer, text, integer, integer, smallint)
  from public, anon, authenticated, service_role;

grant execute on function private.set_room_palette_size(bigint, smallint)
  to authenticated, service_role;
grant execute on function public.create_room_with_palette_settings(text, integer, text, integer, integer, smallint)
  to authenticated, service_role;

comment on column public.rooms.palette_id is
  'Versioned multiplayer palette identifier used for server-side pixel validation.';
comment on function private.room_palette_color_valid(text, text) is
  'Checks one multiplayer pixel color against a versioned room palette.';
comment on function public.create_room_with_palette_settings(text, integer, text, integer, integer, smallint) is
  'Creates a room atomically with game, timer, competition, and versioned palette settings.';
