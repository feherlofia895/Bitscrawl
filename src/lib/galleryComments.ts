import type { Json } from '../types/database'
import { supabase } from './supabase'

export type GalleryKind = 'weekly' | 'monthly'
export type GallerySort = 'discovery' | 'likes' | 'newest'
export type CommentReactionKind = 'feed' | 'gallery'

export const CHALLENGE_GALLERY_PAGE_SIZE = 6
export const GALLERY_COMMENT_PAGE_SIZE = 20

export type GalleryComment = {
  authorAvatar: string[] | null
  author_name: string
  comment_id: number
  content: string
  created_at: string
  entry_id: number
  has_liked: boolean
  is_own: boolean
  like_count: number
}

export type GalleryCommentPage = {
  comments: GalleryComment[]
  totalCount: number
}

const messages: Record<string, string> = {
  GALLERY_COMMENT_INVALID: 'A komment 1–280 karakter hosszú lehet.',
  GALLERY_COMMENT_NOT_OWN: 'Csak a saját kommentedet szerkesztheted.',
  GALLERY_COMMENT_RATE_LIMIT: 'Várj két másodpercet a következő komment előtt.',
  GALLERY_KIND_INVALID: 'Ez a galéria nem érhető el.',
  COMMENT_KIND_INVALID: 'Ez a kommentreakció nem érhető el.',
  COMMENT_NOT_FOUND: 'Ez a komment már nem található.',
  COMMENT_PAGE_INVALID: 'Túl sok kommentreakciót próbáltál egyszerre betölteni.',
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

export function isMissingRpc(error: unknown, functionName: string) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' && message.includes(functionName)
}

export function legacyDiscoveryScore(entryId: number, authorName: string, seed: number) {
  let hash = (entryId * 2654435761) ^ seed
  for (const char of authorName) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

export async function hydrateCommentLikes(
  kind: CommentReactionKind,
  comments: Omit<GalleryComment, 'has_liked' | 'like_count'>[],
): Promise<GalleryComment[]> {
  if (!comments.length) return []
  // The RPC accepts at most 100 IDs; legacy/feed loaders may return more.
  if (comments.length > 100) {
    const hydrated: GalleryComment[] = []
    for (let offset = 0; offset < comments.length; offset += 100) {
      hydrated.push(...await hydrateCommentLikes(kind, comments.slice(offset, offset + 100)))
    }
    return hydrated
  }
  const { data, error } = await supabase.rpc('get_comment_like_states', {
    target_comment_ids: comments.map(comment => comment.comment_id),
    target_kind: kind,
  })
  if (error && isMissingRpc(error, 'get_comment_like_states')) {
    return comments.map(comment => ({ ...comment, has_liked: false, like_count: 0 }))
  }
  if (error) throw commentError(error)
  const states = new Map((data ?? []).map(state => [state.comment_id, state]))
  return comments.map(comment => {
    const state = states.get(comment.comment_id)
    return {
      ...comment,
      has_liked: state?.has_liked ?? false,
      like_count: Math.max(0, state?.like_count ?? 0),
    }
  })
}

export async function setCommentLike(kind: CommentReactionKind, commentId: number, enabled: boolean) {
  const { data, error } = await supabase.rpc('set_comment_like', {
    like_enabled: enabled,
    target_comment_id: commentId,
    target_kind: kind,
  }).single()
  if (error) throw commentError(error)
  return {
    liked: data.liked,
    likeCount: Math.max(0, data.active_like_count),
  }
}

export async function loadGalleryComments(kind: GalleryKind, challengeId: number) {
  const { data, error } = await supabase.rpc('get_gallery_comments', {
    target_challenge_id: challengeId,
    target_kind: kind,
  })
  if (error) throw commentError(error)
  return hydrateCommentLikes('gallery', data.map(comment => ({
    ...comment,
    authorAvatar: avatar(comment.author_avatar),
  })))
}

export async function loadGalleryCommentsForEntry(
  kind: GalleryKind,
  entryId: number,
  page = 1,
  fallbackChallengeId?: number,
): Promise<GalleryCommentPage> {
  const offset = Math.max(0, page - 1) * GALLERY_COMMENT_PAGE_SIZE
  const { data, error } = await supabase.rpc('get_gallery_comments_for_entry', {
    requested_limit: GALLERY_COMMENT_PAGE_SIZE,
    requested_offset: offset,
    target_entry_id: entryId,
    target_kind: kind,
  })
  if (error) {
    if (!isMissingRpc(error, 'get_gallery_comments_for_entry') || fallbackChallengeId === undefined) {
      throw commentError(error)
    }
    const allComments = (await loadGalleryComments(kind, fallbackChallengeId))
      .filter(comment => comment.entry_id === entryId)
      .sort((first, second) => Date.parse(second.created_at) - Date.parse(first.created_at) || second.comment_id - first.comment_id)
    return {
      comments: allComments.slice(offset, offset + GALLERY_COMMENT_PAGE_SIZE),
      totalCount: allComments.length,
    }
  }
  return {
    comments: await hydrateCommentLikes('gallery', data.map(comment => ({
      ...comment,
      authorAvatar: avatar(comment.author_avatar),
    }))),
    totalCount: Number(data[0]?.total_count ?? 0),
  }
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
