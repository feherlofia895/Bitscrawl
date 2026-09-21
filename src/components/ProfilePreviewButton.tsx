import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  loadProfileAvatarLikeState,
  setProfileAvatarLike,
  type ProfileAvatarLikeState,
} from '../lib/profile'
import { ProfileAvatar } from './ProfileAvatar'

export function ProfilePreviewButton({
  children,
  className = '',
  name,
  pixels,
  receivedLikes,
}: {
  children: ReactNode
  className?: string
  name: string
  pixels: string[] | null
  receivedLikes?: number
}) {
  const [open, setOpen] = useState(false)
  const [likeState, setLikeState] = useState<ProfileAvatarLikeState | null>(null)
  const [likePending, setLikePending] = useState(false)
  const [likeFeedback, setLikeFeedback] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return

    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(false)
        window.setTimeout(() => triggerRef.current?.focus(), 0)
      } else if (event.key === 'Tab') {
        const controls = [...(modalRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (!controls.length) return
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLikeFeedback('')
    setLikeState(null)
    void loadProfileAvatarLikeState(name)
      .then(state => { if (!cancelled) setLikeState(state) })
      .catch(error => {
        if (!cancelled) setLikeFeedback(error instanceof Error ? error.message : 'A kedvelések nem tölthetők be.')
      })
    return () => { cancelled = true }
  }, [name, open, pixels])

  const close = () => {
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  const toggleLike = async () => {
    if (!likeState?.canLike || likePending) return
    setLikePending(true)
    setLikeFeedback('')
    try {
      setLikeState(await setProfileAvatarLike(name, !likeState.liked))
    } catch (error) {
      setLikeFeedback(error instanceof Error ? error.message : 'A kedvelést nem sikerült menteni.')
    } finally {
      setLikePending(false)
    }
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
        <section aria-labelledby="profile-preview-title" aria-modal="true" className="profile-preview-modal" ref={modalRef} role="dialog">
          <p className="step-label">Játékosprofil</p>
          <ProfileAvatar className="profile-preview-avatar" label={`${name} profilképe nagy méretben`} pixels={pixels} />
          <button
            aria-label={likeState?.liked ? 'Profilkép kedvelésének visszavonása' : 'Profilkép kedvelése'}
            aria-pressed={likeState?.liked ?? false}
            className="profile-avatar-like-button"
            disabled={!pixels || !likeState?.canLike || likePending}
            onClick={() => { void toggleLike() }}
            title={pixels && likeState && !likeState.canLike ? 'A saját profilképedet nem kedvelheted.' : undefined}
            type="button"
          >
            <span aria-hidden="true">♥</span>
            <strong>{likeState?.likeCount ?? 0}</strong>
          </button>
          <h2 id="profile-preview-title">{name}</h2>
          {receivedLikes !== undefined ? <p className="profile-preview-likes"><strong>{receivedLikes}</strong> hírfolyamos kedvelés</p> : null}
          {!pixels ? <p className="profile-preview-empty">Még nincs megrajzolt profilképe.</p> : null}
          {likeFeedback ? <p aria-live="polite" className="profile-avatar-like-feedback">{likeFeedback}</p> : null}
          <button className="profile-preview-close" onClick={close} ref={closeRef} type="button">Bezárás</button>
        </section>
      </div>,
      document.body,
    ) : null}
  </>
}
