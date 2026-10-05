// Component logic checks with synthetic data only: no browser, account or network writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import * as drawing from '../src/lib/drawing.ts'
import * as editorProject from '../src/lib/editorProject.ts'
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
    useEffect() {},
  }
  const available = {
    react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    './PixelCanvas': { PixelCanvas: 'PixelCanvas' },
    './EditorAnimationControls': { EditorAnimationControls: 'EditorAnimationControls' },
    './EditorAnimationThumbnail': { EditorAnimationThumbnail: 'EditorAnimationThumbnail' },
    './ConfirmModal': { ConfirmModal: 'ConfirmModal' },
    '../lib/drawing': drawing,
    '../lib/palette': palette,
    '../lib/editorText': { editorText },
    '../lib/profile': {
      loadOwnProfile: async () => ({ user: { id: 'synthetic-user' }, profile: {} }),
      saveProfileAvatar: async () => ({ storage: 'local' }),
    },
    '../lib/feed': {
      FEED_DAILY_POST_LIMIT: 3,
      FEED_DESCRIPTION_MAX_LENGTH: 160,
      FEED_DESCRIPTION_MAX_LINES: 3,
      limitFeedDescription: value => value,
      loadDailyFeedAccountState: async () => ({ todayPostCount: 0 }),
      publishDailyFeedPost: async () => undefined,
    },
    '../lib/weekly': {
      loadWeeklyAccountState: async () => null,
      loadWeeklyChallenges: async () => [],
      submitWeeklyEntry: async () => undefined,
    },
    '../lib/monthly': {
      loadMonthlyAccountState: async () => null,
      loadMonthlyChallenges: async () => [],
      saveMonthlyEntry: async () => undefined,
      submitMonthlyEntry: async () => undefined,
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
    '../lib/editorAnimation': { EDITOR_ANIMATION_STORAGE_KEY: 'bitscrawl-editor-animation-v1' },
    '../lib/editorProject': editorProject,
    '../lib/editorProjects': {
      deleteOwnEditorProject: async () => true,
      editorProjectsEndpointIsMissing: () => false,
      loadOwnEditorProjects: async () => { if (loadError) throw loadError; return slots },
      saveOwnEditorProject: async (...args) => { saved.push(args) },
    },
    '../lib/editorGif': { createEditorAnimationGifBlob: () => new Blob() },
  }
  const source = await readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', 'localStorage', 'document', 'HTMLElement', 'window', output)(
    name => { assert.ok(name in available, `Unmocked dependency: ${name}`); return available[name] }, exports,
    { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    { activeElement: null }, class HTMLElement {},
    { requestAnimationFrame: callback => callback(), scrollTo() {} },
  )
  const render = () => {
    cursor = 0
    return exports.DrawingEditor({ hasAdvancedAccess, onBack() {}, onDirtyChange() {}, onOpenProfile() { profileOpenCount++ }, onStorageChange() {} })
  }
  const canvas = () => nodes(render(), 'PixelCanvas')[0].props
  const controls = () => nodes(render(), 'EditorAnimationControls')[0]?.props
  const dialog = () => nodes(render(), 'section').find(node => node.props.role === 'dialog')
  const click = label => {
    const button = nodes(dialog(), 'button').find(node => text(node) === label)
    assert.ok(button, `Missing button: ${label}`)
    assert.ok(!button.props.disabled)
    button.props.onClick()
  }
  return { render, canvas, controls, dialog, click, profileOpenCount: () => profileOpenCount, saved, storage }
}

function colored(color = palette.basePalette[0].hex) {
  const pixels = drawing.emptyDrawing()
  pixels[37] = color
  return pixels
}

function documentWith(pixels, paletteSize = 32) {
  const document = editorProject.createEmptyEditorProject(paletteSize)
  document.frames[0].layers[0] = [...pixels]
  document.exported = false
  return document
}

