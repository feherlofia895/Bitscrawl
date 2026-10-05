create function private.editor_project_document_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  frame_count integer;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object'
    or candidate->>'version' <> '3'
    or octet_length(candidate::text) > 262144
    or jsonb_typeof(candidate->'frames') <> 'array' then
    return false;
  end if;

  frame_count := jsonb_array_length(candidate->'frames');
  if frame_count not between 1 and 5
    or coalesce(candidate->>'activeFrameIndex', '') !~ '^[0-4]$'
    or (candidate->>'activeFrameIndex')::integer >= frame_count
    or coalesce(candidate->>'activeLayer', '') !~ '^[0-2]$'
    or coalesce(candidate->>'fps', '') !~ '^[1-8]$'
    or candidate->>'paletteSize' not in ('12', '32')
    or jsonb_typeof(candidate->'onionSkin') <> 'boolean'
    or jsonb_typeof(candidate->'exported') <> 'boolean'
    or jsonb_typeof(candidate->'layerVisibility') <> 'array'
    or jsonb_array_length(candidate->'layerVisibility') <> 3
    or exists (
      select 1 from jsonb_array_elements(candidate->'layerVisibility') item
      where jsonb_typeof(item) <> 'boolean'
    ) then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(candidate->'frames') frame
    where jsonb_typeof(frame) <> 'object'
      or jsonb_typeof(frame->'layers') <> 'array'
      or jsonb_array_length(frame->'layers') <> 3
      or exists (
        select 1
        from jsonb_array_elements(frame->'layers') layer
        where jsonb_typeof(layer) <> 'array'
          or jsonb_array_length(layer) <> 1024
          or exists (
            select 1
            from jsonb_array_elements(layer) pixel
            where jsonb_typeof(pixel) <> 'string'
              or not (
                pixel #>> '{}' = 'transparent'
                or pixel #>> '{}' ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
              )
          )
      )
  ) then
    return false;
  end if;

  return exists (
    select 1
    from jsonb_array_elements(candidate->'frames') frame,
         jsonb_array_elements(frame->'layers') layer,
         jsonb_array_elements_text(layer) pixel(color)
    where pixel.color <> 'transparent'
  );
end;
$$;

create table private.editor_projects (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot_index smallint not null check (slot_index between 1 and 4),
  document jsonb not null check (private.editor_project_document_valid(document)),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, slot_index)
);

alter table private.editor_projects enable row level security;

with empty_layer as (
  select to_jsonb(array_fill('transparent'::text, array[1024])) as pixels
)
insert into private.editor_projects (user_id, slot_index, document, created_at, updated_at)
select
  gallery.user_id,
  gallery.slot_index,
  jsonb_build_object(
    'version', 3,
    'activeFrameIndex', 0,
    'activeLayer', 0,
    'exported', true,
    'fps', 4,
    'frames', jsonb_build_array(jsonb_build_object(
      'layers', jsonb_build_array(gallery.pixels, empty_layer.pixels, empty_layer.pixels)
    )),
    'layerVisibility', jsonb_build_array(true, true, true),
    'onionSkin', true,
    'paletteSize', gallery.palette_size
  ),
  gallery.created_at,
  gallery.updated_at
from private.editor_gallery_slots gallery
cross join empty_layer;

with empty_layer as (
  select to_jsonb(array_fill('transparent'::text, array[1024])) as pixels
)
insert into private.editor_projects (user_id, slot_index, document, created_at, updated_at)
select
  animation.user_id,
  animation.slot_index + 2,
  jsonb_build_object(
    'version', 3,
    'activeFrameIndex', 0,
    'activeLayer', 0,
    'exported', false,
    'fps', animation.fps,
    'frames', (
      select jsonb_agg(
        jsonb_build_object('layers', jsonb_build_array(frame.value, empty_layer.pixels, empty_layer.pixels))
        order by frame.ordinality
      )
      from jsonb_array_elements(animation.frames) with ordinality frame(value, ordinality)
    ),
    'layerVisibility', jsonb_build_array(true, true, true),
    'onionSkin', true,
    'paletteSize', 32
  ),
  animation.created_at,
  animation.updated_at
from private.editor_animation_slots animation
cross join empty_layer
on conflict (user_id, slot_index) do nothing;

