-- New rooms stay on the 12-color palette. Existing 16-color rooms remain playable,
-- but neither the current nor a manipulated legacy client can enable that mode again.
create function private.set_room_palette_size(
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

  select r.host_user_id, r.status
  into target_host_user_id, target_room_status
  from public.rooms as r
  where r.id = target_room_id
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
  if palette_size_value is null or palette_size_value <> 12 then
    raise exception using errcode = 'P0001', message = 'PALETTE_SIZE_UNAVAILABLE';
  end if;

  update public.rooms as r
  set palette_size = 12
  where r.id = target_room_id;

  return query select target_room_id, 12::smallint;
end;
$$;

create or replace function public.set_room_palette_size(
  target_room_id bigint,
  palette_size_value smallint
)
returns table (room_id bigint, palette_size smallint)
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_room_palette_size(target_room_id, palette_size_value);
$$;

revoke all on function private.set_room_palette_size(bigint, smallint) from public, anon;
revoke all on function public.set_room_palette_size(bigint, smallint) from public, anon;
grant execute on function private.set_room_palette_size(bigint, smallint) to authenticated;
grant execute on function public.set_room_palette_size(bigint, smallint) to authenticated;
