import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ProfileAvatar } from './ProfileAvatar'

export function ProfilePreviewButton({
  children,
  className = '',
  name,
  pixels,
}: {
  children: ReactNode
  className?: string
  name: string
  pixels: string[] | null
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const close = () => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  return <>
    <button
      aria-haspopup="dialog"
      aria-label={`${name} profiljának megnyitása`}
      className={`profile-preview-trigger ${className}`.trim()}
      onClick={() => setOpen(true)}
      ref={triggerRef}
      type="button"
    >
      {children}
    </button>
    {open ? createPortal(
      <div className="modal-backdrop profile-preview-backdrop" onMouseDown={event => {
        if (event.target === event.currentTarget) close()
      }}>
        <section aria-labelledby="profile-preview-title" aria-modal="true" className="profile-preview-modal" role="dialog">
          <p className="step-label">Játékosprofil</p>
          <ProfileAvatar className="profile-preview-avatar" label={`${name} profilképe nagy méretben`} pixels={pixels} />
          <h2 id="profile-preview-title">{name}</h2>
          {!pixels ? <p className="profile-preview-empty">Még nincs megrajzolt profilképe.</p> : null}
          <button className="profile-preview-close" onClick={close} ref={closeRef} type="button">Bezárás</button>
        </section>
      </div>,
      document.body,
    ) : null}
  </>
}
