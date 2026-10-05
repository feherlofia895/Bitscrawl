import { useMemo, useState } from 'react'
import {
  hexToHsla,
  hslaToHex,
  normalizeHexColor,
  type HslaColor,
} from '../lib/colorMixer'

const sliderFields: Array<{
  key: keyof HslaColor
  label: string
  max: number
  suffix: string
}> = [
  { key: 'saturation', label: 'S · Telítettség', max: 100, suffix: '%' },
  { key: 'lightness', label: 'L · Világosság', max: 100, suffix: '%' },
  { key: 'alpha', label: 'A · Alfa / fedettség', max: 100, suffix: '%' },
]

export function ColorMixer({
  activeColor,
  onClose,
  onSave,
  onUse,
}: {
  activeColor: string
  onClose: () => void
  onSave: (color: string) => void
  onUse: (color: string) => void
}) {
  const initialColor = normalizeHexColor(activeColor, '#d3493b')
  const [hsla, setHsla] = useState(() => ({ ...hexToHsla(initialColor), alpha: 100 }))
  const mixedColor = useMemo(() => hslaToHex(hsla), [hsla])

  const sliderBackground = (field: keyof HslaColor) => {
    const color = `hsl(${hsla.hue} ${hsla.saturation}% ${hsla.lightness}%)`
    if (field === 'saturation') {
      return `linear-gradient(to right, hsl(${hsla.hue} 0% ${hsla.lightness}%), hsl(${hsla.hue} 100% ${hsla.lightness}%))`
    }
    if (field === 'lightness') {
      return `linear-gradient(to right, #000, hsl(${hsla.hue} ${hsla.saturation}% 50%), #fff)`
    }
    return `linear-gradient(to right, transparent, ${color})`
  }

  return (
    <section aria-labelledby="color-mixer-title" className="color-mixer-panel">
      <div className="color-mixer-heading">
        <div>
          <span>Szerkesztő és kihívások</span>
          <h4 id="color-mixer-title">Színkeverő</h4>
        </div>
        <button aria-label="Színkeverő bezárása" onClick={onClose} type="button">×</button>
      </div>
      <label className="color-mixer-spectrum">
        <span>Színskála · H árnyalat: <strong>{hsla.hue}°</strong></span>
        <input
          aria-label="H · Árnyalat"
          max="359"
          min="0"
          onChange={event => setHsla(current => ({
            ...current,
            hue: Number(event.target.value),
          }))}
          type="range"
          value={hsla.hue}
        />
      </label>
      <div aria-label="HSL és alfa finomhangolás" className="color-mixer-hsla">
        {sliderFields.map(field => (
          <label key={field.key}>
            <span>{field.label}: <strong>{hsla[field.key]}{field.suffix}</strong></span>
            <input
              aria-label={field.label}
              max={field.max}
              min="0"
              onChange={event => setHsla(current => ({
                ...current,
                [field.key]: Number(event.target.value),
              }))}
              style={{ background: sliderBackground(field.key) }}
              type="range"
              value={hsla[field.key]}
            />
          </label>
        ))}
      </div>
      <div className="color-mixer-footer">
        <div className="color-mixer-result">
          <span aria-hidden="true" className="color-mixer-result-swatch">
            <i style={{ backgroundColor: mixedColor }} />
          </span>
          <div>
            <small>Kikevert szín</small>
            <strong>{mixedColor}</strong>
          </div>
        </div>
        <div className="color-mixer-actions">
          <button onClick={() => onUse(mixedColor)} type="button">Használom</button>
          <button
            aria-label="Mentés a saját színekhez"
            className="color-mixer-save-button"
            onClick={() => onSave(mixedColor)}
            title="Mentés a saját színekhez"
            type="button"
          >Mentés</button>
        </div>
      </div>
    </section>
  )
}
