import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelCanvas } from './PixelCanvas'
import { EditorAnimationControls } from './EditorAnimationControls'
import { EditorAnimationThumbnail } from './EditorAnimationThumbnail'
import { ConfirmModal } from './ConfirmModal'
import {
  compositeDrawingPixel,
  emptyDrawing,
  isValidEditorDrawingPixels,
  rasterizeDrawing,
} from '../lib/drawing'
import { editorText as text } from '../lib/editorText'
import type { EditorPaletteSize } from '../lib/palette'
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
import { EDITOR_ANIMATION_STORAGE_KEY } from '../lib/editorAnimation'
import {
  addEditorProjectFrame,
  cloneEditorProject,
  composeEditorProjectFrame,
  composeEditorProjectFrames,
  createEmptyEditorProject,
  deleteEditorProjectFrame,
  editorProjectHasContent,
  migrateEditorProject,
  moveEditorProjectLayer,
  replaceEditorProjectLayer,
  type EditorProjectDocument,
  type EditorProjectLayerIndex,
  type EditorProjectLayerVisibility,
} from '../lib/editorProject'
import {
  deleteOwnEditorProject,
  editorProjectsEndpointIsMissing,
  loadOwnEditorProjects,
  saveOwnEditorProject,
  type EditorProjectSlot,
  type EditorProjectSlotIndex,
} from '../lib/editorProjects'
import { createEditorAnimationGifBlob } from '../lib/editorGif'

const STORAGE_KEY = 'bitscrawl-editor-v1'

type EditorShareState = {
  projectSlots: EditorProjectSlot[]
  projectsUnavailableMessage: string | null
  feedUnavailableMessage: string | null
  feedPostCount: number
  monthly: { id: number; prompt: string; submitted: boolean } | null
  profileReady: boolean
  signedIn: boolean
  weekly: { id: number; prompt: string; submitted: boolean } | null
}

const emptyShareState: EditorShareState = {
  projectSlots: [],
  projectsUnavailableMessage: null,
  feedUnavailableMessage: null,
  feedPostCount: 0,
  monthly: null,
  profileReady: false,
  signedIn: false,
  weekly: null,
}
function readProject() {
  try {
    return {
      ...migrateEditorProject(
        localStorage.getItem(STORAGE_KEY),
        localStorage.getItem(EDITOR_ANIMATION_STORAGE_KEY),
      ),
      storageAvailable: true,
    }
  } catch { /* An unavailable or old draft must not prevent drawing. */ }
  return { ...createEmptyEditorProject(), storageAvailable: false }
}

