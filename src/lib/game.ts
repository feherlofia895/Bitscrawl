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
  kind: 'guess' | 'correct'
  round_id: number
  sender_user_id: string
}

export type RoundView = {
  chosen_word: string | null
  drawer_user_id: string
  is_drawer: boolean
  round_id: number
  round_number: number
  round_status: string
  word_options: string[] | null
}

const gameErrorMessages: Record<string, string> = {
  ALREADY_GUESSED: 'Ezt a szót már megfejtetted.',
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  DRAWER_CANNOT_GUESS: 'A rajzoló nem küldhet tippet.',
  GUESS_INVALID: 'A tipp 1–80 karakter hosszú legyen.',
  NOT_ROUND_DRAWER: 'Csak az aktuális rajzoló végezheti ezt a műveletet.',
  PIXEL_CHANGES_INVALID: 'Érvénytelen pixelmódosítás érkezett.',
  ROOM_NOT_FOUND: 'Ez a kör nem érhető el számodra.',
  ROUND_ALREADY_STARTED: 'Ehhez a körhöz már kiválasztották a szót.',
  ROUND_NOT_DRAWING: 'A rajzolás még nem kezdődött el.',
  ROUND_NOT_FOUND: 'Nem található aktív kör.',
  WORD_NOT_AVAILABLE: 'Ez a szó nem szerepel a választható lehetőségek között.',
}

export async function loadRoundMessages(
  roundId: number,
): Promise<RoundMessage[]> {
  const { data, error } = await supabase
    .from('round_messages')
    .select('id, round_id, sender_user_id, kind, content, created_at')
    .eq('round_id', roundId)
    .order('id')

  if (error) throw readableGameError(error)

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

export async function loadDrawEvents(roundId: number): Promise<DrawEvent[]> {
  const { data, error } = await supabase
    .from('round_draw_events')
    .select('id, round_id, changes')
    .eq('round_id', roundId)
    .order('id')

  if (error) throw readableGameError(error)

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
