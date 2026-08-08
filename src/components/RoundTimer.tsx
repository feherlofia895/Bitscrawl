import { useEffect, useRef, useState } from 'react'

type RoundTimerProps = {
  drawingEndsAt: string
  onExpire: () => void
  roundId: number
  serverNow: string
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function RoundTimer({
  drawingEndsAt,
  onExpire,
  roundId,
  serverNow,
}: RoundTimerProps) {
  const initialSeconds = Math.max(
    0,
    Math.ceil((Date.parse(drawingEndsAt) - Date.parse(serverNow)) / 1_000),
  )
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds)
  const onExpireRef = useRef(onExpire)

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    const remainingMilliseconds = Math.max(
      0,
      Date.parse(drawingEndsAt) - Date.parse(serverNow),
    )
    const startedAt = performance.now()
    let expirationRequested = false

    const updateTimer = () => {
      const nextMilliseconds = Math.max(
        0,
        remainingMilliseconds - (performance.now() - startedAt),
      )
      const nextSeconds = Math.ceil(nextMilliseconds / 1_000)
      setSecondsLeft(nextSeconds)

      if (nextMilliseconds === 0 && !expirationRequested) {
        expirationRequested = true
        onExpireRef.current()
      }
    }

    updateTimer()
    const intervalId = window.setInterval(updateTimer, 200)
    return () => window.clearInterval(intervalId)
  }, [drawingEndsAt, roundId, serverNow])

  return (
    <div
      aria-label={`${secondsLeft} másodperc van hátra`}
      className="round-timer"
      data-urgent={secondsLeft <= 10}
      role="timer"
    >
      <span>Hátralévő idő</span>
      <strong>{formatTime(secondsLeft)}</strong>
    </div>
  )
}
