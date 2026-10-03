create function private.editor_palette_colors_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if candidate is null or jsonb_typeof(candidate) <> 'array'
    or jsonb_array_length(candidate) > 16 then
    return false;
  end if;

  return not exists (
      select 1
      from jsonb_array_elements(candidate) color
      where jsonb_typeof(color) <> 'string'
        or not (color #>> '{}') ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
    )
    and jsonb_array_length(candidate) = (
      select count(distinct lower(color #>> '{}'))
      from jsonb_array_elements(candidate) color
    );
end;
$$;

create table private.editor_custom_palettes (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot_index smallint not null check (slot_index between 1 and 3),
  name text not null check (char_length(btrim(name)) between 1 and 24 and name !~ '[[:cntrl:]]'),
  colors jsonb not null check (private.editor_palette_colors_valid(colors)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, slot_index)
);

alter table private.editor_custom_palettes enable row level security;

create function private.get_own_editor_palettes()
returns table (slot_index smallint, name text, colors jsonb, updated_at timestamptz)
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
  select palette.slot_index, palette.name, palette.colors, palette.updated_at
  from private.editor_custom_palettes palette
  where palette.user_id = current_user_id
  order by palette.slot_index;
end;
$$;

create function private.save_own_editor_palette(
  target_slot integer,
  requested_name text,
  palette_colors jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  clean_name text := regexp_replace(btrim(coalesce(requested_name, '')), '[[:space:]]+', ' ', 'g');
  saved_at timestamptz;
begin
  if not exists (select 1 from public.profiles profile where profile.user_id = current_user_id) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;
  if target_slot is null or target_slot not between 1 and 3 then
    raise exception using errcode = 'P0001', message = 'EDITOR_PALETTE_SLOT_INVALID';
  end if;
  if char_length(clean_name) not between 1 and 24 or clean_name ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'EDITOR_PALETTE_NAME_INVALID';
  end if;
  if not private.editor_palette_colors_valid(palette_colors) then
    raise exception using errcode = 'P0001', message = 'EDITOR_PALETTE_COLORS_INVALID';
  end if;

  insert into private.editor_custom_palettes as palette (user_id, slot_index, name, colors)
  values (current_user_id, target_slot, clean_name, palette_colors)
  on conflict (user_id, slot_index) do update
  set name = excluded.name,
      colors = excluded.colors,
      updated_at = clock_timestamp()
  returning palette.updated_at into saved_at;

  return saved_at;
end;
$$;

create function private.delete_own_editor_palette(target_slot integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if target_slot is null or target_slot not between 1 and 3 then
    raise exception using errcode = 'P0001', message = 'EDITOR_PALETTE_SLOT_INVALID';
  end if;

  delete from private.editor_custom_palettes palette
  where palette.user_id = current_user_id and palette.slot_index = target_slot;
  return found;
end;
$$;

create function public.get_own_editor_palettes()
returns table (slot_index smallint, name text, colors jsonb, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_own_editor_palettes() $$;

create function public.save_own_editor_palette(target_slot integer, requested_name text, palette_colors jsonb)
returns timestamptz
language sql security invoker set search_path = ''
as $$ select private.save_own_editor_palette(target_slot, requested_name, palette_colors) $$;

create function public.delete_own_editor_palette(target_slot integer)
returns boolean
language sql security invoker set search_path = ''
as $$ select private.delete_own_editor_palette(target_slot) $$;

revoke all on table private.editor_custom_palettes from public, anon, authenticated;
revoke all on function private.editor_palette_colors_valid(jsonb) from public, anon, authenticated;
revoke all on function private.get_own_editor_palettes() from public, anon;
revoke all on function private.save_own_editor_palette(integer, text, jsonb) from public, anon;
revoke all on function private.delete_own_editor_palette(integer) from public, anon;
revoke all on function public.get_own_editor_palettes() from public, anon;
revoke all on function public.save_own_editor_palette(integer, text, jsonb) from public, anon;
revoke all on function public.delete_own_editor_palette(integer) from public, anon;

grant execute on function private.get_own_editor_palettes() to authenticated;
grant execute on function private.save_own_editor_palette(integer, text, jsonb) to authenticated;
grant execute on function private.delete_own_editor_palette(integer) to authenticated;
grant execute on function public.get_own_editor_palettes() to authenticated;
grant execute on function public.save_own_editor_palette(integer, text, jsonb) to authenticated;
grant execute on function public.delete_own_editor_palette(integer) to authenticated;
