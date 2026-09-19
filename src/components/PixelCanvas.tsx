import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { DrawEvent, PixelChange } from '../lib/game'
import { colorsForPalette, type PaletteSize } from '../lib/palette'
import { editorText } from '../lib/editorText'

const CANVAS_SIZE = 32
const TRANSPARENT = 'transparent'
const MAX_UNDO_STEPS = 50
const MIN_ZOOM = 1
const ZOOM_BUTTON_STEP = 0.5
const CANVAS_SURFACE_RATIO = 0.93
const CENTERED_CANVAS_OFFSET = (1 - CANVAS_SURFACE_RATIO) / 2
const PIXEL_COORDINATES = Array.from(
  { length: CANVAS_SIZE },
  (_, index) => index + 1,
)

type PixelCanvasProps = {
  localDrawing?: {
    initialPixels: string[]
    onChange: (pixels: string[]) => void
    onRequestClear?: (clear: () => void) => void
  }
  canDraw: boolean
  chosenWord: string | null
  drawingEndsAt: string | null
  events: DrawEvent[]
  onError: (error: unknown) => void
  onSubmit: (changes: PixelChange[]) => Promise<unknown>
  paletteSize: PaletteSize
  roundId: number
  serverNow: string
}

type PixelPoint = { x: number; y: number }
type DrawingTool =
  | 'pencil'
  | 'eraser'
  | 'fill'
  | 'line'
  | 'rectangle'
  | 'ellipse'
type PixelMutation = PixelChange & { before: string }
type ShapeTool = Extract<DrawingTool, 'line' | 'rectangle' | 'ellipse'>
type ShapeGesture = {
  current: PixelPoint
  start: PixelPoint
  tool: ShapeTool
}
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

function uniquePoints(points: PixelPoint[]) {
  return [...new Map(points.map((point) => [pixelKey(point), point])).values()]
}

function pointsOnRectangle(from: PixelPoint, to: PixelPoint) {
  const left = Math.min(from.x, to.x)
  const right = Math.max(from.x, to.x)
  const top = Math.min(from.y, to.y)
  const bottom = Math.max(from.y, to.y)
  const points: PixelPoint[] = []

  for (let x = left; x <= right; x += 1) {
    points.push({ x, y: top }, { x, y: bottom })
  }
  for (let y = top; y <= bottom; y += 1) {
    points.push({ x: left, y }, { x: right, y })
  }

  return uniquePoints(points)
}

function pointsOnEllipse(from: PixelPoint, to: PixelPoint) {
  const left = Math.min(from.x, to.x)
  const right = Math.max(from.x, to.x)
  const top = Math.min(from.y, to.y)
  const bottom = Math.max(from.y, to.y)
  if (left === right || top === bottom) return pointsOnLine(from, to)

  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  const radiusX = (right - left) / 2
  const radiusY = (bottom - top) / 2
  const samples = Math.max(24, Math.ceil(2 * Math.PI * Math.max(radiusX, radiusY) * 2))
  const points: PixelPoint[] = []

  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * Math.PI * 2
    points.push({
      x: Math.round(centerX + Math.cos(angle) * radiusX),
      y: Math.round(centerY + Math.sin(angle) * radiusY),
    })
  }

  return uniquePoints(points)
}

function pointsForShape(gesture: ShapeGesture) {
  if (gesture.tool === 'line') {
    return pointsOnLine(gesture.start, gesture.current)
  }
  if (gesture.tool === 'rectangle') {
    return pointsOnRectangle(gesture.start, gesture.current)
  }
  return pointsOnEllipse(gesture.start, gesture.current)
}

function isShapeTool(tool: DrawingTool): tool is ShapeTool {
  return tool === 'line' || tool === 'rectangle' || tool === 'ellipse'
}

