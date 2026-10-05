import {
  compositeDrawingPixel,
  emptyDrawing,
  isValidEditorDrawingPixels,
  parseDrawingDraft,
} from './drawing.ts'
import {
  EDITOR_ANIMATION_MAX_FPS,
  EDITOR_ANIMATION_MIN_FPS,
  normalizeEditorAnimation,
} from './editorAnimation.ts'
import type { EditorPaletteSize } from './palette.ts'

export const EDITOR_PROJECT_VERSION = 3
export const EDITOR_PROJECT_FRAME_LIMIT = 5
export const EDITOR_PROJECT_LAYER_LIMIT = 3
export const EDITOR_PROJECT_SLOT_LIMIT = 4
export const EDITOR_PROJECT_MAX_BYTES = 262_144

export type EditorProjectLayerIndex = 0 | 1 | 2
export type EditorProjectLayerVisibility = [boolean, boolean, boolean]
export type EditorProjectLayers = [string[], string[], string[]]
export type EditorProjectFrame = { layers: EditorProjectLayers }

export type EditorProjectDocument = {
  activeFrameIndex: number
  activeLayer: EditorProjectLayerIndex
  exported: boolean
  fps: number
  frames: EditorProjectFrame[]
  layerVisibility: EditorProjectLayerVisibility
  onionSkin: boolean
  paletteSize: EditorPaletteSize
  version: 3
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export function emptyEditorProjectLayers(): EditorProjectLayers {
  return [emptyDrawing(), emptyDrawing(), emptyDrawing()]
}

export function cloneEditorProjectLayers(layers: EditorProjectLayers): EditorProjectLayers {
  return layers.map(layer => [...layer]) as EditorProjectLayers
}

export function cloneEditorProject(project: EditorProjectDocument): EditorProjectDocument {
  return {
    ...project,
    frames: project.frames.map(frame => ({ layers: cloneEditorProjectLayers(frame.layers) })),
    layerVisibility: [...project.layerVisibility],
  }
}

export function createEmptyEditorProject(paletteSize: EditorPaletteSize = 12): EditorProjectDocument {
  return {
    activeFrameIndex: 0,
    activeLayer: 0,
    exported: true,
    fps: 4,
    frames: [{ layers: emptyEditorProjectLayers() }],
    layerVisibility: [true, true, true],
    onionSkin: true,
    paletteSize,
    version: EDITOR_PROJECT_VERSION,
  }
}

function parseLayers(value: unknown): EditorProjectLayers | null {
  if (!Array.isArray(value) || value.length !== EDITOR_PROJECT_LAYER_LIMIT ||
    !value.every(layer => isValidEditorDrawingPixels(layer))) return null
  return value.map(layer => [...layer]) as EditorProjectLayers
}

export function parseEditorProject(value: unknown): EditorProjectDocument | null {
  if (!isObject(value) || value.version !== EDITOR_PROJECT_VERSION ||
    !Array.isArray(value.frames) || value.frames.length < 1 ||
    value.frames.length > EDITOR_PROJECT_FRAME_LIMIT) return null

  const frames: EditorProjectFrame[] = []
  for (const rawFrame of value.frames) {
    if (!isObject(rawFrame)) return null
    const layers = parseLayers(rawFrame.layers)
    if (!layers) return null
    frames.push({ layers })
  }

  if (!Array.isArray(value.layerVisibility) ||
    value.layerVisibility.length !== EDITOR_PROJECT_LAYER_LIMIT ||
    !value.layerVisibility.every(item => typeof item === 'boolean')) return null
  if (value.activeLayer !== 0 && value.activeLayer !== 1 && value.activeLayer !== 2) return null
  if (!Number.isInteger(value.activeFrameIndex) || Number(value.activeFrameIndex) < 0 ||
    Number(value.activeFrameIndex) >= frames.length) return null
  if (!Number.isInteger(value.fps) || Number(value.fps) < EDITOR_ANIMATION_MIN_FPS ||
    Number(value.fps) > EDITOR_ANIMATION_MAX_FPS) return null
  if (value.paletteSize !== 12 && value.paletteSize !== 32) return null
  if (typeof value.onionSkin !== 'boolean' || typeof value.exported !== 'boolean') return null

  return {
    activeFrameIndex: Number(value.activeFrameIndex),
    activeLayer: value.activeLayer,
    exported: value.exported,
    fps: Number(value.fps),
    frames,
    layerVisibility: [
      value.layerVisibility[0] as boolean,
      value.layerVisibility[1] as boolean,
      value.layerVisibility[2] as boolean,
    ],
    onionSkin: value.onionSkin,
    paletteSize: value.paletteSize,
    version: EDITOR_PROJECT_VERSION,
  }
}

export function composeEditorProjectLayers(
  layers: EditorProjectLayers,
  visibility: EditorProjectLayerVisibility = [true, true, true],
) {
  if (!layers.every(layer => isValidEditorDrawingPixels(layer))) {
    throw new Error('EDITOR_PROJECT_LAYERS_INVALID')
  }
  let composite = emptyDrawing()
  layers.forEach((layer, layerIndex) => {
    if (!visibility[layerIndex]) return
    composite = composite.map((bottom, pixelIndex) => compositeDrawingPixel(bottom, layer[pixelIndex]))
  })
  return composite
}

export function composeEditorProjectFrame(project: EditorProjectDocument, frameIndex: number) {
  const frame = project.frames[frameIndex]
  if (!frame) throw new Error('EDITOR_PROJECT_FRAME_INVALID')
  return composeEditorProjectLayers(frame.layers, project.layerVisibility)
}

export function composeEditorProjectFrames(project: EditorProjectDocument) {
  return project.frames.map((_, index) => composeEditorProjectFrame(project, index))
}

export function editorProjectHasContent(project: EditorProjectDocument) {
  return project.frames.some(frame => frame.layers.some(layer =>
    layer.some(color => color !== 'transparent')))
}

export function editorProjectSerializedBytes(project: EditorProjectDocument) {
  return new TextEncoder().encode(JSON.stringify(project)).byteLength
}

export function replaceEditorProjectLayer(
  project: EditorProjectDocument,
  frameIndex: number,
  layerIndex: EditorProjectLayerIndex,
  pixels: string[],
) {
  if (!isValidEditorDrawingPixels(pixels) || !project.frames[frameIndex]) return cloneEditorProject(project)
  const next = cloneEditorProject(project)
  next.frames[frameIndex].layers[layerIndex] = [...pixels]
  next.exported = false
  return next
}

export function addEditorProjectFrame(project: EditorProjectDocument, duplicateCurrent: boolean) {
  if (project.frames.length >= EDITOR_PROJECT_FRAME_LIMIT) return cloneEditorProject(project)
  const next = cloneEditorProject(project)
  const source = duplicateCurrent
    ? next.frames[next.activeFrameIndex].layers
    : emptyEditorProjectLayers()
  next.frames.push({ layers: cloneEditorProjectLayers(source) })
  next.activeFrameIndex = next.frames.length - 1
  next.exported = false
  return next
}

export function deleteEditorProjectFrame(project: EditorProjectDocument, frameIndex: number) {
  if (project.frames.length <= 1 || !project.frames[frameIndex]) return cloneEditorProject(project)
  const next = cloneEditorProject(project)
  next.frames.splice(frameIndex, 1)
  next.activeFrameIndex = Math.min(next.activeFrameIndex, next.frames.length - 1)
  next.exported = false
  return next
}

export function moveEditorProjectLayer(
  project: EditorProjectDocument,
  from: EditorProjectLayerIndex,
  to: EditorProjectLayerIndex,
) {
  if (from === to) return cloneEditorProject(project)
  const next = cloneEditorProject(project)
  next.frames.forEach(frame => {
    const moved = frame.layers[from]
    frame.layers[from] = frame.layers[to]
    frame.layers[to] = moved
  })
  const movedVisibility = next.layerVisibility[from]
  next.layerVisibility[from] = next.layerVisibility[to]
  next.layerVisibility[to] = movedVisibility
  if (next.activeLayer === from) next.activeLayer = to
  else if (next.activeLayer === to) next.activeLayer = from
  next.exported = false
  return next
}

function drawingsEqual(first: string[], second: string[]) {
  return first.length === second.length && first.every((color, index) => color === second[index])
}

export function migrateEditorProject(
  serializedDrawing: string | null,
  serializedAnimation: string | null,
): EditorProjectDocument {
  try {
    const current = parseEditorProject(JSON.parse(serializedDrawing ?? 'null'))
    if (current) return current
  } catch { /* Fall through to the legacy formats. */ }

  const drawing = parseDrawingDraft(serializedDrawing)
  const drawingFrame: EditorProjectFrame = {
    layers: [[...drawing.layers[0]], [...drawing.layers[1]], emptyDrawing()],
  }
  let rawAnimation: unknown = null
  try { rawAnimation = JSON.parse(serializedAnimation ?? 'null') } catch { /* Ignore broken legacy animation. */ }
  const hasLegacyAnimation = isObject(rawAnimation) && Array.isArray(rawAnimation.frames)
  const legacyAnimation = hasLegacyAnimation ? normalizeEditorAnimation(rawAnimation) : null
  const animationFrames = legacyAnimation?.frames
    .map(frame => ({ layers: [[...frame], emptyDrawing(), emptyDrawing()] as EditorProjectLayers })) ?? []
  const drawingPixels = composeEditorProjectLayers(drawingFrame.layers, [
    drawing.layerVisibility[0],
    drawing.layerVisibility[1],
    true,
  ])
  const drawingHasContent = drawingPixels.some(color => color !== 'transparent')
  const animationHasContent = animationFrames.some(frame => frame.layers[0].some(color => color !== 'transparent'))
  const drawingDuplicatesFirstAnimation = Boolean(animationFrames[0]) &&
    drawingsEqual(drawingPixels, animationFrames[0].layers[0])
  const includeDrawingFrame = drawingHasContent && (!animationHasContent || !drawingDuplicatesFirstAnimation)
  const frames = animationHasContent
    ? [...(includeDrawingFrame ? [drawingFrame] : []), ...animationFrames].slice(0, EDITOR_PROJECT_FRAME_LIMIT)
    : [drawingFrame]

  return {
    activeFrameIndex: includeDrawingFrame ? 0 : Math.min(legacyAnimation?.activeFrameIndex ?? 0, frames.length - 1),
    activeLayer: includeDrawingFrame || !animationHasContent ? drawing.activeLayer : 0,
    exported: animationHasContent ? false : drawing.exported,
    fps: legacyAnimation?.fps ?? 4,
    frames,
    layerVisibility: animationHasContent && !includeDrawingFrame
      ? [true, true, true]
      : [drawing.layerVisibility[0], drawing.layerVisibility[1], true],
    onionSkin: legacyAnimation?.onionSkin ?? true,
    paletteSize: drawing.paletteSize,
    version: EDITOR_PROJECT_VERSION,
  }
}
