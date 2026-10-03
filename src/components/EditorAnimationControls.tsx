import { useEffect, useState } from 'react'
import {
  EDITOR_ANIMATION_FRAME_LIMIT,
  EDITOR_ANIMATION_MAX_FPS,
  EDITOR_ANIMATION_MIN_FPS,
  nextAnimationFrame,
} from '../lib/editorAnimation'
import { WeeklyArtwork } from './WeeklyArtwork'

export function EditorAnimationControls({
  activeFrameIndex,
  exporting,
  fps,
  frames,
  galleryBusy,
  onionSkin,
  onAddFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onExportGif,
  onFpsChange,
  onLoadFromGallery,
  onOnionSkinChange,
  onSaveToGallery,
  onSelectFrame,
  savedAnimationCount,
}: {
  activeFrameIndex: number
  exporting: boolean
  fps: number
  frames: string[][]
  galleryBusy: boolean
  onionSkin: boolean
  onAddFrame: () => void
  onDeleteFrame: () => void
  onDuplicateFrame: () => void
  onExportGif: () => void
  onFpsChange: (fps: number) => void
  onLoadFromGallery: () => void
  onOnionSkinChange: (active: boolean) => void
  onSaveToGallery: () => void
  onSelectFrame: (index: number) => void
  savedAnimationCount: number
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
        <div>
          <p className="step-label">Legfeljebb {EDITOR_ANIMATION_FRAME_LIMIT} képkocka</p>
          <h2 id="animation-controls-title">Animáció</h2>
          <p>Az animáció automatikusan ezen az eszközön marad meg.</p>
        </div>
        <div className="editor-animation-preview">
          <WeeklyArtwork label="Animáció előnézete" pixels={frames[previewFrameIndex] ?? frames[0]} />
          <button
            aria-pressed={playing}
            disabled={frames.length < 2}
            onClick={() => setPlaying(value => !value)}
            type="button"
          >{playing ? 'Szünet' : 'Lejátszás'}</button>
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
      <div className="editor-animation-actions">
        <button disabled={frames.length >= EDITOR_ANIMATION_FRAME_LIMIT} onClick={onAddFrame} type="button">Új képkocka</button>
        <button disabled={frames.length >= EDITOR_ANIMATION_FRAME_LIMIT} onClick={onDuplicateFrame} type="button">Képkocka másolása</button>
        <button disabled={frames.length <= 1} onClick={onDeleteFrame} type="button">Képkocka törlése</button>
        <label>
          <span>Sebesség: {fps} kép/mp</span>
          <input
            max={EDITOR_ANIMATION_MAX_FPS}
            min={EDITOR_ANIMATION_MIN_FPS}
            onChange={event => onFpsChange(Number(event.target.value))}
            type="range"
            value={fps}
          />
        </label>
        <label className="editor-animation-onion-skin">
          <input checked={onionSkin} onChange={event => onOnionSkinChange(event.target.checked)} type="checkbox" />
          <span>Előző képkocka halványan</span>
        </label>
      </div>
      <div className="editor-animation-storage-actions">
        <button disabled={exporting} onClick={onExportGif} type="button">
          {exporting ? 'GIF készítése…' : 'GIF export · 256×256'}
        </button>
        <button disabled={galleryBusy} onClick={onSaveToGallery} type="button">
          Mentés az animációs galériába
        </button>
        <button disabled={galleryBusy} onClick={onLoadFromGallery} type="button">
          Betöltés ({savedAnimationCount}/2)
        </button>
        <small>A GIF a részben áttetsző színeket 50% alatt teljesen átlátszóként menti.</small>
      </div>
    </section>
  )
}
