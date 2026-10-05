import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { emptyDrawing } from '../src/lib/drawing.ts'

const source = await readFile(new URL('../src/lib/editorAnimation.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const animation = {}
new Function('require', 'exports', output)(
  name => {
    if (name === './drawing' || name === './drawing.ts') {
      return {
        emptyDrawing,
        isValidEditorDrawingPixels: value => Array.isArray(value) && value.length === 1024 && value.every(color => (
          color === 'transparent' || (typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))
        )),
      }
    }
    throw new Error(`Unmocked dependency: ${name}`)
  },
  animation,
)

const {
  addAnimationFrame,
  deleteAnimationFrame,
  EDITOR_ANIMATION_FRAME_LIMIT,
  EDITOR_ANIMATION_STORAGE_KEY,
  loadEditorAnimation,
  nextAnimationFrame,
  normalizeEditorAnimation,
  replaceAnimationFrame,
  saveEditorAnimation,
} = animation

test('animation drafts keep one to five valid frames and clamp playback settings', () => {
  const first = emptyDrawing()
  const second = emptyDrawing()
  const third = emptyDrawing()
  const fourth = emptyDrawing()
  first[0] = '#123456'

  const draft = normalizeEditorAnimation({
    activeFrameIndex: 99,
    fps: 99,
    frames: [first, second, third, fourth, ['invalid']],
    onionSkin: true,
  })

  assert.equal(EDITOR_ANIMATION_FRAME_LIMIT, 5)
  assert.equal(draft.frames.length, 4)
  assert.equal(draft.activeFrameIndex, 3)
  assert.equal(draft.fps, 8)
  assert.equal(draft.onionSkin, true)
  assert.notEqual(draft.frames[0], first)
})

test('frame operations copy pixel arrays and never remove the last frame', () => {
  const first = emptyDrawing()
  first[0] = '#123456'
  const added = addAnimationFrame([first], first)
  assert.equal(added.length, 2)
  assert.notEqual(added[0], first)
  assert.notEqual(added[1], first)

  const replacement = emptyDrawing()
  replacement[1] = '#abcdef'
  const replaced = replaceAnimationFrame(added, 1, replacement)
  assert.equal(replaced[1][1], '#abcdef')
  assert.equal(added[1][1], 'transparent')

  assert.equal(deleteAnimationFrame(replaced, 1).length, 1)
  assert.equal(deleteAnimationFrame([first], 0).length, 1)
  assert.equal(nextAnimationFrame(2, 3), 0)
})

test('animation drafts persist locally without sharing mutable frame data', () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  const pixels = emptyDrawing()
  pixels[4] = '#112233'
  assert.equal(saveEditorAnimation({ activeFrameIndex: 0, fps: 4, frames: [pixels], onionSkin: true }), true)
  const loaded = loadEditorAnimation()
  assert.equal(loaded.frames[0][4], '#112233')
  pixels[4] = '#ffffff'
  assert.equal(loaded.frames[0][4], '#112233')
  assert.ok(storage.has(EDITOR_ANIMATION_STORAGE_KEY))
})

test('the standalone editor combines three layers, five frames and four project slots', async () => {
  const [editor, controls, canvas, css] = await Promise.all([
    readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/EditorAnimationControls.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
  ])
  assert.match(editor, /Saját projektek · legfeljebb 4 mentés/)
  assert.match(editor, /\(\[2, 1, 0\] as const\)/)
  assert.match(editor, /<EditorAnimationControls/)
  assert.match(editor, /onionSkinPixels=/)
  assert.doesNotMatch(editor, /hidden=\{animationMode\}/)
  assert.match(controls, /Új képkocka/)
  assert.match(controls, /Képkocka másolása/)
  assert.match(controls, /Képkocka törlése/)
  assert.match(controls, /Előző képkocka halványan/)
  assert.match(controls, /aria-label=\{playing \? 'Animáció szüneteltetése' : 'Animáció lejátszása'\}/)
  assert.match(controls, /editor-animation-preview[\s\S]*?WeeklyArtwork[\s\S]*?editor-animation-speed[\s\S]*?editor-animation-play-button/)
  assert.match(controls, /<AnimationActionIcon kind="add"/)
  assert.match(controls, /<AnimationActionIcon kind="duplicate"/)
  assert.match(controls, /<AnimationActionIcon kind="remove"/)
  assert.doesNotMatch(controls, /editor-animation-storage-actions/)
  assert.match(editor, /<summary>Megosztás<\/summary>/)
  assert.match(editor, /GIF export · 256×256/)
  assert.match(editor, /Teljes projekt mentése/)
  assert.match(editor, /openGalleryAction\('save'\)/)
  assert.match(editor, /EditorAnimationThumbnail/)
  assert.match(canvas, /className="onion-skin-canvas"/)
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.editor-animation-preview\s*\{[\s\S]*?grid-template-columns:\s*54px minmax\(92px, 1fr\) 38px/)
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.editor-animation-heading-copy > p:last-child\s*\{[\s\S]*?display:\s*none/)
  assert.match(css, /\.editor-animation-actions\s*\{[\s\S]*?flex-wrap:\s*nowrap/)
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.editor-gallery-dialog-grid\s*\{\s*grid-template-columns:\s*1fr/)
})
