import { useEffect, useRef } from 'react'

export function WeeklyArtwork({ pixels, label }: { pixels: string[]; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, 32, 32)
    pixels.forEach((color, index) => {
      if (color === 'transparent') return
      context.fillStyle = color
      context.fillRect(index % 32, Math.floor(index / 32), 1, 1)
    })
  }, [pixels])

  return <canvas aria-label={label} className="weekly-artwork" height={32} ref={canvasRef} role="img" width={32} />
}
