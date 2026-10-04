// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from(
  { length: 4 },
  (_, index) => `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
)

async function asUser(userId, sql, params = [], { anonymous = true, role = 'authenticated' } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ''])
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ is_anonymous: anonymous }),
  ])
  await db.exec(`set role ${role}`)
  try {
    return (await db.query(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

function submit(userId, overrides = {}) {
  const input = {
    category: 'bug',
    description: 'Részletes automatizált hibajelentés.',
    reporterName: 'Tesztelő',
    roomCode: 'ABC234',
    roomId: 42,
    steps: 'Megnyitás után azonnal látható.',
    technicalContext: { automated: true },
    ...overrides,
  }
  return asUser(userId, `select public.submit_bug_report(
    $1, $2, $3, $4, $5, $6, $7::jsonb
  ) as report_id`, [
    input.category,
    input.description,
    input.reporterName,
    input.roomCode,
    input.roomId,
    input.steps,
    JSON.stringify(input.technicalContext),
  ])
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
  for (const user of users) await db.query('insert into auth.users values ($1)', [user])

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

after(async () => { await db.close() })

test('anonymous player sessions can submit, while the server owns the user id', async () => {
  const [{ report_id: reportId }] = await submit(users[0], {
    reporterName: '  Mobil Tesztelő  ',
    roomCode: 'abc234',
  })
  const [stored] = (await db.query(`
    select user_id, reporter_name, room_code, status
    from public.bug_reports where id = $1
  `, [reportId])).rows
  assert.deepEqual(stored, {
    user_id: users[0],
    reporter_name: 'Mobil Tesztelő',
    room_code: 'ABC234',
    status: 'new',
  })
})

test('direct table writes and unauthenticated RPC calls are denied', async () => {
  const [access] = (await db.query(`
    select
      has_any_column_privilege('authenticated', 'public.bug_reports', 'INSERT') as column_insert,
      has_sequence_privilege('authenticated', 'public.bug_reports_id_seq', 'USAGE') as sequence_usage
  `)).rows
  assert.deepEqual(access, { column_insert: false, sequence_usage: false })
  await assert.rejects(
    asUser(users[1], `insert into public.bug_reports (user_id, description)
      values ($1, 'Közvetlen tiltott beszúrás')`, [users[1]]),
    /permission denied/,
  )
  await assert.rejects(
    asUser(null, `select public.submit_bug_report(
      'bug', 'Bejelentkezés nélküli próba.', null, null, null, null, '{}'::jsonb
    )`, [], { role: 'anon' }),
    /permission denied/,
  )
})

test('public RPC is an invoker wrapper around a private definer', async () => {
  const signature = 'submit_bug_report(text,text,text,text,bigint,text,jsonb)'
  const rows = (await db.query(`
    select schema_name.nspname as schema_name,
      function_definition.prosecdef as security_definer,
      function_definition.proconfig as config,
      has_function_privilege('anon', function_definition.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', function_definition.oid, 'EXECUTE') as member_execute
    from pg_proc function_definition
    join pg_namespace schema_name on schema_name.oid = function_definition.pronamespace
    where function_definition.oid in (
      ('public.' || $1)::regprocedure,
      ('private.' || $1)::regprocedure
    )
    order by schema_name.nspname
  `, [signature])).rows
  assert.deepEqual(rows.map((row) => [row.schema_name, row.security_definer]), [
    ['private', true],
    ['public', false],
  ])
  assert.ok(rows.every((row) => row.config?.includes('search_path=""')))
  assert.ok(rows.every((row) => !row.anon_execute && row.member_execute))
})

test('server rejects invalid feedback fields before insertion', async () => {
  for (const [overrides, pattern] of [
    [{ category: 'spam' }, /BUG_REPORT_CATEGORY_INVALID/],
    [{ description: 'rövid' }, /BUG_REPORT_DESCRIPTION_INVALID/],
    [{ reporterName: 'x'.repeat(65) }, /BUG_REPORT_REPORTER_INVALID/],
    [{ roomCode: 'BAD-ROOM' }, /BUG_REPORT_ROOM_INVALID/],
    [{ roomId: 0 }, /BUG_REPORT_ROOM_INVALID/],
    [{ steps: 'x'.repeat(1501) }, /BUG_REPORT_STEPS_INVALID/],
    [{ technicalContext: ['not', 'an', 'object'] }, /BUG_REPORT_CONTEXT_INVALID/],
    [{ technicalContext: { oversized: 'x'.repeat(17000) } }, /BUG_REPORT_CONTEXT_INVALID/],
  ]) {
    await assert.rejects(submit(users[3], overrides), pattern)
  }
  assert.equal(
    (await db.query('select count(*)::integer as count from public.bug_reports where user_id = $1', [users[3]])).rows[0].count,
    0,
  )
})

test('rate limiting enforces both the cooldown and five reports per hour', async () => {
  await submit(users[1])
  await assert.rejects(submit(users[1]), /BUG_REPORT_RATE_LIMIT/)

  await db.query(`update public.bug_reports
    set created_at = clock_timestamp() - interval '1 minute'
    where user_id = $1`, [users[1]])
  for (let index = 0; index < 4; index += 1) {
    await submit(users[1], { description: `Órán belüli automatizált hibajelentés ${index + 2}.` })
    await db.query(`update public.bug_reports
      set created_at = clock_timestamp() - interval '1 minute'
      where user_id = $1`, [users[1]])
  }
  await assert.rejects(submit(users[1]), /BUG_REPORT_RATE_LIMIT/)
  assert.equal(
    (await db.query('select count(*)::integer as count from public.bug_reports where user_id = $1', [users[1]])).rows[0].count,
    5,
  )

  const [{ report_id: otherReportId }] = await submit(users[2])
  assert.ok(Number(otherReportId) > 0)
})
