import type { Json } from '../types/database'
import { isHexColor } from './colorMixer'
import { supabase } from './supabase'
import { getWeeklyUser } from './weekly'

export const EDITOR_PALETTE_COLOR_LIMIT = 16
export const EDITOR_PALETTE_SLOT_COUNT = 3
export const EDITOR_PALETTES_STORAGE_KEY = 'bitscrawl-editor-palettes-v1'
const LEGACY_COLORS_STORAGE_KEY = 'bitscrawl-editor-custom-palette-v1'

export type EditorPaletteSlotIndex = 1 | 2 | 3

export type EditorCustomPalette = {
  colors: string[]
  name: string
  slotIndex: EditorPaletteSlotIndex
  updatedAt: string | null
}

export type EditorPaletteStorage = 'cloud' | 'local'

function defaultName(slotIndex: EditorPaletteSlotIndex) {
  return `Saját paletta ${slotIndex}`
}

export function sanitizeEditorPaletteColors(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.reduce<string[]>((colors, item) => {
    if (typeof item !== 'string' || !isHexColor(item)) return colors
    const color = item.toLowerCase()
    if (seen.has(color) || colors.length >= EDITOR_PALETTE_COLOR_LIMIT) return colors
    seen.add(color)
    colors.push(color)
    return colors
  }, [])
}

export function sanitizeEditorPaletteName(value: unknown, slotIndex: EditorPaletteSlotIndex) {
  if (typeof value !== 'string') return defaultName(slotIndex)
  const clean = value.trim().replace(/\s+/g, ' ').slice(0, 24)
  return clean || defaultName(slotIndex)
}

export function emptyEditorPalettes(): EditorCustomPalette[] {
  return ([1, 2, 3] as EditorPaletteSlotIndex[]).map(slotIndex => ({
    colors: [],
    name: defaultName(slotIndex),
    slotIndex,
    updatedAt: null,
  }))
}

function parsePalette(value: unknown): EditorCustomPalette | null {
  if (!value || typeof value !== 'object') return null
  const slotIndex = 'slotIndex' in value ? Number(value.slotIndex) : NaN
  if (slotIndex !== 1 && slotIndex !== 2 && slotIndex !== 3) return null
  return {
    colors: sanitizeEditorPaletteColors('colors' in value ? value.colors : []),
    name: sanitizeEditorPaletteName('name' in value ? value.name : '', slotIndex),
    slotIndex,
    updatedAt: 'updatedAt' in value && typeof value.updatedAt === 'string' ? value.updatedAt : null,
  }
}

export function mergeEditorPalettes(value: unknown) {
  const palettes = emptyEditorPalettes()
  if (!Array.isArray(value)) return palettes
  value.forEach(item => {
    const parsed = parsePalette(item)
    if (parsed) palettes[parsed.slotIndex - 1] = parsed
  })
  return palettes
}

export function loadLocalEditorPalettes() {
  try {
    const current = localStorage.getItem(EDITOR_PALETTES_STORAGE_KEY)
    if (current) return mergeEditorPalettes(JSON.parse(current))

    const legacy = sanitizeEditorPaletteColors(JSON.parse(localStorage.getItem(LEGACY_COLORS_STORAGE_KEY) ?? '[]'))
    const migrated = emptyEditorPalettes()
    migrated[0].colors = legacy
    saveLocalEditorPalettes(migrated)
    return migrated
  } catch {
    return emptyEditorPalettes()
  }
}

export function saveLocalEditorPalettes(palettes: EditorCustomPalette[]) {
  try {
    localStorage.setItem(EDITOR_PALETTES_STORAGE_KEY, JSON.stringify(mergeEditorPalettes(palettes)))
    return true
  } catch {
    return false
  }
}

