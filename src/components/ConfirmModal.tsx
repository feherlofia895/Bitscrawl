import { useEffect, useId, useRef } from 'react'

type ConfirmModalProps = {
  cancelLabel?: string
  confirmLabel: string
  isBusy?: boolean
  message: string
  onCancel: () => void
  onConfirm: () => void
  title: string
}

export function ConfirmModal({
  cancelLabel = 'Mégsem',
  confirmLabel,
  isBusy = false,
  message,
  onCancel,
  onConfirm,
  title,
}: ConfirmModalProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const modalId = useId()
  const callbacksRef = useRef({ onCancel, onConfirm, isBusy })
  const pendingActionRef = useRef<'cancel' | 'confirm'>('cancel')
  const mountedRef = useRef(false)
  const closingRef = useRef(false)
  const finishedRef = useRef(false)
  const previousStateRef = useRef<Record<string, unknown>>({})
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const requestCloseRef = useRef<(action: 'cancel' | 'confirm') => void>(() => {})

  useEffect(() => {
    callbacksRef.current = { onCancel, onConfirm, isBusy }
  }, [onCancel, onConfirm, isBusy])

  useEffect(() => {
    mountedRef.current = true
    if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement
    }
    cancelButtonRef.current?.focus()
    const ownsHistoryEntry = () => window.history.state?.bitscrawlConfirmId === modalId
    // Reuse the marker during React StrictMode's setup/cleanup/setup cycle.
    if (!ownsHistoryEntry()) {
      previousStateRef.current = window.history.state ?? {}
      window.history.pushState({ ...previousStateRef.current, bitscrawlModal: 'confirm', bitscrawlConfirmId: modalId }, '')
    }
    const finish = () => {
      if (finishedRef.current) return
      finishedRef.current = true
      const callbacks = callbacksRef.current
      if (pendingActionRef.current === 'confirm') callbacks.onConfirm()
      else callbacks.onCancel()
    }
    const requestClose = (action: 'cancel' | 'confirm') => {
      if (callbacksRef.current.isBusy || closingRef.current) return
      closingRef.current = true
      pendingActionRef.current = action
      if (ownsHistoryEntry()) {
        window.history.back()
      } else {
        finish()
      }
    }
    requestCloseRef.current = requestClose

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose('cancel')
      }
      if (event.key === 'Tab') {
        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        if (!buttons?.length) return
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    const handlePopState = () => {
      if (ownsHistoryEntry()) return
      if (!callbacksRef.current.isBusy) finish()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('popstate', handlePopState)
      mountedRef.current = false
      queueMicrotask(() => {
        if (mountedRef.current) return
        if (ownsHistoryEntry()) window.history.replaceState(previousStateRef.current, '')
        if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
      })
    }
  }, [modalId])

  return (
    <div
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <section className="confirm-modal" ref={dialogRef}>
        <p className="step-label">Megerősítés</p>
        <h2 id="confirm-modal-title">{title}</h2>
        <p id="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button
            disabled={isBusy}
            onClick={() => requestCloseRef.current('cancel')}
            ref={cancelButtonRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="confirm-danger-button"
            disabled={isBusy}
            onClick={() => requestCloseRef.current('confirm')}
            type="button"
          >
            {isBusy ? 'Kilépés…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
