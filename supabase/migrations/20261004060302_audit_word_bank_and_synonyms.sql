-- Keep fast-round prompts concrete and remove the only accent-insensitive
-- collision (teve / tévé). Existing in-progress rounds keep working because
-- answer aliases below also cover the replaced historical prompt forms.
update private.word_bank set word = 'macska' where word = 'cica';
update private.word_bank set word = 'játékbaba' where word = 'baba';
update private.word_bank set word = 'kisegér' where word = 'egér';
update private.word_bank set word = 'fagylalt' where word = 'fagyi';
update private.word_bank set word = 'falevél' where word = 'levél';
update private.word_bank set word = 'motorkerékpár' where word = 'motor';
update private.word_bank set word = 'repülőgép' where word = 'repülő';
update private.word_bank set word = 'sütemény' where word = 'süti';
update private.word_bank set word = 'televízió' where word = 'tévé';
update private.word_bank set word = 'kastély' where word = 'vár';
update private.word_bank set word = 'evővilla' where word = 'villa';
update private.word_bank set word = 'falióra' where word = 'óra';

-- Krumpli and burgonya described the same prompt twice. The camel prompt was
-- removed because accent-insensitive matching made it collide with tévé.
delete from private.word_bank where word in ('burgonya', 'teve');

create table private.word_answer_aliases (
  prompt text not null,
  accepted_answer text not null,
  primary key (prompt, accepted_answer),
  constraint word_answer_aliases_prompt_format check (
    char_length(prompt) between 2 and 40
    and prompt = lower(btrim(prompt))
  ),
  constraint word_answer_aliases_answer_format check (
    char_length(accepted_answer) between 2 and 40
    and accepted_answer = lower(btrim(accepted_answer))
  ),
  constraint word_answer_aliases_not_identical check (prompt <> accepted_answer)
);

alter table private.word_answer_aliases enable row level security;
revoke all on private.word_answer_aliases from public, anon, authenticated, service_role;

insert into private.word_answer_aliases (prompt, accepted_answer)
values
  -- Replaced canonical prompts and their historical reverse mappings.
  ('macska', 'cica'),
  ('cica', 'macska'),
  ('játékbaba', 'baba'),
  ('baba', 'játékbaba'),
  ('kisegér', 'egér'),
  ('egér', 'kisegér'),
  ('fagylalt', 'fagyi'),
  ('fagyi', 'fagylalt'),
  ('falevél', 'levél'),
  ('levél', 'falevél'),
  ('motorkerékpár', 'motor'),
  ('motor', 'motorkerékpár'),
  ('repülőgép', 'repülő'),
  ('repülő', 'repülőgép'),
  ('sütemény', 'süti'),
  ('süti', 'sütemény'),
  ('televízió', 'tévé'),
  ('tévé', 'televízió'),
  ('kastély', 'vár'),
  ('vár', 'kastély'),
  ('evővilla', 'villa'),
  ('villa', 'evővilla'),
  ('falióra', 'óra'),
  ('óra', 'falióra'),
  ('krumpli', 'burgonya'),
  ('burgonya', 'krumpli'),
  -- Common, unambiguous alternatives for retained prompts.
  ('autó', 'kocsi'),
  ('autó', 'gépkocsi'),
  ('bicikli', 'kerékpár'),
  ('busz', 'autóbusz'),
  ('dinnye', 'görögdinnye'),
  ('fagylalt', 'jégkrém'),
  ('görkorcsolya', 'görkori'),
  ('hőlégballon', 'légballon'),
  ('lufi', 'léggömb'),
  ('mentőautó', 'mentő'),
  ('pálmafa', 'pálma'),
  ('számítógép', 'komputer'),
  ('televízió', 'tv'),
  ('tűzoltóautó', 'tűzoltókocsi'),
  ('űrhajós', 'asztronauta');

create or replace function private.answer_matches(
  target_word text,
  submitted_answer text
)
returns boolean
language sql
stable
strict
parallel safe
set search_path = ''
as $$
  select
    private.normalize_answer(submitted_answer) = private.normalize_answer(target_word)
    or exists (
      select 1
      from private.word_answer_aliases as alias
      where private.normalize_answer(alias.prompt) = private.normalize_answer(target_word)
        and private.normalize_answer(alias.accepted_answer) = private.normalize_answer(submitted_answer)
    );
$$;

revoke all on function private.answer_matches(text, text)
from public, anon, authenticated, service_role;

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

  guess_is_correct := private.answer_matches(target_word, clean_guess);

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
