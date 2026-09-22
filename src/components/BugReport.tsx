import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  submitBugReport,
  type BugReportCategory,
} from '../lib/bugReports'

type BugReportProps = {
  extraTrigger?: ReactNode
  playerName: string
  roomCode: string | null
  roomId: number | null
  roundId: number | null
  roundStatus: string | null
}

const categoryLabels: Record<BugReportCategory, string> = {
  bug: 'Hiba',
  ui: 'Kinézet / kezelhetőség',
  connection: 'Kapcsolódási probléma',
  idea: 'Ötlet',
}

export function BugReport({ extraTrigger, ...props }: BugReportProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [reportMode, setReportMode] = useState<'bug' | 'idea'>('bug')
  const [category, setCategory] = useState<BugReportCategory>('bug')
  const [description, setDescription] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    if (!isOpen) return
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) setIsOpen(false)
    }
    window.addEventListener('keydown', closeWithEscape)
    return () => window.removeEventListener('keydown', closeWithEscape)
  }, [isOpen, isSubmitting])

  const openReport = (mode: 'bug' | 'idea') => {
    setReportMode(mode)
    setCategory(mode)
    setFeedback('')
    setIsOpen(true)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (description.trim().length < 10) {
      setFeedback(`Írd le ${reportMode === 'idea' ? 'az ötletet' : 'a hibát'} legalább 10 karakterben.`)
      return
    }

    setIsSubmitting(true)
    setFeedback('')
    try {
      await submitBugReport({ ...props, category, description, steps: '' })
      setDescription('')
      setFeedback(reportMode === 'idea'
        ? 'Köszönjük! Az ötleted bekerült a ládába.'
        : 'Köszönjük! A hibajelentés megérkezett.')
    } catch (error) {
      console.error(error)
      setFeedback('Nem sikerült elküldeni. Ellenőrizd az internetkapcsolatot, majd próbáld újra.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className="feedback-triggers">
        <button className="bug-report-trigger" onClick={() => openReport('bug')} type="button">
          Hibát találtam
        </button>
        <button className="bug-report-trigger idea-box-trigger" onClick={() => openReport('idea')} type="button">
          Ötletláda
        </button>
        {extraTrigger}
      </div>
      {isOpen
        ? createPortal(
            <div className="bug-report-backdrop" role="presentation">
              <section
                aria-labelledby="bug-report-title"
                aria-modal="true"
                className="bug-report-modal"
                role="dialog"
              >
                <div className="bug-report-heading">
                  <div>
                    <p className="step-label">{reportMode === 'idea' ? 'Ötletek a játékhoz' : 'Tesztelői visszajelzés'}</p>
                    <h2 id="bug-report-title">{reportMode === 'idea' ? 'Van egy ötleted?' : 'Hibát találtál?'}</h2>
                  </div>
                  <button
                    aria-label={`${reportMode === 'idea' ? 'Ötletláda' : 'Hibajelentő'} bezárása`}
                    disabled={isSubmitting}
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <form className="bug-report-form" onSubmit={handleSubmit}>
                  {reportMode === 'bug' ? (
                    <label className="field">
                      <span>Típus</span>
                      <select
                        disabled={isSubmitting}
                        onChange={(event) =>
                          setCategory(event.target.value as BugReportCategory)
                        }
                        value={category}
                      >
                        {Object.entries(categoryLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="field">
                    <span>{reportMode === 'idea' ? 'Na mi legyen?' : 'Na mi van?'}</span>
                    <textarea
                      autoFocus
                      disabled={isSubmitting}
                      maxLength={1500}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder={reportMode === 'idea'
                        ? 'Tűkön ülök, hogy halljam!'
                        : 'Írd le kérlek, mi történt, és legyen szép napod!'}
                      required
                      rows={5}
                      value={description}
                    />
                  </label>
                  <p className="bug-report-privacy">
                    Automatikusan mellékeljük az eszköz, a képernyő és az aktuális játékmenet technikai adatait.
                  </p>
                  {feedback ? <p aria-live="polite" className="bug-report-feedback">{feedback}</p> : null}
                  <button disabled={isSubmitting} type="submit">
                    {isSubmitting
                      ? 'Küldés…'
                      : reportMode === 'idea' ? 'Ötlet elküldése' : 'Hibajelentés elküldése'}
                  </button>
                </form>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