export function DrawingEditor({ hasAdvancedAccess, onBack, onDirtyChange, onOpenProfile, onStorageChange }: {
  hasAdvancedAccess: boolean
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
  onOpenProfile: () => void
  onStorageChange: (available: boolean) => void
}) {
  const [initial] = useState(readProject)
  const projectRef = useRef<EditorProjectDocument>(initial)
  const activeLayerRef = useRef<EditorProjectLayerIndex>(initial.activeLayer)
  const activeFrameRef = useRef(initial.activeFrameIndex)
  const layerVisibilityRef = useRef<EditorProjectLayerVisibility>(initial.layerVisibility)
  const staticPixelsRef = useRef(composeEditorProjectFrame(initial, initial.activeFrameIndex))
  const pixelsRef = useRef(initial.frames[initial.activeFrameIndex].layers[initial.activeLayer])
  const animationFlushRef = useRef<() => void>(() => undefined)
  const [revision, setRevision] = useState(0)
  const [activeLayer, setActiveLayer] = useState<EditorProjectLayerIndex>(initial.activeLayer)
  const [activeFrame, setActiveFrame] = useState(initial.activeFrameIndex)
  const [layerVisibility, setLayerVisibility] = useState<EditorProjectLayerVisibility>(initial.layerVisibility)
  const [projectFrames, setProjectFrames] = useState(() => composeEditorProjectFrames(initial))
  const [scale, setScale] = useState(1)
  const [paletteSize, setPaletteSize] = useState<EditorPaletteSize>(hasAdvancedAccess ? initial.paletteSize : 12)
  const [customPaletteActive, setCustomPaletteActive] = useState(hasAdvancedAccess)
  const [customPalettes, setCustomPalettes] = useState(loadLocalEditorPalettes)
  const [activePaletteSlot, setActivePaletteSlot] = useState<EditorPaletteSlotIndex>(1)
  const [paletteSyncStatus, setPaletteSyncStatus] = useState('Saját paletták betöltése…')
  const [dirty, setDirty] = useState(!initial.exported)
  const [animationFps, setAnimationFps] = useState(initial.fps)
  const [onionSkin, setOnionSkin] = useState(initial.onionSkin)
  const [status, setStatus] = useState<string>(initial.storageAvailable ? text.local : text.storageError)
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [feedDescription, setFeedDescription] = useState('')
  const [shareState, setShareState] = useState<EditorShareState>(emptyShareState)
  const [galleryAction, setGalleryAction] = useState<'load' | 'save' | null>(null)
  const [galleryActionLoading, setGalleryActionLoading] = useState(false)
  const [galleryActionError, setGalleryActionError] = useState<string | null>(null)
  const [galleryPaletteReady, setGalleryPaletteReady] = useState(
    () => initial.frames.every(frame => frame.layers.every(layer => isValidEditorDrawingPixels(layer))),
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
  const shareScrollYRef = useRef(0)
  const galleryCloseRef = useRef<HTMLButtonElement>(null)
  const galleryPreviousFocusRef = useRef<HTMLElement | null>(null)

  const closeShareMenu = () => {
    const scrollY = shareScrollYRef.current
    shareMenuRef.current?.removeAttribute('open')
    window.requestAnimationFrame(() => window.scrollTo(0, scrollY))
  }

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

  const animationMode = projectFrames.length > 1

  const persist = useCallback((project: EditorProjectDocument) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
      onStorageChange(true)
      return true
    } catch {
      onStorageChange(false)
      setStatus(text.storageError)
      return false
    }
  }, [onStorageChange])

  const handleChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    const next = replaceEditorProjectLayer(
      projectRef.current,
      activeFrameRef.current,
      activeLayerRef.current,
      pixels,
    )
    projectRef.current = next
    staticPixelsRef.current = composeEditorProjectFrame(next, activeFrameRef.current)
    setProjectFrames(composeEditorProjectFrames(next))
    setGalleryPaletteReady(next.frames.every(frame =>
      frame.layers.every(layer => isValidEditorDrawingPixels(layer))))
    setDirty(true)
    if (persist(next)) setStatus(text.local)
  }, [persist])

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onStorageChange(initial.storageAvailable) }, [initial.storageAvailable, onStorageChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const showAnimationFrame = useCallback((index: number) => {
    animationFlushRef.current()
    const next = cloneEditorProject(projectRef.current)
    const nextIndex = Math.max(0, Math.min(next.frames.length - 1, index))
    next.activeFrameIndex = nextIndex
    projectRef.current = next
    activeFrameRef.current = nextIndex
    setActiveFrame(nextIndex)
    pixelsRef.current = [...next.frames[nextIndex].layers[activeLayerRef.current]]
    staticPixelsRef.current = composeEditorProjectFrame(next, nextIndex)
    persist(next)
    setRevision(value => value + 1)
  }, [persist])

  useEffect(() => {
    if (hasAdvancedAccess) return
    setCustomPaletteActive(false)
    setPaletteSize(12)
    if (activeFrameRef.current !== 0) showAnimationFrame(0)
  }, [hasAdvancedAccess, showAnimationFrame])

  const selectEditorLayer = (nextLayer: EditorProjectLayerIndex) => {
    if (nextLayer === activeLayerRef.current) return
    animationFlushRef.current()
    const next = cloneEditorProject(projectRef.current)
    next.activeLayer = nextLayer
    projectRef.current = next
    activeLayerRef.current = nextLayer
    setActiveLayer(nextLayer)
    pixelsRef.current = [...next.frames[activeFrameRef.current].layers[nextLayer]]
    if (persist(next)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const toggleEditorLayerVisibility = (layer: EditorProjectLayerIndex) => {
    animationFlushRef.current()
    const next = cloneEditorProject(projectRef.current)
    next.layerVisibility[layer] = !next.layerVisibility[layer]
    next.exported = false
    projectRef.current = next
    layerVisibilityRef.current = [...next.layerVisibility]
    setLayerVisibility([...next.layerVisibility])
    staticPixelsRef.current = composeEditorProjectFrame(next, activeFrameRef.current)
    setProjectFrames(composeEditorProjectFrames(next))
    setGalleryPaletteReady(isValidEditorDrawingPixels(staticPixelsRef.current))
    setDirty(true)
    if (persist(next)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const moveActiveLayer = (direction: -1 | 1) => {
    animationFlushRef.current()
    const target = activeLayerRef.current + direction
    if (target < 0 || target > 2) return
    const next = moveEditorProjectLayer(
      projectRef.current,
      activeLayerRef.current,
      target as EditorProjectLayerIndex,
    )
    projectRef.current = next
    activeLayerRef.current = next.activeLayer
    layerVisibilityRef.current = [...next.layerVisibility]
    pixelsRef.current = [...next.frames[activeFrameRef.current].layers[next.activeLayer]]
    staticPixelsRef.current = composeEditorProjectFrame(next, activeFrameRef.current)
    setActiveLayer(next.activeLayer)
    setLayerVisibility([...next.layerVisibility])
    setProjectFrames(composeEditorProjectFrames(next))
    setGalleryPaletteReady(isValidEditorDrawingPixels(staticPixelsRef.current))
    setDirty(true)
    if (persist(next)) setStatus('A réteg új helyre került minden képkockán.')
    setRevision(value => value + 1)
  }

  const displayEditorLayerColor = useCallback((activeColor: string, index: number) => {
    const frame = projectRef.current.frames[activeFrameRef.current]
    let composite = 'transparent'
    frame.layers.forEach((layer, layerIndex) => {
      if (!layerVisibilityRef.current[layerIndex]) return
      composite = compositeDrawingPixel(
        composite,
        layerIndex === activeLayerRef.current ? activeColor : layer[index],
      )
    })
    return composite
  }, [])

  const editorHasAnyLayerContent = () => editorProjectHasContent(projectRef.current)

  const updateAnimationSettings = (nextFps: number, nextOnionSkin: boolean) => {
    const fpsChanged = nextFps !== projectRef.current.fps
    const next = cloneEditorProject(projectRef.current)
    next.fps = nextFps
    next.onionSkin = nextOnionSkin
    if (fpsChanged) next.exported = false
    projectRef.current = next
    setAnimationFps(nextFps)
    setOnionSkin(nextOnionSkin)
    if (fpsChanged) setDirty(true)
    persist(next)
  }

  const addFrame = (duplicateCurrent: boolean) => {
    if (!hasAdvancedAccess) {
      setStatus('Animáció készítéséhez jelentkezz be.')
      return
    }
    animationFlushRef.current()
    const next = addEditorProjectFrame(projectRef.current, duplicateCurrent)
    if (next.frames.length === projectRef.current.frames.length) return
    projectRef.current = next
    activeFrameRef.current = next.activeFrameIndex
    pixelsRef.current = [...next.frames[next.activeFrameIndex].layers[activeLayerRef.current]]
    staticPixelsRef.current = composeEditorProjectFrame(next, next.activeFrameIndex)
    setActiveFrame(next.activeFrameIndex)
    setProjectFrames(composeEditorProjectFrames(next))
    setDirty(true)
    if (persist(next)) setStatus(duplicateCurrent ? 'A képkocka másolata elkészült.' : 'Új üres képkocka elkészült.')
    setRevision(value => value + 1)
  }

  const removeActiveFrame = () => {
    animationFlushRef.current()
    const next = deleteEditorProjectFrame(projectRef.current, activeFrameRef.current)
    if (next.frames.length === projectRef.current.frames.length) return
    projectRef.current = next
    activeFrameRef.current = next.activeFrameIndex
    pixelsRef.current = [...next.frames[next.activeFrameIndex].layers[activeLayerRef.current]]
    staticPixelsRef.current = composeEditorProjectFrame(next, next.activeFrameIndex)
    setActiveFrame(next.activeFrameIndex)
    setProjectFrames(composeEditorProjectFrames(next))
    setDirty(true)
    if (persist(next)) setStatus('A képkocka törölve.')
    setRevision(value => value + 1)
  }

  const resetDrawing = () => {
    const next = createEmptyEditorProject(paletteSize)
    projectRef.current = next
    activeFrameRef.current = 0
    activeLayerRef.current = 0
    layerVisibilityRef.current = [...next.layerVisibility]
    pixelsRef.current = [...next.frames[0].layers[0]]
    staticPixelsRef.current = emptyDrawing()
    setActiveFrame(0)
    setActiveLayer(0)
    setLayerVisibility([...next.layerVisibility])
    setProjectFrames([emptyDrawing()])
    setAnimationFps(next.fps)
    setOnionSkin(next.onionSkin)
    setGalleryPaletteReady(true)
    setDirty(false)
    if (persist(next)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const startNewDrawing = () => {
    if (editorHasAnyLayerContent()) {
      setConfirmation({
        title: 'Új projekt indítása?',
        message: 'A jelenlegi képkockák és rétegek helyére egy üres projekt kerül.',
        label: 'Új projekt',
        action: resetDrawing,
      })
    } else resetDrawing()
  }

  const changePalette = (nextPalette: EditorPaletteSize) => {
    if (!hasAdvancedAccess && nextPalette !== 12) return
    const next = cloneEditorProject(projectRef.current)
    next.paletteSize = nextPalette
    projectRef.current = next
    setCustomPaletteActive(false)
    setPaletteSize(nextPalette)
    if (persist(next)) setStatus(text.local)
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
      const [feedResult, projectsResult, weeklyChallenges, monthlyChallenges] = await Promise.all([
        loadDailyFeedAccountState()
          .then(account => ({ account, error: null as string | null }))
          .catch(error => ({
            account: null,
            error: error instanceof Error && /get_daily_feed_account_state|schema cache/i.test(error.message)
              ? 'A Rajzfal adatbázis-frissítése még nincs telepítve.'
              : 'A Rajzfal most nem érhető el.',
          })),
        loadOwnEditorProjects()
          .then(slots => ({ slots, error: null as string | null }))
          .catch(error => ({
            slots: [],
            error: editorProjectsEndpointIsMissing(error)
              ? 'A Saját projektek adatbázis-frissítése még nincs telepítve.'
              : error instanceof Error ? error.message : 'A Saját projektek most nem érhetők el.',
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
        projectSlots: projectsResult.slots,
        projectsUnavailableMessage: projectsResult.error,
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
    animationFlushRef.current()
    if (projectRef.current.frames.length > 1) {
      setStatus('Többképkockás projektet GIF-ként vagy Saját projektként menthetsz.')
      return
    }
    const snapshot = composeEditorProjectFrame(projectRef.current, activeFrameRef.current)
    if (!snapshot.some(color => color !== 'transparent')) {
      setStatus('Előbb rajzolj valamit a megosztáshoz.')
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
      closeShareMenu()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A rajz megosztása nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const setDrawingAsProfileAvatar = async () => {
    animationFlushRef.current()
    if (projectRef.current.frames.length > 1) {
      setStatus('Profilképnek egyképkockás projektet használhatsz.')
      return
    }
    const snapshot = composeEditorProjectFrame(projectRef.current, activeFrameRef.current)
    if (!snapshot.some(color => color !== 'transparent')) {
      setStatus('Előbb rajzolj valamit a profilképedhez.')
      return
    }
    setSharing(true)
    try {
      const result = await saveProfileAvatar(snapshot)
      setStatus(result.storage === 'cloud'
        ? 'A rajzod lett az új profilképed.'
        : 'A rajzod ezen az eszközön lett a profilképed. Az online mentés most nem érhető el.')
      closeShareMenu()
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

  const openGalleryAction = async (action: 'load' | 'save') => {
    galleryPreviousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setGalleryAction(action)
    setGalleryActionError(null)
    setGalleryActionLoading(true)
    try {
      const slots = await loadOwnEditorProjects()
      if (!mountedRef.current) return
      setShareState(current => ({
        ...current,
        projectSlots: slots,
        projectsUnavailableMessage: null,
      }))
    } catch (error) {
      if (!mountedRef.current) return
      const message = editorProjectsEndpointIsMissing(error)
        ? 'A Saját projektek adatbázis-frissítése még nincs telepítve.'
        : error instanceof Error ? error.message : 'A Saját projektek most nem érhetők el.'
      setGalleryActionError(message)
    } finally {
      if (mountedRef.current) setGalleryActionLoading(false)
    }
  }

  const saveProjectSlot = async (slotIndex: EditorProjectSlotIndex) => {
    animationFlushRef.current()
    const snapshot = cloneEditorProject(projectRef.current)
    if (!editorProjectHasContent(snapshot)) {
      setStatus('Előbb rajzolj valamit a Saját projektekbe mentéshez.')
      return
    }
    if (!galleryPaletteReady) {
      setStatus('A projekt hibás adatokat tartalmaz, ezért nem menthető.')
      return
    }
    setSharing(true)
    try {
      await saveOwnEditorProject(slotIndex, snapshot)
      await refreshShareState()
      setStatus(`A teljes projekt elmentve a ${slotIndex}. helyre.`)
      setGalleryAction(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A projekt mentése nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestSaveProjectSlot = (slotIndex: EditorProjectSlotIndex, occupied: boolean) => {
    if (!occupied) {
      void saveProjectSlot(slotIndex)
      return
    }
    setConfirmation({
      title: `${slotIndex}. projekt felülírása?`,
      message: 'Az ezen a helyen tárolt teljes projektet lecseréljük a jelenlegire. A régi változat nem állítható vissza.',
      label: 'Felülírás',
      action: () => { void saveProjectSlot(slotIndex) },
    })
  }

  const loadProjectSlot = (slot: EditorProjectSlot) => {
    animationFlushRef.current()
    const next = cloneEditorProject(slot.document)
    next.exported = false
    projectRef.current = next
    activeFrameRef.current = next.activeFrameIndex
    activeLayerRef.current = next.activeLayer
    layerVisibilityRef.current = [...next.layerVisibility]
    staticPixelsRef.current = composeEditorProjectFrame(next, next.activeFrameIndex)
    pixelsRef.current = [...next.frames[next.activeFrameIndex].layers[next.activeLayer]]
    setActiveFrame(next.activeFrameIndex)
    setActiveLayer(next.activeLayer)
    setLayerVisibility([...next.layerVisibility])
    setProjectFrames(composeEditorProjectFrames(next))
    setAnimationFps(next.fps)
    setOnionSkin(next.onionSkin)
    setPaletteSize(next.paletteSize)
    setCustomPaletteActive(false)
    setGalleryPaletteReady(true)
    setDirty(true)
    const storedLocally = persist(next)
    setRevision(value => value + 1)
    if (storedLocally) setStatus(`A ${slot.slotIndex}. projekt minden réteggel és képkockával betöltve.`)
    closeShareMenu()
    setGalleryAction(null)
  }

  const requestLoadProjectSlot = (slot: EditorProjectSlot) => {
    if (!editorHasAnyLayerContent()) {
      loadProjectSlot(slot)
      return
    }
    setConfirmation({
      title: `${slot.slotIndex}. projekt betöltése?`,
      message: 'A mentett projekt minden képkockája és rétege a jelenlegi helyére kerül. A mostani változat csak akkor marad meg, ha előbb elmented.',
      label: 'Betöltés',
      action: () => loadProjectSlot(slot),
    })
  }

  const deleteProjectSlot = async (slotIndex: EditorProjectSlotIndex) => {
    setSharing(true)
    try {
      await deleteOwnEditorProject(slotIndex)
      await refreshShareState()
      setStatus(`A ${slotIndex}. Saját projekt törölve.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A mentett projekt törlése nem sikerült.')
    } finally {
      if (mountedRef.current) setSharing(false)
    }
  }

  const requestDeleteProjectSlot = (slotIndex: EditorProjectSlotIndex) => {
    setConfirmation({
      title: `${slotIndex}. projekt törlése?`,
      message: 'A Saját projektekből törölt mentést nem lehet visszaállítani. A szerkesztőben lévő projekt ettől nem változik.',
      label: 'Törlés',
      action: () => { void deleteProjectSlot(slotIndex) },
    })
  }

  const downloadGif = async () => {
    animationFlushRef.current()
    const frames = composeEditorProjectFrames(projectRef.current)
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
    animationFlushRef.current()
    setExporting(true)
    const snapshot = composeEditorProjectFrame(projectRef.current, activeFrameRef.current)
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
      const currentComposite = composeEditorProjectFrame(projectRef.current, activeFrameRef.current)
      if (snapshot.every((color, index) => color === currentComposite[index])) {
        const next = cloneEditorProject(projectRef.current)
        next.exported = true
        projectRef.current = next
        setDirty(false)
        if (persist(next)) setStatus(text.downloaded)
      }
    } catch {
      if (mountedRef.current) setStatus(text.exportError)
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  const saveGalleryAction = galleryAction === 'save'
  const openShareMenu = () => {
    if (exporting || sharing || !shareMenuRef.current) return
    shareScrollYRef.current = window.scrollY
    shareMenuRef.current.open = true
  }

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
          <details className="editor-share-menu is-canvas-triggered" onToggle={event => {
            if (hasAdvancedAccess && event.target === event.currentTarget && event.currentTarget.open) void refreshShareState()
          }} ref={shareMenuRef}>
            <summary>Megosztás</summary>
            <div className="editor-share-options">
              <button className="editor-share-close" onClick={closeShareMenu} type="button">Bezárás</button>
              {shareLoading ? <p>Lehetőségek betöltése…</p> : !shareState.signedIn || !shareState.profileReady ? (
                <p>A Saját projektekhez és a megosztáshoz jelentkezz be, majd mentsd el a profilodat.</p>
              ) : <div className="editor-project-share-options">
                <strong>Saját projektek</strong>
                <button disabled={galleryActionLoading || sharing || Boolean(shareState.projectsUnavailableMessage)} onClick={() => void openGalleryAction('save')} type="button">
                  Teljes projekt mentése
                </button>
                <button disabled={galleryActionLoading || sharing || Boolean(shareState.projectsUnavailableMessage)} onClick={() => void openGalleryAction('load')} type="button">
                  Projekt betöltése ({shareState.projectSlots.length}/4)
                </button>
                {shareState.projectsUnavailableMessage ? <small>{shareState.projectsUnavailableMessage}</small> : null}
                {!galleryPaletteReady ? <small>A projekt hibás adatokat tartalmaz, ezért nem menthető.</small> : null}
              </div>}
              {animationMode ? (
                <div className="editor-animation-share-options">
                  <strong>Animáció exportálása</strong>
                  <button className="primary-button" disabled={exporting} onClick={() => void downloadGif()} type="button">
                    {exporting ? 'GIF készítése…' : 'GIF export · 256×256'}
                  </button>
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
                  <small>A kevert színeket a Rajzfal, a profilkép, a kihívások és a Saját projektek is elfogadják.</small>
                </div>
                {shareState.signedIn && shareState.profileReady ? <>
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
                  <button disabled={sharing || Boolean(shareState.feedUnavailableMessage) || shareState.feedPostCount >= FEED_DAILY_POST_LIMIT} onClick={() => void shareDrawing('feed')} type="button">
                    {shareState.feedUnavailableMessage ? 'Rajzfal – frissítésre vár' : shareState.feedPostCount >= FEED_DAILY_POST_LIMIT ? 'A mai három kép már megosztva' : `Megosztás a Rajzfalon (${shareState.feedPostCount}/${FEED_DAILY_POST_LIMIT})`}
                  </button>
                  <button disabled={sharing || !shareState.weekly || shareState.weekly.submitted} onClick={() => void shareDrawing('weekly')} type="button">
                    {shareState.weekly ? shareState.weekly.submitted ? 'Heti nevezés már beküldve' : `Heti kihívás: ${shareState.weekly.prompt}` : 'Nincs aktív heti kihívás'}
                  </button>
                  <button disabled={sharing || !shareState.monthly || shareState.monthly.submitted} onClick={() => void shareDrawing('monthly')} type="button">
                    {shareState.monthly ? shareState.monthly.submitted ? 'Havi nevezés már beküldve' : `Havi kihívás: ${shareState.monthly.prompt}` : 'Nincs aktív havi kihívás'}
                  </button>
                  <button disabled={sharing} onClick={requestProfileAvatar} type="button">Beállítás profilképnek</button>
                  {shareState.feedUnavailableMessage ? <small>{shareState.feedUnavailableMessage}</small> : null}
                </> : null}
              </>}
              {status !== text.local ? <p className="status-message editor-share-status" role="status">{status}</p> : null}
            </div>
          </details>
        </div>
        <section aria-label="Képkockák és rétegek" className="editor-project-structure">
          <details className="editor-layer-panel editor-collapsible-panel">
            <summary className="editor-collapsible-summary">
              <strong>Rétegek</strong>
              <small>{activeLayer === 2 ? 'Felső aktív' : activeLayer === 1 ? 'Középső aktív' : 'Alsó aktív'}</small>
            </summary>
            <div className="editor-layer-content">
              <small className="editor-layer-note">A három réteg minden képkockán külön megmarad. Exportáláskor és megosztáskor egy képpé állnak össze.</small>
              <div className="editor-layer-list">
                {([2, 1, 0] as const).map(layer => {
                  const isActive = activeLayer === layer
                  const isVisible = layerVisibility[layer]
                  const layerName = layer === 2 ? 'Felső réteg' : layer === 1 ? 'Középső réteg' : 'Alsó réteg'
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
              <div className="editor-layer-order-actions">
                <button className="editor-layer-swap" disabled={activeLayer === 0} onClick={() => moveActiveLayer(-1)} type="button">
                  <span aria-hidden="true">↓</span> Réteg lejjebb
                </button>
                <button className="editor-layer-swap" disabled={activeLayer === 2} onClick={() => moveActiveLayer(1)} type="button">
                  <span aria-hidden="true">↑</span> Réteg feljebb
                </button>
              </div>
              <small className="editor-layer-note">A sorrend módosítása minden képkockára érvényes.</small>
              {!layerVisibility[activeLayer] ? (
                <p className="editor-layer-warning" role="status">Az aktív réteg rejtett; a módosításai csak újbóli megjelenítéskor látszanak.</p>
              ) : null}
            </div>
          </details>
          {hasAdvancedAccess ? (
            <EditorAnimationControls
              activeFrameIndex={activeFrame}
              fps={animationFps}
              frames={projectFrames}
              onionSkin={onionSkin}
              onAddFrame={() => addFrame(false)}
              onDeleteFrame={removeActiveFrame}
              onDuplicateFrame={() => addFrame(true)}
              onFpsChange={fps => updateAnimationSettings(fps, onionSkin)}
              onOnionSkinChange={active => updateAnimationSettings(animationFps, active)}
              onSelectFrame={showAnimationFrame}
            />
          ) : null}
        </section>
        {animationMode ? (
          <p className="status-message" role="status">
            {status === text.local
              ? 'A többképkockás projekt GIF-ként exportálható; a Rajzfalra és kihívásba egyképkockás projekt küldhető.'
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
      <PixelCanvas
        allowColorMixer={hasAdvancedAccess}
        allowEditorTools={hasAdvancedAccess}
        canDraw
        clearCanvasLabel="Aktív réteg törlése"
        chosenWord={null}
        compactMobileToolbar
        drawingEndsAt={null}
        events={[]}
        customPaletteActive={hasAdvancedAccess && customPaletteActive}
        customPaletteColors={hasAdvancedAccess ? activeCustomPalette.colors : []}
        customPaletteOptions={hasAdvancedAccess ? customPalettes.map(palette => ({
          label: `${palette.name || `Saját paletta ${palette.slotIndex}`} · ${palette.colors.length}/${EDITOR_PALETTE_COLOR_LIMIT}`,
          slotIndex: palette.slotIndex,
        })) : []}
        customPaletteSlot={activePaletteSlot}
        onionSkinPixels={hasAdvancedAccess && onionSkin && activeFrame > 0
          ? projectFrames[activeFrame - 1]
          : null}
        onError={() => setStatus(text.storageError)}
        onLoadFromGallery={hasAdvancedAccess ? () => void openGalleryAction('load') : undefined}
        onCustomPaletteActiveChange={hasAdvancedAccess ? setCustomPaletteActive : undefined}
        onCustomPaletteColorSave={hasAdvancedAccess ? saveCustomColor : undefined}
        onCustomPaletteColorsChange={hasAdvancedAccess ? updateCustomPaletteColors : undefined}
        onCustomPaletteSlotChange={hasAdvancedAccess ? slotIndex => {
          if (slotIndex === 1 || slotIndex === 2 || slotIndex === 3) setActivePaletteSlot(slotIndex)
        } : undefined}
        onPaletteSizeChange={hasAdvancedAccess ? size => changePalette(size === 32 ? 32 : 12) : undefined}
        onSaveToGallery={hasAdvancedAccess ? () => void openGalleryAction('save') : undefined}
        onShare={openShareMenu}
        onSubmit={async () => undefined}
        paletteSize={hasAdvancedAccess ? paletteSize : 12}
        roundId={revision}
        serverNow=""
        shareDisabled={exporting || sharing}
        showDrawModeBadge={false}
        localDrawing={{
          getDisplayColor: displayEditorLayerColor,
          initialPixels: pixelsRef.current,
          onChange: handleChange,
          onRequestFlush: flush => { animationFlushRef.current = flush },
          onRequestClear: action => setConfirmation({
            title: 'Aktív réteg törlése?',
            message: 'Csak a kiválasztott réteg tartalma törlődik. A másik két réteg és a többi képkocka változatlan marad, a művelet pedig visszavonható.',
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
                <p className="step-label">Saját projektek · legfeljebb 4 mentés</p>
                <h2 id="editor-gallery-dialog-title">
                  {saveGalleryAction ? 'Teljes projekt mentése' : 'Projekt betöltése'}
                </h2>
              </div>
              <button disabled={sharing} onClick={closeGalleryAction} ref={galleryCloseRef} type="button">Bezárás</button>
            </div>
            {galleryActionLoading ? <p>Galéria betöltése…</p> : galleryActionError ? <p className="status-message">{galleryActionError}</p> : (
              <div className="editor-gallery-dialog-grid">
                {([1, 2, 3, 4] as const).map(slotIndex => {
                  const slot = shareState.projectSlots.find(item => item.slotIndex === slotIndex)
                  return (
                    <article className="editor-own-gallery-slot editor-animation-gallery-slot" key={slotIndex}>
                      <strong>{slotIndex}. projekt</strong>
                      {slot ? <>
                        <EditorAnimationThumbnail fps={slot.document.fps} frames={slot.previewFrames} label={`A Saját projektek ${slotIndex}. mentése`} />
                        <small>{slot.document.frames.length} képkocka · 3 réteg</small>
                      </> : <div className="editor-own-gallery-empty">Üres hely</div>}
                      <div className="editor-own-gallery-actions">
                        {saveGalleryAction ? (
                          <button disabled={sharing || !galleryPaletteReady} onClick={() => requestSaveProjectSlot(slotIndex, Boolean(slot))} type="button">{slot ? 'Felülírás' : 'Ide mentem'}</button>
                        ) : (
                          <button disabled={sharing || !slot} onClick={() => slot && requestLoadProjectSlot(slot)} type="button">{slot ? 'Betöltés' : 'Üres hely'}</button>
                        )}
                        {slot ? <button className="danger-button" disabled={sharing} onClick={() => requestDeleteProjectSlot(slotIndex)} type="button">Törlés</button> : null}
                      </div>
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
