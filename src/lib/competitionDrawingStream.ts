import type { CompetitionDrawEvent } from './competitionGame'

export const COMPETITION_EVENT_PAGE_SIZE = 500

// Each drawing keeps its latest value for every touched pixel, including erasures.
// Trimming an event log loses pixels that were painted before the retained window.
export function mergeCompetitionDrawEvents(
  current: CompetitionDrawEvent[],
  updates: CompetitionDrawEvent[],
): CompetitionDrawEvent[] {
  const drawings = new Map<string, { event: CompetitionDrawEvent; pixels: Map<number, CompetitionDrawEvent['changes'][number]> }>()
  for (const event of [...current, ...updates].sort((a, b) => a.id - b.id)) {
    const key = `${event.round_id}:${event.drawing_id}`
    let drawing = drawings.get(key)
    if (!drawing) {
      drawing = { event, pixels: new Map() }
      drawings.set(key, drawing)
    }
    for (const change of event.changes) drawing.pixels.set(change.y * 32 + change.x, { ...change })
    drawing.event = event
  }
  return [...drawings.values()].map(({ event, pixels }) => ({
    ...event,
    changes: [...pixels.values()],
  })).sort((a, b) => a.id - b.id)
}

export async function loadCompetitionDrawingStream(
  loadPage: (afterEventId: number | null, limit: number) => Promise<CompetitionDrawEvent[]>,
  afterEventId: number | null = null,
): Promise<CompetitionDrawEvent[]> {
  let cursor = afterEventId
  let drawings: CompetitionDrawEvent[] = []
  for (;;) {
    const page = await loadPage(cursor, COMPETITION_EVENT_PAGE_SIZE)
    if (page.length === 0) return drawings
    // The RPC contract is ascending IDs strictly after the requested cursor.
    // Reject broken paging rather than loop forever or silently show a partial drawing.
    for (const event of page) {
      if (!Number.isSafeInteger(event.id) || (cursor !== null && event.id <= cursor)) {
        throw new Error('COMPETITION_EVENT_CURSOR_INVALID')
      }
      cursor = event.id
    }
    drawings = mergeCompetitionDrawEvents(drawings, page)
    if (page.length < COMPETITION_EVENT_PAGE_SIZE) return drawings
  }
}
