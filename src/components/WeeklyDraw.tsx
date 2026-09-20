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
import { ProfileAvatar } from './ProfileAvatar'
import { ProfilePreviewButton } from './ProfilePreviewButton'
import { WeeklyArtwork } from './WeeklyArtwork'
import { MonthlyDraw } from './MonthlyDraw'
import { GalleryComments } from './GalleryComments'
import { GALLERY_PAGE_SIZE, GalleryPagination } from './GalleryPagination'
import { addGalleryComment, updateGalleryComment } from '../lib/galleryComments'
import { createDrawingSaveQueue } from '../lib/drawingSaveQueue'

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

function WeeklyDrawContent({ mode, onBack, onSelectMonthly }: { mode: 'challenge' | 'gallery'; onBack: () => void; onSelectMonthly: () => void }) {
  const [challenges, setChallenges] = useState<WeeklyChallenge[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [gallery, setGallery] = useState<WeeklyGalleryEntry[]>([])
  const [account, setAccount] = useState<WeeklyAccountState>(blankAccount)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('A heti kihívás betöltése…')
  const [sort, setSort] = useState<GallerySort>('discovery')
  const [galleryPage, setGalleryPage] = useState(1)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showSubmit, setShowSubmit] = useState(false)
  const [loadedChallengeId, setLoadedChallengeId] = useState<number | null>(null)
  const pixelsRef = useRef(emptyDrawing())
  const mountedRef = useRef(true)
  const loadVersionRef = useRef(0)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const saveQueueRef = useRef<ReturnType<typeof createDrawingSaveQueue<number>> | null>(null)
  if (!saveQueueRef.current) {
    saveQueueRef.current = createDrawingSaveQueue({
      save: saveWeeklyDraft,
      onSaved: task => {
        if (mountedRef.current && selectedIdRef.current === task.key) setStatus('Vázlat elmentve.')
      },
      onError: (error, task) => {
        if (mountedRef.current && selectedIdRef.current === task.key) setStatus(errorMessage(error))
      },
    })
  }

  const challenge = challenges.find(item => item.challenge_id === selectedId) ?? null
  const isActive = challenge?.challenge_status === 'active'

  const refresh = useCallback(async (challengeId: number, knownUser?: User | null) => {
    const loadVersion = ++loadVersionRef.current
    const currentUser = knownUser === undefined ? await getWeeklyUser() : knownUser
    const [nextGallery, nextAccount] = await Promise.all([
      loadWeeklyGallery(challengeId),
      currentUser ? loadWeeklyAccountState(challengeId) : Promise.resolve(blankAccount),
    ])
    if (loadVersion !== loadVersionRef.current) return false
    setUser(currentUser)
    setGallery(nextGallery)
    setAccount(nextAccount)
    const drawing = nextAccount.entryPixels ?? nextAccount.draftPixels ?? emptyDrawing()
    pixelsRef.current = [...drawing]
    setDisplayName(nextAccount.profileName ?? '')
    setLoadedChallengeId(challengeId)
    return true
  }, [])

  useEffect(() => {
    mountedRef.current = true
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
        const loaded = await refresh(initial.challenge_id)
        if (!cancelled && loaded) setStatus('A heti rajzok naprakészek.')
      } catch (error) {
        if (!cancelled) setStatus(errorMessage(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      mountedRef.current = false
      loadVersionRef.current += 1
      void saveQueueRef.current?.flush().catch(() => undefined)
    }
  }, [refresh])

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saveQueueRef.current?.hasUnsavedChanges()) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [])

  const flushDraft = useCallback(async () => {
    try {
      await saveQueueRef.current?.flush()
      return true
    } catch (error) {
      if (mountedRef.current) setStatus(errorMessage(error))
      return false
    }
  }, [])

  const leavePage = async (action: () => void) => {
    setBusy(true)
    const saved = await flushDraft()
    if (saved) action()
    else if (mountedRef.current) setBusy(false)
  }

  const chooseChallenge = async (challengeId: number) => {
    setLoading(true)
    if (!(await flushDraft())) {
      setLoading(false)
      return
    }
    setSelectedId(challengeId)
    setLoadedChallengeId(null)
    setGalleryPage(1)
    try {
      const loaded = await refresh(challengeId)
      if (loaded) setStatus('A kiválasztott hét betöltve.')
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
      if (selectedId && nextUser) {
        setLoadedChallengeId(null)
        await refresh(selectedId, nextUser)
      }
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

  const handleSignOut = async () => {
    setBusy(true)
    try {
      if (!(await flushDraft())) return
      await signOutWeeklyAccount()
      setUser(null)
      setAccount(blankAccount)
      setLoadedChallengeId(selectedId)
      setStatus('Kijelentkeztél.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDrawingChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    setStatus('Vázlat mentése…')
    if (selectedId) saveQueueRef.current?.schedule(selectedId, pixels)
  }, [selectedId])

  const handleSubmit = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      if (!(await flushDraft())) return
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

  const handleComment = async (entryId: number, content: string) => {
    setBusy(true)
    try {
      await addGalleryComment('weekly', entryId, content)
      if (selectedId) await refresh(selectedId, user)
      setStatus('A kommented megmaradt a kép alatt.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  const handleCommentUpdate = async (commentId: number, content: string) => {
    setBusy(true)
    try {
      await updateGalleryComment(commentId, content)
      if (selectedId) await refresh(selectedId, user)
      setStatus('A kommented módosításai elmentve.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally {
      setBusy(false)
    }
  }

  const sortedGallery = useMemo(() => [...gallery].sort((first, second) => {
    if (sort === 'likes') return second.vote_count - first.vote_count || second.entry_id - first.entry_id
    if (sort === 'newest') return Date.parse(second.submitted_at) - Date.parse(first.submitted_at)
    return discoveryScore(first) - discoveryScore(second)
  }), [gallery, sort])
  const galleryPageCount = Math.max(1, Math.ceil(sortedGallery.length / GALLERY_PAGE_SIZE))
  const visibleGallery = useMemo(() => {
    const pageStart = (galleryPage - 1) * GALLERY_PAGE_SIZE
    return sortedGallery.slice(pageStart, pageStart + GALLERY_PAGE_SIZE)
  }, [galleryPage, sortedGallery])

  useEffect(() => {
    setGalleryPage(current => Math.min(current, galleryPageCount))
  }, [galleryPageCount])

  const accountReady = loadedChallengeId === selectedId
  const canEdit = Boolean(!loading && accountReady && isActive && user && account.profileName && !account.entryId)

  return (
    <section className="weekly-page" aria-labelledby="weekly-title">
      <header className="weekly-header">
        <div>
          <p className="step-label">{mode === 'challenge' ? 'Közösségi kihívás' : 'Közösségi rajzok'}</p>
          <h1 id="weekly-title">{mode === 'challenge' ? 'Kihívás' : 'Galéria'}</h1>
          <p>{mode === 'challenge' ? 'Minden héten egy téma és egy 32×32-es rajz.' : 'Fedezd fel a heti nevezéseket, és oszd ki a három szavazatodat.'}</p>
        </div>
        <button disabled={busy} onClick={() => void leavePage(onBack)} type="button">Vissza a főmenübe</button>
      </header>
      <nav className="challenge-period-switch" aria-label="Kihívás időtartama">
        <button aria-pressed="true" type="button">{mode === 'gallery' ? 'Heti galéria' : 'Heti kihívás'}</button>
        <button disabled={busy} onClick={() => void leavePage(onSelectMonthly)} type="button">{mode === 'gallery' ? 'Havi galéria' : 'Havi kihívás'}</button>
      </nav>

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

      {!loading && accountReady && !user ? (
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
      ) : !loading && accountReady && !account.profileName ? (
        <section className="weekly-account-card">
          <div><p className="step-label">Utolsó lépés</p><h2>Hogyan lássanak a galériában?</h2></div>
          <div className="weekly-auth-form">
            <label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label>
            <button className="primary-button" disabled={busy || displayName.trim().length < 2} onClick={() => void handleProfile()} type="button">Név mentése</button>
          </div>
        </section>
      ) : !loading && accountReady ? (
        <div className="weekly-user-bar">
          <span>Belépve: <strong>{account.profileName}</strong></span>
          <span>Szavazatok: <strong>{account.votesUsed}/3</strong></span>
          <button disabled={busy} onClick={() => void handleSignOut()} type="button">Kilépés</button>
        </div>
      ) : null}

      {!loading && challenge && !accountReady ? <section className="weekly-account-card"><div><h2>A mentett rajz nem töltődött be</h2><p>A szerkesztőt addig nem nyitjuk meg, hogy a meglévő rajzod biztonságban maradjon.</p></div><button disabled={busy} onClick={() => void chooseChallenge(challenge.challenge_id)} type="button">Betöltés újra</button></section> : null}

      {mode === 'challenge' && canEdit ? (
        <section className="weekly-editor">
          <div className="weekly-section-heading">
            <div><p className="step-label">A te rajzod</p><h2>Rajzold le: {challenge?.prompt}</h2></div>
            <button className="primary-button" disabled={busy || !pixelsRef.current.some(color => color !== 'transparent')} onClick={() => setShowSubmit(true)} type="button">Nevezés beküldése</button>
          </div>
          <PixelCanvas
            canDraw={!busy}
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
      ) : mode === 'challenge' && account.entryPixels ? (
        <section className="weekly-submitted">
          <WeeklyArtwork label="A beküldött heti rajzod" pixels={account.entryPixels} />
          <div><p className="step-label">Nevezés elküldve</p><h2>A rajzod már a galériában van</h2><p>A beküldött kép ezen a héten már nem módosítható.</p></div>
        </section>
      ) : null}

      {mode === 'gallery' ? <section className="weekly-gallery" aria-labelledby="weekly-gallery-title">
        <div className="weekly-section-heading">
          <div><p className="step-label">Közösség</p><h2 id="weekly-gallery-title">Galéria</h2></div>
          <label className="field weekly-sort"><span>Sorrend</span><select onChange={event => { setSort(event.target.value as GallerySort); setGalleryPage(1) }} value={sort}><option value="discovery">Felfedezés</option><option value="likes">Legkedveltebb</option><option value="newest">Legújabb</option></select></label>
        </div>
        {sortedGallery.length ? <>
          <div className="weekly-gallery-grid">{visibleGallery.map(entry => (
            <article className={`weekly-entry${entry.is_winner ? ' is-winner' : ''}`} key={entry.entry_id}>
              {entry.is_winner ? <span className="weekly-winner">Heti győztes</span> : null}
              <WeeklyArtwork label={`${entry.author_name} heti rajza`} pixels={entry.pixels} />
              <div className="weekly-entry-meta">
                <ProfilePreviewButton className="weekly-entry-author" name={entry.author_name} pixels={entry.authorAvatar}>
                  <ProfileAvatar label={`${entry.author_name} profilképe`} pixels={entry.authorAvatar} />
                  <strong>{entry.author_name}</strong>
                </ProfilePreviewButton>
                <span>{entry.vote_count} szavazat</span>
              </div>
              <button aria-pressed={entry.has_voted} disabled={busy || loading || !accountReady || !user || !isActive || entry.is_own || (!entry.has_voted && account.votesUsed >= 3)} onClick={() => void handleVote(entry)} type="button">
                {entry.is_own ? 'A te rajzod' : entry.has_voted ? 'Szavazat visszavonása' : 'Szavazok'}
              </button>
              <GalleryComments artworkAuthor={entry.author_name} busy={busy} comments={entry.comments} isSignedIn={Boolean(user && account.profileName)} onSubmit={content => handleComment(entry.entry_id, content)} onUpdate={handleCommentUpdate} />
            </article>
          ))}</div>
          <GalleryPagination currentPage={galleryPage} onPageChange={setGalleryPage} totalItems={sortedGallery.length} />
        </> : <p className="weekly-empty">Ezen a héten még nincs nevezés. Lehetsz te az első!</p>}
      </section> : null}

      <p className="status-message weekly-message" aria-live="polite">{status}</p>
      {showSubmit ? <ConfirmModal confirmLabel="Beküldöm" isBusy={busy} message="A beküldött rajz ezen a héten már nem módosítható. Biztosan kész van?" onCancel={() => setShowSubmit(false)} onConfirm={() => { setShowSubmit(false); void handleSubmit() }} title="Mehet a galériába?" /> : null}
    </section>
  )
}

export function WeeklyDraw({ mode, onBack }: { mode: 'challenge' | 'gallery'; onBack: () => void }) {
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly')
  return period === 'monthly'
    ? <MonthlyDraw mode={mode} onBack={onBack} onSelectWeekly={() => setPeriod('weekly')} />
    : <WeeklyDrawContent mode={mode} onBack={onBack} onSelectMonthly={() => setPeriod('monthly')} />
}
