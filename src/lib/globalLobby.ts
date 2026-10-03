import { parseAvatarPixels } from './profile'
import { supabase } from './supabase'

export type GlobalLobbyMessage = {
  authorAvatar: string[] | null
  authorName: string
  content: string
  createdAt: string
  isOwn: boolean
  messageId: number
}

export type OnlineProfile = {
  avatarPixels: string[] | null
  displayName: string
  userId: string
}

export type GlobalLobbyConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

const lobbyErrors: Record<string, string> = {
  LOBBY_ACCOUNT_REQUIRED: 'Az aktív felhasználók megtekintéséhez jelentkezz be.',
  LOBBY_MESSAGE_INVALID: 'Az üzenet 1–500 karakter hosszú legyen.',
  LOBBY_MESSAGE_RATE_LIMIT: 'Várj egy pillanatot a következő üzenet előtt.',
  LOBBY_PROFILE_LIMIT: 'Egyszerre túl sok profilt próbáltunk betölteni.',
  LOBBY_PROFILE_REQUIRED: 'Előbb jelentkezz be, és válassz megjelenített nevet.',
  WEEKLY_ACCOUNT_REQUIRED: 'Az aktív felhasználók megtekintéséhez jelentkezz be.',
}

function readableLobbyError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error)
  const code = Object.keys(lobbyErrors).find(candidate => raw.includes(candidate))
  return new Error(code ? lobbyErrors[code] : 'A közösségi előszoba most nem érhető el.')
}

function lobbyUnreadEndpointIsMissing(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' ||
    Boolean(error.message?.includes('get_global_lobby_unread_count')) ||
    Boolean(error.message?.includes('mark_global_lobby_read'))
}

export async function loadOnlineProfiles(): Promise<OnlineProfile[]> {
  const { data, error } = await supabase.rpc('get_online_profiles')
  if (error) throw readableLobbyError(error)

  return data.map(profile => ({
    avatarPixels: parseAvatarPixels(profile.avatar_pixels),
    displayName: profile.display_name,
    userId: profile.user_id,
  }))
}

export async function touchGlobalLobbyPresence() {
  const { error } = await supabase.rpc('touch_global_lobby_presence')
  if (error) throw readableLobbyError(error)
}

export async function loadGlobalLobbyMessages(): Promise<GlobalLobbyMessage[]> {
  const { data, error } = await supabase.rpc('get_global_lobby_messages')
  if (error) throw readableLobbyError(error)

  return data.map(message => ({
    authorAvatar: parseAvatarPixels(message.author_avatar),
    authorName: message.author_name,
    content: message.content,
    createdAt: message.created_at,
    isOwn: message.is_own,
    messageId: message.message_id,
  }))
}

export async function sendGlobalLobbyMessage(content: string) {
  const { data, error } = await supabase.rpc('send_global_lobby_message', {
    requested_content: content,
  })
  if (error) throw readableLobbyError(error)
  return data
}

export async function getGlobalLobbyUnreadCount() {
  const { data, error } = await supabase.rpc('get_global_lobby_unread_count')
  if (error && lobbyUnreadEndpointIsMissing(error)) return 0
  if (error) throw readableLobbyError(error)
  return Math.max(0, data)
}

export async function markGlobalLobbyRead() {
  const { data, error } = await supabase.rpc('mark_global_lobby_read')
  if (error && lobbyUnreadEndpointIsMissing(error)) return 0
  if (error) throw readableLobbyError(error)
  return data
}

export function subscribeToGlobalLobbyMessages(onChange: () => void) {
  const channel = supabase
    .channel('global-lobby-messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'lobby_messages' },
      onChange,
    )
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}

export function subscribeToOnlineProfiles({
  onError,
  onProfiles,
  onStatus,
}: {
  onError: (error: Error) => void
  onProfiles: (profiles: OnlineProfile[]) => void
  onStatus: (status: GlobalLobbyConnectionStatus) => void
}) {
  let disposed = false
  let heartbeatRunning = false

  const heartbeat = async () => {
    if (disposed || heartbeatRunning) return
    if (!navigator.onLine) {
      onStatus('offline')
      return
    }

    heartbeatRunning = true
    try {
      await touchGlobalLobbyPresence()
      const profiles = await loadOnlineProfiles()
      if (!disposed) {
        onProfiles(profiles)
        onStatus('connected')
      }
    } catch (error) {
      if (!disposed) {
        onStatus(navigator.onLine ? 'reconnecting' : 'offline')
        onError(readableLobbyError(error))
      }
    } finally {
      heartbeatRunning = false
    }
  }

  const handleOnline = () => { void heartbeat() }
  const handleOffline = () => { if (!disposed) onStatus('offline') }
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') void heartbeat()
  }

  void heartbeat()
  const intervalId = window.setInterval(() => { void heartbeat() }, 15_000)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)

  return () => {
    disposed = true
    window.clearInterval(intervalId)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibility)
  }
}
