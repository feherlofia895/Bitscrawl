// Component logic checks with synthetic data only: no browser, account or network writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import * as drawing from '../src/lib/drawing.ts'
import * as palette from '../src/lib/palette.ts'
import { editorText } from '../src/lib/editorText.ts'

const settle = () => new Promise(resolve => setImmediate(resolve))
function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type))
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (!tree || typeof tree === 'boolean') return ''
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree)
}
async function editor({ initial = drawing.emptyDrawing(), slots = [], loadError = null } = {}) {
  const state = []
  const saved = []
  const storage = new Map([['bitscrawl-editor-v1', JSON.stringify({ pixels: initial, paletteSize: 12, exported: true })]])
  let cursor = 0
  const react = {
    useState(value) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof value === 'function' ? value() : value
      return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
    },
    useRef(value) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: value }
      return state[index]
    },
    useCallback: callback => callback,
    useEffect() {}, // Focus, navigation and lifecycle require a separate browser test.
  }
  const available = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    './PixelCanvas': { PixelCanvas: 'PixelCanvas' },
    './ConfirmModal': { ConfirmModal: 'ConfirmModal' },
    './WeeklyArtwork': { WeeklyArtwork: 'WeeklyArtwork' },
    '../lib/drawing': drawing,
    '../lib/palette': palette,
    '../lib/editorText': { editorText },
    '../lib/profile': { loadOwnProfile: async () => ({ user: { id: 'synthetic-user' }, profile: {} }) },
    '../lib/feed': { FEED_DAILY_POST_LIMIT: 3, FEED_DESCRIPTION_MAX_LENGTH: 160, FEED_DESCRIPTION_MAX_LINES: 3, loadDailyFeedAccountState: async () => ({ todayPostCount: 0 }) },
    '../lib/weekly': { loadWeeklyChallenges: async () => [] },
    '../lib/monthly': { loadMonthlyChallenges: async () => [] },
    '../lib/editorGallery': {
      loadOwnEditorGallery: async () => { if (loadError) throw loadError; return slots },
      saveOwnEditorGallerySlot: async (...args) => { saved.push(args) },
      editorGalleryEndpointIsMissing: () => false,
    },
  }
  const source = await readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', 'localStorage', 'document', 'HTMLElement', output)(
    name => { assert.ok(name in available, `Unmocked dependency: ${name}`); return available[name] }, exports,
    { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    { activeElement: null }, class HTMLElement {},
  )
  const render = () => { cursor = 0; return exports.DrawingEditor({ onBack() {}, onDirtyChange() {}, onStorageChange() {} }) }
  const canvas = () => nodes(render(), 'PixelCanvas')[0].props
  const dialog = () => nodes(render(), 'section').find(node => node.props.role === 'dialog')
  const click = label => {
    const button = nodes(dialog(), 'button').find(node => text(node) === label)
    assert.ok(button, `Missing button: ${label}`)
    assert.ok(!button.props.disabled)
    button.props.onClick()
  }
  return { render, canvas, dialog, click, saved, storage }
}
function colored(color = palette.basePalette[0].hex) {
  const pixels = drawing.emptyDrawing()
  pixels[37] = color
  return pixels
}
const slot = () => ({ slotIndex: 1, paletteSize: 32, pixels: colored(palette.editorPalette32[20].hex), updatedAt: '2026-01-01T00:00:00Z' })

test('gallery load restores pixels and palette without sharing the saved array', async () => {
  const stored = slot()
  const app = await editor({ slots: [stored] })
  app.canvas().onLoadFromGallery()
  await settle()
  app.click('Betöltés')
  const canvas = app.canvas()
  assert.equal(canvas.paletteSize, 32)
  assert.deepEqual(canvas.localDrawing.initialPixels, stored.pixels)
  assert.notEqual(canvas.localDrawing.initialPixels, stored.pixels)
  assert.equal(JSON.parse(app.storage.get('bitscrawl-editor-v1')).exported, false)
  assert.equal(app.dialog(), undefined)
})

test('loading over a nonempty drawing requires confirmation and supports cancellation', async () => {
  const initial = colored()
  const stored = slot()
  const app = await editor({ initial, slots: [stored] })
  app.canvas().onLoadFromGallery()
  await settle()
  app.click('Betöltés')
  assert.deepEqual(app.canvas().localDrawing.initialPixels, initial)
  nodes(app.render(), 'ConfirmModal')[0].props.onCancel()
  assert.deepEqual(app.canvas().localDrawing.initialPixels, initial)
  app.click('Betöltés')
  nodes(app.render(), 'ConfirmModal')[0].props.onConfirm()
  assert.deepEqual(app.canvas().localDrawing.initialPixels, stored.pixels)
})

test('saving into an occupied slot waits for approval and sends a pixel snapshot', async () => {
  const pixels = colored()
  const app = await editor({ initial: pixels, slots: [slot()] })
  app.canvas().onSaveToGallery()
  await settle()
  app.click('Felülírás')
  assert.equal(app.saved.length, 0)
  nodes(app.render(), 'ConfirmModal')[0].props.onConfirm()
  await settle()
  assert.equal(app.saved.length, 1)
  assert.deepEqual(app.saved[0], [1, pixels, 12])
  assert.notEqual(app.saved[0][1], app.canvas().localDrawing.initialPixels)
  assert.equal(app.dialog(), undefined)
})

test('gallery read failure does not replace the current drawing or offer save slots', async () => {
  const pixels = colored()
  const app = await editor({ initial: pixels, loadError: new Error('synthetic offline') })
  app.canvas().onLoadFromGallery()
  await settle()
  assert.match(text(app.dialog()), /synthetic offline/)
  assert.deepEqual(app.canvas().localDrawing.initialPixels, pixels)
  assert.equal(nodes(app.dialog(), 'button').length, 1)
  assert.equal(app.saved.length, 0)
})
