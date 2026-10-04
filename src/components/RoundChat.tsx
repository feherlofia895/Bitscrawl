import { useEffect, useRef, useState, type FormEvent } from 'react'
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
  isImmersive: boolean
  isDrawer: boolean
  messages: RoundMessage[]
  onError: (error: unknown) => void
  onSubmit: (guess: string) => Promise<GuessResult>
  players: RoomPlayer[]
  roundId: number
}

export function RoundChat({
  currentUserId,
  isImmersive,
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
  const guessInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const layoutViewportHeightRef = useRef(0)
  const hasGuessedCorrectly =
    submittedCorrectly ||
    messages.some(
      (message) =>
        message.kind === 'correct' &&
        message.sender_user_id === currentUserId,
    )
  const canSubmitGuess = !isDrawer && !hasGuessedCorrectly
  const panelClassName = [
    'guess-panel',
    canSubmitGuess ? 'is-guessing' : '',
    isImmersive ? 'is-immersive' : '',
  ].filter(Boolean).join(' ')

  useEffect(() => {
    setGuess('')
    setSubmittedCorrectly(false)
  }, [roundId])

  useEffect(() => {
    const visualViewport = window.visualViewport
    const panel = panelRef.current
    if (!visualViewport || !panel || !canSubmitGuess) return

    let animationFrame = 0
    const updateKeyboardOffset = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        const isGuessFocused = document.activeElement === guessInputRef.current
        const layoutHeight = Math.max(
          document.documentElement.clientHeight,
          window.innerHeight,
        )

        if (!isGuessFocused) {
          layoutViewportHeightRef.current = layoutHeight
          panel.style.removeProperty('--guess-keyboard-offset')
          return
        }

        const visibleBottom = visualViewport.offsetTop + visualViewport.height
        const keyboardOffset = Math.max(
          0,
          layoutViewportHeightRef.current - visibleBottom,
        )
        panel.style.setProperty(
          '--guess-keyboard-offset',
          `${Math.round(keyboardOffset)}px`,
        )
      })
    }

    layoutViewportHeightRef.current = Math.max(
      document.documentElement.clientHeight,
      window.innerHeight,
    )
    visualViewport.addEventListener('resize', updateKeyboardOffset)
    visualViewport.addEventListener('scroll', updateKeyboardOffset)
    window.addEventListener('orientationchange', updateKeyboardOffset)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      visualViewport.removeEventListener('resize', updateKeyboardOffset)
      visualViewport.removeEventListener('scroll', updateKeyboardOffset)
      window.removeEventListener('orientationchange', updateKeyboardOffset)
      panel.style.removeProperty('--guess-keyboard-offset')
    }
  }, [canSubmitGuess])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanGuess = guess.trim()
    if (!cleanGuess || isSubmitting || isDrawer || hasGuessedCorrectly) return

    setIsSubmitting(true)

    try {
      const result = await onSubmit(cleanGuess)
      setGuess((currentGuess) => (
        currentGuess.trim() === cleanGuess ? '' : currentGuess
      ))
      if (result.is_correct) setSubmittedCorrectly(true)
    } catch (error) {
      onError(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const playerProfile = (userId: string) => players.find((player) => player.user_id === userId)

  return (
    <section className={panelClassName} aria-labelledby="round-chat-title" ref={panelRef}>
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
        <form aria-busy={isSubmitting} className="guess-form" onSubmit={(event) => void handleSubmit(event)}>
          <label className="visually-hidden" htmlFor="round-guess">
            Tipp
          </label>
          <input
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="send"
            id="round-guess"
            inputMode="text"
            maxLength={80}
            onChange={(event) => setGuess(event.target.value)}
            onBlur={() => panelRef.current?.style.removeProperty('--guess-keyboard-offset')}
            placeholder="Írd be a megfejtést…"
            ref={guessInputRef}
            spellCheck={false}
            type="text"
            value={guess}
          />
          <button
            aria-label={isSubmitting ? 'Tipp küldése folyamatban' : 'Tipp küldése'}
            disabled={isSubmitting || !guess.trim()}
            type="submit"
          >
            {isSubmitting ? (
              'Küldés…'
            ) : (
              <>
                <span className="guess-submit-long">Tipp küldése</span>
                <span aria-hidden="true" className="guess-submit-short">Küldés</span>
              </>
            )}
          </button>
        </form>
      )}
    </section>
  )
}
