import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { DrawEvent, PixelChange } from '../lib/game'

const CANVAS_SIZE = 32
const TRANSPARENT = 'transparent'
const MAX_UNDO_STEPS = 50

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
type DrawingTool = 'pencil' | 'eraser' | 'fill'
type PixelMutation = PixelChange & { before: string }

function pixelKey(point: PixelPoint) {
  return `${point.x}-${point.y}`
}

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

function connectedPixels(pixels: string[], start: PixelPoint) {
  const targetColor = pixels[start.y * CANVAS_SIZE + start.x]
  const result: PixelPoint[] = []
  const queue = [start.y * CANVAS_SIZE + start.x]
  const visited = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE)
  visited[queue[0]] = 1

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const index = queue[queueIndex]
    const x = index % CANVAS_SIZE
    const y = Math.floor(index / CANVAS_SIZE)
    result.push({ x, y })

    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < CANVAS_SIZE - 1 ? index + 1 : -1,
      y > 0 ? index - CANVAS_SIZE : -1,
      y < CANVAS_SIZE - 1 ? index + CANVAS_SIZE : -1,
    ]

    neighbours.forEach((neighbour) => {
      if (
        neighbour >= 0 &&
        visited[neighbour] === 0 &&
        pixels[neighbour] === targetColor
      ) {
        visited[neighbour] = 1
        queue.push(neighbour)
      }
    })
  }

  return result
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
  const activeStrokeRef = useRef<Map<string, PixelMutation> | null>(null)
  const undoHistoryRef = useRef<PixelMutation[][]>([])
  const [activeColor, setActiveColor] = useState(pixelPalette[0])
  const [activeTool, setActiveTool] = useState<DrawingTool>('pencil')
  const [canUndo, setCanUndo] = useState(false)
  const drawingColor = activeTool === 'eraser' ? TRANSPARENT : activeColor

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

  const queueChange = (change: PixelChange) => {
    const index = change.y * CANVAS_SIZE + change.x
    if (pixelsRef.current[index] === change.color) return false

    paintPixel(change)
    pendingChangesRef.current.set(pixelKey(change), change)
    scheduleFlush()
    return true
  }

  const saveUndoStep = (mutations: PixelMutation[]) => {
    const changedMutations = mutations.filter(
      (mutation) => mutation.before !== mutation.color,
    )
    if (changedMutations.length === 0) return

    undoHistoryRef.current.push(changedMutations)
    if (undoHistoryRef.current.length > MAX_UNDO_STEPS) {
      undoHistoryRef.current.shift()
    }
    setCanUndo(true)
  }

  const finishStroke = () => {
    if (activeStrokeRef.current) {
      saveUndoStep([...activeStrokeRef.current.values()])
    }
    activeStrokeRef.current = null
    isDrawingRef.current = false
    lastPointRef.current = null
    flushPendingChanges()
  }

  const queueStrokePixel = (point: PixelPoint) => {
    const index = point.y * CANVAS_SIZE + point.x
    const before = pixelsRef.current[index]
    if (before === drawingColor) return

    const key = pixelKey(point)
    const existingMutation = activeStrokeRef.current?.get(key)
    if (existingMutation) {
      existingMutation.color = drawingColor
    } else {
      activeStrokeRef.current?.set(key, { ...point, before, color: drawingColor })
    }
    queueChange({ ...point, color: drawingColor })
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
    pointsOnLine(from, point).forEach(queueStrokePixel)
    lastPointRef.current = point
  }

  const fillArea = (point: PixelPoint) => {
    const originalPixels = [...pixelsRef.current]
    const targetColor = originalPixels[point.y * CANVAS_SIZE + point.x]
    if (targetColor === activeColor) return

    const mutations = connectedPixels(originalPixels, point).map((pixel) => ({
      ...pixel,
      before: targetColor,
      color: activeColor,
    }))
    mutations.forEach(queueChange)
    saveUndoStep(mutations)
    flushPendingChanges()
  }

  const undoLastStep = () => {
    if (isDrawingRef.current) return

    flushPendingChanges()
    const mutations = undoHistoryRef.current.pop()
    if (!mutations) return

    mutations.forEach(({ before, x, y }) => {
      queueChange({ x, y, color: before })
    })
    flushPendingChanges()
    setCanUndo(undoHistoryRef.current.length > 0)
  }

  useEffect(() => {
    pixelsRef.current.fill(TRANSPARENT)
    appliedEventIdsRef.current.clear()
    pendingChangesRef.current.clear()
    undoHistoryRef.current = []
    activeStrokeRef.current = null
    isDrawingRef.current = false
    lastPointRef.current = null
    setCanUndo(false)
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
              aria-pressed={activeTool === 'pencil'}
              onClick={() => setActiveTool('pencil')}
              type="button"
            >
              Ceruza
            </button>
            <button
              aria-pressed={activeTool === 'eraser'}
              onClick={() => setActiveTool('eraser')}
              type="button"
            >
              Radír
            </button>
            <button
              aria-pressed={activeTool === 'fill'}
              onClick={() => setActiveTool('fill')}
              type="button"
            >
              Kitöltés
            </button>
            <button disabled={!canUndo} onClick={undoLastStep} type="button">
              Visszavonás
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
                  setActiveTool('pencil')
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
          onContextMenu={(event) => event.preventDefault()}
          onPointerCancel={(event) => {
            if (!event.isPrimary) return
            finishStroke()
          }}
          onPointerDown={(event) => {
            if (!canDraw || !event.isPrimary) return
            event.preventDefault()
            const point = pointFromEvent(event)

            if (activeTool === 'fill') {
              fillArea(point)
              return
            }

            event.currentTarget.setPointerCapture(event.pointerId)
            activeStrokeRef.current = new Map()
            isDrawingRef.current = true
            drawTo(point)
          }}
          onPointerMove={(event) => {
            if (!canDraw || !event.isPrimary || !isDrawingRef.current) return
            event.preventDefault()
            drawTo(pointFromEvent(event))
          }}
          onPointerUp={(event) => {
            if (!canDraw || !event.isPrimary || !isDrawingRef.current) return
            event.preventDefault()
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            finishStroke()
          }}
          ref={canvasRef}
          width={CANVAS_SIZE}
        />
      </div>
    </section>
  )
}
