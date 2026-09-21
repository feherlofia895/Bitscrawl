// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  competitionDrawDurations,
  competitionRoundCounts,
  isCompetitionDrawDuration,
  isCompetitionRoundCount,
  isGameMode,
} from '../src/lib/gameMode.ts'
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

async function asRegisteredUser(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ is_anonymous: false })])
  try { return await asUser(user, sql, params) }
  finally { await db.query("select set_config('request.jwt.claims', '{}', false)") }
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
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
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

test('competition settings accept 1–2 minute drawing times and 1–5 rounds', () => {
  assert.deepEqual([...competitionDrawDurations], [60, 90, 120])
  assert.deepEqual([...competitionRoundCounts], [1, 2, 3, 4, 5])
  assert.equal(isGameMode('classic'), true)
  assert.equal(isGameMode('competition'), true)
  for (const value of competitionDrawDurations) assert.equal(isCompetitionDrawDuration(value), true)
  for (const value of competitionRoundCounts) assert.equal(isCompetitionRoundCount(value), true)
  for (const value of [null, 0, 30, 61, 180, '90']) assert.equal(isCompetitionDrawDuration(value), false)
  for (const value of [null, 0, 6, 2.5, '2']) assert.equal(isCompetitionRoundCount(value), false)
  assert.equal(isGameMode('race'), false)
})

test('existing rooms remain classic and competition room creation stores its settings atomically', async () => {
  const [existing] = await asUser(host, `select game_mode, competition_draw_seconds,
    competition_round_count from public.rooms where id = $1`, [legacyRoom.room_id])
  assert.deepEqual(existing, {
    competition_draw_seconds: 90,
    competition_round_count: 2,
    game_mode: 'classic',
  })

  const [room] = await asUser(host,
    'select * from public.create_room_with_settings($1, $2, $3, $4, $5)',
    ['VersenyHost', 90, 'competition', 120, 5],
  )
  const [stored] = await asUser(host, `select game_mode, competition_draw_seconds,
    competition_round_count, round_duration_seconds from public.rooms where id = $1`, [room.room_id])
  assert.deepEqual(stored, {
    competition_draw_seconds: 120,
    competition_round_count: 5,
    game_mode: 'competition',
    round_duration_seconds: 90,
  })
})

test('only the member host may change competition settings while the room is waiting', async () => {
  const room = await createRoom(90)
  await assert.rejects(asUser(guest,
    "select * from public.set_room_game_settings($1, 'competition', 60, 1)", [room.room_id]), /NOT_ROOM_HOST/)
  await assert.rejects(asUser(outsider,
    "select * from public.set_room_game_settings($1, 'competition', 60, 1)", [room.room_id]), /NOT_ROOM_HOST/)
  await assert.rejects(asUser(null,
    "select * from public.set_room_game_settings($1, 'competition', 60, 1)", [room.room_id]), /AUTH_REQUIRED/)
  await assert.rejects(asUser(null,
    "select * from public.set_room_game_settings($1, 'competition', 60, 1)", [room.room_id], 'anon'), /permission denied/)

  await asUser(host, "select * from public.set_room_game_settings($1, 'competition', 60, 1)", [room.room_id])
  const [visible] = await asUser(guest, `select game_mode, competition_draw_seconds,
    competition_round_count from public.rooms where id = $1`, [room.room_id])
  assert.deepEqual(visible, {
    competition_draw_seconds: 60,
    competition_round_count: 1,
    game_mode: 'competition',
  })

  await db.query("update public.rooms set status = 'playing' where id = $1", [room.room_id])
  await assert.rejects(asUser(host,
    "select * from public.set_room_game_settings($1, 'classic', 90, 2)", [room.room_id]), /GAME_ALREADY_STARTED/)
})

test('invalid competition settings cannot leave partial rooms or bypass table constraints', async () => {
  const countBefore = (await db.query('select count(*)::integer as count from public.rooms')).rows[0].count
  for (const args of [
    ['unknown', 90, 2],
    ['competition', 30, 2],
    ['competition', 90, 0],
    ['competition', 90, 6],
  ]) {
    await assert.rejects(asUser(host,
      'select * from public.create_room_with_settings($1, 90, $2, $3, $4)',
      ['Hibás', ...args]), /(GAME_MODE|COMPETITION_).*_INVALID/)
  }
  assert.equal((await db.query('select count(*)::integer as count from public.rooms')).rows[0].count, countBefore)

  const room = await createRoom(90)
  await assert.rejects(db.query("update public.rooms set game_mode = 'unknown' where id = $1", [room.room_id]), /rooms_game_mode_values/)
  await assert.rejects(db.query('update public.rooms set competition_draw_seconds = 75 where id = $1', [room.room_id]), /rooms_competition_draw_seconds_values/)
  await assert.rejects(db.query('update public.rooms set competition_round_count = 6 where id = $1', [room.room_id]), /rooms_competition_round_count_values/)
})

