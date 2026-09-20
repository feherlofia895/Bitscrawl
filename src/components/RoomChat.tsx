import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { RoomMessage } from '../lib/lobby'
import type { RoomPlayer } from '../lib/lobby'
import { parseAvatarPixels } from '../lib/profile'
import { ProfilePreviewButton } from './ProfilePreviewButton'

type RoomChatProps = {
  messages: RoomMessage[]
  onError: (error: unknown) => void
  onSubmit: (message: string) => Promise<number>
  players: RoomPlayer[]
}

export function RoomChat({ messages, onError, onSubmit, players }: RoomChatProps) {
  const initialMobile = window.matchMedia('(max-width: 760px)').matches
  const [message, setMessage] = useState(
    () => window.sessionStorage.getItem('bitscrawl-room-chat-draft') ?? '',
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMobile, setIsMobile] = useState(initialMobile)
  const [isOpen, setIsOpen] = useState(
    () =>
      !initialMobile ||
      window.sessionStorage.getItem('bitscrawl-room-chat-open') === 'true',
  )
  const [unreadCount, setUnreadCount] = useState(0)
  const messageListRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(messages.length)
  const isOpenRef = useRef(isOpen)
  const isMobileRef = useRef(initialMobile)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const updateLayout = () => {
      const nextIsMobile = media.matches
      if (isMobileRef.current === nextIsMobile) return

      isMobileRef.current = nextIsMobile
      setIsMobile(nextIsMobile)
      setIsOpen(!nextIsMobile)
      if (!nextIsMobile) setUnreadCount(0)
    }

    updateLayout()
    media.addEventListener('change', updateLayout)
    return () => media.removeEventListener('change', updateLayout)
  }, [])

  const openPanel = useCallback(() => {
    if (isMobile && window.history.state?.bitscrawlPanel !== 'room-chat') {
      window.history.pushState({ bitscrawlPanel: 'room-chat' }, '')
    }
    window.sessionStorage.setItem('bitscrawl-room-chat-open', 'true')
    setIsOpen(true)
    setUnreadCount(0)
  }, [isMobile])

  const closePanel = useCallback(() => {
    window.sessionStorage.setItem('bitscrawl-room-chat-open', 'false')
    setIsOpen(false)
    if (isMobile && window.history.state?.bitscrawlPanel === 'room-chat') {
      window.history.back()
    }
  }, [isMobile])

  useEffect(() => {
    const handlePopState = () => {
      if (isOpenRef.current && isMobile) {
        window.sessionStorage.setItem('bitscrawl-room-chat-open', 'false')
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpenRef.current && isMobile) closePanel()
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closePanel, isMobile])

  useEffect(() => {
    const list = messageListRef.current
    if (list) list.scrollTop = list.scrollHeight

    const newMessageCount = Math.max(
      0,
      messages.length - previousMessageCountRef.current,
    )
    if (isMobile && !isOpen && newMessageCount > 0) {
      setUnreadCount((count) => count + newMessageCount)
    }
    previousMessageCountRef.current = messages.length
  }, [isMobile, isOpen, messages])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanMessage = message.trim()
    if (!cleanMessage || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onSubmit(cleanMessage)
      setMessage('')
      window.sessionStorage.removeItem('bitscrawl-room-chat-draft')
    } catch (error) {
      onError(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const playerProfile = (userId: string) => players.find((player) => player.user_id === userId)

  const chatPanel = (
    <section
      aria-labelledby="room-chat-title"
      aria-modal={isMobile && isOpen ? 'true' : undefined}
      className={`room-chat${isOpen ? ' is-open' : ''}`}
      role={isMobile ? 'dialog' : undefined}
    >
      <div className="round-chat-heading">
        <div>
          <p className="round-label">A teljes szobának</p>
          <h3 id="room-chat-title">Szobachat</h3>
        </div>
        <div className="chat-heading-actions">
          <span>{messages.length} üzenet</span>
          <button
            aria-label="Chat bezárása"
            className="chat-close-button"
            onClick={closePanel}
            type="button"
          >
            ×
          </button>
        </div>
      </div>

      <div aria-live="polite" className="round-message-list" ref={messageListRef}>
        {messages.length === 0 ? (
          <p className="empty-chat">Még nincs üzenet. Köszönj a többieknek!</p>
        ) : (
          messages.map((roomMessage) => {
            const sender = playerProfile(roomMessage.sender_user_id)
            const senderName = sender?.display_name ?? 'Játékos'
            return <p className="round-message" key={roomMessage.id}>
              <ProfilePreviewButton className="chat-profile-trigger" name={senderName} pixels={parseAvatarPixels(sender?.avatar_pixels ?? null)}>
                <strong>{senderName}</strong>
              </ProfilePreviewButton>
              <span>{roomMessage.content}</span>
            </p>
          })
        )}
      </div>

      <form className="chat-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="visually-hidden" htmlFor="room-chat-message">
          Szobaüzenet
        </label>
        <input
          autoComplete="off"
          disabled={isSubmitting}
          id="room-chat-message"
          maxLength={500}
          onChange={(event) => {
            setMessage(event.target.value)
            window.sessionStorage.setItem(
              'bitscrawl-room-chat-draft',
              event.target.value,
            )
          }}
          placeholder="Írj a szobának…"
          type="text"
          value={message}
        />
        <button disabled={isSubmitting || !message.trim()} type="submit">
          {isSubmitting ? 'Küldés…' : 'Küldés'}
        </button>
      </form>
    </section>
  )

  if (!isMobile) return chatPanel

  return createPortal(
    <>
      <button
        aria-expanded={isOpen}
        className="mobile-chat-toggle"
        onClick={openPanel}
        type="button"
      >
        Szobachat
        {unreadCount > 0 ? (
          <span aria-label={`${unreadCount} olvasatlan üzenet`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {isMobile && isOpen ? (
        <div aria-hidden="true" className="chat-sheet-backdrop" />
      ) : null}
      {chatPanel}
    </>,
    document.body,
  )
}
