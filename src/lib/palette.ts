export type PaletteSize = 12 | 16

export type PaletteColor = {
  hex: string
  name: string
}

export const basePalette: PaletteColor[] = [
  { hex: '#d3493b', name: 'Piros' },
  { hex: '#da7149', name: 'Korallnarancs' },
  { hex: '#e29958', name: 'Narancs' },
  { hex: '#f5e57a', name: 'Halványsárga' },
  { hex: '#a5d967', name: 'Lime' },
  { hex: '#67ba62', name: 'Zöld' },
  { hex: '#549d8c', name: 'Türkiz' },
  { hex: '#33567e', name: 'Palakék' },
  { hex: '#221a5f', name: 'Indigó' },
  { hex: '#999ea1', name: 'Világosszürke' },
  { hex: '#242630', name: 'Grafit' },
  { hex: '#230a19', name: 'Szilvafekete' },
]

export const expandedPalette: PaletteColor[] = [
  { hex: '#e8d7b8', name: 'Csontfény' },
  { hex: '#241a35', name: 'Tintafekete' },
  { hex: '#5f7443', name: 'Olívaárnyék' },
  { hex: '#8fa66a', name: 'Tompa olíva' },
  { hex: '#6446a6', name: 'Ibolyaárnyék' },
  { hex: '#9b7ede', name: 'Ibolya' },
  { hex: '#247f7a', name: 'Mentaárnyék' },
  { hex: '#4ecdc4', name: 'Menta' },
  { hex: '#b97818', name: 'Mézárnyék' },
  { hex: '#ffd166', name: 'Mézsárga' },
  { hex: '#b83f4d', name: 'Korallárnyék' },
  { hex: '#ff6b6b', name: 'Korall' },
  { hex: '#285bb8', name: 'Kékárnyék' },
  { hex: '#4d96ff', name: 'Kék' },
  { hex: '#8f4f35', name: 'Rozsdaárnyék' },
  { hex: '#c9825b', name: 'Fanyar rozsda' },
]

export function colorsForPalette(size: PaletteSize) {
  return size === 16 ? expandedPalette : basePalette
}
