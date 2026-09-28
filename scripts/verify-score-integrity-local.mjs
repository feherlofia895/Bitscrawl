// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationName = '20260928115608_fix_score_integrity_and_vote_quotas.sql'
const db = new PGlite()
const users = Array.from(
  { length: 12 },
  (_, index) => `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
)
const drawing = JSON.stringify(
  Array.from({ length: 1024 }, (_, index) => (index === 0 ? '#d3493b' : 'transparent')),
)
const ids = {}

async function asUser(user, sql, params = [], { anonymous = false, role = 'authenticated' } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.query('select set_config(\'request.jwt.claims\', $1, false)', [
    JSON.stringify({ is_anonymous: anonymous }),
  ])
  await db.exec(`set role ${role}`)
  try {
    return (await db.query(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function insertWeeklyChallenge(weekKey, prompt, { active = true } = {}) {
  const times = active
    ? "clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day'"
    : "clock_timestamp() - interval '3 days', clock_timestamp() - interval '1 day'"
  return (await db.query(
    `insert into public.weekly_challenges (week_key, prompt, starts_at, ends_at)
     values ($1, $2, ${times}) returning id`,
    [weekKey, prompt],
  )).rows[0].id
}

async function insertWeeklyEntry(challengeId, userId) {
  return (await db.query(
    'insert into public.weekly_entries (challenge_id, user_id, pixels) values ($1, $2, $3::jsonb) returning id',
    [challengeId, userId, drawing],
  )).rows[0].id
}

async function insertMonthlyEntry(challengeId, userId) {
  return (await db.query(
    `insert into public.monthly_entries (challenge_id, user_id, pixels, submitted_at)
     values ($1, $2, $3::jsonb, clock_timestamp()) returning id`,
    [challengeId, userId, drawing],
  )).rows[0].id
}

async function insertVotes(kind, challengeId, entryId, voterIds) {
  for (const voterId of voterIds) {
    await db.query(
      `insert into public.${kind}_votes (challenge_id, entry_id, voter_user_id) values ($1, $2, $3)`,
      [challengeId, entryId, voterId],
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
  const files = (await readdir(migrationDir))
    .filter((file) => file.endsWith('.sql') && file !== migrationName)
    .sort()
  for (const file of files) {
    try {
      await db.exec(await readFile(new URL(file, migrationDir), 'utf8'))
    } catch (error) {
      throw new Error(`Migration failed before score-integrity package: ${file}: ${error.message}`)
    }
  }

  const names = ['martinteteme', 'MatthewOG', 'Kinga', 'IntegrityAdmin', 'Adam', 'Vivi']
  for (let index = 0; index < names.length; index += 1) {
    await asUser(users[index], 'select public.set_weekly_profile($1)', [names[index]])
  }
  for (let index = names.length; index < users.length; index += 1) {
    await asUser(users[index], 'select public.set_weekly_profile($1)', [`IntegrityVoter${index}`])
  }
  await db.query('insert into private.app_admins (user_id) values ($1)', [users[3]])

  ids.firstWeek = (await db.query(
    "select id from public.weekly_challenges where week_key = '2026-W38' and prompt = 'Gomba'",
  )).rows[0].id
  ids.firstMartin = await insertWeeklyEntry(ids.firstWeek, users[0])
  ids.firstMatthew = await insertWeeklyEntry(ids.firstWeek, users[1])
  ids.firstKinga = await insertWeeklyEntry(ids.firstWeek, users[2])
  await insertVotes('weekly', ids.firstWeek, ids.firstMartin, users.slice(4, 9))
  await insertVotes('weekly', ids.firstWeek, ids.firstMatthew, users.slice(4, 8))
  await insertVotes('weekly', ids.firstWeek, ids.firstKinga, users.slice(4, 6))
  await asUser(users[3], 'select * from public.finalize_weekly_challenge($1)', [ids.firstWeek])

  const beforeCorrection = (await db.query(
    'select vote_points, placement from private.weekly_score_awards where challenge_id = $1 and user_id = $2',
    [ids.firstWeek, users[0]],
  )).rows[0]
  assert.equal(beforeCorrection.vote_points, 5)
  assert.equal(beforeCorrection.placement, 1)

  await db.exec(await readFile(new URL(migrationName, migrationDir), 'utf8'))
})

after(async () => {
  await db.close()
})

test('the first Gomba week keeps Martin at one participation point and uses the official winner', async () => {
  const award = (await db.query(
    `select entry_points, vote_points, bonus_points, placement, excluded_at
     from private.weekly_score_awards where challenge_id = $1 and user_id = $2`,
    [ids.firstWeek, users[0]],
  )).rows[0]
  assert.deepEqual(award, {
    entry_points: 1,
    vote_points: 0,
    bonus_points: 0,
    placement: null,
    excluded_at: null,
  })

  const scoreboard = await asUser(null, 'select * from public.get_lifetime_scoreboard()', [], { role: 'anon' })
  assert.deepEqual(
    scoreboard.map((row) => [row.display_name, Number(row.total_points)]),
    [['MatthewOG', 5], ['Kinga', 3], ['martinteteme', 1]],
  )

  const gallery = await asUser(
    null,
    'select author_name, vote_count, is_winner from public.get_weekly_gallery($1) order by vote_count desc',
    [ids.firstWeek],
    { role: 'anon' },
  )
  assert.deepEqual(gallery.map((row) => [row.author_name, Number(row.vote_count), row.is_winner]), [
    ['martinteteme', 5, false],
    ['MatthewOG', 4, true],
    ['Kinga', 2, false],
  ])

  const galleryPage = await asUser(
    null,
    'select author_name, is_winner from public.get_weekly_gallery_page($1)',
    [ids.firstWeek],
    { role: 'anon' },
  )
  assert.equal(galleryPage.find((row) => row.author_name === 'martinteteme').is_winner, false)
  assert.equal(galleryPage.find((row) => row.author_name === 'MatthewOG').is_winner, true)
})

test('later weekly votes count normally for Martin and the exception does not touch monthly data', async () => {
  const laterWeek = await insertWeeklyChallenge('integrity-later-week', 'Boszorkány')
  const martinEntry = await insertWeeklyEntry(laterWeek, users[0])
  const matthewEntry = await insertWeeklyEntry(laterWeek, users[1])
  await insertVotes('weekly', laterWeek, martinEntry, [users[4], users[5]])
  await insertVotes('weekly', laterWeek, matthewEntry, [users[4]])
  await asUser(users[3], 'select * from public.finalize_weekly_challenge($1)', [laterWeek])

  const laterAward = (await db.query(
    'select entry_points, vote_points, placement from private.weekly_score_awards where challenge_id = $1 and user_id = $2',
    [laterWeek, users[0]],
  )).rows[0]
  assert.deepEqual(laterAward, { entry_points: 1, vote_points: 2, placement: 1 })

  const monthlyChallenge = (await db.query(`
    insert into public.monthly_challenges (
      month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at
    ) values (
      'integrity-month', 'Béka', clock_timestamp() - interval '3 days',
      clock_timestamp() - interval '2 days', clock_timestamp() + interval '1 day',
      clock_timestamp() + interval '3 days'
    ) returning id
  `)).rows[0].id
  const monthlyMartin = await insertMonthlyEntry(monthlyChallenge, users[0])
  await insertVotes('monthly', monthlyChallenge, monthlyMartin, [users[4], users[5]])

  assert.equal((await db.query(
    'select count(*)::integer as count from public.monthly_votes where entry_id = $1',
    [monthlyMartin],
  )).rows[0].count, 2)
  assert.equal((await db.query(
    'select excluded_at is null as eligible from public.monthly_entries where id = $1',
    [monthlyMartin],
  )).rows[0].eligible, true)
})

test('moderating a finalized weekly entry removes its points and recalculates the official podium', async () => {
  const challenge = await insertWeeklyChallenge('integrity-moderation', 'Moderation')
  const first = await insertWeeklyEntry(challenge, users[4])
  const second = await insertWeeklyEntry(challenge, users[5])
  await insertVotes('weekly', challenge, first, [users[6], users[7], users[8]])
  await insertVotes('weekly', challenge, second, [users[6], users[7]])
  await asUser(users[3], 'select * from public.finalize_weekly_challenge($1)', [challenge])

  await asUser(users[3], "select public.moderate_delete_content('weekly-entry', $1)", [first])
  const excludedAward = (await db.query(
    `select excluded_at is not null as excluded, exclusion_reason, placement
     from private.weekly_score_awards where challenge_id = $1 and user_id = $2`,
    [challenge, users[4]],
  )).rows[0]
  assert.equal(excludedAward.excluded, true)
  assert.match(excludedAward.exclusion_reason, /Moderált heti nevezés/)
  assert.equal(excludedAward.placement, null)

  const nextAward = (await db.query(
    'select placement from private.weekly_score_awards where challenge_id = $1 and user_id = $2',
    [challenge, users[5]],
  )).rows[0]
  assert.equal(nextAward.placement, 1)

  const gallery = await asUser(
    null,
    'select author_name, is_winner from public.get_weekly_gallery($1)',
    [challenge],
    { role: 'anon' },
  )
  assert.deepEqual(gallery, [{ author_name: 'Vivi', is_winner: true }])
})

test('excluded weekly and monthly entries stop consuming vote quota without deleting vote history', async () => {
  const weeklyChallenge = await insertWeeklyChallenge('integrity-weekly-quota', 'Weekly quota')
  const weeklyEntries = []
  for (let index = 0; index < 5; index += 1) {
    weeklyEntries.push(await insertWeeklyEntry(weeklyChallenge, users[index]))
  }
  for (const entry of weeklyEntries.slice(0, 3)) {
    await insertVotes('weekly', weeklyChallenge, entry, [users[9]])
  }
  await asUser(users[3], "select public.moderate_delete_content('weekly-entry', $1)", [weeklyEntries[0]])
  const weeklyState = await asUser(users[9], 'select votes_used from public.get_weekly_account_state($1)', [weeklyChallenge])
  assert.equal(weeklyState[0].votes_used, 2)
  const weeklyVote = await asUser(users[9], 'select * from public.set_weekly_vote($1, true)', [weeklyEntries[3]])
  assert.deepEqual(weeklyVote, [{ voted: true, active_vote_count: 3 }])
  assert.equal((await db.query(
    'select count(*)::integer as count from public.weekly_votes where challenge_id = $1 and voter_user_id = $2',
    [weeklyChallenge, users[9]],
  )).rows[0].count, 4)

  const monthlyChallenge = (await db.query(`
    insert into public.monthly_challenges (
      month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at
    ) values (
      'integrity-monthly-quota', 'Monthly quota', clock_timestamp() - interval '3 days',
      clock_timestamp() - interval '2 days', clock_timestamp() + interval '1 day',
      clock_timestamp() + interval '3 days'
    ) returning id
  `)).rows[0].id
  const monthlyEntries = []
  for (let index = 0; index < 5; index += 1) {
    monthlyEntries.push(await insertMonthlyEntry(monthlyChallenge, users[index]))
  }
  for (const entry of monthlyEntries.slice(0, 3)) {
    await insertVotes('monthly', monthlyChallenge, entry, [users[9]])
  }
  await asUser(users[3], "select public.moderate_delete_content('monthly-entry', $1)", [monthlyEntries[0]])
  const monthlyState = await asUser(users[9], 'select votes_used from public.get_monthly_account_state($1)', [monthlyChallenge])
  assert.equal(monthlyState[0].votes_used, 2)
  const monthlyVote = await asUser(users[9], 'select * from public.set_monthly_vote($1, true)', [monthlyEntries[3]])
  assert.deepEqual(monthlyVote, [{ voted: true, active_vote_count: 3 }])
  assert.equal((await db.query(
    'select count(*)::integer as count from public.monthly_votes where challenge_id = $1 and voter_user_id = $2',
    [monthlyChallenge, users[9]],
  )).rows[0].count, 4)
})
