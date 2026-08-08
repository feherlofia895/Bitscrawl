import { useEffect, useRef, useState } from 'react'

type RoundTransitionTimerProps = {
  nextRoundAt: string
  onReady: () => void
  roundId: number
  serverNow: string
}

export function RoundTransitionTimer({
  nextRoundAt,
  onReady,
  roundId,
  serverNow,
}: RoundTransitionTimerProps) {
  const initialSeconds = Math.max(
    0,
    Math.ceil((Date.parse(nextRoundAt) - Date.parse(serverNow)) / 1_000),
  )
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const remainingMilliseconds = Math.max(
      0,
      Date.parse(nextRoundAt) - Date.parse(serverNow),
    )
    const startedAt = performance.now()
    let transitionRequested = false

    const updateTimer = () => {
      const nextMilliseconds = Math.max(
        0,
        remainingMilliseconds - (performance.now() - startedAt),
      )
      setSecondsLeft(Math.ceil(nextMilliseconds / 1_000))

      if (nextMilliseconds === 0 && !transitionRequested) {
        transitionRequested = true
        onReadyRef.current()
      }
    }

    updateTimer()
    const intervalId = window.setInterval(updateTimer, 200)
    return () => window.clearInterval(intervalId)
  }, [nextRoundAt, roundId, serverNow])

  return (
    <div className="round-transition" role="status">
      <span>Következő kör</span>
      <strong>{secondsLeft}</strong>
    </div>
  )
}