test('parallel competition runs drawing, anonymous mutable voting and configured rounds', async () => {
  const [room] = await asUser(host,
    "select * from public.create_room_with_settings('VersenyHost', 90, 'competition', 60, 2)")
  await asUser(guest, 'select * from public.join_room($1, $2)', [room.room_code, 'VersenyGuest'])
  await asUser(outsider, 'select * from public.join_room($1, $2)', [room.room_code, 'VersenyThird'])
  await asUser(host, 'select * from public.start_competition_game($1)', [room.room_id])

  const [hostView] = await asUser(host, 'select * from public.get_competition_round_view($1)', [room.room_id])
  const [guestView] = await asUser(guest, 'select * from public.get_competition_round_view($1)', [room.room_id])
  assert.equal(hostView.round_status, 'drawing')
  assert.equal(hostView.round_number, 1)
  assert.equal(hostView.total_rounds, 2)
  assert.equal(hostView.chosen_word, guestView.chosen_word)
  assert.equal(
    Math.round((new Date(hostView.drawing_ends_at) - new Date(hostView.server_now)) / 1000),
    60,
  )

  const redPixel = JSON.stringify([{ x: 0, y: 0, color: '#d3493b' }])
  const bluePixel = JSON.stringify([{ x: 1, y: 0, color: '#33567e' }])
  const clearPixel = JSON.stringify([{ x: 2, y: 0, color: 'transparent' }])
  await asUser(host, 'select public.submit_competition_pixel_changes($1, $2::jsonb)', [hostView.round_id, redPixel])
  await asUser(guest, 'select public.submit_competition_pixel_changes($1, $2::jsonb)', [hostView.round_id, bluePixel])
  await asUser(outsider, 'select public.submit_competition_pixel_changes($1, $2::jsonb)', [hostView.round_id, clearPixel])
  const entries = (await db.query(
    'select drawing_id, user_id from private.competition_entries where round_id = $1', [hostView.round_id],
  )).rows
  const drawingIdFor = userId => entries.find(entry => entry.user_id === userId).drawing_id
  const drawingGuestEvents = await asUser(guest,
    'select * from public.get_competition_draw_updates($1, null, 500)', [hostView.round_id])
  assert.deepEqual([...new Set(drawingGuestEvents.map(event => event.drawing_id))], [drawingIdFor(guest)])
  assert.ok(drawingGuestEvents.every(event => !('user_id' in event)))
  await assert.rejects(asUser(host,
    'select * from public.set_competition_vote($1, $2)', [hostView.round_id, drawingIdFor(guest)]), /VOTING_NOT_OPEN/)

  await db.query("update public.competition_rounds set drawing_started_at = clock_timestamp() - interval '61 seconds', drawing_ends_at = clock_timestamp() - interval '1 second' where id = $1", [hostView.round_id])
  await asUser(guest, 'select * from public.finish_competition_drawing($1)', [hostView.round_id])
  const votingEvents = await asUser(guest,
    'select * from public.get_competition_draw_updates($1, null, 500)', [hostView.round_id])
  assert.deepEqual(new Set(votingEvents.map(event => event.drawing_id)), new Set(entries.map(entry => entry.drawing_id)))
  assert.ok(votingEvents.every(event => !('user_id' in event)))
  const anonymousResults = await asUser(host, 'select * from public.get_competition_results($1)', [hostView.round_id])
  assert.ok(anonymousResults.every(result => result.display_name === null && result.vote_count === null))
  assert.ok(anonymousResults.every(result => !('drawing_user_id' in result)))
  await assert.rejects(asUser(host,
    'select * from public.set_competition_vote($1, $2)', [hostView.round_id, drawingIdFor(host)]), /SELF_VOTE_FORBIDDEN/)

  await asUser(host, 'select * from public.set_competition_vote($1, $2)', [hostView.round_id, drawingIdFor(guest)])
  await asUser(host, 'select * from public.set_competition_vote($1, $2)', [hostView.round_id, drawingIdFor(outsider)])
  await asUser(guest, 'select * from public.set_competition_vote($1, $2)', [hostView.round_id, drawingIdFor(outsider)])
  await asUser(outsider, 'select * from public.set_competition_vote($1, $2)', [hostView.round_id, drawingIdFor(guest)])
  assert.equal((await db.query('select count(*)::integer as count from private.competition_votes where round_id = $1', [hostView.round_id])).rows[0].count, 3)

  await db.query("update public.competition_rounds set voting_ends_at = clock_timestamp() - interval '1 second' where id = $1", [hostView.round_id])
  await asUser(outsider, 'select * from public.finish_competition_voting($1)', [hostView.round_id])
  const namedResults = await asUser(host, 'select * from public.get_competition_results($1)', [hostView.round_id])
  assert.deepEqual(namedResults.map(result => [result.display_name, result.vote_count]), [
    ['VersenyThird', 2],
    ['VersenyGuest', 1],
    ['VersenyHost', 0],
  ])

  await db.query("update public.competition_rounds set finished_at = clock_timestamp() - interval '6 seconds' where id = $1", [hostView.round_id])
  const [advanced] = await asUser(guest, 'select * from public.advance_competition_game($1)', [hostView.round_id])
  assert.equal(advanced.next_round_number, 2)
  assert.equal(advanced.room_status, 'playing')

  const [secondView] = await asUser(host, 'select * from public.get_competition_round_view($1)', [room.room_id])
  await db.query("update public.competition_rounds set drawing_started_at = clock_timestamp() - interval '61 seconds', drawing_ends_at = clock_timestamp() - interval '1 second' where id = $1", [secondView.round_id])
  await asUser(host, 'select * from public.finish_competition_drawing($1)', [secondView.round_id])
  await db.query("update public.competition_rounds set voting_ends_at = clock_timestamp() - interval '1 second' where id = $1", [secondView.round_id])
  await asUser(host, 'select * from public.finish_competition_voting($1)', [secondView.round_id])
  await db.query("update public.competition_rounds set finished_at = clock_timestamp() - interval '6 seconds' where id = $1", [secondView.round_id])
  const [completed] = await asUser(host, 'select * from public.advance_competition_game($1)', [secondView.round_id])
  assert.equal(completed.room_status, 'finished')
  assert.equal((await db.query('select status from public.rooms where id = $1', [room.room_id])).rows[0].status, 'finished')

  await asUser(host, 'select * from public.restart_competition_game($1)', [room.room_id])
  const restartedRounds = (await db.query(
    'select round_number, status from public.competition_rounds where room_id = $1', [room.room_id],
  )).rows
  assert.deepEqual(restartedRounds, [{ round_number: 1, status: 'drawing' }])
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
  for (const signature of [
    'public.create_room_with_duration(text,integer)',
    'public.set_room_round_duration(bigint,integer)',
    'public.create_room_with_settings(text,integer,text,integer,integer)',
    'public.set_room_game_settings(bigint,text,integer,integer)',
    'public.start_competition_game(bigint)',
    'public.get_competition_round_view(bigint)',
    'public.submit_competition_pixel_changes(bigint,jsonb)',
    'public.get_competition_draw_updates(bigint,bigint,integer)',
    'public.finish_competition_drawing(bigint)',
    'public.set_competition_vote(bigint,text)',
    'public.get_competition_results(bigint)',
    'public.finish_competition_voting(bigint)',
    'public.advance_competition_game(bigint)',
    'public.restart_competition_game(bigint)',
  ]) {
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
  const [privateGameAcl] = (await db.query(`select prosecdef,
    has_function_privilege('anon', oid, 'EXECUTE') as anon_execute
    from pg_proc where oid = 'private.set_room_game_settings(bigint,text,integer,integer)'::regprocedure`)).rows
  assert.deepEqual(privateGameAcl, { prosecdef: true, anon_execute: false })
  for (const signature of [
    'private.start_competition_game(bigint)',
    'private.get_competition_round_view(bigint)',
    'private.submit_competition_pixel_changes(bigint,jsonb)',
    'private.get_competition_draw_updates(bigint,bigint,integer)',
    'private.finish_competition_drawing(bigint)',
    'private.set_competition_vote(bigint,text)',
    'private.get_competition_results(bigint)',
    'private.finish_competition_voting(bigint)',
    'private.advance_competition_game(bigint)',
    'private.restart_competition_game(bigint)',
  ]) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: true, anon_execute: false })
  }
  for (const table of ['competition_rounds', 'competition_draw_events']) {
    const [security] = (await db.query(`select relrowsecurity,
      has_table_privilege('anon', oid, 'SELECT') as anon_select,
      has_table_privilege('authenticated', oid, 'SELECT') as member_select,
      has_table_privilege('authenticated', oid, 'INSERT,UPDATE,DELETE') as member_write
      from pg_class where oid = $1::regclass`, [`public.${table}`])).rows
    assert.deepEqual(security, {
      relrowsecurity: true,
      anon_select: false,
      member_select: table === 'competition_rounds',
      member_write: false,
    })
  }
  await assert.rejects(
    asUser(host, 'select * from public.competition_draw_events limit 1'),
    /permission denied/,
  )
})

