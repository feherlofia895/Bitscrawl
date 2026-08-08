create table public.game_rounds (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.rooms (id) on delete cascade,
  round_number smallint not null,
  drawer_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'choosing',
  created_at timestamptz not null default now(),
  drawing_started_at timestamptz,
  constraint game_rounds_number_positive check (round_number > 0),
  constraint game_rounds_status_values check (
    status in ('choosing', 'drawing', 'finished')
  ),
  constraint game_rounds_room_number_unique unique (room_id, round_number)
);

create unique index game_rounds_one_active_per_room_idx
  on public.game_rounds (room_id)
  where status in ('choosing', 'drawing');

create index game_rounds_drawer_user_id_idx
  on public.game_rounds (drawer_user_id);

create table private.word_bank (
  word text primary key,
  constraint word_bank_format check (
    char_length(word) between 2 and 24
    and word = lower(btrim(word))
  )
);

create table private.round_secrets (
  round_id bigint primary key references public.game_rounds (id) on delete cascade,
  word_options text[] not null,
  chosen_word text,
  constraint round_secrets_three_options check (cardinality(word_options) = 3),
  constraint round_secrets_chosen_from_options check (
    chosen_word is null or chosen_word = any(word_options)
  )
);

insert into private.word_bank (word)
values
  ('alma'),
  ('autó'),
  ('cica'),
  ('csillag'),
  ('fa'),
  ('hajó'),
  ('hal'),
  ('ház'),
  ('kutya'),
  ('nap'),
  ('szív'),
  ('virág');

alter table public.game_rounds enable row level security;

create policy game_rounds_member_select
on public.game_rounds
for select
to authenticated
using ((select private.is_room_member(room_id)));

revoke all on public.game_rounds from anon, authenticated;
grant select on public.game_rounds to authenticated;

revoke all on private.word_bank from public, anon, authenticated;
revoke all on private.round_secrets from public, anon, authenticated;

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
  current_player_count integer;
  first_drawer_user_id uuid;
  round_word_options text[];
  created_round_id bigint;
  game_started_at timestamptz;
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

  select count(*)::integer
  into current_player_count
  from public.room_players
  where room_id = target_room_id;

  if current_player_count < 2 then
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

create or replace function public.get_round_view(target_room_id bigint)
returns table (
  round_id bigint,
  round_number smallint,
  round_status text,
  drawer_user_id uuid,
  is_drawer boolean,
  word_options text[],
  chosen_word text
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
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  if not private.is_room_member(target_room_id) then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  select gr.id, gr.round_number, gr.status, gr.drawer_user_id,
         secrets.word_options, secrets.chosen_word
  into active_round_id, active_round_number, active_round_status,
       active_drawer_user_id, active_word_options, active_chosen_word
  from public.game_rounds as gr
  join private.round_secrets as secrets on secrets.round_id = gr.id
  where gr.room_id = target_room_id
    and gr.status in ('choosing', 'drawing')
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
      when current_user_id = active_drawer_user_id then active_word_options
      else null::text[]
    end,
    case
      when current_user_id = active_drawer_user_id then active_chosen_word
      else null::text
    end;
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
  available_words text[];
  clean_word text := lower(btrim(selected_word));
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  select drawer_user_id, status
  into target_drawer_user_id, target_round_status
  from public.game_rounds
  where id = target_round_id
  for update;

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

  update private.round_secrets
  set chosen_word = clean_word
  where round_id = target_round_id;

  update public.game_rounds
  set status = 'drawing',
      drawing_started_at = now()
  where id = target_round_id;

  return query
  select target_round_id, 'drawing'::text, clean_word;
end;
$$;

revoke all on function public.get_round_view(bigint) from public, anon;
revoke all on function public.choose_round_word(bigint, text) from public, anon;
grant execute on function public.get_round_view(bigint) to authenticated;
grant execute on function public.choose_round_word(bigint, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_rounds'
  ) then
    alter publication supabase_realtime add table public.game_rounds;
  end if;
end;
$$;
