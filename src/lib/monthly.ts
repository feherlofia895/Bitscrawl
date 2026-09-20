import type { Json } from '../types/database'
import { supabase } from './supabase'
import { loadGalleryComments, type GalleryComment } from './galleryComments'

export type MonthlyChallenge = {
  challenge_id: number
  challenge_status: 'upcoming' | 'drawing' | 'voting' | 'closed'
  description: string | null
  ends_at: string
  month_key: string
  prompt: string
  server_now: string
  starts_at: string
  voting_starts_at: string
}

export type MonthlyGalleryEntry = {
  authorAvatar: string[] | null
  author_name: string
  comments: GalleryComment[]
  entry_id: number
  has_voted: boolean
  is_own: boolean
  is_winner: boolean
  pixels: string[]
  updated_at: string
  vote_count: number
}

export type MonthlyAccountState = {
  entryId: number | null
  entryPixels: string[] | null
  profileName: string | null
  submittedAt: string | null
  updatedAt: string | null
  votesUsed: number
}

const messages: Record<string, string> = {
  MONTHLY_DRAWING_INVALID: 'A rajz adatai nem érvényesek.',
  MONTHLY_DRAWING_LOCKED: 'A havi rajz már lezárult, most a szavazás következik.',
  MONTHLY_ENTRY_NOT_FOUND: 'Ez a havi nevezés már nem érhető el.',
  MONTHLY_OWN_VOTE_FORBIDDEN: 'A saját rajzodra nem szavazhatsz.',
  MONTHLY_VOTE_LIMIT: 'Mindhárom havi szavazatodat felhasználtad.',
  MONTHLY_VOTING_CLOSED: 'A havi szavazás most nem aktív.',
  WEEKLY_ACCOUNT_REQUIRED: 'Ehhez regisztrált, bejelentkezett fiók szükséges.',
  WEEKLY_PROFILE_REQUIRED: 'Előbb válassz megjelenített nevet.',
}

function monthlyError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A havi kihívás művelete nem sikerült.'
  const code = Object.keys(messages).find(key => raw.includes(key))
  return new Error(code ? messages[code] : raw)
}

function pixels(value: Json | null): string[] | null {
  return Array.isArray(value) && value.length === 1024 && value.every(item => typeof item === 'string')
    ? value as string[]
    : null
}

export async function loadMonthlyChallenges() {
  const { data, error } = await supabase.rpc('get_monthly_challenges')
  if (error) throw monthlyError(error)
  return data as MonthlyChallenge[]
}

export async function loadMonthlyGallery(challengeId: number) {
  const [{ data, error }, comments] = await Promise.all([
    supabase.rpc('get_monthly_gallery', { target_challenge_id: challengeId }),
    loadGalleryComments('monthly', challengeId),
  ])
  if (error) throw monthlyError(error)
  return data.map(entry => ({
    ...entry,
    authorAvatar: pixels(entry.author_avatar),
    comments: comments.filter(comment => comment.entry_id === entry.entry_id),
    pixels: pixels(entry.pixels) ?? [],
  })) as MonthlyGalleryEntry[]
}

export async function loadMonthlyAccountState(challengeId: number): Promise<MonthlyAccountState> {
  const { data, error } = await supabase.rpc('get_monthly_account_state', { target_challenge_id: challengeId }).single()
  if (error) throw monthlyError(error)
  return {
    entryId: data.entry_id,
    entryPixels: pixels(data.entry_pixels),
    profileName: data.profile_name,
    submittedAt: data.submitted_at,
    updatedAt: data.updated_at,
    votesUsed: data.votes_used,
  }
}

export async function saveMonthlyEntry(challengeId: number, drawingPixels: string[]) {
  const { data, error } = await supabase.rpc('save_monthly_entry', {
    drawing_pixels: drawingPixels,
    target_challenge_id: challengeId,
  })
  if (error) throw monthlyError(error)
  return data
}

export async function submitMonthlyEntry(challengeId: number) {
  const { data, error } = await supabase.rpc('submit_monthly_entry', {
    target_challenge_id: challengeId,
  })
  if (error) throw monthlyError(error)
  return data
}

export async function setMonthlyVote(entryId: number, enabled: boolean) {
  const { data, error } = await supabase.rpc('set_monthly_vote', {
    target_entry_id: entryId,
    vote_enabled: enabled,
  }).single()
  if (error) throw monthlyError(error)
  return data
}
