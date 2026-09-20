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

type PresencePayload = {
  user_id: string
}

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

export async function loadOnlineProfiles(userIds: string[]): Promise<OnlineProfile[]> {
  const uniqueIds = [...new Set(userIds)].slice(0, 100)
  if (!uniqueIds.length) return []

  const { data, error } = await supabase.rpc('get_online_profiles', {
    requested_user_ids: uniqueIds,
  })
  if (error) throw readableLobbyError(error)

  return data.map(profile => ({
    avatarPixels: parseAvatarPixels(profile.avatar_pixels),
    displayName: profile.display_name,
    userId: profile.user_id,
  }))
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

function presenceUserIds(state: Record<string, Array<{ user_id?: unknown }>>) {
  return Object.values(state)
    .flat()
    .map(presence => presence.user_id)
    .filter((userId): userId is string => typeof userId === 'string')
}

export function subscribeToOnlineProfiles({
  onError,
  onProfiles,
  onStatus,
  userId,
}: {
  onError: (error: Error) => void
  onProfiles: (profiles: OnlineProfile[]) => void
  onStatus: (status: GlobalLobbyConnectionStatus) => void
  userId: string
}) {
  let disposed = false
  let syncVersion = 0
  const channel = supabase.channel('global-lobby', {
    config: { presence: { enabled: true, key: userId }, private: true },
  })

  const syncProfiles = async () => {
    const version = ++syncVersion
    try {
      const ids = presenceUserIds(channel.presenceState<PresencePayload>())
      const profiles = await loadOnlineProfiles(ids)
      if (!disposed && version === syncVersion) onProfiles(profiles)
    } catch (error) {
      if (!disposed) onError(readableLobbyError(error))
    }
  }

  channel
    .on('presence', { event: 'sync' }, () => { void syncProfiles() })
    .subscribe(async status => {
      if (disposed) return
      if (status === 'SUBSCRIBED') {
        onStatus('connected')
        const result = await channel.track({ user_id: userId } satisfies PresencePayload)
        if (result !== 'ok' && !disposed) onStatus('reconnecting')
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onStatus('reconnecting')
        return
      }
      if (status === 'CLOSED') onStatus('offline')
    })

  return () => {
    disposed = true
    void channel.untrack()
    void supabase.removeChannel(channel)
  }
}
