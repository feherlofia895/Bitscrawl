import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelCanvas } from './PixelCanvas'
import { EditorAnimationControls } from './EditorAnimationControls'
import { EditorAnimationThumbnail } from './EditorAnimationThumbnail'
import { ConfirmModal } from './ConfirmModal'
import { WeeklyArtwork } from './WeeklyArtwork'
import {
  composeDrawingLayers,
  compositeDrawingPixel,
  emptyDrawing,
  parseDrawingDraft,
  rasterizeDrawing,
  type EditorDrawingLayers,
  type EditorLayerIndex,
  type EditorLayerVisibility,
} from '../lib/drawing'
import { editorText as text } from '../lib/editorText'
import type { EditorPaletteSize } from '../lib/palette'
import { editorPalette32 } from '../lib/palette'
import { loadOwnProfile, saveProfileAvatar } from '../lib/profile'
import {
  FEED_DAILY_POST_LIMIT,
  FEED_DESCRIPTION_MAX_LENGTH,
  FEED_DESCRIPTION_MAX_LINES,
  limitFeedDescription,
  loadDailyFeedAccountState,
  publishDailyFeedPost,
} from '../lib/feed'
import { loadWeeklyAccountState, loadWeeklyChallenges, submitWeeklyEntry } from '../lib/weekly'
import { loadMonthlyAccountState, loadMonthlyChallenges, saveMonthlyEntry, submitMonthlyEntry } from '../lib/monthly'
import {
  deleteOwnEditorGallerySlot,
  editorGalleryEndpointIsMissing,
  loadOwnEditorGallery,
  saveOwnEditorGallerySlot,
  type EditorGallerySlot,
  type EditorGallerySlotIndex,
} from '../lib/editorGallery'
import {
  deleteOwnEditorPalette,
  EDITOR_PALETTE_COLOR_LIMIT,
  loadLocalEditorPalettes,
  loadOwnEditorPalettes,
  sanitizeEditorPaletteColors,
  sanitizeEditorPaletteName,
  saveLocalEditorPalettes,
  saveOwnEditorPalette,
  type EditorCustomPalette,
  type EditorPaletteSlotIndex,
} from '../lib/editorPalettes'
import {
  addAnimationFrame,
  deleteAnimationFrame,
  loadEditorAnimation,
  normalizeEditorAnimation,
  replaceAnimationFrame,
  saveEditorAnimation,
} from '../lib/editorAnimation'
import {
  deleteOwnEditorAnimationSlot,
  editorAnimationGalleryEndpointIsMissing,
  loadOwnEditorAnimations,
  saveOwnEditorAnimationSlot,
  type EditorAnimationGallerySlot,
  type EditorAnimationSlotIndex,
} from '../lib/editorAnimationGallery'
import { createEditorAnimationGifBlob } from '../lib/editorGif'

const STORAGE_KEY = 'bitscrawl-editor-v1'
const serverColors = new Set(['transparent', ...editorPalette32.map(color => color.hex)])

type EditorShareState = {
  animationSlots: EditorAnimationGallerySlot[]
  animationUnavailableMessage: string | null
  gallerySlots: EditorGallerySlot[]
  galleryUnavailableMessage: string | null
  feedUnavailableMessage: string | null
  feedPostCount: number
  monthly: { id: number; prompt: string; submitted: boolean } | null
  profileReady: boolean
  signedIn: boolean
  weekly: { id: number; prompt: string; submitted: boolean } | null
}

const emptyShareState: EditorShareState = {
  animationSlots: [],
  animationUnavailableMessage: null,
  gallerySlots: [],
  galleryUnavailableMessage: null,
  feedUnavailableMessage: null,
  feedPostCount: 0,
  monthly: null,
  profileReady: false,
  signedIn: false,
  weekly: null,
}
function readDrawing() {
  try {
    return { ...parseDrawingDraft(localStorage.getItem(STORAGE_KEY)), storageAvailable: true }
  } catch { /* An unavailable or old draft must not prevent drawing. */ }
  const layers: EditorDrawingLayers = [emptyDrawing(), emptyDrawing()]
  return {
    activeLayer: 0 as const,
    pixels: emptyDrawing(),
    layers,
    layerVisibility: [true, true] as EditorLayerVisibility,
    exported: true,
    paletteSize: 12 as const,
    storageAvailable: false,
    version: 2 as const,
  }
}

