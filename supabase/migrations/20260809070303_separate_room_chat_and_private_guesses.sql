create table if not exists public.room_messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id) on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  constraint room_messages_content_length
    check (char_length(btrim(content)) between 1 and 500)
);

create index if not exists room_messages_room_id_id_idx
  on public.room_messages (room_id, id);

create index if not exists room_messages_sender_user_id_idx
  on public.room_messages (sender_user_id);

alter table public.room_messages enable row level security;

drop policy if exists room_messages_member_select on public.room_messages;

create policy room_messages_member_select
on public.room_messages
for select
to authenticated
using ((select private.is_room_member(room_id)));

revoke all on public.room_messages from anon, authenticated;
grant select on public.room_messages to authenticated;

create or replace function public.send_room_message(
  target_room_id bigint,
  message_content text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_content text := btrim(message_content);
  created_message_id bigint;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_content is null
    or char_length(clean_content) not between 1 and 500
  then
    raise exception using errcode = 'P0001', message = 'ROOM_MESSAGE_INVALID';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  insert into public.room_messages (room_id, sender_user_id, content)
  values (target_room_id, current_user_id, clean_content)
  returning id into created_message_id;

  return created_message_id;
end;
$$;

revoke all on function public.send_room_message(bigint, text)
from public, anon;
grant execute on function public.send_room_message(bigint, text)
to authenticated;

-- A korabbi kozos tippfolyambol eltavolitjuk a hibas tippeket, hogy azok
-- a migracio utan se maradjanak mas szobatagok szamara olvashatok.
delete from public.round_messages where kind = 'guess';

alter table public.round_messages
  drop constraint if exists round_messages_kind_values,
  drop constraint if exists round_messages_content_matches_kind;

alter table public.round_messages
  add constraint round_messages_kind_values check (kind = 'correct'),
  add constraint round_messages_content_matches_kind check (content is null);

create or replace function public.submit_guess(
  target_round_id bigint,
  submitted_guess text
)
returns table (
  message_id bigint,
  is_correct boolean,
  awarded_points integer,
  round_finished boolean
)
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
  target_drawing_started_at timestamptz;
  target_drawing_ends_at timestamptz;
  target_word text;
  guess_is_correct boolean;
  guess_time timestamptz;
  guesser_points integer := 0;
  created_message_id bigint := null;
  current_player_count integer;
  current_correct_count integer;
  round_was_finished boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if clean_guess is null or char_length(clean_guess) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'GUESS_INVALID';
  end if;

  select gr.room_id, gr.drawer_user_id, gr.status, gr.drawing_started_at,
         gr.drawing_ends_at, secrets.chosen_word
  into target_room_id, target_drawer_user_id, target_round_status,
       target_drawing_started_at, target_drawing_ends_at, target_word
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

  guess_time := clock_timestamp();

  if target_drawing_ends_at is null or guess_time >= target_drawing_ends_at then
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

  if guess_is_correct then
    guesser_points := least(
      500,
      greatest(
        100,
        100 + round(
          400 * greatest(
            0,
            extract(epoch from (target_drawing_ends_at - guess_time))
          ) / nullif(
            extract(epoch from (
              target_drawing_ends_at - target_drawing_started_at
            )),
            0
          )
        )::integer
      )
    );

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
      'correct',
      null
    )
    returning id into created_message_id;

    update public.room_players
    set score = score + case
      when user_id = current_user_id then guesser_points
      when user_id = target_drawer_user_id then 100
      else 0
    end
    where room_id = target_room_id
      and user_id in (current_user_id, target_drawer_user_id);

    select count(*)::integer
    into current_player_count
    from public.room_players
    where room_id = target_room_id;

    select count(*)::integer
    into current_correct_count
    from public.round_messages
    where round_id = target_round_id
      and kind = 'correct';

    if current_player_count > 1
      and current_correct_count >= current_player_count - 1
    then
      update public.game_rounds
      set status = 'finished',
          finished_at = guess_time
      where id = target_round_id;

      round_was_finished := true;
    end if;
  end if;

  return query
  select created_message_id, guess_is_correct, guesser_points,
         round_was_finished;
end;
$$;

revoke all on function public.submit_guess(bigint, text) from public, anon;
grant execute on function public.submit_guess(bigint, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;
end;
$$;
