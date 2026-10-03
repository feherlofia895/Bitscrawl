alter table public.profiles
  add column avatar_version integer not null default 0,
  add constraint profiles_avatar_version_nonnegative check (avatar_version >= 0);

update public.profiles
set avatar_version = 1
where avatar_pixels is not null;

create table private.profile_avatar_likes (
  target_user_id uuid not null references public.profiles(user_id) on delete cascade,
  liker_user_id uuid not null references public.profiles(user_id) on delete cascade,
  avatar_version integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (target_user_id, liker_user_id),
  constraint profile_avatar_likes_not_self check (target_user_id <> liker_user_id),
  constraint profile_avatar_likes_version_positive check (avatar_version > 0)
);

create index profile_avatar_likes_target_version_idx
  on private.profile_avatar_likes (target_user_id, avatar_version);

alter table private.profile_avatar_likes enable row level security;

revoke all on private.profile_avatar_likes from public, anon, authenticated;

comment on table private.profile_avatar_likes is
  'Likes tied to the current avatar version. Large avatar changes start a fresh version.';

create function private.get_profile_avatar_like_state(target_profile_name text)
returns table (
  liked boolean,
  like_count integer,
  can_like boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  target_profile public.profiles%rowtype;
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  select p.*
  into target_profile
  from public.profiles p
  where lower(p.display_name) = lower(btrim(target_profile_name));

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  return query
  select
    exists (
      select 1
      from private.profile_avatar_likes avatar_like
      where avatar_like.target_user_id = target_profile.user_id
        and avatar_like.liker_user_id = current_user_id
        and avatar_like.avatar_version = target_profile.avatar_version
    ),
    (
      select count(*)::integer
      from private.profile_avatar_likes avatar_like
      where avatar_like.target_user_id = target_profile.user_id
        and avatar_like.avatar_version = target_profile.avatar_version
    ),
    target_profile.avatar_pixels is not null and target_profile.user_id <> current_user_id;
end;
$$;

create function private.set_profile_avatar_like(
  target_profile_name text,
  like_enabled boolean
)
returns table (
  liked boolean,
  like_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  target_profile public.profiles%rowtype;
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  select p.*
  into target_profile
  from public.profiles p
  where lower(p.display_name) = lower(btrim(target_profile_name))
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;
  if target_profile.user_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'PROFILE_AVATAR_SELF_LIKE';
  end if;
  if target_profile.avatar_pixels is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_AVATAR_MISSING';
  end if;

  if like_enabled then
    insert into private.profile_avatar_likes (
      target_user_id,
      liker_user_id,
      avatar_version,
      created_at
    ) values (
      target_profile.user_id,
      current_user_id,
      target_profile.avatar_version,
      clock_timestamp()
    )
    on conflict (target_user_id, liker_user_id) do update
    set avatar_version = excluded.avatar_version,
        created_at = excluded.created_at;
  else
    delete from private.profile_avatar_likes avatar_like
    where avatar_like.target_user_id = target_profile.user_id
      and avatar_like.liker_user_id = current_user_id;
  end if;

  return query
  select
    exists (
      select 1
      from private.profile_avatar_likes avatar_like
      where avatar_like.target_user_id = target_profile.user_id
        and avatar_like.liker_user_id = current_user_id
        and avatar_like.avatar_version = target_profile.avatar_version
    ),
    (
      select count(*)::integer
      from private.profile_avatar_likes avatar_like
      where avatar_like.target_user_id = target_profile.user_id
        and avatar_like.avatar_version = target_profile.avatar_version
    );
end;
$$;

create or replace function private.set_profile_avatar(requested_pixels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  previous_pixels jsonb;
  previous_version integer;
  changed_pixel_count integer := 1024;
  next_version integer;
begin
  if requested_pixels is null or not private.profile_avatar_pixels_valid(requested_pixels) then
    raise exception using errcode = 'P0001', message = 'PROFILE_AVATAR_INVALID';
  end if;

  select p.avatar_pixels, p.avatar_version
  into previous_pixels, previous_version
  from public.profiles p
  where p.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WEEKLY_PROFILE_REQUIRED';
  end if;

  if previous_pixels is not null then
    select count(*)::integer
    into changed_pixel_count
    from jsonb_array_elements_text(previous_pixels) with ordinality as old_pixel(color, position)
    join jsonb_array_elements_text(requested_pixels) with ordinality as new_pixel(color, position)
      using (position)
    where old_pixel.color is distinct from new_pixel.color;
  end if;

  next_version := case
    when previous_pixels is null then greatest(previous_version + 1, 1)
    when changed_pixel_count >= 512 then previous_version + 1
    else previous_version
  end;

  if previous_pixels is null or changed_pixel_count >= 512 then
    delete from private.profile_avatar_likes avatar_like
    where avatar_like.target_user_id = current_user_id;
  end if;

  update public.profiles p
  set avatar_pixels = requested_pixels,
      avatar_version = next_version
  where p.user_id = current_user_id;

  return requested_pixels;
end;
$$;

create function public.get_profile_avatar_like_state(target_profile_name text)
returns table (
  liked boolean,
  like_count integer,
  can_like boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_profile_avatar_like_state(target_profile_name)
$$;

create function public.set_profile_avatar_like(
  target_profile_name text,
  like_enabled boolean
)
returns table (
  liked boolean,
  like_count integer
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.set_profile_avatar_like(target_profile_name, like_enabled)
$$;

revoke all on function private.get_profile_avatar_like_state(text) from public, anon;
revoke all on function private.set_profile_avatar_like(text, boolean) from public, anon;
revoke all on function public.get_profile_avatar_like_state(text) from public, anon;
revoke all on function public.set_profile_avatar_like(text, boolean) from public, anon;
grant execute on function private.get_profile_avatar_like_state(text) to authenticated;
grant execute on function private.set_profile_avatar_like(text, boolean) to authenticated;
grant execute on function public.get_profile_avatar_like_state(text) to authenticated;
grant execute on function public.set_profile_avatar_like(text, boolean) to authenticated;
