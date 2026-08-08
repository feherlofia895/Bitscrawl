import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  createRoom,
  joinRoom,
  loadLobby,
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
  const [lobby, setLobby] = useState<Lobby | null>(null)

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
      setLobby(nextLobby)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nem frissült a szoba.')
    }
  }, [activePlayerId, activeRoomId, activeUserId, lobby?.room.code])

  useEffect(() => {
    if (!activeRoomId) return
    return subscribeToLobby(activeRoomId, () => void refreshLobby())
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
            <p className="step-label">Online várószoba</p>
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
              A játékhoz legalább 2 fő kell. A host indítógombja a következő
              lépésben érkezik.
            </p>
          </div>

          <div className="players-panel">
            <div className="players-heading">
              <div>
                <p className="step-label">Játékosok</p>
                <h2>Várjuk a többieket</h2>
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
        <span>2. mérföldkő · online várószoba</span>
      </footer>
    </main>
  )
}

export default App
