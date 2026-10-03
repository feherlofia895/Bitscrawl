create function private.editor_animation_frames_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if candidate is null or jsonb_typeof(candidate) <> 'array'
    or jsonb_array_length(candidate) not between 1 and 3 then
    return false;
  end if;

  return not exists (
      select 1
      from jsonb_array_elements(candidate) frame
      where jsonb_typeof(frame) <> 'array'
        or jsonb_array_length(frame) <> 1024
        or exists (
          select 1
          from jsonb_array_elements(frame) pixel
          where jsonb_typeof(pixel) <> 'string'
            or not (
              pixel #>> '{}' = 'transparent'
              or pixel #>> '{}' ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'
            )
        )
    )
    and exists (
      select 1
      from jsonb_array_elements(candidate) frame,
           jsonb_array_elements_text(frame) pixel(color)
      where pixel.color <> 'transparent'
    );
end;
$$;

create table private.editor_animation_slots (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  slot_index smallint not null check (slot_index between 1 and 2),
  frames jsonb not null check (private.editor_animation_frames_valid(frames)),
  fps smallint not null check (fps between 1 and 8),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, slot_index)
);

alter table private.editor_animation_slots enable row level security;

create function private.get_own_editor_animations()
returns table (slot_index smallint, frames jsonb, fps smallint, updated_at timestamptz)
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
  select animation.slot_index, animation.frames, animation.fps, animation.updated_at
  from private.editor_animation_slots animation
  where animation.user_id = current_user_id
  order by animation.slot_index;
end;
$$;

create function private.save_own_editor_animation_slot(
  target_slot integer,
  animation_frames jsonb,
  requested_fps integer
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
    raise exception using errcode = 'P0001', message = 'EDITOR_ANIMATION_SLOT_INVALID';
  end if;
  if requested_fps is null or requested_fps not between 1 and 8 then
    raise exception using errcode = 'P0001', message = 'EDITOR_ANIMATION_FPS_INVALID';
  end if;
  if not private.editor_animation_frames_valid(animation_frames) then
    raise exception using errcode = 'P0001', message = 'EDITOR_ANIMATION_INVALID';
  end if;

  insert into private.editor_animation_slots as animation (user_id, slot_index, frames, fps)
  values (current_user_id, target_slot, animation_frames, requested_fps)
  on conflict (user_id, slot_index) do update
  set frames = excluded.frames,
      fps = excluded.fps,
      updated_at = clock_timestamp()
  returning animation.updated_at into saved_at;

  return saved_at;
end;
$$;

create function private.delete_own_editor_animation_slot(target_slot integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if target_slot is null or target_slot not between 1 and 2 then
    raise exception using errcode = 'P0001', message = 'EDITOR_ANIMATION_SLOT_INVALID';
  end if;

  delete from private.editor_animation_slots animation
  where animation.user_id = current_user_id and animation.slot_index = target_slot;
  return found;
end;
$$;

create function public.get_own_editor_animations()
returns table (slot_index smallint, frames jsonb, fps smallint, updated_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_own_editor_animations() $$;

create function public.save_own_editor_animation_slot(
  target_slot integer,
  animation_frames jsonb,
  requested_fps integer
)
returns timestamptz
language sql security invoker set search_path = ''
as $$ select private.save_own_editor_animation_slot(target_slot, animation_frames, requested_fps) $$;

create function public.delete_own_editor_animation_slot(target_slot integer)
returns boolean
language sql security invoker set search_path = ''
as $$ select private.delete_own_editor_animation_slot(target_slot) $$;

revoke all on table private.editor_animation_slots from public, anon, authenticated;
revoke all on function private.editor_animation_frames_valid(jsonb) from public, anon, authenticated;
revoke all on function private.get_own_editor_animations() from public, anon;
revoke all on function private.save_own_editor_animation_slot(integer, jsonb, integer) from public, anon;
revoke all on function private.delete_own_editor_animation_slot(integer) from public, anon;
revoke all on function public.get_own_editor_animations() from public, anon;
revoke all on function public.save_own_editor_animation_slot(integer, jsonb, integer) from public, anon;
revoke all on function public.delete_own_editor_animation_slot(integer) from public, anon;

grant execute on function private.get_own_editor_animations() to authenticated;
grant execute on function private.save_own_editor_animation_slot(integer, jsonb, integer) to authenticated;
grant execute on function private.delete_own_editor_animation_slot(integer) to authenticated;
grant execute on function public.get_own_editor_animations() to authenticated;
grant execute on function public.save_own_editor_animation_slot(integer, jsonb, integer) to authenticated;
grant execute on function public.delete_own_editor_animation_slot(integer) to authenticated;

comment on table private.editor_animation_slots is
  'Two private editor animation slots per permanent profile; animations remain separate from still-image gallery slots.';
