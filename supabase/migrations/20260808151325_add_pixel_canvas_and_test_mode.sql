alter table public.rooms
  add column test_mode boolean not null default false;

create table public.round_draw_events (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.game_rounds (id) on delete cascade,
  room_id bigint not null references public.rooms (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  changes jsonb not null,
  created_at timestamptz not null default now(),
  constraint round_draw_events_changes_array check (
    jsonb_typeof(changes) = 'array'
    and jsonb_array_length(changes) between 1 and 64
  )
);

create index round_draw_events_round_id_id_idx
  on public.round_draw_events (round_id, id);

create index round_draw_events_room_id_idx
  on public.round_draw_events (room_id);

create index round_draw_events_created_by_idx
  on public.round_draw_events (created_by);

alter table public.round_draw_events enable row level security;

create policy round_draw_events_member_select
on public.round_draw_events
for select
to authenticated
using ((select private.is_room_member(room_id)));

revoke all on public.round_draw_events from anon, authenticated;
grant select on public.round_draw_events to authenticated;

create or replace function public.set_room_test_mode(
  target_room_id bigint,
  test_mode_enabled boolean
)
returns table (room_id bigint, test_mode boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_room_status text;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select host_user_id, status
  into target_host_user_id, target_room_status
  from public.rooms
  where id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_host_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;

  if target_room_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  update public.rooms
  set test_mode = test_mode_enabled
  where id = target_room_id;

  return query
  select target_room_id, test_mode_enabled;
end;
$$;

create or replace function public.start_game(target_room_id bigint)
returns table (room_id bigint, room_status text, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_host_user_id uuid;
  target_room_status text;
  target_test_mode boolean;
  current_player_count integer;
  first_drawer_user_id uuid;
  round_word_options text[];
  created_round_id bigint;
  game_started_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select host_user_id, status, test_mode
  into target_host_user_id, target_room_status, target_test_mode
  from public.rooms
  where id = target_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_host_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROOM_HOST';
  end if;

  if target_room_status <> 'waiting' then
    raise exception using errcode = 'P0001', message = 'GAME_ALREADY_STARTED';
  end if;

  select count(*)::integer
  into current_player_count
  from public.room_players
  where room_id = target_room_id;

  if current_player_count < (case when target_test_mode then 1 else 2 end) then
    raise exception using errcode = 'P0001', message = 'NOT_ENOUGH_PLAYERS';
  end if;

  select user_id
  into first_drawer_user_id
  from public.room_players
  where room_id = target_room_id
  order by joined_at, id
  limit 1;

  select array_agg(random_words.word)
  into round_word_options
  from (
    select word
    from private.word_bank
    order by random()
    limit 3
  ) as random_words;

  if cardinality(round_word_options) <> 3 then
    raise exception using errcode = 'P0001', message = 'WORD_BANK_TOO_SMALL';
  end if;

  game_started_at := now();

  update public.rooms
  set status = 'playing',
      started_at = game_started_at
  where id = target_room_id;

  insert into public.game_rounds (room_id, round_number, drawer_user_id)
  values (target_room_id, 1, first_drawer_user_id)
  returning id into created_round_id;

  insert into private.round_secrets (round_id, word_options)
  values (created_round_id, round_word_options);

  return query
  select target_room_id, 'playing'::text, game_started_at;
end;
$$;

create or replace function public.submit_pixel_changes(
  target_round_id bigint,
  pixel_changes jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_drawer_user_id uuid;
  target_round_status text;
  created_event_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select room_id, drawer_user_id, status
  into target_room_id, target_drawer_user_id, target_round_status
  from public.game_rounds
  where id = target_round_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if target_drawer_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROUND_DRAWER';
  end if;

  if target_round_status <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  if pixel_changes is null
    or jsonb_typeof(pixel_changes) <> 'array'
    or jsonb_array_length(pixel_changes) not between 1 and 64
  then
    raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(pixel_changes) as pixel(change)
    where jsonb_typeof(pixel.change) <> 'object'
      or not (pixel.change ? 'x' and pixel.change ? 'y' and pixel.change ? 'color')
      or coalesce(pixel.change->>'x', '') !~ '^(0|[1-9]|[12][0-9]|3[01])$'
      or coalesce(pixel.change->>'y', '') !~ '^(0|[1-9]|[12][0-9]|3[01])$'
      or coalesce(pixel.change->>'color', '') not in (
        '#241a35',
        '#f7f3e8',
        '#9b7ede',
        '#4ecdc4',
        '#ffd166',
        '#ff6b6b',
        '#4d96ff',
        '#7b8794',
        'transparent'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'PIXEL_CHANGES_INVALID';
  end if;

  insert into public.round_draw_events (
    round_id,
    room_id,
    created_by,
    changes
  )
  values (
    target_round_id,
    target_room_id,
    current_user_id,
    pixel_changes
  )
  returning id into created_event_id;

  return created_event_id;
end;
$$;

revoke all on function public.set_room_test_mode(bigint, boolean) from public, anon;
revoke all on function public.submit_pixel_changes(bigint, jsonb) from public, anon;
grant execute on function public.set_room_test_mode(bigint, boolean) to authenticated;
grant execute on function public.submit_pixel_changes(bigint, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_draw_events'
  ) then
    alter publication supabase_realtime add table public.round_draw_events;
  end if;
end;
$$;
