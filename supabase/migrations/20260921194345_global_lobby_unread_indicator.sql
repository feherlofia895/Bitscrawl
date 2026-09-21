create table private.global_lobby_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_read_message_id bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint global_lobby_reads_message_id_nonnegative check (last_read_message_id >= 0)
);

alter table private.global_lobby_reads enable row level security;

revoke all on private.global_lobby_reads from public, anon, authenticated;

comment on table private.global_lobby_reads is
  'Per-profile cursor used for the unread indicator on the global lobby chat button.';

create function private.get_global_lobby_unread_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  unread_count integer;
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'LOBBY_PROFILE_REQUIRED';
  end if;

  select count(*)::integer
  into unread_count
  from public.lobby_messages message
  where message.user_id <> current_user_id
    and message.id > coalesce((
      select read_state.last_read_message_id
      from private.global_lobby_reads read_state
      where read_state.user_id = current_user_id
    ), 0);

  return unread_count;
end;
$$;

create function private.mark_global_lobby_read()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  latest_message_id bigint;
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'LOBBY_PROFILE_REQUIRED';
  end if;

  select coalesce(max(message.id), 0)
  into latest_message_id
  from public.lobby_messages message;

  insert into private.global_lobby_reads (user_id, last_read_message_id, updated_at)
  values (current_user_id, latest_message_id, clock_timestamp())
  on conflict (user_id) do update
  set last_read_message_id = greatest(
        private.global_lobby_reads.last_read_message_id,
        excluded.last_read_message_id
      ),
      updated_at = excluded.updated_at;

  return latest_message_id;
end;
$$;

create function public.get_global_lobby_unread_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_global_lobby_unread_count()
$$;

create function public.mark_global_lobby_read()
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.mark_global_lobby_read()
$$;

revoke all on function private.get_global_lobby_unread_count() from public, anon;
revoke all on function private.mark_global_lobby_read() from public, anon;
revoke all on function public.get_global_lobby_unread_count() from public, anon;
revoke all on function public.mark_global_lobby_read() from public, anon;
grant execute on function private.get_global_lobby_unread_count() to authenticated;
grant execute on function private.mark_global_lobby_read() to authenticated;
grant execute on function public.get_global_lobby_unread_count() to authenticated;
grant execute on function public.mark_global_lobby_read() to authenticated;
