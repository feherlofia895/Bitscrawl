alter table public.profiles
  add column avatar_pixels jsonb;

alter table public.room_players
  add column avatar_pixels jsonb;

create function private.profile_avatar_pixels_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select candidate is null or (
    jsonb_typeof(candidate) = 'array'
    and jsonb_array_length(candidate) = 1024
    and not exists (
      select 1 from jsonb_array_elements_text(candidate) as pixel(color)
      where pixel.color not in (
        'transparent', '#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967',
        '#67ba62', '#549d8c', '#33567e', '#221a5f', '#999ea1', '#242630', '#230a19'
      )
    )
  );
$$;

alter table public.profiles
  add constraint profiles_avatar_pixels_valid
  check (private.profile_avatar_pixels_valid(avatar_pixels));

alter table public.room_players
  add constraint room_players_avatar_pixels_valid
  check (private.profile_avatar_pixels_valid(avatar_pixels));

create function private.set_profile_avatar(requested_pixels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if requested_pixels is null or not private.profile_avatar_pixels_valid(requested_pixels) then
    raise exception using errcode = 'P0001', message = 'PROFILE_AVATAR_INVALID';
  end if;

  update public.profiles as p
  set avatar_pixels = requested_pixels
  where p.user_id = current_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  return requested_pixels;
end;
$$;

create function private.copy_profile_avatar_to_room_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.avatar_pixels into new.avatar_pixels
  from public.profiles as p
  where p.user_id = new.user_id;
  return new;
end;
$$;

create trigger room_players_copy_profile_avatar
before insert or update of user_id on public.room_players
for each row execute function private.copy_profile_avatar_to_room_player();

create function private.sync_profile_avatar_to_rooms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.room_players as rp
  set avatar_pixels = new.avatar_pixels
  where rp.user_id = new.user_id;
  return new;
end;
$$;

create trigger profiles_sync_avatar_to_rooms
after update of avatar_pixels on public.profiles
for each row execute function private.sync_profile_avatar_to_rooms();

update public.room_players as rp
set avatar_pixels = p.avatar_pixels
from public.profiles as p
where p.user_id = rp.user_id;

create function public.set_profile_avatar(requested_pixels jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_profile_avatar(requested_pixels)
$$;

revoke all on function private.profile_avatar_pixels_valid(jsonb) from public, anon, authenticated;
revoke all on function private.set_profile_avatar(jsonb) from public, anon;
revoke all on function private.copy_profile_avatar_to_room_player() from public, anon, authenticated;
revoke all on function private.sync_profile_avatar_to_rooms() from public, anon, authenticated;
revoke all on function public.set_profile_avatar(jsonb) from public, anon;
grant execute on function private.set_profile_avatar(jsonb) to authenticated;
grant execute on function public.set_profile_avatar(jsonb) to authenticated;
