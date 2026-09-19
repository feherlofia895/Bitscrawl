import { basePalette } from './palette.ts'

export const DRAWING_SIZE = 32
export const TRANSPARENT_PIXEL = 'transparent'
const validColors = new Set([TRANSPARENT_PIXEL, ...basePalette.map(({ hex }) => hex)])

export function emptyDrawing(): string[] {
  return Array<string>(DRAWING_SIZE * DRAWING_SIZE).fill(TRANSPARENT_PIXEL)
}

export function parseDrawingDraft(serialized: string | null): { pixels: string[]; exported: boolean } {
  try {
    const stored: unknown = JSON.parse(serialized ?? 'null')
    if (typeof stored === 'object' && stored !== null && 'pixels' in stored &&
      Array.isArray(stored.pixels) && stored.pixels.length === DRAWING_SIZE * DRAWING_SIZE &&
      stored.pixels.every((color: unknown) => typeof color === 'string' && validColors.has(color))) {
      return { pixels: [...stored.pixels], exported: 'exported' in stored && stored.exported === true }
    }
  } catch { /* Invalid drafts start with a blank canvas. */ }
  return { pixels: emptyDrawing(), exported: true }
}

// Pure pixel conversion: PNG export and its tests use the same RGBA buffer.
export function rasterizeDrawing(pixels: readonly string[], scale: number) {
  if (scale !== 1 && scale !== 8) throw new Error('EXPORT_SCALE_INVALID')
  if (pixels.length !== DRAWING_SIZE * DRAWING_SIZE || pixels.some(color => !validColors.has(color))) {
    throw new Error('DRAWING_INVALID')
  }
  const size = DRAWING_SIZE * scale
  const data = new Uint8ClampedArray(size * size * 4)
  pixels.forEach((color, index) => {
    if (color === TRANSPARENT_PIXEL) return
    const red = Number.parseInt(color.slice(1, 3), 16)
    const green = Number.parseInt(color.slice(3, 5), 16)
    const blue = Number.parseInt(color.slice(5, 7), 16)
    const x = (index % DRAWING_SIZE) * scale
    const y = Math.floor(index / DRAWING_SIZE) * scale
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const offset = ((y + dy) * size + x + dx) * 4
        data.set([red, green, blue, 255], offset)
      }
    }
  })
  return { width: size, height: size, data }
}
