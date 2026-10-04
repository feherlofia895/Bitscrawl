// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from(
  { length: 3 },
  (_, index) => `81000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
)
const ids = {}
const drawing = JSON.stringify(
  Array.from({ length: 1024 }, (_, index) => index === 0 ? '#d3493b' : 'transparent'),
)

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

  for (const user of users) {
    await db.query('insert into auth.users values ($1)', [user])
  }

  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    try {
      await db.exec(await readFile(new URL(file, migrationDir), 'utf8'))
    } catch (error) {
      throw new Error(`Migration failed: ${file}: ${error.message}`)
    }
  }

  for (let index = 0; index < users.length; index += 1) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[index]])
    await db.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ is_anonymous: false }),
    ])
    await db.query('select public.set_weekly_profile($1)', [`Retention${index + 1}`])
  }

  const roomRows = (await db.query(`
    insert into public.rooms (code, host_user_id, status, created_at, started_at, finished_at)
    values
      ('ABC234', $1, 'finished', now() - interval '45 days', now() - interval '44 days', now() - interval '40 days'),
      ('DEF567', $1, 'waiting', now() - interval '45 days', null, null),
      ('GHK789', $1, 'waiting', now() - interval '60 days', null, null),
      ('JKL234', $1, 'waiting', now(), null, null)
    returning id, code
  `, [users[0]])).rows

  for (const room of roomRows) ids[room.code] = room.id

  await db.query(`
    insert into public.room_players (room_id, user_id, display_name, joined_at, last_seen_at)
    values
      ($1, $5, 'Finished', now() - interval '44 days', now() - interval '40 days'),
      ($2, $5, 'Inactive', now() - interval '45 days', now() - interval '40 days'),
      ($3, $6, 'Active', now() - interval '60 days', now()),
      ($4, $7, 'Fresh', now(), now())
  `, [ids.ABC234, ids.DEF567, ids.GHK789, ids.JKL234, ...users])

  const round = (await db.query(`
    insert into public.game_rounds (
      room_id, round_number, drawer_user_id, status, created_at,
      drawing_started_at, drawing_ends_at, finished_at
    )
    values (
      $1, 1, $2, 'finished', now() - interval '40 days',
      now() - interval '40 days', now() - interval '40 days' + interval '90 seconds',
      now() - interval '40 days' + interval '90 seconds'
    )
    returning id
  `, [ids.DEF567, users[0]])).rows[0]

  await db.query(`
    insert into public.round_draw_events (round_id, room_id, created_by, changes, created_at)
    values ($1, $2, $3, '[{"index":0,"color":"#242630"}]'::jsonb, now() - interval '40 days')
  `, [round.id, ids.DEF567, users[0]])
  await db.query(`
    insert into public.round_messages (round_id, room_id, sender_user_id, kind, content, created_at)
    values ($1, $2, $3, 'correct', null, now() - interval '40 days')
  `, [round.id, ids.DEF567, users[1]])
  await db.query(`
    insert into public.room_messages (room_id, sender_user_id, content, created_at)
    values ($1, $2, 'Old room chat', now() - interval '40 days')
  `, [ids.DEF567, users[0]])

  const competitionRound = (await db.query(`
    insert into public.competition_rounds (
      room_id, round_number, status, word, drawing_started_at, drawing_ends_at, finished_at
    )
    values (
      $1, 1, 'finished', 'macska', now() - interval '40 days',
      now() - interval '40 days' + interval '90 seconds',
      now() - interval '40 days' + interval '3 minutes'
    )
    returning id
  `, [ids.ABC234])).rows[0]
  await db.query(`
    insert into public.competition_draw_events (round_id, room_id, user_id, changes, created_at)
    values ($1, $2, $3, '[{"index":0,"color":"#242630"}]'::jsonb, now() - interval '40 days')
  `, [competitionRound.id, ids.ABC234, users[0]])
  await db.query(
    'insert into private.competition_entries (round_id, user_id) values ($1, $2)',
    [competitionRound.id, users[0]],
  )

  const oldLobby = (await db.query(`
    insert into public.lobby_messages (user_id, content, created_at)
    values ($1, 'Old lobby chat', now() - interval '31 days')
    returning id
  `, [users[0]])).rows[0]
  const recentLobby = (await db.query(`
    insert into public.lobby_messages (user_id, content, created_at)
    values ($1, 'Recent lobby chat', now())
    returning id
  `, [users[1]])).rows[0]
  ids.oldLobby = oldLobby.id
  ids.recentLobby = recentLobby.id

  ids.feedPost = (await db.query(
    'insert into public.feed_posts (user_id, pixels) values ($1, $2::jsonb) returning id',
    [users[2], drawing],
  )).rows[0].id
  const weeklyChallenge = (await db.query(
    'select id from public.weekly_challenges order by id limit 1',
  )).rows[0]
  ids.weeklyEntry = (await db.query(
    'insert into public.weekly_entries (challenge_id, user_id, pixels) values ($1, $2, $3::jsonb) returning id',
    [weeklyChallenge.id, users[2], drawing],
  )).rows[0].id
})

after(async () => {
  await db.close()
})

test('the retention cleanup cannot be called by application roles', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await assert.rejects(
      asRole(role, 'select * from private.cleanup_expired_game_data()'),
      /permission denied/,
    )
  }
})

test('cleanup removes only expired room and lobby data', async () => {
  const [result] = (await db.query('select * from private.cleanup_expired_game_data()')).rows
  assert.equal(Number(result.deleted_lobby_messages), 1)
  assert.equal(Number(result.deleted_rooms), 2)

  const remainingRooms = (await db.query('select code from public.rooms order by code')).rows
  assert.deepEqual(remainingRooms, [{ code: 'GHK789' }, { code: 'JKL234' }])

  for (const table of [
    'public.game_rounds',
    'public.round_draw_events',
    'public.round_messages',
    'public.room_messages',
    'public.competition_rounds',
    'public.competition_draw_events',
    'private.competition_entries',
  ]) {
    const [{ count }] = (await db.query(`select count(*)::integer as count from ${table}`)).rows
    assert.equal(count, 0, `${table} retained cascaded room data`)
  }

  assert.equal(
    (await db.query('select count(*)::integer as count from public.lobby_messages where id = $1', [ids.oldLobby])).rows[0].count,
    0,
  )
  assert.equal(
    (await db.query('select count(*)::integer as count from public.lobby_messages where id = $1', [ids.recentLobby])).rows[0].count,
    1,
  )
  assert.equal(
    (await db.query('select count(*)::integer as count from public.feed_posts where id = $1', [ids.feedPost])).rows[0].count,
    1,
  )
  assert.equal(
    (await db.query('select count(*)::integer as count from public.weekly_entries where id = $1', [ids.weeklyEntry])).rows[0].count,
    1,
  )
})
