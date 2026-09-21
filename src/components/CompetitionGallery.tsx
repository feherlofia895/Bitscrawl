import { useEffect, useMemo, useRef } from 'react'
import type { CompetitionDrawEvent, CompetitionResult } from '../lib/competitionGame'

const SIZE = 32

function CompetitionPreview({ events, label }: { events: CompetitionDrawEvent[]; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixels = useMemo(() => {
    const next = Array<string>(SIZE * SIZE).fill('transparent')
    for (const event of events) {
      for (const change of event.changes) next[change.y * SIZE + change.x] = change.color
    }
    return next
  }, [events])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, SIZE, SIZE)
    pixels.forEach((color, index) => {
      if (color === 'transparent') return
      context.fillStyle = color
      context.fillRect(index % SIZE, Math.floor(index / SIZE), 1, 1)
    })
  }, [pixels])

  return <canvas aria-label={label} className="competition-preview" height={SIZE} ref={canvasRef} width={SIZE} />
}

type CompetitionGalleryProps = {
  events: CompetitionDrawEvent[]
  isVoting: boolean
  onVote: (userId: string) => void
  results: CompetitionResult[]
  votedForDrawingId: string | null
  votePending: boolean
}

export function CompetitionGallery({
  events,
  isVoting,
  onVote,
  results,
  votedForDrawingId,
  votePending,
}: CompetitionGalleryProps) {
  const eventsByUser = useMemo(() => {
    const grouped = new Map<string, CompetitionDrawEvent[]>()
    for (const event of events) {
      const current = grouped.get(event.drawing_id) ?? []
      current.push(event)
      grouped.set(event.drawing_id, current)
    }
    return grouped
  }, [events])

  return (
    <section aria-label={isVoting ? 'Névtelen szavazás' : 'Forduló eredménye'} className="competition-gallery">
      <div className="competition-gallery-heading">
        <strong>{isVoting ? 'Válaszd ki a kedvencedet!' : 'Fordulóeredmény'}</strong>
        {isVoting ? <span>A szavazatodat az idő lejártáig módosíthatod.</span> : null}
      </div>
      <div className="competition-drawing-grid">
        {results.map((result, index) => {
          const isOwn = result.is_own
          const isSelected = votedForDrawingId === result.drawing_id
          const label = isVoting
            ? isOwn ? 'A te rajzod' : `${index + 1}. névtelen rajz`
            : result.display_name ?? `${index + 1}. rajz`
          return (
            <article className={`competition-drawing-card${isSelected ? ' is-selected' : ''}`} key={result.drawing_id}>
              <CompetitionPreview events={eventsByUser.get(result.drawing_id) ?? []} label={label} />
              <div className="competition-drawing-meta">
                <strong>{label}</strong>
                {!isVoting ? <span>{result.vote_count ?? 0} szavazat</span> : null}
              </div>
              {isVoting ? (
                <button
                  aria-pressed={isSelected}
                  className="competition-vote-button"
                  disabled={isOwn || votePending}
                  onClick={() => onVote(result.drawing_id)}
                  type="button"
                >
                  {isOwn ? 'Saját rajz' : isSelected ? 'Kiválasztva' : 'Erre szavazok'}
                </button>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
