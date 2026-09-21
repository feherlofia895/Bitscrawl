import { useCallback, useEffect, useRef, useState } from 'react'
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
import { ProfilePreviewButton } from './ProfilePreviewButton'
import { WeeklyArtwork } from './WeeklyArtwork'
import { ArtworkPreview } from './ArtworkPreview'
import { GalleryComments } from './GalleryComments'
import { GalleryPagination } from './GalleryPagination'
import {
  addGalleryComment,
  loadGalleryCommentsForEntry,
  updateGalleryComment,
  type GallerySort,
} from '../lib/galleryComments'
import { createDrawingSaveQueue } from '../lib/drawingSaveQueue'
import { clearChallengeDraft, loadChallengeDraft, saveChallengeDraft } from '../lib/challengeDrafts'

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

function createDiscoverySeed() {
  return Math.floor(Math.random() * 0x100000000) >>> 0
}

export function MonthlyDraw({
  mode,
  onBack,
  onSelectFeed,
  onSelectWeekly,
}: {
  mode: 'challenge' | 'gallery'
  onBack: () => void
  onSelectFeed: () => void
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
  const [galleryPage, setGalleryPage] = useState(1)
  const [galleryTotal, setGalleryTotal] = useState(0)
  const [sort, setSort] = useState<GallerySort>('likes')
  const [discoverySeed, setDiscoverySeed] = useState(createDiscoverySeed)
  const [loadedChallengeId, setLoadedChallengeId] = useState<number | null>(null)
  const pixelsRef = useRef(emptyDrawing())
  const mountedRef = useRef(true)
  const loadVersionRef = useRef(0)
  const userIdRef = useRef(user?.id ?? null)
  const localDraftStoredRef = useRef(false)
  const selectedIdRef = useRef(selectedId)
  const galleryPageRef = useRef(galleryPage)
  const gallerySortRef = useRef(sort)
  const discoverySeedRef = useRef(discoverySeed)
  userIdRef.current = user?.id ?? null
  selectedIdRef.current = selectedId
  galleryPageRef.current = galleryPage
  gallerySortRef.current = sort
  discoverySeedRef.current = discoverySeed
  const saveQueueRef = useRef<ReturnType<typeof createDrawingSaveQueue<number>> | null>(null)
  if (!saveQueueRef.current) {
    saveQueueRef.current = createDrawingSaveQueue({
      save: saveMonthlyEntry,
      onSaved: task => {
        const userId = userIdRef.current
        if (userId && clearChallengeDraft('monthly', userId, task.key, task.pixels)) {
          localDraftStoredRef.current = false
        }
        if (mountedRef.current && selectedIdRef.current === task.key) {
          setStatus('Mentve.')
        }
      },
      onError: (error, task) => {
        if (mountedRef.current && selectedIdRef.current === task.key) {
          const localNote = localDraftStoredRef.current
            ? ' A rajz ezen az eszközön megmaradt.'
            : ' A helyi mentés nem érhető el; hagyd nyitva ezt az oldalt.'
          setStatus(navigator.onLine
            ? `Mentés sikertelen: ${errorMessage(error)}${localNote} Újrapróbáljuk.`
            : `Nincs kapcsolat.${localNote} Kapcsolódás után újrapróbáljuk.`)
        }
      },
    })
  }

  const challenge = challenges.find(item => item.challenge_id === selectedId) ?? null
  const accountReady = loadedChallengeId === selectedId
  const isDrawing = !loading && accountReady && challenge?.challenge_status === 'drawing'
  const isVoting = challenge?.challenge_status === 'voting'

  const refresh = useCallback(async (
    challengeId: number,
    allowLocalDraft: boolean,
    knownUser?: User | null,
  ) => {
    const loadVersion = ++loadVersionRef.current
    const currentUser = knownUser === undefined ? await getWeeklyUser() : knownUser
    const [nextGalleryPage, nextAccount] = await Promise.all([
      loadMonthlyGallery(challengeId, galleryPageRef.current, gallerySortRef.current, discoverySeedRef.current),
      currentUser ? loadMonthlyAccountState(challengeId) : Promise.resolve(blankAccount),
    ])
    if (loadVersion !== loadVersionRef.current) return false
    const localDraft = currentUser && allowLocalDraft
      ? loadChallengeDraft('monthly', currentUser.id, challengeId)
      : null
    const mergedAccount = localDraft
      ? { ...nextAccount, entryPixels: localDraft.pixels }
      : nextAccount
    userIdRef.current = currentUser?.id ?? null
    setUser(currentUser)
    setGallery(nextGalleryPage.entries)
    setGalleryTotal(nextGalleryPage.totalCount)
    setAccount(mergedAccount)
    pixelsRef.current = [...(mergedAccount.entryPixels ?? emptyDrawing())]
    setDisplayName(mergedAccount.profileName ?? '')
    setLoadedChallengeId(challengeId)
    localDraftStoredRef.current = Boolean(localDraft)
    if (localDraft) saveQueueRef.current?.schedule(challengeId, localDraft.pixels)
    return localDraft ? 'local' : 'server'
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    void (async () => {
      try {
        const currentUser = await getWeeklyUser()
        if (cancelled) return
        setUser(currentUser)
        const nextChallenges = await loadMonthlyChallenges()
        if (cancelled) return
        setChallenges(nextChallenges)
        const initial = nextChallenges.find(item => ['drawing', 'voting'].includes(item.challenge_status)) ?? nextChallenges[0]
        if (!initial) return setStatus('Még nincs havi kihívás.')
        setSelectedId(initial.challenge_id)
        const loaded = await refresh(initial.challenge_id, initial.challenge_status === 'drawing', currentUser)
        if (!cancelled && loaded) setStatus(loaded === 'local'
          ? 'A helyi vázlat visszaállítva. Mentés folyamatban…'
          : 'A havi kihívás naprakész.')
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

  useEffect(() => {
    const retrySave = () => {
      if (!saveQueueRef.current?.hasUnsavedChanges()) return
      setStatus('Kapcsolat helyreállt. Mentés újrapróbálása…')
      void saveQueueRef.current.flush().catch(() => undefined)
    }
    window.addEventListener('online', retrySave)
    return () => window.removeEventListener('online', retrySave)
  }, [])

  const flushDrawing = useCallback(async () => {
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
    const saved = await flushDrawing()
    if (saved) action()
    else if (mountedRef.current) setBusy(false)
  }

  const chooseChallenge = async (challengeId: number) => {
    setLoading(true)
    if (!(await flushDrawing())) {
      setLoading(false)
      return
    }
    setSelectedId(challengeId)
    setLoadedChallengeId(null)
    galleryPageRef.current = 1
    setGalleryPage(1)
    try {
      const selectedChallenge = challenges.find(item => item.challenge_id === challengeId)
      const loaded = await refresh(challengeId, selectedChallenge?.challenge_status === 'drawing')
      if (loaded) setStatus('A kiválasztott hónap betöltve.')
    }
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
      setLoadedChallengeId(null)
      const rememberedName = profileNameFromUser(nextUser)
      if (rememberedName) {
        setAccount(current => ({ ...current, profileName: rememberedName }))
        setDisplayName(rememberedName)
      }
      if (selectedId && nextUser) await refresh(selectedId, challenge?.challenge_status === 'drawing', nextUser)
      setStatus('Sikeresen bejelentkeztél.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleProfile = async () => {
    setBusy(true)
    try {
      await setWeeklyProfile(displayName)
      if (selectedId) await refresh(selectedId, challenge?.challenge_status === 'drawing', user)
      setStatus('A megjelenített neved elmentve.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleSignOut = async () => {
    setBusy(true)
    try {
      if (!(await flushDrawing())) return
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
    setStatus('Mentés folyamatban…')
    const userId = userIdRef.current
    if (selectedId && userId) {
      localDraftStoredRef.current = saveChallengeDraft('monthly', userId, selectedId, pixels)
      saveQueueRef.current?.schedule(selectedId, pixels)
    }
  }, [selectedId])

  const handleVote = async (entry: MonthlyGalleryEntry) => {
    setBusy(true)
    try {
      await setMonthlyVote(entry.entry_id, !entry.has_voted)
      if (selectedId) await refresh(selectedId, isDrawing, user)
      setStatus(entry.has_voted ? 'A szavazatot visszavontad.' : 'Szavazat elmentve.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleSubmit = async () => {
    if (!selectedId) return
    setBusy(true)
    try {
      if (!(await flushDrawing())) return
      await submitMonthlyEntry(selectedId)
      await refresh(selectedId, true, user)
      setStatus('A havi rajzod bekerült a nevezések közé. A szavazás kezdetéig tovább szerkesztheted.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleComment = async (entryId: number, content: string) => {
    setBusy(true)
    try {
      await addGalleryComment('monthly', entryId, content)
      setStatus('A kommented megmaradt a kép alatt.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally { setBusy(false) }
  }

  const handleCommentUpdate = async (commentId: number, content: string) => {
    setBusy(true)
    try {
      await updateGalleryComment(commentId, content)
      setStatus('A kommented módosításai elmentve.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally { setBusy(false) }
  }

  const handleGalleryPage = async (nextPage: number) => {
    if (!selectedId || nextPage === galleryPage) return
    galleryPageRef.current = nextPage
    setGalleryPage(nextPage)
    setLoading(true)
    try {
      await refresh(selectedId, isDrawing, user)
      setStatus('A galéria következő oldala betöltve.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const handleGallerySort = async (nextSort: GallerySort) => {
    if (!selectedId) return
    const nextSeed = nextSort === 'discovery' ? createDiscoverySeed() : discoverySeedRef.current
    gallerySortRef.current = nextSort
    discoverySeedRef.current = nextSeed
    galleryPageRef.current = 1
    setSort(nextSort)
    setDiscoverySeed(nextSeed)
    setGalleryPage(1)
    setLoading(true)
    try {
      await refresh(selectedId, isDrawing, user)
      setStatus('A galéria rendezése frissült.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = challenge?.challenge_status === 'drawing' ? 'Rajzolási időszak'
    : challenge?.challenge_status === 'voting' ? 'Szavazás'
      : challenge?.challenge_status === 'closed' ? 'Lezárva' : 'Hamarosan'

  return <section className="weekly-page" aria-labelledby="monthly-title">
    <header className="weekly-header">
      <div><p className="step-label">Havi közösségi kihívás</p><h1 id="monthly-title">{mode === 'challenge' ? 'Kihívás' : 'Galéria'}</h1><p>Egy teljes hónap egy nagyobb pixelrajzra.</p></div>
      <button disabled={busy} onClick={() => void leavePage(onBack)} type="button">Vissza a főmenübe</button>
    </header>
    <nav className="challenge-period-switch" aria-label="Kihívás időtartama">
      <button disabled={busy} onClick={() => void leavePage(onSelectWeekly)} type="button">{mode === 'gallery' ? 'Heti galéria' : 'Heti kihívás'}</button>
      <button aria-pressed="true" type="button">{mode === 'gallery' ? 'Havi galéria' : 'Havi kihívás'}</button>
      {mode === 'gallery' ? <button disabled={busy} onClick={() => void leavePage(onSelectFeed)} type="button">Hírfolyam</button> : null}
    </nav>

    {challenge ? <section className="weekly-challenge-card">
      <div><span className={`weekly-status weekly-status-${challenge.challenge_status}`}>{statusLabel}</span><h2>{challenge.prompt}</h2><p>{challenge.description}</p><p className="weekly-date">Rajzolás: {dateLabel(challenge.starts_at)} – {dateLabel(challenge.voting_starts_at)}<br />Szavazás vége: {dateLabel(challenge.ends_at)}</p></div>
      {challenges.length > 1 ? <label className="field weekly-picker"><span>Hónapok</span><select disabled={loading} onChange={event => void chooseChallenge(Number(event.target.value))} value={challenge.challenge_id}>{challenges.map(item => <option key={item.challenge_id} value={item.challenge_id}>{item.month_key} · {item.prompt}</option>)}</select></label> : null}
    </section> : null}

    {!loading && accountReady && !user ? <section className="weekly-account-card"><div><p className="step-label">Fiók</p><h2>{authMode === 'login' ? 'Jelentkezz be a rajzoláshoz' : 'Készíts játékosfiókot'}</h2><p>A havi rajz mentéséhez és a szavazáshoz fiók szükséges.</p></div><div className="weekly-auth-form">
      {authMode === 'register' ? <label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label> : null}
      <label className="field"><span>E-mail</span><input onChange={event => setEmail(event.target.value)} type="email" value={email} /></label>
      <label className="field"><span>Jelszó</span><input minLength={6} onChange={event => setPassword(event.target.value)} type="password" value={password} /></label>
      <button className="primary-button" disabled={busy || !email || password.length < 6 || (authMode === 'register' && displayName.trim().length < 2)} onClick={() => void handleAuth()} type="button">{authMode === 'login' ? 'Belépés' : 'Regisztráció'}</button>
      <button disabled={busy} onClick={() => setAuthMode(current => current === 'login' ? 'register' : 'login')} type="button">{authMode === 'login' ? 'Még nincs fiókom' : 'Már van fiókom'}</button>
    </div></section> : user && !loading && accountReady && !account.profileName ? <section className="weekly-account-card"><div><h2>Válassz megjelenített nevet</h2></div><div className="weekly-auth-form"><label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label><button className="primary-button" disabled={busy || displayName.trim().length < 2} onClick={() => void handleProfile()} type="button">Név mentése</button></div></section> : user && accountReady && account.profileName ? <div className="weekly-user-bar"><span>Belépve: <strong>{account.profileName}</strong></span><span>Szavazatok: <strong>{account.votesUsed}/3</strong></span><button disabled={busy} onClick={() => void handleSignOut()} type="button">Kilépés</button></div> : null}

    {!loading && challenge && !accountReady ? <section className="weekly-account-card"><div><h2>A mentett rajz nem töltődött be</h2><p>A szerkesztőt addig nem nyitjuk meg, hogy a meglévő rajzod biztonságban maradjon.</p></div><button disabled={busy} onClick={() => void chooseChallenge(challenge.challenge_id)} type="button">Betöltés újra</button></section> : null}

    {mode === 'challenge' && isDrawing && user && account.profileName ? <section className="weekly-editor"><div className="weekly-section-heading"><div><p className="step-label">A te havi rajzod</p><h2>Rajzold le: {challenge?.prompt}</h2><p>Minden változtatás automatikusan mentődik.</p></div>{account.submittedAt ? <span className="weekly-status weekly-status-active">Beküldve · még szerkeszthető</span> : <button className="primary-button" disabled={busy || !pixelsRef.current.some(pixel => pixel !== 'transparent')} onClick={() => void handleSubmit()} type="button">Beküldés</button>}</div><PixelCanvas canDraw={!busy} chosenWord={challenge?.prompt ?? null} drawingEndsAt={challenge?.voting_starts_at ?? null} events={[]} localDrawing={{ initialPixels: account.entryPixels ?? emptyDrawing(), onChange: handleDrawingChange }} onError={error => setStatus(errorMessage(error))} onSubmit={handleSubmit} paletteSize={12} roundId={challenge?.challenge_id ?? 0} serverNow={challenge?.server_now ?? ''} /></section> : null}

    {mode === 'challenge' && !isDrawing && account.submittedAt && account.entryPixels ? <section className="weekly-submitted"><WeeklyArtwork label="A havi rajzod" pixels={account.entryPixels} /><div><p className="step-label">{statusLabel}</p><h2>A beküldött rajzod biztonságban van</h2><p>A szavazási időszak kezdetétől a havi rajz már nem módosítható.</p></div></section> : null}

    {mode === 'gallery' ? <section className="weekly-gallery"><div className="weekly-section-heading"><div><p className="step-label">Havi közösség</p><h2>Havi galéria</h2></div><label className="field weekly-sort"><span>Sorrend</span><select disabled={loading} onChange={event => void handleGallerySort(event.target.value as GallerySort)} value={sort}><option value="likes">Legkedveltebb</option><option value="discovery">Felfedezés</option><option value="newest">Legújabb</option></select></label></div>{gallery.length ? <><div className="weekly-gallery-grid">{gallery.map(entry => <article className={`weekly-entry${entry.is_winner ? ' is-winner' : ''}`} key={entry.entry_id}>{entry.is_winner ? <span className="weekly-winner">Havi győztes</span> : null}<ArtworkPreview label={`${entry.author_name} havi rajza`} pixels={entry.pixels} /><div className="weekly-entry-meta"><ProfilePreviewButton className="weekly-entry-author" name={entry.author_name} pixels={entry.authorAvatar}><ProfileAvatar label={`${entry.author_name} profilképe`} pixels={entry.authorAvatar} /><strong>{entry.author_name}</strong></ProfilePreviewButton><span>{entry.vote_count} szavazat</span></div><button aria-pressed={entry.has_voted} disabled={busy || loading || !accountReady || !user || !isVoting || entry.is_own || (!entry.has_voted && account.votesUsed >= 3)} onClick={() => void handleVote(entry)} type="button">{entry.is_own ? 'A te rajzod' : entry.has_voted ? 'Szavazat visszavonása' : 'Szavazok'}</button><GalleryComments artworkAuthor={entry.author_name} busy={busy} commentCount={entry.comment_count} isSignedIn={Boolean(user && account.profileName)} loadComments={page => loadGalleryCommentsForEntry('monthly', entry.entry_id, page, selectedId ?? undefined)} onSubmit={content => handleComment(entry.entry_id, content)} onUpdate={handleCommentUpdate} /></article>)}</div><GalleryPagination currentPage={galleryPage} onPageChange={page => void handleGalleryPage(page)} totalItems={galleryTotal} /></> : <p className="weekly-empty">{isDrawing ? 'A havi rajzok a szavazási időszak kezdetén válnak láthatóvá.' : 'Ehhez a hónaphoz még nincs nevezés.'}</p>}</section> : null}
    <p className="status-message weekly-message" aria-live="polite">{status}</p>
  </section>
}