test('room chat, correct guesses and drawing history use bounded cursor updates', async () => {
  const room = await createRoom(90)
  const round = await beginDrawing(room)

  for (let index = 1; index <= 65; index += 1) {
    await db.query(
      'insert into public.room_messages (room_id, sender_user_id, content) values ($1, $2, $3)',
      [room.room_id, host, `Üzenet ${index}`],
    )
  }
  const initialRoomMessages = await asUser(
    host,
    'select * from public.get_room_message_updates($1, null, 50)',
    [room.room_id],
  )
  assert.equal(initialRoomMessages.length, 50)
  assert.equal(initialRoomMessages[0].content, 'Üzenet 16')
  assert.equal(initialRoomMessages[49].content, 'Üzenet 65')
  const roomMessageUpdates = await asUser(
    guest,
    'select * from public.get_room_message_updates($1, $2, 50)',
    [room.room_id, initialRoomMessages[47].id],
  )
  assert.deepEqual(roomMessageUpdates.map(message => message.content), ['Üzenet 64', 'Üzenet 65'])

  const extraUsers = []
  for (let index = 10; index < 22; index += 1) {
    const userId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    extraUsers.push(userId)
    await db.query('insert into auth.users values ($1)', [userId])
    await db.query(
      'insert into public.room_players (room_id, user_id, display_name) values ($1, $2, $3)',
      [room.room_id, userId, `Teszt ${index}`],
    )
    await db.query(
      "insert into public.round_messages (round_id, room_id, sender_user_id, kind, content) values ($1, $2, $3, 'correct', null)",
      [round.id, room.room_id, userId],
    )
  }
  const initialRoundMessages = await asUser(
    host,
    'select * from public.get_round_message_updates($1, null, 10)',
    [round.id],
  )
  assert.equal(initialRoundMessages.length, 10)
  assert.deepEqual(
    initialRoundMessages.map(message => message.sender_user_id),
    extraUsers.slice(-10),
  )

  for (let index = 0; index < 105; index += 1) {
    await db.query(
      'insert into public.round_draw_events (round_id, room_id, created_by, changes) values ($1, $2, $3, $4::jsonb)',
      [round.id, room.room_id, host, JSON.stringify([{
        x: index % 32,
        y: Math.floor(index / 32),
        color: index % 2 ? '#d3493b' : '#67ba62',
      }])],
    )
  }
  const [initialDrawing] = await asUser(
    guest,
    'select * from public.get_round_draw_updates($1, null, 100)',
    [round.id],
  )
  assert.equal(initialDrawing.changes.length, 105)
  const initialDrawingCursor = initialDrawing.id

  for (let index = 0; index < 2; index += 1) {
    await db.query(
      'insert into public.round_draw_events (round_id, room_id, created_by, changes) values ($1, $2, $3, $4::jsonb)',
      [round.id, room.room_id, host, JSON.stringify([{ x: index, y: 8, color: '#f4d35e' }])],
    )
  }
  const incrementalDrawing = await asUser(
    guest,
    'select * from public.get_round_draw_updates($1, $2, 100)',
    [round.id, initialDrawingCursor],
  )
  assert.equal(incrementalDrawing.length, 2)
  assert(incrementalDrawing[0].id < incrementalDrawing[1].id)

  const beforeBacklog = incrementalDrawing[1].id
  for (let index = 0; index < 101; index += 1) {
    await db.query(
      'insert into public.round_draw_events (round_id, room_id, created_by, changes) values ($1, $2, $3, $4::jsonb)',
      [round.id, room.room_id, host, JSON.stringify([{ x: 31, y: 31, color: index % 2 ? '#29293d' : '#f4d35e' }])],
    )
  }
  const backlogDrawing = await asUser(
    host,
    'select * from public.get_round_draw_updates($1, $2, 100)',
    [round.id, beforeBacklog],
  )
  assert.equal(backlogDrawing.length, 1)
  assert(backlogDrawing[0].id > beforeBacklog)
  assert.equal(
    backlogDrawing[0].changes.find(change => change.x === 31 && change.y === 31).color,
    '#f4d35e',
  )

  await assert.rejects(
    asUser(outsider, 'select * from public.get_room_message_updates($1, null, 50)', [room.room_id]),
    /ROOM_NOT_FOUND/,
  )
  for (const signature of [
    'public.get_room_message_updates(bigint,bigint,integer)',
    'public.get_round_message_updates(bigint,bigint,integer)',
    'public.get_round_draw_updates(bigint,bigint,integer)',
  ]) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as member_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: false, anon_execute: false, member_execute: true })
  }
})

