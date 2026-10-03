import { useEffect, useState } from 'react'
import { nextAnimationFrame } from '../lib/editorAnimation'
import { WeeklyArtwork } from './WeeklyArtwork'

export function EditorAnimationThumbnail({ fps, frames, label }: {
  fps: number
  frames: string[][]
  label: string
}) {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    setFrameIndex(0)
    if (frames.length < 2) return
    const interval = window.setInterval(() => {
      setFrameIndex(index => nextAnimationFrame(index, frames.length))
    }, 1000 / fps)
    return () => window.clearInterval(interval)
  }, [fps, frames])

  return <WeeklyArtwork label={label} pixels={frames[frameIndex] ?? frames[0]} />
}
