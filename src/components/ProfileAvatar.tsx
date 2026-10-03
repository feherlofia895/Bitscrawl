import { useEffect, useRef } from 'react'

export function ProfileAvatar({ pixels, label, className = '' }: {
  pixels: string[] | null
  label: string
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, 32, 32)
    if (!pixels) return
    pixels.forEach((color, index) => {
      if (color === 'transparent') return
      context.fillStyle = color
      context.fillRect(index % 32, Math.floor(index / 32), 1, 1)
    })
  }, [pixels])

  return pixels ? (
    <canvas
      aria-label={label}
      className={`profile-avatar ${className}`.trim()}
      height={32}
      ref={canvasRef}
      role="img"
      width={32}
    />
  ) : (
    <span aria-label={label} className={`profile-avatar profile-avatar-empty ${className}`.trim()} role="img">
      <img alt="" aria-hidden="true" src="/icons/profile.svg" />
    </span>
  )
}
