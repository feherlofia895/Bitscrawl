import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { emptyDrawing } from '../lib/drawing'
import {
  loadMonthlyAccountState,
  loadMonthlyChallenges,
  loadMonthlyGallery,
  saveMonthlyEntry,
  setMonthlyVote,
  submitMonthlyEntry,
  type MonthlyAccountState,
  type MonthlyChallenge,
  type MonthlyGalleryEntry,
} from '../lib/monthly'
import {
  getWeeklyUser,
  registerWeeklyAccount,
  setWeeklyProfile,
  signInWeeklyAccount,
  signOutWeeklyAccount,
} from '../lib/weekly'
import { PixelCanvas } from './PixelCanvas'
import { ProfileAvatar } from './ProfileAvatar'
import { WeeklyArtwork } from './WeeklyArtwork'

const blankAccount: MonthlyAccountState = {
  entryId: null,
  entryPixels: null,
  profileName: null,
  submittedAt: null,
  updatedAt: null,
  votesUsed: 0,
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Valami nem sikerült. Próbáld újra.'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function profileNameFromUser(user: User | null) {
  return typeof user?.user_metadata.display_name === 'string'
    ? user.user_metadata.display_name.trim()
    : ''
}

export function MonthlyDraw({
  mode,
  onBack,
  onSelectWeekly,
}: {
  mode: 'challenge' | 'gallery'
  onBack: () => void
  onSelectWeekly: () => void
}) {
  const [challenges, setChallenges] = useState<MonthlyChallenge[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [gallery, setGallery] = useState<MonthlyGalleryEntry[]>([])
  const [account, setAccount] = useState<MonthlyAccountState>(blankAccount)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('A havi kihívás betöltése…')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const pixelsRef = useRef(emptyDrawing())
  const saveTimerRef = useRef<number | null>(null)

  const challenge = challenges.find(item => item.challenge_id === selectedId) ?? null
  const isDrawing = challenge?.challenge_status === 'drawing'
  const isVoting = challenge?.challenge_status === 'voting'

  const refresh = useCallback(async (challengeId: number, knownUser?: User | null) => {
    const currentUser = knownUser === undefined ? await getWeeklyUser() : knownUser
    setUser(currentUser)
    if (currentUser) {
      const rememberedName = profileNameFromUser(currentUser)
      if (rememberedName) {
        setAccount(current => current.profileName ? current : { ...current, profileName: rememberedName })
        setDisplayName(rememberedName)
      }
    }
    const [nextGallery, nextAccount] = await Promise.all([
      loadMonthlyGallery(challengeId),
      currentUser ? loadMonthlyAccountState(challengeId) : Promise.resolve(blankAccount),
    ])
    setGallery(nextGallery)
    setAccount(nextAccount)
    pixelsRef.current = [...(nextAccount.entryPixels ?? emptyDrawing())]
    setDisplayName(nextAccount.profileName ?? '')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const currentUser = await getWeeklyUser()
        if (cancelled) return
        setUser(currentUser)
        const rememberedName = profileNameFromUser(currentUser)
        if (rememberedName) {
          setAccount(current => ({ ...current, profileName: rememberedName }))
          setDisplayName(rememberedName)
        }
        const nextChallenges = await loadMonthlyChallenges()
        if (cancelled) return
        setChallenges(nextChallenges)
        const initial = nextChallenges.find(item => ['drawing', 'voting'].includes(item.challenge_status)) ?? nextChallenges[0]
        if (!initial) return setStatus('Még nincs havi kihívás.')
        setSelectedId(initial.challenge_id)
        await refresh(initial.challenge_id, currentUser)
        if (!cancelled) setStatus('A havi kihívás naprakész.')
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
    try { await refresh(challengeId); setStatus('A kiválasztott hónap betöltve.') }
    catch (error) { setStatus(errorMessage(error)) }
    finally { setLoading(false) }
  }

  const handleAuth = async () => {
    setBusy(true)
    try {
      if (authMode === 'register') await registerWeeklyAccount(email, password, displayName)
      else await signInWeeklyAccount(email, password)
      const nextUser = await getWeeklyUser()
      setUser(nextUser)
      const rememberedName = profileNameFromUser(nextUser)
      if (rememberedName) {
        setAccount(current => ({ ...current, profileName: rememberedName }))
        setDisplayName(rememberedName)
      }
      if (selectedId && nextUser) await refresh(selectedId, nextUser)
      setStatus('Sikeresen bejelentkeztél.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleProfile = async () => {
    setBusy(true)
    try {
      await setWeeklyProfile(displayName)
      if (selectedId) await refresh(selectedId, user)
      setStatus('A megjelenített neved elmentve.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleDrawingChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    setStatus('Havi rajz mentése…')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      if (!selectedId) return
      void saveMonthlyEntry(selectedId, pixelsRef.current)
        .then(() => setStatus('A havi rajz elmentve, később is folytathatod.'))
        .catch(error => setStatus(errorMessage(error)))
    }, 800)
  }, [selectedId])

  const handleVote = async (entry: MonthlyGalleryEntry) => {
    setBusy(true)
    try {
      await setMonthlyVote(entry.entry_id, !entry.has_voted)
      if (selectedId) await refresh(selectedId, user)
      setStatus(entry.has_voted ? 'A szavazatot visszavontad.' : 'Szavazat elmentve.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleSubmit = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      await saveMonthlyEntry(selectedId, pixelsRef.current)
      await submitMonthlyEntry(selectedId)
      await refresh(selectedId, user)
      setStatus('A havi rajzod bekerült a nevezések közé. A szavazás kezdetéig tovább szerkesztheted.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const sortedGallery = useMemo(() => [...gallery].sort((a, b) =>
    b.vote_count - a.vote_count || Date.parse(b.updated_at) - Date.parse(a.updated_at)
  ), [gallery])

  const statusLabel = challenge?.challenge_status === 'drawing' ? 'Rajzolási időszak'
    : challenge?.challenge_status === 'voting' ? 'Szavazás'
      : challenge?.challenge_status === 'closed' ? 'Lezárva' : 'Hamarosan'

  return <section className="weekly-page" aria-labelledby="monthly-title">
    <header className="weekly-header">
      <div><p className="step-label">Havi közösségi kihívás</p><h1 id="monthly-title">{mode === 'challenge' ? 'Kihívás' : 'Galéria'}</h1><p>Egy teljes hónap egy nagyobb pixelrajzra.</p></div>
      <button onClick={onBack} type="button">Vissza a főmenübe</button>
    </header>
    <nav className="challenge-period-switch" aria-label="Kihívás időtartama">
      <button onClick={onSelectWeekly} type="button">{mode === 'gallery' ? 'Heti galéria' : 'Heti kihívás'}</button>
      <button aria-pressed="true" type="button">{mode === 'gallery' ? 'Havi galéria' : 'Havi kihívás'}</button>
    </nav>

    {challenge ? <section className="weekly-challenge-card">
      <div><span className={`weekly-status weekly-status-${challenge.challenge_status}`}>{statusLabel}</span><h2>{challenge.prompt}</h2><p>{challenge.description}</p><p className="weekly-date">Rajzolás: {dateLabel(challenge.starts_at)} – {dateLabel(challenge.voting_starts_at)}<br />Szavazás vége: {dateLabel(challenge.ends_at)}</p></div>
      {challenges.length > 1 ? <label className="field weekly-picker"><span>Hónapok</span><select disabled={loading} onChange={event => void chooseChallenge(Number(event.target.value))} value={challenge.challenge_id}>{challenges.map(item => <option key={item.challenge_id} value={item.challenge_id}>{item.month_key} · {item.prompt}</option>)}</select></label> : null}
    </section> : null}

    {!loading && !user ? <section className="weekly-account-card"><div><p className="step-label">Fiók</p><h2>{authMode === 'login' ? 'Jelentkezz be a rajzoláshoz' : 'Készíts játékosfiókot'}</h2><p>A havi rajz mentéséhez és a szavazáshoz fiók szükséges.</p></div><div className="weekly-auth-form">
      {authMode === 'register' ? <label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label> : null}
      <label className="field"><span>E-mail</span><input onChange={event => setEmail(event.target.value)} type="email" value={email} /></label>
      <label className="field"><span>Jelszó</span><input minLength={6} onChange={event => setPassword(event.target.value)} type="password" value={password} /></label>
      <button className="primary-button" disabled={busy || !email || password.length < 6 || (authMode === 'register' && displayName.trim().length < 2)} onClick={() => void handleAuth()} type="button">{authMode === 'login' ? 'Belépés' : 'Regisztráció'}</button>
      <button disabled={busy} onClick={() => setAuthMode(current => current === 'login' ? 'register' : 'login')} type="button">{authMode === 'login' ? 'Még nincs fiókom' : 'Már van fiókom'}</button>
    </div></section> : user && !loading && !account.profileName ? <section className="weekly-account-card"><div><h2>Válassz megjelenített nevet</h2></div><div className="weekly-auth-form"><label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label><button className="primary-button" disabled={busy || displayName.trim().length < 2} onClick={() => void handleProfile()} type="button">Név mentése</button></div></section> : user && account.profileName ? <div className="weekly-user-bar"><span>Belépve: <strong>{account.profileName}</strong></span><span>Szavazatok: <strong>{account.votesUsed}/3</strong></span><button disabled={busy} onClick={() => void signOutWeeklyAccount().then(() => { setUser(null); setAccount(blankAccount) })} type="button">Kilépés</button></div> : null}

    {mode === 'challenge' && isDrawing && user && account.profileName ? <section className="weekly-editor"><div className="weekly-section-heading"><div><p className="step-label">A te havi rajzod</p><h2>Rajzold le: {challenge?.prompt}</h2><p>Minden változtatás automatikusan mentődik.</p></div>{account.submittedAt ? <span className="weekly-status weekly-status-active">Beküldve · még szerkeszthető</span> : <button className="primary-button" disabled={busy || !pixelsRef.current.some(pixel => pixel !== 'transparent')} onClick={() => void handleSubmit()} type="button">Beküldés</button>}</div><PixelCanvas canDraw chosenWord={challenge?.prompt ?? null} drawingEndsAt={challenge?.voting_starts_at ?? null} events={[]} localDrawing={{ initialPixels: account.entryPixels ?? emptyDrawing(), onChange: handleDrawingChange }} onError={error => setStatus(errorMessage(error))} onSubmit={handleSubmit} paletteSize={12} roundId={challenge?.challenge_id ?? 0} serverNow={challenge?.server_now ?? ''} /></section> : null}

    {mode === 'challenge' && !isDrawing && account.submittedAt && account.entryPixels ? <section className="weekly-submitted"><WeeklyArtwork label="A havi rajzod" pixels={account.entryPixels} /><div><p className="step-label">{statusLabel}</p><h2>A beküldött rajzod biztonságban van</h2><p>A szavazási időszak kezdetétől a havi rajz már nem módosítható.</p></div></section> : null}

    {mode === 'gallery' ? <section className="weekly-gallery"><div className="weekly-section-heading"><div><p className="step-label">Havi közösség</p><h2>Havi galéria</h2></div></div>{sortedGallery.length ? <div className="weekly-gallery-grid">{sortedGallery.map(entry => <article className={`weekly-entry${entry.is_winner ? ' is-winner' : ''}`} key={entry.entry_id}>{entry.is_winner ? <span className="weekly-winner">Havi győztes</span> : null}<WeeklyArtwork label={`${entry.author_name} havi rajza`} pixels={entry.pixels} /><div className="weekly-entry-meta"><div className="weekly-entry-author"><ProfileAvatar label={`${entry.author_name} profilképe`} pixels={entry.authorAvatar} /><strong>{entry.author_name}</strong></div><span>{entry.vote_count} szavazat</span></div><button aria-pressed={entry.has_voted} disabled={busy || !user || !isVoting || entry.is_own || (!entry.has_voted && account.votesUsed >= 3)} onClick={() => void handleVote(entry)} type="button">{entry.is_own ? 'A te rajzod' : entry.has_voted ? 'Szavazat visszavonása' : 'Szavazok'}</button></article>)}</div> : <p className="weekly-empty">{isDrawing ? 'A havi rajzok a szavazási időszak kezdetén válnak láthatóvá.' : 'Ehhez a hónaphoz még nincs nevezés.'}</p>}</section> : null}
    <p className="status-message weekly-message" aria-live="polite">{status}</p>
  </section>
}
