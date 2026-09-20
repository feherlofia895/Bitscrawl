import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { PixelCanvas } from './components/PixelCanvas'
import { DrawingEditor } from './components/DrawingEditor'
import { RoundDurationControl } from './components/RoundDurationControl'
import { editorText } from './lib/editorText'
import { DEFAULT_ROUND_DURATION, isRoundDuration, roundDurations, roundDurationText, type RoundDuration } from './lib/roundDuration'
import { BugReport } from './components/BugReport'
import { ConfirmModal } from './components/ConfirmModal'
import { WeeklyDraw } from './components/WeeklyDraw'
import { ProfileAvatar } from './components/ProfileAvatar'
import { ProfilePanel } from './components/ProfilePanel'
import { RoomChat } from './components/RoomChat'
import { RoundChat } from './components/RoundChat'
import { RoundTimer } from './components/RoundTimer'
import { RoundTransitionTimer } from './components/RoundTransitionTimer'
import {
  advanceGame,
  chooseRoundWord,
  finishExpiredRound,
  loadDrawEvents,
  loadRoundMessages,
  loadRoundView,
  submitGuess,
  submitPixelChanges,
  type DrawEvent,
  type RoundMessage,
  type RoundView,
} from './lib/game'
import {
  createRoom,
  joinRoom,
  leaveRoom,
  loadRoomMessages,
  loadLobby,
  restartGame,
  sendRoomMessage,
  resumeRoom,
  setRoomRoundDuration,
  setRoomTestMode,
  startGame,
  subscribeToLobby,
  touchRoomPresence,
  type Lobby,
  type RoomMessage,
} from './lib/lobby'
import { basePalette, type PaletteSize } from './lib/palette'
import { checkSupabaseConnection } from './lib/supabase'
import { loadOwnProfile, parseAvatarPixels, type PlayerProfile } from './lib/profile'

type BackendStatus = 'checking' | 'online' | 'reconnecting' | 'offline'
type HomeView = 'main' | 'play' | 'editor' | 'challenge' | 'gallery' | 'create' | 'join' | 'settings' | 'profile'

const backendStatusLabels: Record<BackendStatus, string> = {
  checking: 'Szerver: ellenőrzés',
  online: 'Szerver: online',
  reconnecting: 'Szerver: újracsatlakozás',
  offline: 'Szerver: offline',
}

const palette = basePalette.map((color) => color.hex)

const previewPixels = [
  '000444444000',
  '004444444400',
  '044000004440',
  '000000044400',
  '000000444000',
  '000004440000',
  '000044400000',
  '000044000000',
  '000000000000',
  '000044000000',
  '000044000000',
  '000000000000',
]

function normalizeRoomCode(value: string) {
  return value
    .replace(/[^A-HJ-NP-Za-hj-np-z2-9]/g, '')
    .toUpperCase()
    .slice(0, 6)
}

function getInitialRoomCode() {
  return normalizeRoomCode(
    new URLSearchParams(window.location.search).get('room') ?? '',
  )
}

