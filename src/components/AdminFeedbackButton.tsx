import { useCallback, useEffect, useState } from 'react'
import { loadAdminFeedbackSummary } from '../lib/adminFeedback'

type AdminFeedbackButtonProps = {
  disabled: boolean
  onClick: () => void
}

export function AdminFeedbackButton({ disabled, onClick }: AdminFeedbackButtonProps) {
  const [newCount, setNewCount] = useState(0)

  const refresh = useCallback(() => {
    void loadAdminFeedbackSummary()
      .then(summary => setNewCount(summary.newCount))
      .catch(() => setNewCount(0))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('bitscrawl:feedback-status-changed', refresh)
    return () => window.removeEventListener('bitscrawl:feedback-status-changed', refresh)
  }, [refresh])

  return (
    <button
      aria-label={newCount ? `Admin központ, ${newCount} új bejegyzés` : 'Admin központ'}
      className="topbar-settings-button topbar-admin-button"
      disabled={disabled}
      onClick={onClick}
      title="Admin központ"
      type="button"
    >
      <span aria-hidden="true">◆</span>
      {newCount ? <strong aria-hidden="true" className="topbar-admin-count">{newCount > 99 ? '99+' : newCount}</strong> : null}
    </button>
  )
}
