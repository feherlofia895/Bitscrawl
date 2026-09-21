import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { WeeklyArtwork } from './WeeklyArtwork'

export function ArtworkPreview({ label, pixels }: { label: string; pixels: string[] }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(false)
        window.setTimeout(() => triggerRef.current?.focus(), 0)
      } else if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  return <>
    <button
      aria-haspopup="dialog"
      aria-label={`${label} megnyitása teljes méretben`}
      className="artwork-preview-trigger"
      onClick={() => setOpen(true)}
      ref={triggerRef}
      type="button"
    >
      <WeeklyArtwork label={label} pixels={pixels} />
    </button>
    {open ? createPortal(
      <div className="modal-backdrop artwork-lightbox-backdrop" onMouseDown={event => {
        if (event.target === event.currentTarget) close()
      }}>
        <section aria-labelledby={titleId} aria-modal="true" className="artwork-lightbox-modal" role="dialog">
          <h2 className="visually-hidden" id={titleId}>{label}</h2>
          <button aria-label="Teljes kép bezárása" className="artwork-lightbox-close" onClick={close} ref={closeRef} type="button">×</button>
          <WeeklyArtwork label={`${label} teljes méretben`} pixels={pixels} />
        </section>
      </div>,
      document.body,
    ) : null}
  </>
}
