import type { Json } from '../types/database'
import type { EditorPaletteSize } from './palette'
import { editorPalette32 } from './palette'
import { supabase } from './supabase'

export type EditorGallerySlotIndex = 1 | 2

export type EditorGallerySlot = {
  paletteSize: EditorPaletteSize
  pixels: string[]
  slotIndex: EditorGallerySlotIndex
  updatedAt: string
}

const editorColors = new Set(['transparent', ...editorPalette32.map(color => color.hex)])

function parsePixels(value: Json): string[] | null {
  return Array.isArray(value) && value.length === 1024 &&
    value.every(color => typeof color === 'string' && editorColors.has(color))
    ? value as string[]
    : null
}

function galleryError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A saját galéria művelete nem sikerült.'
  if (raw.includes('EDITOR_GALLERY_SLOT_INVALID')) return new Error('Csak a saját galéria két helyére menthetsz.')
  if (raw.includes('EDITOR_GALLERY_DRAWING_INVALID')) return new Error('Üres vagy hibás rajz nem menthető a saját galériába.')
  if (raw.includes('WEEKLY_ACCOUNT_REQUIRED')) return new Error('A saját galériához jelentkezz be.')
  if (raw.includes('WEEKLY_PROFILE_REQUIRED')) return new Error('Előbb mentsd el a profilodat.')
  return new Error(raw)
}

export function editorGalleryEndpointIsMissing(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' || code === 'PGRST204' ||
    /get_own_editor_gallery|save_own_editor_gallery_slot|delete_own_editor_gallery_slot|schema cache/i.test(message)
}

export async function loadOwnEditorGallery(): Promise<EditorGallerySlot[]> {
  const { data, error } = await supabase.rpc('get_own_editor_gallery')
  if (error) throw galleryError(error)

  return (data ?? []).map(row => {
    const pixels = parsePixels(row.pixels)
    if (!pixels || (row.slot_index !== 1 && row.slot_index !== 2) ||
      (row.palette_size !== 12 && row.palette_size !== 32)) {
      throw new Error('A saját galéria mentett rajza megsérült.')
    }
    return {
      paletteSize: row.palette_size,
      pixels,
      slotIndex: row.slot_index,
      updatedAt: row.updated_at,
    }
  })
}

export async function saveOwnEditorGallerySlot(
  slotIndex: EditorGallerySlotIndex,
  pixels: string[],
  paletteSize: EditorPaletteSize,
) {
  const { data, error } = await supabase.rpc('save_own_editor_gallery_slot', {
    drawing_pixels: pixels,
    requested_palette_size: paletteSize,
    target_slot: slotIndex,
  })
  if (error) throw galleryError(error)
  return data
}

export async function deleteOwnEditorGallerySlot(slotIndex: EditorGallerySlotIndex) {
  const { data, error } = await supabase.rpc('delete_own_editor_gallery_slot', { target_slot: slotIndex })
  if (error) throw galleryError(error)
  return data
}
