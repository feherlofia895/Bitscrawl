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
const MIN_ZOOM = 1
const ZOOM_BUTTON_STEP = 0.5
const CANVAS_SURFACE_RATIO = 0.93
const CENTERED_CANVAS_OFFSET = (1 - CANVAS_SURFACE_RATIO) / 2

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
type CanvasPan = { x: number; y: number }
type PanGesture = {
  origin: CanvasPan
  startX: number
  startY: number
}
type PointerPosition = { clientX: number; clientY: number }
type PinchGesture = {
  contentX: number
  contentY: number
  startDistance: number
  startZoom: number
}

function pointerDistance(first: PointerPosition, second: PointerPosition) {
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
}

function pointerMidpoint(first: PointerPosition, second: PointerPosition) {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
  }
}

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
  const canvasFrameRef = useRef<HTMLDivElement>(null)
  const pixelsRef = useRef<string[]>(
    Array.from({ length: CANVAS_SIZE * CANVAS_SIZE }, () => TRANSPARENT),
  )
  const appliedEventIdsRef = useRef(new Set<number>())
  const pendingChangesRef = useRef(new Map<string, PixelChange>())
  const flushTimerRef = useRef<number | undefined>(undefined)
  const sendQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const isDrawingRef = useRef(false)
  const isPanningRef = useRef(false)
  const panGestureRef = useRef<PanGesture | null>(null)
  const activePointersRef = useRef(new Map<number, PointerPosition>())
  const pinchGestureRef = useRef<PinchGesture | null>(null)
  const pendingTouchFillRef = useRef<{
    pointerId: number
    point: PixelPoint
  } | null>(null)
  const lastPointRef = useRef<PixelPoint | null>(null)
  const activeStrokeRef = useRef<Map<string, PixelMutation> | null>(null)
  const undoHistoryRef = useRef<PixelMutation[][]>([])
  const [activeColor, setActiveColor] = useState(pixelPalette[0])
  const [activeTool, setActiveTool] = useState<DrawingTool>('pencil')
  const [canUndo, setCanUndo] = useState(false)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const zoomRef = useRef(MIN_ZOOM)
  const [pan, setPan] = useState<CanvasPan>({
    x: CENTERED_CANVAS_OFFSET,
    y: CENTERED_CANVAS_OFFSET,
  })
  const panRef = useRef<CanvasPan>({
    x: CENTERED_CANVAS_OFFSET,
    y: CENTERED_CANVAS_OFFSET,
  })
  const [isPanMode, setIsPanMode] = useState(false)
  const [showGrid, setShowGrid] = useState(false)
  const drawingColor = activeTool === 'eraser' ? TRANSPARENT : activeColor

  const maximumZoom = () => {
    const frameWidth = canvasFrameRef.current?.getBoundingClientRect().width ?? 680
    return Math.max(3, Math.min(8, 2048 / (frameWidth * CANVAS_SURFACE_RATIO)))
  }

  const clampZoom = (nextZoom: number) =>
    Math.max(MIN_ZOOM, Math.min(maximumZoom(), nextZoom))

  const clampPan = (nextPan: CanvasPan, nextZoom = zoom) => {
    const surfaceSize = CANVAS_SURFACE_RATIO * nextZoom
    if (surfaceSize <= 1) {
      const centeredOffset = (1 - surfaceSize) / 2
      return { x: centeredOffset, y: centeredOffset }
    }

    const minimum = 1 - surfaceSize
    return {
      x: Math.max(minimum, Math.min(0, nextPan.x)),
      y: Math.max(minimum, Math.min(0, nextPan.y)),
    }
  }

  const updatePan = (nextPan: CanvasPan, nextZoom = zoomRef.current) => {
    const clampedPan = clampPan(nextPan, nextZoom)
    panRef.current = clampedPan
    setPan(clampedPan)
  }

  const changeZoom = (
    requestedZoom: number,
    anchor: CanvasPan = { x: 0.5, y: 0.5 },
  ) => {
    const currentZoom = zoomRef.current
    const nextZoom = clampZoom(requestedZoom)
    const currentSurfaceSize = CANVAS_SURFACE_RATIO * currentZoom
    const nextSurfaceSize = CANVAS_SURFACE_RATIO * nextZoom
    const contentX = (anchor.x - panRef.current.x) / currentSurfaceSize
    const contentY = (anchor.y - panRef.current.y) / currentSurfaceSize

    updatePan(
      {
        x: anchor.x - contentX * nextSurfaceSize,
        y: anchor.y - contentY * nextSurfaceSize,
      },
      nextZoom,
    )
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    if (nextZoom === MIN_ZOOM) setIsPanMode(false)
  }

  const stepZoom = (direction: -1 | 1) =>
    changeZoom(zoomRef.current + direction * ZOOM_BUTTON_STEP)

  const selectDrawingTool = (tool: DrawingTool) => {
    setActiveTool(tool)
    setIsPanMode(false)
  }

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

  const cancelActiveStroke = () => {
    activeStrokeRef.current?.forEach(({ before, x, y }) => {
      paintPixel({ x, y, color: before })
      pendingChangesRef.current.set(pixelKey({ x, y }), {
        x,
        y,
        color: before,
      })
    })
    if (activeStrokeRef.current?.size) scheduleFlush()
    activeStrokeRef.current = null
    isDrawingRef.current = false
    lastPointRef.current = null
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

  const startPan = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    panGestureRef.current = {
      origin: panRef.current,
      startX: event.clientX,
      startY: event.clientY,
    }
    isPanningRef.current = true
  }

  const movePan = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = panGestureRef.current
    const frameBounds = canvasFrameRef.current?.getBoundingClientRect()
    if (!gesture || !frameBounds) return

    updatePan({
        x: gesture.origin.x + (event.clientX - gesture.startX) / frameBounds.width,
        y: gesture.origin.y + (event.clientY - gesture.startY) / frameBounds.height,
    })
  }

  const finishPan = () => {
    isPanningRef.current = false
    panGestureRef.current = null
  }

  const startPinch = () => {
    const frameBounds = canvasFrameRef.current?.getBoundingClientRect()
    const pointers = [...activePointersRef.current.values()].slice(0, 2)
    if (!frameBounds || pointers.length < 2) return

    const midpoint = pointerMidpoint(pointers[0], pointers[1])
    const anchorX = (midpoint.clientX - frameBounds.left) / frameBounds.width
    const anchorY = (midpoint.clientY - frameBounds.top) / frameBounds.height
    const currentSurfaceSize = CANVAS_SURFACE_RATIO * zoomRef.current

    pinchGestureRef.current = {
      contentX: (anchorX - panRef.current.x) / currentSurfaceSize,
      contentY: (anchorY - panRef.current.y) / currentSurfaceSize,
      startDistance: Math.max(1, pointerDistance(pointers[0], pointers[1])),
      startZoom: zoomRef.current,
    }
  }

  const movePinch = () => {
    const gesture = pinchGestureRef.current
    const frameBounds = canvasFrameRef.current?.getBoundingClientRect()
    const pointers = [...activePointersRef.current.values()].slice(0, 2)
    if (!gesture || !frameBounds || pointers.length < 2) return

    const midpoint = pointerMidpoint(pointers[0], pointers[1])
    const anchorX = (midpoint.clientX - frameBounds.left) / frameBounds.width
    const anchorY = (midpoint.clientY - frameBounds.top) / frameBounds.height
    const nextZoom = clampZoom(
      gesture.startZoom *
        (pointerDistance(pointers[0], pointers[1]) / gesture.startDistance),
    )
    const nextSurfaceSize = CANVAS_SURFACE_RATIO * nextZoom

    updatePan(
      {
        x: anchorX - gesture.contentX * nextSurfaceSize,
        y: anchorY - gesture.contentY * nextSurfaceSize,
      },
      nextZoom,
    )
    zoomRef.current = nextZoom
    setZoom(nextZoom)
    if (nextZoom === MIN_ZOOM) setIsPanMode(false)
  }

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    const frameBounds = canvasFrameRef.current?.getBoundingClientRect()
    if (!frameBounds) return

    changeZoom(zoomRef.current * Math.exp(-event.deltaY * 0.0015), {
      x: (event.clientX - frameBounds.left) / frameBounds.width,
      y: (event.clientY - frameBounds.top) / frameBounds.height,
    })
  }

  useEffect(() => {
    pixelsRef.current.fill(TRANSPARENT)
    appliedEventIdsRef.current.clear()
    pendingChangesRef.current.clear()
    undoHistoryRef.current = []
    activeStrokeRef.current = null
    isDrawingRef.current = false
    isPanningRef.current = false
    panGestureRef.current = null
    activePointersRef.current.clear()
    pinchGestureRef.current = null
    pendingTouchFillRef.current = null
    lastPointRef.current = null
    setCanUndo(false)
    zoomRef.current = MIN_ZOOM
    setZoom(MIN_ZOOM)
    panRef.current = {
      x: CENTERED_CANVAS_OFFSET,
      y: CENTERED_CANVAS_OFFSET,
    }
    setPan(panRef.current)
    setIsPanMode(false)
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

  useEffect(() => {
    const frame = canvasFrameRef.current
    if (!frame) return

    frame.addEventListener('wheel', handleWheel, { passive: false })
    return () => frame.removeEventListener('wheel', handleWheel)
  }, [])

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
              onClick={() => selectDrawingTool('pencil')}
              type="button"
            >
              Ceruza
            </button>
            <button
              aria-pressed={activeTool === 'eraser'}
              onClick={() => selectDrawingTool('eraser')}
              type="button"
            >
              Radír
            </button>
            <button
              aria-pressed={activeTool === 'fill'}
              onClick={() => selectDrawingTool('fill')}
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
                  selectDrawingTool('pencil')
                }}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="canvas-zoom-controls" aria-label="Vászon nagyítása">
        <span>Nagyító</span>
        <button
          aria-label="Kicsinyítés"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => stepZoom(-1)}
          type="button"
        >
          −
        </button>
        <output aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button
          aria-label="Nagyítás"
          disabled={zoom >= maximumZoom()}
          onClick={() => stepZoom(1)}
          type="button"
        >
          +
        </button>
        <button
          disabled={zoom === MIN_ZOOM}
          onClick={() => changeZoom(MIN_ZOOM)}
          type="button"
        >
          100%
        </button>
        <button
          aria-pressed={isPanMode}
          disabled={zoom === MIN_ZOOM}
          onClick={() => setIsPanMode((current) => !current)}
          type="button"
        >
          Mozgatás
        </button>
        <button
          aria-pressed={showGrid}
          onClick={() => setShowGrid((current) => !current)}
          type="button"
        >
          Rács
        </button>
      </div>

      <div className="pixel-canvas-frame" ref={canvasFrameRef}>
        <div
          className={`pixel-canvas-surface${showGrid ? ' show-grid' : ''}`}
          style={{
            height: `${CANVAS_SURFACE_RATIO * zoom * 100}%`,
            left: `${pan.x * 100}%`,
            top: `${pan.y * 100}%`,
            width: `${CANVAS_SURFACE_RATIO * zoom * 100}%`,
          }}
        >
          <canvas
            aria-label={canDraw ? 'Rajzolható 32×32 pixeles vászon' : 'Élő pixelrajz'}
            className={`drawing-canvas${isPanMode ? ' is-pan-mode' : ''}${
              isPanningRef.current ? ' is-panning' : ''
            }`}
            height={CANVAS_SIZE}
            onContextMenu={(event) => event.preventDefault()}
            onPointerCancel={(event) => {
              activePointersRef.current.delete(event.pointerId)
              if (pendingTouchFillRef.current?.pointerId === event.pointerId) {
                pendingTouchFillRef.current = null
              }
              if (pinchGestureRef.current) {
                if (activePointersRef.current.size < 2) {
                  pinchGestureRef.current = null
                }
                return
              }
              if (isPanningRef.current) {
                finishPan()
                return
              }
              finishStroke()
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              activePointersRef.current.set(event.pointerId, {
                clientX: event.clientX,
                clientY: event.clientY,
              })
              event.currentTarget.setPointerCapture(event.pointerId)

              if (
                event.pointerType === 'touch' &&
                activePointersRef.current.size >= 2
              ) {
                cancelActiveStroke()
                pendingTouchFillRef.current = null
                finishPan()
                startPinch()
                return
              }

              if (activePointersRef.current.size > 1) return

              if (isPanMode && zoom > 1) {
                startPan(event)
                return
              }

              if (!canDraw) return
              const point = pointFromEvent(event)

              if (activeTool === 'fill') {
                if (event.pointerType === 'touch') {
                  pendingTouchFillRef.current = {
                    pointerId: event.pointerId,
                    point,
                  }
                  return
                }
                fillArea(point)
                return
              }

              activeStrokeRef.current = new Map()
              isDrawingRef.current = true
              drawTo(point)
            }}
            onPointerMove={(event) => {
              event.preventDefault()

              if (activePointersRef.current.has(event.pointerId)) {
                activePointersRef.current.set(event.pointerId, {
                  clientX: event.clientX,
                  clientY: event.clientY,
                })
              }

              if (pinchGestureRef.current) {
                movePinch()
                return
              }

              if (isPanningRef.current) {
                movePan(event)
                return
              }

              if (!canDraw || !isDrawingRef.current) return
              drawTo(pointFromEvent(event))
            }}
            onPointerUp={(event) => {
              event.preventDefault()
              const wasPinching = pinchGestureRef.current !== null
              activePointersRef.current.delete(event.pointerId)
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }

              if (wasPinching) {
                if (activePointersRef.current.size < 2) {
                  pinchGestureRef.current = null
                }
                return
              }

              if (pendingTouchFillRef.current?.pointerId === event.pointerId) {
                const { point } = pendingTouchFillRef.current
                pendingTouchFillRef.current = null
                fillArea(point)
                return
              }

              if (isPanningRef.current) {
                finishPan()
                return
              }

              if (!canDraw || !isDrawingRef.current) return
              finishStroke()
            }}
            ref={canvasRef}
            width={CANVAS_SIZE}
          />
        </div>
      </div>
      <p className="canvas-navigation-hint">
        Görgess a vásznon vagy csippents két ujjal a nagyításhoz. Mozgatás módban
        nyomva tartva húzhatod a rajzot.
      </p>
    </section>
  )
}
