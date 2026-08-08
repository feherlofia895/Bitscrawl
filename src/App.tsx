import { useEffect, useMemo, useState } from 'react'
import './App.css'
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

function App() {
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [message, setMessage] = useState(
    'Ez még a helyi kezdőképernyő. Az online szobákat a következő mérföldkőben kötjük be.',
  )
  const [backendStatus, setBackendStatus] =
    useState<BackendStatus>('checking')

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

  const handleCreateRoom = () => {
    if (!checkName()) return

    setMessage(
      `Szia, ${trimmedName}! A kezdőképernyő működik. A valódi szobalétrehozás következik.`,
    )
  }

  const handleJoinRoom = () => {
    if (!checkName()) return

    if (normalizedRoomCode.length < 4) {
      setMessage('A szobakód legalább 4 karakter hosszú legyen.')
      return
    }

    setMessage(
      `${trimmedName}, a(z) ${normalizedRoomCode} kódot elfogadta a helyi próba. Az online csatlakozás következik.`,
    )
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
              id="player-name"
              maxLength={16}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Például: PixelPanni"
              type="text"
              value={playerName}
            />
          </label>

          <button className="primary-button" onClick={handleCreateRoom} type="button">
            Szoba létrehozása
          </button>

          <div className="divider" aria-hidden="true">
            <span>vagy</span>
          </div>

          <div className="join-row">
            <label className="field" htmlFor="room-code">
              <span>Szobakód</span>
              <input
                autoCapitalize="characters"
                id="room-code"
                maxLength={6}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
                  )
                }
                placeholder="AB12CD"
                spellCheck={false}
                type="text"
                value={roomCode}
              />
            </label>
            <button className="secondary-button" onClick={handleJoinRoom} type="button">
              Csatlakozás
            </button>
          </div>

          <p className="status-message" aria-live="polite">
            {message}
          </p>
        </div>
      </section>

      <footer>
        <span>PixelGuess MVP</span>
        <span>1. mérföldkő · helyi alap</span>
      </footer>
    </main>
  )
}

export default App
