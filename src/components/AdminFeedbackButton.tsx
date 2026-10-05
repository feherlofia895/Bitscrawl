import { useCallback, useEffect, useState } from 'react'
import { loadAdminFeedbackSummary } from '../lib/adminFeedback'
import { loadAdminStorageStatus } from '../lib/adminStorage'

type AdminFeedbackButtonProps = {
  disabled: boolean
  onClick: () => void
}

export function AdminFeedbackButton({ disabled, onClick }: AdminFeedbackButtonProps) {
  const [newCount, setNewCount] = useState(0)
  const [storageWarning, setStorageWarning] = useState(false)

  const refresh = useCallback(() => {
    void loadAdminFeedbackSummary()
      .then(summary => setNewCount(summary.newCount))
      .catch(() => setNewCount(0))
    void loadAdminStorageStatus()
      .then(status => setStorageWarning(status.warning))
      .catch(() => setStorageWarning(false))
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('bitscrawl:feedback-status-changed', refresh)
    return () => window.removeEventListener('bitscrawl:feedback-status-changed', refresh)
  }, [refresh])

  return (
    <button
      aria-label={[
        'Admin központ',
        newCount ? `${newCount} új bejegyzés` : '',
        storageWarning ? 'a Supabase tárhely elérte a 70 százalékot' : '',
      ].filter(Boolean).join(', ')}
      className="topbar-settings-button topbar-admin-button"
      disabled={disabled}
      onClick={onClick}
      title="Admin központ"
      type="button"
    >
      <span aria-hidden="true">◆</span>
      {newCount || storageWarning ? (
        <strong aria-hidden="true" className="topbar-admin-count">{newCount ? newCount > 99 ? '99+' : newCount : '!'}</strong>
      ) : null}
    </button>
  )
}
