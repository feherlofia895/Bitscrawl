export type PaletteSize = 8 | 16

export type PaletteColor = {
  hex: string
  name: string
}

export const basePalette: PaletteColor[] = [
  { hex: '#241a35', name: 'Tintafekete' },
  { hex: '#8fa66a', name: 'Tompa olíva' },
  { hex: '#9b7ede', name: 'Ibolya' },
  { hex: '#4ecdc4', name: 'Menta' },
  { hex: '#ffd166', name: 'Mézsárga' },
  { hex: '#ff6b6b', name: 'Korall' },
  { hex: '#4d96ff', name: 'Kék' },
  { hex: '#c9825b', name: 'Fanyar rozsda' },
]

export const shadowPalette: PaletteColor[] = [
  { hex: '#e8d7b8', name: 'Csontfény' },
  { hex: '#5f7443', name: 'Olívaárnyék' },
  { hex: '#6446a6', name: 'Ibolyaárnyék' },
  { hex: '#247f7a', name: 'Mentaárnyék' },
  { hex: '#b97818', name: 'Mézárnyék' },
  { hex: '#b83f4d', name: 'Korallárnyék' },
  { hex: '#285bb8', name: 'Kékárnyék' },
  { hex: '#8f4f35', name: 'Rozsdaárnyék' },
]

export const expandedPalette = basePalette.flatMap((color, index) => [
  shadowPalette[index],
  color,
])

export function colorsForPalette(size: PaletteSize) {
  return size === 16 ? expandedPalette : basePalette
}
