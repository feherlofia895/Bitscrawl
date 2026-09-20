import { isValidDrawingPixels } from './drawing.ts'

export type ChallengeDraftKind = 'weekly' | 'monthly'

export type ChallengeDraft = {
  pixels: string[]
  savedAt: string
}

const STORAGE_PREFIX = 'bitscrawl-challenge-draft-v1'

function draftKey(kind: ChallengeDraftKind, userId: string, challengeId: number) {
  return `${STORAGE_PREFIX}:${kind}:${userId}:${challengeId}`
}

function samePixels(first: readonly string[], second: readonly string[]) {
  return first.length === second.length && first.every((color, index) => color === second[index])
}

export function loadChallengeDraft(
  kind: ChallengeDraftKind,
  userId: string,
  challengeId: number,
  storage: Storage = window.localStorage,
): ChallengeDraft | null {
  try {
    const serialized = storage.getItem(draftKey(kind, userId, challengeId))
    if (!serialized) return null
    const stored: unknown = JSON.parse(serialized)
    if (typeof stored !== 'object' || stored === null || !('pixels' in stored) ||
      !isValidDrawingPixels(stored.pixels)) return null
    return {
      pixels: [...stored.pixels],
      savedAt: 'savedAt' in stored && typeof stored.savedAt === 'string'
        ? stored.savedAt
        : '',
    }
  } catch {
    return null
  }
}

export function saveChallengeDraft(
  kind: ChallengeDraftKind,
  userId: string,
  challengeId: number,
  pixels: readonly string[],
  storage: Storage = window.localStorage,
) {
  if (!isValidDrawingPixels(pixels)) return false
  try {
    storage.setItem(draftKey(kind, userId, challengeId), JSON.stringify({
      pixels: [...pixels],
      savedAt: new Date().toISOString(),
    }))
    return true
  } catch {
    return false
  }
}

export function clearChallengeDraft(
  kind: ChallengeDraftKind,
  userId: string,
  challengeId: number,
  savedPixels: readonly string[],
  storage: Storage = window.localStorage,
) {
  const current = loadChallengeDraft(kind, userId, challengeId, storage)
  if (!current || !samePixels(current.pixels, savedPixels)) return false
  try {
    storage.removeItem(draftKey(kind, userId, challengeId))
    return true
  } catch {
    return false
  }
}
