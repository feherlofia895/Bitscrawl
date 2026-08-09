import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RoomMessage } from '../lib/lobby'
import type { RoomPlayer } from '../lib/lobby'

type RoomChatProps = {
  messages: RoomMessage[]
  onError: (error: unknown) => void
  onSubmit: (message: string) => Promise<number>
  players: RoomPlayer[]
}

export function RoomChat({ messages, onError, onSubmit, players }: RoomChatProps) {
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const messageListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = messageListRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanMessage = message.trim()
    if (!cleanMessage || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onSubmit(cleanMessage)
      setMessage('')
    } catch (error) {
      onError(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const playerName = (userId: string) =>
    players.find((player) => player.user_id === userId)?.display_name ??
    'Játékos'

  return (
    <section className="room-chat" aria-labelledby="room-chat-title">
      <div className="round-chat-heading">
        <div>
          <p className="round-label">A teljes szobának</p>
          <h3 id="room-chat-title">Szobachat</h3>
        </div>
        <span>{messages.length} üzenet</span>
      </div>

      <div aria-live="polite" className="round-message-list" ref={messageListRef}>
        {messages.length === 0 ? (
          <p className="empty-chat">Még nincs üzenet. Köszönj a többieknek!</p>
        ) : (
          messages.map((roomMessage) => (
            <p className="round-message" key={roomMessage.id}>
              <strong>{playerName(roomMessage.sender_user_id)}</strong>
              <span>{roomMessage.content}</span>
            </p>
          ))
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
          onChange={(event) => setMessage(event.target.value)}
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
}
