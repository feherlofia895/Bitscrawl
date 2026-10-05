import type { Json } from '../types/database'
import {
  cloneEditorProject,
  composeEditorProjectFrames,
  EDITOR_PROJECT_MAX_BYTES,
  EDITOR_PROJECT_SLOT_LIMIT,
  editorProjectHasContent,
  editorProjectSerializedBytes,
  parseEditorProject,
  type EditorProjectDocument,
} from './editorProject'
import { supabase } from './supabase'

export type EditorProjectSlotIndex = 1 | 2 | 3 | 4

export type EditorProjectSlot = {
  document: EditorProjectDocument
  previewFrames: string[][]
  slotIndex: EditorProjectSlotIndex
  updatedAt: string
}

function projectError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A Saját projektek művelete nem sikerült.'
  if (raw.includes('EDITOR_PROJECT_SLOT_INVALID')) return new Error('Csak a négy Saját projekt helyére menthetsz.')
  if (raw.includes('EDITOR_PROJECT_DOCUMENT_INVALID')) return new Error('Az üres, hibás vagy túl nagy projekt nem menthető.')
  if (raw.includes('WEEKLY_ACCOUNT_REQUIRED')) return new Error('A Saját projektekhez jelentkezz be.')
  if (raw.includes('WEEKLY_PROFILE_REQUIRED')) return new Error('Előbb mentsd el a profilodat.')
  return new Error(raw)
}

export function editorProjectsEndpointIsMissing(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' || code === 'PGRST204' ||
    /get_own_editor_projects|save_own_editor_project|delete_own_editor_project|schema cache/i.test(message)
}

function parseSlotIndex(value: unknown): EditorProjectSlotIndex | null {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= EDITOR_PROJECT_SLOT_LIMIT
    ? value as EditorProjectSlotIndex
    : null
}

export async function loadOwnEditorProjects(): Promise<EditorProjectSlot[]> {
  const { data, error } = await supabase.rpc('get_own_editor_projects')
  if (error) throw projectError(error)

  return (data ?? []).map(row => {
    const document = parseEditorProject(row.document)
    const slotIndex = parseSlotIndex(row.slot_index)
    if (!document || !slotIndex || editorProjectSerializedBytes(document) > EDITOR_PROJECT_MAX_BYTES) {
      throw new Error('A Saját projektek egyik mentése megsérült.')
    }
    return {
      document,
      previewFrames: composeEditorProjectFrames(document),
      slotIndex,
      updatedAt: row.updated_at,
    }
  })
}

export async function saveOwnEditorProject(
  slotIndex: EditorProjectSlotIndex,
  document: EditorProjectDocument,
) {
  const snapshot = cloneEditorProject(document)
  if (!editorProjectHasContent(snapshot) || editorProjectSerializedBytes(snapshot) > EDITOR_PROJECT_MAX_BYTES) {
    throw new Error('Az üres, hibás vagy túl nagy projekt nem menthető.')
  }
  const { data, error } = await supabase.rpc('save_own_editor_project', {
    project_document: snapshot as unknown as Json,
    target_slot: slotIndex,
  })
  if (error) throw projectError(error)
  return data
}

export async function deleteOwnEditorProject(slotIndex: EditorProjectSlotIndex) {
  const { data, error } = await supabase.rpc('delete_own_editor_project', { target_slot: slotIndex })
  if (error) throw projectError(error)
  return data
}
