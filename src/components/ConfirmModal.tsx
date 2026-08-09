import { useEffect, useRef } from 'react'

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
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    cancelButtonRef.current?.focus()
    if (window.history.state?.bitscrawlModal !== 'confirm') {
      window.history.pushState({ bitscrawlModal: 'confirm' }, '')
    }

    const requestCancel = () => {
      if (window.history.state?.bitscrawlModal === 'confirm') {
        window.history.back()
      } else {
        onCancelRef.current()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) requestCancel()
    }
    const handlePopState = () => {
      if (!isBusy) onCancelRef.current()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isBusy])

  return (
    <div
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      aria-modal="true"
      className="modal-backdrop"
      role="dialog"
    >
      <section className="confirm-modal">
        <p className="step-label">Megerősítés</p>
        <h2 id="confirm-modal-title">{title}</h2>
        <p id="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button
            disabled={isBusy}
            onClick={() => {
              if (window.history.state?.bitscrawlModal === 'confirm') {
                window.history.back()
              } else {
                onCancel()
              }
            }}
            ref={cancelButtonRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="confirm-danger-button"
            disabled={isBusy}
            onClick={() => {
              if (window.history.state?.bitscrawlModal === 'confirm') {
                window.history.replaceState({}, '')
              }
              onConfirm()
            }}
            type="button"
          >
            {isBusy ? 'Kilépés…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
