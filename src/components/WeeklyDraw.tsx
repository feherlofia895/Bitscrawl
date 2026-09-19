import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { emptyDrawing } from '../lib/drawing'
import {
  getWeeklyUser,
  loadWeeklyAccountState,
  loadWeeklyChallenges,
  loadWeeklyGallery,
  registerWeeklyAccount,
  saveWeeklyDraft,
  setWeeklyProfile,
  setWeeklyVote,
  signInWeeklyAccount,
  signOutWeeklyAccount,
  submitWeeklyEntry,
  type WeeklyAccountState,
  type WeeklyChallenge,
  type WeeklyGalleryEntry,
} from '../lib/weekly'
import { ConfirmModal } from './ConfirmModal'
import { PixelCanvas } from './PixelCanvas'
import { WeeklyArtwork } from './WeeklyArtwork'

type GallerySort = 'discovery' | 'likes' | 'newest'

const blankAccount: WeeklyAccountState = {
  draftPixels: null,
  entryId: null,
  entryPixels: null,
  profileName: null,
  votesUsed: 0,
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Valami nem sikerült. Próbáld újra.'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function discoveryScore(entry: WeeklyGalleryEntry) {
  let hash = entry.entry_id * 2654435761
  for (const char of entry.author_name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

export function WeeklyDraw({ onBack }: { onBack: () => void }) {
  const [challenges, setChallenges] = useState<WeeklyChallenge[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [gallery, setGallery] = useState<WeeklyGalleryEntry[]>([])
  const [account, setAccount] = useState<WeeklyAccountState>(blankAccount)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('A heti kihívás betöltése…')
  const [sort, setSort] = useState<GallerySort>('discovery')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const pixelsRef = useRef(emptyDrawing())
  const saveTimerRef = useRef<number | null>(null)

  const challenge = challenges.find(item => item.challenge_id === selectedId) ?? null
  const isActive = challenge?.challenge_status === 'active'

  const refresh = useCallback(async (challengeId: number, knownUser?: User | null) => {
    const currentUser = knownUser === undefined ? await getWeeklyUser() : knownUser
    const [nextGallery, nextAccount] = await Promise.all([
      loadWeeklyGallery(challengeId),
      currentUser ? loadWeeklyAccountState(challengeId) : Promise.resolve(blankAccount),
    ])
    setUser(currentUser)
    setGallery(nextGallery)
    setAccount(nextAccount)
    const drawing = nextAccount.entryPixels ?? nextAccount.draftPixels ?? emptyDrawing()
    pixelsRef.current = [...drawing]
    setDisplayName(nextAccount.profileName ?? '')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const nextChallenges = await loadWeeklyChallenges()
        if (cancelled) return
        setChallenges(nextChallenges)
        const initial = nextChallenges.find(item => item.challenge_status === 'active') ?? nextChallenges[0]
        if (!initial) {
          setStatus('Még nincs kiírt heti kihívás.')
          return
        }
        setSelectedId(initial.challenge_id)
        await refresh(initial.challenge_id)
        if (!cancelled) setStatus('A heti rajzok naprakészek.')
      } catch (error) {
        if (!cancelled) setStatus(errorMessage(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [refresh])

  const chooseChallenge = async (challengeId: number) => {
    setSelectedId(challengeId)
    setLoading(true)
    try {
      await refresh(challengeId)
      setStatus('A kiválasztott hét betöltve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const handleAuth = async () => {
    setBusy(true)
    try {
      if (authMode === 'register') {
        const result = await registerWeeklyAccount(email, password, displayName)
        if (result.confirmationRequired) {
          setStatus('Elküldtük a megerősítő levelet. Megerősítés után jelentkezz be.')
          setAuthMode('login')
          return
        }
      } else {
        await signInWeeklyAccount(email, password)
      }
      const nextUser = await getWeeklyUser()
      if (selectedId && nextUser) await refresh(selectedId, nextUser)
      setStatus('Sikeresen bejelentkeztél.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleProfile = async () => {
    setBusy(true)
    try {
      await setWeeklyProfile(displayName)
      if (selectedId) await refresh(selectedId, user)
      setStatus('A megjelenített neved elmentve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDrawingChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    setStatus('Vázlat mentése…')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (!selectedId) return
      void saveWeeklyDraft(selectedId, pixelsRef.current)
        .then(() => setStatus('Vázlat elmentve.'))
        .catch(error => setStatus(errorMessage(error)))
    }, 800)
  }, [selectedId])

  const handleSubmit = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      await submitWeeklyEntry(selectedId, pixelsRef.current)
      await refresh(selectedId, user)
      setStatus('A rajzod bekerült a heti galériába!')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleVote = async (entry: WeeklyGalleryEntry) => {
    setBusy(true)
    try {
      await setWeeklyVote(entry.entry_id, !entry.has_voted)
      if (selectedId) await refresh(selectedId, user)
      setStatus(entry.has_voted ? 'A szavazatot visszavontad.' : 'Szavazat elmentve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const sortedGallery = useMemo(() => [...gallery].sort((first, second) => {
    if (sort === 'likes') return second.vote_count - first.vote_count || second.entry_id - first.entry_id
    if (sort === 'newest') return Date.parse(second.submitted_at) - Date.parse(first.submitted_at)
    return discoveryScore(first) - discoveryScore(second)
  }), [gallery, sort])

  const canEdit = Boolean(isActive && user && account.profileName && !account.entryId)

  return (
    <section className="weekly-page" aria-labelledby="weekly-title">
      <header className="weekly-header">
        <div>
          <p className="step-label">Közösségi kihívás</p>
          <h1 id="weekly-title">Heti rajz</h1>
          <p>Minden héten egy téma, egy 32×32-es rajz és három szavazat.</p>
        </div>
        <button onClick={onBack} type="button">Vissza a főmenübe</button>
      </header>

      {challenge ? (
        <section className="weekly-challenge-card">
          <div>
            <span className={`weekly-status weekly-status-${challenge.challenge_status}`}>
              {challenge.challenge_status === 'active' ? 'Most fut' : challenge.challenge_status === 'closed' ? 'Lezárva' : 'Hamarosan'}
            </span>
            <h2>{challenge.prompt}</h2>
            {challenge.description ? <p>{challenge.description}</p> : null}
            <p className="weekly-date">{dateLabel(challenge.starts_at)} – {dateLabel(challenge.ends_at)}</p>
          </div>
          {challenges.length > 1 ? (
            <label className="field weekly-picker">
              <span>Hetek</span>
              <select disabled={loading} onChange={event => void chooseChallenge(Number(event.target.value))} value={challenge.challenge_id}>
                {challenges.map(item => <option key={item.challenge_id} value={item.challenge_id}>{item.week_key} · {item.prompt}</option>)}
              </select>
            </label>
          ) : null}
        </section>
      ) : null}

      {!user ? (
        <section className="weekly-account-card">
          <div>
            <p className="step-label">Fiók</p>
            <h2>{authMode === 'login' ? 'Jelentkezz be a nevezéshez' : 'Készíts játékosfiókot'}</h2>
            <p>A galériát fiók nélkül is megnézheted. Rajzolni és szavazni bejelentkezve lehet.</p>
          </div>
          <div className="weekly-auth-form">
            {authMode === 'register' ? <label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label> : null}
            <label className="field"><span>E-mail</span><input autoComplete="email" onChange={event => setEmail(event.target.value)} type="email" value={email} /></label>
            <label className="field"><span>Jelszó</span><input autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={6} onChange={event => setPassword(event.target.value)} type="password" value={password} /></label>
            <button className="primary-button" disabled={busy || !email || password.length < 6 || (authMode === 'register' && displayName.trim().length < 2)} onClick={() => void handleAuth()} type="button">
              {authMode === 'login' ? 'Belépés' : 'Regisztráció'}
            </button>
            <button disabled={busy} onClick={() => setAuthMode(mode => mode === 'login' ? 'register' : 'login')} type="button">
              {authMode === 'login' ? 'Még nincs fiókom' : 'Már van fiókom'}
            </button>
          </div>
        </section>
      ) : !account.profileName ? (
        <section className="weekly-account-card">
          <div><p className="step-label">Utolsó lépés</p><h2>Hogyan lássanak a galériában?</h2></div>
          <div className="weekly-auth-form">
            <label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label>
            <button className="primary-button" disabled={busy || displayName.trim().length < 2} onClick={() => void handleProfile()} type="button">Név mentése</button>
          </div>
        </section>
      ) : (
        <div className="weekly-user-bar">
          <span>Belépve: <strong>{account.profileName}</strong></span>
          <span>Szavazatok: <strong>{account.votesUsed}/3</strong></span>
          <button disabled={busy} onClick={() => void signOutWeeklyAccount().then(() => { setUser(null); setAccount(blankAccount); setStatus('Kijelentkeztél.') }).catch(error => setStatus(errorMessage(error)))} type="button">Kilépés</button>
        </div>
      )}

      {canEdit ? (
        <section className="weekly-editor">
          <div className="weekly-section-heading">
            <div><p className="step-label">A te rajzod</p><h2>Rajzold le: {challenge?.prompt}</h2></div>
            <button className="primary-button" disabled={busy || !pixelsRef.current.some(color => color !== 'transparent')} onClick={() => setShowSubmit(true)} type="button">Nevezés beküldése</button>
          </div>
          <PixelCanvas
            canDraw
            chosenWord={challenge?.prompt ?? null}
            drawingEndsAt={challenge?.ends_at ?? null}
            events={[]}
            localDrawing={{ initialPixels: account.draftPixels ?? emptyDrawing(), onChange: handleDrawingChange }}
            onError={error => setStatus(errorMessage(error))}
            onSubmit={async () => undefined}
            paletteSize={12}
            roundId={challenge?.challenge_id ?? 0}
            serverNow={challenge?.server_now ?? ''}
          />
        </section>
      ) : account.entryPixels ? (
        <section className="weekly-submitted">
          <WeeklyArtwork label="A beküldött heti rajzod" pixels={account.entryPixels} />
          <div><p className="step-label">Nevezés elküldve</p><h2>A rajzod már a galériában van</h2><p>A beküldött kép ezen a héten már nem módosítható.</p></div>
        </section>
      ) : null}

      <section className="weekly-gallery" aria-labelledby="weekly-gallery-title">
        <div className="weekly-section-heading">
          <div><p className="step-label">Közösség</p><h2 id="weekly-gallery-title">Galéria</h2></div>
          <label className="field weekly-sort"><span>Sorrend</span><select onChange={event => setSort(event.target.value as GallerySort)} value={sort}><option value="discovery">Felfedezés</option><option value="likes">Legkedveltebb</option><option value="newest">Legújabb</option></select></label>
        </div>
        {sortedGallery.length ? <div className="weekly-gallery-grid">{sortedGallery.map(entry => (
          <article className={`weekly-entry${entry.is_winner ? ' is-winner' : ''}`} key={entry.entry_id}>
            {entry.is_winner ? <span className="weekly-winner">Heti győztes</span> : null}
            <WeeklyArtwork label={`${entry.author_name} heti rajza`} pixels={entry.pixels} />
            <div className="weekly-entry-meta"><strong>{entry.author_name}</strong><span>{entry.vote_count} szavazat</span></div>
            <button aria-pressed={entry.has_voted} disabled={busy || !user || !isActive || entry.is_own || (!entry.has_voted && account.votesUsed >= 3)} onClick={() => void handleVote(entry)} type="button">
              {entry.is_own ? 'A te rajzod' : entry.has_voted ? 'Szavazat visszavonása' : 'Szavazok'}
            </button>
          </article>
        ))}</div> : <p className="weekly-empty">Ezen a héten még nincs nevezés. Lehetsz te az első!</p>}
      </section>

      <p className="status-message weekly-message" aria-live="polite">{status}</p>
      {showSubmit ? <ConfirmModal confirmLabel="Beküldöm" isBusy={busy} message="A beküldött rajz ezen a héten már nem módosítható. Biztosan kész van?" onCancel={() => setShowSubmit(false)} onConfirm={() => { setShowSubmit(false); void handleSubmit() }} title="Mehet a galériába?" /> : null}
    </section>
  )
}
