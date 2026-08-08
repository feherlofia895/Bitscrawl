create function public.leave_room(target_room_id bigint)
returns table (
  room_deleted boolean,
  host_user_id uuid,
  host_changed boolean,
  round_finished boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  leave_time timestamptz := clock_timestamp();
  previous_host_user_id uuid;
  replacement_host_user_id uuid;
  active_round_id bigint;
  active_drawer_user_id uuid;
  host_was_changed boolean := false;
  round_was_finished boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select rooms.host_user_id
  into previous_host_user_id
  from public.rooms
  where id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.room_players
    where room_id = target_room_id
      and user_id = current_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ROOM_MEMBERSHIP_NOT_FOUND';
  end if;

  select id, drawer_user_id
  into active_round_id, active_drawer_user_id
  from public.game_rounds
  where room_id = target_room_id
    and status in ('choosing', 'drawing')
  order by round_number desc
  limit 1
  for update;

  delete from public.room_players
  where room_id = target_room_id
    and user_id = current_user_id;

  if not exists (
    select 1
    from public.room_players
    where room_id = target_room_id
  ) then
    delete from public.rooms
    where id = target_room_id;

    return query
    select true, null::uuid, false, false;
    return;
  end if;

  replacement_host_user_id := previous_host_user_id;

  if previous_host_user_id = current_user_id then
    select user_id
    into replacement_host_user_id
    from public.room_players
    where room_id = target_room_id
    order by
      (last_seen_at >= leave_time - interval '45 seconds') desc,
      joined_at,
      id
    limit 1;

    update public.rooms
    set host_user_id = replacement_host_user_id
    where id = target_room_id;

    host_was_changed := true;
  end if;

  if active_round_id is not null
    and active_drawer_user_id = current_user_id
  then
    update public.game_rounds
    set status = 'finished',
        finished_at = leave_time
    where id = active_round_id;

    round_was_finished := true;
  end if;

  return query
  select false, replacement_host_user_id, host_was_changed,
         round_was_finished;
end;
$$;

revoke all on function public.leave_room(bigint) from public, anon;
grant execute on function public.leave_room(bigint) to authenticated;
