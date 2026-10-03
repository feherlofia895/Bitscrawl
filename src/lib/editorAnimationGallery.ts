import type { Json } from '../types/database'
import { isValidEditorDrawingPixels } from './drawing'
import {
  EDITOR_ANIMATION_FRAME_LIMIT,
  EDITOR_ANIMATION_MAX_FPS,
  EDITOR_ANIMATION_MIN_FPS,
} from './editorAnimation'
import { supabase } from './supabase'

export type EditorAnimationSlotIndex = 1 | 2

export type EditorAnimationGallerySlot = {
  fps: number
  frames: string[][]
  slotIndex: EditorAnimationSlotIndex
  updatedAt: string
}

function parseFrames(value: Json): string[][] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > EDITOR_ANIMATION_FRAME_LIMIT) return null
  const frames = value.filter((frame): frame is string[] => isValidEditorDrawingPixels(frame))
  return frames.length === value.length ? frames.map(frame => [...frame]) : null
}

function animationGalleryError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'Az animációs galéria művelete nem sikerült.'
  if (raw.includes('EDITOR_ANIMATION_SLOT_INVALID')) return new Error('Csak az animációs galéria két helyére menthetsz.')
  if (raw.includes('EDITOR_ANIMATION_FPS_INVALID')) return new Error('Az animáció sebessége 1 és 8 kép/mp között lehet.')
  if (raw.includes('EDITOR_ANIMATION_INVALID')) return new Error('Üres vagy hibás animáció nem menthető.')
  if (raw.includes('WEEKLY_ACCOUNT_REQUIRED')) return new Error('Az animációs galériához jelentkezz be.')
  if (raw.includes('WEEKLY_PROFILE_REQUIRED')) return new Error('Előbb mentsd el a profilodat.')
  return new Error(raw)
}

export function editorAnimationGalleryEndpointIsMissing(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' || code === 'PGRST204' ||
    /get_own_editor_animations|save_own_editor_animation_slot|delete_own_editor_animation_slot|schema cache/i.test(message)
}

export async function loadOwnEditorAnimations(): Promise<EditorAnimationGallerySlot[]> {
  const { data, error } = await supabase.rpc('get_own_editor_animations')
  if (error) throw animationGalleryError(error)

  return (data ?? []).map(row => {
    const frames = parseFrames(row.frames)
    if (!frames || (row.slot_index !== 1 && row.slot_index !== 2) ||
      !Number.isInteger(row.fps) || row.fps < EDITOR_ANIMATION_MIN_FPS || row.fps > EDITOR_ANIMATION_MAX_FPS) {
      throw new Error('Az animációs galéria egyik mentése megsérült.')
    }
    return {
      fps: row.fps,
      frames,
      slotIndex: row.slot_index,
      updatedAt: row.updated_at,
    }
  })
}

export async function saveOwnEditorAnimationSlot(
  slotIndex: EditorAnimationSlotIndex,
  frames: string[][],
  fps: number,
) {
  const { data, error } = await supabase.rpc('save_own_editor_animation_slot', {
    animation_frames: frames,
    requested_fps: fps,
    target_slot: slotIndex,
  })
  if (error) throw animationGalleryError(error)
  return data
}

export async function deleteOwnEditorAnimationSlot(slotIndex: EditorAnimationSlotIndex) {
  const { data, error } = await supabase.rpc('delete_own_editor_animation_slot', { target_slot: slotIndex })
  if (error) throw animationGalleryError(error)
  return data
}
