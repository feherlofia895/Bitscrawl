import { useEffect, useState } from 'react'
import {
  loadLifetimeScoreboard,
  type ScoreboardEntry,
} from '../lib/scoreboard'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfilePreviewButton } from './ProfilePreviewButton'

function medalSummary(entry: ScoreboardEntry) {
  const medals = [
    entry.goldCount ? `🥇 ${entry.goldCount}` : null,
    entry.silverCount ? `🥈 ${entry.silverCount}` : null,
    entry.bronzeCount ? `🥉 ${entry.bronzeCount}` : null,
  ].filter(Boolean)

  return medals.length > 0 ? medals.join(' · ') : 'Még nincs dobogós helyezés'
}

function medalCount(entry: ScoreboardEntry) {
  return entry.goldCount + entry.silverCount + entry.bronzeCount
}

function bestPlacement(entry: ScoreboardEntry) {
  if (entry.goldCount > 0) return 1
  if (entry.silverCount > 0) return 2
  return 3
}

function compareMedalists(first: ScoreboardEntry, second: ScoreboardEntry) {
  return second.goldCount - first.goldCount ||
    second.silverCount - first.silverCount ||
    second.bronzeCount - first.bronzeCount ||
    second.totalPoints - first.totalPoints ||
    first.displayName.localeCompare(second.displayName, 'hu')
}

export function Scoreboard({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<ScoreboardEntry[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const medalists = entries.filter(entry => medalCount(entry) > 0).sort(compareMedalists)

  useEffect(() => {
    let cancelled = false

    loadLifetimeScoreboard()
      .then((scoreboard) => {
        if (!cancelled) {
          setEntries(scoreboard)
        }
      })
      .catch(() => {
        if (!cancelled) setErrorMessage('Most nem sikerült betölteni az örökranglistát.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="scoreboard-page" id="top" aria-labelledby="scoreboard-title">
      <header className="scoreboard-heading">
        <div>
          <p className="step-label">Közösségi kihívások</p>
          <h1 id="scoreboard-title">Dicsőségfal</h1>
          <p>Örökranglista a lezárt heti és havi kihívásokból.</p>
        </div>
        <button className="home-back-button" onClick={onBack} type="button">Vissza a főmenübe</button>
      </header>

      <div className="scoreboard-rule" role="note">
        <strong>Nevezés = 1 pont</strong>
        <span>Minden kapott szavazat +1 pont. Dobogós bónusz jelenleg nincs.</span>
      </div>

      {!isLoading && !errorMessage && medalists.length > 0 ? (
        <section className="hall-of-fame" aria-labelledby="hall-of-fame-title">
          <div className="scoreboard-section-heading">
            <p className="step-label">Érmes játékosok</p>
            <h2 id="hall-of-fame-title">A legmenőbbek</h2>
          </div>
          <ol className="hall-of-fame-grid">
            {medalists.map((entry) => {
              const placement = bestPlacement(entry)
              return (
                <li className="hall-of-fame-card" data-placement={placement} key={entry.displayName}>
                  <span className="hall-of-fame-medal" aria-label={`Legjobb helyezés: ${placement}.`}>
                    {placement === 1 ? '🥇' : placement === 2 ? '🥈' : '🥉'}
                  </span>
                  <ProfilePreviewButton className="hall-of-fame-profile-trigger" name={entry.displayName} pixels={entry.avatarPixels}>
                    <ProfileAvatar label={`${entry.displayName} profilképe`} pixels={entry.avatarPixels} />
                    <strong className="hall-of-fame-player-name">{entry.displayName}</strong>
                  </ProfilePreviewButton>
                  <strong>{medalCount(entry)} érem</strong>
                  <span>{medalSummary(entry)} · {entry.totalPoints} pont</span>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}

      {isLoading ? <p className="scoreboard-state" aria-live="polite">Ranglista betöltése…</p> : null}
      {errorMessage ? <p className="scoreboard-state scoreboard-error" role="alert">{errorMessage}</p> : null}
      {!isLoading && !errorMessage && entries.length === 0 ? (
        <p className="scoreboard-state">Az első lezárt heti vagy havi kihívás után jelennek meg a pontok.</p>
      ) : null}

      {entries.length > 0 ? (
        <section className="lifetime-scoreboard" aria-labelledby="lifetime-scoreboard-title">
          <div className="scoreboard-section-heading">
            <p className="step-label">Minden megszerzett pont</p>
            <h2 id="lifetime-scoreboard-title">Örökranglista</h2>
          </div>
          <ol className="scoreboard-list" aria-label="Bitscrawl örökranglista">
            {entries.map((entry) => (
              <li className="scoreboard-entry" data-rank={entry.rank <= 3 ? entry.rank : undefined} key={entry.displayName}>
                <strong className="scoreboard-position" aria-label={`${entry.rank}. hely`}>{entry.rank}.</strong>
                <ProfilePreviewButton className="scoreboard-profile-trigger" name={entry.displayName} pixels={entry.avatarPixels}>
                  <ProfileAvatar label={`${entry.displayName} profilképe`} pixels={entry.avatarPixels} />
                  <span className="scoreboard-player">
                    <strong>{entry.displayName}</strong>
                    <span>{medalSummary(entry)}</span>
                  </span>
                </ProfilePreviewButton>
                <div className="scoreboard-points">
                  <strong>{entry.totalPoints}</strong>
                  <span>pont</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </section>
  )
}
