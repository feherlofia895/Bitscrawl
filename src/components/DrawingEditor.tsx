import { useCallback, useEffect, useRef, useState } from 'react'
import { PixelCanvas } from './PixelCanvas'
import { ConfirmModal } from './ConfirmModal'
import { emptyDrawing, parseDrawingDraft, rasterizeDrawing } from '../lib/drawing'
import { editorText as text } from '../lib/editorText'

const STORAGE_KEY = 'bitscrawl-editor-v1'
function readDrawing() {
  try {
    return { ...parseDrawingDraft(localStorage.getItem(STORAGE_KEY)), storageAvailable: true }
  } catch { /* An unavailable or old draft must not prevent drawing. */ }
  return { pixels: emptyDrawing(), exported: true, storageAvailable: false }
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
  const [dirty, setDirty] = useState(!initial.exported)
  const [status, setStatus] = useState<string>(initial.storageAvailable ? text.local : text.storageError)
  const [exporting, setExporting] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    title: string
    message: string
    label: string
    action: () => void
  } | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const persist = useCallback((pixels: string[], exported: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pixels, exported }))
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
    setDirty(false)
    if (persist(pixelsRef.current, true)) setStatus(text.local)
    setRevision(value => value + 1)
  }

  const startNewDrawing = () => {
    if (pixelsRef.current.some(color => color !== 'transparent')) {
      setConfirmation({ title: text.newDrawingTitle, message: text.replace, label: text.newDrawing, action: resetDrawing })
    } else resetDrawing()
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
        </div>
        <p className="status-message" role="status">{status}</p>
      </div>
      <PixelCanvas
        canDraw
        chosenWord={null}
        drawingEndsAt={null}
        events={[]}
        onError={() => setStatus(text.storageError)}
        onSubmit={async () => undefined}
        paletteSize={12}
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