test('global lobby unread state ignores own messages and clears when the chat is opened', async () => {
  await db.query(`insert into public.profiles (user_id, display_name)
    values ($1, 'UnreadHost'), ($2, 'UnreadGuest')
    on conflict (user_id) do update set display_name = excluded.display_name`, [host, guest])
  await db.query('delete from public.lobby_messages')
  await db.query('delete from private.global_lobby_reads')
  await db.query(`insert into public.lobby_messages (user_id, content)
    values ($1, 'Saját üzenet'), ($2, 'Másik üzenete')`, [host, guest])

  const [initial] = await asRegisteredUser(host, 'select public.get_global_lobby_unread_count() as count')
  assert.equal(initial.count, 1)
  await asRegisteredUser(host, 'select public.mark_global_lobby_read()')
  const [cleared] = await asRegisteredUser(host, 'select public.get_global_lobby_unread_count() as count')
  assert.equal(cleared.count, 0)

  await db.query("insert into public.lobby_messages (user_id, content) values ($1, 'Új üzenet')", [guest])
  const [afterNewMessage] = await asRegisteredUser(host, 'select public.get_global_lobby_unread_count() as count')
  assert.equal(afterNewMessage.count, 1)

  for (const signature of [
    'public.get_global_lobby_unread_count()',
    'public.mark_global_lobby_read()',
  ]) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as member_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: false, anon_execute: false, member_execute: true })
  }
})

