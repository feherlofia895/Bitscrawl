import { ensurePlayerSession, supabase } from './supabase'
import type { Json } from '../types/database'

export type PixelChange = {
  color: string
  x: number
  y: number
}

export type DrawEvent = {
  changes: PixelChange[]
  id: number
  round_id: number
}

export type RoundMessage = {
  content: string | null
  created_at: string
  id: number
  kind: 'correct'
  round_id: number
  sender_user_id: string
}

export type RoundView = {
  chosen_word: string | null
  correct_guess_count: number
  drawer_user_id: string
  drawing_ends_at: string | null
  finished_at: string | null
  is_drawer: boolean
  next_round_at: string | null
  round_id: number
  round_number: number
  round_status: string
  server_now: string
  total_rounds: number
  word_options: string[] | null
}

export const ROUND_MESSAGE_LIMIT = 10
export const ROUND_DRAW_EVENT_LIMIT = 100

const gameErrorMessages: Record<string, string> = {
  ALREADY_GUESSED: 'Ezt a szót már megfejtetted.',
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  DRAWER_CANNOT_GUESS: 'A rajzoló nem küldhet tippet.',
  GAME_NOT_PLAYING: 'Ez a meccs jelenleg nem fut.',
  GUESS_INVALID: 'A tipp 1–80 karakter hosszú legyen.',
  NOT_ROUND_DRAWER: 'Csak az aktuális rajzoló végezheti ezt a műveletet.',
  PIXEL_CHANGES_INVALID: 'Érvénytelen pixelmódosítás érkezett.',
  ROOM_NOT_FOUND: 'Ez a kör nem érhető el számodra.',
  ROUND_ALREADY_STARTED: 'Ehhez a körhöz már kiválasztották a szót.',
  ROUND_NOT_DRAWING: 'A rajzolás még nem kezdődött el.',
  ROUND_NOT_FINISHED: 'Ez a kör még nem ért véget.',
  ROUND_NOT_FOUND: 'Nem található aktív kör.',
  ROUND_TIME_EXPIRED: 'Lejárt a kör ideje.',
  ROUND_TIME_REMAINING: 'A kör ideje még nem járt le.',
  ROUND_TRANSITION_PENDING: 'A következő kör még nem indítható.',
  WORD_NOT_AVAILABLE: 'Ez a szó nem szerepel a választható lehetőségek között.',
}

export async function advanceGame(roundId: number) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('advance_game', { target_round_id: roundId })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableGameError(error)
  }
}

export async function finishExpiredRound(roundId: number) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('finish_expired_round', { target_round_id: roundId })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableGameError(error)
  }
}

export async function loadRoundMessages(
  roundId: number,
  afterMessageId: number | null = null,
): Promise<RoundMessage[]> {
  const { data, error } = await supabase.rpc('get_round_message_updates', {
    after_message_id: afterMessageId,
    requested_limit: ROUND_MESSAGE_LIMIT,
    target_round_id: roundId,
  })

  if (error && !isMissingRpc(error, 'get_round_message_updates')) {
    throw readableGameError(error)
  }

  if (error) {
    let fallback = supabase
      .from('round_messages')
      .select('id, round_id, sender_user_id, kind, content, created_at')
      .eq('round_id', roundId)
    if (afterMessageId !== null) fallback = fallback.gt('id', afterMessageId)
    const result = await fallback.order('id', { ascending: false }).limit(ROUND_MESSAGE_LIMIT)
    if (result.error) throw readableGameError(result.error)
    return result.data.reverse().map((message) => ({
      ...message,
      kind: message.kind as RoundMessage['kind'],
    }))
  }

  return data.map((message) => ({
    ...message,
    kind: message.kind as RoundMessage['kind'],
  }))
}

export async function submitGuess(roundId: number, guess: string) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('submit_guess', {
        submitted_guess: guess,
        target_round_id: roundId,
      })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableGameError(error)
  }
}

export async function loadDrawEvents(
  roundId: number,
  afterEventId: number | null = null,
): Promise<DrawEvent[]> {
  const { data, error } = await supabase.rpc('get_round_draw_updates', {
    after_event_id: afterEventId,
    requested_limit: ROUND_DRAW_EVENT_LIMIT,
    target_round_id: roundId,
  })

  if (error && !isMissingRpc(error, 'get_round_draw_updates')) {
    throw readableGameError(error)
  }

  if (error) {
    let fallback = supabase
      .from('round_draw_events')
      .select('id, round_id, changes')
      .eq('round_id', roundId)
    if (afterEventId !== null) fallback = fallback.gt('id', afterEventId)
    const result = await fallback.order('id', { ascending: false }).limit(ROUND_DRAW_EVENT_LIMIT)
    if (result.error) throw readableGameError(result.error)
    return result.data.reverse().map((event) => ({
      ...event,
      changes: event.changes as PixelChange[],
    }))
  }

  return data.map((event) => ({
    ...event,
    changes: event.changes as PixelChange[],
  }))
}

export async function submitPixelChanges(
  roundId: number,
  changes: PixelChange[],
) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('submit_pixel_changes', {
      pixel_changes: changes as Json,
      target_round_id: roundId,
    })

    if (error) throw error

    return data
  } catch (error) {
    throw readableGameError(error)
  }
}

function readableGameError(error: unknown) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
  const knownCode = Object.keys(gameErrorMessages).find((code) =>
    message.includes(code),
  )

  return new Error(
    knownCode
      ? gameErrorMessages[knownCode]
      : 'Váratlan hiba történt a kör betöltésekor. Próbáld újra.',
  )
}

function isMissingRpc(error: unknown, functionName: string) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' && message.includes(functionName)
}

export async function loadRoundView(roomId: number): Promise<RoundView> {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('get_round_view', { target_room_id: roomId })
      .single()

    if (error) throw error

    return {
      ...data,
      chosen_word: data.chosen_word ?? null,
      drawing_ends_at: data.drawing_ends_at ?? null,
      finished_at: data.finished_at ?? null,
      next_round_at: data.next_round_at ?? null,
      word_options: data.word_options ?? null,
    }
  } catch (error) {
    throw readableGameError(error)
  }
}

export async function chooseRoundWord(roundId: number, word: string) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('choose_round_word', {
        selected_word: word,
        target_round_id: roundId,
      })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableGameError(error)
  }
}
