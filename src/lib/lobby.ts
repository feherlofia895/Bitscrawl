import type { Database } from '../types/database'
import { ensurePlayerSession, supabase } from './supabase'

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

const lobbyErrorMessages: Record<string, string> = {
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  GAME_ALREADY_STARTED: 'Ez a meccs már elindult.',
  NOT_ENOUGH_PLAYERS: 'A játék indításához legalább 2 játékos kell.',
  NOT_ENOUGH_ACTIVE_PLAYERS:
    'A játék indításához legalább 2 kapcsolódó játékos kell.',
  NOT_ROOM_HOST: 'Csak a szoba hostja indíthatja el a játékot.',
  GAME_NOT_FINISHED: 'Az új játék csak a meccs végén indítható.',
  PLAYER_NAME_INVALID: 'A játékosnév 2–16 karakter hosszú legyen.',
  PLAYER_NAME_TAKEN: 'Ezt a játékosnevet már használják ebben a szobában.',
  ROOM_ALREADY_STARTED: 'Ez a meccs már elindult, ezért nem lehet csatlakozni.',
  ROOM_CODE_GENERATION_FAILED: 'Nem sikerült szobakódot készíteni. Próbáld újra.',
  ROOM_CODE_INVALID: 'A szobakód 6 karakterből áll.',
  ROOM_FULL: 'A szoba megtelt. Legfeljebb 6 játékos csatlakozhat.',
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
): Promise<RoomEntry> {
  try {
    const user = await ensurePlayerSession()

    if (action === 'create') {
      const { data, error } = await supabase
        .rpc('create_room', { player_name: playerName })
        .single()

      if (error) throw error

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

export function createRoom(playerName: string) {
  return getRoomEntry('create', playerName)
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

export function subscribeToLobby(
  roomId: number,
  onChange: () => void,
  onDrawChange: () => void = onChange,
  onMessageChange: () => void = onChange,
  onConnectionChange?: (status: LobbyConnectionStatus) => void,
) {
  let reconciliationTimeout: ReturnType<typeof setTimeout> | undefined

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
    .subscribe((status) => {
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
      reconciliationTimeout = setTimeout(onChange, 1_000)
    })

  return () => {
    if (reconciliationTimeout) clearTimeout(reconciliationTimeout)
    void supabase.removeChannel(channel)
  }
}
