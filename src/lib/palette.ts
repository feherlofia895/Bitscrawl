export type PaletteSize = 8 | 16

export type PaletteColor = {
  hex: string
  name: string
}

export const basePalette: PaletteColor[] = [
  { hex: '#241a35', name: 'Tintafekete' },
  { hex: '#f7f3e8', name: 'Papírfehér' },
  { hex: '#9b7ede', name: 'Ibolya' },
  { hex: '#4ecdc4', name: 'Menta' },
  { hex: '#ffd166', name: 'Mézsárga' },
  { hex: '#ff6b6b', name: 'Korall' },
  { hex: '#4d96ff', name: 'Kék' },
  { hex: '#7b8794', name: 'Palaszürke' },
]

export const shadowPalette: PaletteColor[] = [
  { hex: '#120d1c', name: 'Mély tinta' },
  { hex: '#c9c1ad', name: 'Papírárnyék' },
  { hex: '#6446a6', name: 'Ibolyaárnyék' },
  { hex: '#247f7a', name: 'Mentaárnyék' },
  { hex: '#b97818', name: 'Mézárnyék' },
  { hex: '#b83f4d', name: 'Korallárnyék' },
  { hex: '#285bb8', name: 'Kékárnyék' },
  { hex: '#4e5965', name: 'Palaárnyék' },
]

export const expandedPalette = basePalette.flatMap((color, index) => [
  shadowPalette[index],
  color,
])

export function colorsForPalette(size: PaletteSize) {
  return size === 16 ? expandedPalette : basePalette
}
