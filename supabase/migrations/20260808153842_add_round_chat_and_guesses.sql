create table public.round_messages (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.game_rounds (id) on delete cascade,
  room_id bigint not null references public.rooms (id) on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  content text,
  created_at timestamptz not null default now(),
  constraint round_messages_kind_values check (kind in ('guess', 'correct')),
  constraint round_messages_content_matches_kind check (
    (kind = 'guess' and content is not null and char_length(content) between 1 and 80)
    or (kind = 'correct' and content is null)
  )
);

create index round_messages_round_id_id_idx
  on public.round_messages (round_id, id);

create index round_messages_room_id_idx
  on public.round_messages (room_id);

create index round_messages_sender_user_id_idx
  on public.round_messages (sender_user_id);

create unique index round_messages_one_correct_per_player_idx
  on public.round_messages (round_id, sender_user_id)
  where kind = 'correct';

alter table public.round_messages enable row level security;

create policy round_messages_member_select
on public.round_messages
for select
to authenticated
using ((select private.is_room_member(room_id)));

revoke all on public.round_messages from anon, authenticated;
grant select on public.round_messages to authenticated;

create or replace function private.normalize_answer(input_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select lower(
    translate(
      regexp_replace(btrim(input_text), '\s+', ' ', 'g'),
      'áéíóöőúüűÁÉÍÓÖŐÚÜŰ',
      'aeiooouuuAEIOOOUUU'
    )
  );
$$;

revoke all on function private.normalize_answer(text)
from public, anon, authenticated, service_role;

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

  select gr.room_id, gr.drawer_user_id, gr.status, secrets.chosen_word
  into target_room_id, target_drawer_user_id, target_round_status, target_word
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

revoke all on function public.submit_guess(bigint, text) from public, anon;
grant execute on function public.submit_guess(bigint, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'round_messages'
  ) then
    alter publication supabase_realtime add table public.round_messages;
  end if;
end;
$$;
