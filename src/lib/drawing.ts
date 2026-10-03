import {
  basePalette,
  editorPalette32,
  expandedPalette,
  type EditorPaletteSize,
} from './palette.ts'

export const DRAWING_SIZE = 32
export type DrawingSize = 32 | 128
export const TRANSPARENT_PIXEL = 'transparent'
const validColors = new Set([
  TRANSPARENT_PIXEL,
  ...basePalette.map(({ hex }) => hex),
  ...expandedPalette.map(({ hex }) => hex),
  ...editorPalette32.map(({ hex }) => hex),
])
const customHexColor = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

export function isValidDrawingPixels(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length === DRAWING_SIZE * DRAWING_SIZE &&
    value.every((color: unknown) => typeof color === 'string' && validColors.has(color))
}

// The standalone editor may use locally mixed colors. Server-backed drawings
// intentionally keep using the stricter official-palette validator above.
export function isValidEditorDrawingPixels(
  value: unknown,
  drawingSize: DrawingSize = DRAWING_SIZE,
): value is string[] {
  return Array.isArray(value) &&
    value.length === drawingSize * drawingSize &&
    value.every((color: unknown) =>
      color === TRANSPARENT_PIXEL || (typeof color === 'string' && customHexColor.test(color)))
}

export type PixelSelection = { left: number; top: number; right: number; bottom: number }
export type PixelOffset = { x: number; y: number }
export type PixelPoint = { x: number; y: number }
export type BrushSize = 1 | 2 | 3
export type PixelSelectionTransform = 'rotate-clockwise' | 'flip-horizontal' | 'flip-vertical'

export function emptyDrawing(drawingSize: DrawingSize = DRAWING_SIZE): string[] {
  return Array<string>(drawingSize * drawingSize).fill(TRANSPARENT_PIXEL)
}

export function brushFootprint(
  point: PixelPoint,
  brushSize: BrushSize,
  drawingSize: DrawingSize = DRAWING_SIZE,
): PixelPoint[] {
  const startOffset = -Math.floor(brushSize / 2)
  const points: PixelPoint[] = []

  for (let offsetY = 0; offsetY < brushSize; offsetY += 1) {
    for (let offsetX = 0; offsetX < brushSize; offsetX += 1) {
      const x = point.x + startOffset + offsetX
      const y = point.y + startOffset + offsetY
      if (x >= 0 && x < drawingSize && y >= 0 && y < drawingSize) {
        points.push({ x, y })
      }
    }
  }

  return points
}

export function replaceDrawingColor(
  pixels: readonly string[],
  fromColor: string,
  toColor: string,
  bounds: PixelSelection | null = null,
  drawingSize: DrawingSize = DRAWING_SIZE,
) {
  if (pixels.length !== drawingSize * drawingSize) throw new Error('DRAWING_INVALID')
  if (fromColor === toColor) return [...pixels]

  return pixels.map((color, index) => {
    const x = index % drawingSize
    const y = Math.floor(index / drawingSize)
    const insideBounds = !bounds || (
      x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
    )
    return insideBounds && color === fromColor ? toColor : color
  })
}

export function clampSelectionOffset(
  bounds: PixelSelection,
  offset: PixelOffset,
  drawingSize: DrawingSize = DRAWING_SIZE,
): PixelOffset {
  return {
    x: Math.max(-bounds.left, Math.min(drawingSize - 1 - bounds.right, offset.x)),
    y: Math.max(-bounds.top, Math.min(drawingSize - 1 - bounds.bottom, offset.y)),
  }
}

export function movePixelSelection(
  pixels: readonly string[],
  bounds: PixelSelection,
  requestedOffset: PixelOffset,
  drawingSize: DrawingSize = DRAWING_SIZE,
) {
  if (pixels.length !== drawingSize * drawingSize) throw new Error('DRAWING_INVALID')
  const offset = clampSelectionOffset(bounds, requestedOffset, drawingSize)
  const moved = [...pixels]

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      moved[y * drawingSize + x] = TRANSPARENT_PIXEL
    }
  }
  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      moved[(y + offset.y) * drawingSize + x + offset.x] = pixels[y * drawingSize + x]
    }
  }

  return { offset, pixels: moved }
}

export function transformPixelSelection(
  pixels: readonly string[],
  bounds: PixelSelection,
  transform: PixelSelectionTransform,
  drawingSize: DrawingSize = DRAWING_SIZE,
) {
  if (pixels.length !== drawingSize * drawingSize) throw new Error('DRAWING_INVALID')

  const width = bounds.right - bounds.left + 1
  const height = bounds.bottom - bounds.top + 1
  const isRotation = transform === 'rotate-clockwise'
  const transformedWidth = isRotation ? height : width
  const transformedHeight = isRotation ? width : height
  const centerX = (bounds.left + bounds.right) / 2
  const centerY = (bounds.top + bounds.bottom) / 2
  const left = Math.max(
    0,
    Math.min(drawingSize - transformedWidth, Math.round(centerX - (transformedWidth - 1) / 2)),
  )
  const top = Math.max(
    0,
    Math.min(drawingSize - transformedHeight, Math.round(centerY - (transformedHeight - 1) / 2)),
  )
  const transformed = [...pixels]

  for (let y = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x = bounds.left; x <= bounds.right; x += 1) {
      transformed[y * drawingSize + x] = TRANSPARENT_PIXEL
    }
  }

  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      let transformedX = localX
      let transformedY = localY
      if (transform === 'rotate-clockwise') {
        transformedX = height - 1 - localY
        transformedY = localX
      } else if (transform === 'flip-horizontal') {
        transformedX = width - 1 - localX
      } else {
        transformedY = height - 1 - localY
      }
      transformed[(top + transformedY) * drawingSize + left + transformedX] =
        pixels[(bounds.top + localY) * drawingSize + bounds.left + localX]
    }
  }

  return {
    bounds: {
      left,
      top,
      right: left + transformedWidth - 1,
      bottom: top + transformedHeight - 1,
    },
    pixels: transformed,
  }
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
      isValidEditorDrawingPixels(stored.pixels)) {
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
  if (!isValidEditorDrawingPixels(pixels)) {
    throw new Error('DRAWING_INVALID')
  }
  const size = DRAWING_SIZE * scale
  const data = new Uint8ClampedArray(size * size * 4)
  pixels.forEach((color, index) => {
    if (color === TRANSPARENT_PIXEL) return
    const red = Number.parseInt(color.slice(1, 3), 16)
    const green = Number.parseInt(color.slice(3, 5), 16)
    const blue = Number.parseInt(color.slice(5, 7), 16)
    const alpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255
    const x = (index % DRAWING_SIZE) * scale
    const y = Math.floor(index / DRAWING_SIZE) * scale
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const offset = ((y + dy) * size + x + dx) * 4
        data.set([red, green, blue, alpha], offset)
      }
    }
  })
  return { width: size, height: size, data }
}