function paletteError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A saját paletta mentése nem sikerült.'
  if (raw.includes('EDITOR_PALETTE_SLOT_INVALID')) return new Error('Ez a saját palettahely nem érhető el.')
  if (raw.includes('EDITOR_PALETTE_NAME_INVALID')) return new Error('A paletta neve legfeljebb 24 karakter lehet.')
  if (raw.includes('EDITOR_PALETTE_COLORS_INVALID')) return new Error('Egy palettára legfeljebb 16 érvényes szín menthető.')
  if (raw.includes('WEEKLY_PROFILE_REQUIRED')) return new Error('A profilszinkronhoz előbb mentsd el a profilodat.')
  return new Error(raw)
}

export function editorPaletteEndpointIsMissing(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' || code === 'PGRST204' ||
    /get_own_editor_palettes|save_own_editor_palette|delete_own_editor_palette|schema cache/i.test(message)
}

function rowsToPalettes(rows: Array<{
  colors: Json
  name: string
  slot_index: number
  updated_at: string
}>) {
  return mergeEditorPalettes(rows.map(row => ({
    colors: row.colors,
    name: row.name,
    slotIndex: row.slot_index,
    updatedAt: row.updated_at,
  })))
}

export async function loadOwnEditorPalettes(): Promise<{
  palettes: EditorCustomPalette[]
  storage: EditorPaletteStorage
}> {
  const local = loadLocalEditorPalettes()
  if (!await getWeeklyUser()) return { palettes: local, storage: 'local' }

  const { data, error } = await supabase.rpc('get_own_editor_palettes')
  if (error) {
    if (editorPaletteEndpointIsMissing(error)) return { palettes: local, storage: 'local' }
    throw paletteError(error)
  }
  const remoteRows = data ?? []
  const remoteSlots = new Set(remoteRows.map(row => row.slot_index))
  const localOnly = local.filter(palette => !remoteSlots.has(palette.slotIndex) && (
    palette.colors.length > 0 || palette.name !== defaultName(palette.slotIndex)
  ))
  for (const palette of localOnly) {
    const { error: syncError } = await supabase.rpc('save_own_editor_palette', {
      palette_colors: palette.colors,
      requested_name: palette.name,
      target_slot: palette.slotIndex,
    })
    if (syncError) throw paletteError(syncError)
  }
  const palettes = rowsToPalettes([
    ...remoteRows,
    ...localOnly.map(palette => ({
      colors: palette.colors,
      name: palette.name,
      slot_index: palette.slotIndex,
      updated_at: new Date().toISOString(),
    })),
  ])
  saveLocalEditorPalettes(palettes)
  return { palettes, storage: 'cloud' }
}

export async function saveOwnEditorPalette(palette: EditorCustomPalette): Promise<EditorPaletteStorage> {
  const palettes = loadLocalEditorPalettes()
  const normalized = {
    ...palette,
    colors: sanitizeEditorPaletteColors(palette.colors),
    name: sanitizeEditorPaletteName(palette.name, palette.slotIndex),
  }
  palettes[palette.slotIndex - 1] = normalized
  saveLocalEditorPalettes(palettes)
  if (!await getWeeklyUser()) return 'local'

  const { error } = await supabase.rpc('save_own_editor_palette', {
    palette_colors: normalized.colors,
    requested_name: normalized.name,
    target_slot: normalized.slotIndex,
  })
  if (error) {
    if (editorPaletteEndpointIsMissing(error)) return 'local'
    throw paletteError(error)
  }
  return 'cloud'
}

export async function deleteOwnEditorPalette(slotIndex: EditorPaletteSlotIndex): Promise<EditorPaletteStorage> {
  const palettes = loadLocalEditorPalettes()
  palettes[slotIndex - 1] = emptyEditorPalettes()[slotIndex - 1]
  saveLocalEditorPalettes(palettes)
  if (!await getWeeklyUser()) return 'local'

  const { error } = await supabase.rpc('delete_own_editor_palette', { target_slot: slotIndex })
  if (error) {
    if (editorPaletteEndpointIsMissing(error)) return 'local'
    throw paletteError(error)
  }
  return 'cloud'
}
