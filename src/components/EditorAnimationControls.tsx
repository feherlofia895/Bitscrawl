import { Fragment, useEffect, useState, type CSSProperties } from 'react'
import {
  EDITOR_ANIMATION_FRAME_LIMIT,
  EDITOR_ANIMATION_MAX_FPS,
  EDITOR_ANIMATION_MIN_FPS,
  nextAnimationFrame,
} from '../lib/editorAnimation'
import type {
  EditorProjectFrame,
  EditorProjectLayerIndex,
  EditorProjectLayerVisibility,
} from '../lib/editorProject'
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

function LayerVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" shapeRendering="crispEdges" viewBox="0 0 16 16">
      <path d="M1 7h2V5h2V3h6v2h2v2h2v2h-2v2h-2v2H5v-2H3V9H1V7Zm4 0v2h2v2h2V9h2V7H9V5H7v2H5Z" fill="currentColor" />
      {!visible ? <path d="M2 1h2v2h2v2h2v2h2v2h2v2h2v2h-2v-2h-2V9H8V7H6V5H4V3H2V1Z" fill="currentColor" /> : null}
    </svg>
  )
}

export function EditorAnimationControls({
  activeFrameIndex,
  activeLayerIndex,
  allowAnimation,
  fps,
  frames,
  layerVisibility,
  onionSkin,
  projectFrames,
  onAddFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onFpsChange,
  onMoveLayer,
  onOnionSkinChange,
  onSelectCell,
  onToggleLayerVisibility,
}: {
  activeFrameIndex: number
  activeLayerIndex: EditorProjectLayerIndex
  allowAnimation: boolean
  fps: number
  frames: string[][]
  layerVisibility: EditorProjectLayerVisibility
  onionSkin: boolean
  projectFrames: EditorProjectFrame[]
  onAddFrame: () => void
  onDeleteFrame: () => void
  onDuplicateFrame: () => void
  onFpsChange: (fps: number) => void
  onMoveLayer: (direction: -1 | 1) => void
  onOnionSkinChange: (active: boolean) => void
  onSelectCell: (frameIndex: number, layerIndex: EditorProjectLayerIndex) => void
  onToggleLayerVisibility: (layerIndex: EditorProjectLayerIndex) => void
}) {
  const [playing, setPlaying] = useState(false)
  const [previewFrameIndex, setPreviewFrameIndex] = useState(activeFrameIndex)
  const visibleFrames = allowAnimation ? frames : frames.slice(0, 1)
  const visibleProjectFrames = allowAnimation ? projectFrames : projectFrames.slice(0, 1)
  const layerIndexes = [2, 1, 0] as const

  useEffect(() => {
    if (!playing) setPreviewFrameIndex(activeFrameIndex)
  }, [activeFrameIndex, playing])

  useEffect(() => {
    if (!playing || visibleFrames.length < 2) return
    const interval = window.setInterval(() => {
      setPreviewFrameIndex(index => nextAnimationFrame(index, visibleFrames.length))
    }, 1000 / fps)
    return () => window.clearInterval(interval)
  }, [fps, playing, visibleFrames.length])

  useEffect(() => {
    if (!allowAnimation || visibleFrames.length < 2) setPlaying(false)
    setPreviewFrameIndex(index => Math.min(index, visibleFrames.length - 1))
  }, [allowAnimation, visibleFrames.length])

  const gridStyle = { '--editor-frame-count': visibleFrames.length } as CSSProperties

  return (
    <section className="editor-animation-controls" aria-label="Réteg- és képkockaszerkesztő">
      {allowAnimation ? (
        <div className="editor-animation-heading is-compact">
          <div className="editor-animation-preview">
            <WeeklyArtwork label="Animáció előnézete" pixels={visibleFrames[previewFrameIndex] ?? visibleFrames[0]} />
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
              disabled={visibleFrames.length < 2}
              onClick={() => setPlaying(value => !value)}
              title={playing ? 'Szünet' : 'Lejátszás'}
              type="button"
            >
              <AnimationPlayIcon paused={playing} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="editor-timeline-scroll" role="group" aria-label="Réteg- és képkockarács">
        <div className="editor-timeline-grid" style={gridStyle}>
          <div aria-hidden="true" className="editor-timeline-corner">R / K</div>
          {visibleFrames.map((_, frameIndex) => (
            <button
              aria-label={`${frameIndex + 1}. képkocka kiválasztása`}
              aria-pressed={activeFrameIndex === frameIndex}
              className="editor-timeline-frame-heading"
              key={`frame-${frameIndex}`}
              onClick={() => onSelectCell(frameIndex, activeLayerIndex)}
              type="button"
            >{frameIndex + 1}</button>
          ))}
          {layerIndexes.map(layerIndex => {
            const layerNumber = layerIndex + 1
            const visible = layerVisibility[layerIndex]
            return (
              <Fragment key={`layer-${layerIndex}`}>
                <div className="editor-timeline-layer-heading" data-active={activeLayerIndex === layerIndex}>
                  <button
                    aria-label={`${layerNumber}. réteg kiválasztása`}
                    aria-pressed={activeLayerIndex === layerIndex}
                    className="editor-timeline-layer-number"
                    onClick={() => onSelectCell(activeFrameIndex, layerIndex)}
                    type="button"
                  >{layerNumber}</button>
                  <button
                    aria-label={`${layerNumber}. réteg ${visible ? 'elrejtése' : 'megjelenítése'}`}
                    aria-pressed={visible}
                    className="editor-timeline-layer-visibility"
                    onClick={() => onToggleLayerVisibility(layerIndex)}
                    title={visible ? 'Elrejtés' : 'Megjelenítés'}
                    type="button"
                  >
                    <LayerVisibilityIcon visible={visible} />
                  </button>
                </div>
                {visibleProjectFrames.map((frame, frameIndex) => {
                  const selected = activeFrameIndex === frameIndex && activeLayerIndex === layerIndex
                  return (
                    <button
                      aria-label={`${layerNumber}. réteg, ${frameIndex + 1}. képkocka szerkesztése`}
                      aria-pressed={selected}
                      className="editor-timeline-cell"
                      data-active-frame={activeFrameIndex === frameIndex}
                      data-active-layer={activeLayerIndex === layerIndex}
                      data-visible={visible}
                      key={`${layerIndex}-${frameIndex}`}
                      onClick={() => onSelectCell(frameIndex, layerIndex)}
                      type="button"
                    >
                      <WeeklyArtwork
                        label={`${layerNumber}. réteg, ${frameIndex + 1}. képkocka`}
                        pixels={frame.layers[layerIndex]}
                      />
                    </button>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      </div>

      <div className="editor-timeline-footer">
        <div className="editor-layer-order-actions" aria-label="Rétegsorrend">
          <button className="editor-layer-swap" disabled={activeLayerIndex === 0} onClick={() => onMoveLayer(-1)} type="button">
            <span aria-hidden="true">↓</span> Lejjebb
          </button>
          <button className="editor-layer-swap" disabled={activeLayerIndex === 2} onClick={() => onMoveLayer(1)} type="button">
            <span aria-hidden="true">↑</span> Feljebb
          </button>
        </div>
        {allowAnimation ? (
          <div className="editor-animation-actions" aria-label="Képkockaműveletek">
            <button
              aria-label="Új képkocka"
              disabled={visibleFrames.length >= EDITOR_ANIMATION_FRAME_LIMIT}
              onClick={onAddFrame}
              title="Új képkocka"
              type="button"
            >
              <AnimationActionIcon kind="add" />
            </button>
            <button
              aria-label="Képkocka másolása"
              disabled={visibleFrames.length >= EDITOR_ANIMATION_FRAME_LIMIT}
              onClick={onDuplicateFrame}
              title="Képkocka másolása"
              type="button"
            >
              <AnimationActionIcon kind="duplicate" />
            </button>
            <button
              aria-label="Képkocka törlése"
              disabled={visibleFrames.length <= 1}
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
        ) : null}
      </div>
      {!layerVisibility[activeLayerIndex] ? (
        <p className="editor-layer-warning" role="status">A kiválasztott réteg rejtett.</p>
      ) : null}
    </section>
  )
}