test('profile avatar likes reject self-likes and reset only after a major redraw', async () => {
  await db.query(`insert into public.profiles (user_id, display_name)
    values ($1, 'LikeHost'), ($2, 'LikeGuest')
    on conflict (user_id) do update set display_name = excluded.display_name`, [host, guest])
  await db.query('delete from private.profile_avatar_likes')
  const redAvatar = Array(1024).fill('#d3493b')
  const minorEdit = redAvatar.map((color, index) => index < 511 ? 'transparent' : color)
  const majorEdit = Array(1024).fill('transparent')

  await asRegisteredUser(guest, 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(redAvatar)])
  const [liked] = await asRegisteredUser(host,
    'select * from public.set_profile_avatar_like($1, true)', ['LikeGuest'])
  assert.deepEqual(liked, { like_count: 1, liked: true })

  await assert.rejects(
    asRegisteredUser(guest, 'select * from public.set_profile_avatar_like($1, true)', ['LikeGuest']),
    /PROFILE_AVATAR_SELF_LIKE/,
  )
  await asRegisteredUser(guest, 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(minorEdit)])
  const [afterMinorEdit] = await asRegisteredUser(host,
    'select * from public.get_profile_avatar_like_state($1)', ['LikeGuest'])
  assert.deepEqual(afterMinorEdit, { can_like: true, like_count: 1, liked: true })

  await asRegisteredUser(guest, 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(majorEdit)])
  const [afterMajorEdit] = await asRegisteredUser(host,
    'select * from public.get_profile_avatar_like_state($1)', ['LikeGuest'])
  assert.deepEqual(afterMajorEdit, { can_like: true, like_count: 0, liked: false })
  const [ownState] = await asRegisteredUser(guest,
    'select * from public.get_profile_avatar_like_state($1)', ['LikeGuest'])
  assert.equal(ownState.can_like, false)

  for (const signature of [
    'public.get_profile_avatar_like_state(text)',
    'public.set_profile_avatar_like(text,boolean)',
  ]) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as member_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: false, anon_execute: false, member_execute: true })
  }
})
