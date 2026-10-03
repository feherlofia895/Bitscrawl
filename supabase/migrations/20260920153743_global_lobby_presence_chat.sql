create table public.lobby_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint lobby_messages_content_length
    check (char_length(btrim(content)) between 1 and 500)
);

create index lobby_messages_created_id_idx
  on public.lobby_messages (created_at desc, id desc);
create index lobby_messages_user_id_idx
  on public.lobby_messages (user_id);

alter table public.lobby_messages enable row level security;

create policy lobby_messages_profile_read
on public.lobby_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
  )
);

revoke all on public.lobby_messages from public, anon, authenticated;
grant select on public.lobby_messages to authenticated;

create function public.get_online_profiles(requested_user_ids uuid[])
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

  if coalesce(cardinality(requested_user_ids), 0) > 100 then
    raise exception using errcode = 'P0001', message = 'LOBBY_PROFILE_LIMIT';
  end if;

  return query
  select p.user_id, p.display_name, p.avatar_pixels
  from public.profiles p
  where p.user_id = any(coalesce(requested_user_ids, '{}'::uuid[]))
  order by lower(p.display_name), p.user_id;
end;
$$;

create function public.get_global_lobby_messages()
returns table (
  message_id bigint,
  author_name text,
  author_avatar jsonb,
  content text,
  created_at timestamptz,
  is_own boolean
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
  select recent.message_id,
    recent.author_name,
    recent.author_avatar,
    recent.content,
    recent.created_at,
    recent.is_own
  from (
    select m.id as message_id,
      p.display_name as author_name,
      p.avatar_pixels as author_avatar,
      m.content,
      m.created_at,
      m.user_id = current_user_id as is_own
    from public.lobby_messages m
    join public.profiles p on p.user_id = m.user_id
    order by m.id desc
    limit 100
  ) recent
  order by recent.message_id;
end;
$$;

create function public.send_global_lobby_message(requested_content text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := private.weekly_user_id();
  clean_content text := btrim(regexp_replace(coalesce(requested_content, ''), '\s+', ' ', 'g'));
  created_message_id bigint;
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'LOBBY_PROFILE_REQUIRED';
  end if;

  if char_length(clean_content) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'LOBBY_MESSAGE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  if exists (
    select 1
    from public.lobby_messages m
    where m.user_id = current_user_id
      and m.created_at > clock_timestamp() - interval '2 seconds'
  ) then
    raise exception using errcode = 'P0001', message = 'LOBBY_MESSAGE_RATE_LIMIT';
  end if;

  insert into public.lobby_messages (user_id, content)
  values (current_user_id, clean_content)
  returning id into created_message_id;

  return created_message_id;
end;
$$;

revoke all on function public.get_online_profiles(uuid[]) from public, anon;
revoke all on function public.get_global_lobby_messages() from public, anon;
revoke all on function public.send_global_lobby_message(text) from public, anon;
grant execute on function public.get_online_profiles(uuid[]) to authenticated;
grant execute on function public.get_global_lobby_messages() to authenticated;
grant execute on function public.send_global_lobby_message(text) to authenticated;

-- Supabase 2026-tol zarolja a realtime sema objektumait, de a
-- realtime.messages RLS-szabalyai tovabbra is modosithatok. A felteteles
-- blokk az izolalt PGlite migraciotesztet is mukodokepesen tartja.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists global_lobby_presence_read on realtime.messages';
    execute 'drop policy if exists global_lobby_presence_write on realtime.messages';

    execute $policy$
      create policy global_lobby_presence_read
      on realtime.messages
      for select
      to authenticated
      using (
        (select realtime.topic()) = 'global-lobby'
        and extension = 'presence'
        and exists (
          select 1 from public.profiles p
          where p.user_id = (select auth.uid())
        )
      )
    $policy$;

    execute $policy$
      create policy global_lobby_presence_write
      on realtime.messages
      for insert
      to authenticated
      with check (
        (select realtime.topic()) = 'global-lobby'
        and extension = 'presence'
        and exists (
          select 1 from public.profiles p
          where p.user_id = (select auth.uid())
        )
      )
    $policy$;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lobby_messages'
  ) then
    alter publication supabase_realtime add table public.lobby_messages;
  end if;
end;
$$;
