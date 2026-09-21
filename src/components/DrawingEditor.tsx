import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelCanvas } from './PixelCanvas'
import { ConfirmModal } from './ConfirmModal'
import { emptyDrawing, parseDrawingDraft, rasterizeDrawing } from '../lib/drawing'
import { editorText as text } from '../lib/editorText'
import type { EditorPaletteSize } from '../lib/palette'
import { basePalette } from '../lib/palette'
import { loadOwnProfile, saveProfileAvatar } from '../lib/profile'
import {
  FEED_DESCRIPTION_MAX_LENGTH,
  FEED_DESCRIPTION_MAX_LINES,
  limitFeedDescription,
  loadDailyFeedAccountState,
  publishDailyFeedPost,
} from '../lib/feed'
import { loadWeeklyAccountState, loadWeeklyChallenges, submitWeeklyEntry } from '../lib/weekly'
import { loadMonthlyAccountState, loadMonthlyChallenges, saveMonthlyEntry, submitMonthlyEntry } from '../lib/monthly'

const STORAGE_KEY = 'bitscrawl-editor-v1'
const challengeColors = new Set(['transparent', ...basePalette.map(color => color.hex)])

type EditorShareState = {
  feedUnavailableMessage: string | null
  feedPostCount: number
  monthly: { id: number; prompt: string; submitted: boolean } | null
  profileReady: boolean
  signedIn: boolean
  weekly: { id: number; prompt: string; submitted: boolean } | null
}

const emptyShareState: EditorShareState = {
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
  const [dirty, setDirty] = useState(!initial.exported)
  const [status, setStatus] = useState<string>(initial.storageAvailable ? text.local : text.storageError)
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [feedDescription, setFeedDescription] = useState('')
  const [shareState, setShareState] = useState<EditorShareState>(emptyShareState)
  const [challengePaletteReady, setChallengePaletteReady] = useState(
    () => initial.pixels.every(color => challengeColors.has(color)),
  )
  const [confirmation, setConfirmation] = useState<{
    title: string
    message: string
    label: string
    action: () => void
  } | null>(null)
  const mountedRef = useRef(true)
  const shareMenuRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

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
    setChallengePaletteReady(pixels.every(color => challengeColors.has(color)))
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
    setChallengePaletteReady(true)
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
      const [feedResult, weeklyChallenges, monthlyChallenges] = await Promise.all([
        loadDailyFeedAccountState()
          .then(account => ({ account, error: null as string | null }))
          .catch(error => ({
            account: null,
            error: error instanceof Error && /get_daily_feed_account_state|schema cache/i.test(error.message)
              ? 'A Hírfolyam adatbázis-frissítése még nincs telepítve.'
              : 'A Hírfolyam most nem érhető el.',
          })),
        loadWeeklyChallenges(),
        loadMonthlyChallenges(),
      ])
      const weekly = weeklyChallenges.find(challenge => challenge.challenge_status === 'active') ?? null
      const monthly = monthlyChallenges.find(challenge => challenge.challenge_status === 'drawing') ?? null
      const [weeklyAccount, monthlyAccount] = await Promise.all([
        weekly ? loadWeeklyAccountState(weekly.challenge_id) : Promise.resolve(null),
        monthly ? loadMonthlyAccountState(monthly.challenge_id) : Promise.resolve(null),
      ])
      if (!mountedRef.current) return
      setShareState({
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
    setSharing(true)
    try {
      if (target === 'feed') {
        await publishDailyFeedPost(snapshot, null, feedDescription)
        setStatus('A rajzod megjelent a Hírfolyamban!')
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
          <label className="field">
            <span>{text.exportSize}</span>
            <select value={scale} onChange={event => setScale(Number(event.target.value))}>
              <option value={1}>{text.original}</option>
              <option value={8}>{text.enlarged}</option>
            </select>
          </label>
          <button className="primary-button" onClick={() => void downloadPng()} disabled={exporting} type="button">{text.export}</button>
          <details className="editor-share-menu" onToggle={event => {
            if (event.currentTarget.open) void refreshShareState()
          }} ref={shareMenuRef}>
            <summary aria-disabled={exporting || sharing}>Megosztás / nevezés</summary>
            <div className="editor-share-options">
              {shareLoading ? <p>Lehetőségek betöltése…</p> : !shareState.signedIn || !shareState.profileReady ? <p>Ehhez jelentkezz be, és mentsd el a profilodat.</p> : <>
                <label className="editor-feed-description">
                  <span>Képleírás <small>(nem kötelező)</small></span>
                  <textarea
                    disabled={sharing || shareState.feedPostCount >= 2}
                    maxLength={FEED_DESCRIPTION_MAX_LENGTH}
                    onChange={event => setFeedDescription(limitFeedDescription(event.target.value))}
                    placeholder="Legfeljebb három rövid sor…"
                    rows={FEED_DESCRIPTION_MAX_LINES}
                    value={feedDescription}
                  />
                  <small>{feedDescription.length}/{FEED_DESCRIPTION_MAX_LENGTH} karakter · legfeljebb {FEED_DESCRIPTION_MAX_LINES} sor</small>
                </label>
                <button disabled={sharing || Boolean(shareState.feedUnavailableMessage) || shareState.feedPostCount >= 2} onClick={() => void shareDrawing('feed')} type="button">
                  {shareState.feedUnavailableMessage ? 'Hírfolyam – frissítésre vár' : shareState.feedPostCount >= 2 ? 'A mai két kép már megosztva' : `Megosztás a Hírfolyamban (${shareState.feedPostCount}/2)`}
                </button>
                <button disabled={sharing || !shareState.weekly || shareState.weekly.submitted || !challengePaletteReady} onClick={() => void shareDrawing('weekly')} type="button">
                  {shareState.weekly ? shareState.weekly.submitted ? 'Heti nevezés már beküldve' : `Heti kihívás: ${shareState.weekly.prompt}` : 'Nincs aktív heti kihívás'}
                </button>
                <button disabled={sharing || !shareState.monthly || shareState.monthly.submitted || !challengePaletteReady} onClick={() => void shareDrawing('monthly')} type="button">
                  {shareState.monthly ? shareState.monthly.submitted ? 'Havi nevezés már beküldve' : `Havi kihívás: ${shareState.monthly.prompt}` : 'Nincs aktív havi kihívás'}
                </button>
                <button disabled={sharing} onClick={requestProfileAvatar} type="button">
                  Beállítás profilképnek
                </button>
                {shareState.feedUnavailableMessage ? <small>{shareState.feedUnavailableMessage}</small> : null}
                {!challengePaletteReady ? <small>A kihívások a 12 színű palettát fogadják. A Hírfolyam a 32 színt is engedi.</small> : null}
              </>}
            </div>
          </details>
        </div>
        <p className="status-message" role="status">{status}</p>
        <fieldset className="palette-mode-fieldset editor-palette-picker">
          <legend>{text.palette}</legend>
          <div className="palette-mode-buttons">
            <button aria-pressed={paletteSize === 12} onClick={() => changePalette(12)} type="button">
              {text.paletteBase}
            </button>
            <button aria-pressed={paletteSize === 32} onClick={() => changePalette(32)} type="button">
              {text.paletteExpanded}
            </button>
          </div>
        </fieldset>
      </div>
      <PixelCanvas
        canDraw
        chosenWord={null}
        drawingEndsAt={null}
        events={[]}
        onError={() => setStatus(text.storageError)}
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
