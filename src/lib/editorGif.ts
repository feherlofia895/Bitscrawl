import { isValidEditorDrawingPixels } from './drawing'
import {
  EDITOR_ANIMATION_FRAME_LIMIT,
  EDITOR_ANIMATION_MAX_FPS,
  EDITOR_ANIMATION_MIN_FPS,
} from './editorAnimation'

const SOURCE_SIZE = 32
const TRANSPARENT = 'transparent'

type Rgb = [number, number, number]

function littleEndian(value: number) {
  return [value & 0xff, (value >> 8) & 0xff]
}

function parseColor(color: string): Rgb | null {
  if (color === TRANSPARENT || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return null
  const alpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255
  if (alpha < 128) return null
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
}

function colorKey(color: Rgb) {
  return `${color[0]},${color[1]},${color[2]}`
}

function quantize(color: Rgb): Rgb {
  return color.map(channel => Math.round(channel / 51) * 51) as Rgb
}

function createPalette(frames: string[][]) {
  const exact = new Map<string, Rgb>()
  for (const frame of frames) {
    for (const pixel of frame) {
      const color = parseColor(pixel)
      if (color) exact.set(colorKey(color), color)
    }
  }
  const useQuantizedPalette = exact.size > 255
  const colors = new Map<string, Rgb>()
  for (const color of exact.values()) {
    const paletteColor = useQuantizedPalette ? quantize(color) : color
    colors.set(colorKey(paletteColor), paletteColor)
  }
  const palette = [[0, 0, 0] as Rgb, ...colors.values()]
  const tableSize = Math.max(2, 2 ** Math.ceil(Math.log2(palette.length)))
  return { palette, tableSize, useQuantizedPalette }
}

function writeSubBlocks(bytes: number[], data: number[]) {
  for (let offset = 0; offset < data.length; offset += 255) {
    const block = data.slice(offset, offset + 255)
    bytes.push(block.length, ...block)
  }
  bytes.push(0)
}

// A clear code before every literal keeps the code width fixed. It is intentionally
// simple and produces small enough files for the editor's three-frame limit.
function encodeLiteralLzw(indices: number[], minimumCodeSize: number) {
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  const codeSize = minimumCodeSize + 1
  const output: number[] = []
  let buffer = 0
  let bits = 0
  const writeCode = (code: number) => {
    buffer |= code << bits
    bits += codeSize
    while (bits >= 8) {
      output.push(buffer & 0xff)
      buffer >>>= 8
      bits -= 8
    }
  }
  for (const index of indices) {
    writeCode(clearCode)
    writeCode(index)
  }
  writeCode(endCode)
  if (bits > 0) output.push(buffer & 0xff)
  return output
}

function frameIndices(
  frame: string[],
  scale: number,
  paletteIndex: Map<string, number>,
  useQuantizedPalette: boolean,
) {
  const indices = new Array<number>(SOURCE_SIZE * scale * SOURCE_SIZE * scale)
  let target = 0
  for (let sourceY = 0; sourceY < SOURCE_SIZE; sourceY += 1) {
    for (let repeatedY = 0; repeatedY < scale; repeatedY += 1) {
      for (let sourceX = 0; sourceX < SOURCE_SIZE; sourceX += 1) {
        const parsed = parseColor(frame[sourceY * SOURCE_SIZE + sourceX])
        const color = parsed && useQuantizedPalette ? quantize(parsed) : parsed
        const index = color ? (paletteIndex.get(colorKey(color)) ?? 0) : 0
        for (let repeatedX = 0; repeatedX < scale; repeatedX += 1) indices[target++] = index
      }
    }
  }
  return indices
}

export function encodeEditorAnimationGif(frames: string[][], fps: number, scale = 8) {
  if (frames.length < 1 || frames.length > EDITOR_ANIMATION_FRAME_LIMIT ||
    !frames.every(frame => isValidEditorDrawingPixels(frame))) {
    throw new Error('Hibás animáció nem exportálható.')
  }
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new Error('Hibás GIF-méret.')
  const safeFps = Math.max(EDITOR_ANIMATION_MIN_FPS, Math.min(EDITOR_ANIMATION_MAX_FPS, Math.round(fps)))
  const width = SOURCE_SIZE * scale
  const height = SOURCE_SIZE * scale
  const { palette, tableSize, useQuantizedPalette } = createPalette(frames)
  const paletteIndex = new Map(palette.map((color, index) => [colorKey(color), index]))
  const tableBits = Math.log2(tableSize)
  const minimumCodeSize = Math.max(2, tableBits)
  const bytes: number[] = [...new TextEncoder().encode('GIF89a')]

  bytes.push(...littleEndian(width), ...littleEndian(height), 0xf0 | (tableBits - 1), 0, 0)
  for (let index = 0; index < tableSize; index += 1) {
    bytes.push(...(palette[index] ?? [0, 0, 0]))
  }
  bytes.push(0x21, 0xff, 0x0b, ...new TextEncoder().encode('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0)

  const delay = Math.max(2, Math.round(100 / safeFps))
  for (const frame of frames) {
    bytes.push(0x21, 0xf9, 0x04, 0x09, ...littleEndian(delay), 0, 0)
    bytes.push(0x2c, 0, 0, 0, 0, ...littleEndian(width), ...littleEndian(height), 0)
    bytes.push(minimumCodeSize)
    writeSubBlocks(bytes, encodeLiteralLzw(
      frameIndices(frame, scale, paletteIndex, useQuantizedPalette),
      minimumCodeSize,
    ))
  }
  bytes.push(0x3b)
  return new Uint8Array(bytes)
}

export function createEditorAnimationGifBlob(frames: string[][], fps: number, scale = 8) {
  return new Blob([encodeEditorAnimationGif(frames, fps, scale)], { type: 'image/gif' })
}