const slot = () => {
  const document = documentWith(colored(palette.editorPalette32[20].hex))
  return {
    document,
    previewFrames: editorProject.composeEditorProjectFrames(document),
    slotIndex: 1,
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

test('custom RGB and RGBA projects can be saved from the editor', async () => {
  for (const color of ['#123456', '#12345680']) {
    const pixels = colored(color)
    const app = await editor({ initial: pixels })
    app.canvas().onSaveToGallery()
    await settle()
    app.click('Ide mentem')
    await settle()
    assert.equal(app.saved.length, 1)
    assert.deepEqual(app.saved[0][1].frames[0].layers[0], pixels)
    assert.equal(app.saved[0][1].frames[0].layers.length, 3)
  }
})

test('guest editor exposes PNG download and layers but no animation entry points', async () => {
  const app = await editor({ hasAdvancedAccess: false })
  const canvas = app.canvas()
  assert.equal(canvas.allowColorMixer, false)
  assert.equal(canvas.allowEditorTools, false)
  assert.equal(canvas.paletteSize, 12)
  assert.equal(canvas.customPaletteActive, false)
  assert.equal(canvas.onLoadFromGallery, undefined)
  assert.equal(canvas.onSaveToGallery, undefined)
  assert.equal(app.controls().allowAnimation, false)
  assert.equal(app.controls().frames.length, 1)

  const buttons = nodes(app.render(), 'button')
  assert.equal(buttons.find(button => text(button) === editorText.export)?.props.disabled, false)
  const profileButton = buttons.find(button => text(button) === 'Belépés / regisztráció')
  assert.ok(profileButton)
  profileButton.props.onClick()
  assert.equal(app.profileOpenCount(), 1)
})

test('project load restores all layers and project settings without sharing arrays', async () => {
  const stored = slot()
  const app = await editor({ slots: [stored] })
  app.canvas().onLoadFromGallery()
  await settle()
  app.click('Betöltés')
  const canvas = app.canvas()
  assert.equal(canvas.paletteSize, 32)
  assert.deepEqual(canvas.localDrawing.initialPixels, stored.document.frames[0].layers[0])
  assert.notEqual(canvas.localDrawing.initialPixels, stored.document.frames[0].layers[0])
  const draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.equal(draft.exported, false)
  assert.equal(draft.version, 3)
  assert.equal(draft.frames.length, 1)
  assert.equal(draft.frames[0].layers.length, 3)
  assert.equal(app.dialog(), undefined)
})

test('layer switching edits one of three layers and visibility changes the composite', async () => {
  const bottom = colored(palette.basePalette[0].hex)
  const top = colored(palette.basePalette[1].hex)
  const app = await editor({ initial: bottom })
  app.controls().onSelectCell(0, 2)
  assert.deepEqual(app.canvas().localDrawing.initialPixels, drawing.emptyDrawing())
  app.canvas().localDrawing.onChange(top)

  let draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.deepEqual(draft.frames[0].layers, [bottom, drawing.emptyDrawing(), top])
  assert.equal(draft.activeLayer, 2)
  assert.equal(app.canvas().localDrawing.getDisplayColor(top[37], 37), top[37])

  app.controls().onToggleLayerVisibility(2)
  draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.deepEqual(draft.layerVisibility, [true, true, false])
  assert.equal(app.canvas().localDrawing.getDisplayColor(top[37], 37), bottom[37])
})

test('moving a layer changes its content, visibility and active index together', async () => {
  const bottom = colored(palette.basePalette[0].hex)
  const top = colored(palette.basePalette[1].hex)
  const app = await editor({ initial: bottom })
  app.controls().onSelectCell(0, 2)
  app.canvas().localDrawing.onChange(top)
  app.controls().onToggleLayerVisibility(2)
  app.controls().onMoveLayer(-1)

  const draft = JSON.parse(app.storage.get('bitscrawl-editor-v1'))
  assert.deepEqual(draft.frames[0].layers, [bottom, top, drawing.emptyDrawing()])
  assert.deepEqual(draft.layerVisibility, [true, false, true])
  assert.equal(draft.activeLayer, 1)
  assert.equal(draft.exported, false)
  assert.deepEqual(app.canvas().localDrawing.initialPixels, top)
  assert.equal(app.canvas().localDrawing.getDisplayColor(top[37], 37), bottom[37])
})

test('hidden layer content still requires confirmation before starting a new project', async () => {
  const app = await editor()
  app.controls().onSelectCell(0, 2)
  app.canvas().localDrawing.onChange(colored())
  app.controls().onToggleLayerVisibility(2)
  nodes(app.render(), 'button').find(button => text(button) === editorText.newDrawing).props.onClick()
  assert.equal(nodes(app.render(), 'ConfirmModal').length, 1)
})

test('loading over a nonempty project requires confirmation and supports cancellation', async () => {
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
  assert.deepEqual(app.canvas().localDrawing.initialPixels, stored.document.frames[0].layers[0])
})

test('saving into an occupied slot waits for approval and sends a cloned full project', async () => {
  const pixels = colored()
  const app = await editor({ initial: pixels, slots: [slot()] })
  app.canvas().onSaveToGallery()
  await settle()
  app.click('Felülírás')
  assert.equal(app.saved.length, 0)
  nodes(app.render(), 'ConfirmModal')[0].props.onConfirm()
  await settle()
  assert.equal(app.saved.length, 1)
  assert.equal(app.saved[0][0], 1)
  assert.deepEqual(app.saved[0][1].frames[0].layers[0], pixels)
  assert.notEqual(app.saved[0][1].frames[0].layers[0], app.canvas().localDrawing.initialPixels)
  assert.equal(app.dialog(), undefined)
})

test('project read failure does not replace the current project or offer save slots', async () => {
  const pixels = colored()
  const app = await editor({ initial: pixels, loadError: new Error('synthetic offline') })
  app.canvas().onLoadFromGallery()
  await settle()
  assert.match(text(app.dialog()), /synthetic offline/)
  assert.deepEqual(app.canvas().localDrawing.initialPixels, pixels)
  assert.equal(nodes(app.dialog(), 'button').length, 1)
  assert.equal(app.saved.length, 0)
})
