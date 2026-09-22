import type { Database } from '../types/database'
import {
  DEFAULT_COMPETITION_DRAW_DURATION,
  DEFAULT_COMPETITION_ROUND_COUNT,
  isCompetitionDrawDuration,
  isCompetitionRoundCount,
  isGameMode,
  type CompetitionDrawDuration,
  type CompetitionRoundCount,
  type GameMode,
} from './gameMode'
import type { RoomPaletteSize } from './palette'
import { DEFAULT_ROUND_DURATION, isRoundDuration, roundDurationText, type RoundDuration } from './roundDuration'
import { ensurePlayerSession, supabase } from './supabase'

export type RoomMessage = {
  content: string
  created_at: string
  id: number
  room_id: number
  sender_user_id: string
}

export type Room = Database['public']['Tables']['rooms']['Row']
export type RoomPlayer = Database['public']['Tables']['room_players']['Row']

export type Lobby = {
  currentUserId: string
  playerId: number
  players: RoomPlayer[]
  room: Room
}

type RoomEntry = {
  currentUserId: string
  playerId: number
  roomCode: string
  roomId: number
}

export type LobbyConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

export const ROOM_MESSAGE_LIMIT = 50

export type CreateRoomSettings = {
  competitionDrawDuration: CompetitionDrawDuration
  competitionRoundCount: CompetitionRoundCount
  gameMode: GameMode
}

const defaultCreateRoomSettings: CreateRoomSettings = {
  competitionDrawDuration: DEFAULT_COMPETITION_DRAW_DURATION,
  competitionRoundCount: DEFAULT_COMPETITION_ROUND_COUNT,
  gameMode: 'classic',
}

const lobbyErrorMessages: Record<string, string> = {
  ROUND_DURATION_INVALID: roundDurationText.invalid,
  ROUND_DURATION_UNAVAILABLE: roundDurationText.unavailable,
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  GAME_ALREADY_STARTED: 'Ez a meccs már elindult.',
  GAME_MODE_INVALID: 'Ismeretlen játékmód.',
  GAME_MODE_UNAVAILABLE: 'A párhuzamos rajzverseny játékmenete még készül.',
  COMPETITION_DRAW_TIME_INVALID: 'A verseny rajzolási ideje 60, 90 vagy 120 másodperc lehet.',
  COMPETITION_ROUND_COUNT_INVALID: 'A verseny 1–5 fordulóból állhat.',
  NOT_ENOUGH_PLAYERS: 'A játék indításához legalább 2 játékos kell.',
  NOT_ENOUGH_ACTIVE_PLAYERS:
    'A játék indításához legalább 2 kapcsolódó játékos kell.',
  NOT_ROOM_HOST: 'Csak a szoba hostja indíthatja el a játékot.',
  PALETTE_SIZE_INVALID: 'Érvénytelen színpaletta.',
  PALETTE_SIZE_UNAVAILABLE: 'A bővített színpaletta átmenetileg nem érhető el.',
  GAME_NOT_FINISHED: 'Az új játék csak a meccs végén indítható.',
  ROOM_MEMBERSHIP_NOT_FOUND: 'Már nem vagy tagja ennek a szobának.',
  PLAYER_NAME_INVALID: 'A játékosnév 2–16 karakter hosszú legyen.',
  PLAYER_NAME_TAKEN: 'Ezt a játékosnevet már használják ebben a szobában.',
  ROOM_ALREADY_STARTED: 'Ez a meccs már elindult, ezért nem lehet csatlakozni.',
  ROOM_CODE_GENERATION_FAILED: 'Nem sikerült szobakódot készíteni. Próbáld újra.',
  ROOM_CODE_INVALID: 'A szobakód 6 karakterből áll.',
  ROOM_FULL: 'A szoba megtelt. Legfeljebb 6 játékos csatlakozhat.',
  ROOM_MESSAGE_INVALID: 'A chatüzenet 1–500 karakter hosszú legyen.',
  ROOM_NOT_FOUND: 'Nem található várószoba ezzel a kóddal.',
}

function readableLobbyError(error: unknown) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)

  if (message.toLowerCase().includes('anonymous sign-ins are disabled')) {
    return new Error(
      'A Supabase névtelen belépést még be kell kapcsolni az Authentication → Sign In / Providers oldalon.',
    )
  }

  const knownCode = Object.keys(lobbyErrorMessages).find((code) =>
    message.includes(code),
  )

  return new Error(
    knownCode
      ? lobbyErrorMessages[knownCode]
      : 'Váratlan kapcsolati hiba történt. Próbáld újra.',
  )
}

