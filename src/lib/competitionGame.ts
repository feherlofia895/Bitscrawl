import type { Database, Json } from '../types/database'
import type { PixelChange } from './game'
import { ensurePlayerSession, supabase } from './supabase'

export type CompetitionRoundView = {
  chosen_word: string
  drawing_ends_at: string
  finished_at: string | null
  next_round_at: string | null
  round_id: number
  round_number: number
  round_status: 'drawing' | 'voting' | 'finished'
  server_now: string
  total_rounds: number
  voted_for_drawing_id: string | null
  voting_ends_at: string | null
}

export type CompetitionDrawEvent = {
  changes: PixelChange[]
  drawing_id: string
  id: number
  round_id: number
}

export type CompetitionResult = {
  display_name: string | null
  drawing_id: string
  is_own: boolean
  vote_count: number | null
}

const competitionErrorMessages: Record<string, string> = {
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  DRAWING_NOT_FOUND: 'Ez a rajz nem található.',
  GAME_ALREADY_STARTED: 'Ez a verseny már elindult.',
  GAME_MODE_INVALID: 'Ez a szoba nem versenymódban fut.',
  GAME_NOT_FINISHED: 'Az új verseny csak az eredményhirdetés után indítható.',
  GAME_NOT_PLAYING: 'Ez a verseny jelenleg nem fut.',
  NOT_ENOUGH_PLAYERS: 'A versenymódhoz legalább 3 játékos szükséges.',
  NOT_ROOM_HOST: 'Csak a szoba hostja indíthatja el a versenyt.',
  PIXEL_CHANGES_INVALID: 'Érvénytelen pixelmódosítás érkezett.',
  ROOM_NOT_FOUND: 'Ez a versenyszoba nem érhető el számodra.',
  ROUND_NOT_DRAWING: 'A rajzolási szakasz már véget ért.',
  ROUND_NOT_FINISHED: 'Ez a forduló még nem ért véget.',
  ROUND_NOT_FOUND: 'Nem található aktív versenyforduló.',
  ROUND_TIME_EXPIRED: 'Lejárt a rajzolási idő.',
  ROUND_TIME_REMAINING: 'A rajzolási idő még nem járt le.',
  ROUND_TRANSITION_PENDING: 'A következő forduló még nem indítható.',
  SELF_VOTE_FORBIDDEN: 'A saját rajzodra nem szavazhatsz.',
  VOTING_NOT_OPEN: 'A szavazás még nem kezdődött el.',
  VOTING_TIME_EXPIRED: 'Lejárt a szavazási idő.',
  VOTING_TIME_REMAINING: 'A szavazási idő még nem járt le.',
}

function readableCompetitionError(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)
  const knownCode = Object.keys(competitionErrorMessages).find(code => message.includes(code))
  return new Error(knownCode
    ? competitionErrorMessages[knownCode]
    : 'Váratlan hiba történt a verseny betöltésekor. Próbáld újra.')
}

async function singleRpc<T>(request: PromiseLike<{ data: T | null; error: unknown }>) {
  try {
    await ensurePlayerSession()
    const { data, error } = await request
    if (error) throw error
    if (data === null) throw new Error('EMPTY_RESPONSE')
    return data
  } catch (error) {
    throw readableCompetitionError(error)
  }
}

export function startCompetitionGame(roomId: number) {
  return singleRpc(supabase.rpc('start_competition_game', { target_room_id: roomId }).single())
}

export function restartCompetitionGame(roomId: number) {
  return singleRpc(supabase.rpc('restart_competition_game', { target_room_id: roomId }).single())
}

export function loadCompetitionRoundView(roomId: number): Promise<CompetitionRoundView> {
  return singleRpc<Database['public']['Functions']['get_competition_round_view']['Returns'][number]>(
    supabase.rpc('get_competition_round_view', { target_room_id: roomId }).single(),
  )
    .then(data => ({
      ...data,
      round_status: data.round_status as CompetitionRoundView['round_status'],
    }))
}

export async function loadCompetitionDrawEvents(
  roundId: number,
  afterEventId: number | null = null,
): Promise<CompetitionDrawEvent[]> {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('get_competition_draw_updates', {
      after_event_id: afterEventId,
      requested_limit: 500,
      target_round_id: roundId,
    })
    if (error) throw error
    return data.map(event => ({ ...event, changes: event.changes as PixelChange[] }))
  } catch (error) {
    throw readableCompetitionError(error)
  }
}

export async function submitCompetitionPixelChanges(roundId: number, changes: PixelChange[]) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('submit_competition_pixel_changes', {
      pixel_changes: changes as Json,
      target_round_id: roundId,
    })
    if (error) throw error
    return data
  } catch (error) {
    throw readableCompetitionError(error)
  }
}

export function finishCompetitionDrawing(roundId: number) {
  return singleRpc(supabase.rpc('finish_competition_drawing', { target_round_id: roundId }).single())
}

export function setCompetitionVote(roundId: number, drawingId: string) {
  return singleRpc(supabase.rpc('set_competition_vote', {
    target_drawing_id: drawingId,
    target_round_id: roundId,
  }).single())
}

export async function loadCompetitionResults(roundId: number): Promise<CompetitionResult[]> {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('get_competition_results', {
      target_round_id: roundId,
    })
    if (error) throw error
    return data
  } catch (error) {
    throw readableCompetitionError(error)
  }
}

export function finishCompetitionVoting(roundId: number) {
  return singleRpc(supabase.rpc('finish_competition_voting', { target_round_id: roundId }).single())
}

export function advanceCompetitionGame(roundId: number) {
  return singleRpc(supabase.rpc('advance_competition_game', { target_round_id: roundId }).single())
}
