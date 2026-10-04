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
async function editor({ hasAdvancedAccess = true, initial = drawing.emptyDrawing(), slots = [], loadError = null } = {}) {
  const state = []
  const saved = []
  let profileOpenCount = 0
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
    './EditorAnimationControls': { EditorAnimationControls: 'EditorAnimationControls' },
    './EditorAnimationThumbnail': { EditorAnimationThumbnail: 'EditorAnimationThumbnail' },
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
    '../lib/editorPalettes': {
      EDITOR_PALETTE_COLOR_LIMIT: 16,
      loadLocalEditorPalettes: () => [1, 2, 3].map(slotIndex => ({ colors: [], name: `Saját paletta ${slotIndex}`, slotIndex, updatedAt: null })),
      loadOwnEditorPalettes: async () => ({ palettes: [1, 2, 3].map(slotIndex => ({ colors: [], name: `Saját paletta ${slotIndex}`, slotIndex, updatedAt: null })), storage: 'local' }),
      sanitizeEditorPaletteColors: colors => [...new Set(colors)].slice(0, 16),
      sanitizeEditorPaletteName: (name, slotIndex) => name.trim() || `Saját paletta ${slotIndex}`,
      saveLocalEditorPalettes: () => true,
      saveOwnEditorPalette: async () => 'local',
      deleteOwnEditorPalette: async () => 'local',
    },
    '../lib/editorAnimation': {
      addAnimationFrame: frames => [...frames, drawing.emptyDrawing()].slice(0, 3),
      deleteAnimationFrame: frames => frames.length > 1 ? frames.slice(0, -1) : frames,
      loadEditorAnimation: pixels => ({ activeFrameIndex: 0, fps: 4, frames: [[...pixels]], onionSkin: true }),
      normalizeEditorAnimation: value => value,
      replaceAnimationFrame: (frames, index, pixels) => frames.map((frame, frameIndex) => frameIndex === index ? [...pixels] : [...frame]),
      saveEditorAnimation: () => true,
    },
    '../lib/editorAnimationGallery': {
      deleteOwnEditorAnimationSlot: async () => true,
      editorAnimationGalleryEndpointIsMissing: () => false,
      loadOwnEditorAnimations: async () => [],
      saveOwnEditorAnimationSlot: async () => true,
    },
    '../lib/editorGif': { createEditorAnimationGifBlob: () => new Blob() },
  }
  const source = await readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', 'localStorage', 'document', 'HTMLElement', output)(
    name => { assert.ok(name in available, `Unmocked dependency: ${name}`); return available[name] }, exports,
    { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    { activeElement: null }, class HTMLElement {},
  )
  const render = () => { cursor = 0; return exports.DrawingEditor({ hasAdvancedAccess, onBack() {}, onDirtyChange() {}, onOpenProfile() { profileOpenCount++ }, onStorageChange() {} }) }
  const canvas = () => nodes(render(), 'PixelCanvas')[0].props
  const dialog = () => nodes(render(), 'section').find(node => node.props.role === 'dialog')
  const click = label => {
    const button = nodes(dialog(), 'button').find(node => text(node) === label)
    assert.ok(button, `Missing button: ${label}`)
    assert.ok(!button.props.disabled)
    button.props.onClick()
  }
  return { render, canvas, dialog, click, profileOpenCount: () => profileOpenCount, saved, storage }
}
function colored(color = palette.basePalette[0].hex) {
  const pixels = drawing.emptyDrawing()
  pixels[37] = color
  return pixels
}
const slot = () => ({ slotIndex: 1, paletteSize: 32, pixels: colored(palette.editorPalette32[20].hex), updatedAt: '2026-01-01T00:00:00Z' })

test('guest editor exposes the base palette and PNG download but no advanced entry points', async () => {
  const app = await editor({ hasAdvancedAccess: false })
  const canvas = app.canvas()
  assert.equal(canvas.allowColorMixer, false)
  assert.equal(canvas.allowEditorTools, false)
  assert.equal(canvas.paletteSize, 12)
  assert.equal(canvas.customPaletteActive, false)
  assert.equal(canvas.onLoadFromGallery, undefined)
  assert.equal(canvas.onSaveToGallery, undefined)

  const tree = app.render()
  const buttons = nodes(tree, 'button')
  assert.equal(buttons.find(button => text(button).includes('Animáció ·'))?.props.disabled, true)
  assert.equal(buttons.find(button => text(button) === editorText.export)?.props.disabled, false)
  const profileButton = buttons.find(button => text(button) === 'Belépés / regisztráció')
  assert.ok(profileButton)
  profileButton.props.onClick()
  assert.equal(app.profileOpenCount(), 1)
})

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
  const draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.equal(draft.exported, false)
  assert.equal(draft.version, 2)
  assert.equal(draft.activeLayer, 0)
  assert.deepEqual(draft.layers, [stored.pixels, drawing.emptyDrawing()])
  assert.equal(app.dialog(), undefined)
})

test('layer switching edits only the active editor layer and visibility changes the composite', async () => {
  const bottom = colored(palette.basePalette[0].hex)
  const top = colored(palette.basePalette[1].hex)
  const app = await editor({ initial: bottom })
  const upperButton = nodes(app.render(), 'button').find(button => text(button).startsWith('Felső réteg'))
  assert.ok(upperButton)
  upperButton.props.onClick()
  assert.deepEqual(app.canvas().localDrawing.initialPixels, drawing.emptyDrawing())
  app.canvas().localDrawing.onChange(top)

  let draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.deepEqual(draft.layers, [bottom, top])
  assert.equal(draft.activeLayer, 1)
  assert.equal(app.canvas().localDrawing.getDisplayColor(top[37], 37), top[37])

  const hideUpper = nodes(app.render(), 'button').find(button =>
    button.props['aria-label'] === 'Felső réteg elrejtése')
  assert.ok(hideUpper)
  hideUpper.props.onClick()
  draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.deepEqual(draft.layerVisibility, [true, false])
  assert.equal(app.canvas().localDrawing.getDisplayColor(top[37], 37), bottom[37])
})

test('hidden layer content still requires confirmation before starting a new drawing', async () => {
  const app = await editor()
  const upperButton = nodes(app.render(), 'button').find(button => text(button).startsWith('Felső réteg'))
  assert.ok(upperButton)
  upperButton.props.onClick()
  app.canvas().localDrawing.onChange(colored())
  const hideUpper = nodes(app.render(), 'button').find(button =>
    button.props['aria-label'] === 'Felső réteg elrejtése')
  assert.ok(hideUpper)
  hideUpper.props.onClick()

  const newDrawing = nodes(app.render(), 'button').find(button => text(button) === editorText.newDrawing)
  assert.ok(newDrawing)
  newDrawing.props.onClick()
  assert.equal(nodes(app.render(), 'ConfirmModal').length, 1)
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
