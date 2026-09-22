import type { Json } from '../types/database'
import { editorPalette32 } from './palette'
import { supabase } from './supabase'
import type { GalleryComment, GallerySort } from './galleryComments'

export const FEED_PAGE_SIZE = 6
export const FEED_DESCRIPTION_MAX_LENGTH = 160
export const FEED_DESCRIPTION_MAX_LINES = 3

export type DailyFeedPost = {
  authorAvatar: string[] | null
  author_name: string
  author_received_likes: number
  comments: GalleryComment[]
  created_at: string
  description: string
  has_liked: boolean
  is_own: boolean
  like_count: number
  pixels: string[]
  post_date: string
  post_id: number
  updated_at: string
}

export type DailyFeedPage = {
  posts: DailyFeedPost[]
  totalCount: number
}

export type DailyFeedAccountState = {
  postDate: string | null
  postId: number | null
  postPixels: string[] | null
  profileName: string
  receivedLikeCount: number
  todayPostCount: number
}

export type OwnFeedStats = {
  postCount: number
  receivedLikeCount: number
}

const validColors = new Set(['transparent', ...editorPalette32.map(color => color.hex)])

const messages: Record<string, string> = {
  FEED_DRAWING_INVALID: 'A megosztáshoz készíts egy érvényes, nem üres 32×32-es rajzot.',
  FEED_DAILY_LIMIT: 'Ma már két képet tettél közzé. Töröld az egyiket, ha újat szeretnél feltölteni.',
  FEED_DESCRIPTION_INVALID: 'A képleírás legfeljebb 160 karakter és maximum 3 sor lehet.',
  FEED_OWN_LIKE_FORBIDDEN: 'A saját rajzodat nem kedvelheted.',
  FEED_PAGE_INVALID: 'Ez a hírfolyamoldal nem érhető el.',
  FEED_SORT_INVALID: 'Ez a hírfolyam-rendezés nem érhető el.',
  FEED_POST_NOT_OWN: 'Csak a saját mai hírfolyamképedet módosíthatod vagy törölheted.',
  FEED_POST_NOT_FOUND: 'Ez a hírfolyam-bejegyzés már nem érhető el.',
  GALLERY_COMMENT_INVALID: 'A komment 1–280 karakter hosszú lehet.',
  GALLERY_COMMENT_NOT_OWN: 'Csak a saját kommentedet szerkesztheted.',
  GALLERY_COMMENT_RATE_LIMIT: 'Várj két másodpercet a következő komment előtt.',
  WEEKLY_ACCOUNT_REQUIRED: 'Ehhez regisztrált, bejelentkezett fiók szükséges.',
  WEEKLY_PROFILE_REQUIRED: 'Előbb válassz megjelenített nevet.',
}

function feedError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A hírfolyam művelete nem sikerült.'
  const code = Object.keys(messages).find(key => raw.includes(key))
  return new Error(code ? messages[code] : raw)
}

export function parseFeedPixels(value: Json | null): string[] | null {
  return Array.isArray(value) && value.length === 1024 &&
    value.every(color => typeof color === 'string' && validColors.has(color))
    ? value as string[]
    : null
}

export function limitFeedDescription(value: string) {
  return value.replace(/\r\n?/g, '\n').split('\n').slice(0, FEED_DESCRIPTION_MAX_LINES).join('\n').slice(0, FEED_DESCRIPTION_MAX_LENGTH)
}

function parseAvatar(value: Json | null): string[] | null {
  return Array.isArray(value) && value.length === 1024 && value.every(color => typeof color === 'string')
    ? value as string[]
    : null
}

export async function loadDailyFeed(page: number, sort: GallerySort = 'newest', discoverySeed = 0): Promise<DailyFeedPage> {
  const offset = Math.max(0, page - 1) * FEED_PAGE_SIZE
  let { data, error } = await supabase.rpc('get_daily_feed_page', {
    discovery_seed: discoverySeed,
    requested_limit: FEED_PAGE_SIZE,
    requested_offset: offset,
    requested_sort: sort,
  })
  if (error && /get_daily_feed_page|schema cache/i.test(error.message)) {
    const fallback = await supabase.rpc('get_daily_feed', {
      requested_limit: FEED_PAGE_SIZE,
      requested_offset: offset,
    })
    data = fallback.data
    error = fallback.error
  }
  if (error) throw feedError(error)
  if (!data) throw new Error('A hírfolyam most nem érhető el.')

  const postIds = data.map(post => post.post_id)
  const comments = postIds.length ? await loadDailyFeedComments(postIds) : []
  return {
    posts: data.map(post => ({
      ...post,
      authorAvatar: parseAvatar(post.author_avatar),
      comments: comments.filter(comment => comment.entry_id === post.post_id),
      pixels: parseFeedPixels(post.pixels) ?? [],
    })),
    totalCount: Number(data[0]?.total_count ?? 0),
  }
}

export async function loadDailyFeedAccountState(): Promise<DailyFeedAccountState> {
  const { data, error } = await supabase.rpc('get_daily_feed_account_state').single()
  if (error) throw feedError(error)
  return {
    postDate: data.post_date,
    postId: data.post_id,
    postPixels: parseFeedPixels(data.post_pixels),
    profileName: data.profile_name,
    receivedLikeCount: data.received_like_count,
    todayPostCount: data.today_post_count,
  }
}

export async function publishDailyFeedPost(pixels: string[], targetPostId: number | null = null, description = '') {
  const { data, error } = await supabase.rpc('publish_daily_feed_post', {
    drawing_pixels: pixels,
    requested_description: description,
    target_post_id: targetPostId,
  })
  if (error) throw feedError(error)
  return data
}

export async function deleteOwnDailyFeedPost(postId: number) {
  const { data, error } = await supabase.rpc('delete_own_daily_feed_post', { target_post_id: postId })
  if (error) throw feedError(error)
  return data
}

export async function setDailyFeedLike(postId: number, enabled: boolean) {
  const { data, error } = await supabase.rpc('set_daily_feed_like', {
    like_enabled: enabled,
    target_post_id: postId,
  }).single()
  if (error) throw feedError(error)
  return data
}

export async function loadDailyFeedComments(postIds: number[]) {
  const { data, error } = await supabase.rpc('get_daily_feed_comments', { target_post_ids: postIds })
  if (error) throw feedError(error)
  return data.map(comment => ({
    ...comment,
    authorAvatar: parseAvatar(comment.author_avatar),
  })) as GalleryComment[]
}

export async function addDailyFeedComment(postId: number, content: string) {
  const { data, error } = await supabase.rpc('add_daily_feed_comment', {
    requested_content: content,
    target_post_id: postId,
  })
  if (error) throw feedError(error)
  return data
}

export async function updateDailyFeedComment(commentId: number, content: string) {
  const { data, error } = await supabase.rpc('update_daily_feed_comment', {
    requested_content: content,
    target_comment_id: commentId,
  })
  if (error) throw feedError(error)
  return data
}

export async function loadOwnFeedStats(): Promise<OwnFeedStats> {
  const { data, error } = await supabase.rpc('get_own_feed_stats').single()
  if (error) throw feedError(error)
  return { postCount: data.post_count, receivedLikeCount: data.received_like_count }
}
