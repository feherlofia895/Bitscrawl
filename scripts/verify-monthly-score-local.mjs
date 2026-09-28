// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from(
  { length: 12 },
  (_, index) => `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
)
const drawing = JSON.stringify(
  Array.from({ length: 1024 }, (_, index) => (index === 0 ? '#d3493b' : 'transparent')),
)
const ids = {}

async function asUser(user, sql, params = [], { anonymous = false, role = 'authenticated' } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
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

async function addVotes(kind, challengeId, entryId, voters) {
  for (const voter of voters) {
    await db.query(
      `insert into public.${kind}_votes (challenge_id, entry_id, voter_user_id) values ($1, $2, $3)`,
      [challengeId, entryId, voter],
    )
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

  const names = ['martinteteme', 'MatthewOG', 'Kinga', 'MonthlyAdmin']
  for (let index = 0; index < users.length; index += 1) {
    await asUser(users[index], 'select public.set_weekly_profile($1)', [names[index] ?? `MonthlyVoter${index}`])
  }
  await db.query('insert into private.app_admins (user_id) values ($1)', [users[3]])

  ids.monthly = (await db.query(`
    insert into public.monthly_challenges (
      month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at
    ) values (
      'score-month', 'Béka', clock_timestamp() - interval '4 days',
      clock_timestamp() - interval '3 days', clock_timestamp() - interval '2 days',
      clock_timestamp() - interval '1 day'
    ) returning id
  `)).rows[0].id
  ids.monthlyEntries = []
  for (const user of users.slice(0, 3)) {
    ids.monthlyEntries.push((await db.query(
      `insert into public.monthly_entries (challenge_id, user_id, pixels, submitted_at)
       values ($1, $2, $3::jsonb, clock_timestamp() - interval '2 days') returning id`,
      [ids.monthly, user, drawing],
    )).rows[0].id)
  }
  await addVotes('monthly', ids.monthly, ids.monthlyEntries[0], users.slice(4, 9))
  await addVotes('monthly', ids.monthly, ids.monthlyEntries[1], users.slice(4, 8))

  ids.weekly = (await db.query(`
    insert into public.weekly_challenges (week_key, prompt, starts_at, ends_at)
    values ('score-week', 'Boszorkány', clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day')
    returning id
  `)).rows[0].id
  ids.weeklyMartin = (await db.query(
    'insert into public.weekly_entries (challenge_id, user_id, pixels) values ($1, $2, $3::jsonb) returning id',
    [ids.weekly, users[0], drawing],
  )).rows[0].id
  ids.weeklyKinga = (await db.query(
    'insert into public.weekly_entries (challenge_id, user_id, pixels) values ($1, $2, $3::jsonb) returning id',
    [ids.weekly, users[2], drawing],
  )).rows[0].id
  await addVotes('weekly', ids.weekly, ids.weeklyMartin, [users[4]])
  await addVotes('weekly', ids.weekly, ids.weeklyKinga, [users[4], users[5]])
  await asUser(users[3], 'select * from public.finalize_weekly_challenge($1)', [ids.weekly])

  ids.activeMonthly = (await db.query(`
    insert into public.monthly_challenges (
      month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at
    ) values (
      'active-score-month', 'Aktív', clock_timestamp() - interval '2 days',
      clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day',
      clock_timestamp() + interval '2 days'
    ) returning id
  `)).rows[0].id
})

after(async () => {
  await db.close()
})

test('monthly finalization is admin-only, waits for the end and keeps its ledger private', async () => {
  for (const schema of ['public', 'private']) {
    await assert.rejects(
      asUser(users[0], `select * from ${schema}.finalize_monthly_challenge($1)`, [ids.monthly]),
      /ADMIN_REQUIRED/,
    )
  }
  await assert.rejects(
    asUser(null, 'select * from public.finalize_monthly_challenge($1)', [ids.monthly], { role: 'anon' }),
    /permission denied/,
  )
  await assert.rejects(
    asUser(users[3], 'select * from public.finalize_monthly_challenge($1)', [ids.activeMonthly]),
    /MONTHLY_CHALLENGE_ACTIVE/,
  )
  await assert.rejects(
    asUser(users[3], 'select * from private.monthly_score_awards'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(users[3], 'select private.recalculate_monthly_score_placements($1)', [ids.monthly]),
    /permission denied/,
  )
})

test('monthly entry and vote points join the weekly lifetime scoreboard exactly once', async () => {
  const [result] = await asUser(
    users[3],
    'select * from public.finalize_monthly_challenge($1)',
    [ids.monthly],
  )
  assert.deepEqual(result, {
    challenge_id: ids.monthly,
    awards_count: 3,
    total_vote_points: 9,
    already_finalized: false,
  })

  const before = (await db.query(
    'select * from private.monthly_score_awards where challenge_id = $1 order by user_id',
    [ids.monthly],
  )).rows
  const [again] = await asUser(
    users[3],
    'select * from public.finalize_monthly_challenge($1)',
    [ids.monthly],
  )
  assert.equal(again.already_finalized, true)
  assert.deepEqual((await db.query(
    'select * from private.monthly_score_awards where challenge_id = $1 order by user_id',
    [ids.monthly],
  )).rows, before)

  const scoreboard = await asUser(null, 'select * from public.get_lifetime_scoreboard()', [], { role: 'anon' })
  assert.deepEqual(scoreboard.map((entry) => [
    entry.display_name,
    Number(entry.total_points),
    Number(entry.vote_points),
    Number(entry.challenges_entered),
  ]), [
    ['martinteteme', 8, 6, 2],
    ['MatthewOG', 5, 4, 1],
    ['Kinga', 4, 2, 2],
  ])

  const hall = await asUser(
    null,
    'select * from public.get_challenge_hall_of_fame()',
    [],
    { role: 'anon' },
  )
  assert(hall.some((entry) => entry.challenge_kind === 'monthly'
    && entry.period_key === 'score-month'
    && entry.display_name === 'martinteteme'
    && Number(entry.placement) === 1
    && Number(entry.points) === 6))
  assert(hall.some((entry) => entry.challenge_kind === 'weekly'
    && entry.period_key === 'score-week'
    && entry.display_name === 'Kinga'
    && Number(entry.placement) === 1))
  assert(hall.every((entry) => !('user_id' in entry) && !('email' in entry)))
})

test('monthly gallery and profile trophies use the finalized monthly podium', async () => {
  const gallery = await asUser(
    null,
    'select author_name, vote_count, is_winner from public.get_monthly_gallery($1) order by vote_count desc',
    [ids.monthly],
    { role: 'anon' },
  )
  assert.deepEqual(gallery.map((entry) => [entry.author_name, Number(entry.vote_count), entry.is_winner]), [
    ['martinteteme', 5, true],
    ['MatthewOG', 4, false],
    ['Kinga', 0, false],
  ])

  const page = await asUser(
    null,
    'select author_name, is_winner from public.get_monthly_gallery_page($1)',
    [ids.monthly],
    { role: 'anon' },
  )
  assert.equal(page.find((entry) => entry.author_name === 'martinteteme').is_winner, true)

  const [martinStats] = await asUser(
    null,
    "select * from public.get_public_profile_stats('martinteteme')",
    [],
    { role: 'anon' },
  )
  assert.deepEqual({
    trophies: martinStats.trophy_count,
    gold: martinStats.gold_count,
    silver: martinStats.silver_count,
    bronze: martinStats.bronze_count,
  }, { trophies: 2, gold: 1, silver: 1, bronze: 0 })
})

test('monthly moderation removes points and recalculates the monthly podium atomically', async () => {
  await asUser(
    users[3],
    "select public.moderate_delete_content('monthly-entry', $1)",
    [ids.monthlyEntries[0]],
  )

  const removed = (await db.query(
    `select excluded_at is not null as excluded, exclusion_reason, placement
     from private.monthly_score_awards where challenge_id = $1 and user_id = $2`,
    [ids.monthly, users[0]],
  )).rows[0]
  assert.equal(removed.excluded, true)
  assert.match(removed.exclusion_reason, /Moderált havi nevezés/)
  assert.equal(removed.placement, null)

  const next = (await db.query(
    'select placement from private.monthly_score_awards where challenge_id = $1 and user_id = $2',
    [ids.monthly, users[1]],
  )).rows[0]
  assert.equal(next.placement, 1)

  const scoreboard = await asUser(null, 'select * from public.get_lifetime_scoreboard()', [], { role: 'anon' })
  assert.deepEqual(scoreboard.map((entry) => [entry.display_name, Number(entry.total_points)]), [
    ['MatthewOG', 5],
    ['Kinga', 4],
    ['martinteteme', 2],
  ])
  const gallery = await asUser(
    null,
    'select author_name, is_winner from public.get_monthly_gallery($1)',
    [ids.monthly],
    { role: 'anon' },
  )
  assert.deepEqual(gallery, [
    { author_name: 'MatthewOG', is_winner: true },
    { author_name: 'Kinga', is_winner: false },
  ])

  const [martinStats] = await asUser(
    null,
    "select * from public.get_public_profile_stats('martinteteme')",
    [],
    { role: 'anon' },
  )
  assert.deepEqual({
    trophies: martinStats.trophy_count,
    gold: martinStats.gold_count,
    silver: martinStats.silver_count,
    bronze: martinStats.bronze_count,
  }, { trophies: 1, gold: 0, silver: 1, bronze: 0 })
})
