import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  getGlobalLobbyUnreadCount,
  loadGlobalLobbyMessages,
  markGlobalLobbyRead,
  sendGlobalLobbyMessage,
  subscribeToGlobalLobbyMessages,
  subscribeToOnlineProfiles,
  type GlobalLobbyConnectionStatus,
  type GlobalLobbyMessage,
  type OnlineProfile,
} from '../lib/globalLobby'
import { loadOwnProfile, type PlayerProfile } from '../lib/profile'
import { supabase } from '../lib/supabase'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfilePreviewButton } from './ProfilePreviewButton'

type Identity = {
  userId: string
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

const connectionLabels: Record<GlobalLobbyConnectionStatus, string> = {
  connected: 'Online',
  connecting: 'Kapcsolódás…',
  offline: 'Nincs kapcsolat',
  reconnecting: 'Újracsatlakozás…',
}

export function ActiveUsers({
  currentProfile,
}: {
  currentProfile: PlayerProfile | null
}) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [onlineProfiles, setOnlineProfiles] = useState<OnlineProfile[]>([])
  const [messages, setMessages] = useState<GlobalLobbyMessage[]>([])
  const [connectionStatus, setConnectionStatus] = useState<GlobalLobbyConnectionStatus>('connecting')
  const [isOpen, setIsOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState('')
  const messageListRef = useRef<HTMLDivElement>(null)
  const isOpenRef = useRef(false)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const refreshIdentity = useCallback(async () => {
    try {
      const { profile, user } = await loadOwnProfile()
      setIdentity(profile && user ? { userId: user.id } : null)
    } catch {
      setIdentity(null)
    }
  }, [])

  useEffect(() => {
    void refreshIdentity()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => { void refreshIdentity() }, 0)
    })
    return () => subscription.unsubscribe()
  }, [currentProfile, refreshIdentity])

  const identityUserId = identity?.userId ?? null

  useEffect(() => {
    if (!identityUserId) {
      setOnlineProfiles([])
      setMessages([])
      setUnreadCount(0)
      setConnectionStatus('offline')
      setIsOpen(false)
      return
    }

    setConnectionStatus('connecting')
    const handleError = (error: Error) => setFeedback(error.message)
    const unsubscribePresence = subscribeToOnlineProfiles({
      onError: handleError,
      onProfiles: setOnlineProfiles,
      onStatus: setConnectionStatus,
    })

    const refreshMessages = async () => {
      try {
        setMessages(await loadGlobalLobbyMessages())
        if (isOpenRef.current) {
          await markGlobalLobbyRead()
          setUnreadCount(0)
        } else {
          setUnreadCount(await getGlobalLobbyUnreadCount())
        }
      } catch (error) {
        handleError(error instanceof Error ? error : new Error('A chat most nem érhető el.'))
      }
    }
    void refreshMessages()
    const unsubscribeMessages = subscribeToGlobalLobbyMessages(() => { void refreshMessages() })

    return () => {
      unsubscribePresence()
      unsubscribeMessages()
    }
  }, [identityUserId])

  useEffect(() => {
    if (!isOpen || !identityUserId) return
    setUnreadCount(0)
    void markGlobalLobbyRead().catch(error => {
      setFeedback(error instanceof Error ? error.message : 'Az olvasottságot nem sikerült menteni.')
    })
  }, [identityUserId, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const list = messageListRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [isOpen, messages])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const clean = message.trim()
    if (!clean || isSending) return

    setIsSending(true)
    setFeedback('')
    try {
      await sendGlobalLobbyMessage(clean)
      setMessage('')
      setMessages(await loadGlobalLobbyMessages())
      await markGlobalLobbyRead()
      setUnreadCount(0)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Az üzenetet nem sikerült elküldeni.')
    } finally {
      setIsSending(false)
    }
  }

  return <>
    {identity ? <button
      aria-label={`Aktív felhasználók${unreadCount ? `, ${unreadCount} új előszoba-chat üzenet` : ''}`}
      className="bug-report-trigger active-users-trigger"
      onClick={() => { setFeedback(''); setIsOpen(true) }}
      type="button"
    >
      Aktívak{identity ? ` · ${onlineProfiles.length}` : ''}
      {unreadCount ? <span aria-hidden="true" className="active-users-unread">!</span> : null}
    </button> : null}
    {isOpen && identity ? createPortal(
      <div className="active-users-backdrop" onMouseDown={event => {
        if (event.target === event.currentTarget) setIsOpen(false)
      }}>
        <section aria-labelledby="active-users-title" aria-modal="true" className="active-users-panel" role="dialog">
          <header className="active-users-heading">
            <div>
              <p className="step-label">Közösségi előszoba</p>
              <h2 id="active-users-title">Aktív felhasználók</h2>
            </div>
            <div className="active-users-heading-actions">
              {identity ? <span className={`active-users-connection is-${connectionStatus}`}>{connectionLabels[connectionStatus]}</span> : null}
              <button aria-label="Aktív felhasználók bezárása" onClick={() => setIsOpen(false)} type="button">×</button>
            </div>
          </header>

          <div className="active-users-layout">
            <section className="online-profile-section" aria-labelledby="online-profile-title">
              <div className="active-users-section-heading">
                <h3 id="online-profile-title">Most online</h3>
                <span>{onlineProfiles.length}</span>
              </div>
              {onlineProfiles.length ? <ul className="online-profile-list">
                {onlineProfiles.map(profile => <li key={profile.userId}>
                  <ProfilePreviewButton className="online-profile-button" name={profile.displayName} pixels={profile.avatarPixels}>
                    <ProfileAvatar label={`${profile.displayName} profilképe`} pixels={profile.avatarPixels} />
                    <span><strong>{profile.displayName}</strong><small>online</small></span>
                  </ProfilePreviewButton>
                </li>)}
              </ul> : <p className="active-users-empty">Kapcsolódás az előszobához…</p>}
            </section>

            <section className="global-lobby-chat" aria-labelledby="global-lobby-chat-title">
              <div className="active-users-section-heading">
                <h3 id="global-lobby-chat-title">Előszoba-chat</h3>
                <span>{messages.length} üzenet</span>
              </div>
              <div aria-live="polite" className="global-lobby-message-list" ref={messageListRef} role="log">
                {messages.length ? messages.map(chatMessage => <article className={chatMessage.isOwn ? 'is-own' : ''} key={chatMessage.messageId}>
                  <div>
                    <ProfilePreviewButton className="global-chat-author" name={chatMessage.authorName} pixels={chatMessage.authorAvatar}>
                      <ProfileAvatar label={`${chatMessage.authorName} profilképe`} pixels={chatMessage.authorAvatar} />
                      <strong>{chatMessage.authorName}</strong>
                    </ProfilePreviewButton>
                    <time dateTime={chatMessage.createdAt}>{timeLabel(chatMessage.createdAt)}</time>
                  </div>
                  <p>{chatMessage.content}</p>
                </article>) : <p className="active-users-empty">Még nincs üzenet. Köszönj elsőként!</p>}
              </div>
              <form className="global-lobby-chat-form" onSubmit={event => { void handleSubmit(event) }}>
                <label>
                  <span className="visually-hidden">Üzenet az előszoba-chatbe</span>
                  <input autoComplete="off" disabled={isSending} maxLength={500} onChange={event => setMessage(event.target.value)} placeholder="Na mi van?" value={message} />
                </label>
                <button disabled={isSending || !message.trim()} type="submit">{isSending ? 'Küldés…' : 'Küldés'}</button>
              </form>
            </section>
          </div>

          {feedback ? <p aria-live="polite" className="active-users-feedback">{feedback}</p> : null}
        </section>
      </div>,
      document.body,
    ) : null}
  </>
}
