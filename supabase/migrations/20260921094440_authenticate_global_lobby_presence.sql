create table private.lobby_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default clock_timestamp()
);

create index lobby_presence_last_seen_at_idx
  on private.lobby_presence (last_seen_at desc);

alter table private.lobby_presence enable row level security;

revoke all on private.lobby_presence from public, anon, authenticated;

comment on table private.lobby_presence is
  'Server-authenticated global lobby heartbeat. Browser clients access it only through RPCs.';

drop function public.get_online_profiles(uuid[]);

create function public.touch_global_lobby_presence()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  touched_at timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'LOBBY_PROFILE_REQUIRED';
  end if;

  insert into private.lobby_presence (user_id, last_seen_at)
  values (current_user_id, touched_at)
  on conflict (user_id) do update
  set last_seen_at = excluded.last_seen_at;

  delete from private.lobby_presence
  where last_seen_at < touched_at - interval '7 days';

  return touched_at;
end;
$$;

create function public.get_online_profiles()
returns table (
  user_id uuid,
  display_name text,
  avatar_pixels jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'LOBBY_PROFILE_REQUIRED';
  end if;

  return query
  select p.user_id, p.display_name, p.avatar_pixels
  from private.lobby_presence presence
  join public.profiles p on p.user_id = presence.user_id
  where presence.last_seen_at > clock_timestamp() - interval '45 seconds'
  order by lower(p.display_name), p.user_id;
end;
$$;

revoke all on function public.touch_global_lobby_presence() from public, anon;
revoke all on function public.get_online_profiles() from public, anon;
grant execute on function public.touch_global_lobby_presence() to authenticated;
grant execute on function public.get_online_profiles() to authenticated;
