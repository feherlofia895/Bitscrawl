import type { MonthlyChallenge } from '../lib/monthly'
import type { WeeklyChallenge } from '../lib/weekly'

function daysUntil(target: string, serverNow: string) {
  const remaining = Date.parse(target) - Date.parse(serverNow)
  return Math.max(0, Math.ceil(remaining / 86_400_000))
}

function weeklyTimeLabel(challenge: WeeklyChallenge) {
  if (challenge.challenge_status === 'upcoming') {
    return `${daysUntil(challenge.starts_at, challenge.server_now)} nap múlva indul`
  }
  if (challenge.challenge_status === 'closed') return 'lezárult'
  return `${daysUntil(challenge.ends_at, challenge.server_now)} nap múlva vége`
}

function monthlyTimeLabel(challenge: MonthlyChallenge) {
  if (challenge.challenge_status === 'upcoming') {
    return `${daysUntil(challenge.starts_at, challenge.server_now)} nap múlva indul`
  }
  const submissionEndsAt = challenge.submission_ends_at ?? challenge.voting_starts_at
  const entriesOpen = Date.parse(challenge.server_now) < Date.parse(submissionEndsAt)
  if (entriesOpen) {
    const votingNote = challenge.challenge_status === 'voting' ? ' · szavazás folyamatban' : ''
    return `${daysUntil(submissionEndsAt, challenge.server_now)} nap a nevezés végéig${votingNote}`
  }
  if (challenge.challenge_status === 'voting') {
    return `${daysUntil(challenge.ends_at, challenge.server_now)} nap múlva vége`
  }
  return 'lezárult'
}

export function CurrentChallengesSummary({
  monthlyChallenge,
  onOpenMonthly,
  onOpenWeekly,
  weeklyChallenge,
}: {
  monthlyChallenge: MonthlyChallenge | null
  onOpenMonthly: () => void
  onOpenWeekly: () => void
  weeklyChallenge: WeeklyChallenge | null
}) {
  if (!weeklyChallenge && !monthlyChallenge) return null

  return (
    <section className="current-challenges-card" aria-labelledby="current-challenges-title">
      <h2 id="current-challenges-title">Jelenleg futó kihívások:</h2>
      <ul>
        {weeklyChallenge ? <li><p><strong>Heti kihívás:</strong> {weeklyChallenge.prompt} <span>({weeklyTimeLabel(weeklyChallenge)})</span></p><button onClick={onOpenWeekly} type="button">Nevezés</button></li> : null}
        {monthlyChallenge ? <li><p><strong>Havi kihívás:</strong> {monthlyChallenge.prompt} <span>({monthlyTimeLabel(monthlyChallenge)})</span></p><button onClick={onOpenMonthly} type="button">Nevezés</button></li> : null}
      </ul>
    </section>
  )
}
