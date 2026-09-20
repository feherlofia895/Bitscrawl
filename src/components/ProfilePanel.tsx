import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { emptyDrawing } from '../lib/drawing'
import { loadOwnProfile, saveProfileAvatar, type PlayerProfile } from '../lib/profile'
import {
  registerWeeklyAccount,
  setWeeklyProfile,
  signInWeeklyAccount,
  signOutWeeklyAccount,
} from '../lib/weekly'
import { ConfirmModal } from './ConfirmModal'
import { PixelCanvas } from './PixelCanvas'
import { ProfileAvatar } from './ProfileAvatar'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'A profilművelet nem sikerült.'
}

export function ProfilePanel({ onBack, onProfileChange }: {
  onBack: () => void
  onProfileChange: (profile: PlayerProfile | null) => void
}) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatarPixels, setAvatarPixels] = useState(emptyDrawing)
  const avatarRef = useRef(avatarPixels)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false)
  const [status, setStatus] = useState('Profil betöltése…')
  const [clearAction, setClearAction] = useState<(() => void) | null>(null)

  const refresh = useCallback(async () => {
    const next = await loadOwnProfile()
    setUser(next.user)
    setProfile(next.profile)
    onProfileChange(next.profile)
    setDisplayName(next.profile?.displayName ?? '')
    const pixels = next.profile?.avatarPixels ?? emptyDrawing()
    avatarRef.current = pixels
    setAvatarPixels(pixels)
    setRevision(value => value + 1)
    setDirty(false)
    return next
  }, [onProfileChange])

  useEffect(() => {
    let cancelled = false
    void refresh()
      .then(next => {
        if (!cancelled) setStatus(next.user ? 'A profilod naprakész.' : 'Jelentkezz be vagy készíts fiókot.')
      })
      .catch(error => { if (!cancelled) setStatus(errorMessage(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

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
      await refresh()
      setStatus('Sikeresen bejelentkeztél.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleAvatarChange = useCallback((pixels: string[]) => {
    avatarRef.current = pixels
    setAvatarPixels(pixels)
    setDirty(true)
    setStatus('A profilképed még nincs elmentve.')
  }, [])

  const handleSave = async () => {
    setBusy(true)
    try {
      await setWeeklyProfile(displayName)
      const avatarResult = await saveProfileAvatar(avatarRef.current)
      const next = await refresh()
      setStatus(avatarResult.storage === 'cloud'
        ? 'A neved és a profilképed elmentve.'
        : 'A profilképed ezen az eszközön elmentve. Az online mentés a következő adatbázis-frissítéssel kapcsolódik be.')
      setProfile(next.profile)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    setBusy(true)
    try {
      await signOutWeeklyAccount()
      setUser(null)
      setProfile(null)
      onProfileChange(null)
      setDisplayName('')
      const pixels = emptyDrawing()
      avatarRef.current = pixels
      setAvatarPixels(pixels)
      setRevision(value => value + 1)
      setStatus('Kijelentkeztél.')
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <header className="profile-header">
        <div>
          <p className="step-label">Játékosfiók</p>
          <h1 id="profile-title">Profil</h1>
          <p>Rajzold meg a saját profilképedet, és jelenítsd meg a neved mellett.</p>
        </div>
        <button onClick={onBack} type="button">Vissza</button>
      </header>

      {!user ? (
        <section className="profile-card profile-auth-card">
          <div>
            <ProfileAvatar label="Vendég profil" pixels={null} />
            <p className="step-label">{authMode === 'login' ? 'Belépés' : 'Új fiók'}</p>
            <h2>{authMode === 'login' ? 'Folytasd a profiloddal' : 'Készíts játékosprofilt'}</h2>
            <p>Fiók nélkül továbbra is játszhatsz vendégként.</p>
          </div>
          <div className="profile-form">
            {authMode === 'register' ? (
              <label className="field">
                <span>Megjelenített név</span>
                <input maxLength={16} onChange={event => setDisplayName(event.target.value)} value={displayName} />
              </label>
            ) : null}
            <label className="field">
              <span>E-mail</span>
              <input autoComplete="email" onChange={event => setEmail(event.target.value)} type="email" value={email} />
            </label>
            <label className="field">
              <span>Jelszó</span>
              <input autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={6} onChange={event => setPassword(event.target.value)} type="password" value={password} />
            </label>
            <button className="primary-button" disabled={busy || loading || !email || password.length < 6 || (authMode === 'register' && displayName.trim().length < 2)} onClick={() => void handleAuth()} type="button">
              {busy ? 'Egy pillanat…' : authMode === 'login' ? 'Belépés' : 'Regisztráció'}
            </button>
            <button disabled={busy} onClick={() => setAuthMode(mode => mode === 'login' ? 'register' : 'login')} type="button">
              {authMode === 'login' ? 'Még nincs fiókom' : 'Már van fiókom'}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="profile-card profile-summary-card">
            <ProfileAvatar label={`${profile?.displayName ?? 'Játékos'} profilképe`} pixels={avatarPixels} />
            <div>
              <p className="step-label">Belépve</p>
              <h2>{profile?.displayName ?? user.email ?? 'Játékos'}</h2>
              <p>{user.email}</p>
            </div>
            <button disabled={busy} onClick={() => void handleSignOut()} type="button">Kilépés</button>
          </section>

          <section className="profile-editor-section">
            <div className="profile-editor-heading">
              <div>
                <p className="step-label">Saját megjelenés</p>
                <h2>Profil beállításai</h2>
                <p>A neved és a rajzolt profilképed jelenik meg a játékban.</p>
              </div>
              <div className="profile-save-controls">
                <label className="field">
                  <span>Megjelenített név</span>
                  <input disabled={busy} maxLength={16} onChange={event => { setDisplayName(event.target.value); setDirty(true) }} value={displayName} />
                </label>
                <button className="primary-button" disabled={busy || displayName.trim().length < 2 || !dirty} onClick={() => void handleSave()} type="button">
                  {busy ? 'Mentés…' : 'Profil mentése'}
                </button>
              </div>
            </div>
            <button
              aria-expanded={avatarEditorOpen}
              className="profile-avatar-toggle"
              disabled={busy}
              onClick={() => setAvatarEditorOpen(open => !open)}
              type="button"
            >
              <span className="profile-avatar-toggle-label">
                <ProfileAvatar label="A jelenlegi profilképed" pixels={avatarPixels} />
                <span>
                  <strong>Profilkép rajzolása</strong>
                  <small>A játék 12 színével, 32×32 pixeles vásznon</small>
                </span>
              </span>
              <span aria-hidden="true">{avatarEditorOpen ? '▲' : '▼'}</span>
            </button>
            {avatarEditorOpen ? (
              <div aria-label="Profilkép rajzolása" className="profile-avatar-drawer">
                <div className="profile-avatar-drawer-heading">
                  <div>
                    <p className="step-label">Profilkép</p>
                    <strong>Rajzold meg az avatárod</strong>
                  </div>
                  <button aria-label="Profilkép-rajzoló bezárása" onClick={() => setAvatarEditorOpen(false)} type="button">
                    Bezárás
                  </button>
                </div>
                <PixelCanvas
                  canDraw={!busy}
                  chosenWord={null}
                  drawingEndsAt={null}
                  events={[]}
                  localDrawing={{
                    initialPixels: avatarPixels,
                    onChange: handleAvatarChange,
                    onRequestClear: action => setClearAction(() => action),
                  }}
                  onError={error => setStatus(errorMessage(error))}
                  onSubmit={async () => undefined}
                  paletteSize={12}
                  roundId={revision}
                  serverNow=""
                />
              </div>
            ) : null}
            <p className="profile-inline-status" aria-live="polite">{status}</p>
          </section>
        </>
      )}

      {!user ? <p className="status-message profile-status" aria-live="polite">{status}</p> : null}
      {clearAction ? (
        <ConfirmModal
          confirmLabel="Profilkép törlése"
          message="Biztosan törlöd a teljes profilképet? A mentésig még visszavonhatod."
          onCancel={() => setClearAction(null)}
          onConfirm={() => { const action = clearAction; setClearAction(null); action() }}
          title="Törlöd a profilképet?"
        />
      ) : null}
    </section>
  )
}
