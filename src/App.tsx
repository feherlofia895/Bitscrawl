import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { PixelCanvas } from './components/PixelCanvas'
import { RoundChat } from './components/RoundChat'
import {
  chooseRoundWord,
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
  loadLobby,
  setRoomTestMode,
  startGame,
  subscribeToLobby,
  type Lobby,
} from './lib/lobby'
import { checkSupabaseConnection } from './lib/supabase'

type BackendStatus = 'checking' | 'online' | 'offline'

const backendStatusLabels: Record<BackendStatus, string> = {
  checking: 'Szerver: ellenőrzés',
  online: 'Szerver: online',
  offline: 'Szerver: offline',
}

const palette = [
  '#241a35',
  '#f7f3e8',
  '#9b7ede',
  '#4ecdc4',
  '#ffd166',
  '#ff6b6b',
  '#4d96ff',
  '#7b8794',
]

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
  const [roomCode, setRoomCode] = useState(getInitialRoomCode)
  const [message, setMessage] = useState(
    'Adj meg egy játékosnevet, majd hozz létre szobát vagy csatlakozz egy kóddal.',
  )
  const [backendStatus, setBackendStatus] =
    useState<BackendStatus>('checking')
  const [isBusy, setIsBusy] = useState(false)
  const [isStartingGame, setIsStartingGame] = useState(false)
  const [isChoosingWord, setIsChoosingWord] = useState(false)
  const [isChangingTestMode, setIsChangingTestMode] = useState(false)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [roundView, setRoundView] = useState<RoundView | null>(null)
  const [drawEvents, setDrawEvents] = useState<DrawEvent[]>([])
  const [roundMessages, setRoundMessages] = useState<RoundMessage[]>([])

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

  const activeRoomId = lobby?.room.id
  const activePlayerId = lobby?.playerId
  const activeUserId = lobby?.currentUserId

  const refreshLobby = useCallback(async () => {
    if (!activeRoomId || !activePlayerId || !activeUserId) return

    try {
      const nextLobby = await loadLobby({
        currentUserId: activeUserId,
        playerId: activePlayerId,
        roomCode: lobby?.room.code ?? '',
        roomId: activeRoomId,
      })
      const nextRoundView =
        nextLobby.room.status === 'playing'
          ? await loadRoundView(nextLobby.room.id)
          : null
      const [nextDrawEvents, nextRoundMessages] = nextRoundView
        ? await Promise.all([
            loadDrawEvents(nextRoundView.round_id),
            loadRoundMessages(nextRoundView.round_id),
          ])
        : [[], []]

      setLobby(nextLobby)
      setRoundView(nextRoundView)
      setDrawEvents(nextDrawEvents)
      setRoundMessages(nextRoundMessages)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nem frissült a szoba.')
    }
  }, [activePlayerId, activeRoomId, activeUserId, lobby?.room.code])

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

  useEffect(() => {
    if (!activeRoomId) return
    return subscribeToLobby(
      activeRoomId,
      () => void refreshLobby(),
      () => void refreshDrawEvents(),
      () => void refreshRoundMessages(),
    )
  }, [activeRoomId, refreshDrawEvents, refreshLobby, refreshRoundMessages])

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

    setIsBusy(true)
    setMessage(
      action === 'create'
        ? 'Szoba létrehozása…'
        : 'Csatlakozás a szobához…',
    )

    try {
      const entry =
        action === 'create'
          ? await createRoom(trimmedName)
          : await joinRoom(trimmedName, code ?? '')
      const nextLobby = await loadLobby(entry)

      window.history.replaceState({}, '', `?room=${entry.roomCode}`)
      setLobby(nextLobby)
      setRoundView(null)
      setDrawEvents([])
      setRoundMessages([])
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

  const isHost = lobby?.room.host_user_id === lobby?.currentUserId
  const gameHasStarted = lobby?.room.status === 'playing'
  const minimumPlayers = lobby?.room.test_mode ? 1 : 2
  const drawer = lobby?.players.find(
    (player) => player.user_id === roundView?.drawer_user_id,
  )

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PixelGuess kezdőlap">
          <span className="brand-mark" aria-hidden="true">
            ?
          </span>
          <span>PixelGuess</span>
        </a>
        <div className="topbar-statuses">
          <span
            className="backend-badge"
            data-status={backendStatus}
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {backendStatusLabels[backendStatus]}
          </span>
          <span className="prototype-badge">Korai prototípus</span>
        </div>
      </header>

      {lobby ? (
        <section className="waiting-room" id="top" aria-labelledby="room-title">
          <div className="room-summary">
            <p className="step-label">
              {gameHasStarted ? 'Elindult meccs' : 'Online várószoba'}
            </p>
            <h1 id="room-title">Szobakód</h1>
            <strong className="room-code">{lobby.room.code}</strong>
            <button
              className="secondary-button copy-button"
              onClick={() => void copyInviteLink()}
              type="button"
            >
              Meghívó link másolása
            </button>
            <p className="room-note">
              {gameHasStarted
                ? 'A szoba lezárult, új játékos már nem csatlakozhat.'
                : 'Oszd meg a kódot vagy a meghívó linket a többiekkel.'}
            </p>
          </div>

          <div className="players-panel">
            <div className="players-heading">
              <div>
                <p className="step-label">Játékosok</p>
                <h2>{gameHasStarted ? 'Kezdődhet a játék' : 'Várjuk a többieket'}</h2>
              </div>
              <span className="player-count">
                {lobby.players.length}/{lobby.room.max_players}
              </span>
            </div>

            <ol className="player-list">
              {lobby.players.map((player) => {
                const isHost = player.user_id === lobby.room.host_user_id
                const isCurrentPlayer = player.user_id === lobby.currentUserId

                return (
                  <li key={player.id}>
                    <span className="player-avatar" aria-hidden="true">
                      {player.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="player-name">
                      {player.display_name}
                      {isCurrentPlayer ? ' (te)' : ''}
                    </span>
                    {isHost ? <span className="host-badge">Host</span> : null}
                  </li>
                )
              })}
            </ol>

            {gameHasStarted ? (
              <div className="round-panel">
                <p className="round-label">1. kör</p>
                <strong>
                  {roundView?.is_drawer
                    ? 'Te rajzolsz!'
                    : `${drawer?.display_name ?? 'A rajzoló'} rajzol`}
                </strong>

                {roundView?.round_status === 'choosing' &&
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
              </div>
            ) : isHost ? (
              <div className="start-game-controls">
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
                    ? 'Egyedül is elindíthatod a meccset.'
                    : 'Normál módban legalább 2 játékos szükséges.'}
                </span>
                <button
                  className="primary-button start-game-button"
                  disabled={
                    isStartingGame ||
                    isChangingTestMode ||
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

            {roundView?.round_status === 'drawing' ? (
              <div className="round-play-area">
                <PixelCanvas
                  canDraw={roundView.is_drawer}
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
                  roundId={roundView.round_id}
                />
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
              </div>
            ) : null}

            <p className="status-message" aria-live="polite">
              {message}
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="hero" id="top">
            <div className="hero-copy">
              <p className="eyebrow">Online pixel art rajzolós játék</p>
              <h1>
                Rajzolj pixelenként.
                <span> Találd ki időben.</span>
              </h1>
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

          <section className="lobby-card" aria-labelledby="lobby-title">
            <div className="lobby-heading">
              <p className="step-label">Első lépés</p>
              <h2 id="lobby-title">Lépj be játékosként</h2>
            </div>

            <div className="lobby-controls">
              <label className="field" htmlFor="player-name">
                <span>Játékosnév</span>
                <input
                  autoComplete="nickname"
                  disabled={isBusy}
                  id="player-name"
                  maxLength={16}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Például: PixelPanni"
                  type="text"
                  value={playerName}
                />
              </label>

              <button
                className="primary-button"
                disabled={isBusy}
                onClick={handleCreateRoom}
                type="button"
              >
                {isBusy ? 'Kapcsolódás…' : 'Szoba létrehozása'}
              </button>

              <div className="divider" aria-hidden="true">
                <span>vagy</span>
              </div>

              <div className="join-row">
                <label className="field" htmlFor="room-code">
                  <span>Szobakód</span>
                  <input
                    autoCapitalize="characters"
                    disabled={isBusy}
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
                  disabled={isBusy}
                  onClick={handleJoinRoom}
                  type="button"
                >
                  Csatlakozás
                </button>
              </div>

              <p className="status-message" aria-live="polite">
                {message}
              </p>
            </div>
          </section>
        </>
      )}

      <footer>
        <span>PixelGuess MVP</span>
        <span>6. mérföldkő · chat és megfejtés</span>
      </footer>
    </main>
  )
}

export default App
