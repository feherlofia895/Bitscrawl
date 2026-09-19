// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { isRoundDuration, roundDurations } from '../src/lib/roundDuration.ts'

const db = new PGlite()
const host = '00000000-0000-4000-8000-000000000001'
const guest = '00000000-0000-4000-8000-000000000002'
const outsider = '00000000-0000-4000-8000-000000000003'
let legacyRoom

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
}

async function createRoom(duration = 90, withGuest = true, testMode = false) {
  const [room] = await asUser(host, 'select * from public.create_room_with_duration($1, $2)', ['Host', duration])
  if (withGuest) await asUser(guest, 'select * from public.join_room($1, $2)', [room.room_code, 'Guest'])
  if (testMode) await asUser(host, 'select * from public.set_room_test_mode($1, true)', [room.room_id])
  return room
}

async function beginDrawing(room) {
  await asUser(host, 'select * from public.start_game($1)', [room.room_id])
  return chooseWord(room)
}

async function chooseWord(room) {
  const [view] = await asUser(host, 'select * from public.get_round_view($1)', [room.room_id])
  await asUser(host, 'select * from public.choose_round_word($1, $2)', [view.round_id, view.word_options[0]])
  return (await db.query(`select id, extract(epoch from (drawing_ends_at - drawing_started_at))::integer as seconds
    from public.game_rounds where id = $1`, [view.round_id])).rows[0]
}

