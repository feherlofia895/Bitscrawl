import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  emptyDrawing,
  movePixelSelection,
  parseDrawingDraft,
  rasterizeDrawing,
} from '../src/lib/drawing.ts'
import { basePalette, editorPalette32 } from '../src/lib/palette.ts'

test('the visible 12-color buttons use the same hex values as drawing and saving', async () => {
  const [css, canvasSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])

  assert.equal(basePalette.length, 12)
  assert.equal(new Set(basePalette.map(({ hex }) => hex)).size, 12)
  assert(basePalette.every(({ hex }) => /^#[0-9a-f]{6}$/.test(hex)))
  assert.match(canvasSource, /style=\{\{ backgroundColor: color\.hex \}\}/)
  assert.doesNotMatch(
    css,
    /\.drawing-palette\[data-palette-size=['"]12['"]\]\s+button\s*\{[^}]*background-color:\s*transparent/,
  )
  assert.match(
    css,
    /\.drawing-palette\[data-palette-size=['"]12['"]\]\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*16px\)/,
  )
  assert.match(
    css,
    /\.drawing-palette\[data-palette-size=['"]12['"]\]\s+button\s*\{[^}]*background-image:\s*none/,
  )
})

test('the editor 32-color palette is unique, keeps every base color and uses a four-row grid', async () => {
  const css = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.equal(editorPalette32.length, 32)
  assert.equal(new Set(editorPalette32.map(({ hex }) => hex)).size, 32)
  assert(editorPalette32.every(({ hex }) => /^#[0-9a-f]{6}$/.test(hex)))
  assert(basePalette.every(({ hex }) => editorPalette32.some(color => color.hex === hex)))
  assert.match(
    css,
    /\.drawing-palette\[data-palette-size=['"]32['"]\]\s*\{[^}]*grid-template-columns:\s*repeat\(8,\s*20px\)[^}]*grid-template-rows:\s*repeat\(4,\s*20px\)/,
  )
})

test('canvas view controls use compact zoom buttons and omit coordinates', async () => {
  const [css, canvasSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(canvasSource, /className="canvas-zoom-button"[\s\S]*?>\s*−\s*<\/button>/)
  assert.match(canvasSource, /className="canvas-zoom-button"[\s\S]*?>\s*\+\s*<\/button>/)
  assert.match(canvasSource, />\s*Rács\s*<\/button>/)
  assert.doesNotMatch(canvasSource, /Koordináták|showCoordinates|PIXEL_COORDINATES/)
  assert.match(
    css,
    /\.canvas-view-controls \.canvas-zoom-button,[\s\S]*?width:\s*34px/,
  )
})

test('the regular toolbar omits its duplicate pan hand and enlarges the drawn controls', async () => {
  const [css, canvasSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])
  const toolbarStart = canvasSource.indexOf('<div className="tool-buttons">')
  const toolbarEnd = canvasSource.indexOf('className="drawing-palette"', toolbarStart)
  const regularToolbar = canvasSource.slice(toolbarStart, toolbarEnd)

  assert(toolbarStart >= 0 && toolbarEnd > toolbarStart)
  assert.doesNotMatch(regularToolbar, /Vászon mozgatása|\/icons\/tools\/pan\.svg/)
  assert.match(css, /\.tool-buttons \.tool-sprite-button\s*\{[^}]*width:\s*42px[^}]*height:\s*48px/)
  assert.match(css, /background-size:\s*78px 384px/)
  assert.match(css, /\.immersive-side-controls \.tool-sprite-button,[\s\S]*?\.immersive-tool-menu \.tool-sprite-button\s*\{[^}]*width:\s*42px[^}]*height:\s*48px[^}]*background-size:\s*78px 384px/)
  assert.match(css, /\.immersive-side-controls \.tool-sprite-button\[aria-pressed='true'\],[\s\S]*?background-image:\s*url\('\/ui\/toolbar-normal\.png'\)[^}]*outline:\s*3px solid var\(--blue\)/)
  assert.match(css, /\.tool-buttons \.tool-sprite-button\[aria-pressed='true'\][\s\S]*?background-image:\s*url\('\/ui\/toolbar-normal\.png'\)[^}]*outline:\s*3px solid var\(--blue\)/)
  assert.match(css, /\.tool-buttons button\[aria-pressed='true'\]\s*\{[^}]*background-color:\s*var\(--mint\)/)
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*?\.tool-buttons\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*42px\)/)
  assert.match(regularToolbar, /Teljes vászon törlése[\s\S]*?aria-label="Kijelölés"/)
})

test('empty drawings do not share mutable data', () => {
  const first = emptyDrawing()
  first[0] = '#d3493b'
  assert.equal(emptyDrawing()[0], 'transparent')
  assert.equal(first.length, 1024)
})

test('the monthly canvas waits for the saved drawing before mounting', async () => {
  const source = await readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8')
  assert.match(source, /const accountReady = loadedChallengeId === selectedId/)
  assert.match(source, /const isDrawing = !loading && accountReady && challenge\?\.challenge_status === 'drawing'/)
  assert.match(source, /initialPixels: account\.entryPixels \?\? emptyDrawing\(\)/)
})

test('local draft restores colors, transparency and export status', () => {
  const pixels = emptyDrawing()
  basePalette.forEach(({ hex }, index) => { pixels[index * 32 + index] = hex })
  assert.deepEqual(parseDrawingDraft(JSON.stringify({ pixels, exported: false })), {
    pixels, exported: false, paletteSize: 12,
  })
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels, exported: true })).exported, true)
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels })).exported, false)
})

