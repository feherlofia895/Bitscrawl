import { EDITOR_PALETTE_COLOR_LIMIT } from '../lib/editorPalettes'
import type { EditorPaletteSize } from '../lib/palette'

export function ChallengePalettePicker({
  activePaletteSlot,
  customPaletteActive,
  customPalettes,
  onPaletteChange,
  onSlotChange,
  paletteSize,
  status,
}: {
  activePaletteSlot: number
  customPaletteActive: boolean
  customPalettes: Array<{ colors: string[]; name: string; slotIndex: number }>
  onPaletteChange: (value: string) => void
  onSlotChange: (slotIndex: number) => void
  paletteSize: EditorPaletteSize
  status: string
}) {
  const activePalette = customPalettes.find(palette => palette.slotIndex === activePaletteSlot)

  return (
    <fieldset className="palette-mode-fieldset editor-palette-picker challenge-palette-picker">
      <legend>Színpaletta</legend>
      <label className="editor-palette-select">
        <span>Paletta</span>
        <select
          aria-label="Paletta kiválasztása"
          onChange={event => onPaletteChange(event.target.value)}
          value={customPaletteActive ? 'custom' : String(paletteSize)}
        >
          <option value="custom">Egyéni paletta</option>
          <option value="12">12 szín · alap</option>
          <option value="32">32 szín · bővített</option>
        </select>
      </label>
      {customPaletteActive ? (
        <div className="editor-custom-palette-manager challenge-custom-palette-manager">
          <label className="editor-palette-select">
            <span>Saját paletta</span>
            <select
              aria-label="Saját paletta kiválasztása"
              onChange={event => onSlotChange(Number(event.target.value))}
              value={activePaletteSlot}
            >
              {customPalettes.map(palette => (
                <option key={palette.slotIndex} value={palette.slotIndex}>
                  {palette.name || `Saját paletta ${palette.slotIndex}`} · {palette.colors.length}/{EDITOR_PALETTE_COLOR_LIMIT}
                </option>
              ))}
            </select>
          </label>
          <small aria-live="polite">
            {activePalette?.colors.length ?? 0}/{EDITOR_PALETTE_COLOR_LIMIT} szín · {status}
          </small>
        </div>
      ) : null}
    </fieldset>
  )
}
