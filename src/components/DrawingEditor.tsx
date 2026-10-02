import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelCanvas } from './PixelCanvas'
import { ConfirmModal } from './ConfirmModal'
import { WeeklyArtwork } from './WeeklyArtwork'
import { emptyDrawing, parseDrawingDraft, rasterizeDrawing } from '../lib/drawing'
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

const STORAGE_KEY = 'bitscrawl-editor-v1'
const serverColors = new Set(['transparent', ...editorPalette32.map(color => color.hex)])

type EditorShareState = {
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
  return { pixels: emptyDrawing(), exported: true, paletteSize: 12 as const, storageAvailable: false }
}

export function DrawingEditor({ onBack, onDirtyChange, onStorageChange }: {
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
  onStorageChange: (available: boolean) => void
}) {
  const [initial] = useState(readDrawing)
  const pixelsRef = useRef(initial.pixels)
  const [revision, setRevision] = useState(0)
  const [scale, setScale] = useState(1)
  const [paletteSize, setPaletteSize] = useState<EditorPaletteSize>(initial.paletteSize)
  const [customPaletteActive, setCustomPaletteActive] = useState(false)
  const [dirty, setDirty] = useState(!initial.exported)
  const [status, setStatus] = useState<string>(initial.storageAvailable ? text.local : text.storageError)
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [feedDescription, setFeedDescription] = useState('')
  const [shareState, setShareState] = useState<EditorShareState>(emptyShareState)
  const [galleryAction, setGalleryAction] = useState<'load' | 'save' | null>(null)
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
  const shareMenuRef = useRef<HTMLDetailsElement>(null)
  const galleryCloseRef = useRef<HTMLButtonElement>(null)
  const galleryPreviousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

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

  const persist = useCallback((pixels: string[], exported: boolean, selectedPalette = paletteSize) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pixels, exported, paletteSize: selectedPalette }))
      onStorageChange(true)
      return true
    } catch {
      onStorageChange(false)
      setStatus(text.storageError)
      return false
    }
  }, [onStorageChange, paletteSize])

  const handleChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    setServerPaletteReady(pixels.every(color => serverColors.has(color)))
    setDirty(true)
    if (persist(pixels, false)) setStatus(text.local)
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

  const resetDrawing = () => {
    pixelsRef.current = emptyDrawing()
    setServerPaletteReady(true)
    setDirty(false)
    if (persist(pixelsRef.current, true)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const startNewDrawing = () => {
    if (pixelsRef.current.some(color => color !== 'transparent')) {
      setConfirmation({ title: text.newDrawingTitle, message: text.replace, label: text.newDrawing, action: resetDrawing })
    } else resetDrawing()
  }

  const changePalette = (nextPalette: EditorPaletteSize) => {
    setCustomPaletteActive(false)
    setPaletteSize(nextPalette)
    if (persist(pixelsRef.current, !dirty, nextPalette)) setStatus(text.local)
  }

  const refreshShareState = useCallback(async () => {
    setShareLoading(true)
    try {
      const { profile, user } = await loadOwnProfile()
      if (!user || !profile) {
        setShareState({ ...emptyShareState, signedIn: Boolean(user), profileReady: Boolean(profile) })
        return
      }
      const [feedResult, galleryResult, weeklyChallenges, monthlyChallenges] = await Promise.all([
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
    const snapshot = [...pixelsRef.current]
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
    const snapshot = [...pixelsRef.current]
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
    if (!pixelsRef.current.some(color => color !== 'transparent')) {
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
      const slots = await loadOwnEditorGallery()
      if (!mountedRef.current) return
      setShareState(current => ({ ...current, gallerySlots: slots, galleryUnavailableMessage: null }))
    } catch (error) {
      if (!mountedRef.current) return
      const message = editorGalleryEndpointIsMissing(error)
        ? 'A saját galéria adatbázis-frissítése még nincs telepítve.'
        : error instanceof Error ? error.message : 'A saját galéria most nem érhető el.'
      setGalleryActionError(message)
    } finally {
      if (mountedRef.current) setGalleryActionLoading(false)
    }
  }

  const saveGallerySlot = async (slotIndex: EditorGallerySlotIndex) => {
    const snapshot = [...pixelsRef.current]
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
    pixelsRef.current = pixels
    setPaletteSize(slot.paletteSize)
    setServerPaletteReady(pixels.every(color => serverColors.has(color)))
    setDirty(true)
    const storedLocally = persist(pixels, false, slot.paletteSize)
    setRevision(value => value + 1)
    if (storedLocally) setStatus(`A saját galéria ${slot.slotIndex}. képe betöltve szerkesztésre.`)
    shareMenuRef.current?.removeAttribute('open')
    setGalleryAction(null)
  }

  const requestLoadGallerySlot = (slot: EditorGallerySlot) => {
    if (!pixelsRef.current.some(color => color !== 'transparent')) {
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

  const downloadPng = async () => {
    setExporting(true)
    const snapshot = [...pixelsRef.current]
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
      if (snapshot.every((color, index) => color === pixelsRef.current[index])) {
        setDirty(false)
        if (persist(snapshot, true)) setStatus(text.downloaded)
      }
    } catch {
      if (mountedRef.current) setStatus(text.exportError)
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }

  return (
    <section className="standalone-editor" aria-labelledby="drawing-editor-title">
      <div className="editor-intro">
        <h1 id="drawing-editor-title">{text.editor}</h1>
        <p>{text.intro}</p>
        <div className="editor-actions">
          <button onClick={onBack} type="button">{text.backPlay}</button>
          <button onClick={startNewDrawing} disabled={exporting} type="button">{text.newDrawing}</button>
          <details className="editor-share-menu" onToggle={event => {
            if (event.target === event.currentTarget && event.currentTarget.open) void refreshShareState()
          }} ref={shareMenuRef}>
            <summary aria-disabled={exporting || sharing}>Megosztás / nevezés</summary>
            <div className="editor-share-options">
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
              {status !== text.local ? <p className="status-message editor-share-status" role="status">{status}</p> : null}
            </div>
          </details>
        </div>
        <fieldset className="palette-mode-fieldset editor-palette-picker">
          <legend>{text.palette}</legend>
          <div className="palette-mode-buttons">
            <button aria-pressed={!customPaletteActive && paletteSize === 12} onClick={() => changePalette(12)} type="button">
              {text.paletteBase}
            </button>
            <button aria-pressed={!customPaletteActive && paletteSize === 32} onClick={() => changePalette(32)} type="button">
              {text.paletteExpanded}
            </button>
            <button aria-pressed={customPaletteActive} onClick={() => setCustomPaletteActive(true)} type="button">
              Egyéni paletta
            </button>
          </div>
        </fieldset>
      </div>
      <PixelCanvas
        allowColorMixer
        canDraw
        chosenWord={null}
        drawingEndsAt={null}
        events={[]}
        customPaletteActive={customPaletteActive}
        onError={() => setStatus(text.storageError)}
        onLoadFromGallery={() => void openGalleryAction('load')}
        onCustomPaletteActiveChange={setCustomPaletteActive}
        onPaletteSizeChange={size => changePalette(size === 32 ? 32 : 12)}
        onSaveToGallery={() => void openGalleryAction('save')}
        onSubmit={async () => undefined}
        paletteSize={paletteSize}
        roundId={revision}
        serverNow=""
        localDrawing={{
          initialPixels: pixelsRef.current,
          onChange: handleChange,
          onRequestClear: action => setConfirmation({
            title: text.clearTitle, message: text.clearMessage, label: text.clear, action,
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
                <p className="step-label">Saját galéria</p>
                <h2 id="editor-gallery-dialog-title">{galleryAction === 'save' ? 'Rajz mentése' : 'Rajz betöltése'}</h2>
              </div>
              <button disabled={sharing} onClick={closeGalleryAction} ref={galleryCloseRef} type="button">Bezárás</button>
            </div>
            {galleryActionLoading ? <p>Galéria betöltése…</p> : galleryActionError ? <p className="status-message">{galleryActionError}</p> : (
              <div className="editor-gallery-dialog-grid">
                {([1, 2] as const).map(slotIndex => {
                  const slot = shareState.gallerySlots.find(item => item.slotIndex === slotIndex)
                  return (
                    <article className="editor-own-gallery-slot" key={slotIndex}>
                      <strong>{slotIndex}. hely</strong>
                      {slot ? <WeeklyArtwork label={`A saját galéria ${slotIndex}. képe`} pixels={slot.pixels} /> : <div className="editor-own-gallery-empty">Üres hely</div>}
                      {galleryAction === 'save' ? (
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