const toolButtons: Array<{
  icon: string
  label: string
  tool: DrawingTool
}> = [
  { icon: 'pencil', label: 'Ceruza', tool: 'pencil' },
  { icon: 'eraser', label: 'Radír', tool: 'eraser' },
  { icon: 'fill', label: 'Kitöltés', tool: 'fill' },
  { icon: 'line', label: 'Egyenes vonal', tool: 'line' },
  { icon: 'rectangle', label: 'Négyzet vagy téglalap', tool: 'rectangle' },
  { icon: 'ellipse', label: 'Kör vagy ellipszis', tool: 'ellipse' },
]

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
  localDrawing,
  canDraw,
  chosenWord,
  drawingEndsAt,
  events,
  onError,
  onSubmit,
  paletteSize,
  roundId,
  serverNow,
}: PixelCanvasProps) {
  const localDrawingRef = useRef(localDrawing)
  useEffect(() => { localDrawingRef.current = localDrawing })
  const pixelPalette = colorsForPalette(paletteSize)
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
  const shapeGestureRef = useRef<ShapeGesture | null>(null)
  const undoHistoryRef = useRef<PixelMutation[][]>([])
  const [activeColor, setActiveColor] = useState(pixelPalette[0].hex)
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
  const [showCoordinates, setShowCoordinates] = useState(false)
  const [isImmersive, setIsImmersive] = useState(false)
  const [areImmersiveToolsOpen, setAreImmersiveToolsOpen] = useState(false)
  const [isImmersivePaletteOpen, setIsImmersivePaletteOpen] = useState(false)
  const [immersiveSecondsLeft, setImmersiveSecondsLeft] = useState<number | null>(
    null,
  )
  const drawingColor = activeTool === 'eraser' ? TRANSPARENT : activeColor

  const maximumZoom = () => {
    const frameWidth = canvasFrameRef.current?.getBoundingClientRect().width ?? 680
    return Math.max(3, Math.min(8, 2048 / (frameWidth * CANVAS_SURFACE_RATIO)))
  }

  const clampZoom = (nextZoom: number) =>
    Math.max(MIN_ZOOM, Math.min(maximumZoom(), nextZoom))

  const surfaceRatios = (nextZoom: number) => {
    const frameBounds = canvasFrameRef.current?.getBoundingClientRect()
    if (!frameBounds || frameBounds.width === 0 || frameBounds.height === 0) {
      const ratio = CANVAS_SURFACE_RATIO * nextZoom
      return { x: ratio, y: ratio }
    }

    const baseSize = Math.min(frameBounds.width, frameBounds.height)
    return {
      x: (baseSize / frameBounds.width) * CANVAS_SURFACE_RATIO * nextZoom,
      y: (baseSize / frameBounds.height) * CANVAS_SURFACE_RATIO * nextZoom,
    }
  }

  const clampPan = (nextPan: CanvasPan, nextZoom = zoom) => {
    const surface = surfaceRatios(nextZoom)
    const clampAxis = (offset: number, size: number) => {
      if (size <= 1) return (1 - size) / 2
      return Math.max(1 - size, Math.min(0, offset))
    }
    return {
      x: clampAxis(nextPan.x, surface.x),
      y: clampAxis(nextPan.y, surface.y),
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
    const currentSurface = surfaceRatios(currentZoom)
    const nextSurface = surfaceRatios(nextZoom)
    const contentX = (anchor.x - panRef.current.x) / currentSurface.x
    const contentY = (anchor.y - panRef.current.y) / currentSurface.y

    updatePan(
      {
        x: anchor.x - contentX * nextSurface.x,
        y: anchor.y - contentY * nextSurface.y,
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

  const redrawCanvas = (previewPoints: PixelPoint[] = []) => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return

    context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    pixelsRef.current.forEach((color, index) => {
      if (color === TRANSPARENT) return
      context.fillStyle = color
      context.fillRect(index % CANVAS_SIZE, Math.floor(index / CANVAS_SIZE), 1, 1)
    })

    context.fillStyle = activeColor
    previewPoints.forEach(({ x, y }) => context.fillRect(x, y, 1, 1))
  }

  const flushPendingChanges = () => {
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = undefined
    }

    const changes = [...pendingChangesRef.current.values()]
    pendingChangesRef.current.clear()

    if (localDrawing) {
      if (changes.length) localDrawing.onChange([...pixelsRef.current])
      return
    }

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

  const previewShape = (point: PixelPoint) => {
    const gesture = shapeGestureRef.current
    if (!gesture) return
    gesture.current = point
    redrawCanvas(pointsForShape(gesture))
  }

  const finishShape = (point?: PixelPoint) => {
    const gesture = shapeGestureRef.current
    if (!gesture) return
    if (point) gesture.current = point

    const mutations = pointsForShape(gesture).map((pixel) => ({
      ...pixel,
      before: pixelsRef.current[pixel.y * CANVAS_SIZE + pixel.x],
      color: activeColor,
    }))
    shapeGestureRef.current = null
    mutations.forEach(queueChange)
    saveUndoStep(mutations)
    flushPendingChanges()
    redrawCanvas()
  }

  const cancelShape = () => {
    shapeGestureRef.current = null
    redrawCanvas()
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

  const clearCanvas = () => {
    if (!canDraw || isDrawingRef.current || shapeGestureRef.current) return

    const mutations = pixelsRef.current.flatMap((color, index) =>
      color === TRANSPARENT
        ? []
        : [
            {
              before: color,
              color: TRANSPARENT,
              x: index % CANVAS_SIZE,
              y: Math.floor(index / CANVAS_SIZE),
            },
          ],
    )
    if (mutations.length === 0) return
    if (localDrawing?.onRequestClear) {
      localDrawing.onRequestClear(() => {
        flushPendingChanges()
        mutations.forEach(queueChange)
        saveUndoStep(mutations)
        flushPendingChanges()
      })
      return
    }
    if (!window.confirm('Biztosan törlöd a teljes rajzot?')) return

    flushPendingChanges()
    mutations.forEach(queueChange)
    saveUndoStep(mutations)
    flushPendingChanges()
  }

  const enterImmersiveMode = () => {
    setAreImmersiveToolsOpen(false)
    setIsImmersivePaletteOpen(false)
    zoomRef.current = MIN_ZOOM
    setZoom(MIN_ZOOM)
    setIsPanMode(false)
    setIsImmersive(true)
  }

  const exitImmersiveMode = () => {
    setAreImmersiveToolsOpen(false)
    setIsImmersivePaletteOpen(false)
    setIsImmersive(false)
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
    const currentSurface = surfaceRatios(zoomRef.current)

    pinchGestureRef.current = {
      contentX: (anchorX - panRef.current.x) / currentSurface.x,
      contentY: (anchorY - panRef.current.y) / currentSurface.y,
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
    const nextSurface = surfaceRatios(nextZoom)

    updatePan(
      {
        x: anchorX - gesture.contentX * nextSurface.x,
        y: anchorY - gesture.contentY * nextSurface.y,
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
    const localSource = localDrawingRef.current
    pixelsRef.current = localSource
      ? [...localSource.initialPixels]
      : Array<string>(CANVAS_SIZE * CANVAS_SIZE).fill(TRANSPARENT)
    appliedEventIdsRef.current.clear()
    pendingChangesRef.current.clear()
    undoHistoryRef.current = []
    activeStrokeRef.current = null
    shapeGestureRef.current = null
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
    if (context && localSource) {
      pixelsRef.current.forEach((color, index) => {
        if (color === TRANSPARENT) return
        context.fillStyle = color
        context.fillRect(index % CANVAS_SIZE, Math.floor(index / CANVAS_SIZE), 1, 1)
      })
    }
  }, [roundId])

  useEffect(() => {
    if (!pixelPalette.some((color) => color.hex === activeColor)) {
      setActiveColor(pixelPalette[0].hex)
    }
  }, [activeColor, paletteSize, pixelPalette])

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
  }, [isImmersive])

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const context = canvasRef.current?.getContext('2d')
      if (context) {
        context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
        pixelsRef.current.forEach((color, index) => {
          if (color === TRANSPARENT) return
          context.fillStyle = color
          context.fillRect(
            index % CANVAS_SIZE,
            Math.floor(index / CANVAS_SIZE),
            1,
            1,
          )
        })
      }
      updatePan(panRef.current, zoomRef.current)
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [isImmersive])

  useEffect(() => {
    if (!isImmersive) {
      setImmersiveSecondsLeft(null)
      return
    }

    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    const previousHistoryState =
      window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {}

    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.history.pushState(
      { ...previousHistoryState, bitscrawlImmersiveCanvas: true },
      '',
    )

    const closeFromHistory = () => {
      if (!window.history.state?.bitscrawlImmersiveCanvas) setIsImmersive(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !window.history.state?.bitscrawlModal) setIsImmersive(false)
    }

    window.addEventListener('popstate', closeFromHistory)
    window.addEventListener('keydown', closeFromKeyboard)

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      window.removeEventListener('popstate', closeFromHistory)
      window.removeEventListener('keydown', closeFromKeyboard)
      if (window.history.state?.bitscrawlImmersiveCanvas) {
        window.history.back()
      }
    }
  }, [isImmersive])

  useEffect(() => {
    if (!isImmersive || !drawingEndsAt) {
      setImmersiveSecondsLeft(null)
      return
    }

    const remainingMilliseconds = Math.max(
      0,
      Date.parse(drawingEndsAt) - Date.parse(serverNow),
    )
    const startedAt = performance.now()
    const updateTimer = () => {
      setImmersiveSecondsLeft(
        Math.ceil(
          Math.max(0, remainingMilliseconds - (performance.now() - startedAt)) /
            1_000,
        ),
      )
    }

    updateTimer()
    const intervalId = window.setInterval(updateTimer, 200)
    return () => window.clearInterval(intervalId)
  }, [drawingEndsAt, isImmersive, roundId, serverNow])

  useEffect(() => {
    setIsImmersive(false)
  }, [roundId])

  useEffect(
    () => () => {
      if (flushTimerRef.current !== undefined) {
        window.clearTimeout(flushTimerRef.current)
      }
      if (pendingChangesRef.current.size && localDrawingRef.current) {
        localDrawingRef.current.onChange([...pixelsRef.current])
      }
    },
    [],
  )

  const activeToolDetails =
    toolButtons.find(({ tool }) => tool === activeTool) ?? toolButtons[0]
  const immersiveTimeLabel =
    immersiveSecondsLeft === null
      ? '∞'
      : `${Math.floor(immersiveSecondsLeft / 60)}:${(immersiveSecondsLeft % 60)
          .toString()
          .padStart(2, '0')}`

  const editor = (
    <section
      aria-label={isImmersive ? 'Teljes képernyős pixelvászon' : undefined}
      aria-labelledby={isImmersive ? undefined : 'pixel-editor-title'}
      className={`pixel-editor${isImmersive ? ' is-immersive' : ''}`}
    >
      {isImmersive ? (
        <div className="immersive-canvas-heading">
          {localDrawing ? (
            <span>{editorText.freeDrawing}</span>
          ) : (
            <>
              <span>
                {canDraw ? 'Szó' : 'Élő rajz'}
                {canDraw ? <strong>{chosenWord ?? '—'}</strong> : null}
              </span>
              <span>Idő <strong>{immersiveTimeLabel}</strong></span>
            </>
          )}
          <button onClick={exitImmersiveMode} type="button">
            Bezárás
          </button>
        </div>
      ) : (
        <div className="pixel-editor-heading">
          <div>
            <p className="round-label">32 × 32 pixel</p>
            <h3 id="pixel-editor-title">
              {canDraw ? 'Pixelvászon' : 'Élő rajz'}
            </h3>
          </div>
          <span className="draw-mode-badge">
            {canDraw ? 'Te rajzolsz' : 'Néző mód'}
          </span>
        </div>
      )}

      {canDraw ? (
        <div className="pixel-toolbar" aria-label="Rajzeszközök">
          <div className="tool-buttons">
            {toolButtons.map(({ icon, label, tool }) => (
              <button
                aria-label={label}
                aria-pressed={activeTool === tool}
                key={tool}
                onClick={() => selectDrawingTool(tool)}
                title={label}
                type="button"
              >
                <img alt="" aria-hidden="true" src={`/icons/tools/${icon}.svg`} />
              </button>
            ))}
            <button
              aria-label="Visszavonás"
              disabled={!canUndo}
              onClick={undoLastStep}
              title="Visszavonás"
              type="button"
            >
              <img alt="" aria-hidden="true" src="/icons/tools/undo.svg" />
            </button>
            <button
              aria-label="Teljes vászon törlése"
              onClick={clearCanvas}
              title="Teljes vászon törlése"
              type="button"
            >
              <img alt="" aria-hidden="true" src="/icons/tools/clear.svg" />
            </button>
          </div>
          <div
            className="drawing-palette"
            data-palette-size={paletteSize}
            aria-label={`${paletteSize} színű paletta`}
          >
            {pixelPalette.map((color) => (
              <button
                aria-label={`${color.name}, ${color.hex}`}
                aria-pressed={activeColor === color.hex}
                key={color.hex}
                onClick={() => {
                  setActiveColor(color.hex)
                  selectDrawingTool('pencil')
                  setIsImmersivePaletteOpen(false)
                }}
                style={{ backgroundColor: color.hex }}
                title={color.name}
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
          aria-label="Mozgatás"
          aria-pressed={isPanMode}
          disabled={zoom === MIN_ZOOM}
          onClick={() => setIsPanMode((current) => !current)}
          title="Mozgatás"
          type="button"
        >
          <img alt="" aria-hidden="true" src="/icons/tools/pan.svg" />
        </button>
        <button
          aria-pressed={showGrid}
          onClick={() => setShowGrid((current) => !current)}
          type="button"
        >
          Rács
        </button>
        <button
          aria-pressed={showCoordinates}
          onClick={() => setShowCoordinates((current) => !current)}
          type="button"
        >
          Koordináták
        </button>
        <button onClick={enterImmersiveMode} type="button">
          Teljes nézet
        </button>
      </div>

      {isImmersive ? (
        <aside className="immersive-side-controls" aria-label="Vászon vezérlői">
          {canDraw ? (
            <div className="immersive-control-group">
              <button
                aria-expanded={areImmersiveToolsOpen}
                aria-label="Rajzeszközök"
                className="immersive-tool-toggle"
                onClick={() => {
                  setAreImmersiveToolsOpen((current) => !current)
                  setIsImmersivePaletteOpen(false)
                }}
                title={activeToolDetails.label}
                type="button"
              >
                <img
                  alt=""
                  aria-hidden="true"
                  src={`/icons/tools/${activeToolDetails.icon}.svg`}
                />
              </button>
              {areImmersiveToolsOpen ? (
                <div className="immersive-tool-menu" aria-label="Rajzeszköz választása">
                  {toolButtons.map(({ icon, label, tool }) => (
                    <button
                      aria-label={label}
                      aria-pressed={activeTool === tool}
                      key={tool}
                      onClick={() => {
                        selectDrawingTool(tool)
                        setAreImmersiveToolsOpen(false)
                      }}
                      title={label}
                      type="button"
                    >
                      <img
                        alt=""
                        aria-hidden="true"
                        src={`/icons/tools/${icon}.svg`}
                      />
                    </button>
                  ))}
                  <button
                    aria-label="Visszavonás"
                    disabled={!canUndo}
                    onClick={undoLastStep}
                    title="Visszavonás"
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src="/icons/tools/undo.svg" />
                  </button>
                  <button
                    aria-label="Teljes vászon törlése"
                    onClick={clearCanvas}
                    title="Teljes vászon törlése"
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src="/icons/tools/clear.svg" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {canDraw ? (
            <div className="immersive-control-group">
              <button
                aria-expanded={isImmersivePaletteOpen}
                aria-label="Színpaletta"
                className="immersive-color-toggle"
                onClick={() => {
                  setIsImmersivePaletteOpen((current) => !current)
                  setAreImmersiveToolsOpen(false)
                }}
                style={{ backgroundColor: activeColor }}
                title="Színpaletta"
                type="button"
              />
              {isImmersivePaletteOpen ? (
                <div
                  aria-label={`${paletteSize} színű paletta`}
                  className="immersive-palette-menu"
                  data-palette-size={paletteSize}
                >
                  {pixelPalette.map((color) => (
                    <button
                      aria-label={`${color.name}, ${color.hex}`}
                      aria-pressed={activeColor === color.hex}
                      key={color.hex}
                      onClick={() => {
                        setActiveColor(color.hex)
                        selectDrawingTool('pencil')
                        setIsImmersivePaletteOpen(false)
                      }}
                      style={{ backgroundColor: color.hex }}
                      title={color.name}
                      type="button"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="immersive-zoom-controls">
            <button
              aria-label="Kicsinyítés"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => stepZoom(-1)}
              type="button"
            >
              −
            </button>
            <button
              aria-label="Nagyítás"
              disabled={zoom >= maximumZoom()}
              onClick={() => stepZoom(1)}
              type="button"
            >
              +
            </button>
            <button
              aria-label="100%"
              disabled={zoom === MIN_ZOOM}
              onClick={() => changeZoom(MIN_ZOOM)}
              type="button"
            >
              1:1
            </button>
            <button
              aria-label="Mozgatás"
              aria-pressed={isPanMode}
              disabled={zoom === MIN_ZOOM}
              onClick={() => setIsPanMode((current) => !current)}
              title="Mozgatás"
              type="button"
            >
              <img alt="" aria-hidden="true" src="/icons/tools/pan.svg" />
            </button>
            <button
              aria-label="Rács"
              aria-pressed={showGrid}
              onClick={() => setShowGrid((current) => !current)}
              type="button"
            >
              #
            </button>
            <button
              aria-label="Koordináták"
              aria-pressed={showCoordinates}
              onClick={() => setShowCoordinates((current) => !current)}
              type="button"
            >
              1–32
            </button>
          </div>
        </aside>
      ) : null}

      <div className="pixel-canvas-frame" ref={canvasFrameRef}>
        <div
          className={`pixel-canvas-surface${showGrid ? ' show-grid' : ''}`}
          style={{
            height: isImmersive
              ? `min(${CANVAS_SURFACE_RATIO * zoom * 100}cqw, ${CANVAS_SURFACE_RATIO * zoom * 100}cqh)`
              : `${CANVAS_SURFACE_RATIO * zoom * 100}%`,
            left: `${pan.x * 100}%`,
            top: `${pan.y * 100}%`,
            width: isImmersive
              ? `min(${CANVAS_SURFACE_RATIO * zoom * 100}cqw, ${CANVAS_SURFACE_RATIO * zoom * 100}cqh)`
              : `${CANVAS_SURFACE_RATIO * zoom * 100}%`,
          }}
        >
          {showCoordinates ? (
            <>
              <div
                aria-hidden="true"
                className="pixel-coordinate-ruler is-horizontal"
              >
                {PIXEL_COORDINATES.map((coordinate) => (
                  <span key={coordinate}>{coordinate}</span>
                ))}
              </div>
              <div
                aria-hidden="true"
                className="pixel-coordinate-ruler is-vertical"
              >
                {PIXEL_COORDINATES.map((coordinate) => (
                  <span key={coordinate}>{coordinate}</span>
                ))}
              </div>
            </>
          ) : null}
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
              if (shapeGestureRef.current) {
                cancelShape()
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
                cancelShape()
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

              if (isShapeTool(activeTool)) {
                shapeGestureRef.current = {
                  current: point,
                  start: point,
                  tool: activeTool,
                }
                redrawCanvas([point])
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

              if (canDraw && shapeGestureRef.current) {
                previewShape(pointFromEvent(event))
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

              if (canDraw && shapeGestureRef.current) {
                finishShape(pointFromEvent(event))
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

  return isImmersive ? createPortal(editor, document.body) : editor
}
