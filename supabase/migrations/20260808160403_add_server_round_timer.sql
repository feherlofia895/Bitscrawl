alter table public.game_rounds
  add column drawing_ends_at timestamptz;

update public.game_rounds
set drawing_ends_at = coalesce(drawing_started_at, created_at) + interval '90 seconds'
where status in ('drawing', 'finished')
  and drawing_ends_at is null;

alter table public.game_rounds
  add constraint game_rounds_drawing_time_order check (
    drawing_ends_at is null
    or (
      drawing_started_at is not null
      and drawing_ends_at > drawing_started_at
    )
  );

drop function public.get_round_view(bigint);

create function public.get_round_view(target_room_id bigint)
returns table (
  round_id bigint,
  round_number smallint,
  round_status text,
  drawer_user_id uuid,
  is_drawer boolean,
  word_options text[],
  chosen_word text,
  drawing_ends_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  active_round_id bigint;
  active_round_number smallint;
  active_round_status text;
  active_drawer_user_id uuid;
  active_word_options text[];
  active_chosen_word text;
  active_drawing_ends_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  select gr.id, gr.round_number, gr.status, gr.drawer_user_id,
         secrets.word_options, secrets.chosen_word, gr.drawing_ends_at
  into active_round_id, active_round_number, active_round_status,
       active_drawer_user_id, active_word_options, active_chosen_word,
       active_drawing_ends_at
  from public.game_rounds as gr
  join private.round_secrets as secrets on secrets.round_id = gr.id
  where gr.room_id = target_room_id
    and gr.status in ('choosing', 'drawing', 'finished')
  order by gr.round_number desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  return query
  select
    active_round_id,
    active_round_number,
    active_round_status,
    active_drawer_user_id,
    current_user_id = active_drawer_user_id,
    case
      when current_user_id = active_drawer_user_id
        and active_round_status = 'choosing'
      then active_word_options
      else null::text[]
    end,
    case
      when current_user_id = active_drawer_user_id
        or active_round_status = 'finished'
      then active_chosen_word
      else null::text
    end,
    active_drawing_ends_at,
    clock_timestamp();
end;
$$;

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
  target_drawer_user_id uuid;
  target_round_status text;
  target_test_mode boolean;
  available_words text[];
  clean_word text := lower(btrim(selected_word));
  round_started_at timestamptz;
  round_ends_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select gr.drawer_user_id, gr.status, rooms.test_mode
  into target_drawer_user_id, target_round_status, target_test_mode
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

  select word_options
  into available_words
  from private.round_secrets
  where round_id = target_round_id;

  if clean_word is null or not (clean_word = any(available_words)) then
    raise exception using errcode = 'P0001', message = 'WORD_NOT_AVAILABLE';
  end if;

  round_started_at := clock_timestamp();
  round_ends_at := round_started_at + case
    when target_test_mode then interval '15 seconds'
    else interval '90 seconds'
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
  created_event_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select room_id, drawer_user_id, status, drawing_ends_at
  into target_room_id, target_drawer_user_id, target_round_status,
       target_drawing_ends_at
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

  if target_drawing_ends_at is null or clock_timestamp() >= target_drawing_ends_at then
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

create or replace function public.submit_guess(
  target_round_id bigint,
  submitted_guess text
)
returns table (message_id bigint, is_correct boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  clean_guess text := btrim(submitted_guess);
  target_room_id bigint;
  target_drawer_user_id uuid;
  target_round_status text;
  target_drawing_ends_at timestamptz;
  target_word text;
  guess_is_correct boolean;
  created_message_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_guess is null or char_length(clean_guess) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'GUESS_INVALID';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, gr.drawing_ends_at,
         secrets.chosen_word
  into target_room_id, target_drawer_user_id, target_round_status,
       target_drawing_ends_at, target_word
  from public.game_rounds as gr
  join private.round_secrets as secrets on secrets.round_id = gr.id
  where gr.id = target_round_id
  for update of gr;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_drawer_user_id = current_user_id then
    raise exception using errcode = 'P0001', message = 'DRAWER_CANNOT_GUESS';
  end if;

  if target_round_status <> 'drawing' or target_word is null then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  if target_drawing_ends_at is null or clock_timestamp() >= target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_EXPIRED';
  end if;

  if exists (
    select 1
    from public.round_messages
    where round_id = target_round_id
      and sender_user_id = current_user_id
      and kind = 'correct'
  ) then
    raise exception using errcode = 'P0001', message = 'ALREADY_GUESSED';
  end if;

  guess_is_correct :=
    private.normalize_answer(clean_guess) = private.normalize_answer(target_word);

  insert into public.round_messages (
    round_id,
    room_id,
    sender_user_id,
    kind,
    content
  )
  values (
    target_round_id,
    target_room_id,
    current_user_id,
    case when guess_is_correct then 'correct' else 'guess' end,
    case when guess_is_correct then null else clean_guess end
  )
  returning id into created_message_id;

  return query
  select created_message_id, guess_is_correct;
end;
$$;

create function public.finish_expired_round(target_round_id bigint)
returns table (round_id bigint, round_status text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  target_room_id bigint;
  target_round_status text;
  target_drawing_ends_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select room_id, status, drawing_ends_at
  into target_room_id, target_round_status, target_drawing_ends_at
  from public.game_rounds
  where id = target_round_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_FOUND';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if target_round_status = 'finished' then
    return query select target_round_id, 'finished'::text;
    return;
  end if;

  if target_round_status <> 'drawing' then
    raise exception using errcode = 'P0001', message = 'ROUND_NOT_DRAWING';
  end if;

  if target_drawing_ends_at is null or clock_timestamp() < target_drawing_ends_at then
    raise exception using errcode = 'P0001', message = 'ROUND_TIME_REMAINING';
  end if;

  update public.game_rounds
  set status = 'finished'
  where id = target_round_id;

  return query select target_round_id, 'finished'::text;
end;
$$;

revoke all on function public.get_round_view(bigint) from public, anon;
revoke all on function public.finish_expired_round(bigint) from public, anon;
grant execute on function public.get_round_view(bigint) to authenticated;
grant execute on function public.finish_expired_round(bigint) to authenticated;
