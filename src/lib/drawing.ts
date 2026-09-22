import {
  basePalette,
  editorPalette32,
  expandedPalette,
  type EditorPaletteSize,
} from './palette.ts'

export const DRAWING_SIZE = 32
export const TRANSPARENT_PIXEL = 'transparent'
const validColors = new Set([
  TRANSPARENT_PIXEL,
  ...basePalette.map(({ hex }) => hex),
  ...expandedPalette.map(({ hex }) => hex),
  ...editorPalette32.map(({ hex }) => hex),
])

export function isValidDrawingPixels(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length === DRAWING_SIZE * DRAWING_SIZE &&
    value.every((color: unknown) => typeof color === 'string' && validColors.has(color))
}

export type PixelSelection = { left: number; top: number; right: number; bottom: number }
export type PixelOffset = { x: number; y: number }

export function emptyDrawing(): string[] {
  return Array<string>(DRAWING_SIZE * DRAWING_SIZE).fill(TRANSPARENT_PIXEL)
}

export function clampSelectionOffset(bounds: PixelSelection, offset: PixelOffset): PixelOffset {
  return {
    x: Math.max(-bounds.left, Math.min(DRAWING_SIZE - 1 - bounds.right, offset.x)),
    y: Math.max(-bounds.top, Math.min(DRAWING_SIZE - 1 - bounds.bottom, offset.y)),
  }
}

export function movePixelSelection(
  pixels: readonly string[],
  bounds: PixelSelection,
  requestedOffset: PixelOffset,
) {
  if (pixels.length !== DRAWING_SIZE * DRAWING_SIZE) throw new Error('DRAWING_INVALID')
  const offset = clampSelectionOffset(bounds, requestedOffset)
  const moved = [...pixels]

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      moved[y * DRAWING_SIZE + x] = TRANSPARENT_PIXEL
    }
  }
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      moved[(y + offset.y) * DRAWING_SIZE + x + offset.x] = pixels[y * DRAWING_SIZE + x]
    }
  }

  return { offset, pixels: moved }
}

export type DrawingDraft = {
  pixels: string[]
  exported: boolean
  paletteSize: EditorPaletteSize
}

export function parseDrawingDraft(serialized: string | null): DrawingDraft {
  try {
    const stored: unknown = JSON.parse(serialized ?? 'null')
    if (typeof stored === 'object' && stored !== null && 'pixels' in stored &&
      isValidDrawingPixels(stored.pixels)) {
      return {
        pixels: [...stored.pixels],
        exported: 'exported' in stored && stored.exported === true,
        paletteSize: 'paletteSize' in stored && stored.paletteSize === 32 ? 32 : 12,
      }
    }
  } catch { /* Invalid drafts start with a blank canvas. */ }
  return { pixels: emptyDrawing(), exported: true, paletteSize: 12 }
}

// Pure pixel conversion: PNG export and its tests use the same RGBA buffer.
export function rasterizeDrawing(pixels: readonly string[], scale: number) {
  if (scale !== 1 && scale !== 8) throw new Error('EXPORT_SCALE_INVALID')
  if (!isValidDrawingPixels(pixels)) {
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
