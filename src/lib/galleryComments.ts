import type { Json } from '../types/database'
import { supabase } from './supabase'

export type GalleryKind = 'weekly' | 'monthly'

export type GalleryComment = {
  authorAvatar: string[] | null
  author_name: string
  comment_id: number
  content: string
  created_at: string
  entry_id: number
  is_own: boolean
}

const messages: Record<string, string> = {
  GALLERY_COMMENT_INVALID: 'A komment 1–280 karakter hosszú lehet.',
  GALLERY_COMMENT_NOT_OWN: 'Csak a saját kommentedet szerkesztheted.',
  GALLERY_KIND_INVALID: 'Ez a galéria nem érhető el.',
  MONTHLY_ENTRY_NOT_FOUND: 'Ez a havi rajz még nem kommentelhető.',
  WEEKLY_ACCOUNT_REQUIRED: 'Kommenteléshez jelentkezz be.',
  WEEKLY_ENTRY_NOT_FOUND: 'Ez a heti rajz már nem érhető el.',
  WEEKLY_PROFILE_REQUIRED: 'Kommentelés előtt válassz megjelenített nevet.',
}

function commentError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A komment művelete nem sikerült.'
  const code = Object.keys(messages).find(key => raw.includes(key))
  return new Error(code ? messages[code] : raw)
}

function avatar(value: Json | null): string[] | null {
  return Array.isArray(value) && value.length === 1024 && value.every(item => typeof item === 'string')
    ? value as string[]
    : null
}

export async function loadGalleryComments(kind: GalleryKind, challengeId: number) {
  const { data, error } = await supabase.rpc('get_gallery_comments', {
    target_challenge_id: challengeId,
    target_kind: kind,
  })
  if (error) throw commentError(error)
  return data.map(comment => ({
    ...comment,
    authorAvatar: avatar(comment.author_avatar),
  })) as GalleryComment[]
}

export async function addGalleryComment(kind: GalleryKind, entryId: number, content: string) {
  const { data, error } = await supabase.rpc('add_gallery_comment', {
    requested_content: content,
    target_entry_id: entryId,
    target_kind: kind,
  })
  if (error) throw commentError(error)
  return data
}

export async function updateGalleryComment(commentId: number, content: string) {
  const { data, error } = await supabase.rpc('update_gallery_comment', {
    requested_content: content,
    target_comment_id: commentId,
  })
  if (error) throw commentError(error)
  return data
}
