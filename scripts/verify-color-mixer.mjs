import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  emptyDrawing,
  isValidDrawingPixels,
  isValidEditorDrawingPixels,
  parseDrawingDraft,
  rasterizeDrawing,
} from '../src/lib/drawing.ts'
import {
  hexToHsla,
  hslaToHex,
  movePaletteColor,
  normalizeHexColor,
  removePaletteColor,
} from '../src/lib/colorMixer.ts'

const readSource = path => readFile(new URL(path, import.meta.url), 'utf8')

test('normalizes hexadecimal colors and falls back for invalid input', () => {
  assert.equal(normalizeHexColor(' #AABBCC '), '#aabbcc')
  assert.equal(normalizeHexColor('red', '#d3493b'), '#d3493b')
})

test('converts HSL controls and preserves alpha in eight-digit hex colors', () => {
  assert.equal(hslaToHex({ hue: 0, saturation: 100, lightness: 50, alpha: 100 }), '#ff0000')
  assert.equal(hslaToHex({ hue: 120, saturation: 100, lightness: 50, alpha: 50 }), '#00ff0080')
  assert.deepEqual(hexToHsla('#00ff0080'), {
    hue: 120, saturation: 100, lightness: 50, alpha: 50,
  })
})

test('custom palette colors can be reordered and removed without mutating the source', () => {
  const colors = ['#111111', '#222222', '#333333']
  assert.deepEqual(movePaletteColor(colors, '#222222', -1), ['#222222', '#111111', '#333333'])
  assert.deepEqual(movePaletteColor(colors, '#222222', 1), ['#111111', '#333333', '#222222'])
  assert.deepEqual(movePaletteColor(colors, '#111111', -1), colors)
  assert.deepEqual(removePaletteColor(colors, '#222222'), ['#111111', '#333333'])
  assert.deepEqual(colors, ['#111111', '#222222', '#333333'])
})

test('editor drafts and PNG rasterization accept a mixed custom color', () => {
  const pixels = emptyDrawing()
  pixels[0] = '#123456'
  assert.equal(isValidDrawingPixels(pixels), false)
  assert.equal(isValidEditorDrawingPixels(pixels), true)
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels, exported: false })).pixels[0], '#123456')
  assert.deepEqual([...rasterizeDrawing(pixels, 1).data.slice(0, 4)], [18, 52, 86, 255])

  pixels[0] = '#12345680'
  assert.equal(isValidEditorDrawingPixels(pixels), true)
  assert.deepEqual([...rasterizeDrawing(pixels, 1).data.slice(0, 4)], [18, 52, 86, 128])
})

test('the mixer and saved custom palettes are available in the editor and both challenge canvases', async () => {
  const [editor, pixelCanvas, weekly, monthly, challengePicker, challengePalettes] = await Promise.all([
    readSource('../src/components/DrawingEditor.tsx'),
    readSource('../src/components/PixelCanvas.tsx'),
    readSource('../src/components/WeeklyDraw.tsx'),
    readSource('../src/components/MonthlyDraw.tsx'),
    readSource('../src/components/ChallengePalettePicker.tsx'),
    readSource('../src/hooks/useChallengeEditorPalettes.ts'),
  ])

  assert.match(editor, /allowColorMixer/)
  assert.match(editor, /galleryPaletteReady/)
  assert.match(editor, /A kevert színeket a Rajzfal, a profilkép/)
  assert.match(pixelCanvas, /bitscrawl-editor-custom-palette-v1/)
  assert.match(pixelCanvas, /<ColorMixer/)
  const mixer = await readSource('../src/components/ColorMixer.tsx')
  assert.match(mixer, /Színskála · H árnyalat/)
  assert.match(mixer, /alpha: 100/)
  assert.doesNotMatch(mixer, /B szín aránya|Első keverési szín|Második keverési szín/)
  assert.match(editor, /Egyéni paletta/)
  assert.match(pixelCanvas, /Paletta kiválasztása teljes nézetben/)
  assert.match(pixelCanvas, /Paletta szerkesztése/)
  assert.match(pixelCanvas, /isCustomPaletteEditing \? customPaletteControls/)
  assert.match(pixelCanvas, /Az Egyéni paletta még üres/)
  assert.match(weekly, /allowColorMixer/)
  assert.match(monthly, /allowColorMixer/)
  assert.match(pixelCanvas, /compactMobileToolbar = true/)
  assert.match(weekly, /customPaletteColors=\{palette\.activeCustomPalette\.colors\}/)
  assert.match(monthly, /customPaletteColors=\{palette\.activeCustomPalette\.colors\}/)
  assert.match(challengePicker, /<option value="custom">Egyéni paletta<\/option>/)
  assert.match(challengePalettes, /useState\(true\)/)
  assert.match(challengePalettes, /loadOwnEditorPalettes/)
  assert.match(challengePalettes, /saveOwnEditorPalette/)
})
