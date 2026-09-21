import type { User } from '@supabase/supabase-js'
import type { Json } from '../types/database'
import { supabase } from './supabase'
import {
  CHALLENGE_GALLERY_PAGE_SIZE,
  isMissingRpc,
  legacyDiscoveryScore,
  loadGalleryComments,
  type GallerySort,
} from './galleryComments'

export type WeeklyChallenge = {
  challenge_id: number
  challenge_status: 'active' | 'closed' | 'upcoming'
  description: string | null
  ends_at: string
  prompt: string
  server_now: string
  starts_at: string
  week_key: string
}

export type WeeklyGalleryEntry = {
  authorAvatar: string[] | null
  author_name: string
  comment_count: number
  entry_id: number
  has_voted: boolean
  is_own: boolean
  is_winner: boolean
  pixels: string[]
  submitted_at: string
  vote_count: number
}

export type WeeklyGalleryPage = {
  entries: WeeklyGalleryEntry[]
  totalCount: number
}

export type WeeklyAccountState = {
  draftPixels: string[] | null
  entryId: number | null
  entryPixels: string[] | null
  profileName: string | null
  votesUsed: number
}

const messages: Record<string, string> = {
  WEEKLY_ACCOUNT_REQUIRED: 'Ehhez regisztrált, bejelentkezett fiók szükséges.',
  WEEKLY_ALREADY_SUBMITTED: 'Erre a hétre már beküldted a rajzodat.',
  WEEKLY_CHALLENGE_CLOSED: 'Ez a heti kihívás már lezárult.',
  WEEKLY_DRAWING_INVALID: 'A rajz adatai nem érvényesek.',
  WEEKLY_ENTRY_NOT_FOUND: 'Ez a nevezés már nem érhető el.',
  WEEKLY_NAME_INVALID: 'A megjelenített név 2–16 karakter hosszú legyen.',
  WEEKLY_NAME_TAKEN: 'Ezt a megjelenített nevet már használják.',
  WEEKLY_OWN_VOTE_FORBIDDEN: 'A saját rajzodra nem szavazhatsz.',
  WEEKLY_PROFILE_REQUIRED: 'Előbb válassz megjelenített nevet.',
  WEEKLY_VOTE_LIMIT: 'Mindhárom heti szavazatodat felhasználtad.',
  GALLERY_SORT_INVALID: 'Ez a galériarendezés nem érhető el.',
  'Could not find the function public.get_weekly_challenges': 'A Heti Rajz még nincs bekapcsolva ezen a szerveren.',
}

function weeklyError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A Heti Rajz művelete nem sikerült.'
  const code = Object.keys(messages).find(key => raw.includes(key))
  return new Error(code ? messages[code] : raw)
}

function pixels(value: Json | null): string[] | null {
  return Array.isArray(value) && value.length === 1024 && value.every(item => typeof item === 'string')
    ? value as string[]
    : null
}

export async function getWeeklyUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user && !data.user.is_anonymous ? data.user : null
}

export async function registerWeeklyAccount(email: string, password: string, displayName: string) {
  await supabase.auth.signOut({ scope: 'local' })
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() } },
  })
  if (error) throw weeklyError(error)
  if (data.session) await setWeeklyProfile(displayName)
  return { confirmationRequired: !data.session, user: data.user }
}

export async function signInWeeklyAccount(email: string, password: string) {
  await supabase.auth.signOut({ scope: 'local' })
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw weeklyError(error)
  return data.user
}

export async function signOutWeeklyAccount() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw weeklyError(error)
}

export async function loadWeeklyChallenges() {
  const { data, error } = await supabase.rpc('get_weekly_challenges')
  if (error) throw weeklyError(error)
  return data as WeeklyChallenge[]
}

export async function loadWeeklyGallery(
  challengeId: number,
  page = 1,
  sort: GallerySort = 'likes',
  discoverySeed = 0,
): Promise<WeeklyGalleryPage> {
  const { data, error } = await supabase.rpc('get_weekly_gallery_page', {
    discovery_seed: discoverySeed,
    requested_limit: CHALLENGE_GALLERY_PAGE_SIZE,
    requested_offset: Math.max(0, page - 1) * CHALLENGE_GALLERY_PAGE_SIZE,
    requested_sort: sort,
    target_challenge_id: challengeId,
  })
  if (error) {
    if (!isMissingRpc(error, 'get_weekly_gallery_page')) throw weeklyError(error)
    const [{ data: legacyData, error: legacyError }, comments] = await Promise.all([
      supabase.rpc('get_weekly_gallery', { target_challenge_id: challengeId }),
      loadGalleryComments('weekly', challengeId),
    ])
    if (legacyError) throw weeklyError(legacyError)
    const entries = legacyData.map(entry => ({
      ...entry,
      authorAvatar: pixels(entry.author_avatar),
      comment_count: comments.filter(comment => comment.entry_id === entry.entry_id).length,
      pixels: pixels(entry.pixels) ?? [],
    })) as WeeklyGalleryEntry[]
    entries.sort((first, second) => {
      if (sort === 'likes') return second.vote_count - first.vote_count || Date.parse(second.submitted_at) - Date.parse(first.submitted_at) || second.entry_id - first.entry_id
      if (sort === 'newest') return Date.parse(second.submitted_at) - Date.parse(first.submitted_at) || second.entry_id - first.entry_id
      return legacyDiscoveryScore(first.entry_id, first.author_name, discoverySeed) - legacyDiscoveryScore(second.entry_id, second.author_name, discoverySeed)
    })
    const offset = Math.max(0, page - 1) * CHALLENGE_GALLERY_PAGE_SIZE
    return {
      entries: entries.slice(offset, offset + CHALLENGE_GALLERY_PAGE_SIZE),
      totalCount: entries.length,
    }
  }
  return {
    entries: data.map(entry => ({
      ...entry,
      authorAvatar: pixels(entry.author_avatar),
      pixels: pixels(entry.pixels) ?? [],
    })) as WeeklyGalleryEntry[],
    totalCount: Number(data[0]?.total_count ?? 0),
  }
}

export async function loadWeeklyAccountState(challengeId: number): Promise<WeeklyAccountState> {
  const { data, error } = await supabase.rpc('get_weekly_account_state', { target_challenge_id: challengeId }).single()
  if (error) throw weeklyError(error)
  return {
    draftPixels: pixels(data.draft_pixels),
    entryId: data.entry_id,
    entryPixels: pixels(data.entry_pixels),
    profileName: data.profile_name,
    votesUsed: data.votes_used,
  }
}

export async function setWeeklyProfile(displayName: string) {
  const { data, error } = await supabase.rpc('set_weekly_profile', { requested_name: displayName })
  if (error) throw weeklyError(error)
  return data
}

export async function saveWeeklyDraft(challengeId: number, drawingPixels: string[]) {
  const { data, error } = await supabase.rpc('save_weekly_draft', {
    target_challenge_id: challengeId,
    drawing_pixels: drawingPixels,
  })
  if (error) throw weeklyError(error)
  return data
}

export async function submitWeeklyEntry(challengeId: number, drawingPixels: string[]) {
  const { data, error } = await supabase.rpc('submit_weekly_entry', {
    target_challenge_id: challengeId,
    drawing_pixels: drawingPixels,
  })
  if (error) throw weeklyError(error)
  return data
}

export async function setWeeklyVote(entryId: number, enabled: boolean) {
  const { data, error } = await supabase.rpc('set_weekly_vote', {
    target_entry_id: entryId,
    vote_enabled: enabled,
  }).single()
  if (error) throw weeklyError(error)
  return data
}
