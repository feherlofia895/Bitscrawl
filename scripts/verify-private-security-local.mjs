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
