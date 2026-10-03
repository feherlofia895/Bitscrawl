// Isolated transition test. Uses only synthetic in-memory data and never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migrationName = '20261002120000_monthly_128_halloween_and_archive_snowman.sql'
const captionCleanupMigration = '20261002130000_remove_archived_snowman_caption.sql'
const users = [
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000003',
]
const drawing = JSON.stringify(Array.from(
  { length: 1024 },
  (_, index) => index < 8 ? '#d3493b' : 'transparent',
))

async function asUser(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ is_anonymous: false })])
  await db.exec('set role authenticated')
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
  for (const user of users) await db.query('insert into auth.users values ($1)', [user])

  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files.filter(file => file < migrationName)) {
    await db.exec(await readFile(new URL(file, migrationDir), 'utf8'))
  }

  await asUser(users[0], 'select public.set_weekly_profile($1)', ['Vivi'])
  await asUser(users[1], 'select public.set_weekly_profile($1)', ['MatthewOG'])
  await asUser(users[2], 'select public.set_weekly_profile($1)', ['Kinga'])

  const october = (await db.query(`
    select id from public.monthly_challenges where month_key = '2026-10'
  `)).rows[0] ?? (await db.query(`
    insert into public.monthly_challenges (
      month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at
    ) values (
      '2026-10', 'Hóember', clock_timestamp() - interval '1 day',
      clock_timestamp() + interval '20 days', clock_timestamp() + interval '20 days',
      clock_timestamp() + interval '29 days'
    ) returning id
  `)).rows[0]
  await db.query(`
    update public.monthly_challenges
    set prompt = 'Hóember', description = '32×32 Hóember'
    where id = $1
  `, [october.id])
  await db.query(`
    insert into public.monthly_entries (challenge_id, user_id, pixels, palette_id, submitted_at)
    values ($1, $2, $3::jsonb, 'editor-32-v1', clock_timestamp() - interval '1 hour')
  `, [october.id, users[0], drawing])

  const september = (await db.query(`
    insert into public.monthly_challenges (
      month_key, prompt, starts_at, voting_starts_at, submission_ends_at, ends_at
    ) values (
      '2026-09', 'Béka', clock_timestamp() - interval '32 days',
      clock_timestamp() - interval '12 days', clock_timestamp() - interval '12 days',
      clock_timestamp() - interval '2 days'
    ) returning id
  `)).rows[0]
  const entries = []
  for (const user of users.slice(1)) {
    entries.push((await db.query(`
      insert into public.monthly_entries (challenge_id, user_id, pixels, submitted_at)
      values ($1, $2, $3::jsonb, clock_timestamp() - interval '10 days') returning id
    `, [september.id, user, drawing])).rows[0].id)
  }
  await db.query(
    'insert into public.monthly_votes (challenge_id, entry_id, voter_user_id) values ($1, $2, $3)',
    [september.id, entries[0], users[0]],
  )

  await db.exec(await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL(`../supabase/migrations/${captionCleanupMigration}`, import.meta.url), 'utf8'))
})

after(async () => { await db.close() })

test('the snowman is moved to Vivi\'s wall and removed from the monthly challenge', async () => {
  const feed = (await db.query(`
    select profile.display_name, post.description, jsonb_array_length(post.pixels)::integer as pixel_count
    from public.feed_posts post
    join public.profiles profile on profile.user_id = post.user_id
  `)).rows
  assert.deepEqual(feed, [{
    display_name: 'Vivi',
    description: '',
    pixel_count: 1024,
  }])
  assert.equal((await db.query(`
    select count(*)::integer as count
    from public.monthly_entries entry
    join public.monthly_challenges challenge on challenge.id = entry.challenge_id
    where challenge.month_key = '2026-10'
  `)).rows[0].count, 0)
})

test('October becomes 128 by 128 Halloween and the old Frog month is finalized', async () => {
  const october = (await db.query(`
    select prompt, canvas_size, description
    from public.monthly_challenges where month_key = '2026-10'
  `)).rows[0]
  assert.equal(october.prompt, 'Halloween')
  assert.equal(october.canvas_size, 128)
  assert.match(october.description, /128×128/)

  const september = (await db.query(`
    select finalized_at is not null as finalized,
      (select count(*)::integer from private.monthly_score_awards award where award.challenge_id = challenge.id) as awards
    from public.monthly_challenges challenge where month_key = '2026-09'
  `)).rows[0]
  assert.deepEqual(september, { finalized: true, awards: 2 })
  const awards = (await db.query(`
    select profile.display_name, award.entry_points, award.vote_points, award.placement
    from private.monthly_score_awards award
    join public.profiles profile on profile.user_id = award.user_id
    order by award.vote_points desc, profile.display_name
  `)).rows
  assert.deepEqual(awards, [
    { display_name: 'MatthewOG', entry_points: 1, vote_points: 1, placement: 1 },
    { display_name: 'Kinga', entry_points: 1, vote_points: 0, placement: null },
  ])
})
