// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 5 }, (_, index) =>
  `51000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
const anonymousUser = '52000000-0000-4000-8000-000000000001'
const baseDrawing = color => JSON.stringify(Array.from({ length: 1024 }, (_, index) => index < 4 ? color : 'transparent'))
const expandedColor = '#c57ca8'
let monthlyChallengeId

async function asUser(user, sql, params = [], { anonymous = false, role = 'authenticated' } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ is_anonymous: anonymous })])
  await db.exec(`set role ${role}`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
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
  for (const user of [...users, anonymousUser]) await db.query('insert into auth.users values ($1)', [user])
  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
  for (let index = 0; index < users.length; index += 1) {
    await asUser(users[index], 'select public.set_weekly_profile($1)', [`RuleTester${index + 1}`])
  }
  ;[{ id: monthlyChallengeId }] = (await db.query(`
    insert into public.monthly_challenges
      (month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at)
    values
      ('synthetic-overlap', 'Synthetic', clock_timestamp() - interval '2 days',
       clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 day',
       clock_timestamp() + interval '1 day')
    returning id
  `)).rows
})
after(async () => { await db.close() })

test('historical week cleanup preserves Gomba and leaves the published Witch schedule', async () => {
  const rows = (await db.query(`
    select week_key, prompt, starts_at, ends_at
    from public.weekly_challenges
    where week_key in ('2026-W38', '2026-W39', '2026-W40')
    order by week_key
  `)).rows
  assert.ok(rows.some(row => row.week_key === '2026-W38' && row.prompt === 'Gomba'))
  assert.ok(!rows.some(row => row.week_key === '2026-W39' && row.prompt === 'Polip'))
  const witch = rows.find(row => row.week_key === '2026-W40')
  assert.equal(witch?.prompt, 'Boszorkány')
  assert.equal(new Date(witch.starts_at).toISOString(), '2026-09-27T21:00:00.000Z')
  assert.equal(new Date(witch.ends_at).toISOString(), '2026-10-04T18:00:00.000Z')
})

test('weekly submissions accept the expanded palette while retaining legacy palette rows', async () => {
  const challenge = (await db.query(`
    insert into public.weekly_challenges (week_key, prompt, starts_at, ends_at)
    values ('synthetic-palette', 'Palette', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour')
    returning id
  `)).rows[0]
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challenge.id, baseDrawing(expandedColor)])
  await asUser(users[0], 'select public.submit_weekly_entry($1, $2::jsonb)', [challenge.id, baseDrawing(expandedColor)])
  const expanded = (await db.query(
    'select palette_id from public.weekly_entries where challenge_id = $1 and user_id = $2',
    [challenge.id, users[0]],
  )).rows[0]
  assert.equal(expanded.palette_id, 'editor-32-v1')
  await assert.rejects(
    asUser(users[1], 'select public.save_weekly_draft($1, $2::jsonb)', [challenge.id, baseDrawing('#ffffff')]),
    /WEEKLY_DRAWING_INVALID/,
  )
  await db.query(
    'insert into public.weekly_entries (challenge_id, user_id, pixels, palette_id) values ($1, $2, $3::jsonb, $4)',
    [challenge.id, users[2], baseDrawing('#d3493b'), 'base-12-v1'],
  )
  assert.equal((await db.query(
    "select count(*)::integer as count from public.weekly_entries where challenge_id = $1 and palette_id = 'base-12-v1'",
    [challenge.id],
  )).rows[0].count, 1)
})

test('monthly voting can overlap new entries without reopening submitted artwork edits', async () => {
  await db.query(`
    insert into public.monthly_entries (challenge_id, user_id, pixels, submitted_at)
    values ($1, $2, $3::jsonb, clock_timestamp() - interval '2 days')
  `, [monthlyChallengeId, users[0], baseDrawing('#d3493b')])
  await assert.rejects(
    asUser(users[0], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, baseDrawing('#da7149')]),
    /MONTHLY_DRAWING_LOCKED/,
  )

  await asUser(users[1], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, baseDrawing('#e29958')])
  const firstSubmission = await asUser(users[1], 'select public.submit_monthly_entry($1)', [monthlyChallengeId])
  const repeatedSubmission = await asUser(users[1], 'select public.submit_monthly_entry($1)', [monthlyChallengeId])
  assert.equal(
    new Date(repeatedSubmission[0].submit_monthly_entry).toISOString(),
    new Date(firstSubmission[0].submit_monthly_entry).toISOString(),
  )
  await assert.rejects(
    asUser(users[1], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, baseDrawing('#f5e57a')]),
    /MONTHLY_DRAWING_LOCKED/,
  )

  await asUser(users[2], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, baseDrawing('#a5d967')])
  await asUser(users[2], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, baseDrawing('#67ba62')])
  await asUser(users[2], 'select public.submit_monthly_entry($1)', [monthlyChallengeId])
  const target = (await db.query(
    'select id from public.monthly_entries where challenge_id = $1 and user_id = $2',
    [monthlyChallengeId, users[1]],
  )).rows[0]
  assert.deepEqual(
    await asUser(users[3], 'select * from public.set_monthly_vote($1, true)', [target.id]),
    [{ voted: true, active_vote_count: 1 }],
  )
})

test('challenge end closes new monthly entries and direct table writes stay denied', async () => {
  await db.query(
    "update public.monthly_challenges set ends_at = clock_timestamp() - interval '1 second' where id = $1",
    [monthlyChallengeId],
  )
  await assert.rejects(
    asUser(users[3], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, baseDrawing('#d3493b')]),
    /MONTHLY_DRAWING_LOCKED/,
  )
  await assert.rejects(
    asUser(users[3], 'insert into public.monthly_entries (challenge_id, user_id, pixels) values ($1, $2, $3::jsonb)', [monthlyChallengeId, users[3], baseDrawing('#d3493b')]),
    /permission denied/,
  )
  await assert.rejects(
    asUser(anonymousUser, 'select public.set_weekly_profile($1)', ['Anonymous'], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
})