test('local draft restores the expanded editor palette and its colors', () => {
  const pixels = emptyDrawing()
  pixels[0] = editorPalette32[0].hex
  pixels[1] = editorPalette32.at(-1).hex
  assert.deepEqual(parseDrawingDraft(JSON.stringify({ pixels, exported: false, paletteSize: 32 })), {
    pixels, exported: false, paletteSize: 32,
  })
})

test('corrupt or unsupported drafts cannot become pixel data', () => {
  const cases = [null, '', '{', 'null', '42', '[]', JSON.stringify({ pixels: ['red'] }),
    JSON.stringify({ pixels: Array(1024).fill('#ffffff') }),
    JSON.stringify({ pixels: Array(1024).fill(123) })]
  for (const value of cases) {
    assert.deepEqual(parseDrawingDraft(value), { pixels: emptyDrawing(), exported: true, paletteSize: 12 })
  }
})

test('32px PNG raster has exact palette colors and a fully transparent background', () => {
  const pixels = emptyDrawing()
  pixels[0] = '#d3493b'
  pixels[1023] = '#230a19'
  const raster = rasterizeDrawing(pixels, 1)
  assert.equal(raster.width, 32)
  assert.equal(raster.height, 32)
  assert.deepEqual([...raster.data.slice(0, 4)], [211, 73, 59, 255])
  assert.deepEqual([...raster.data.slice(-4)], [35, 10, 25, 255])
  assert.ok(raster.data.slice(4, -4).every(value => value === 0))
})

test('8x PNG raster repeats pixels exactly without smoothing or checkerboard', () => {
  const pixels = emptyDrawing()
  basePalette.forEach(({ hex }, index) => { pixels[index * 33] = hex })
  pixels[1023] = '#230a19'
  const original = rasterizeDrawing(pixels, 1)
  const large = rasterizeDrawing(pixels, 8)
  assert.equal(large.width, 256)
  assert.equal(large.height, 256)
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const originalIndex = (Math.floor(y / 8) * 32 + Math.floor(x / 8)) * 4
      const largeIndex = (y * 256 + x) * 4
      assert.deepEqual(large.data.slice(largeIndex, largeIndex + 4), original.data.slice(originalIndex, originalIndex + 4))
    }
  }
})

test('invalid export size or pixels are rejected', () => {
  for (const scale of [0, -1, 2, 8.5, NaN, Infinity]) {
    assert.throws(() => rasterizeDrawing(emptyDrawing(), scale), /EXPORT_SCALE_INVALID/)
  }
  assert.throws(() => rasterizeDrawing([], 1), /DRAWING_INVALID/)
  assert.throws(() => rasterizeDrawing(Array(1024).fill('red'), 1), /DRAWING_INVALID/)
})

test('a rectangular selection moves as one intact pixel block', () => {
  const pixels = emptyDrawing()
  pixels[1 * 32 + 1] = '#d3493b'
  pixels[1 * 32 + 2] = '#e29958'
  pixels[2 * 32 + 1] = '#67ba62'
  pixels[2 * 32 + 2] = '#33567e'
  const result = movePixelSelection(pixels, { left: 1, top: 1, right: 2, bottom: 2 }, { x: 3, y: 2 })
  assert.deepEqual(result.offset, { x: 3, y: 2 })
  assert.equal(result.pixels[1 * 32 + 1], 'transparent')
  assert.equal(result.pixels[3 * 32 + 4], '#d3493b')
  assert.equal(result.pixels[3 * 32 + 5], '#e29958')
  assert.equal(result.pixels[4 * 32 + 4], '#67ba62')
  assert.equal(result.pixels[4 * 32 + 5], '#33567e')
})

test('selection movement is overlap-safe and stops at the canvas edge', () => {
  const overlapping = emptyDrawing()
  overlapping[1 * 32 + 1] = '#d3493b'
  overlapping[1 * 32 + 2] = '#e29958'
  const overlapResult = movePixelSelection(
    overlapping,
    { left: 1, top: 1, right: 2, bottom: 1 },
    { x: 1, y: 0 },
  )
  assert.equal(overlapResult.pixels[1 * 32 + 1], 'transparent')
  assert.equal(overlapResult.pixels[1 * 32 + 2], '#d3493b')
  assert.equal(overlapResult.pixels[1 * 32 + 3], '#e29958')

  const pixels = emptyDrawing()
  pixels[30 * 32 + 29] = '#d3493b'
  pixels[30 * 32 + 30] = '#e29958'
  const result = movePixelSelection(
    pixels,
    { left: 29, top: 30, right: 30, bottom: 30 },
    { x: 12, y: 8 },
  )
  assert.deepEqual(result.offset, { x: 1, y: 1 })
  assert.equal(result.pixels[31 * 32 + 30], '#d3493b')
  assert.equal(result.pixels[31 * 32 + 31], '#e29958')
  assert.equal(result.pixels[30 * 32 + 29], 'transparent')
  assert.equal(result.pixels[30 * 32 + 30], 'transparent')
})
