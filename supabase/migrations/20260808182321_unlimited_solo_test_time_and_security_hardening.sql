alter table private.word_bank enable row level security;
alter table private.round_secrets enable row level security;

create or replace function public.choose_round_word(
  target_round_id bigint,
  selected_word text
)
returns table (round_id bigint, round_status text, chosen_word text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_drawer_user_id uuid;
  target_round_status text;
  target_test_mode boolean;
  target_player_count integer;
  available_words text[];
  clean_word text := lower(btrim(selected_word));
  round_started_at timestamptz;
  round_ends_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, rooms.test_mode
  into target_room_id, target_drawer_user_id, target_round_status,
       target_test_mode
  from public.game_rounds as gr
  join public.rooms as rooms on rooms.id = gr.room_id
  where gr.id = target_round_id
  for update of gr;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if target_drawer_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROUND_DRAWER';
  end if;

  if target_round_status <> 'choosing' then
    raise exception using errcode = 'P0001', message = 'ROUND_ALREADY_STARTED';
  end if;

  select count(*)::integer
  into target_player_count
  from public.room_players
  where room_id = target_room_id;

  select word_options
  into available_words
  from private.round_secrets
  where round_id = target_round_id;

  if clean_word is null or not (clean_word = any(available_words)) then
    raise exception using errcode = 'P0001', message = 'WORD_NOT_AVAILABLE';
  end if;

  round_started_at := clock_timestamp();
  round_ends_at := case
    when target_test_mode and target_player_count = 1 then null
    when target_test_mode then round_started_at + interval '15 seconds'
    else round_started_at + interval '90 seconds'
  end;

  update private.round_secrets
  set chosen_word = clean_word
  where round_id = target_round_id;

  update public.game_rounds
  set status = 'drawing',
      drawing_started_at = round_started_at,
      drawing_ends_at = round_ends_at
  where id = target_round_id;

  return query
  select target_round_id, 'drawing'::text, clean_word;
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
  target_drawing_ends_at timestamptz;
  target_test_mode boolean;
  target_player_count integer;
  created_event_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, gr.drawing_ends_at,
         rooms.test_mode
  into target_room_id, target_drawer_user_id, target_round_status,
       target_drawing_ends_at, target_test_mode
  from public.game_rounds as gr
  join public.rooms as rooms on rooms.id = gr.room_id
  where gr.id = target_round_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if target_drawer_user_id <> current_user_id then
    raise exception using errcode = 'P0001', message = 'NOT_ROUND_DRAWER';
  end if;

  if target_round_status <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  select count(*)::integer
  into target_player_count
  from public.room_players
  where room_id = target_room_id;

  if target_drawing_ends_at is null then
    if not target_test_mode or target_player_count <> 1 then
      raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
    end if;
  elsif clock_timestamp() >= target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
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
