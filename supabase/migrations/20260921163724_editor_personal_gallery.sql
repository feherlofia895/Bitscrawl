create function private.editor_gallery_pixels_valid(candidate jsonb, requested_palette_size integer)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if candidate is null or jsonb_typeof(candidate) <> 'array'
    or requested_palette_size is null or requested_palette_size not in (12, 32)
    or not private.profile_avatar_pixels_valid(candidate) then
    return false;
  end if;

  return exists (
      select 1 from jsonb_array_elements_text(candidate) as pixel(color)
      where pixel.color <> 'transparent'
    )
    and (
      requested_palette_size = 32
      or not exists (
        select 1 from jsonb_array_elements_text(candidate) as pixel(color)
        where pixel.color not in (
          'transparent', '#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967',
          '#67ba62', '#549d8c', '#33567e', '#221a5f', '#999ea1', '#242630', '#230a19'
        )
      )
    );
end;
$$;

create table private.editor_gallery_slots (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_index smallint not null check (slot_index between 1 and 2),
  pixels jsonb not null,
  palette_size smallint not null default 32 check (palette_size in (12, 32)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, slot_index),
  constraint editor_gallery_pixels_valid
    check (private.editor_gallery_pixels_valid(pixels, palette_size))
);

alter table private.editor_gallery_slots enable row level security;

create function private.get_own_editor_gallery()
returns table (
  slot_index smallint,
  pixels jsonb,
  palette_size smallint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  return query
  select slot.slot_index, slot.pixels, slot.palette_size, slot.updated_at
  from private.editor_gallery_slots slot
  where slot.user_id = current_user_id
  order by slot.slot_index;
end;
$$;

create function private.save_own_editor_gallery_slot(
  target_slot integer,
  drawing_pixels jsonb,
  requested_palette_size integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  saved_at timestamptz;
begin
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
  if target_slot is null or target_slot not between 1 and 2 then
    raise exception using errcode = 'P0001', message = 'EDITOR_GALLERY_SLOT_INVALID';
  end if;
  if not private.editor_gallery_pixels_valid(drawing_pixels, requested_palette_size) then
    raise exception using errcode = 'P0001', message = 'EDITOR_GALLERY_DRAWING_INVALID';
  end if;

  insert into private.editor_gallery_slots as slot (
    user_id, slot_index, pixels, palette_size
  ) values (
    current_user_id, target_slot, drawing_pixels, requested_palette_size
  )
  on conflict (user_id, slot_index) do update
  set pixels = excluded.pixels,
      palette_size = excluded.palette_size,
      updated_at = clock_timestamp()
  returning slot.updated_at into saved_at;

  return saved_at;
end;
$$;

create function private.delete_own_editor_gallery_slot(target_slot integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if target_slot is null or target_slot not between 1 and 2 then
    raise exception using errcode = 'P0001', message = 'EDITOR_GALLERY_SLOT_INVALID';
  end if;

  delete from private.editor_gallery_slots slot
  where slot.user_id = current_user_id and slot.slot_index = target_slot;
  return found;
end;
$$;

create function public.get_own_editor_gallery()
returns table (
  slot_index smallint,
  pixels jsonb,
  palette_size smallint,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_own_editor_gallery()
$$;

create function public.save_own_editor_gallery_slot(
  target_slot integer,
  drawing_pixels jsonb,
  requested_palette_size integer
)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  select private.save_own_editor_gallery_slot(target_slot, drawing_pixels, requested_palette_size)
$$;

create function public.delete_own_editor_gallery_slot(target_slot integer)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.delete_own_editor_gallery_slot(target_slot)
$$;

revoke all on table private.editor_gallery_slots from public, anon, authenticated;
revoke all on function private.editor_gallery_pixels_valid(jsonb, integer) from public, anon, authenticated;
revoke all on function private.get_own_editor_gallery() from public, anon;
revoke all on function private.save_own_editor_gallery_slot(integer, jsonb, integer) from public, anon;
revoke all on function private.delete_own_editor_gallery_slot(integer) from public, anon;
revoke all on function public.get_own_editor_gallery() from public, anon;
revoke all on function public.save_own_editor_gallery_slot(integer, jsonb, integer) from public, anon;
revoke all on function public.delete_own_editor_gallery_slot(integer) from public, anon;

grant execute on function private.get_own_editor_gallery() to authenticated;
grant execute on function private.save_own_editor_gallery_slot(integer, jsonb, integer) to authenticated;
grant execute on function private.delete_own_editor_gallery_slot(integer) to authenticated;
grant execute on function public.get_own_editor_gallery() to authenticated;
grant execute on function public.save_own_editor_gallery_slot(integer, jsonb, integer) to authenticated;
grant execute on function public.delete_own_editor_gallery_slot(integer) to authenticated;