function App() {
  const [playerName, setPlayerName] = useState('')
  const [newRoomDuration, setNewRoomDuration] = useState<RoundDuration>(DEFAULT_ROUND_DURATION)
  const [isChangingRoundDuration, setIsChangingRoundDuration] = useState(false)
  const [homeView, setHomeView] = useState<HomeView>('main')
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorStorageAvailable, setEditorStorageAvailable] = useState(true)
  const [showEditorLeaveConfirmation, setShowEditorLeaveConfirmation] = useState(false)
  const [weeklyUserLabel, setWeeklyUserLabel] = useState('Vendég')
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null)
  const allowEditorLeaveRef = useRef(false)
  const [reduceMotion, setReduceMotion] = useState(
    () => window.localStorage.getItem('bitscrawl-reduce-motion') === 'true',
  )
  const [roomCode, setRoomCode] = useState(getInitialRoomCode)
  const [message, setMessage] = useState(
    'Adj meg egy játékosnevet, majd hozz létre szobát vagy csatlakozz egy kóddal.',
  )
  const [backendStatus, setBackendStatus] =
    useState<BackendStatus>('checking')
  const [isBusy, setIsBusy] = useState(false)
  const [isRestoringRoom, setIsRestoringRoom] = useState(
    getInitialRoomCode().length === 6,
  )
  const [isStartingGame, setIsStartingGame] = useState(false)
  const [isChoosingWord, setIsChoosingWord] = useState(false)
  const [isChangingTestMode, setIsChangingTestMode] = useState(false)
  const [isFinishingRound, setIsFinishingRound] = useState(false)
  const [isAdvancingRound, setIsAdvancingRound] = useState(false)
  const [isRestartingGame, setIsRestartingGame] = useState(false)
  const [isLeavingRoom, setIsLeavingRoom] = useState(false)
  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [roundView, setRoundView] = useState<RoundView | null>(null)
  const [drawEvents, setDrawEvents] = useState<DrawEvent[]>([])
  const [roundMessages, setRoundMessages] = useState<RoundMessage[]>([])
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([])
  const isLeavingRoomRef = useRef(false)

  const openHomeView = useCallback((view: Exclude<HomeView, 'main'>) => {
    window.history.pushState({ bitscrawlHomeView: view }, '')
    setHomeView(view)
  }, [])

  const closeHomeView = useCallback(() => {
    if (window.history.state?.bitscrawlHomeView) {
      window.history.back()
    } else {
      setHomeView('main')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadOwnProfile().then(({ profile, user }) => {
      if (cancelled) return
      setPlayerProfile(profile)
      setWeeklyUserLabel(profile?.displayName || user?.email || 'Vendég')
    }).catch(() => {
      if (!cancelled) {
        setPlayerProfile(null)
        setWeeklyUserLabel('Vendég')
      }
    })
    return () => { cancelled = true }
  }, [homeView])

  const handleProfileChange = useCallback((profile: PlayerProfile | null) => {
    setPlayerProfile(profile)
    setWeeklyUserLabel(profile?.displayName ?? 'Vendég')
  }, [])

  useEffect(() => {
    if (lobby) return

    const handlePopState = (event: PopStateEvent) => {
      const nextView: HomeView = event.state?.bitscrawlHomeView ?? 'main'
      if (nextView === homeView) return
      if (homeView === 'editor' && editorDirty && !allowEditorLeaveRef.current) {
        window.history.pushState({ bitscrawlHomeView: 'editor' }, '')
        setShowEditorLeaveConfirmation(true)
        return
      }
      allowEditorLeaveRef.current = false
      setHomeView(nextView)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && homeView !== 'main' && !window.history.state?.bitscrawlImmersiveCanvas &&
        !window.history.state?.bitscrawlModal) closeHomeView()
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeHomeView, editorDirty, homeView, lobby])

  const handleReduceMotionChange = () => {
    const nextValue = !reduceMotion
    setReduceMotion(nextValue)
    window.localStorage.setItem('bitscrawl-reduce-motion', String(nextValue))
  }

  const hydrateLobby = useCallback(
    async (entry: Parameters<typeof loadLobby>[0]) => {
      const nextLobby = await loadLobby(entry)
      const nextRoundView =
        nextLobby.room.status === 'playing'
          ? await loadRoundView(nextLobby.room.id)
          : null
      const [nextDrawEvents, nextRoundMessages, nextRoomMessages] =
        await Promise.all([
          nextRoundView ? loadDrawEvents(nextRoundView.round_id) : [],
          nextRoundView ? loadRoundMessages(nextRoundView.round_id) : [],
          loadRoomMessages(nextLobby.room.id),
        ])

      if (!isLeavingRoomRef.current) {
        setLobby(nextLobby)
        setRoundView(nextRoundView)
        setDrawEvents(nextDrawEvents)
        setRoundMessages(nextRoundMessages)
        setRoomMessages(nextRoomMessages)
      }

      return nextLobby
    },
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 5_000)

    checkSupabaseConnection(controller.signal).then((isOnline) => {
      if (!controller.signal.aborted) {
        setBackendStatus(isOnline ? 'online' : 'offline')
      }
    })

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const code = getInitialRoomCode()
    if (code.length !== 6) {
      setIsRestoringRoom(false)
      return
    }

    let cancelled = false
    setMessage('Korábbi szobatagság keresése…')

    const restore = async () => {
      try {
        const entry = await resumeRoom(code)
        if (cancelled) return

        if (!entry) {
          setMessage(
            'Ezen az eszközön még nem voltál a szobában. Adj meg egy nevet a csatlakozáshoz.',
          )
          return
        }

        await hydrateLobby(entry)
        if (cancelled) return

        setRoomCode(entry.roomCode)
        setBackendStatus('online')
        setMessage('Visszatértél a korábbi helyedre a szobában.')
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'Nem sikerült visszaállítani a szobát.',
          )
        }
      } finally {
        if (!cancelled) setIsRestoringRoom(false)
      }
    }

    void restore()

    return () => {
      cancelled = true
    }
  }, [hydrateLobby])

  const activeRoomId = lobby?.room.id
  const activePlayerId = lobby?.playerId
  const activeUserId = lobby?.currentUserId

  const refreshLobby = useCallback(async () => {
    if (!activeRoomId || !activePlayerId || !activeUserId) return

    try {
      await hydrateLobby({
        currentUserId: activeUserId,
        playerId: activePlayerId,
        roomCode: lobby?.room.code ?? '',
        roomId: activeRoomId,
      })
    } catch (error) {
      if (isLeavingRoomRef.current) return
      setMessage(error instanceof Error ? error.message : 'Nem frissült a szoba.')
    }
  }, [
    activePlayerId,
    activeRoomId,
    activeUserId,
    hydrateLobby,
    lobby?.room.code,
  ])

  const activeRoundId = roundView?.round_id
  const refreshDrawEvents = useCallback(async () => {
    if (!activeRoundId) return

    try {
      setDrawEvents(await loadDrawEvents(activeRoundId))
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Nem frissült a pixelrajz.',
      )
    }
  }, [activeRoundId])

  const refreshRoundMessages = useCallback(async () => {
    if (!activeRoundId) return

    try {
      setRoundMessages(await loadRoundMessages(activeRoundId))
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Nem frissült a chat.',
      )
    }
  }, [activeRoundId])

  const refreshRoomMessages = useCallback(async () => {
    if (!activeRoomId) return

    try {
      setRoomMessages(await loadRoomMessages(activeRoomId))
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Nem frissült a szobachat.',
      )
    }
  }, [activeRoomId])

  useEffect(() => {
    if (!activeRoomId) return
    return subscribeToLobby(
      activeRoomId,
      () => void refreshLobby(),
      () => void refreshDrawEvents(),
      () => void refreshRoundMessages(),
      () => void refreshRoomMessages(),
      (status) => {
        setBackendStatus(
          status === 'connected'
            ? 'online'
            : status === 'reconnecting'
              ? 'reconnecting'
              : 'offline',
        )
      },
    )
  }, [
    activeRoomId,
    refreshDrawEvents,
    refreshLobby,
    refreshRoomMessages,
    refreshRoundMessages,
  ])

  useEffect(() => {
    if (!activeRoomId) return

    let heartbeatRunning = false

    const heartbeat = async (refreshAfter = false) => {
      if (heartbeatRunning || !navigator.onLine) return
      heartbeatRunning = true

      try {
        const result = await touchRoomPresence(activeRoomId)
        setBackendStatus('online')

        if (refreshAfter || result.host_changed || result.round_finished) {
          await refreshLobby()
        }

        if (result.host_changed) {
          setMessage('A korábbi host kiesett, ezért új hostot választottunk.')
        } else if (result.round_finished) {
          setMessage('A rajzoló kiesett, ezért a kör lezárult.')
        }
      } catch {
        if (!isLeavingRoomRef.current) {
          setBackendStatus(navigator.onLine ? 'reconnecting' : 'offline')
        }
      } finally {
        heartbeatRunning = false
      }
    }

    const handleOnline = () => {
      setBackendStatus('reconnecting')
      void heartbeat(true)
    }
    const handleOffline = () => setBackendStatus('offline')
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void heartbeat(true)
    }

    void heartbeat(true)
    const intervalId = window.setInterval(() => void heartbeat(), 10_000)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [activeRoomId, refreshLobby])

  const trimmedName = playerName.trim()
  const normalizedRoomCode = useMemo(
    () => roomCode.trim().toUpperCase(),
    [roomCode],
  )

  const checkName = () => {
    if (trimmedName.length < 2) {
      setMessage('Adj meg legalább 2 karakterből álló játékosnevet.')
      return false
    }

    return true
  }

  const enterLobby = async (
    action: 'create' | 'join',
    code?: string,
  ) => {
    if (!checkName()) return

    isLeavingRoomRef.current = false
    setIsBusy(true)
    setMessage(
      action === 'create'
        ? 'Szoba létrehozása…'
        : 'Csatlakozás a szobához…',
    )

    try {
      const entry =
        action === 'create'
          ? await createRoom(trimmedName, newRoomDuration)
          : await joinRoom(trimmedName, code ?? '')
      await hydrateLobby(entry)

      window.history.replaceState({}, '', `?room=${entry.roomCode}`)
      setRoomCode(entry.roomCode)
      setMessage('Sikeresen beléptél a várószobába.')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült kapcsolódni a szobához.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleCreateRoom = () => void enterLobby('create')

  const handleJoinRoom = () => {
    if (normalizedRoomCode.length !== 6) {
      setMessage('A szobakód pontosan 6 karakter hosszú legyen.')
      return
    }

    void enterLobby('join', normalizedRoomCode)
  }

  const copyInviteLink = async () => {
    if (!lobby) return

    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${lobby.room.code}`

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setMessage('A meghívó linket a vágólapra másoltam.')
    } catch {
      setMessage(`Meghívó link: ${inviteUrl}`)
    }
  }

  const handleStartGame = async () => {
    if (!lobby) return

    setIsStartingGame(true)
    setMessage('A játék indítása…')

    try {
      await startGame(lobby.room.id)
      await refreshLobby()
      setMessage('A meccs elindult!')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült elindítani a játékot.',
      )
    } finally {
      setIsStartingGame(false)
    }
  }

  const handleToggleTestMode = async () => {
    if (!lobby) return

    setIsChangingTestMode(true)
    setMessage('Teszt mód frissítése…')

    try {
      await setRoomTestMode(lobby.room.id, !lobby.room.test_mode)
      await refreshLobby()
      setMessage(
        lobby.room.test_mode
          ? 'Teszt mód kikapcsolva.'
          : 'Teszt mód bekapcsolva: egyedül is indíthatsz.',
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült módosítani a teszt módot.',
      )
    } finally {
      setIsChangingTestMode(false)
    }
  }

  const handleRoundDurationChange = async (duration: RoundDuration) => {
    if (!lobby || isChangingRoundDuration || lobby.room.round_duration_seconds === duration) return
    setIsChangingRoundDuration(true)
    setMessage(roundDurationText.updating)
    try {
      await setRoomRoundDuration(lobby.room.id, duration)
      await refreshLobby()
      setMessage(roundDurationText.updated)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : roundDurationText.failed)
    } finally {
      setIsChangingRoundDuration(false)
    }
  }

  const handleChooseWord = async (word: string) => {
    if (!roundView) return

    setIsChoosingWord(true)
    setMessage('A szó mentése…')

    try {
      await chooseRoundWord(roundView.round_id, word)
      await refreshLobby()
      setMessage('A szó kiválasztva. Készülj a rajzolásra!')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült kiválasztani a szót.',
      )
    } finally {
      setIsChoosingWord(false)
    }
  }

  const handleExpireRound = async () => {
    if (!roundView || isFinishingRound) return

    setIsFinishingRound(true)
    setMessage('Lejárt az idő, a kör lezárása…')

    try {
      await finishExpiredRound(roundView.round_id)
      await refreshLobby()
      setMessage('Lejárt az idő!')
    } catch (error) {
      await refreshLobby()
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült lezárni a lejárt kört.',
      )
    } finally {
      setIsFinishingRound(false)
    }
  }

  const handleAdvanceGame = async () => {
    if (!roundView || isAdvancingRound) return

    setIsAdvancingRound(true)
    setMessage('A következő kör előkészítése…')

    try {
      const result = await advanceGame(roundView.round_id)
      await refreshLobby()
      setMessage(
        result.room_status === 'finished'
          ? 'Véget ért a meccs!'
          : 'Kezdődik a következő kör!',
      )
    } catch (error) {
      await refreshLobby()
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült elindítani a következő kört.',
      )
    } finally {
      setIsAdvancingRound(false)
    }
  }

  const handleRestartGame = async () => {
    if (!lobby || isRestartingGame) return

    setIsRestartingGame(true)
    setMessage('Az új meccs előkészítése…')

    try {
      await restartGame(lobby.room.id)
      await refreshLobby()
      setMessage('Elindult az új meccs!')
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült elindítani az új meccset.',
      )
    } finally {
      setIsRestartingGame(false)
    }
  }

  const handleLeaveRoom = async (confirmed = false) => {
    if (!lobby || isLeavingRoom) return

    if (lobby.room.status === 'playing' && !confirmed) {
      setShowLeaveConfirmation(true)
      return
    }

    setShowLeaveConfirmation(false)
    isLeavingRoomRef.current = true
    setIsLeavingRoom(true)
    setMessage('Kilépés a szobából…')

    try {
      await leaveRoom(lobby.room.id)
      setLobby(null)
      setRoundView(null)
      setDrawEvents([])
      setRoundMessages([])
      setRoomMessages([])
      setRoomCode('')
      setHomeView('main')
      window.history.replaceState({}, '', window.location.pathname)
      setBackendStatus('online')
      setMessage('Kiléptél a szobából. Létrehozhatsz egy újat vagy csatlakozhatsz másikhoz.')
    } catch (error) {
      isLeavingRoomRef.current = false
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nem sikerült kilépni a szobából.',
      )
    } finally {
      setIsLeavingRoom(false)
    }
  }

  const isHost = lobby?.room.host_user_id === lobby?.currentUserId
  const gameIsPlaying = lobby?.room.status === 'playing'
  const gameIsFinished = lobby?.room.status === 'finished'
  const roomIsLocked = gameIsPlaying || gameIsFinished
  const minimumPlayers = lobby?.room.test_mode ? 1 : 2
  const drawer = lobby?.players.find(
    (player) => player.user_id === roundView?.drawer_user_id,
  )
  const rankedPlayers = [...(lobby?.players ?? [])].sort(
    (first, second) =>
      second.score - first.score ||
      first.joined_at.localeCompare(second.joined_at) ||
      first.id - second.id,
  )
  const playerIsOnline = (lastSeenAt: string) =>
    Date.now() - new Date(lastSeenAt).getTime() < 45_000

  return (
    <main className="app-shell" data-reduced-motion={reduceMotion}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bitscrawl kezdőlap">
          <span className="brand-mark" aria-hidden="true">
            ?
          </span>
          <span>Bitscrawl</span>
        </a>
        <div className="topbar-statuses">
          <span
            className="backend-badge"
            data-status={homeView === 'editor' && !lobby ? 'online' : backendStatus}
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {homeView === 'editor' && !lobby ? editorText.localMode : backendStatusLabels[backendStatus]}
          </span>
          <span className="prototype-badge">Korai prototípus</span>
          <button
            aria-label={weeklyUserLabel === 'Vendég' ? 'Profil és belépés' : `Saját profil: ${weeklyUserLabel}`}
            className="user-badge profile-menu-button"
            disabled={Boolean(lobby) || homeView === 'profile'}
            onClick={() => openHomeView('profile')}
            title={lobby ? 'A profil a szobából kilépés után nyitható meg.' : 'Saját profil'}
            type="button"
          >
            <ProfileAvatar label="" pixels={playerProfile?.avatarPixels ?? null} />
            <span>{weeklyUserLabel}</span>
          </button>
        </div>
      </header>

      {lobby ? (
        <section className="waiting-room" id="top" aria-labelledby="room-title">
          <div className="room-summary">
            <p className="step-label">
              {gameIsFinished
                ? 'Meccs vége'
                : gameIsPlaying
                  ? 'Elindult meccs'
                  : 'Online várószoba'}
            </p>
            <h1 id="room-title">Szobakód</h1>
            <strong className="room-code">{lobby.room.code}</strong>
            <p className="room-note">
              {roundDurationText.label}: {lobby.room.round_duration_seconds ?? DEFAULT_ROUND_DURATION} {roundDurationText.seconds}
              {lobby.room.test_mode ? <><br />{roundDurationText.testOverride}</> : null}
            </p>
            <button
              className="secondary-button copy-button"
              onClick={() => void copyInviteLink()}
              type="button"
            >
              Meghívó link másolása
            </button>
            <button
              className="leave-room-button"
              disabled={isLeavingRoom}
              onClick={() => void handleLeaveRoom()}
              type="button"
            >
              {isLeavingRoom ? 'Kilépés…' : 'Kilépés a szobából'}
            </button>
            <p className="room-note">
              {roomIsLocked
                ? 'A szoba lezárult, új játékos már nem csatlakozhat.'
                : 'Oszd meg a kódot vagy a meghívó linket a többiekkel.'}
            </p>
          </div>

          <div className="players-panel">
            <div className="players-heading">
              <div>
                <p className="step-label">Játékosok</p>
                <h2>
                  {gameIsFinished
                    ? 'Végeredmény'
                    : gameIsPlaying
                      ? 'Meccs folyamatban'
                      : 'Várjuk a többieket'}
                </h2>
              </div>
              <span className="player-count">
                {lobby.players.length}/{lobby.room.max_players}
              </span>
            </div>

            <ol className="player-list" data-ranked={gameIsFinished}>
              {(gameIsFinished ? rankedPlayers : lobby.players).map((player, index) => {
                const isHost = player.user_id === lobby.room.host_user_id
                const isCurrentPlayer = player.user_id === lobby.currentUserId
                const isOnline = playerIsOnline(player.last_seen_at)
                const avatarPixels = parseAvatarPixels(player.avatar_pixels)

                return (
                  <li key={player.id}>
                    {avatarPixels ? (
                      <ProfileAvatar className="player-avatar" label={`${player.display_name} profilképe`} pixels={avatarPixels} />
                    ) : (
                      <span className="player-avatar" aria-hidden="true">
                        {player.display_name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="player-name">
                      {gameIsFinished ? `${index + 1}. ` : ''}
                      {player.display_name}
                      {isCurrentPlayer ? ' (te)' : ''}
                    </span>
                    {isHost ? <span className="host-badge">Host</span> : null}
                    {!isOnline ? (
                      <span className="offline-player-badge">Nincs kapcsolat</span>
                    ) : null}
                    {roomIsLocked ? (
                      <strong className="score-badge">{player.score} pont</strong>
                    ) : null}
                  </li>
                )
              })}
            </ol>

            {gameIsPlaying ? (
              <div className="round-panel">
                <p className="round-label">
                  {roundView
                    ? `${roundView.round_number}/${roundView.total_rounds}. kör`
                    : 'Kör betöltése…'}
                </p>
                <strong>
                  {roundView?.is_drawer
                    ? 'Te rajzolsz!'
                    : `${drawer?.display_name ?? 'A rajzoló'} rajzol`}
                </strong>

                {roundView?.round_status === 'finished' ? (
                  <div className="round-result">
                    <span>
                      Kör vége. A megfejtés:{' '}
                      <b>{roundView.chosen_word ?? 'nem választott szót'}</b>.
                    </span>
                    <span>
                      {roundView.correct_guess_count} helyes megfejtés érkezett.
                    </span>
                  </div>
                ) : roundView?.round_status === 'choosing' &&
                roundView.is_drawer ? (
                  <div className="word-choice-panel">
                    <span>Válassz egy szót:</span>
                    <div className="word-options">
                      {roundView.word_options?.map((word) => (
                        <button
                          disabled={isChoosingWord}
                          key={word}
                          onClick={() => void handleChooseWord(word)}
                          type="button"
                        >
                          {word}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : roundView?.round_status === 'choosing' ? (
                  <span>A rajzoló éppen szót választ…</span>
                ) : roundView?.is_drawer ? (
                  <span>
                    A választott szavad: <b>{roundView.chosen_word}</b>.
                  </span>
                ) : (
                  <span>A rajzoló megkapta a szót.</span>
                )}

                {roundView?.round_status === 'drawing' &&
                roundView.drawing_ends_at ? (
                  <RoundTimer
                    drawingEndsAt={roundView.drawing_ends_at}
                    onExpire={() => void handleExpireRound()}
                    roundId={roundView.round_id}
                    serverNow={roundView.server_now}
                  />
                ) : roundView?.round_status === 'drawing' ? (
                  <div
                    aria-label="Egyszemélyes teszt mód, nincs időlimit"
                    className="round-timer"
                    data-unlimited="true"
                    role="status"
                  >
                    <span>Egyszemélyes teszt</span>
                    <strong>∞</strong>
                  </div>
                ) : null}

                {roundView?.round_status === 'finished' &&
                roundView.next_round_at ? (
                  <RoundTransitionTimer
                    nextRoundAt={roundView.next_round_at}
                    onReady={() => void handleAdvanceGame()}
                    roundId={roundView.round_id}
                    serverNow={roundView.server_now}
                  />
                ) : null}
              </div>
            ) : gameIsFinished ? (
              <div className="game-results">
                <p className="winner-label">A győztes</p>
                <strong>{rankedPlayers[0]?.display_name ?? 'Nincs játékos'}</strong>
                <span>{rankedPlayers[0]?.score ?? 0} pont</span>
                {isHost ? (
                  <button
                    className="primary-button start-game-button"
                    disabled={isRestartingGame}
                    onClick={() => void handleRestartGame()}
                    type="button"
                  >
                    {isRestartingGame ? 'Indítás…' : 'Új játék ugyanígy'}
                  </button>
                ) : (
                  <span>A host indíthat új játékot ugyanazzal a társasággal.</span>
                )}
              </div>
            ) : isHost ? (
              <div className="start-game-controls">
                {isRoundDuration(lobby.room.round_duration_seconds) ? (
                  <RoundDurationControl
                    value={lobby.room.round_duration_seconds}
                    disabled={isChangingRoundDuration || isStartingGame || lobby.room.test_mode}
                    onChange={duration => void handleRoundDurationChange(duration)}
                  />
                ) : null}
                <button
                  aria-pressed={lobby.room.test_mode}
                  className="test-mode-button"
                  disabled={isChangingTestMode || isStartingGame}
                  onClick={() => void handleToggleTestMode()}
                  type="button"
                >
                  Teszt mód: {lobby.room.test_mode ? 'BE' : 'KI'}
                </button>
                <span>
                  {lobby.room.test_mode
                    ? 'Egyedül korlátlan rajzidővel is elindíthatod a meccset.'
                    : 'Normál módban legalább 2 játékos szükséges.'}
                </span>
                <button
                  className="primary-button start-game-button"
                  disabled={
                    isStartingGame ||
                    isChangingTestMode ||
                    isChangingRoundDuration ||
                    lobby.players.length < minimumPlayers
                  }
                  onClick={() => void handleStartGame()}
                  type="button"
                >
                  {isStartingGame ? 'Indítás…' : 'Játék indítása'}
                </button>
                {lobby.players.length < minimumPlayers ? (
                  <span>Még legalább egy játékosra szükség van.</span>
                ) : null}
              </div>
            ) : (
              <p className="host-wait-message">A host indítja el a játékot.</p>
            )}

            {roundView?.round_status === 'drawing' && !isFinishingRound ? (
              <div className="round-play-area">
                <PixelCanvas
                  canDraw={roundView.is_drawer}
                  chosenWord={roundView.chosen_word}
                  drawingEndsAt={roundView.drawing_ends_at}
                  events={drawEvents}
                  onError={(error) =>
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'Nem sikerült elküldeni a pixelmódosítást.',
                    )
                  }
                  onSubmit={(changes) =>
                    submitPixelChanges(roundView.round_id, changes)
                  }
                  paletteSize={lobby.room.palette_size as PaletteSize}
                  roundId={roundView.round_id}
                  serverNow={roundView.server_now}
                />
                <div className="play-side-column">
                  <RoundChat
                    currentUserId={lobby.currentUserId}
                    isDrawer={roundView.is_drawer}
                    messages={roundMessages}
                    onError={(error) =>
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Nem sikerült elküldeni a tippet.',
                      )
                    }
                    onSubmit={(guess) => submitGuess(roundView.round_id, guess)}
                    players={lobby.players}
                    roundId={roundView.round_id}
                  />
                  <RoomChat
                    messages={roomMessages}
                    onError={(error) =>
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Nem sikerült elküldeni a chatüzenetet.',
                      )
                    }
                    onSubmit={(content) =>
                      sendRoomMessage(lobby.room.id, content)
                    }
                    players={lobby.players}
                  />
                </div>
              </div>
            ) : null}

            {roundView?.round_status !== 'drawing' || isFinishingRound ? (
              <RoomChat
                messages={roomMessages}
                onError={(error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Nem sikerült elküldeni a chatüzenetet.',
                  )
                }
                onSubmit={(content) => sendRoomMessage(lobby.room.id, content)}
                players={lobby.players}
              />
            ) : null}

            <p className="status-message" aria-live="polite">
              {message}
            </p>
          </div>
        </section>
      ) : homeView === 'profile' ? (
        <ProfilePanel onBack={closeHomeView} onProfileChange={handleProfileChange} />
      ) : homeView === 'editor' ? (
        <DrawingEditor onBack={closeHomeView} onDirtyChange={setEditorDirty} onStorageChange={setEditorStorageAvailable} />
      ) : homeView === 'challenge' ? (
        <WeeklyDraw mode="challenge" onBack={closeHomeView} />
      ) : homeView === 'gallery' ? (
        <WeeklyDraw mode="gallery" onBack={closeHomeView} />
      ) : (
        <>
          <section className="hero" id="top">
            <div className="hero-copy">
              <h1 className="home-logo">
                <img alt="BITSCRAWL" className="logo-frame logo-frame-off" src="/ui/bitscrawl-logo.png" />
                <img alt="" aria-hidden="true" className="logo-frame logo-frame-cursor" src="/ui/bitscrawl-logo-cursor.png" />
              </h1>
              <div className="home-palette" aria-hidden="true">
                {basePalette.map((color) => (
                  <i key={color.hex} style={{ backgroundColor: color.hex }} />
                ))}
              </div>
              <p className="eyebrow">Draw and scrawl it!</p>
              <p className="intro">
                Rövid körök, egyszerű szavak és egy valódi rácsalapú vászon.
                Az első célunk egy 2–6 fővel játszható MVP.
              </p>

              <div className="feature-row" aria-label="Az MVP fő jellemzői">
                <span>32×32 vászon</span>
                <span>2–6 játékos</span>
                <span>Élő rajzolás</span>
              </div>
            </div>

            <div className="pixel-card" aria-label="Pixel art előnézet">
              <div className="canvas-label">
                <span>Vászon</span>
                <span>32 × 32</span>
              </div>
              <div className="pixel-preview" aria-hidden="true">
                {previewPixels.flatMap((row, rowIndex) =>
                  [...row].map((colorIndex, columnIndex) => (
                    <span
                      className="preview-pixel"
                      key={`${rowIndex}-${columnIndex}`}
                      style={{
                        backgroundColor:
                          colorIndex === '0'
                            ? 'transparent'
                            : palette[Number(colorIndex)],
                      }}
                    />
                  )),
                )}
              </div>
              <div className="palette" aria-label="Nyolcszínű kezdőpaletta">
                {palette.map((color) => (
                  <span key={color} style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
          </section>

          <section className="lobby-card home-panel" data-home-view={homeView} aria-labelledby="lobby-title">
            {homeView === 'main' ? (
              <>
                <div className="lobby-heading">
                  <p className="step-label">Főmenü</p>
                  <h2 id="lobby-title">Mit szeretnél?</h2>
                </div>
                <div className="home-menu-actions">
                  <button
                    className="ui-drawn-button ui-button-1"
                    onClick={() => openHomeView('play')}
                    type="button"
                  >
                    {editorText.play}
                  </button>
                  <button
                    className="ui-drawn-button ui-button-2"
                    onClick={() => openHomeView('challenge')}
                    type="button"
                  >
                    Kihívás
                  </button>
                  <button className="ui-drawn-button ui-button-3" onClick={() => openHomeView('editor')} type="button">
                    {editorText.editor}
                  </button>
                  <button className="ui-drawn-button ui-button-4" onClick={() => openHomeView('gallery')} type="button">
                    Galéria
                  </button>
                  <button className="ui-drawn-button ui-button-5" onClick={() => openHomeView('settings')} type="button">
                    Beállítások
                  </button>
                </div>
              </>
            ) : homeView === 'play' ? (
              <>
                <div className="lobby-heading">
                  <p className="step-label">{editorText.play}</p>
                  <h2 id="lobby-title">{editorText.play}</h2>
                </div>
                <div className="home-menu-actions play-actions">
                  <button className="ui-drawn-button ui-button-1" onClick={() => openHomeView('create')} type="button">{editorText.create}</button>
                  <button className="ui-drawn-button ui-button-2" onClick={() => openHomeView('join')} type="button">Csatlakozás</button>
                  <button className="ui-drawn-button ui-button-3 home-back-button" onClick={closeHomeView} type="button">{editorText.backMain}</button>
                </div>
              </>
            ) : homeView === 'create' ? (
              <>
                <div className="lobby-heading">
                  <p className="step-label">Játék indítása</p>
                  <h2 id="lobby-title">Új szoba</h2>
                </div>
                <div className="lobby-controls">
                  <label className="field" htmlFor="create-player-name">
                    <span>Játékosnév</span>
                    <input
                      autoComplete="nickname"
                      disabled={isBusy || isRestoringRoom}
                      id="create-player-name"
                      maxLength={16}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder="Például: PixelPanni"
                      type="text"
                      value={playerName}
                    />
                  </label>
                  <details className="room-settings">
                    <summary>Szoba beállításai</summary>
                    <div className="room-settings-content">
                      <label className="field" htmlFor="room-game-mode">
                        <span>Játékmód</span>
                        <select id="room-game-mode" defaultValue="classic" disabled={isBusy || isRestoringRoom}>
                          <option value="classic">Classic</option>
                          <option value="competition" disabled>Verseny · hamarosan</option>
                        </select>
                      </label>
                      <label className="field" htmlFor="create-round-duration">
                        <span>{roundDurationText.label}</span>
                        <select
                          id="create-round-duration"
                          disabled={isBusy || isRestoringRoom}
                          onChange={(event) => {
                            const duration = Number(event.target.value)
                            if (isRoundDuration(duration)) setNewRoomDuration(duration)
                          }}
                          value={newRoomDuration}
                        >
                          {roundDurations.map(duration => (
                            <option key={duration} value={duration}>{duration} másodperc</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </details>
                  <button
                    className="primary-button"
                    disabled={isBusy || isRestoringRoom}
                    onClick={handleCreateRoom}
                    type="button"
                  >
                    {isRestoringRoom
                      ? 'Korábbi szoba keresése…'
                      : isBusy
                        ? 'Kapcsolódás…'
                        : 'Szoba létrehozása'}
                  </button>
                  <button className="home-back-button" onClick={closeHomeView} type="button">
                    {editorText.backPlay}
                  </button>
                  <p className="status-message" aria-live="polite">{message}</p>
                </div>
              </>
            ) : homeView === 'join' ? (
              <>
                <div className="lobby-heading">
                  <p className="step-label">Kódos belépés</p>
                  <h2 id="lobby-title">Csatlakozás</h2>
                </div>
                <div className="lobby-controls">
                  <label className="field" htmlFor="join-player-name">
                    <span>Játékosnév</span>
                    <input
                      autoComplete="nickname"
                      disabled={isBusy || isRestoringRoom}
                      id="join-player-name"
                      maxLength={16}
                      onChange={(event) => setPlayerName(event.target.value)}
                      placeholder="Például: PixelPanni"
                      type="text"
                      value={playerName}
                    />
                  </label>
                  <label className="field" htmlFor="room-code">
                    <span>Szobakód</span>
                    <input
                      autoCapitalize="characters"
                      disabled={isBusy || isRestoringRoom}
                      id="room-code"
                      maxLength={6}
                      onChange={(event) =>
                        setRoomCode(
                          event.target.value
                            ? normalizeRoomCode(event.target.value)
                            : '',
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleJoinRoom()
                      }}
                      placeholder="AB2CD3"
                      spellCheck={false}
                      type="text"
                      value={roomCode}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={isBusy || isRestoringRoom}
                    onClick={handleJoinRoom}
                    type="button"
                  >
                    {isBusy ? 'Kapcsolódás…' : 'Csatlakozás'}
                  </button>
                  <button className="home-back-button" onClick={closeHomeView} type="button">
                    Vissza a főmenübe
                  </button>
                  <p className="status-message" aria-live="polite">{message}</p>
                </div>
              </>
            ) : (
              <>
                <div className="lobby-heading">
                  <p className="step-label">Helyi beállítások</p>
                  <h2 id="lobby-title">Beállítások</h2>
                </div>
                <div className="settings-list">
                  <button
                    className="setting-row profile-setting-row"
                    onClick={() => openHomeView('profile')}
                    type="button"
                  >
                    <span className="profile-setting-label">
                      <ProfileAvatar label="" pixels={playerProfile?.avatarPixels ?? null} />
                      Profil
                    </span>
                    <strong>{playerProfile ? 'MEGNYITÁS' : 'BELÉPÉS'}</strong>
                  </button>
                  <button
                    aria-pressed={reduceMotion}
                    className="setting-row"
                    onClick={handleReduceMotionChange}
                    type="button"
                  >
                    <span>Csökkentett mozgás</span>
                    <strong>{reduceMotion ? 'BE' : 'KI'}</strong>
                  </button>
                  <p>A beállítás ezen az eszközön marad meg.</p>
                  <section className="info-panel-copy" aria-labelledby="info-title">
                    <p className="step-label">A játékról</p>
                    <h3 id="info-title">Információk</h3>
                    <p>Rajzolj a 32×32-es vásznon, a többiek pedig próbálják időben megfejteni a szót.</p>
                    <p>A szobák 2–6 játékosra készülnek. A játékhoz internetkapcsolat szükséges.</p>
                    <p className="info-version">Bitscrawl · korai prototípus</p>
                  </section>
                  <button className="home-back-button" onClick={closeHomeView} type="button">
                    Vissza a főmenübe
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <footer>
        <span>Bitscrawl MVP</span>
        <span>14. mérföldkő · Heti rajz</span>
      </footer>

      <BugReport
        playerName={playerName}
        roomCode={lobby?.room.code ?? null}
        roomId={lobby?.room.id ?? null}
        roundId={roundView?.round_id ?? null}
        roundStatus={roundView?.round_status ?? null}
      />

      {showEditorLeaveConfirmation ? (
        <ConfirmModal
          confirmLabel={editorStorageAvailable ? editorText.backPlay : editorText.leaveUnsaved}
          message={editorStorageAvailable ? editorText.leave : editorText.leaveWithoutStorage}
          onCancel={() => setShowEditorLeaveConfirmation(false)}
          onConfirm={() => {
            setShowEditorLeaveConfirmation(false)
            allowEditorLeaveRef.current = true
            window.history.back()
          }}
          title={editorText.leaveTitle}
        />
      ) : null}

      {showLeaveConfirmation ? (
        <ConfirmModal
          confirmLabel="Kilépés a szobából"
          isBusy={isLeavingRoom}
          message="A folyamatban lévő meccsből kilépsz, és a helyed felszabadul. Biztosan folytatod?"
          onCancel={() => setShowLeaveConfirmation(false)}
          onConfirm={() => void handleLeaveRoom(true)}
          title="Kilépsz a meccsből?"
        />
      ) : null}
    </main>
  )
}

export default App
