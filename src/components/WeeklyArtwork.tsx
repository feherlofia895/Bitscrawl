import { useEffect, useRef } from 'react'

export function WeeklyArtwork({ pixels, label }: { pixels: string[]; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inferredSize = Math.sqrt(pixels.length)
  const canvasSize = Number.isInteger(inferredSize) && inferredSize > 0 ? inferredSize : 32

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvasSize, canvasSize)
    pixels.forEach((color, index) => {
      if (color === 'transparent') return
      context.fillStyle = color
      context.fillRect(index % canvasSize, Math.floor(index / canvasSize), 1, 1)
    })
  }, [canvasSize, pixels])

  return <canvas aria-label={label} className="weekly-artwork" height={canvasSize} ref={canvasRef} role="img" width={canvasSize} />
}
