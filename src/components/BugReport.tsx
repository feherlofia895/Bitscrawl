import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  submitBugReport,
  type BugReportCategory,
} from '../lib/bugReports'

type BugReportProps = {
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

export function BugReport(props: BugReportProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [category, setCategory] = useState<BugReportCategory>('bug')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState('')
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

  const openReport = () => {
    setFeedback('')
    setIsOpen(true)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (description.trim().length < 10) {
      setFeedback('Írd le a hibát legalább 10 karakterben.')
      return
    }

    setIsSubmitting(true)
    setFeedback('')
    try {
      await submitBugReport({ ...props, category, description, steps })
      setDescription('')
      setSteps('')
      setFeedback('Köszönjük! A hibajelentés megérkezett.')
    } catch (error) {
      console.error(error)
      setFeedback('Nem sikerült elküldeni. Ellenőrizd az internetkapcsolatot, majd próbáld újra.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <button className="bug-report-trigger" onClick={openReport} type="button">
        Hibát találtam
      </button>
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
                    <p className="step-label">Tesztelői visszajelzés</p>
                    <h2 id="bug-report-title">Hibát találtál?</h2>
                  </div>
                  <button
                    aria-label="Hibajelentő bezárása"
                    disabled={isSubmitting}
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <form className="bug-report-form" onSubmit={handleSubmit}>
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
                  <label className="field">
                    <span>Mi történt?</span>
                    <textarea
                      autoFocus
                      disabled={isSubmitting}
                      maxLength={1500}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Írd le röviden, mit láttál és mit vártál helyette."
                      required
                      rows={5}
                      value={description}
                    />
                  </label>
                  <label className="field">
                    <span>Hogyan lehet előidézni? (nem kötelező)</span>
                    <textarea
                      disabled={isSubmitting}
                      maxLength={1500}
                      onChange={(event) => setSteps(event.target.value)}
                      placeholder="Például: beléptem a szobába, teljes nézetre váltottam…"
                      rows={3}
                      value={steps}
                    />
                  </label>
                  <p className="bug-report-privacy">
                    Automatikusan mellékeljük az eszköz, a képernyő és az aktuális játékmenet technikai adatait.
                  </p>
                  {feedback ? <p aria-live="polite" className="bug-report-feedback">{feedback}</p> : null}
                  <button disabled={isSubmitting} type="submit">
                    {isSubmitting ? 'Küldés…' : 'Hibajelentés elküldése'}
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
