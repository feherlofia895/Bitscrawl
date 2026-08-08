import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { RoundMessage } from '../lib/game'
import type { RoomPlayer } from '../lib/lobby'

type GuessResult = {
  is_correct: boolean
  message_id: number
}

type RoundChatProps = {
  currentUserId: string
  isDrawer: boolean
  messages: RoundMessage[]
  onError: (error: unknown) => void
  onSubmit: (guess: string) => Promise<GuessResult>
  players: RoomPlayer[]
  roundId: number
}

export function RoundChat({
  currentUserId,
  isDrawer,
  messages,
  onError,
  onSubmit,
  players,
  roundId,
}: RoundChatProps) {
  const [guess, setGuess] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittedCorrectly, setSubmittedCorrectly] = useState(false)
  const messageListRef = useRef<HTMLDivElement>(null)
  const hasGuessedCorrectly =
    submittedCorrectly ||
    messages.some(
      (message) =>
        message.kind === 'correct' &&
        message.sender_user_id === currentUserId,
    )

  useEffect(() => {
    setGuess('')
    setSubmittedCorrectly(false)
  }, [roundId])

  useEffect(() => {
    const list = messageListRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanGuess = guess.trim()
    if (!cleanGuess || isSubmitting || isDrawer || hasGuessedCorrectly) return

    setIsSubmitting(true)

    try {
      const result = await onSubmit(cleanGuess)
      setGuess('')
      if (result.is_correct) setSubmittedCorrectly(true)
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
    <section className="round-chat" aria-labelledby="round-chat-title">
      <div className="round-chat-heading">
        <div>
          <p className="round-label">Élő tippek</p>
          <h3 id="round-chat-title">Chat</h3>
        </div>
        <span>{messages.length} üzenet</span>
      </div>

      <div
        aria-live="polite"
        className="round-message-list"
        ref={messageListRef}
      >
        {messages.length === 0 ? (
          <p className="empty-chat">Még nincs tipp. Valaki legyen az első!</p>
        ) : (
          messages.map((message) => (
            <p
              className={
                message.kind === 'correct'
                  ? 'round-message correct-message'
                  : 'round-message'
              }
              key={message.id}
            >
              <strong>{playerName(message.sender_user_id)}</strong>
              {message.kind === 'correct' ? (
                <span>kitalálta a szót! ✓</span>
              ) : (
                <span>{message.content}</span>
              )}
            </p>
          ))
        )}
      </div>

      {isDrawer ? (
        <p className="chat-note">Rajzolóként látod a tippeket, de nem tippelhetsz.</p>
      ) : hasGuessedCorrectly ? (
        <p className="correct-guess-note">Helyes megfejtés! ✓</p>
      ) : (
        <form className="guess-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="visually-hidden" htmlFor="round-guess">
            Tipp
          </label>
          <input
            autoCapitalize="none"
            autoComplete="off"
            disabled={isSubmitting}
            id="round-guess"
            maxLength={80}
            onChange={(event) => setGuess(event.target.value)}
            placeholder="Írd be a tipped…"
            spellCheck={false}
            type="text"
            value={guess}
          />
          <button disabled={isSubmitting || !guess.trim()} type="submit">
            {isSubmitting ? 'Küldés…' : 'Tipp küldése'}
          </button>
        </form>
      )}
    </section>
  )
}