export function DrawingEditor({ hasAdvancedAccess, onBack, onDirtyChange, onOpenProfile, onStorageChange }: {
  hasAdvancedAccess: boolean
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
  onOpenProfile: () => void
  onStorageChange: (available: boolean) => void
}) {
  const [initial] = useState(readDrawing)
  const [initialAnimation] = useState(() => loadEditorAnimation(initial.pixels))
  const editorLayersRef = useRef<EditorDrawingLayers>(initial.layers)
  const activeLayerRef = useRef<EditorLayerIndex>(initial.activeLayer)
  const layerVisibilityRef = useRef<EditorLayerVisibility>(initial.layerVisibility)
  const staticPixelsRef = useRef(initial.pixels)
  const pixelsRef = useRef(initial.layers[initial.activeLayer])
  const animationFramesRef = useRef(initialAnimation.frames)
  const activeAnimationFrameRef = useRef(initialAnimation.activeFrameIndex)
  const animationFlushRef = useRef<() => void>(() => undefined)
  const [revision, setRevision] = useState(0)
  const [activeLayer, setActiveLayer] = useState<EditorLayerIndex>(initial.activeLayer)
  const [layerVisibility, setLayerVisibility] = useState<EditorLayerVisibility>(initial.layerVisibility)
  const [scale, setScale] = useState(1)
  const [paletteSize, setPaletteSize] = useState<EditorPaletteSize>(hasAdvancedAccess ? initial.paletteSize : 12)
  const [customPaletteActive, setCustomPaletteActive] = useState(hasAdvancedAccess)
  const [customPalettes, setCustomPalettes] = useState(loadLocalEditorPalettes)
  const [activePaletteSlot, setActivePaletteSlot] = useState<EditorPaletteSlotIndex>(1)
  const [paletteSyncStatus, setPaletteSyncStatus] = useState('Saját paletták betöltése…')
  const [dirty, setDirty] = useState(!initial.exported)
  const [animationMode, setAnimationMode] = useState(false)
  const [animationFrames, setAnimationFrames] = useState(initialAnimation.frames)
  const [activeAnimationFrame, setActiveAnimationFrame] = useState(initialAnimation.activeFrameIndex)
  const [animationFps, setAnimationFps] = useState(initialAnimation.fps)
  const [onionSkin, setOnionSkin] = useState(initialAnimation.onionSkin)
  const [animationDirty, setAnimationDirty] = useState(false)
  const [status, setStatus] = useState<string>(initial.storageAvailable ? text.local : text.storageError)
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [feedDescription, setFeedDescription] = useState('')
  const [shareState, setShareState] = useState<EditorShareState>(emptyShareState)
  const [galleryAction, setGalleryAction] = useState<'load' | 'save' | 'animation-load' | 'animation-save' | null>(null)
  const [galleryActionLoading, setGalleryActionLoading] = useState(false)
  const [galleryActionError, setGalleryActionError] = useState<string | null>(null)
  const [serverPaletteReady, setServerPaletteReady] = useState(
    () => initial.pixels.every(color => serverColors.has(color)),
  )
  const [confirmation, setConfirmation] = useState<{
    title: string
    message: string
    label: string
    action: () => void
  } | null>(null)
  const mountedRef = useRef(true)
  const customPaletteTouchedRef = useRef(false)
  const paletteSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const shareMenuRef = useRef<HTMLDetailsElement>(null)
  const galleryCloseRef = useRef<HTMLButtonElement>(null)
  const galleryPreviousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!hasAdvancedAccess) {
      setPaletteSyncStatus('Saját palettákhoz jelentkezz be.')
      return
    }
    let active = true
    void loadOwnEditorPalettes()
      .then(result => {
        if (!active || !mountedRef.current) return
        if (!customPaletteTouchedRef.current) setCustomPalettes(result.palettes)
        setPaletteSyncStatus(result.storage === 'cloud' ? 'Profillal szinkronizálva.' : 'Ezen az eszközön mentve.')
      })
      .catch(error => {
        if (active && mountedRef.current) {
          setPaletteSyncStatus(error instanceof Error ? error.message : 'A profilszinkron most nem érhető el.')
        }
      })
    return () => { active = false }
  }, [hasAdvancedAccess])

  useEffect(() => {
    if (!galleryAction) return
    galleryCloseRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirmation) {
        event.preventDefault()
        setGalleryAction(null)
        queueMicrotask(() => galleryPreviousFocusRef.current?.focus())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmation, galleryAction])

  const persist = useCallback((
    layers: EditorDrawingLayers,
    exported: boolean,
    selectedPalette = paletteSize,
    selectedActiveLayer = activeLayerRef.current,
    selectedVisibility = layerVisibilityRef.current,
  ) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        activeLayer: selectedActiveLayer,
        exported,
        layers,
        layerVisibility: selectedVisibility,
        paletteSize: selectedPalette,
        version: 2,
      }))
      onStorageChange(true)
      return true
    } catch {
      onStorageChange(false)
      setStatus(text.storageError)
      return false
    }
  }, [onStorageChange, paletteSize])

  const persistAnimationDraft = useCallback((
    frames: string[][],
    activeFrameIndex = activeAnimationFrameRef.current,
    fps = animationFps,
    showOnionSkin = onionSkin,
  ) => {
    const draft = normalizeEditorAnimation({
      activeFrameIndex,
      fps,
      frames,
      onionSkin: showOnionSkin,
    })
    const stored = saveEditorAnimation(draft)
    onStorageChange(stored)
    if (!stored) setStatus(text.storageError)
    return stored
  }, [animationFps, onionSkin, onStorageChange])

  const handleChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    if (animationMode) {
      setServerPaletteReady(pixels.every(color => serverColors.has(color)))
      const frames = replaceAnimationFrame(
        animationFramesRef.current,
        activeAnimationFrameRef.current,
        pixels,
      )
      animationFramesRef.current = frames
      setAnimationFrames(frames)
      const stored = persistAnimationDraft(frames)
      setAnimationDirty(!stored)
      if (stored) setStatus('Az animáció ezen az eszközön mentve.')
      return
    }
    const layers = editorLayersRef.current.map((layer, index) => (
      index === activeLayerRef.current ? [...pixels] : layer
    )) as EditorDrawingLayers
    editorLayersRef.current = layers
    staticPixelsRef.current = composeDrawingLayers(layers, layerVisibilityRef.current)
    setServerPaletteReady(staticPixelsRef.current.every(color => serverColors.has(color)))
    setDirty(true)
    if (persist(layers, false)) setStatus(text.local)
  }, [animationMode, persist, persistAnimationDraft])

  useEffect(() => { onDirtyChange(dirty || animationDirty) }, [animationDirty, dirty, onDirtyChange])
  useEffect(() => { onStorageChange(initial.storageAvailable) }, [initial.storageAvailable, onStorageChange])
  useEffect(() => {
    if (!dirty && !animationDirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [animationDirty, dirty])

  const showAnimationFrame = (index: number) => {
    animationFlushRef.current()
    const frames = animationFramesRef.current
    const nextIndex = Math.max(0, Math.min(frames.length - 1, index))
    activeAnimationFrameRef.current = nextIndex
    setActiveAnimationFrame(nextIndex)
    pixelsRef.current = [...frames[nextIndex]]
    setServerPaletteReady(pixelsRef.current.every(color => serverColors.has(color)))
    persistAnimationDraft(frames, nextIndex)
    setRevision(value => value + 1)
  }

  const switchEditorMode = (nextMode: 'drawing' | 'animation') => {
    if (nextMode === 'animation' && !hasAdvancedAccess) {
      setStatus('Animáció készítéséhez jelentkezz be.')
      return
    }
    animationFlushRef.current()
    const useAnimation = nextMode === 'animation'
    setAnimationMode(useAnimation)
    pixelsRef.current = useAnimation
      ? [...animationFramesRef.current[activeAnimationFrameRef.current]]
      : [...editorLayersRef.current[activeLayerRef.current]]
    const outputPixels = useAnimation
      ? pixelsRef.current
      : composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
    staticPixelsRef.current = useAnimation ? staticPixelsRef.current : outputPixels
    setServerPaletteReady(outputPixels.every(color => serverColors.has(color)))
    setRevision(value => value + 1)
  }

  useEffect(() => {
    if (hasAdvancedAccess) return
    setCustomPaletteActive(false)
    setPaletteSize(12)
    if (!animationMode) return
    animationFlushRef.current()
    setAnimationMode(false)
    pixelsRef.current = [...editorLayersRef.current[activeLayerRef.current]]
    staticPixelsRef.current = composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
    setServerPaletteReady(staticPixelsRef.current.every(color => serverColors.has(color)))
    setStatus('A vendég módban az állókép-szerkesztő használható.')
    setRevision(value => value + 1)
  }, [animationMode, hasAdvancedAccess])

  const selectEditorLayer = (nextLayer: EditorLayerIndex) => {
    if (animationMode || nextLayer === activeLayerRef.current) return
    animationFlushRef.current()
    activeLayerRef.current = nextLayer
    setActiveLayer(nextLayer)
    pixelsRef.current = [...editorLayersRef.current[nextLayer]]
    if (persist(editorLayersRef.current, !dirty, paletteSize, nextLayer)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const toggleEditorLayerVisibility = (layer: EditorLayerIndex) => {
    if (animationMode) return
    animationFlushRef.current()
    const visibility: EditorLayerVisibility = [...layerVisibilityRef.current]
    visibility[layer] = !visibility[layer]
    layerVisibilityRef.current = visibility
    setLayerVisibility(visibility)
    staticPixelsRef.current = composeDrawingLayers(editorLayersRef.current, visibility)
    setServerPaletteReady(staticPixelsRef.current.every(color => serverColors.has(color)))
    setDirty(true)
    if (persist(editorLayersRef.current, false, paletteSize, activeLayerRef.current, visibility)) {
      setStatus(text.local)
    }
    setRevision(value => value + 1)
  }

  const displayEditorLayerColor = useCallback((activeColor: string, index: number) => {
    const visibility = layerVisibilityRef.current
    const currentLayer = activeLayerRef.current
    const bottom = currentLayer === 0 ? activeColor : editorLayersRef.current[0][index]
    const top = currentLayer === 1 ? activeColor : editorLayersRef.current[1][index]
    if (!visibility[0]) return visibility[1] ? top : 'transparent'
    if (!visibility[1]) return bottom
    return compositeDrawingPixel(bottom, top)
  }, [])

  const editorHasAnyLayerContent = () => editorLayersRef.current.some(layer =>
    layer.some(color => color !== 'transparent'))

  const updateAnimationSettings = (nextFps: number, nextOnionSkin: boolean) => {
    setAnimationFps(nextFps)
    setOnionSkin(nextOnionSkin)
    setAnimationDirty(!persistAnimationDraft(
      animationFramesRef.current,
      activeAnimationFrameRef.current,
      nextFps,
      nextOnionSkin,
    ))
  }

  const addFrame = (duplicateCurrent: boolean) => {
    animationFlushRef.current()
    const source = duplicateCurrent
      ? animationFramesRef.current[activeAnimationFrameRef.current]
      : emptyDrawing()
    const frames = addAnimationFrame(animationFramesRef.current, source)
    if (frames.length === animationFramesRef.current.length) return
    animationFramesRef.current = frames
    setAnimationFrames(frames)
    setAnimationDirty(!persistAnimationDraft(frames, frames.length - 1))
    showAnimationFrame(frames.length - 1)
  }

  const removeActiveFrame = () => {
    animationFlushRef.current()
    const frames = deleteAnimationFrame(animationFramesRef.current, activeAnimationFrameRef.current)
    if (frames.length === animationFramesRef.current.length) return
    const nextIndex = Math.min(activeAnimationFrameRef.current, frames.length - 1)
    animationFramesRef.current = frames
    setAnimationFrames(frames)
    setAnimationDirty(!persistAnimationDraft(frames, nextIndex))
    showAnimationFrame(nextIndex)
  }

  const resetDrawing = () => {
    const layers: EditorDrawingLayers = [emptyDrawing(), emptyDrawing()]
    const visibility: EditorLayerVisibility = [true, true]
    editorLayersRef.current = layers
    activeLayerRef.current = 0
    layerVisibilityRef.current = visibility
    setActiveLayer(0)
    setLayerVisibility(visibility)
    staticPixelsRef.current = emptyDrawing()
    pixelsRef.current = layers[0]
    setServerPaletteReady(true)
    setDirty(false)
    if (persist(layers, true, paletteSize, 0, visibility)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const resetAnimation = () => {
    const frames = [emptyDrawing()]
    animationFramesRef.current = frames
    activeAnimationFrameRef.current = 0
    pixelsRef.current = [...frames[0]]
    setAnimationFrames(frames)
    setActiveAnimationFrame(0)
    setAnimationDirty(false)
    setServerPaletteReady(true)
    if (persistAnimationDraft(frames, 0)) setStatus('Új animáció indítva.')
    setRevision(value => value + 1)
  }

  const startNewDrawing = () => {
    if (animationMode) {
      if (animationFramesRef.current.some(frame => frame.some(color => color !== 'transparent'))) {
        setConfirmation({
          title: 'Új animáció indítása?',
          message: 'A jelenlegi képkockák helyére egy üres képkocka kerül.',
          label: 'Új animáció',
          action: resetAnimation,
        })
      } else resetAnimation()
      return
    }
    if (editorHasAnyLayerContent()) {
      setConfirmation({ title: text.newDrawingTitle, message: text.replace, label: text.newDrawing, action: resetDrawing })
    } else resetDrawing()
  }

  const changePalette = (nextPalette: EditorPaletteSize) => {
    if (!hasAdvancedAccess && nextPalette !== 12) return
    setCustomPaletteActive(false)
    setPaletteSize(nextPalette)
    if (persist(editorLayersRef.current, !dirty, nextPalette)) setStatus(text.local)
  }

  const activeCustomPalette = customPalettes[activePaletteSlot - 1]

  const replaceCustomPalette = (palette: EditorCustomPalette) => {
    customPaletteTouchedRef.current = true
    setCustomPalettes(current => {
      const next = current.map(item => item.slotIndex === palette.slotIndex ? palette : item)
      saveLocalEditorPalettes(next)
      return next
    })
  }

  const queueCustomPaletteSave = (palette: EditorCustomPalette) => {
    setPaletteSyncStatus('Paletta mentése…')
    paletteSaveQueueRef.current = paletteSaveQueueRef.current
      .catch(() => undefined)
      .then(() => saveOwnEditorPalette(palette))
      .then(storage => {
        if (mountedRef.current) {
          setPaletteSyncStatus(storage === 'cloud' ? 'Profillal szinkronizálva.' : 'Ezen az eszközön mentve.')
        }
      })
      .catch(error => {
        if (mountedRef.current) {
          setPaletteSyncStatus(error instanceof Error ? error.message : 'A paletta mentése nem sikerült.')
        }
      })
  }

  const updateCustomPaletteColors = (colors: string[]) => {
    if (!hasAdvancedAccess) return
    const normalizedColors = sanitizeEditorPaletteColors(colors)
    const palette = { ...activeCustomPalette, colors: normalizedColors }
    replaceCustomPalette(palette)
    queueCustomPaletteSave(palette)
  }

  const saveCustomColor = (color: string) => {
    if (!hasAdvancedAccess) return
    const colors = [
      color,
      ...activeCustomPalette.colors.filter(saved => saved.toLowerCase() !== color.toLowerCase()),
    ]
    updateCustomPaletteColors(colors)
  }

  const updateCustomPaletteName = (name: string) => {
    if (!hasAdvancedAccess) return
    replaceCustomPalette({ ...activeCustomPalette, name: name.slice(0, 24) })
  }

  const saveCustomPaletteName = () => {
    if (!hasAdvancedAccess) return
    const palette = {
      ...activeCustomPalette,
      name: sanitizeEditorPaletteName(activeCustomPalette.name, activeCustomPalette.slotIndex),
    }
    replaceCustomPalette(palette)
    queueCustomPaletteSave(palette)
  }

  const clearCustomPalette = async (slotIndex: EditorPaletteSlotIndex) => {
    if (!hasAdvancedAccess) return
    customPaletteTouchedRef.current = true
    setPaletteSyncStatus('Paletta ürítése…')
    const cleared = loadLocalEditorPalettes().map(palette => palette.slotIndex === slotIndex
      ? { ...palette, colors: [], name: `Saját paletta ${slotIndex}`, updatedAt: null }
      : palette)
    setCustomPalettes(cleared)
    saveLocalEditorPalettes(cleared)
    try {
      const storage = await deleteOwnEditorPalette(slotIndex)
      if (mountedRef.current) {
        setPaletteSyncStatus(storage === 'cloud' ? 'A paletta kiürítve és szinkronizálva.' : 'A paletta ezen az eszközön kiürítve.')
      }
    } catch (error) {
      if (mountedRef.current) {
        setPaletteSyncStatus(error instanceof Error ? error.message : 'A paletta ürítése nem sikerült.')
      }
    }
  }

  const requestClearCustomPalette = () => setConfirmation({
    title: `${activeCustomPalette.name || `Saját paletta ${activePaletteSlot}`} kiürítése?`,
    message: 'A palettáról minden elmentett szín törlődik. A vásznon lévő rajz nem változik.',
    label: 'Kiürítés',
    action: () => { void clearCustomPalette(activePaletteSlot) },
  })

  const refreshShareState = useCallback(async () => {
    setShareLoading(true)
    try {
      const { profile, user } = await loadOwnProfile()
      if (!user || !profile) {
        setShareState({ ...emptyShareState, signedIn: Boolean(user), profileReady: Boolean(profile) })
        return
      }
      const [feedResult, galleryResult, animationResult, weeklyChallenges, monthlyChallenges] = await Promise.all([
        loadDailyFeedAccountState()
          .then(account => ({ account, error: null as string | null }))
          .catch(error => ({
            account: null,
            error: error instanceof Error && /get_daily_feed_account_state|schema cache/i.test(error.message)
              ? 'A Rajzfal adatbázis-frissítése még nincs telepítve.'
              : 'A Rajzfal most nem érhető el.',
          })),
        loadOwnEditorGallery()
          .then(slots => ({ slots, error: null as string | null }))
          .catch(error => ({
            slots: [],
            error: editorGalleryEndpointIsMissing(error)
              ? 'A saját galéria adatbázis-frissítése még nincs telepítve.'
              : error instanceof Error ? error.message : 'A saját galéria most nem érhető el.',
          })),
        loadOwnEditorAnimations()
          .then(slots => ({ slots, error: null as string | null }))
          .catch(error => ({
            slots: [],
            error: editorAnimationGalleryEndpointIsMissing(error)
              ? 'Az animációs galéria adatbázis-frissítése még nincs telepítve.'
              : error instanceof Error ? error.message : 'Az animációs galéria most nem érhető el.',
          })),
        loadWeeklyChallenges(),
        loadMonthlyChallenges(),
      ])
      const weekly = weeklyChallenges.find(challenge => challenge.challenge_status === 'active') ?? null
      const monthly = monthlyChallenges.find(challenge =>
        challenge.challenge_status === 'drawing' || challenge.challenge_status === 'voting') ?? null
      const [weeklyAccount, monthlyAccount] = await Promise.all([
        weekly ? loadWeeklyAccountState(weekly.challenge_id) : Promise.resolve(null),
        monthly ? loadMonthlyAccountState(monthly.challenge_id) : Promise.resolve(null),
      ])
      if (!mountedRef.current) return
      setShareState({
        animationSlots: animationResult.slots,
        animationUnavailableMessage: animationResult.error,
        gallerySlots: galleryResult.slots,
        galleryUnavailableMessage: galleryResult.error,
        feedUnavailableMessage: feedResult.error,
        feedPostCount: feedResult.account?.todayPostCount ?? 0,
        monthly: monthly ? {
          id: monthly.challenge_id,
          prompt: monthly.prompt,
          submitted: Boolean(monthlyAccount?.submittedAt),
        } : null,
        profileReady: true,
        signedIn: true,
        weekly: weekly ? {
          id: weekly.challenge_id,
          prompt: weekly.prompt,
          submitted: Boolean(weeklyAccount?.entryId),
        } : null,
      })
      setStatus(text.local)
    } catch (error) {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : 'A megosztási lehetőségek nem tölthetők be.')
    } finally {
      if (mountedRef.current) setShareLoading(false)
    }
  }, [])

  const shareDrawing = async (target: 'feed' | 'weekly' | 'monthly') => {
    const snapshot = composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
    if (!snapshot.some(color => color !== 'transparent')) {
      setStatus('Előbb rajzolj valamit a megosztáshoz.')
      return
    }
    if (target === 'feed' && !serverPaletteReady) {
      setStatus('Kevert színes rajzot a Rajzfal még nem fogad.')
      return
    }
    setSharing(true)
    try {
      if (target === 'feed') {
        await publishDailyFeedPost(snapshot, null, feedDescription)
        setStatus('A rajzod megjelent a Rajzfalon!')
      } else if (target === 'weekly' && shareState.weekly) {
        await submitWeeklyEntry(shareState.weekly.id, snapshot)
        setStatus(`A rajzod bekerült a heti kihívásba: ${shareState.weekly.prompt}.`)
      } else if (target === 'monthly' && shareState.monthly) {
        await saveMonthlyEntry(shareState.monthly.id, snapshot)
        await submitMonthlyEntry(shareState.monthly.id)
        setStatus(`A rajzod bekerült a havi kihívásba: ${shareState.monthly.prompt}.`)
      }
      await refreshShareState()
      shareMenuRef.current?.removeAttribute('open')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A rajz megosztása nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const setDrawingAsProfileAvatar = async () => {
    const snapshot = composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
    if (!snapshot.some(color => color !== 'transparent')) {
      setStatus('Előbb rajzolj valamit a profilképedhez.')
      return
    }
    if (!serverPaletteReady) {
      setStatus('Kevert színes rajz még nem állítható be profilképnek.')
      return
    }
    setSharing(true)
    try {
      const result = await saveProfileAvatar(snapshot)
      setStatus(result.storage === 'cloud'
        ? 'A rajzod lett az új profilképed.'
        : 'A rajzod ezen az eszközön lett a profilképed. Az online mentés most nem érhető el.')
      shareMenuRef.current?.removeAttribute('open')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A profilkép beállítása nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestProfileAvatar = () => {
    if (!staticPixelsRef.current.some(color => color !== 'transparent')) {
      setStatus('Előbb rajzolj valamit a profilképedhez.')
      return
    }
    setConfirmation({
      title: 'Beállítod profilképnek?',
      message: 'Biztosan beállítod ezt a rajzot profilképnek? A mostani profilképed elveszik, és ez a rajz veszi át a helyét.',
      label: 'Beállítás profilképnek',
      action: () => { void setDrawingAsProfileAvatar() },
    })
  }

  const closeGalleryAction = () => {
    setGalleryAction(null)
    queueMicrotask(() => galleryPreviousFocusRef.current?.focus())
  }

  const openGalleryAction = async (action: 'load' | 'save' | 'animation-load' | 'animation-save') => {
    galleryPreviousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setGalleryAction(action)
    setGalleryActionError(null)
    setGalleryActionLoading(true)
    try {
      const animationAction = action.startsWith('animation-')
      const slots = animationAction ? await loadOwnEditorAnimations() : await loadOwnEditorGallery()
      if (!mountedRef.current) return
      setShareState(current => animationAction
        ? { ...current, animationSlots: slots as EditorAnimationGallerySlot[], animationUnavailableMessage: null }
        : { ...current, gallerySlots: slots as EditorGallerySlot[], galleryUnavailableMessage: null })
    } catch (error) {
      if (!mountedRef.current) return
      const animationAction = action.startsWith('animation-')
      const message = animationAction && editorAnimationGalleryEndpointIsMissing(error)
        ? 'Az animációs galéria adatbázis-frissítése még nincs telepítve.'
        : !animationAction && editorGalleryEndpointIsMissing(error)
          ? 'A saját galéria adatbázis-frissítése még nincs telepítve.'
        : error instanceof Error
          ? error.message
          : animationAction ? 'Az animációs galéria most nem érhető el.' : 'A saját galéria most nem érhető el.'
      setGalleryActionError(message)
    } finally {
      if (mountedRef.current) setGalleryActionLoading(false)
    }
  }

  const saveGallerySlot = async (slotIndex: EditorGallerySlotIndex) => {
    const snapshot = composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
    if (!snapshot.some(color => color !== 'transparent')) {
      setStatus('Előbb rajzolj valamit a saját galériába mentéshez.')
      return
    }
    if (!serverPaletteReady) {
      setStatus('Kevert színes rajz még nem menthető a szerveres saját galériába.')
      return
    }
    setSharing(true)
    try {
      await saveOwnEditorGallerySlot(slotIndex, snapshot, paletteSize)
      await refreshShareState()
      setStatus(`A rajzod elmentve a saját galéria ${slotIndex}. helyére.`)
      setGalleryAction(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A rajz mentése nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestSaveGallerySlot = (slotIndex: EditorGallerySlotIndex, occupied: boolean) => {
    if (!occupied) {
      void saveGallerySlot(slotIndex)
      return
    }
    setConfirmation({
      title: `${slotIndex}. kép felülírása?`,
      message: 'Az ezen a helyen tárolt rajzot lecseréljük a vásznon lévőre. A régi változat nem állítható vissza.',
      label: 'Felülírás',
      action: () => { void saveGallerySlot(slotIndex) },
    })
  }

  const loadGallerySlot = (slot: EditorGallerySlot) => {
    const pixels = [...slot.pixels]
    const layers: EditorDrawingLayers = [pixels, emptyDrawing()]
    const visibility: EditorLayerVisibility = [true, true]
    editorLayersRef.current = layers
    activeLayerRef.current = 0
    layerVisibilityRef.current = visibility
    staticPixelsRef.current = [...pixels]
    pixelsRef.current = layers[0]
    setActiveLayer(0)
    setLayerVisibility(visibility)
    setPaletteSize(slot.paletteSize)
    setCustomPaletteActive(false)
    setServerPaletteReady(pixels.every(color => serverColors.has(color)))
    setDirty(true)
    const storedLocally = persist(layers, false, slot.paletteSize, 0, visibility)
    setRevision(value => value + 1)
    if (storedLocally) setStatus(`A saját galéria ${slot.slotIndex}. képe betöltve szerkesztésre.`)
    shareMenuRef.current?.removeAttribute('open')
    setGalleryAction(null)
  }

  const requestLoadGallerySlot = (slot: EditorGallerySlot) => {
    if (!editorHasAnyLayerContent()) {
      loadGallerySlot(slot)
      return
    }
    setConfirmation({
      title: `${slot.slotIndex}. kép betöltése?`,
      message: 'A mentett kép a vásznon lévő rajz helyére kerül. A jelenlegi rajz csak akkor marad meg, ha előbb elmented.',
      label: 'Betöltés',
      action: () => loadGallerySlot(slot),
    })
  }

  const deleteGallerySlot = async (slotIndex: EditorGallerySlotIndex) => {
    setSharing(true)
    try {
      await deleteOwnEditorGallerySlot(slotIndex)
      await refreshShareState()
      setStatus(`A saját galéria ${slotIndex}. képe törölve.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A mentett rajz törlése nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestDeleteGallerySlot = (slotIndex: EditorGallerySlotIndex) => {
    setConfirmation({
      title: `${slotIndex}. kép törlése?`,
      message: 'A saját galériából törölt rajzot nem lehet visszaállítani. A vásznon lévő rajz ettől nem változik.',
      label: 'Törlés',
      action: () => { void deleteGallerySlot(slotIndex) },
    })
  }

  const saveAnimationSlot = async (slotIndex: EditorAnimationSlotIndex) => {
    animationFlushRef.current()
    const frames = animationFramesRef.current.map(frame => [...frame])
    if (!frames.some(frame => frame.some(color => color !== 'transparent'))) {
      setStatus('Előbb rajzolj valamit az animációs galériába mentéshez.')
      return
    }
    setSharing(true)
    try {
      await saveOwnEditorAnimationSlot(slotIndex, frames, animationFps)
      await refreshShareState()
      setStatus(`Az animációd elmentve az animációs galéria ${slotIndex}. helyére.`)
      setGalleryAction(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Az animáció mentése nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestSaveAnimationSlot = (slotIndex: EditorAnimationSlotIndex, occupied: boolean) => {
    if (!occupied) {
      void saveAnimationSlot(slotIndex)
      return
    }
    setConfirmation({
      title: `${slotIndex}. animáció felülírása?`,
      message: 'Az ezen a helyen tárolt animációt lecseréljük a jelenlegire. A régi változat nem állítható vissza.',
      label: 'Felülírás',
      action: () => { void saveAnimationSlot(slotIndex) },
    })
  }

  const loadAnimationSlot = (slot: EditorAnimationGallerySlot) => {
    animationFlushRef.current()
    const frames = slot.frames.map(frame => [...frame])
    animationFramesRef.current = frames
    activeAnimationFrameRef.current = 0
    pixelsRef.current = [...frames[0]]
    setAnimationFrames(frames)
    setActiveAnimationFrame(0)
    setAnimationFps(slot.fps)
    setAnimationDirty(false)
    setServerPaletteReady(pixelsRef.current.every(color => serverColors.has(color)))
    const storedLocally = persistAnimationDraft(frames, 0, slot.fps, onionSkin)
    setRevision(value => value + 1)
    if (storedLocally) setStatus(`Az animációs galéria ${slot.slotIndex}. animációja betöltve szerkesztésre.`)
    setGalleryAction(null)
  }

  const requestLoadAnimationSlot = (slot: EditorAnimationGallerySlot) => {
    if (!animationFramesRef.current.some(frame => frame.some(color => color !== 'transparent'))) {
      loadAnimationSlot(slot)
      return
    }
    setConfirmation({
      title: `${slot.slotIndex}. animáció betöltése?`,
      message: 'A mentett animáció a jelenlegi képkockák helyére kerül. A mostani változat csak akkor marad meg, ha előbb elmented.',
      label: 'Betöltés',
      action: () => loadAnimationSlot(slot),
    })
  }

  const deleteAnimationSlot = async (slotIndex: EditorAnimationSlotIndex) => {
    setSharing(true)
    try {
      await deleteOwnEditorAnimationSlot(slotIndex)
      await refreshShareState()
      setStatus(`Az animációs galéria ${slotIndex}. animációja törölve.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A mentett animáció törlése nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestDeleteAnimationSlot = (slotIndex: EditorAnimationSlotIndex) => {
    setConfirmation({
      title: `${slotIndex}. animáció törlése?`,
      message: 'Az animációs galériából törölt mentést nem lehet visszaállítani. A szerkesztőben lévő animáció ettől nem változik.',
      label: 'Törlés',
      action: () => { void deleteAnimationSlot(slotIndex) },
    })
  }

  const downloadGif = async () => {
    animationFlushRef.current()
    const frames = animationFramesRef.current.map(frame => [...frame])
    if (!frames.some(frame => frame.some(color => color !== 'transparent'))) {
      setStatus('Előbb rajzolj valamit a GIF exporthoz.')
      return
    }
    setExporting(true)
    try {
      const blob = createEditorAnimationGifBlob(frames, animationFps, 8)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bitscrawl-animacio-${new Date().toISOString().replace(/[:.]/g, '-')}-256x256.gif`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (mountedRef.current) setStatus('A GIF elkészült és letöltődött.')
    } catch (error) {
      if (mountedRef.current) setStatus(error instanceof Error ? error.message : 'A GIF export nem sikerült.')
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  const downloadPng = async () => {
    setExporting(true)
    const snapshot = composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
    try {
      const canvas = document.createElement('canvas')
      const raster = rasterizeDrawing(snapshot, scale)
      canvas.width = raster.width
      canvas.height = raster.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error(text.exportError)
      context.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error(text.exportError)), 'image/png')
      })
      if (!mountedRef.current) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `bitscrawl-${new Date().toISOString().replace(/[:.]/g, '-')}-${32 * scale}x${32 * scale}.png`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      // A drawing made while encoding must remain marked as not exported.
      const currentComposite = composeDrawingLayers(editorLayersRef.current, layerVisibilityRef.current)
      if (snapshot.every((color, index) => color === currentComposite[index])) {
        setDirty(false)
        if (persist(editorLayersRef.current, true)) setStatus(text.downloaded)
      }
    } catch {
      if (mountedRef.current) setStatus(text.exportError)
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  const animationGalleryAction = galleryAction?.startsWith('animation-') ?? false
  const saveGalleryAction = galleryAction?.endsWith('save') ?? false

  return (
    <section className="standalone-editor" aria-labelledby="drawing-editor-title">
      <div className="editor-intro">
        <h1 id="drawing-editor-title">{text.editor}</h1>
        <p>{text.intro}</p>
        {!hasAdvancedAccess ? (
          <aside className="editor-access-notice" aria-label="Vendég szerkesztő korlátozásai">
            <div>
              <strong>Vendég mód</strong>
              <p>A 12 alapszínnel rajzolhatsz, és PNG-ként letöltheted a képet. A bővített és egyéni paletta, a színkeverő, a pipetta, valamint az animáció belépés után érhető el.</p>
            </div>
            <button className="primary-button" onClick={onOpenProfile} type="button">Belépés / regisztráció</button>
          </aside>
        ) : null}
        <div className="editor-actions">
          <button onClick={onBack} type="button">{text.backPlay}</button>
          <button onClick={startNewDrawing} disabled={exporting} type="button">{text.newDrawing}</button>
          <details className="editor-share-menu" onToggle={event => {
            if (hasAdvancedAccess && event.target === event.currentTarget && event.currentTarget.open) void refreshShareState()
          }} ref={shareMenuRef}>
            <summary aria-disabled={exporting || sharing}>
              {!hasAdvancedAccess ? 'Kép letöltése' : animationMode ? 'Megosztás / mentés' : 'Megosztás / nevezés'}
            </summary>
            <div className="editor-share-options">
              {animationMode ? (
                <div className="editor-animation-share-options">
                  <strong>Animáció mentése</strong>
                  <button className="primary-button" disabled={exporting} onClick={() => void downloadGif()} type="button">
                    {exporting ? 'GIF készítése…' : 'GIF export · 256×256'}
                  </button>
                  {shareLoading ? <p>Lehetőségek betöltése…</p> : !shareState.signedIn || !shareState.profileReady ? (
                    <p>Az animációs galériához jelentkezz be, és mentsd el a profilodat.</p>
                  ) : <>
                    <button disabled={galleryActionLoading || sharing} onClick={() => void openGalleryAction('animation-save')} type="button">
                      Mentés az animációs galériába
                    </button>
                    <button disabled={galleryActionLoading || sharing} onClick={() => void openGalleryAction('animation-load')} type="button">
                      Betöltés az animációs galériából ({shareState.animationSlots.length}/2)
                    </button>
                    {shareState.animationUnavailableMessage ? <small>{shareState.animationUnavailableMessage}</small> : null}
                  </>}
                  <small>A GIF a részben áttetsző színeket 50% alatt teljesen átlátszóként menti.</small>
                </div>
              ) : <>
              <div className="editor-export-options">
                <strong>Kép mentése</strong>
                <label className="field">
                  <span>{text.exportSize}</span>
                  <select disabled={exporting} value={scale} onChange={event => setScale(Number(event.target.value))}>
                    <option value={1}>{text.original}</option>
                    <option value={8}>{text.enlarged}</option>
                  </select>
                </label>
                <button className="primary-button" onClick={() => void downloadPng()} disabled={exporting} type="button">{text.export}</button>
              </div>
              {shareLoading ? <p>Lehetőségek betöltése…</p> : !shareState.signedIn || !shareState.profileReady ? <p>Ehhez jelentkezz be, és mentsd el a profilodat.</p> : <>
                <label className="editor-feed-description">
                  <span>Képleírás <small>(nem kötelező)</small></span>
                  <textarea
                    disabled={sharing || shareState.feedPostCount >= FEED_DAILY_POST_LIMIT}
                    maxLength={FEED_DESCRIPTION_MAX_LENGTH}
                    onChange={event => setFeedDescription(limitFeedDescription(event.target.value))}
                    placeholder="Legfeljebb három rövid sor…"
                    rows={FEED_DESCRIPTION_MAX_LINES}
                    value={feedDescription}
                  />
                  <small>{feedDescription.length}/{FEED_DESCRIPTION_MAX_LENGTH} karakter · legfeljebb {FEED_DESCRIPTION_MAX_LINES} sor</small>
                </label>
                <button disabled={sharing || !serverPaletteReady || Boolean(shareState.feedUnavailableMessage) || shareState.feedPostCount >= FEED_DAILY_POST_LIMIT} onClick={() => void shareDrawing('feed')} type="button">
                  {shareState.feedUnavailableMessage ? 'Rajzfal – frissítésre vár' : shareState.feedPostCount >= FEED_DAILY_POST_LIMIT ? 'A mai három kép már megosztva' : `Megosztás a Rajzfalon (${shareState.feedPostCount}/${FEED_DAILY_POST_LIMIT})`}
                </button>
                <button disabled={sharing || !shareState.weekly || shareState.weekly.submitted} onClick={() => void shareDrawing('weekly')} type="button">
                  {shareState.weekly ? shareState.weekly.submitted ? 'Heti nevezés már beküldve' : `Heti kihívás: ${shareState.weekly.prompt}` : 'Nincs aktív heti kihívás'}
                </button>
                <button disabled={sharing || !shareState.monthly || shareState.monthly.submitted} onClick={() => void shareDrawing('monthly')} type="button">
                  {shareState.monthly ? shareState.monthly.submitted ? 'Havi nevezés már beküldve' : `Havi kihívás: ${shareState.monthly.prompt}` : 'Nincs aktív havi kihívás'}
                </button>
                <button disabled={sharing || !serverPaletteReady} onClick={requestProfileAvatar} type="button">
                  Beállítás profilképnek
                </button>
                <details className="editor-own-gallery">
                  <summary>Saját galéria ({shareState.gallerySlots.length}/2)</summary>
                  {shareState.galleryUnavailableMessage ? (
                    <small>{shareState.galleryUnavailableMessage}</small>
                  ) : (
                    <div className="editor-own-gallery-grid">
                      {([1, 2] as const).map(slotIndex => {
                        const slot = shareState.gallerySlots.find(item => item.slotIndex === slotIndex)
                        return (
                          <article className="editor-own-gallery-slot" key={slotIndex}>
                            <strong>{slotIndex}. kép</strong>
                            {slot ? (
                              <WeeklyArtwork label={`A saját galéria ${slotIndex}. képe`} pixels={slot.pixels} />
                            ) : <div className="editor-own-gallery-empty">Üres hely</div>}
                            <div className="editor-own-gallery-actions">
                              {slot ? <button disabled={sharing} onClick={() => requestLoadGallerySlot(slot)} type="button">Betöltés</button> : null}
                              <button disabled={sharing || !serverPaletteReady} onClick={() => requestSaveGallerySlot(slotIndex, Boolean(slot))} type="button">
                                {slot ? 'Felülírás' : 'Ide mentem'}
                              </button>
                              {slot ? <button className="danger-button" disabled={sharing} onClick={() => requestDeleteGallerySlot(slotIndex)} type="button">Törlés</button> : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </details>
                {shareState.feedUnavailableMessage ? <small>{shareState.feedUnavailableMessage}</small> : null}
                {!serverPaletteReady ? <small>A kevert színeket a heti és havi kihívás fogadja; a Rajzfal, a profilkép és a saját galéria továbbra is a 32 hivatalos színt használja.</small> : null}
              </>}
              </>}
              {status !== text.local ? <p className="status-message editor-share-status" role="status">{status}</p> : null}
            </div>
          </details>
        </div>
        <div className="editor-animation-mode" aria-label="Szerkesztési mód">
          <button aria-pressed={!animationMode} onClick={() => switchEditorMode('drawing')} type="button">Állókép</button>
          <button aria-pressed={animationMode} disabled={!hasAdvancedAccess} onClick={() => switchEditorMode('animation')} title={!hasAdvancedAccess ? 'Animáció készítéséhez jelentkezz be.' : undefined} type="button">Animáció · legfeljebb 3 képkocka</button>
        </div>
        {!animationMode ? (
          <details className="editor-layer-panel editor-collapsible-panel">
            <summary className="editor-collapsible-summary">
              <strong>Rétegek</strong>
              <small>{activeLayer === 1 ? 'Felső aktív' : 'Alsó aktív'}</small>
            </summary>
            <div className="editor-layer-content">
              <small className="editor-layer-note">A mentés és megosztás lapított képet készít.</small>
              <div className="editor-layer-list">
                {([1, 0] as const).map(layer => {
                  const isActive = activeLayer === layer
                  const isVisible = layerVisibility[layer]
                  const layerName = layer === 1 ? 'Felső réteg' : 'Alsó réteg'
                  return (
                    <article className="editor-layer-row" data-active={isActive} key={layer}>
                      <button
                        aria-pressed={isActive}
                        className="editor-layer-select"
                        onClick={() => selectEditorLayer(layer)}
                        type="button"
                      >
                        <strong>{layerName}</strong>
                        <span>{isActive ? 'Aktív' : 'Kiválasztás'}</span>
                      </button>
                      <button
                        aria-label={`${layerName} ${isVisible ? 'elrejtése' : 'megjelenítése'}`}
                        aria-pressed={isVisible}
                        className="editor-layer-visibility"
                        onClick={() => toggleEditorLayerVisibility(layer)}
                        type="button"
                      >{isVisible ? 'Látható' : 'Rejtett'}</button>
                    </article>
                  )
                })}
              </div>
              {!layerVisibility[activeLayer] ? (
                <p className="editor-layer-warning" role="status">Az aktív réteg rejtett; a módosításai csak újbóli megjelenítéskor látszanak.</p>
              ) : null}
            </div>
          </details>
        ) : null}
        {animationMode ? (
          <p className="status-message" role="status">
            {status === text.local
              ? 'Az animáció külön galériába menthető és GIF-ként exportálható; a Rajzfalra és kihívásba nem küldhető be.'
              : status}
          </p>
        ) : null}
        {hasAdvancedAccess ? (
          <details className="editor-palette-panel editor-collapsible-panel">
            <summary className="editor-collapsible-summary">
              <strong>{text.palette}</strong>
              <small>
                {customPaletteActive
                  ? `${activeCustomPalette.name || `Saját paletta ${activePaletteSlot}`} · ${activeCustomPalette.colors.length}/${EDITOR_PALETTE_COLOR_LIMIT}`
                  : paletteSize === 32 ? text.paletteExpanded : text.paletteBase}
              </small>
            </summary>
            <fieldset aria-label={text.palette} className="palette-mode-fieldset editor-palette-picker">
              <label className="editor-palette-select">
                <span>Paletta</span>
                <select
                  aria-label="Paletta kiválasztása"
                  onChange={event => {
                    if (event.target.value === 'custom') setCustomPaletteActive(true)
                    else changePalette(event.target.value === '32' ? 32 : 12)
                  }}
                  value={customPaletteActive ? 'custom' : String(paletteSize)}
                >
                  <option value="custom">Egyéni paletta</option>
                  <option value="12">{text.paletteBase}</option>
                  <option value="32">{text.paletteExpanded}</option>
                </select>
              </label>
              {customPaletteActive ? (
                <div className="editor-custom-palette-manager">
                  <label className="editor-palette-select">
                    <span>Saját paletta</span>
                    <select
                      aria-label="Saját paletta kiválasztása"
                      onChange={event => setActivePaletteSlot(Number(event.target.value) as EditorPaletteSlotIndex)}
                      value={activePaletteSlot}
                    >
                      {customPalettes.map(palette => (
                        <option key={palette.slotIndex} value={palette.slotIndex}>
                          {palette.name || `Saját paletta ${palette.slotIndex}`} · {palette.colors.length}/{EDITOR_PALETTE_COLOR_LIMIT}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="editor-palette-name-row">
                    <label>
                      <span>Paletta neve</span>
                      <input
                        aria-label="Saját paletta neve"
                        maxLength={24}
                        onChange={event => updateCustomPaletteName(event.target.value)}
                        value={activeCustomPalette.name}
                      />
                    </label>
                    <button onClick={saveCustomPaletteName} type="button">Név mentése</button>
                    <button disabled={activeCustomPalette.colors.length === 0} onClick={requestClearCustomPalette} type="button">Kiürítés</button>
                  </div>
                  <small aria-live="polite">{activeCustomPalette.colors.length}/{EDITOR_PALETTE_COLOR_LIMIT} szín · {paletteSyncStatus}</small>
                </div>
              ) : null}
            </fieldset>
          </details>
        ) : null}
      </div>
      {animationMode ? (
        <EditorAnimationControls
          activeFrameIndex={activeAnimationFrame}
          fps={animationFps}
          frames={animationFrames}
          onionSkin={onionSkin}
          onAddFrame={() => addFrame(false)}
          onDeleteFrame={removeActiveFrame}
          onDuplicateFrame={() => addFrame(true)}
          onFpsChange={fps => updateAnimationSettings(fps, onionSkin)}
          onOnionSkinChange={active => updateAnimationSettings(animationFps, active)}
          onSelectFrame={showAnimationFrame}
        />
      ) : null}
      <PixelCanvas
        allowColorMixer={hasAdvancedAccess}
        allowEditorTools={hasAdvancedAccess}
        canDraw
        clearCanvasLabel={animationMode ? 'Teljes képkocka törlése' : 'Aktív réteg törlése'}
        chosenWord={null}
        drawingEndsAt={null}
        events={[]}
        customPaletteActive={hasAdvancedAccess && customPaletteActive}
        customPaletteColors={hasAdvancedAccess ? activeCustomPalette.colors : []}
        customPaletteOptions={hasAdvancedAccess ? customPalettes.map(palette => ({
          label: `${palette.name || `Saját paletta ${palette.slotIndex}`} · ${palette.colors.length}/${EDITOR_PALETTE_COLOR_LIMIT}`,
          slotIndex: palette.slotIndex,
        })) : []}
        customPaletteSlot={activePaletteSlot}
        onionSkinPixels={animationMode && onionSkin && activeAnimationFrame > 0
          ? animationFrames[activeAnimationFrame - 1]
          : null}
        onError={() => setStatus(text.storageError)}
        onLoadFromGallery={hasAdvancedAccess && !animationMode ? () => void openGalleryAction('load') : undefined}
        onCustomPaletteActiveChange={hasAdvancedAccess ? setCustomPaletteActive : undefined}
        onCustomPaletteColorSave={hasAdvancedAccess ? saveCustomColor : undefined}
        onCustomPaletteColorsChange={hasAdvancedAccess ? updateCustomPaletteColors : undefined}
        onCustomPaletteSlotChange={hasAdvancedAccess ? slotIndex => {
          if (slotIndex === 1 || slotIndex === 2 || slotIndex === 3) setActivePaletteSlot(slotIndex)
        } : undefined}
        onPaletteSizeChange={hasAdvancedAccess ? size => changePalette(size === 32 ? 32 : 12) : undefined}
        onSaveToGallery={hasAdvancedAccess && !animationMode ? () => void openGalleryAction('save') : undefined}
        onSubmit={async () => undefined}
        paletteSize={hasAdvancedAccess ? paletteSize : 12}
        roundId={revision}
        serverNow=""
        localDrawing={{
          getDisplayColor: animationMode ? undefined : displayEditorLayerColor,
          initialPixels: pixelsRef.current,
          onChange: handleChange,
          onRequestFlush: flush => { animationFlushRef.current = flush },
          onRequestClear: action => setConfirmation({
            title: animationMode ? text.clearTitle : 'Aktív réteg törlése?',
            message: animationMode ? text.clearMessage : 'Csak a kiválasztott réteg tartalma törlődik. A másik réteg változatlan marad, és a művelet visszavonható.',
            label: text.clear,
            action,
          }),
        }}
      />
      {galleryAction ? (
        <div className="modal-backdrop editor-gallery-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget && !sharing && !confirmation) closeGalleryAction()
        }}>
          <section aria-labelledby="editor-gallery-dialog-title" aria-modal="true" className="editor-gallery-dialog" role="dialog">
            <div className="editor-gallery-dialog-heading">
              <div>
                <p className="step-label">{animationGalleryAction ? 'Animációs galéria · legfeljebb 2 mentés' : 'Saját galéria'}</p>
                <h2 id="editor-gallery-dialog-title">
                  {animationGalleryAction
                    ? saveGalleryAction ? 'Animáció mentése' : 'Animáció betöltése'
                    : saveGalleryAction ? 'Rajz mentése' : 'Rajz betöltése'}
                </h2>
              </div>
              <button disabled={sharing} onClick={closeGalleryAction} ref={galleryCloseRef} type="button">Bezárás</button>
            </div>
            {galleryActionLoading ? <p>Galéria betöltése…</p> : galleryActionError ? <p className="status-message">{galleryActionError}</p> : (
              <div className="editor-gallery-dialog-grid">
                {animationGalleryAction ? ([1, 2] as const).map(slotIndex => {
                  const slot = shareState.animationSlots.find(item => item.slotIndex === slotIndex)
                  return (
                    <article className="editor-own-gallery-slot editor-animation-gallery-slot" key={slotIndex}>
                      <strong>{slotIndex}. animáció</strong>
                      {slot ? <>
                        <EditorAnimationThumbnail fps={slot.fps} frames={slot.frames} label={`Az animációs galéria ${slotIndex}. mentése`} />
                        <small>{slot.frames.length} képkocka · {slot.fps} kép/mp</small>
                      </> : <div className="editor-own-gallery-empty">Üres hely</div>}
                      <div className="editor-own-gallery-actions">
                        {saveGalleryAction ? (
                          <button disabled={sharing} onClick={() => requestSaveAnimationSlot(slotIndex, Boolean(slot))} type="button">{slot ? 'Felülírás' : 'Ide mentem'}</button>
                        ) : (
                          <button disabled={sharing || !slot} onClick={() => slot && requestLoadAnimationSlot(slot)} type="button">{slot ? 'Betöltés' : 'Üres hely'}</button>
                        )}
                        {slot ? <button className="danger-button" disabled={sharing} onClick={() => requestDeleteAnimationSlot(slotIndex)} type="button">Törlés</button> : null}
                      </div>
                    </article>
                  )
                }) : ([1, 2] as const).map(slotIndex => {
                  const slot = shareState.gallerySlots.find(item => item.slotIndex === slotIndex)
                  return (
                    <article className="editor-own-gallery-slot" key={slotIndex}>
                      <strong>{slotIndex}. hely</strong>
                      {slot ? <WeeklyArtwork label={`A saját galéria ${slotIndex}. képe`} pixels={slot.pixels} /> : <div className="editor-own-gallery-empty">Üres hely</div>}
                      {saveGalleryAction ? (
                        <button disabled={sharing || !serverPaletteReady} onClick={() => requestSaveGallerySlot(slotIndex, Boolean(slot))} type="button">{slot ? 'Felülírás' : 'Ide mentem'}</button>
                      ) : (
                        <button disabled={sharing || !slot} onClick={() => slot && requestLoadGallerySlot(slot)} type="button">{slot ? 'Betöltés' : 'Üres hely'}</button>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
      {confirmation ? (
        <ConfirmModal
          title={confirmation.title}
          message={confirmation.message}
          confirmLabel={confirmation.label}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            setConfirmation(null)
            confirmation.action()
          }}
        />
      ) : null}
    </section>
  )
}
