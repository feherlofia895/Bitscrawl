import type { User } from '@supabase/supabase-js'
import type { Json } from '../types/database'
import { editorPalette32 } from './palette'
import { loadOwnFeedStats } from './feed'
import { supabase } from './supabase'
import { getWeeklyUser } from './weekly'

export type PlayerProfile = {
  avatarPixels: string[] | null
  displayName: string
  feedPostCount: number
  receivedLikes: number
}

export type ProfileAvatarSaveResult = {
  pixels: string[]
  storage: 'cloud' | 'local'
}

export type ProfileAvatarLikeState = {
  canLike: boolean
  likeCount: number
  liked: boolean
}

const validAvatarColors = new Set(['transparent', ...editorPalette32.map(color => color.hex)])
const avatarStoragePrefix = 'bitscrawl-profile-avatar:'

function localAvatarKey(userId: string) {
  return `${avatarStoragePrefix}${userId}`
}

function loadLocalAvatar(userId: string) {
  try {
    const stored = window.localStorage.getItem(localAvatarKey(userId))
    return stored ? parseAvatarPixels(JSON.parse(stored) as Json) : null
  } catch {
    return null
  }
}

function saveLocalAvatar(userId: string, pixels: string[]) {
  window.localStorage.setItem(localAvatarKey(userId), JSON.stringify(pixels))
}

function avatarEndpointIsMissing(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || error.code === 'PGRST204' ||
    Boolean(error.message?.includes('set_profile_avatar')) ||
    Boolean(error.message?.includes('avatar_pixels'))
}

function avatarLikeEndpointIsMissing(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' ||
    Boolean(error.message?.includes('get_profile_avatar_like_state')) ||
    Boolean(error.message?.includes('set_profile_avatar_like'))
}

export function parseAvatarPixels(value: Json | null): string[] | null {
  return Array.isArray(value) && value.length === 1024 &&
    value.every(color => typeof color === 'string' && validAvatarColors.has(color))
    ? value as string[]
    : null
}

function profileError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A profilművelet nem sikerült.'
  if (raw.includes('PROFILE_AVATAR_INVALID')) return new Error('A profilkép adatai nem érvényesek.')
  if (raw.includes('PROFILE_AVATAR_MISSING')) return new Error('Ezt a profilt még nem lehet kedvelni, mert nincs profilképe.')
  if (raw.includes('PROFILE_AVATAR_SELF_LIKE')) return new Error('A saját profilképedet nem kedvelheted.')
  if (raw.includes('PROFILE_NOT_FOUND')) return new Error('Ez a profil már nem található.')
  if (raw.includes('WEEKLY_ACCOUNT_REQUIRED')) return new Error('A kedveléshez jelentkezz be.')
  if (raw.includes('WEEKLY_PROFILE_REQUIRED')) return new Error('Előbb mentsd el a megjelenített nevedet.')
  return new Error(raw)
}

export async function loadOwnProfile(): Promise<{ profile: PlayerProfile | null; user: User | null }> {
  const user = await getWeeklyUser()
  if (!user) return { profile: null, user: null }

  let { data, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_pixels')
    .eq('user_id', user.id)
    .maybeSingle()

  // The fallback keeps the current live database usable until the migration is deployed.
  if (error?.message.includes('avatar_pixels')) {
    const legacy = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle()
    data = legacy.data ? { ...legacy.data, avatar_pixels: null } : null
    error = legacy.error
  }

  if (error) throw profileError(error)
  const feedStats = data
    ? await loadOwnFeedStats().catch(() => ({ postCount: 0, receivedLikeCount: 0 }))
    : { postCount: 0, receivedLikeCount: 0 }
  return {
    profile: data ? {
      avatarPixels: parseAvatarPixels(data.avatar_pixels) ?? loadLocalAvatar(user.id),
      displayName: data.display_name,
      feedPostCount: feedStats.postCount,
      receivedLikes: feedStats.receivedLikeCount,
    } : null,
    user,
  }
}

export async function saveProfileAvatar(pixels: string[]): Promise<ProfileAvatarSaveResult> {
  if (!parseAvatarPixels(pixels as Json)) throw new Error('A profilkép adatai nem érvényesek.')
  const user = await getWeeklyUser()
  if (!user) throw new Error('A profilkép mentéséhez jelentkezz be.')
  const { data, error } = await supabase.rpc('set_profile_avatar', { requested_pixels: pixels })
  if (error && !avatarEndpointIsMissing(error)) throw profileError(error)

  saveLocalAvatar(user.id, pixels)
  if (error) return { pixels, storage: 'local' }

  return {
    pixels: parseAvatarPixels(data) ?? pixels,
    storage: 'cloud',
  }
}

export async function loadProfileAvatarLikeState(name: string): Promise<ProfileAvatarLikeState> {
  const { data, error } = await supabase.rpc('get_profile_avatar_like_state', {
    target_profile_name: name,
  })
  if (error && avatarLikeEndpointIsMissing(error)) {
    return { canLike: false, liked: false, likeCount: 0 }
  }
  if (error) throw profileError(error)
  const state = data[0]
  return {
    canLike: state?.can_like ?? false,
    liked: state?.liked ?? false,
    likeCount: Math.max(0, state?.like_count ?? 0),
  }
}

export async function setProfileAvatarLike(name: string, enabled: boolean): Promise<ProfileAvatarLikeState> {
  const { data, error } = await supabase.rpc('set_profile_avatar_like', {
    like_enabled: enabled,
    target_profile_name: name,
  })
  if (error) throw profileError(error)
  const state = data[0]
  return {
    canLike: true,
    liked: state?.liked ?? false,
    likeCount: Math.max(0, state?.like_count ?? 0),
  }
}
