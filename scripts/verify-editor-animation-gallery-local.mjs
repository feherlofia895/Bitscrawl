// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const firstUser = '71000000-0000-4000-8000-000000000001'
const secondUser = '71000000-0000-4000-8000-000000000002'
const unprofiledUser = '71000000-0000-4000-8000-000000000003'
const emptyFrame = () => Array.from({ length: 1024 }, () => 'transparent')

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.query("select set_config('request.jwt.claims', '{\"is_anonymous\":false}', false)")
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
  for (const user of [firstUser, secondUser, unprofiledUser]) {
    await db.query('insert into auth.users values ($1)', [user])
  }
  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
  await asUser(firstUser, 'select public.set_weekly_profile($1)', ['AnimationOne'])
  await asUser(secondUser, 'select public.set_weekly_profile($1)', ['AnimationTwo'])
})

after(async () => { await db.close() })

test('two animation slots are private and isolated per profile', async () => {
  const first = emptyFrame()
  const second = emptyFrame()
  first[0] = '#ff0000'
  second[1] = '#00ff0080'
  await asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [1, JSON.stringify([first, second]), 4])
  const own = await asUser(firstUser, 'select slot_index,frames,fps from public.get_own_editor_animations()')
  assert.equal(own.length, 1)
  assert.equal(own[0].slot_index, 1)
  assert.equal(own[0].frames.length, 2)
  assert.equal(own[0].fps, 4)
  assert.deepEqual(await asUser(secondUser, 'select * from public.get_own_editor_animations()'), [])
  await assert.rejects(asUser(firstUser, 'select * from private.editor_animation_slots'), /permission denied/)
  await assert.rejects(asUser(null, 'select * from public.get_own_editor_animations()', [], 'anon'), /permission denied/)
})

test('database enforces two slots, three frames, valid pixels and 1-8 fps', async () => {
  const frame = emptyFrame()
  frame[0] = '#abcdef'
  const fourFrames = JSON.stringify([frame, frame, frame, frame])
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [3, JSON.stringify([frame]), 4]),
    /EDITOR_ANIMATION_SLOT_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [2, fourFrames, 4]),
    /EDITOR_ANIMATION_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [2, JSON.stringify([['invalid']]), 4]),
    /EDITOR_ANIMATION_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [2, JSON.stringify([frame]), 9]),
    /EDITOR_ANIMATION_FPS_INVALID/,
  )
})

test('an unprofiled account cannot save and the owner can update and delete', async () => {
  const frame = emptyFrame()
  frame[5] = '#123456'
  await assert.rejects(
    asUser(unprofiledUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [1, JSON.stringify([frame]), 2]),
    /WEEKLY_PROFILE_REQUIRED/,
  )
  await asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [1, JSON.stringify([frame]), 2])
  assert.deepEqual(await asUser(firstUser, 'select fps from public.get_own_editor_animations()'), [{ fps: 2 }])
  assert.deepEqual(await asUser(firstUser, 'select public.delete_own_editor_animation_slot($1)', [1]), [{ delete_own_editor_animation_slot: true }])
  assert.deepEqual(await asUser(firstUser, 'select * from public.get_own_editor_animations()'), [])
})
