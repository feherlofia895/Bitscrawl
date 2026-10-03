import { supabase } from './supabase'

export type ModerationTargetKind =
  | 'feed-comment'
  | 'feed-post'
  | 'gallery-comment'
  | 'monthly-entry'
  | 'weekly-entry'

export type ArtworkReactionTargetKind = Extract<
  ModerationTargetKind,
  'feed-post' | 'monthly-entry' | 'weekly-entry'
>

export type AdminArtworkReaction = {
  displayName: string
  reactedAt: string
}

const messages: Record<string, string> = {
  ADMIN_REQUIRED: 'Ehhez adminisztrátori jogosultság szükséges.',
  MODERATION_KIND_INVALID: 'Ez a tartalomtípus nem moderálható.',
  MODERATION_TARGET_NOT_FOUND: 'A tartalom már nem található.',
}

function moderationError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A moderálási művelet nem sikerült.'
  const code = Object.keys(messages).find(key => raw.includes(key))
  return new Error(code ? messages[code] : raw)
}

export async function loadModeratorAccess() {
  const { data, error } = await supabase.rpc('is_app_admin')
  if (error) throw moderationError(error)
  return data === true
}

export async function moderateDeleteContent(kind: ModerationTargetKind, id: number) {
  const { data, error } = await supabase.rpc('moderate_delete_content', {
    target_id: id,
    target_kind: kind,
  })
  if (error) throw moderationError(error)
  return data
}

export async function moderateDeleteLobbyMessage(id: number) {
  const { data, error } = await supabase.rpc('moderate_delete_lobby_message', {
    target_message_id: id,
  })
  if (error) throw moderationError(error)
  return data
}

export async function loadAdminArtworkReactions(
  kind: ArtworkReactionTargetKind,
  id: number,
): Promise<AdminArtworkReaction[]> {
  const { data, error } = await supabase.rpc('get_admin_artwork_reactions', {
    target_id: id,
    target_kind: kind,
  })
  if (error) throw moderationError(error)
  return (data ?? []).map(reaction => ({
    displayName: reaction.display_name,
    reactedAt: reaction.reacted_at,
  }))
}
