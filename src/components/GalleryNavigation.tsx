type GalleryNavigationProps = {
  busy: boolean
  onSelectChallenges: () => void
  onSelectWall: () => void
  view: 'wall' | 'challenges'
}

export function GalleryNavigation({
  busy,
  onSelectChallenges,
  onSelectWall,
  view,
}: GalleryNavigationProps) {
  return <nav aria-label="Galéria nézet" className="gallery-view-navigation">
    <div className="gallery-view-tabs">
      <button
        aria-pressed={view === 'wall'}
        disabled={busy}
        onClick={view === 'wall' ? undefined : onSelectWall}
        type="button"
      >Rajzfal</button>
      <button
        aria-pressed={view === 'challenges'}
        disabled={busy}
        onClick={view === 'challenges' ? undefined : onSelectChallenges}
        type="button"
      >Kihívásgaléria</button>
    </div>
  </nav>
}

export function ChallengePeriodNavigation({
  busy,
  onSelectMonthly,
  onSelectWeekly,
  period,
}: {
  busy: boolean
  onSelectMonthly: () => void
  onSelectWeekly: () => void
  period: 'weekly' | 'monthly'
}) {
  return <nav className="gallery-period-tabs" aria-label="Kihívás időtartama">
      <button
        aria-pressed={period === 'weekly'}
        disabled={busy}
        onClick={period === 'weekly' ? undefined : onSelectWeekly}
        type="button"
      >Heti</button>
      <button
        aria-pressed={period === 'monthly'}
        disabled={busy}
        onClick={period === 'monthly' ? undefined : onSelectMonthly}
        type="button"
      >Havi</button>
    </nav>
}
