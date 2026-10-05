import { emptyDrawing, isValidEditorDrawingPixels } from './drawing.ts'

export const EDITOR_ANIMATION_STORAGE_KEY = 'bitscrawl-editor-animation-v1'
export const EDITOR_ANIMATION_FRAME_LIMIT = 5
export const EDITOR_ANIMATION_MIN_FPS = 1
export const EDITOR_ANIMATION_MAX_FPS = 8

export type EditorAnimationDraft = {
  activeFrameIndex: number
  fps: number
  frames: string[][]
  onionSkin: boolean
}

function cloneFrame(pixels: string[]) {
  return [...pixels]
}

export function normalizeEditorAnimation(
  value: unknown,
  fallbackPixels = emptyDrawing(),
): EditorAnimationDraft {
  const source = value && typeof value === 'object' ? value : null
  const rawFrames = source && 'frames' in source && Array.isArray(source.frames)
    ? source.frames
    : []
  const frames = rawFrames
    .filter((frame): frame is string[] => isValidEditorDrawingPixels(frame))
    .slice(0, EDITOR_ANIMATION_FRAME_LIMIT)
    .map(cloneFrame)
  const safeFrames = frames.length > 0
    ? frames
    : [isValidEditorDrawingPixels(fallbackPixels) ? cloneFrame(fallbackPixels) : emptyDrawing()]
  const requestedIndex = source && 'activeFrameIndex' in source
    ? Number(source.activeFrameIndex)
    : 0
  const requestedFps = source && 'fps' in source ? Number(source.fps) : 4

  return {
    activeFrameIndex: Number.isInteger(requestedIndex)
      ? Math.max(0, Math.min(safeFrames.length - 1, requestedIndex))
      : 0,
    fps: Number.isFinite(requestedFps)
      ? Math.max(EDITOR_ANIMATION_MIN_FPS, Math.min(EDITOR_ANIMATION_MAX_FPS, Math.round(requestedFps)))
      : 4,
    frames: safeFrames,
    onionSkin: Boolean(source && 'onionSkin' in source ? source.onionSkin : true),
  }
}

export function loadEditorAnimation(fallbackPixels = emptyDrawing()) {
  try {
    return normalizeEditorAnimation(
      JSON.parse(localStorage.getItem(EDITOR_ANIMATION_STORAGE_KEY) ?? 'null'),
      fallbackPixels,
    )
  } catch {
    return normalizeEditorAnimation(null, fallbackPixels)
  }
}

export function saveEditorAnimation(draft: EditorAnimationDraft) {
  const normalized = normalizeEditorAnimation(draft)
  try {
    localStorage.setItem(EDITOR_ANIMATION_STORAGE_KEY, JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

export function replaceAnimationFrame(frames: string[][], index: number, pixels: string[]) {
  if (!isValidEditorDrawingPixels(pixels) || index < 0 || index >= frames.length) return frames.map(cloneFrame)
  return frames.map((frame, frameIndex) => frameIndex === index ? cloneFrame(pixels) : cloneFrame(frame))
}

export function addAnimationFrame(frames: string[][], pixels = emptyDrawing()) {
  if (frames.length >= EDITOR_ANIMATION_FRAME_LIMIT || !isValidEditorDrawingPixels(pixels)) {
    return frames.map(cloneFrame)
  }
  return [...frames.map(cloneFrame), cloneFrame(pixels)]
}

export function deleteAnimationFrame(frames: string[][], index: number) {
  if (frames.length <= 1 || index < 0 || index >= frames.length) return frames.map(cloneFrame)
  return frames.filter((_, frameIndex) => frameIndex !== index).map(cloneFrame)
}

export function nextAnimationFrame(index: number, frameCount: number) {
  if (frameCount <= 0) return 0
  return (index + 1) % frameCount
}
