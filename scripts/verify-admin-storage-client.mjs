import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function library(rpc) {
  const source = await readFile(new URL('../src/lib/adminStorage.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  new Function('require', 'exports', output)(name => {
    assert.equal(name, './supabase')
    return { supabase: { rpc } }
  }, exports)
  return exports
}

test('admin storage maps byte counts and warns exactly from 70 percent', async () => {
  for (const [databaseBytes, warning] of [[349_999_999, false], [350 * 1024 * 1024, true]]) {
    const api = await library(async name => {
      assert.equal(name, 'get_admin_storage_status')
      return { data: [{
        capacity_bytes: 500 * 1024 * 1024,
        database_bytes: databaseBytes,
        editor_project_bytes: '8192',
        editor_project_count: '3',
        warning_percent: 70,
      }], error: null }
    })
    const status = await api.loadAdminStorageStatus()
    assert.equal(status.warning, warning)
    assert.equal(status.warningPercent, 70)
    assert.equal(status.editorProjectBytes, 8192)
    assert.equal(status.editorProjectCount, 3)
  }
})

test('storage warning is visible from the top bar and explained in the admin center', async () => {
  const [button, center] = await Promise.all([
    readFile(new URL('../src/components/AdminFeedbackButton.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/AdminFeedbackCenter.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(button, /loadAdminStorageStatus/)
  assert.match(button, /Supabase tárhely elérte a 70 százalékot/)
  assert.match(center, /figyelmeztetés \{storageStatus\.warningPercent\}%-nál/)
  assert.match(center, /A tárhely elérte a 70%-os figyelmeztetési küszöböt/)
})

test('admin authorization failures are translated', async () => {
  const api = await library(async () => ({ data: null, error: { message: 'ADMIN_REQUIRED' } }))
  await assert.rejects(api.loadAdminStorageStatus(), /jogosultság/)
})
