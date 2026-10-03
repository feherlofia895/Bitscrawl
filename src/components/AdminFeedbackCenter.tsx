import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadAdminFeedbackReports,
  setAdminFeedbackStatus,
  type AdminFeedbackReport,
  type FeedbackCategory,
  type FeedbackStatus,
} from '../lib/adminFeedback'

const statusLabels: Record<FeedbackStatus, string> = {
  new: 'Új',
  reviewed: 'Átnézve',
  fixed: 'Megoldva',
  closed: 'Lezárva',
}

const categoryLabels: Record<FeedbackCategory, string> = {
  bug: 'Hiba',
  ui: 'Felület',
  connection: 'Kapcsolat',
  idea: 'Ötlet',
}

const statusOptions: Array<{ label: string; value: FeedbackStatus | null }> = [
  { label: 'Mind', value: null },
  { label: 'Új', value: 'new' },
  { label: 'Átnézve', value: 'reviewed' },
  { label: 'Megoldva', value: 'fixed' },
  { label: 'Lezárva', value: 'closed' },
]

function formatDate(value: string) {
  return new Intl.DateTimeFormat('hu-HU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function technicalEntries(report: AdminFeedbackReport) {
  const context = report.technicalContext
  if (!context || Array.isArray(context) || typeof context !== 'object') return []

  const labels: Record<string, string> = {
    build_id: 'Build',
    captured_at: 'Rögzítve',
    language: 'Nyelv',
    online: 'Online',
    page_url: 'Oldal',
    round_id: 'Kör',
    round_status: 'Körállapot',
    screen: 'Kijelző',
    user_agent: 'Böngésző / eszköz',
    viewport: 'Nézet',
  }

  return Object.entries(context)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => ({
      key,
      label: labels[key] ?? key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }))
}

export function AdminFeedbackCenter({ isAdmin, onBack }: { isAdmin: boolean; onBack: () => void }) {
  const [filter, setFilter] = useState<FeedbackStatus | null>('new')
  const [reports, setReports] = useState<AdminFeedbackReport[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!isAdmin) return
    setIsLoading(true)
    setErrorMessage('')
    try {
      setReports(await loadAdminFeedbackReports(filter))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'A bejegyzéseket nem sikerült betölteni.')
    } finally {
      setIsLoading(false)
    }
  }, [filter, isAdmin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const counts = useMemo(() => ({
    bug: reports.filter(report => report.category !== 'idea').length,
    idea: reports.filter(report => report.category === 'idea').length,
  }), [reports])

  const updateStatus = async (report: AdminFeedbackReport, status: FeedbackStatus) => {
    if (pendingId !== null || report.status === status) return
    setPendingId(report.id)
    setErrorMessage('')
    try {
      const savedStatus = await setAdminFeedbackStatus(report.id, status)
      setReports(current => filter === null || filter === savedStatus
        ? current.map(item => item.id === report.id ? { ...item, status: savedStatus } : item)
        : current.filter(item => item.id !== report.id))
      window.dispatchEvent(new Event('bitscrawl:feedback-status-changed'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Az állapotot nem sikerült elmenteni.')
    } finally {
      setPendingId(null)
    }
  }

  if (!isAdmin) {
    return (
      <section className="admin-feedback-page" id="top" aria-labelledby="admin-feedback-title">
        <header className="admin-feedback-heading">
          <div><p className="step-label">Védett terület</p><h1 id="admin-feedback-title">Admin központ</h1></div>
          <button className="home-back-button" onClick={onBack} type="button">Vissza a főmenübe</button>
        </header>
        <p className="admin-feedback-state" role="alert">Ehhez adminisztrátori jogosultság szükséges.</p>
      </section>
    )
  }

  return (
    <section className="admin-feedback-page" id="top" aria-labelledby="admin-feedback-title">
      <header className="admin-feedback-heading">
        <div>
          <p className="step-label">Csak neked látható</p>
          <h1 id="admin-feedback-title">Admin központ</h1>
          <p>Hibák és ötletek áttekintése, technikai részletekkel.</p>
        </div>
        <button className="home-back-button" onClick={onBack} type="button">Vissza a főmenübe</button>
      </header>

      <nav aria-label="Bejegyzések szűrése" className="admin-feedback-filters">
        {statusOptions.map(option => (
          <button
            aria-pressed={filter === option.value}
            key={option.label}
            onClick={() => setFilter(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </nav>

      {!isLoading && !errorMessage ? (
        <div className="admin-feedback-summary" role="status">
          <strong>{reports.length} bejegyzés</strong>
          <span>{counts.bug} hiba · {counts.idea} ötlet</span>
        </div>
      ) : null}

      {isLoading ? <p className="admin-feedback-state" aria-live="polite">Bejegyzések betöltése…</p> : null}
      {errorMessage ? <p className="admin-feedback-state admin-feedback-error" role="alert">{errorMessage}</p> : null}
      {!isLoading && !errorMessage && reports.length === 0 ? (
        <p className="admin-feedback-state">Ebben az állapotban nincs bejegyzés.</p>
      ) : null}

      <div className="admin-feedback-list">
        {reports.map(report => {
          const technical = technicalEntries(report)
          return (
            <article className="admin-feedback-card" data-category={report.category} key={report.id}>
              <header>
                <div className="admin-feedback-tags">
                  <span>{categoryLabels[report.category]}</span>
                  <span data-status={report.status}>{statusLabels[report.status]}</span>
                </div>
                <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
              </header>
              <p className="admin-feedback-author">Beküldte: <strong>{report.reporterName || 'Névtelen játékos'}</strong></p>
              <p className="admin-feedback-description">{report.description}</p>
              {report.steps ? <div className="admin-feedback-steps"><strong>További részletek</strong><p>{report.steps}</p></div> : null}
              {technical.length ? (
                <details className="admin-feedback-technical">
                  <summary>Technikai adatok</summary>
                  <dl>
                    {technical.map(entry => (
                      <div key={entry.key}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>
                    ))}
                  </dl>
                </details>
              ) : null}
              <div className="admin-feedback-actions" aria-label="Bejegyzés állapota">
                {(Object.keys(statusLabels) as FeedbackStatus[]).map(status => (
                  <button
                    aria-pressed={report.status === status}
                    disabled={pendingId !== null}
                    key={status}
                    onClick={() => void updateStatus(report, status)}
                    type="button"
                  >
                    {pendingId === report.id && report.status !== status ? 'Mentés…' : statusLabels[status]}
                  </button>
                ))}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
