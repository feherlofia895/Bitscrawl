import { ensurePlayerSession, supabase } from './supabase'

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
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  NOT_ROUND_DRAWER: 'Csak az aktuális rajzoló választhat szót.',
  ROOM_NOT_FOUND: 'Ez a kör nem érhető el számodra.',
  ROUND_ALREADY_STARTED: 'Ehhez a körhöz már kiválasztották a szót.',
  ROUND_NOT_FOUND: 'Nem található aktív kör.',
  WORD_NOT_AVAILABLE: 'Ez a szó nem szerepel a választható lehetőségek között.',
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