before(async () => {
  // Supabase platform fixtures only. All application tables/functions/RLS are the real migrations.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema extensions;
    -- Test-only random bytes for room codes; not a cryptography test.
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
      $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
    create publication supabase_realtime;
  `)
  for (const user of [host, guest, outsider]) await db.query('insert into auth.users values ($1)', [user])
  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    if (file.endsWith('_configurable_round_duration.sql')) {
      ;[legacyRoom] = await asUser(host, "select * from public.create_room('Legacy')")
    }
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
})

after(async () => { await db.close() })

test('client duration validation only accepts the five supported numeric values', () => {
  for (const value of roundDurations) assert.equal(isRoundDuration(value), true)
  for (const value of [null, undefined, '30', 0, 29, 31, 91, 30.5, NaN, Infinity]) {
    assert.equal(isRoundDuration(value), false)
  }
})

test('existing rooms and legacy creation retain a 90 second default', async () => {
  const [existing] = await asUser(host, 'select round_duration_seconds from public.rooms where id = $1', [legacyRoom.room_id])
  assert.equal(existing.round_duration_seconds, 90)
  const [legacy] = await asUser(host, "select * from public.create_room('Old client')")
  const [created] = await asUser(host, 'select round_duration_seconds from public.rooms where id = $1', [legacy.room_id])
  assert.equal(created.round_duration_seconds, 90)
})

test('all five round lengths drive the actual server deadline', async () => {
  for (const seconds of roundDurations) {
    const room = await createRoom(seconds)
    assert.equal((await beginDrawing(room)).seconds, seconds)
  }
})

test('only a member host may edit a waiting room, and every member sees the setting', async () => {
  const room = await createRoom(90)
  await assert.rejects(asUser(guest, 'select * from public.set_room_round_duration($1, 30)', [room.room_id]), /NOT_ROOM_HOST/)
  await assert.rejects(asUser(outsider, 'select * from public.set_room_round_duration($1, 30)', [room.room_id]), /NOT_ROOM_HOST/)
  await assert.rejects(asUser(null, 'select * from public.set_room_round_duration($1, 30)', [room.room_id]), /AUTH_REQUIRED/)
  await assert.rejects(asUser(null, 'select * from public.set_room_round_duration($1, 30)', [room.room_id], 'anon'), /permission denied/)
  await asUser(host, 'select * from public.set_room_round_duration($1, 45)', [room.room_id])
  const [visible] = await asUser(guest, 'select round_duration_seconds from public.rooms where id = $1', [room.room_id])
  assert.equal(visible.round_duration_seconds, 45)
  assert.deepEqual(await asUser(outsider, 'select id from public.rooms where id = $1', [room.room_id]), [])
  await asUser(host, 'select * from public.start_game($1)', [room.room_id])
  await assert.rejects(asUser(host, 'select * from public.set_room_round_duration($1, 90)', [room.room_id]), /GAME_ALREADY_STARTED/)
  assert.equal((await chooseWord(room)).seconds, 45)
})

test('invalid settings fail atomically and direct table writes are denied', async () => {
  const countBefore = (await db.query('select count(*)::integer as count from public.rooms')).rows[0].count
  for (const invalid of [null, 0, 29, 31, 91]) {
    await assert.rejects(asUser(host, 'select * from public.create_room_with_duration($1, $2)', ['Invalid', invalid]), /ROUND_DURATION_INVALID/)
  }
  assert.equal((await db.query('select count(*)::integer as count from public.rooms')).rows[0].count, countBefore)
  const room = await createRoom(60)
  for (const invalid of [null, 15, 31, 120]) {
    await assert.rejects(asUser(host, 'select * from public.set_room_round_duration($1, $2)', [room.room_id, invalid]), /ROUND_DURATION_INVALID/)
  }
  await assert.rejects(asUser(host, 'update public.rooms set round_duration_seconds = 30 where id = $1', [room.room_id]), /permission denied/)
  await assert.rejects(db.query('update public.rooms set round_duration_seconds = 31 where id = $1', [room.room_id]), /rooms_round_duration_seconds_values/)
  assert.equal((await beginDrawing(room)).seconds, 60)
})

test('rejoin and a restarted match keep the chosen duration', async () => {
  const room = await createRoom(30)
  await beginDrawing(room)
  await asUser(host, 'select * from public.resume_room($1)', [room.room_code])
  const [resumed] = await asUser(host, 'select round_duration_seconds from public.rooms where id = $1', [room.room_id])
  assert.equal(resumed.round_duration_seconds, 30)
  // Arrange an ended match without waiting for the game clock; restart uses the real RPC.
  await db.query("update public.rooms set status = 'finished', finished_at = clock_timestamp() where id = $1", [room.room_id])
  await assert.rejects(asUser(host, 'select * from public.set_room_round_duration($1, 90)', [room.room_id]), /GAME_ALREADY_STARTED/)
  await asUser(host, 'select * from public.restart_game($1)', [room.room_id])
  assert.equal((await chooseWord(room)).seconds, 30)
})

test('test-only timing remains separate from normal room duration', async () => {
  const multi = await createRoom(75, true, true)
  assert.equal((await beginDrawing(multi)).seconds, 15)
  const solo = await createRoom(30, false, true)
  assert.equal((await beginDrawing(solo)).seconds, null)
})

test('30 and 90 second rounds use the same proportional scoring', async () => {
  for (const duration of [30, 90]) {
    const room = await createRoom(duration)
    const round = await beginDrawing(room)
    const [{ chosen_word: word }] = (await db.query('select chosen_word from private.round_secrets where round_id = $1', [round.id])).rows
    // Move the test clock to the midpoint without waiting 15/45 real seconds.
    await db.query(`with t as (select clock_timestamp() as now)
      update public.game_rounds set drawing_started_at = t.now - make_interval(secs => $2::integer / 2.0),
        drawing_ends_at = t.now + make_interval(secs => $2::integer / 2.0)
      from t where id = $1`, [round.id, duration])
    const [result] = await asUser(guest, 'select * from public.submit_guess($1, $2)', [round.id, word])
    assert.equal(result.is_correct, true)
    assert.ok(result.awarded_points >= 298 && result.awarded_points <= 300)
    const [drawer] = await asUser(host, 'select score from public.room_players where room_id = $1 and user_id = $2', [room.room_id, host])
    assert.equal(drawer.score, 100)
  }
})

test('server deadlines reject late drawing/guesses and allow expiry only after time runs out', async () => {
  for (const duration of [30, 90]) {
    const room = await createRoom(duration)
    const round = await beginDrawing(room)
    await assert.rejects(asUser(host, 'select * from public.finish_expired_round($1)', [round.id]), /ROUND_TIME_REMAINING/)
    await db.query(`update public.game_rounds set
      drawing_started_at = clock_timestamp() - make_interval(secs => $2::integer + 1),
      drawing_ends_at = clock_timestamp() - interval '1 second' where id = $1`, [round.id, duration])
    await assert.rejects(asUser(host, 'select public.submit_pixel_changes($1, $2::jsonb)',
      [round.id, JSON.stringify([{ x: 0, y: 0, color: '#d3493b' }])]), /ROUND_TIME_EXPIRED/)
    await assert.rejects(asUser(guest, "select * from public.submit_guess($1, 'late')", [round.id]), /ROUND_TIME_EXPIRED/)
    const [finished] = await asUser(host, 'select * from public.finish_expired_round($1)', [round.id])
    assert.equal(finished.round_status, 'finished')
  }
})

test('new exposed RPCs are invoker-only and anonymous execution is forbidden', async () => {
  for (const signature of ['public.create_room_with_duration(text,integer)', 'public.set_room_round_duration(bigint,integer)']) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as member_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: false, anon_execute: false, member_execute: true })
  }
  const [privateAcl] = (await db.query(`select prosecdef,
    has_function_privilege('anon', oid, 'EXECUTE') as anon_execute
    from pg_proc where oid = 'private.set_room_round_duration(bigint,integer)'::regprocedure`)).rows
  assert.deepEqual(privateAcl, { prosecdef: true, anon_execute: false })
})