async function getRoomEntry(
  action: 'create' | 'join',
  playerName: string,
  roomCode?: string,
  roundDuration: RoundDuration = DEFAULT_ROUND_DURATION,
  settings: CreateRoomSettings = defaultCreateRoomSettings,
): Promise<RoomEntry> {
  try {
    if (action === 'create' && !isRoundDuration(roundDuration)) {
      throw new Error('ROUND_DURATION_INVALID')
    }
    if (action === 'create' && (
      !isGameMode(settings.gameMode) ||
      !isCompetitionDrawDuration(settings.competitionDrawDuration) ||
      !isCompetitionRoundCount(settings.competitionRoundCount)
    )) {
      throw new Error('GAME_MODE_INVALID')
    }
    const user = await ensurePlayerSession()

    if (action === 'create') {
      let { data, error } = await supabase
        .rpc('create_room_with_settings', {
          duration_seconds: roundDuration,
          player_name: playerName,
          requested_competition_draw_seconds: settings.competitionDrawDuration,
          requested_competition_round_count: settings.competitionRoundCount,
          requested_game_mode: settings.gameMode,
        })
        .single()

      // Keep classic rooms usable until the competition settings migration is deployed.
      if (error?.code === 'PGRST202') {
        if (settings.gameMode !== 'classic') throw new Error('GAME_MODE_UNAVAILABLE')
        const durationResult = await supabase
          .rpc('create_room_with_duration', { player_name: playerName, duration_seconds: roundDuration })
          .single()
        data = durationResult.data
        error = durationResult.error
      }

      // Keep 90-second classic rooms usable until the duration migration is deployed.
      if (error?.code === 'PGRST202') {
        if (roundDuration !== DEFAULT_ROUND_DURATION) throw new Error('ROUND_DURATION_UNAVAILABLE')
        const legacyResult = await supabase.rpc('create_room', { player_name: playerName }).single()
        data = legacyResult.data
        error = legacyResult.error
      }

      if (error) throw error
      if (!data) throw new Error('ROOM_NOT_FOUND')

      return {
        currentUserId: user.id,
        playerId: data.player_id,
        roomCode: data.room_code,
        roomId: data.room_id,
      }
    }

    const { data, error } = await supabase
      .rpc('join_room', {
        player_name: playerName,
        room_code: roomCode ?? '',
      })
      .single()

    if (error) throw error

    return {
      currentUserId: user.id,
      playerId: data.player_id,
      roomCode: data.normalized_room_code,
      roomId: data.room_id,
    }
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export function createRoom(
  playerName: string,
  roundDuration: RoundDuration = DEFAULT_ROUND_DURATION,
  settings: CreateRoomSettings = defaultCreateRoomSettings,
) {
  return getRoomEntry('create', playerName, undefined, roundDuration, settings)
}

export async function setRoomGameSettings(roomId: number, settings: CreateRoomSettings) {
  if (!isGameMode(settings.gameMode)) throw new Error(lobbyErrorMessages.GAME_MODE_INVALID)
  if (!isCompetitionDrawDuration(settings.competitionDrawDuration)) {
    throw new Error(lobbyErrorMessages.COMPETITION_DRAW_TIME_INVALID)
  }
  if (!isCompetitionRoundCount(settings.competitionRoundCount)) {
    throw new Error(lobbyErrorMessages.COMPETITION_ROUND_COUNT_INVALID)
  }
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('set_room_game_settings', {
      requested_competition_draw_seconds: settings.competitionDrawDuration,
      requested_competition_round_count: settings.competitionRoundCount,
      requested_game_mode: settings.gameMode,
      target_room_id: roomId,
    }).single()
    if (error?.code === 'PGRST202') throw new Error('GAME_MODE_UNAVAILABLE')
    if (error) throw error
    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function setRoomRoundDuration(roomId: number, duration: RoundDuration) {
  if (!isRoundDuration(duration)) throw new Error(roundDurationText.invalid)
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('set_room_round_duration', {
      target_room_id: roomId, duration_seconds: duration,
    }).single()
    if (error?.code === 'PGRST202') throw new Error('ROUND_DURATION_UNAVAILABLE')
    if (error?.message.includes('NOT_ROOM_HOST')) throw new Error(roundDurationText.hostOnly)
    if (error) throw error
    return data
  } catch (error) {
    if (error instanceof Error && error.message === roundDurationText.hostOnly) throw error
    throw readableLobbyError(error)
  }
}

export function joinRoom(playerName: string, roomCode: string) {
  return getRoomEntry('join', playerName, roomCode)
}

export async function resumeRoom(roomCode: string): Promise<RoomEntry | null> {
  try {
    const user = await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('resume_room', { room_code: roomCode })
      .single()

    if (error) {
      if (error.message.includes('ROOM_MEMBERSHIP_NOT_FOUND')) return null
      throw error
    }

    return {
      currentUserId: user.id,
      playerId: data.player_id,
      roomCode: data.normalized_room_code,
      roomId: data.room_id,
    }
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function touchRoomPresence(roomId: number) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('touch_room_presence', { target_room_id: roomId })
      .single()

    if (error) throw error
    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function leaveRoom(roomId: number) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('leave_room', { target_room_id: roomId })
      .single()

    if (error) throw error
    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function setRoomTestMode(roomId: number, enabled: boolean) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('set_room_test_mode', {
        target_room_id: roomId,
        test_mode_enabled: enabled,
      })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function setRoomPaletteSize(
  roomId: number,
  paletteSize: RoomPaletteSize,
) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase
      .rpc('set_room_palette_size', {
        palette_size_value: paletteSize,
        target_room_id: roomId,
      })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function startGame(roomId: number) {
  try {
    await ensurePlayerSession()

    const { data, error } = await supabase
      .rpc('start_game', { target_room_id: roomId })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function restartGame(roomId: number) {
  try {
    await ensurePlayerSession()

    const { data, error } = await supabase
      .rpc('restart_game', { target_room_id: roomId })
      .single()

    if (error) throw error

    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export async function loadLobby(entry: RoomEntry): Promise<Lobby> {
  const [roomResult, playersResult] = await Promise.all([
    supabase.from('rooms').select('*').eq('id', entry.roomId).single(),
    supabase
      .from('room_players')
      .select('*')
      .eq('room_id', entry.roomId)
      .order('joined_at'),
  ])

  if (roomResult.error) throw readableLobbyError(roomResult.error)
  if (playersResult.error) throw readableLobbyError(playersResult.error)

  return {
    currentUserId: entry.currentUserId,
    playerId: entry.playerId,
    players: playersResult.data,
    room: roomResult.data,
  }
}

export async function loadRoomMessages(
  roomId: number,
  afterMessageId: number | null = null,
): Promise<RoomMessage[]> {
  const { data, error } = await supabase.rpc('get_room_message_updates', {
    after_message_id: afterMessageId,
    requested_limit: ROOM_MESSAGE_LIMIT,
    target_room_id: roomId,
  })

  if (error && !isMissingRpc(error, 'get_room_message_updates')) {
    throw readableLobbyError(error)
  }

  if (error) {
    let fallback = supabase
      .from('room_messages')
      .select('id, room_id, sender_user_id, content, created_at')
      .eq('room_id', roomId)
    if (afterMessageId !== null) fallback = fallback.gt('id', afterMessageId)
    const result = await fallback.order('id', { ascending: false }).limit(ROOM_MESSAGE_LIMIT)
    if (result.error) throw readableLobbyError(result.error)
    return result.data.reverse()
  }

  return data
}

function isMissingRpc(error: unknown, functionName: string) {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return code === 'PGRST202' && message.includes(functionName)
}

export async function sendRoomMessage(roomId: number, content: string) {
  try {
    await ensurePlayerSession()
    const { data, error } = await supabase.rpc('send_room_message', {
      message_content: content,
      target_room_id: roomId,
    })

    if (error) throw error
    return data
  } catch (error) {
    throw readableLobbyError(error)
  }
}

export function subscribeToLobby(
  roomId: number,
  onChange: () => void,
  onDrawChange: () => void = onChange,
  onMessageChange: () => void = onChange,
  onRoomMessageChange: () => void = onChange,
  onConnectionChange?: (status: LobbyConnectionStatus) => void,
) {
  let reconciliationTimeout: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const channel = supabase
    .channel(`lobby-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `room_id=eq.${roomId}`,
        schema: 'public',
        table: 'room_players',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `id=eq.${roomId}`,
        schema: 'public',
        table: 'rooms',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `room_id=eq.${roomId}`,
        schema: 'public',
        table: 'game_rounds',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `room_id=eq.${roomId}`,
        schema: 'public',
        table: 'competition_rounds',
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        filter: `room_id=eq.${roomId}`,
        schema: 'public',
        table: 'round_draw_events',
      },
      onDrawChange,
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        filter: `room_id=eq.${roomId}`,
        schema: 'public',
        table: 'round_messages',
      },
      onMessageChange,
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        filter: `room_id=eq.${roomId}`,
        schema: 'public',
        table: 'room_messages',
      },
      onRoomMessageChange,
    )
    .subscribe((status) => {
      if (disposed) return

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onConnectionChange?.('reconnecting')
        return
      }

      if (status === 'CLOSED') {
        onConnectionChange?.('disconnected')
        return
      }

      if (status !== 'SUBSCRIBED') return

      onConnectionChange?.('connected')
      onChange()
      onDrawChange()
      onMessageChange()
      onRoomMessageChange()
      reconciliationTimeout = setTimeout(() => {
        onChange()
        onDrawChange()
        onMessageChange()
        onRoomMessageChange()
      }, 1_000)
    })

  return () => {
    disposed = true
    if (reconciliationTimeout) clearTimeout(reconciliationTimeout)
    void supabase.removeChannel(channel)
  }
}
