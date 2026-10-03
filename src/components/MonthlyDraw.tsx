import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { emptyDrawing } from '../lib/drawing'
import {
  loadMonthlyAccountState,
  loadMonthlyChallenges,
  loadMonthlyGallery,
  monthlyEntryCanBeEdited,
  monthlyNewEntriesOpen,
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
  suggestedProfileName,
  type WeeklyChallenge,
} from '../lib/weekly'
import { PixelCanvas } from './PixelCanvas'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfilePreviewButton } from './ProfilePreviewButton'
import { WeeklyArtwork } from './WeeklyArtwork'
import { ArtworkPreview } from './ArtworkPreview'
import { GalleryComments } from './GalleryComments'
import { ChallengePeriodNavigation, GalleryNavigation } from './GalleryNavigation'
import { GalleryPagination } from './GalleryPagination'
import { CurrentChallengesSummary } from './CurrentChallengesSummary'
import {
  addGalleryComment,
  loadGalleryCommentsForEntry,
  updateGalleryComment,
  type GallerySort,
} from '../lib/galleryComments'
import { createDrawingSaveQueue } from '../lib/drawingSaveQueue'
import { clearChallengeDraft, loadChallengeDraft, saveChallengeDraft } from '../lib/challengeDrafts'
import { moderateDeleteContent } from '../lib/moderation'
import { useModeratorAccess } from '../hooks/useModeratorAccess'
import { ConfirmModal } from './ConfirmModal'
import { AdminArtworkReactions } from './AdminArtworkReactions'
import { useChallengeEditorPalettes } from '../hooks/useChallengeEditorPalettes'
import { ChallengePalettePicker } from './ChallengePalettePicker'

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

function createDiscoverySeed() {
  return Math.floor(Math.random() * 0x100000000) >>> 0
}

