// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 6 }, (_, index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
const anonymousUser = '20000000-0000-4000-8000-000000000001'
let challengeId
const colors = ['#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967', '#67ba62']
const drawing = (color) => Array.from({ length: 1024 }, (_, index) => index < 4 ? color : 'transparent')

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
  ;[{ challenge_id: challengeId }] = await asUser(null, 'select * from public.get_weekly_challenges()', [], { role: 'anon' })
})

after(async () => { await db.close() })

test('only permanent users can create unique, validated profiles', async () => {
  await assert.rejects(
    asUser(anonymousUser, 'select public.set_weekly_profile($1)', ['Anon'], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(asUser(users[0], 'select public.set_weekly_profile($1)', ['x']), /WEEKLY_NAME_INVALID/)
  for (let index = 0; index < users.length; index += 1) {
    const [{ set_weekly_profile: name }] = await asUser(
      users[index], 'select public.set_weekly_profile($1)', [`Artist${index + 1}`],
    )
    assert.equal(name, `Artist${index + 1}`)
  }
  await assert.rejects(
    asUser(users[1], 'select public.set_weekly_profile($1)', ['artist1']),
    /WEEKLY_NAME_TAKEN/,
  )
})

test('profile avatars are validated, private and copied beside room names', async () => {
  await assert.rejects(
    asUser(anonymousUser, 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(drawing(colors[0]))], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(['#d3493b'])]),
    /PROFILE_AVATAR_INVALID/,
  )

  const firstAvatar = drawing(colors[0])
  await asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(firstAvatar)])
  const ownProfile = await asUser(users[0], 'select avatar_pixels from public.profiles where user_id = $1', [users[0]])
  const hiddenProfile = await asUser(users[1], 'select avatar_pixels from public.profiles where user_id = $1', [users[0]])
  assert.deepEqual(ownProfile[0].avatar_pixels, firstAvatar)
  assert.equal(hiddenProfile.length, 0)

  const [{ id: roomId }] = (await db.query(
    "insert into public.rooms (code, host_user_id) values ('AVATAR', $1) returning id",
    [users[0]],
  )).rows
  await db.query(
    'insert into public.room_players (room_id, user_id, display_name) values ($1, $2, $3)',
    [roomId, users[0], 'Artist1'],
  )
  let [{ avatar_pixels: roomAvatar }] = (await db.query(
    'select avatar_pixels from public.room_players where room_id = $1 and user_id = $2',
    [roomId, users[0]],
  )).rows
  assert.deepEqual(roomAvatar, firstAvatar)

  const updatedAvatar = drawing(colors[1])
  await asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(updatedAvatar)])
  ;[{ avatar_pixels: roomAvatar }] = (await db.query(
    'select avatar_pixels from public.room_players where room_id = $1 and user_id = $2',
    [roomId, users[0]],
  )).rows
  assert.deepEqual(roomAvatar, updatedAvatar)
})

test('drafts are validated, private and atomically replaceable', async () => {
  await assert.rejects(
    asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(['#d3493b'])]),
    /WEEKLY_DRAWING_INVALID/,
  )
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[0]))])
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(Array(1024).fill('transparent'))])
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[0]))])
  const own = await asUser(users[0], 'select pixels from public.weekly_drafts where challenge_id = $1', [challengeId])
  const other = await asUser(users[1], 'select pixels from public.weekly_drafts where challenge_id = $1', [challengeId])
  assert.equal(own.length, 1)
  assert.equal(other.length, 0)
})

test('one validated entry per account reaches the public gallery', async () => {
  await assert.rejects(
    asUser(users[0], 'select public.submit_weekly_entry($1, $2::jsonb)', [challengeId, JSON.stringify(Array(1024).fill('transparent'))]),
    /WEEKLY_DRAWING_INVALID/,
  )
  for (let index = 0; index < users.length; index += 1) {
    await asUser(
      users[index], 'select public.submit_weekly_entry($1, $2::jsonb)',
      [challengeId, JSON.stringify(drawing(colors[index]))],
    )
  }
  await assert.rejects(
    asUser(users[0], 'select public.submit_weekly_entry($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[0]))]),
    /WEEKLY_ALREADY_SUBMITTED/,
  )
  const gallery = await asUser(null, 'select * from public.get_weekly_gallery($1)', [challengeId], { role: 'anon' })
  assert.equal(gallery.length, users.length)
  assert(gallery.every(entry => Number(entry.vote_count) === 0 && entry.has_voted === false))
  await assert.rejects(
    asUser(null, 'select user_id from public.weekly_entries', [], { role: 'anon' }),
    /permission denied/,
  )
  const directOwn = await asUser(users[0], 'select user_id from public.weekly_entries')
  assert.deepEqual(directOwn.map(entry => entry.user_id), [users[0]])
})

test('voting enforces ownership, the three-vote limit and moving a vote', async () => {
  const entries = await asUser(users[0], 'select entry_id, is_own from public.get_weekly_gallery($1)', [challengeId])
  const own = entries.find(entry => entry.is_own)
  const others = entries.filter(entry => !entry.is_own)
  await assert.rejects(
    asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [own.entry_id]),
    /WEEKLY_OWN_VOTE_FORBIDDEN/,
  )
  for (const entry of others.slice(0, 3)) {
    await asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [entry.entry_id])
  }
  await assert.rejects(
    asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [others[3].entry_id]),
    /WEEKLY_VOTE_LIMIT/,
  )
  await asUser(users[0], 'select * from public.set_weekly_vote($1, false)', [others[0].entry_id])
  const [moved] = await asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [others[3].entry_id])
  assert.equal(moved.active_vote_count, 3)
})

test('closing the challenge freezes writes and marks every tied leader', async () => {
  const entries = await asUser(users[1], 'select entry_id, is_own from public.get_weekly_gallery($1)', [challengeId])
  const targets = entries.filter(entry => !entry.is_own).slice(0, 2)
  for (const target of targets) {
    await asUser(users[1], 'select * from public.set_weekly_vote($1, true)', [target.entry_id])
  }
  await db.query("update public.weekly_challenges set ends_at = clock_timestamp() - interval '1 second' where id = $1", [challengeId])
  await assert.rejects(
    asUser(users[2], 'select * from public.set_weekly_vote($1, true)', [targets[0].entry_id]),
    /WEEKLY_CHALLENGE_CLOSED/,
  )
  await assert.rejects(
    asUser(users[2], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[2]))]),
    /WEEKLY_CHALLENGE_CLOSED/,
  )
  const gallery = await asUser(null, 'select * from public.get_weekly_gallery($1)', [challengeId], { role: 'anon' })
  const topVotes = gallery.reduce((max, entry) => Math.max(max, Number(entry.vote_count)), 0)
  assert(gallery.filter(entry => entry.is_winner).every(entry => Number(entry.vote_count) === topVotes))
  assert(gallery.some(entry => entry.is_winner))
  const [challenge] = await asUser(null, 'select * from public.get_weekly_challenges()', [], { role: 'anon' })
  assert.equal(challenge.challenge_status, 'closed')
})
