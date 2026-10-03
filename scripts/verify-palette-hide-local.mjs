// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const host = '00000000-0000-4000-8000-000000000011'
const outsider = '00000000-0000-4000-8000-000000000012'
let legacyRoom

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`)
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
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
    create schema extensions;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
      $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
    create publication supabase_realtime;
  `)
  for (const user of [host, outsider]) await db.query('insert into auth.users values ($1)', [user])

  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    if (file.endsWith('_hide_legacy_expanded_palette.sql')) {
      ;[legacyRoom] = await asUser(host, "select * from public.create_room('Legacy16')")
      await asUser(host, 'select * from public.set_room_palette_size($1::bigint, 16::smallint)', [legacyRoom.room_id])
    }
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
})

after(async () => { await db.close() })

test('new rooms stay on the 12-color palette and cannot enable 16 colors', async () => {
  const [room] = await asUser(host, "select * from public.create_room('New12')")
  const [created] = await asUser(host, 'select palette_size from public.rooms where id = $1', [room.room_id])
  assert.equal(created.palette_size, 12)
  await assert.rejects(
    asUser(host, 'select * from public.set_room_palette_size($1::bigint, 16::smallint)', [room.room_id]),
    /PALETTE_SIZE_UNAVAILABLE/,
  )
  const [unchanged] = await asUser(host, 'select palette_size from public.rooms where id = $1', [room.room_id])
  assert.equal(unchanged.palette_size, 12)
})

test('host authorization remains enforced for the remaining compatibility RPC', async () => {
  const [room] = await asUser(host, "select * from public.create_room('Protected')")
  await assert.rejects(
    asUser(outsider, 'select * from public.set_room_palette_size($1::bigint, 12::smallint)', [room.room_id]),
    /NOT_ROOM_HOST/,
  )
  await assert.rejects(
    asUser(null, 'select * from public.set_room_palette_size($1::bigint, 12::smallint)', [room.room_id], 'anon'),
    /permission denied/,
  )
})

test('a legacy 16-color room remains readable and playable', async () => {
  const [stored] = await asUser(host, 'select palette_size from public.rooms where id = $1', [legacyRoom.room_id])
  assert.equal(stored.palette_size, 16)
  await asUser(host, 'select * from public.set_room_test_mode($1, true)', [legacyRoom.room_id])
  await asUser(host, 'select * from public.start_game($1)', [legacyRoom.room_id])
  const [view] = await asUser(host, 'select * from public.get_round_view($1)', [legacyRoom.room_id])
  await asUser(host, 'select * from public.choose_round_word($1, $2)', [view.round_id, view.word_options[0]])
  const [{ submit_pixel_changes: eventId }] = await asUser(
    host,
    `select public.submit_pixel_changes($1, $2::jsonb)`,
    [view.round_id, JSON.stringify([{ x: 0, y: 0, color: '#e8d7b8' }])],
  )
  assert(Number(eventId) > 0)
})

test('the exposed palette RPC is invoker-only while the privileged helper stays private', async () => {
  const [{ prosecdef: exposedDefiner }] = (await db.query(
    `select prosecdef from pg_proc where oid = 'public.set_room_palette_size(bigint,smallint)'::regprocedure`,
  )).rows
  const [{ prosecdef: privateDefiner }] = (await db.query(
    `select prosecdef from pg_proc where oid = 'private.set_room_palette_size(bigint,smallint)'::regprocedure`,
  )).rows
  assert.equal(exposedDefiner, false)
  assert.equal(privateDefiner, true)
})