create function private.get_own_editor_projects()
returns table (slot_index smallint, document jsonb, updated_at timestamptz)
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
  select project.slot_index, project.document, project.updated_at
  from private.editor_projects project
  where project.user_id = current_user_id
  order by project.slot_index;
end;
$$;

create function private.save_own_editor_project(
  target_slot integer,
  project_document jsonb
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
  if target_slot is null or target_slot not between 1 and 4 then
    raise exception using errcode = 'P0001', message = 'EDITOR_PROJECT_SLOT_INVALID';
  end if;
  if not private.editor_project_document_valid(project_document) then
    raise exception using errcode = 'P0001', message = 'EDITOR_PROJECT_DOCUMENT_INVALID';
  end if;

  insert into private.editor_projects as project (user_id, slot_index, document)
  values (current_user_id, target_slot, project_document)
  on conflict (user_id, slot_index) do update
  set document = excluded.document,
      updated_at = clock_timestamp()
  returning project.updated_at into saved_at;

  return saved_at;
end;
$$;

create function private.delete_own_editor_project(target_slot integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if target_slot is null or target_slot not between 1 and 4 then
    raise exception using errcode = 'P0001', message = 'EDITOR_PROJECT_SLOT_INVALID';
  end if;

  delete from private.editor_projects project
  where project.user_id = current_user_id and project.slot_index = target_slot;
  return found;
end;
$$;

create function public.get_own_editor_projects()
returns table (slot_index smallint, document jsonb, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_own_editor_projects() $$;

create function public.save_own_editor_project(target_slot integer, project_document jsonb)
returns timestamptz
language sql security invoker set search_path = ''
as $$ select private.save_own_editor_project(target_slot, project_document) $$;

create function public.delete_own_editor_project(target_slot integer)
returns boolean
language sql security invoker set search_path = ''
as $$ select private.delete_own_editor_project(target_slot) $$;

revoke all on table private.editor_projects from public, anon, authenticated;
revoke all on function private.editor_project_document_valid(jsonb) from public, anon, authenticated;
revoke all on function private.get_own_editor_projects() from public, anon;
revoke all on function private.save_own_editor_project(integer, jsonb) from public, anon;
revoke all on function private.delete_own_editor_project(integer) from public, anon;
revoke all on function public.get_own_editor_projects() from public, anon;
revoke all on function public.save_own_editor_project(integer, jsonb) from public, anon;
revoke all on function public.delete_own_editor_project(integer) from public, anon;

grant execute on function private.get_own_editor_projects() to authenticated;
grant execute on function private.save_own_editor_project(integer, jsonb) to authenticated;
grant execute on function private.delete_own_editor_project(integer) to authenticated;
grant execute on function public.get_own_editor_projects() to authenticated;
grant execute on function public.save_own_editor_project(integer, jsonb) to authenticated;
grant execute on function public.delete_own_editor_project(integer) to authenticated;

comment on table private.editor_projects is
  'Four private editor project slots per permanent profile. Each versioned document keeps up to five frames and three layers.';

create function private.get_admin_storage_status()
returns table (
  database_bytes bigint,
  capacity_bytes bigint,
  warning_percent smallint,
  editor_project_bytes bigint,
  editor_project_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_app_admin() then
    raise exception using errcode = 'P0001', message = 'ADMIN_REQUIRED';
  end if;

  return query
  select
    pg_database_size(current_database())::bigint,
    524288000::bigint,
    70::smallint,
    coalesce(sum(pg_column_size(project.document)), 0)::bigint,
    count(project.*)::bigint
  from private.editor_projects project;
end;
$$;

create function public.get_admin_storage_status()
returns table (
  database_bytes bigint,
  capacity_bytes bigint,
  warning_percent smallint,
  editor_project_bytes bigint,
  editor_project_count bigint
)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_admin_storage_status() $$;

revoke all on function private.get_admin_storage_status() from public, anon;
revoke all on function public.get_admin_storage_status() from public, anon;
grant execute on function private.get_admin_storage_status() to authenticated;
grant execute on function public.get_admin_storage_status() to authenticated;

comment on function public.get_admin_storage_status() is
  'Returns admin-only database usage and a fixed 70 percent warning threshold for the current 500 MB free-plan capacity.';
