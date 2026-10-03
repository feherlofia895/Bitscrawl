// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const firstUser = '70000000-0000-4000-8000-000000000001'
const secondUser = '70000000-0000-4000-8000-000000000002'
const unprofiledUser = '70000000-0000-4000-8000-000000000003'

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
  await asUser(firstUser, 'select public.set_weekly_profile($1)', ['PaletteOne'])
  await asUser(secondUser, 'select public.set_weekly_profile($1)', ['PaletteTwo'])
})

after(async () => { await db.close() })

test('palettes are private and isolated per profile', async () => {
  await asUser(firstUser, 'select public.save_own_editor_palette($1,$2,$3::jsonb)', [1, 'Naplemente', '["#ff0000","#00ff00"]'])
  assert.deepEqual(await asUser(firstUser, 'select slot_index,name,colors from public.get_own_editor_palettes()'), [
    { slot_index: 1, name: 'Naplemente', colors: ['#ff0000', '#00ff00'] },
  ])
  assert.deepEqual(await asUser(secondUser, 'select * from public.get_own_editor_palettes()'), [])
  await assert.rejects(asUser(firstUser, 'select * from private.editor_custom_palettes'), /permission denied/)
  await assert.rejects(asUser(null, 'select * from public.get_own_editor_palettes()', [], 'anon'), /permission denied/)
})

test('database rejects invalid slots, malformed colors, duplicates and more than 16 colors', async () => {
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_palette($1,$2,$3::jsonb)', [4, 'Hibás', '["#ffffff"]']),
    /EDITOR_PALETTE_SLOT_INVALID/,
  )
  for (const colors of [
    '["red"]',
    '["#aabbcc","#AABBCC"]',
    JSON.stringify(Array.from({ length: 17 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`)),
  ]) {
    await assert.rejects(
      asUser(firstUser, 'select public.save_own_editor_palette($1,$2,$3::jsonb)', [2, 'Hibás', colors]),
      /EDITOR_PALETTE_COLORS_INVALID/,
    )
  }
})

test('an unprofiled account cannot save and an owner can update and delete its slot', async () => {
  await assert.rejects(
    asUser(unprofiledUser, 'select public.save_own_editor_palette($1,$2,$3::jsonb)', [1, 'Nincs profil', '[]']),
    /WEEKLY_PROFILE_REQUIRED/,
  )
  await asUser(firstUser, 'select public.save_own_editor_palette($1,$2,$3::jsonb)', [1, 'Üres', '[]'])
  assert.deepEqual(await asUser(firstUser, 'select name,colors from public.get_own_editor_palettes()'), [{ name: 'Üres', colors: [] }])
  assert.deepEqual(await asUser(firstUser, 'select public.delete_own_editor_palette($1)', [1]), [{ delete_own_editor_palette: true }])
  assert.deepEqual(await asUser(firstUser, 'select * from public.get_own_editor_palettes()'), [])
})
