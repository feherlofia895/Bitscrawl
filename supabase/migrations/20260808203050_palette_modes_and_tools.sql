alter table public.rooms
  add column palette_size smallint not null default 8
  constraint rooms_palette_size_check check (palette_size in (8, 16));

create or replace function public.set_room_palette_size(
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
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if palette_size_value not in (8, 16) then
    raise exception using errcode = 'P0001', message = 'PALETTE_SIZE_INVALID';
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
    raise exception using errcode = 'P0001', message = 'ROOM_ALREADY_STARTED';
  end if;

  update public.rooms
  set palette_size = palette_size_value
  where id = target_room_id;

  return query select target_room_id, palette_size_value;
end;
$$;

create or replace function public.submit_pixel_changes(
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
  target_drawer_user_id uuid;
  target_round_status text;
  target_drawing_ends_at timestamptz;
  target_test_mode boolean;
  target_palette_size smallint;
  target_player_count integer;
  created_event_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, gr.drawing_ends_at,
         rooms.test_mode, rooms.palette_size
  into target_room_id, target_drawer_user_id, target_round_status,
       target_drawing_ends_at, target_test_mode, target_palette_size
  from public.game_rounds as gr
  join public.rooms as rooms on rooms.id = gr.room_id
  where gr.id = target_round_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if target_drawer_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROUND_DRAWER';
  end if;

  if target_round_status <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  select count(*)::integer
  into target_player_count
  from public.room_players
  where room_id = target_room_id;

  if target_drawing_ends_at is null then
    if not target_test_mode or target_player_count <> 1 then
      raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
    end if;
  elsif clock_timestamp() >= target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
  end if;

  if pixel_changes is null
    or jsonb_typeof(pixel_changes) <> 'array'
    or jsonb_array_length(pixel_changes) not between 1 and 64
  then
    raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(pixel_changes) as pixel(change)
    where jsonb_typeof(pixel.change) <> 'object'
      or not (pixel.change ? 'x' and pixel.change ? 'y' and pixel.change ? 'color')
      or coalesce(pixel.change->>'x', '') !~ '^(0|[1-9]|[12][0-9]|3[01])$'
      or coalesce(pixel.change->>'y', '') !~ '^(0|[1-9]|[12][0-9]|3[01])$'
      or (
        coalesce(pixel.change->>'color', '') not in (
          '#241a35', '#f7f3e8', '#9b7ede', '#4ecdc4', '#ffd166',
          '#ff6b6b', '#4d96ff', '#7b8794', 'transparent'
        )
        and (
          target_palette_size <> 16
          or coalesce(pixel.change->>'color', '') not in (
            '#120d1c', '#c9c1ad', '#6446a6', '#247f7a', '#b97818',
            '#b83f4d', '#285bb8', '#4e5965'
          )
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID';
  end if;

  insert into public.round_draw_events (
    round_id,
    room_id,
    created_by,
    changes
  )
  values (
    target_round_id,
    target_room_id,
    current_user_id,
    pixel_changes
  )
  returning id into created_event_id;

  return created_event_id;
end;
$$;

revoke all on function public.set_room_palette_size(bigint, smallint)
  from public, anon;
grant execute on function public.set_room_palette_size(bigint, smallint)
  to authenticated;

revoke all on function public.submit_pixel_changes(bigint, jsonb)
  from public, anon;
grant execute on function public.submit_pixel_changes(bigint, jsonb)
  to authenticated;
