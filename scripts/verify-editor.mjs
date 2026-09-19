import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDrawing, parseDrawingDraft, rasterizeDrawing } from '../src/lib/drawing.ts'
import { basePalette } from '../src/lib/palette.ts'

test('empty drawings do not share mutable data', () => {
  const first = emptyDrawing()
  first[0] = '#d3493b'
  assert.equal(emptyDrawing()[0], 'transparent')
  assert.equal(first.length, 1024)
})

test('local draft restores colors, transparency and export status', () => {
  const pixels = emptyDrawing()
  basePalette.forEach(({ hex }, index) => { pixels[index * 32 + index] = hex })
  assert.deepEqual(parseDrawingDraft(JSON.stringify({ pixels, exported: false })), { pixels, exported: false })
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels, exported: true })).exported, true)
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels })).exported, false)
})

test('corrupt or unsupported drafts cannot become pixel data', () => {
  const cases = [null, '', '{', 'null', '42', '[]', JSON.stringify({ pixels: ['red'] }),
    JSON.stringify({ pixels: Array(1024).fill('#ffffff') }),
    JSON.stringify({ pixels: Array(1024).fill(123) })]
  for (const value of cases) {
    assert.deepEqual(parseDrawingDraft(value), { pixels: emptyDrawing(), exported: true })
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
