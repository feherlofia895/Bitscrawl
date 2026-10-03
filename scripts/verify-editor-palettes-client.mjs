// In-memory client checks only: no account or network writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { isHexColor } from '../src/lib/colorMixer.ts'

async function createModule({ signedIn = false, rows = [] } = {}) {
  const storage = new Map()
  const calls = []
  const source = await readFile(new URL('../src/lib/editorPalettes.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  const supabase = {
    rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'get_own_editor_palettes') return { data: rows, error: null }
      return { data: null, error: null }
    },
  }
  new Function('require', 'exports', 'localStorage', output)(
    name => {
      if (name === './colorMixer') return { isHexColor }
      if (name === './supabase') return { supabase }
      if (name === './weekly') return { getWeeklyUser: async () => signedIn ? { id: 'synthetic-user' } : null }
      throw new Error(`Unmocked dependency: ${name}`)
    },
    exports,
    {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  )
  return { calls, exports, storage }
}

test('custom palettes keep three slots, unique valid colors and a 16-color maximum', async () => {
  const { exports } = await createModule()
  const colors = Array.from({ length: 20 }, (_, index) => `#${index.toString(16).padStart(6, '0')}`)
  const cleaned = exports.sanitizeEditorPaletteColors([...colors, '#000000', 'invalid'])
  assert.equal(cleaned.length, 16)
  assert.equal(new Set(cleaned).size, 16)
  assert.deepEqual(exports.emptyEditorPalettes().map(item => item.slotIndex), [1, 2, 3])
})

test('the legacy mixed-color list migrates into the first local palette', async () => {
  const app = await createModule()
  app.storage.set('bitscrawl-editor-custom-palette-v1', JSON.stringify(['#AABBCC', '#aabbcc', '#112233']))
  const palettes = app.exports.loadLocalEditorPalettes()
  assert.deepEqual(palettes[0].colors, ['#aabbcc', '#112233'])
  assert.deepEqual(palettes.slice(1).map(item => item.colors), [[], []])
  assert.ok(app.storage.has('bitscrawl-editor-palettes-v1'))
})

test('signed-in profiles load cloud palettes and upload local-only slots', async () => {
  const app = await createModule({
    signedIn: true,
    rows: [{ colors: ['#123456'], name: 'Felhő', slot_index: 1, updated_at: '2026-10-03T00:00:00Z' }],
  })
  app.storage.set('bitscrawl-editor-palettes-v1', JSON.stringify([
    { colors: ['#ffffff'], name: 'Régi', slotIndex: 1, updatedAt: null },
    { colors: ['#abcdef'], name: 'Második', slotIndex: 2, updatedAt: null },
  ]))
  const result = await app.exports.loadOwnEditorPalettes()
  assert.equal(result.storage, 'cloud')
  assert.deepEqual(result.palettes[0].colors, ['#123456'])
  assert.deepEqual(result.palettes[1].colors, ['#abcdef'])
  assert.ok(app.calls.some(([name, args]) => name === 'save_own_editor_palette' && args.target_slot === 2))
})

test('signed-out saves stay local and never call a profile RPC', async () => {
  const app = await createModule()
  const storage = await app.exports.saveOwnEditorPalette({
    colors: ['#123456'], name: 'Teszt', slotIndex: 3, updatedAt: null,
  })
  assert.equal(storage, 'local')
  assert.equal(app.calls.length, 0)
  assert.equal(JSON.parse(app.storage.get('bitscrawl-editor-palettes-v1'))[2].name, 'Teszt')
})
