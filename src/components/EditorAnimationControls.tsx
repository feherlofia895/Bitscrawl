import { useEffect, useState } from 'react'
import {
  EDITOR_ANIMATION_FRAME_LIMIT,
  EDITOR_ANIMATION_MAX_FPS,
  EDITOR_ANIMATION_MIN_FPS,
  nextAnimationFrame,
} from '../lib/editorAnimation'
import { WeeklyArtwork } from './WeeklyArtwork'

function AnimationPlayIcon({ paused }: { paused: boolean }) {
  return (
    <svg aria-hidden="true" shapeRendering="crispEdges" viewBox="0 0 16 16">
      {paused
        ? <path d="M3 2h4v12H3V2Zm6 0h4v12H9V2Z" fill="currentColor" />
        : <path d="M3 2h3v2h3v2h3v1h2v2h-2v1H9v2H6v2H3V2Z" fill="currentColor" />}
    </svg>
  )
}

function AnimationActionIcon({ kind }: { kind: 'add' | 'duplicate' | 'onion' | 'remove' }) {
  return (
    <svg aria-hidden="true" shapeRendering="crispEdges" viewBox="0 0 16 16">
      {kind === 'add' ? <path d="M2 2h9v2H4v8h8V8h2v6H2V2Zm10 0h2v3h2v2h-2v3h-2V7H9V5h3V2Z" fill="currentColor" /> : null}
      {kind === 'duplicate' ? <path d="M2 2h9v3h3v9H5v-3H2V2Zm2 2v5h1V5h4V4H4Zm3 3v5h5V7H7Z" fill="currentColor" /> : null}
      {kind === 'remove' ? <path d="M5 1h6v2h3v2h-1v9H3V5H2V3h3V1Zm1 2h4V2H6v1ZM5 5v7h2V5H5Zm4 0v7h2V5H9Z" fill="currentColor" /> : null}
      {kind === 'onion' ? <>
        <path d="M1 1h10v10H1V1Zm2 2v6h6V3H3Z" fill="currentColor" opacity=".45" />
        <path d="M5 5h10v10H5V5Zm2 2v6h6V7H7Z" fill="currentColor" />
      </> : null}
    </svg>
  )
}

export function EditorAnimationControls({
  activeFrameIndex,
  fps,
  frames,
  onionSkin,
  onAddFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onFpsChange,
  onOnionSkinChange,
  onSelectFrame,
}: {
  activeFrameIndex: number
  fps: number
  frames: string[][]
  onionSkin: boolean
  onAddFrame: () => void
  onDeleteFrame: () => void
  onDuplicateFrame: () => void
  onFpsChange: (fps: number) => void
  onOnionSkinChange: (active: boolean) => void
  onSelectFrame: (index: number) => void
}) {
  const [playing, setPlaying] = useState(false)
  const [previewFrameIndex, setPreviewFrameIndex] = useState(activeFrameIndex)

  useEffect(() => {
    if (!playing) setPreviewFrameIndex(activeFrameIndex)
  }, [activeFrameIndex, playing])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const interval = window.setInterval(() => {
      setPreviewFrameIndex(index => nextAnimationFrame(index, frames.length))
    }, 1000 / fps)
    return () => window.clearInterval(interval)
  }, [fps, frames.length, playing])

  useEffect(() => {
    if (frames.length < 2) setPlaying(false)
    setPreviewFrameIndex(index => Math.min(index, frames.length - 1))
  }, [frames.length])

  return (
    <section className="editor-animation-controls" aria-labelledby="animation-controls-title">
      <div className="editor-animation-heading">
        <div className="editor-animation-heading-copy">
          <p className="step-label">Legfeljebb {EDITOR_ANIMATION_FRAME_LIMIT} képkocka</p>
          <h2 id="animation-controls-title">Képkockák</h2>
          <p>Egy képkocka állókép; kettőtől lejátszható animáció.</p>
        </div>
        <div className="editor-animation-preview">
          <WeeklyArtwork label="Animáció előnézete" pixels={frames[previewFrameIndex] ?? frames[0]} />
          <label className="editor-animation-speed">
            <span>Sebesség</span>
            <select
              aria-label="Animáció sebessége"
              onChange={event => onFpsChange(Number(event.target.value))}
              value={fps}
            >
              {Array.from(
                { length: EDITOR_ANIMATION_MAX_FPS - EDITOR_ANIMATION_MIN_FPS + 1 },
                (_, index) => EDITOR_ANIMATION_MIN_FPS + index,
              ).map(value => <option key={value} value={value}>{value} kép/mp</option>)}
            </select>
          </label>
          <button
            aria-label={playing ? 'Animáció szüneteltetése' : 'Animáció lejátszása'}
            aria-pressed={playing}
            className="editor-animation-play-button"
            disabled={frames.length < 2}
            onClick={() => setPlaying(value => !value)}
            title={playing ? 'Szünet' : 'Lejátszás'}
            type="button"
          >
            <AnimationPlayIcon paused={playing} />
          </button>
        </div>
      </div>
      <div className="editor-animation-frames" aria-label="Animáció képkockái">
        {frames.map((frame, index) => (
          <button
            aria-label={`${index + 1}. képkocka szerkesztése`}
            aria-pressed={activeFrameIndex === index}
            className="editor-animation-frame"
            key={index}
            onClick={() => onSelectFrame(index)}
            type="button"
          >
            <WeeklyArtwork label={`${index + 1}. képkocka`} pixels={frame} />
            <span>{index + 1}.</span>
          </button>
        ))}
      </div>
      <div className="editor-animation-actions" aria-label="Képkockaműveletek">
        <button
          aria-label="Új képkocka"
          disabled={frames.length >= EDITOR_ANIMATION_FRAME_LIMIT}
          onClick={onAddFrame}
          title="Új képkocka"
          type="button"
        >
          <AnimationActionIcon kind="add" />
        </button>
        <button
          aria-label="Képkocka másolása"
          disabled={frames.length >= EDITOR_ANIMATION_FRAME_LIMIT}
          onClick={onDuplicateFrame}
          title="Képkocka másolása"
          type="button"
        >
          <AnimationActionIcon kind="duplicate" />
        </button>
        <button
          aria-label="Képkocka törlése"
          disabled={frames.length <= 1}
          onClick={onDeleteFrame}
          title="Képkocka törlése"
          type="button"
        >
          <AnimationActionIcon kind="remove" />
        </button>
        <button
          aria-label="Előző képkocka halványan"
          aria-pressed={onionSkin}
          className="editor-animation-onion-skin"
          onClick={() => onOnionSkinChange(!onionSkin)}
          title="Előző képkocka halványan"
          type="button"
        >
          <AnimationActionIcon kind="onion" />
        </button>
      </div>
    </section>
  )
}
