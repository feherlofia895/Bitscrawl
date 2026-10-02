const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

export function normalizeHexColor(value: string, fallback = '#000000') {
  const normalized = value.trim().toLowerCase()
  return HEX_COLOR.test(normalized) ? normalized : fallback
}

export function isHexColor(value: string) {
  return HEX_COLOR.test(value)
}

export type HslaColor = {
  hue: number
  saturation: number
  lightness: number
  alpha: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function hexToHsla(value: string): HslaColor {
  const color = normalizeHexColor(value)
  const red = channel(color, 1) / 255
  const green = channel(color, 3) / 255
  const blue = channel(color, 5) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  const lightness = (maximum + minimum) / 2
  let hue = 0

  if (delta !== 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6
    else if (maximum === green) hue = (blue - red) / delta + 2
    else hue = (red - green) / delta + 4
    hue = Math.round(hue * 60)
    if (hue < 0) hue += 360
  }

  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const alpha = color.length === 9 ? channel(color, 7) / 255 : 1
  return {
    hue,
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100),
    alpha: Math.round(alpha * 100),
  }
}

export function hslaToHex({ hue, saturation, lightness, alpha }: HslaColor) {
  const normalizedHue = ((hue % 360) + 360) % 360
  const normalizedSaturation = clamp(saturation, 0, 100) / 100
  const normalizedLightness = clamp(lightness, 0, 100) / 100
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation
  const segment = normalizedHue / 60
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1))
  const [red, green, blue] = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
      : segment < 3 ? [0, chroma, secondary]
        : segment < 4 ? [0, secondary, chroma]
          : segment < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary]
  const match = normalizedLightness - chroma / 2
  const rgb = [red, green, blue]
    .map(value => Math.round((value + match) * 255).toString(16).padStart(2, '0'))
    .join('')
  const normalizedAlpha = clamp(alpha, 0, 100)
  if (normalizedAlpha === 100) return `#${rgb}`
  const alphaHex = Math.round(normalizedAlpha / 100 * 255).toString(16).padStart(2, '0')
  return `#${rgb}${alphaHex}`
}

function channel(hex: string, offset: number) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}
