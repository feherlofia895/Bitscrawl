-- Keep privileged implementations out of PostgREST's exposed public schema.
-- The public API signatures stay unchanged and are rebuilt as invoker wrappers.

-- Reconcile an older production-only helper so a clean migration replay matches live.
create or replace function public.get_own_profile_note(target_profile_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when profile.user_id = auth.uid()
      and lower(profile.display_name) = lower('Kinga')
      and lower(profile.display_name) = lower(btrim(target_profile_name))
      then 'legkedvencebb bénadékom'
    else null
  end
  from public.profiles profile
  where profile.user_id = auth.uid()
$function$;

revoke all on function public.get_own_profile_note(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_own_profile_note(text)
  to authenticated, service_role;

comment on function public.get_own_profile_note(text) is
  'Returns a private profile note only when the authenticated player views their own matching profile.';

do $migration$
declare
  target record;
  expected_count integer;
  matched_count integer;
  processed_count integer := 0;
  call_arguments text;
  volatility_clause text;
  null_input_clause text;
  parallel_clause text;
begin
  select count(*)::integer
  into expected_count
  from (values
    ('advance_game', 'target_round_id bigint'),
    ('choose_round_word', 'target_round_id bigint, selected_word text'),
    ('create_room', 'player_name text'),
    ('finish_expired_round', 'target_round_id bigint'),
    ('get_global_lobby_messages', ''),
    ('get_online_profiles', ''),
    ('get_own_profile_note', 'target_profile_name text'),
    ('get_round_view', 'target_room_id bigint'),
    ('join_room', 'room_code text, player_name text'),
    ('leave_room', 'target_room_id bigint'),
    ('restart_game', 'target_room_id bigint'),
    ('resume_room', 'room_code text'),
    ('send_global_lobby_message', 'requested_content text'),
    ('send_room_message', 'target_room_id bigint, message_content text'),
    ('set_room_test_mode', 'target_room_id bigint, test_mode_enabled boolean'),
    ('start_game', 'target_room_id bigint'),
    ('submit_guess', 'target_round_id bigint, submitted_guess text'),
    ('submit_pixel_changes', 'target_round_id bigint, pixel_changes jsonb'),
    ('touch_global_lobby_presence', ''),
    ('touch_room_presence', 'target_room_id bigint')
  ) as expected(function_name, identity_arguments);

  select count(*)::integer
  into matched_count
  from pg_catalog.pg_proc function_definition
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_definition.pronamespace
  join (values
    ('advance_game', 'target_round_id bigint'),
    ('choose_round_word', 'target_round_id bigint, selected_word text'),
    ('create_room', 'player_name text'),
    ('finish_expired_round', 'target_round_id bigint'),
    ('get_global_lobby_messages', ''),
    ('get_online_profiles', ''),
    ('get_own_profile_note', 'target_profile_name text'),
    ('get_round_view', 'target_room_id bigint'),
    ('join_room', 'room_code text, player_name text'),
    ('leave_room', 'target_room_id bigint'),
    ('restart_game', 'target_room_id bigint'),
    ('resume_room', 'room_code text'),
    ('send_global_lobby_message', 'requested_content text'),
    ('send_room_message', 'target_room_id bigint, message_content text'),
    ('set_room_test_mode', 'target_room_id bigint, test_mode_enabled boolean'),
    ('start_game', 'target_room_id bigint'),
    ('submit_guess', 'target_round_id bigint, submitted_guess text'),
    ('submit_pixel_changes', 'target_round_id bigint, pixel_changes jsonb'),
    ('touch_global_lobby_presence', ''),
    ('touch_room_presence', 'target_room_id bigint')
  ) as expected(function_name, identity_arguments)
    on expected.function_name = function_definition.proname
   and expected.identity_arguments =
     pg_catalog.pg_get_function_identity_arguments(function_definition.oid)
  where function_schema.nspname = 'public';

  if matched_count <> expected_count then
    raise exception
      'Expected % audited public RPCs, found %; migration aborted',
      expected_count,
      matched_count;
  end if;

  for target in
    select
      function_definition.oid,
      function_definition.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(function_definition.oid)
        as identity_arguments,
      pg_catalog.pg_get_function_arguments(function_definition.oid)
        as full_arguments,
      pg_catalog.pg_get_function_result(function_definition.oid) as result_type,
      function_definition.pronargs as input_argument_count,
      function_definition.provolatile as volatility,
      function_definition.proisstrict as is_strict,
      function_definition.proparallel as parallel_mode,
      function_definition.prosecdef as security_definer,
      function_definition.proconfig as function_config,
      pg_catalog.obj_description(function_definition.oid, 'pg_proc')
        as function_comment
    from pg_catalog.pg_proc function_definition
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_definition.pronamespace
    join (values
      ('advance_game', 'target_round_id bigint'),
      ('choose_round_word', 'target_round_id bigint, selected_word text'),
      ('create_room', 'player_name text'),
      ('finish_expired_round', 'target_round_id bigint'),
      ('get_global_lobby_messages', ''),
      ('get_online_profiles', ''),
      ('get_own_profile_note', 'target_profile_name text'),
      ('get_round_view', 'target_room_id bigint'),
      ('join_room', 'room_code text, player_name text'),
      ('leave_room', 'target_room_id bigint'),
      ('restart_game', 'target_room_id bigint'),
      ('resume_room', 'room_code text'),
      ('send_global_lobby_message', 'requested_content text'),
      ('send_room_message', 'target_room_id bigint, message_content text'),
      ('set_room_test_mode', 'target_room_id bigint, test_mode_enabled boolean'),
      ('start_game', 'target_room_id bigint'),
      ('submit_guess', 'target_round_id bigint, submitted_guess text'),
      ('submit_pixel_changes', 'target_round_id bigint, pixel_changes jsonb'),
      ('touch_global_lobby_presence', ''),
      ('touch_room_presence', 'target_room_id bigint')
    ) as expected(function_name, identity_arguments)
      on expected.function_name = function_definition.proname
     and expected.identity_arguments =
       pg_catalog.pg_get_function_identity_arguments(function_definition.oid)
    where function_schema.nspname = 'public'
    order by function_definition.proname
  loop
    if not target.security_definer then
      raise exception
        'public.%(%) is not SECURITY DEFINER; migration aborted',
        target.function_name,
        target.identity_arguments;
    end if;

    if not coalesce(target.function_config, '{}'::text[])
      @> array['search_path=""']::text[] then
      raise exception
        'public.%(%) does not have an empty search_path; migration aborted',
        target.function_name,
        target.identity_arguments;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc private_function
      join pg_catalog.pg_namespace private_schema
        on private_schema.oid = private_function.pronamespace
      where private_schema.nspname = 'private'
        and private_function.proname = target.function_name
        and pg_catalog.pg_get_function_identity_arguments(private_function.oid) =
          target.identity_arguments
    ) then
      raise exception
        'private.%(%) already exists; migration aborted',
        target.function_name,
        target.identity_arguments;
    end if;

    execute format(
      'alter function public.%I(%s) set schema private',
      target.function_name,
      target.identity_arguments
    );

    select coalesce(string_agg(format('$%s', argument_number), ', '), '')
    into call_arguments
    from generate_series(1, target.input_argument_count) as argument_number;

    volatility_clause := case target.volatility
      when 'i' then 'immutable'
      when 's' then 'stable'
      else 'volatile'
    end;
    null_input_clause := case when target.is_strict
      then 'returns null on null input'
      else 'called on null input'
    end;
    parallel_clause := case target.parallel_mode
      when 's' then 'parallel safe'
      when 'r' then 'parallel restricted'
      else 'parallel unsafe'
    end;

    execute format($wrapper$
      create function public.%I(%s)
      returns %s
      language sql
      %s
      %s
      %s
      security invoker
      set search_path = ''
      as $function$
        select * from private.%I(%s)
      $function$
    $wrapper$,
      target.function_name,
      target.full_arguments,
      target.result_type,
      volatility_clause,
      null_input_clause,
      parallel_clause,
      target.function_name,
      call_arguments
    );

    execute format(
      'revoke all on function private.%I(%s) from public, anon, authenticated, service_role',
      target.function_name,
      target.identity_arguments
    );
    execute format(
      'grant execute on function private.%I(%s) to authenticated, service_role',
      target.function_name,
      target.identity_arguments
    );
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated, service_role',
      target.function_name,
      target.identity_arguments
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      target.function_name,
      target.identity_arguments
    );

    if target.function_comment is not null then
      execute format(
        'comment on function public.%I(%s) is %L',
        target.function_name,
        target.identity_arguments,
        target.function_comment
      );
    end if;

    processed_count := processed_count + 1;
  end loop;

  if processed_count <> expected_count then
    raise exception
      'Expected to migrate % audited RPCs, processed %; migration aborted',
      expected_count,
      processed_count;
  end if;
end;
$migration$;

grant usage on schema private to authenticated, service_role;