export function MonthlyDraw({
  currentMonthlyChallenge,
  currentWeeklyChallenge,
  mode,
  onBack,
  onOpenMonthlyChallenge,
  onOpenWeeklyChallenge,
  onSelectFeed,
  onSelectWeekly,
}: {
  currentMonthlyChallenge: MonthlyChallenge | null
  currentWeeklyChallenge: WeeklyChallenge | null
  mode: 'challenge' | 'gallery'
  onBack: () => void
  onOpenMonthlyChallenge: () => void
  onOpenWeeklyChallenge: () => void
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
  const [moderationTarget, setModerationTarget] = useState<MonthlyGalleryEntry | null>(null)
  const pixelsRef = useRef(emptyDrawing())
  const mountedRef = useRef(true)
  const loadVersionRef = useRef(0)
  const userIdRef = useRef(user?.id ?? null)
  const localDraftStoredRef = useRef(false)
  const selectedIdRef = useRef(selectedId)
  const galleryPageRef = useRef(galleryPage)
  const gallerySortRef = useRef(sort)
  const discoverySeedRef = useRef(discoverySeed)
  const isModerator = useModeratorAccess(user?.id)
  const palette = useChallengeEditorPalettes(
    user?.id && account.profileName ? `${user.id}:${account.profileName}` : 'local',
    12,
  )
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
        const drawingSize = task.pixels.length === 16384 ? 128 : 32
        if (userId && clearChallengeDraft('monthly', userId, task.key, task.pixels, undefined, drawingSize)) {
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
  const entriesOpen = monthlyNewEntriesOpen(challenge)
  const canEdit = !loading && accountReady && monthlyEntryCanBeEdited(challenge, account.submittedAt)
  const isDrawing = challenge?.challenge_status === 'drawing'
  const isVoting = challenge?.challenge_status === 'voting'

  const refresh = useCallback(async (
    selectedChallenge: MonthlyChallenge,
    knownUser?: User | null,
  ) => {
    const challengeId = selectedChallenge.challenge_id
    const loadVersion = ++loadVersionRef.current
    const currentUser = knownUser === undefined ? await getWeeklyUser() : knownUser
    const [nextGalleryPage, nextAccount] = await Promise.all([
      loadMonthlyGallery(challengeId, galleryPageRef.current, gallerySortRef.current, discoverySeedRef.current),
      currentUser ? loadMonthlyAccountState(challengeId) : Promise.resolve(blankAccount),
    ])
    if (loadVersion !== loadVersionRef.current) return false
    const localDraft = currentUser && monthlyEntryCanBeEdited(selectedChallenge, nextAccount.submittedAt)
      ? loadChallengeDraft('monthly', currentUser.id, challengeId, undefined, selectedChallenge.canvas_size)
      : null
    const mergedAccount = localDraft
      ? { ...nextAccount, entryPixels: localDraft.pixels }
      : nextAccount
    userIdRef.current = currentUser?.id ?? null
    setUser(currentUser)
    setGallery(nextGalleryPage.entries)
    setGalleryTotal(nextGalleryPage.totalCount)
    setAccount(mergedAccount)
    pixelsRef.current = [...(mergedAccount.entryPixels ?? emptyDrawing(selectedChallenge.canvas_size))]
    setDisplayName(mergedAccount.profileName ?? suggestedProfileName(currentUser))
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
        const loaded = await refresh(initial, currentUser)
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
      if (!selectedChallenge) throw new Error('A havi kihívás már nem található.')
      const loaded = await refresh(selectedChallenge)
      if (loaded) setStatus('A kiválasztott hónap betöltve.')
    }
    catch (error) { setStatus(errorMessage(error)) }
    finally { setLoading(false) }
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
      setUser(nextUser)
      setLoadedChallengeId(null)
      if (challenge && nextUser) await refresh(challenge, nextUser)
      setStatus('Sikeresen bejelentkeztél.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleProfile = async () => {
    setBusy(true)
    try {
      await setWeeklyProfile(displayName)
      if (challenge) await refresh(challenge, user)
      setStatus('A megjelenített neved elmentve.')
    } catch (error) { setStatus(errorMessage(error)) }
    finally { setBusy(false) }
  }

  const handleDrawingChange = useCallback((pixels: string[]) => {
    pixelsRef.current = pixels
    setStatus('Mentés folyamatban…')
    const userId = userIdRef.current
    if (selectedId && userId) {
      const drawingSize = pixels.length === 16384 ? 128 : 32
      localDraftStoredRef.current = saveChallengeDraft(
        'monthly', userId, selectedId, pixels, undefined, drawingSize,
      )
      saveQueueRef.current?.schedule(selectedId, pixels)
    }
  }, [selectedId])

  const handleVote = async (entry: MonthlyGalleryEntry) => {
    setBusy(true)
    try {
      await setMonthlyVote(entry.entry_id, !entry.has_voted)
      if (challenge) await refresh(challenge, user)
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
      if (challenge) await refresh(challenge, user)
      setStatus('A havi rajzod bekerült a nevezések közé.')
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

  const handleCommentDelete = async (commentId: number) => {
    setBusy(true)
    try {
      await moderateDeleteContent('gallery-comment', commentId)
      if (challenge) await refresh(challenge, user)
      setStatus('A komment moderátorként törölve.')
    } catch (error) {
      setStatus(errorMessage(error))
      throw error
    } finally { setBusy(false) }
  }

  const handleModerationDelete = async (entry: MonthlyGalleryEntry) => {
    setBusy(true)
    try {
      await moderateDeleteContent('monthly-entry', entry.entry_id)
      galleryPageRef.current = 1
      setGalleryPage(1)
      if (challenge) await refresh(challenge, user)
      setStatus('A havi nevezés moderátorként eltávolítva a galériából.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally { setBusy(false) }
  }

  const handleGalleryPage = async (nextPage: number) => {
    if (!selectedId || nextPage === galleryPage) return
    galleryPageRef.current = nextPage
    setGalleryPage(nextPage)
    setLoading(true)
    try {
      if (challenge) await refresh(challenge, user)
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
      if (challenge) await refresh(challenge, user)
      setStatus('A galéria rendezése frissült.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = challenge?.challenge_status === 'voting' && entriesOpen ? 'Szavazás · új nevezés még nyitva'
    : challenge?.challenge_status === 'drawing' ? 'Rajzolási időszak'
    : challenge?.challenge_status === 'voting' ? 'Szavazás'
      : challenge?.challenge_status === 'closed' ? 'Lezárva' : 'Hamarosan'

  return <section className="weekly-page" aria-labelledby="monthly-title">
    <header className="weekly-header">
      <div><p className="step-label">Havi közösségi kihívás</p><h1 id="monthly-title">{mode === 'challenge' ? 'Kihívás' : 'Galéria'}</h1><p>Egy teljes hónap egy nagyobb pixelrajzra.</p></div>
      <button disabled={busy} onClick={() => void leavePage(onBack)} type="button">Vissza a főmenübe</button>
    </header>
    {mode === 'challenge' ? <nav className="challenge-period-switch" aria-label="Kihívás időtartama">
      <button disabled={busy} onClick={() => void leavePage(onSelectWeekly)} type="button">Heti kihívás</button>
      <button aria-pressed="true" type="button">Havi kihívás</button>
    </nav> : null}

    {mode === 'challenge' && challenge ? <section className="weekly-challenge-card">
      <div><span className={`weekly-status weekly-status-${challenge.challenge_status}`}>{statusLabel}</span><h2>{challenge.prompt}</h2><p>{challenge.description}</p><p className="weekly-date">Új nevezés: {dateLabel(challenge.starts_at)} – {dateLabel(challenge.ends_at)}<br />Beküldött kép szerkesztése: {dateLabel(challenge.starts_at)} – {dateLabel(challenge.submission_ends_at)}<br />Szavazás: {dateLabel(challenge.voting_starts_at)} – {dateLabel(challenge.ends_at)}</p></div>
      {challenges.length > 1 ? <label className="field weekly-picker"><span>Hónapok</span><select disabled={loading} onChange={event => void chooseChallenge(Number(event.target.value))} value={challenge.challenge_id}>{challenges.map(item => <option key={item.challenge_id} value={item.challenge_id}>{item.month_key} · {item.prompt}</option>)}</select></label> : null}
    </section> : null}

    {mode === 'gallery' ? <CurrentChallengesSummary monthlyChallenge={currentMonthlyChallenge ?? challenge} onOpenMonthly={onOpenMonthlyChallenge} onOpenWeekly={onOpenWeeklyChallenge} weeklyChallenge={currentWeeklyChallenge} /> : null}

    {!loading && accountReady && !user ? <section className="weekly-account-card"><div><p className="step-label">Fiók</p><h2>{authMode === 'login' ? 'Jelentkezz be a rajzoláshoz' : 'Készíts játékosfiókot'}</h2><p>A havi rajz mentéséhez és a szavazáshoz fiók szükséges.</p></div><div className="weekly-auth-form">
      {authMode === 'register' ? <label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label> : null}
      <label className="field"><span>E-mail</span><input autoComplete="email" onChange={event => setEmail(event.target.value)} type="email" value={email} /></label>
      <label className="field"><span>Jelszó</span><input autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={6} onChange={event => setPassword(event.target.value)} type="password" value={password} /></label>
      <button className="primary-button" disabled={busy || !email || password.length < 6 || (authMode === 'register' && displayName.trim().length < 2)} onClick={() => void handleAuth()} type="button">{authMode === 'login' ? 'Belépés' : 'Regisztráció'}</button>
      <button disabled={busy} onClick={() => setAuthMode(current => current === 'login' ? 'register' : 'login')} type="button">{authMode === 'login' ? 'Még nincs fiókom' : 'Már van fiókom'}</button>
    </div></section> : user && !loading && accountReady && !account.profileName ? <section className="weekly-account-card"><div><h2>Válassz megjelenített nevet</h2></div><div className="weekly-auth-form"><label className="field"><span>Megjelenített név</span><input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} /></label><button className="primary-button" disabled={busy || displayName.trim().length < 2} onClick={() => void handleProfile()} type="button">Név mentése</button></div></section> : null}

    {!loading && challenge && !accountReady ? <section className="weekly-account-card"><div><h2>A mentett rajz nem töltődött be</h2><p>A szerkesztőt addig nem nyitjuk meg, hogy a meglévő rajzod biztonságban maradjon.</p></div><button disabled={busy} onClick={() => void chooseChallenge(challenge.challenge_id)} type="button">Betöltés újra</button></section> : null}

    {mode === 'challenge' && canEdit && user && account.profileName ? (
      <section className="weekly-editor">
        <div className="weekly-section-heading">
          <div>
            <p className="step-label">A te havi rajzod · {challenge?.canvas_size}×{challenge?.canvas_size}</p>
            <h2>Rajzold le: {challenge?.prompt}</h2>
            <p>Minden változtatás automatikusan mentődik.</p>
          </div>
          {account.submittedAt
            ? <span className="weekly-status weekly-status-active">Beküldve · még szerkeszthető</span>
            : <button className="primary-button" disabled={busy || !pixelsRef.current.some(pixel => pixel !== 'transparent')} onClick={() => void handleSubmit()} type="button">Beküldés</button>}
        </div>
        <ChallengePalettePicker
          activePaletteSlot={palette.activePaletteSlot}
          customPaletteActive={palette.customPaletteActive}
          customPalettes={palette.customPalettes}
          onPaletteChange={palette.selectPalette}
          onSlotChange={palette.selectCustomPaletteSlot}
          paletteSize={palette.paletteSize}
          status={palette.paletteSyncStatus}
        />
        <PixelCanvas
          allowColorMixer
          allowEditorTools
          canvasSize={challenge?.canvas_size ?? 32}
          canDraw={!busy}
          chosenWord={challenge?.prompt ?? null}
          customPaletteActive={palette.customPaletteActive}
          customPaletteColors={palette.activeCustomPalette.colors}
          customPaletteOptions={palette.customPaletteOptions}
          customPaletteSlot={palette.activePaletteSlot}
          drawingEndsAt={account.submittedAt ? challenge?.submission_ends_at ?? null : challenge?.ends_at ?? null}
          events={[]}
          localDrawing={{ initialPixels: account.entryPixels ?? emptyDrawing(challenge?.canvas_size ?? 32), onChange: handleDrawingChange }}
          onCustomPaletteActiveChange={palette.setCustomPaletteActive}
          onCustomPaletteColorSave={palette.saveCustomColor}
          onCustomPaletteColorsChange={palette.updateCustomPaletteColors}
          onCustomPaletteSlotChange={palette.selectCustomPaletteSlot}
          onError={error => setStatus(errorMessage(error))}
          onPaletteSizeChange={size => palette.selectPalette(String(size))}
          onSubmit={handleSubmit}
          paletteSize={palette.paletteSize}
          roundId={challenge?.challenge_id ?? 0}
          serverNow={challenge?.server_now ?? ''}
        />
      </section>
    ) : null}

    {mode === 'challenge' && !canEdit && account.submittedAt && account.entryPixels ? <section className="weekly-submitted"><WeeklyArtwork label="A havi rajzod" pixels={account.entryPixels} /><div><p className="step-label">{statusLabel}</p><h2>A beküldött rajzod biztonságban van</h2><p>A szerkesztési határidő után a beadott kép már nem módosítható. Az új nevezők a kihívás végéig még beküldhetnek.</p></div></section> : null}

    {mode === 'gallery' ? <section className="weekly-gallery">
      <div className="weekly-section-heading">
        <div><p className="step-label">Havi közösség</p><h2>Havi galéria</h2></div>
        <div className="gallery-heading-controls">
          <GalleryNavigation busy={busy} onSelectChallenges={() => undefined} onSelectWall={() => void leavePage(onSelectFeed)} view="challenges" />
        </div>
      </div>
      <div className="gallery-subcontrols">
        {user && accountReady && account.profileName ? <p className="gallery-vote-count">Szavazatok: <strong>{account.votesUsed}/3</strong></p> : null}
        <ChallengePeriodNavigation busy={busy} onSelectMonthly={() => undefined} onSelectWeekly={() => void leavePage(onSelectWeekly)} period="monthly" />
        {challenge && challenges.length > 1 ? <label className="field weekly-picker gallery-period-picker"><span>Hónap</span><select disabled={loading} onChange={event => void chooseChallenge(Number(event.target.value))} value={challenge.challenge_id}>{challenges.map(item => <option key={item.challenge_id} value={item.challenge_id}>{item.month_key} · {item.prompt}</option>)}</select></label> : null}
        <label className="field weekly-sort"><span>Sorrend</span><select disabled={loading} onChange={event => void handleGallerySort(event.target.value as GallerySort)} value={sort}><option value="likes">Legkedveltebb</option><option value="discovery">Felfedezés</option><option value="newest">Legújabb</option></select></label>
      </div>
      {gallery.length ? <><div className="weekly-gallery-grid">{gallery.map(entry => <article className={`weekly-entry${entry.is_winner ? ' is-winner' : ''}`} key={entry.entry_id}>{entry.is_winner ? <span className="weekly-winner">Havi győztes</span> : null}<ArtworkPreview label={`${entry.author_name} havi rajza`} pixels={entry.pixels} /><div className="weekly-entry-meta"><ProfilePreviewButton className="weekly-entry-author" name={entry.author_name} pixels={entry.authorAvatar}><ProfileAvatar label={`${entry.author_name} profilképe`} pixels={entry.authorAvatar} /><strong>{entry.author_name}</strong></ProfilePreviewButton><div className="entry-reaction-summary"><span>{entry.vote_count} szavazat</span>{isModerator ? <AdminArtworkReactions count={entry.vote_count} key={`${entry.entry_id}:${entry.vote_count}`} kind="monthly-entry" targetId={entry.entry_id} /> : null}</div></div>{isModerator ? <button className="moderation-entry-button" disabled={busy} onClick={() => setModerationTarget(entry)} type="button">Admin: kép eltávolítása</button> : null}<button aria-pressed={entry.has_voted} disabled={busy || loading || !accountReady || !user || !isVoting || entry.is_own || (!entry.has_voted && account.votesUsed >= 3)} onClick={() => void handleVote(entry)} type="button">{entry.is_own ? 'A te rajzod' : entry.has_voted ? 'Szavazat visszavonása' : 'Szavazok'}</button>{isDrawing ? null : <GalleryComments artworkAuthor={entry.author_name} busy={busy} canModerate={isModerator} commentCount={entry.comment_count} isSignedIn={Boolean(user && account.profileName)} loadComments={page => loadGalleryCommentsForEntry('monthly', entry.entry_id, page, selectedId ?? undefined)} onDelete={handleCommentDelete} onSubmit={content => handleComment(entry.entry_id, content)} onUpdate={handleCommentUpdate} />}</article>)}</div><GalleryPagination currentPage={galleryPage} onPageChange={handleGalleryPage} totalItems={galleryTotal} /></> : <p className="weekly-empty">Ehhez a hónaphoz még nincs beküldött rajz.</p>}
    </section> : null}
    <p className="status-message weekly-message" aria-live="polite">{status}</p>
    {moderationTarget ? <ConfirmModal
      confirmLabel="Kép eltávolítása"
      isBusy={busy}
      message={`${moderationTarget.author_name} nevezése eltűnik a havi galériából, és többé nem lehet rá szavazni.`}
      onCancel={() => setModerationTarget(null)}
      onConfirm={() => { const target = moderationTarget; setModerationTarget(null); void handleModerationDelete(target) }}
      title="Moderátorként eltávolítod ezt a képet?"
    /> : null}
  </section>
}
