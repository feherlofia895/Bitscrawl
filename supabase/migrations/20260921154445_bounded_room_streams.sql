create function public.get_room_message_updates(
  target_room_id bigint,
  after_message_id bigint default null,
  requested_limit integer default 50
)
returns table (
  id bigint,
  room_id bigint,
  sender_user_id uuid,
  content text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 50), 1), 50);
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  return query
  select page.id, page.room_id, page.sender_user_id, page.content, page.created_at
  from (
    select message.id,
           message.room_id,
           message.sender_user_id,
           message.content,
           message.created_at
    from public.room_messages message
    where message.room_id = target_room_id
      and (after_message_id is null or message.id > after_message_id)
    order by message.id desc
    limit safe_limit
  ) page
  order by page.id;
end;
$$;

create function public.get_round_message_updates(
  target_round_id bigint,
  after_message_id bigint default null,
  requested_limit integer default 10
)
returns table (
  id bigint,
  round_id bigint,
  sender_user_id uuid,
  kind text,
  content text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 10), 1), 10);
  target_room_id bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select round.room_id
  into target_room_id
  from public.game_rounds round
  where round.id = target_round_id;

  if target_room_id is null or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  return query
  select page.id,
         page.round_id,
         page.sender_user_id,
         page.kind,
         page.content,
         page.created_at
  from (
    select message.id,
           message.round_id,
           message.sender_user_id,
           message.kind,
           message.content,
           message.created_at
    from public.round_messages message
    where message.round_id = target_round_id
      and (after_message_id is null or message.id > after_message_id)
    order by message.id desc
    limit safe_limit
  ) page
  order by page.id;
end;
$$;

create function public.get_round_draw_updates(
  target_round_id bigint,
  after_event_id bigint default null,
  requested_limit integer default 100
)
returns table (
  id bigint,
  round_id bigint,
  changes jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(requested_limit, 100), 1), 100);
  target_room_id bigint;
  latest_event_id bigint;
  snapshot_required boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select round.room_id
  into target_room_id
  from public.game_rounds round
  where round.id = target_round_id;

  if target_room_id is null or not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  select max(event.id)
  into latest_event_id
  from public.round_draw_events event
  where event.round_id = target_round_id;

  if latest_event_id is null or
     (after_event_id is not null and after_event_id >= latest_event_id) then
    return;
  end if;

  select after_event_id is null or count(*) > safe_limit
  into snapshot_required
  from public.round_draw_events event
  where event.round_id = target_round_id
    and (after_event_id is null or event.id > after_event_id);

  if snapshot_required then
    return query
    with expanded as (
      select event.id as event_id,
             change.position,
             (change.value ->> 'x')::integer as x,
             (change.value ->> 'y')::integer as y,
             change.value ->> 'color' as color
      from public.round_draw_events event
      cross join lateral jsonb_array_elements(event.changes)
        with ordinality as change(value, position)
      where event.round_id = target_round_id
    ), latest_pixels as (
      select distinct on (expanded.x, expanded.y)
             expanded.x,
             expanded.y,
             expanded.color
      from expanded
      order by expanded.x,
               expanded.y,
               expanded.event_id desc,
               expanded.position desc
    )
    select latest_event_id,
           target_round_id,
           jsonb_agg(
             jsonb_build_object(
               'x', latest_pixels.x,
               'y', latest_pixels.y,
               'color', latest_pixels.color
             )
             order by latest_pixels.y, latest_pixels.x
           )
    from latest_pixels;
    return;
  end if;

  return query
  select event.id, event.round_id, event.changes
  from public.round_draw_events event
  where event.round_id = target_round_id
    and event.id > after_event_id
  order by event.id
  limit safe_limit;
end;
$$;

revoke all on function public.get_room_message_updates(bigint, bigint, integer)
from public, anon;
grant execute on function public.get_room_message_updates(bigint, bigint, integer)
to authenticated;

revoke all on function public.get_round_message_updates(bigint, bigint, integer)
from public, anon;
grant execute on function public.get_round_message_updates(bigint, bigint, integer)
to authenticated;

revoke all on function public.get_round_draw_updates(bigint, bigint, integer)
from public, anon;
grant execute on function public.get_round_draw_updates(bigint, bigint, integer)
to authenticated;
