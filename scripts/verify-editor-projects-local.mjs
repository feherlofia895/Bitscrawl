// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  addEditorProjectFrame,
  createEmptyEditorProject,
  replaceEditorProjectLayer,
} from '../src/lib/editorProject.ts'
import { emptyDrawing } from '../src/lib/drawing.ts'

const db = new PGlite()
const firstUser = '72000000-0000-4000-8000-000000000001'
const secondUser = '72000000-0000-4000-8000-000000000002'
const unprofiledUser = '72000000-0000-4000-8000-000000000003'
const migrationName = '20261005131753_unified_editor_projects.sql'

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.query("select set_config('request.jwt.claims', '{\"is_anonymous\":false}', false)")
  await db.exec(`set role ${role}`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
}

function colored(color = '#123456') {
  const pixels = emptyDrawing()
  pixels[37] = color
  return pixels
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
  for (const file of files.filter(file => file !== migrationName)) {
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
  await asUser(firstUser, 'select public.set_weekly_profile($1)', ['ProjectOne'])
  await asUser(secondUser, 'select public.set_weekly_profile($1)', ['ProjectTwo'])
  await asUser(firstUser, 'select public.save_own_editor_gallery_slot($1,$2::jsonb,$3)', [1, JSON.stringify(colored()), 32])
  await asUser(firstUser, 'select public.save_own_editor_animation_slot($1,$2::jsonb,$3)', [1, JSON.stringify([colored('#abcdef')]), 6])
  await db.exec(await readFile(new URL(migrationName, migrationDir), 'utf8'))
  await db.query('insert into private.app_admins (user_id) values ($1) on conflict (user_id) do nothing', [firstUser])
})

after(async () => { await db.close() })

test('legacy image and animation slots migrate into the four unified project positions', async () => {
  const migrated = await asUser(firstUser, 'select slot_index, document from public.get_own_editor_projects()')
  assert.deepEqual(migrated.map(row => row.slot_index), [1, 3])
  assert.equal(migrated[0].document.version, 3)
  assert.equal(migrated[0].document.frames[0].layers.length, 3)
  assert.equal(migrated[0].document.frames[0].layers[0][37], '#123456')
  assert.equal(migrated[1].document.fps, 6)
  assert.equal(migrated[1].document.frames[0].layers[0][37], '#abcdef')
})

test('four project slots are private and isolated per permanent profile', async () => {
  let project = createEmptyEditorProject(32)
  project = replaceEditorProjectLayer(project, 0, 0, colored('#112233'))
  project = addEditorProjectFrame(project, true)
  for (const slot of [1, 2, 3, 4]) {
    await asUser(firstUser, 'select public.save_own_editor_project($1,$2::jsonb)', [slot, JSON.stringify(project)])
  }
  assert.equal((await asUser(firstUser, 'select * from public.get_own_editor_projects()')).length, 4)
  assert.deepEqual(await asUser(secondUser, 'select * from public.get_own_editor_projects()'), [])
  await assert.rejects(asUser(firstUser, 'select * from private.editor_projects'), /permission denied/)
  await assert.rejects(asUser(null, 'select * from public.get_own_editor_projects()', [], 'anon'), /permission denied/)
})

test('database rejects invalid slots, empty, malformed, oversized and six-frame projects', async () => {
  let project = createEmptyEditorProject(32)
  project = replaceEditorProjectLayer(project, 0, 0, colored())
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_project($1,$2::jsonb)', [5, JSON.stringify(project)]),
    /EDITOR_PROJECT_SLOT_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_project($1,$2::jsonb)', [1, JSON.stringify(createEmptyEditorProject())]),
    /EDITOR_PROJECT_DOCUMENT_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_project($1,$2::jsonb)', [1, JSON.stringify({ ...project, frames: [...project.frames, ...Array(5).fill(project.frames[0])] })]),
    /EDITOR_PROJECT_DOCUMENT_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_project($1,$2::jsonb)', [1, JSON.stringify({ ...project, padding: 'x'.repeat(270_000) })]),
    /EDITOR_PROJECT_DOCUMENT_INVALID/,
  )
  await assert.rejects(
    asUser(firstUser, 'select public.save_own_editor_project($1,$2::jsonb)', [1, JSON.stringify({ ...project, layerVisibility: [true] })]),
    /EDITOR_PROJECT_DOCUMENT_INVALID/,
  )
})

test('an unprofiled account cannot save and the owner can delete', async () => {
  let project = createEmptyEditorProject()
  project = replaceEditorProjectLayer(project, 0, 0, colored())
  await assert.rejects(
    asUser(unprofiledUser, 'select public.save_own_editor_project($1,$2::jsonb)', [1, JSON.stringify(project)]),
    /WEEKLY_PROFILE_REQUIRED/,
  )
  assert.deepEqual(await asUser(firstUser, 'select public.delete_own_editor_project($1)', [4]), [{ delete_own_editor_project: true }])
})

test('storage status is admin-only and carries the exact 70 percent threshold', async () => {
  await assert.rejects(asUser(secondUser, 'select * from public.get_admin_storage_status()'), /ADMIN_REQUIRED/)
  await assert.rejects(asUser(null, 'select * from public.get_admin_storage_status()', [], 'anon'), /permission denied/)
  const [status] = await asUser(firstUser, 'select * from public.get_admin_storage_status()')
  assert.equal(status.capacity_bytes, 500 * 1024 * 1024)
  assert.equal(status.warning_percent, 70)
  assert.ok(Number(status.database_bytes) > 0)
  assert.ok(Number(status.editor_project_bytes) > 0)
  assert.ok(Number(status.editor_project_count) >= 1)
})
