import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { DrawEvent, PixelChange } from '../lib/game'

const CANVAS_SIZE = 32
const TRANSPARENT = 'transparent'

const pixelPalette = [
  '#241a35',
  '#f7f3e8',
  '#9b7ede',
  '#4ecdc4',
  '#ffd166',
  '#ff6b6b',
  '#4d96ff',
  '#7b8794',
]

type PixelCanvasProps = {
  canDraw: boolean
  events: DrawEvent[]
  onError: (error: unknown) => void
  onSubmit: (changes: PixelChange[]) => Promise<unknown>
  roundId: number
}

type PixelPoint = { x: number; y: number }

function pointsOnLine(from: PixelPoint, to: PixelPoint) {
  const points: PixelPoint[] = []
  const deltaX = Math.abs(to.x - from.x)
  const deltaY = Math.abs(to.y - from.y)
  const stepX = from.x < to.x ? 1 : -1
  const stepY = from.y < to.y ? 1 : -1
  let error = deltaX - deltaY
  let x = from.x
  let y = from.y

  while (true) {
    points.push({ x, y })
    if (x === to.x && y === to.y) break

    const doubledError = error * 2
    if (doubledError > -deltaY) {
      error -= deltaY
      x += stepX
    }
    if (doubledError < deltaX) {
      error += deltaX
      y += stepY
    }
  }

  return points
}

export function PixelCanvas({
  canDraw,
  events,
  onError,
  onSubmit,
  roundId,
}: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixelsRef = useRef<string[]>(
    Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, () => TRANSPARENT),
  )
  const appliedEventIdsRef = useRef(new Set<number>())
  const pendingChangesRef = useRef(new Map<string, PixelChange>())
  const flushTimerRef = useRef<number | undefined>(undefined)
  const sendQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const isDrawingRef = useRef(false)
  const lastPointRef = useRef<PixelPoint | null>(null)
  const [activeColor, setActiveColor] = useState(pixelPalette[0])
  const [lastPencilColor, setLastPencilColor] = useState(pixelPalette[0])

  const paintPixel = (change: PixelChange) => {
    pixelsRef.current[change.y * CANVAS_SIZE + change.x] = change.color
    const context = canvasRef.current?.getContext('2d')
    if (!context) return

    context.clearRect(change.x, change.y, 1, 1)
    if (change.color !== TRANSPARENT) {
      context.fillStyle = change.color
      context.fillRect(change.x, change.y, 1, 1)
    }
  }

  const flushPendingChanges = () => {
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = undefined
    }

    const changes = [...pendingChangesRef.current.values()]
    pendingChangesRef.current.clear()

    for (let index = 0; index < changes.length; index += 64) {
      const chunk = changes.slice(index, index + 64)
      sendQueueRef.current = sendQueueRef.current
        .then(() => onSubmit(chunk))
        .catch((error) => {
          onError(error)
        })
    }
  }

  const scheduleFlush = () => {
    if (flushTimerRef.current !== undefined) return
    flushTimerRef.current = window.setTimeout(flushPendingChanges, 80)
  }

  const queuePixel = (point: PixelPoint) => {
    const change = { ...point, color: activeColor }
    paintPixel(change)
    pendingChangesRef.current.set(`${point.x}-${point.y}`, change)
    scheduleFlush()
  }

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(
          CANVAS_SIZE - 1,
          Math.floor(((event.clientX - bounds.left) / bounds.width) * CANVAS_SIZE),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          CANVAS_SIZE - 1,
          Math.floor(((event.clientY - bounds.top) / bounds.height) * CANVAS_SIZE),
        ),
      ),
    }
  }

  const drawTo = (point: PixelPoint) => {
    const from = lastPointRef.current ?? point
    pointsOnLine(from, point).forEach(queuePixel)
    lastPointRef.current = point
  }

  useEffect(() => {
    pixelsRef.current.fill(TRANSPARENT)
    appliedEventIdsRef.current.clear()
    pendingChangesRef.current.clear()
    const context = canvasRef.current?.getContext('2d')
    context?.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  }, [roundId])

  useEffect(() => {
    events.forEach((event) => {
      if (appliedEventIdsRef.current.has(event.id)) return
      event.changes.forEach(paintPixel)
      appliedEventIdsRef.current.add(event.id)
    })
  }, [events])

  useEffect(
    () => () => {
      if (flushTimerRef.current !== undefined) {
        window.clearTimeout(flushTimerRef.current)
      }
    },
    [],
  )

  return (
    <section className="pixel-editor" aria-labelledby="pixel-editor-title">
      <div className="pixel-editor-heading">
        <div>
          <p className="round-label">32 × 32 pixel</p>
          <h3 id="pixel-editor-title">
            {canDraw ? 'Pixelvászon' : 'Élő rajz'}
          </h3>
        </div>
        <span className="draw-mode-badge">{canDraw ? 'Te rajzolsz' : 'Néző mód'}</span>
      </div>

      {canDraw ? (
        <div className="pixel-toolbar" aria-label="Rajzeszközök">
          <div className="tool-buttons">
            <button
              aria-pressed={activeColor !== TRANSPARENT}
              onClick={() => setActiveColor(lastPencilColor)}
              type="button"
            >
              Ceruza
            </button>
            <button
              aria-pressed={activeColor === TRANSPARENT}
              onClick={() => setActiveColor(TRANSPARENT)}
              type="button"
            >
              Radír
            </button>
          </div>
          <div className="drawing-palette" aria-label="Színpaletta">
            {pixelPalette.map((color) => (
              <button
                aria-label={`Szín ${color}`}
                aria-pressed={activeColor === color}
                key={color}
                onClick={() => {
                  setActiveColor(color)
                  setLastPencilColor(color)
                }}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="pixel-canvas-frame">
        <canvas
          aria-label={canDraw ? 'Rajzolható 32×32 pixeles vászon' : 'Élő pixelrajz'}
          className="drawing-canvas"
          height={CANVAS_SIZE}
          onPointerCancel={() => {
            isDrawingRef.current = false
            lastPointRef.current = null
            flushPendingChanges()
          }}
          onPointerDown={(event) => {
            if (!canDraw) return
            event.currentTarget.setPointerCapture(event.pointerId)
            isDrawingRef.current = true
            drawTo(pointFromEvent(event))
          }}
          onPointerMove={(event) => {
            if (!canDraw || !isDrawingRef.current) return
            drawTo(pointFromEvent(event))
          }}
          onPointerUp={(event) => {
            if (!canDraw) return
            event.currentTarget.releasePointerCapture(event.pointerId)
            isDrawingRef.current = false
            lastPointRef.current = null
            flushPendingChanges()
          }}
          ref={canvasRef}
          width={CANVAS_SIZE}
        />
      </div>
    </section>
  )
}
