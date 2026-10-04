// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const host = '00000000-0000-4000-8000-000000000051'
const guest = '00000000-0000-4000-8000-000000000052'
const outsider = '00000000-0000-4000-8000-000000000053'

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
}

async function createRoom(user, playerName, roomName = null, isPublic = false) {
  return (await asUser(user, `select * from public.create_room_with_listing_settings(
    $1, 90, 'classic', 90, 2, 12::smallint, $2, $3
  )`, [playerName, roomName, isPublic]))[0]
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
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
    create schema extensions;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
      $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
    create publication supabase_realtime;
  `)
  for (const user of [host, guest, outsider]) {
    await db.query('insert into auth.users values ($1)', [user])
  }

  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
})

after(async () => { await db.close() })

test('rooms remain private by default and public listing exposes only safe fields', async () => {
  const privateRoom = await createRoom(host, 'PrivátHost')
  const [storedPrivate] = await asUser(host,
    'select is_public, room_name from public.rooms where id = $1', [privateRoom.room_id])
  assert.deepEqual(storedPrivate, { is_public: false, room_name: null })
  assert.deepEqual(await asUser(outsider, 'select * from public.list_public_rooms(null)'), [])

  await asUser(host, 'select * from public.set_room_listing($1, $2, true)', [
    privateRoom.room_id,
    'Esti Pixel Parti',
  ])
  const [listed] = await asUser(outsider, 'select * from public.list_public_rooms(null)')
  assert.deepEqual(Object.keys(listed).sort(), [
    'game_mode', 'host_name', 'listing_id', 'max_players', 'palette_size',
    'player_count', 'public_listed_at', 'room_name',
  ])
  assert.equal(listed.room_name, 'Esti Pixel Parti')
  assert.equal(listed.host_name, 'PrivátHost')
  assert.equal(listed.player_count, 1)
  assert.equal('code' in listed, false)
  assert.equal('room_id' in listed, false)
  assert.deepEqual(await asUser(outsider, 'select id, code from public.rooms'), [])
})

test('search finds room and host names without treating wildcard characters specially', async () => {
  const byRoom = await asUser(guest, 'select room_name from public.list_public_rooms($1)', ['pixel'])
  assert.deepEqual(byRoom, [{ room_name: 'Esti Pixel Parti' }])
  const byHost = await asUser(guest, 'select room_name from public.list_public_rooms($1)', ['priváthost'])
  assert.deepEqual(byHost, [{ room_name: 'Esti Pixel Parti' }])
  assert.deepEqual(await asUser(guest, 'select * from public.list_public_rooms($1)', ['%']), [])
  await assert.rejects(
    asUser(guest, 'select * from public.list_public_rooms($1)', ['x'.repeat(41)]),
    /ROOM_SEARCH_INVALID/,
  )
})

test('a player can join by opaque listing id and receives the invite code only after joining', async () => {
  const [listed] = await asUser(guest, 'select * from public.list_public_rooms(null)')
  const [joined] = await asUser(guest, 'select * from public.join_public_room($1, $2)', [
    listed.listing_id,
    'NyilvánosVendég',
  ])
  assert.equal(joined.room_id > 0, true)
  assert.match(joined.normalized_room_code, /^[A-HJ-NP-Z2-9]{6}$/)
  const [visibleAfterJoin] = await asUser(guest,
    'select code from public.rooms where id = $1', [joined.room_id])
  assert.equal(visibleAfterJoin.code, joined.normalized_room_code)
})

test('server enforces host-only settings, room names and one public waiting room per host', async () => {
  const [listed] = await asUser(host, 'select * from public.list_public_rooms(null)')
  const roomId = (await asUser(host,
    'select id from public.rooms where listing_id = $1', [listed.listing_id]))[0].id
  await assert.rejects(
    asUser(guest, 'select * from public.set_room_listing($1, $2, false)', [roomId, null]),
    /NOT_ROOM_HOST/,
  )
  for (const badName of ['ab', 'rossz.hu', 'túl  sok szóköz', 'tiltott!']) {
    await assert.rejects(
      asUser(host, 'select * from public.set_room_listing($1, $2, true)', [roomId, badName]),
      /ROOM_NAME_INVALID/,
    )
  }

  const secondRoom = await createRoom(host, 'MásodikHost')
  await assert.rejects(
    asUser(host, 'select * from public.set_room_listing($1, $2, true)', [secondRoom.room_id, 'Második Szoba']),
    /PUBLIC_ROOM_LIMIT/,
  )

  await db.query("update public.rooms set status = 'playing' where id = $1", [roomId])
  assert.deepEqual(await asUser(outsider, 'select * from public.list_public_rooms(null)'), [])
  await assert.rejects(
    asUser(guest, 'select * from public.join_public_room($1, $2)', [listed.listing_id, 'KésőVendég']),
    /PUBLIC_ROOM_NOT_FOUND/,
  )
  await assert.rejects(
    asUser(host, 'select * from public.set_room_listing($1, $2, false)', [roomId, null]),
    /ROOM_ALREADY_STARTED/,
  )
  await asUser(host, 'select * from public.set_room_listing($1, $2, true)', [secondRoom.room_id, 'Második Szoba'])
})

test('full public rooms disappear from discovery', async () => {
  const room = await createRoom(outsider, 'TeleHost', 'Tele Szoba', true)
  for (let index = 0; index < 5; index += 1) {
    const user = `00000000-0000-4000-8000-${String(60 + index).padStart(12, '0')}`
    await db.query('insert into auth.users values ($1)', [user])
    await asUser(user, 'select * from public.join_room($1, $2)', [room.room_code, `Vendég${index}`])
  }
  const result = await asUser(guest, 'select room_name from public.list_public_rooms($1)', ['Tele Szoba'])
  assert.deepEqual(result, [])
})

test('public RPCs are invoker-only and unauthenticated roles cannot execute them', async () => {
  for (const signature of [
    'public.create_room_with_listing_settings(text,integer,text,integer,integer,smallint,text,boolean)',
    'public.set_room_listing(bigint,text,boolean)',
    'public.list_public_rooms(text)',
    'public.join_public_room(uuid,text)',
  ]) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', oid, 'EXECUTE') as member_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: false, anon_execute: false, member_execute: true })
  }
  for (const signature of [
    'private.set_room_listing(bigint,text,boolean)',
    'private.list_public_rooms(text)',
    'private.join_public_room(uuid,text)',
  ]) {
    const [acl] = (await db.query(`select prosecdef,
      has_function_privilege('anon', oid, 'EXECUTE') as anon_execute
      from pg_proc where oid = $1::regprocedure`, [signature])).rows
    assert.deepEqual(acl, { prosecdef: true, anon_execute: false })
  }
  await assert.rejects(
    asUser(null, 'select * from public.list_public_rooms(null)', [], 'anon'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(host, "update public.rooms set is_public = true, room_name = 'Közvetlen'"),
    /permission denied/,
  )
})
