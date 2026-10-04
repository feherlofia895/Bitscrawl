// Isolated in-memory PostgreSQL security checks. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const protectedTables = [
  'app_admins',
  'competition_entries',
  'competition_votes',
  'monthly_score_awards',
  'weekly_score_awards',
]
const authenticatedDefinerRpcs = [
  ['advance_game', 'target_round_id bigint'],
  ['choose_round_word', 'target_round_id bigint, selected_word text'],
  ['create_room', 'player_name text'],
  ['finish_expired_round', 'target_round_id bigint'],
  ['get_global_lobby_messages', ''],
  ['get_online_profiles', ''],
  ['get_own_profile_note', 'target_profile_name text'],
  ['get_round_view', 'target_room_id bigint'],
  ['join_room', 'room_code text, player_name text'],
  ['leave_room', 'target_room_id bigint'],
  ['restart_game', 'target_room_id bigint'],
  ['resume_room', 'room_code text'],
  ['send_global_lobby_message', 'requested_content text'],
  ['send_room_message', 'target_room_id bigint, message_content text'],
  ['set_room_test_mode', 'target_room_id bigint, test_mode_enabled boolean'],
  ['start_game', 'target_room_id bigint'],
  ['submit_guess', 'target_round_id bigint, submitted_guess text'],
  ['submit_pixel_changes', 'target_round_id bigint, pixel_changes jsonb'],
  ['touch_global_lobby_presence', ''],
  ['touch_room_presence', 'target_room_id bigint'],
]

async function asRole(role, sql, params = []) {
  await db.exec(`set role ${role}`)
  try {
    return (await db.query(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
    create schema extensions;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
      $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
    create publication supabase_realtime;
  `)

  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    try {
      await db.exec(await readFile(new URL(file, migrationDir), 'utf8'))
    } catch (error) {
      throw new Error(`Migration failed: ${file}: ${error.message}`)
    }
  }
})

after(async () => {
  await db.close()
})

test('sensitive private tables use deny-by-default RLS', async () => {
  const rows = (await db.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as force_rls,
      (select count(*)::integer from pg_catalog.pg_policies policy
       where policy.schemaname = 'private' and policy.tablename = c.relname) as policy_count
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = any($1::text[])
    order by c.relname
  `, [protectedTables])).rows

  assert.deepEqual(rows.map((row) => row.table_name), protectedTables)
  for (const row of rows) {
    assert.equal(row.rls_enabled, true, `${row.table_name} has RLS disabled`)
    assert.equal(row.force_rls, false, `${row.table_name} unexpectedly forces RLS on owner functions`)
    assert.equal(row.policy_count, 0, `${row.table_name} unexpectedly exposes rows through a policy`)
  }
})

test('application roles still have no direct access to protected tables', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of protectedTables) {
      await assert.rejects(
        asRole(role, `select count(*) from private.${table}`),
        /permission denied/,
        `${role} unexpectedly read private.${table}`,
      )
    }
  }
})

test('public profile stats use an invoker wrapper around a private definer', async () => {
  const rows = (await db.query(`
    select n.nspname as schema_name, p.prosecdef as security_definer, p.proconfig as config
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'get_public_profile_stats'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'target_profile_name text'
    order by n.nspname
  `)).rows

  assert.deepEqual(rows.map((row) => [row.schema_name, row.security_definer]), [
    ['private', true],
    ['public', false],
  ])
  assert.ok(rows.every((row) => row.config?.includes('search_path=""')))

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await assert.rejects(
      asRole(role, "select * from public.get_public_profile_stats('NoSuchProfile')"),
      /PROFILE_NOT_FOUND/,
    )
  }
})

test('authenticated gameplay RPCs use invoker wrappers around private definers', async () => {
  const functionNames = [...new Set(authenticatedDefinerRpcs.map(([name]) => name))]
  const rows = (await db.query(`
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
      p.prosecdef as security_definer,
      p.proconfig as config,
      pg_catalog.has_function_privilege('anon', p.oid, 'execute') as anon_execute,
      pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
        as authenticated_execute,
      pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
        as service_role_execute
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public')
      and p.proname = any($1::text[])
  `, [functionNames])).rows

  for (const [functionName, identityArguments] of authenticatedDefinerRpcs) {
    const matchingRows = rows.filter((row) =>
      row.function_name === functionName
      && row.identity_arguments === identityArguments)

    assert.deepEqual(
      matchingRows.map((row) => [row.schema_name, row.security_definer]).sort(),
      [['private', true], ['public', false]],
      `${functionName}(${identityArguments}) does not have the expected private/public pair`,
    )

    for (const row of matchingRows) {
      assert.ok(
        row.config?.includes('search_path=""'),
        `${row.schema_name}.${functionName} does not have an empty search_path`,
      )
      assert.equal(row.anon_execute, false, `${row.schema_name}.${functionName} is callable by anon`)
      assert.equal(
        row.authenticated_execute,
        true,
        `${row.schema_name}.${functionName} is not callable by authenticated`,
      )
      assert.equal(
        row.service_role_execute,
        true,
        `${row.schema_name}.${functionName} is not callable by service_role`,
      )
    }
  }
})

test('no public security definer remains callable by authenticated users', async () => {
  const [{ function_count: functionCount }] = (await db.query(`
    select count(*)::integer as function_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
  `)).rows

  assert.equal(functionCount, 0)
})
