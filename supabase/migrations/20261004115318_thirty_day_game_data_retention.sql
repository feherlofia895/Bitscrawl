do $migration$
begin
  if exists (
    select 1
    from pg_catalog.pg_available_extensions
    where name = 'pg_cron'
  ) then
    execute 'create extension if not exists pg_cron';
  end if;
end
$migration$;

create or replace function private.cleanup_expired_game_data()
returns table (
  deleted_lobby_messages bigint,
  deleted_rooms bigint
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  retention_cutoff timestamptz := clock_timestamp() - interval '30 days';
  removed_lobby_messages bigint := 0;
  removed_rooms bigint := 0;
begin
  delete from public.lobby_messages
  where created_at < retention_cutoff;

  get diagnostics removed_lobby_messages = row_count;

  delete from public.rooms room
  where
    (
      room.finished_at is not null
      and room.finished_at < retention_cutoff
    )
    or coalesce(
      (
        select max(player.last_seen_at)
        from public.room_players player
        where player.room_id = room.id
      ),
      room.created_at
    ) < retention_cutoff;

  get diagnostics removed_rooms = row_count;

  return query
  select removed_lobby_messages, removed_rooms;
end;
$function$;

comment on function private.cleanup_expired_game_data() is
  'Deletes global lobby messages older than 30 days and rooms finished or inactive for more than 30 days. Room-owned game and chat data is removed by foreign-key cascades; gallery and challenge artwork is not touched.';

revoke all on function private.cleanup_expired_game_data() from public, anon, authenticated, service_role;

do $migration$
begin
  if exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pg_cron'
  ) then
    execute $schedule$
      select cron.schedule(
        'bitscrawl-thirty-day-game-data-cleanup',
        '15 3 * * *',
        $cron$select private.cleanup_expired_game_data();$cron$
      )
    $schedule$;
  end if;
end
$migration$;
