import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { emptyDrawing } from '../src/lib/drawing.ts'

const source = await readFile(new URL('../src/lib/editorGif.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const gif = {}
new Function('require', 'exports', output)(name => {
  if (name === './drawing') return {
    isValidEditorDrawingPixels: value => Array.isArray(value) && value.length === 1024 && value.every(color => (
      color === 'transparent' || (typeof color === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color))
    )),
  }
  if (name === './editorAnimation') return {
    EDITOR_ANIMATION_FRAME_LIMIT: 3,
    EDITOR_ANIMATION_MAX_FPS: 8,
    EDITOR_ANIMATION_MIN_FPS: 1,
  }
  throw new Error(`Unmocked dependency: ${name}`)
}, gif)

function inspect(bytes) {
  const text = new TextDecoder().decode(bytes.slice(0, 6))
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  const tableSize = 1 << ((bytes[10] & 7) + 1)
  let offset = 13 + tableSize * 3
  let frameCount = 0
  const delays = []
  while (offset < bytes.length) {
    if (bytes[offset] === 0x3b) break
    if (bytes[offset] === 0x21 && bytes[offset + 1] === 0xf9) {
      delays.push(bytes[offset + 4] | (bytes[offset + 5] << 8))
      offset += 8
      continue
    }
    if (bytes[offset] === 0x21) {
      offset += 2
      while (bytes[offset] !== 0) offset += 1 + bytes[offset]
      offset += 1
      continue
    }
    if (bytes[offset] === 0x2c) {
      frameCount += 1
      offset += 10
      offset += 1
      while (bytes[offset] !== 0) offset += 1 + bytes[offset]
      offset += 1
      continue
    }
    throw new Error(`Unexpected GIF marker: ${bytes[offset].toString(16)}`)
  }
  return { delays, frameCount, height, tableSize, text, width }
}

test('GIF export produces a looping GIF89a with one image per frame', () => {
  const first = emptyDrawing()
  const second = emptyDrawing()
  first[0] = '#ff0000'
  second[1] = '#00ff0080'
  const bytes = gif.encodeEditorAnimationGif([first, second], 4, 8)
  const result = inspect(bytes)
  assert.equal(result.text, 'GIF89a')
  assert.equal(result.width, 256)
  assert.equal(result.height, 256)
  assert.equal(result.frameCount, 2)
  assert.deepEqual(result.delays, [25, 25])
  assert.equal(bytes.at(-1), 0x3b)
  assert.ok(new TextDecoder().decode(bytes).includes('NETSCAPE2.0'))
})

test('GIF export validates frames and keeps the palette within 256 entries', () => {
  const frame = emptyDrawing()
  for (let index = 0; index < frame.length; index += 1) {
    frame[index] = `#${(index * 7919 % 0xffffff).toString(16).padStart(6, '0')}`
  }
  const result = inspect(gif.encodeEditorAnimationGif([frame], 99, 1))
  assert.ok(result.tableSize <= 256)
  assert.deepEqual(result.delays, [13])
  assert.throws(() => gif.encodeEditorAnimationGif([['invalid']], 4, 8), /Hibás animáció/)
})

test('GIF export returns an image/gif Blob', () => {
  const frame = emptyDrawing()
  frame[4] = '#123456'
  const blob = gif.createEditorAnimationGifBlob([frame], 4, 1)
  assert.equal(blob.type, 'image/gif')
  assert.ok(blob.size > 100)
})
