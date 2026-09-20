import { useEffect, useState, type FormEvent } from 'react'
import type { RoundMessage } from '../lib/game'
import type { RoomPlayer } from '../lib/lobby'
import { parseAvatarPixels } from '../lib/profile'
import { ProfilePreviewButton } from './ProfilePreviewButton'

type GuessResult = {
  is_correct: boolean
  message_id: number | null
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

  const playerProfile = (userId: string) => players.find((player) => player.user_id === userId)

  return (
    <section className="guess-panel" aria-labelledby="round-chat-title">
      <div className="round-chat-heading">
        <div>
          <p className="round-label">Csak a szerver ellenőrzi</p>
          <h3 id="round-chat-title">Megfejtés</h3>
        </div>
        <span>{messages.length} helyes</span>
      </div>

      <div
        aria-live="polite"
        className="round-message-list"
      >
        {messages.length === 0 ? (
          <p className="empty-chat">Még senki sem fejtette meg.</p>
        ) : (
          messages.map((message) => {
            const sender = playerProfile(message.sender_user_id)
            const senderName = sender?.display_name ?? 'Játékos'
            return <p
              className="round-message correct-message"
              key={message.id}
            >
              <ProfilePreviewButton className="chat-profile-trigger" name={senderName} pixels={parseAvatarPixels(sender?.avatar_pixels ?? null)}>
                <strong>{senderName}</strong>
              </ProfilePreviewButton>
              <span>kitalálta a szót! ✓</span>
            </p>
          })
        )}
      </div>

      {isDrawer ? (
        <p className="chat-note">Rajzolóként nem küldhetsz megfejtést.</p>
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
            placeholder="Írd be a megfejtést…"
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
