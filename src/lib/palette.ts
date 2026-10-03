export type RoomPaletteSize = 12 | 16
export type EditorPaletteSize = 12 | 32
export type PaletteSize = RoomPaletteSize | EditorPaletteSize

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

export const editorPalette32: PaletteColor[] = [
  { hex: '#f7f3e8', name: 'Csontfehér' },
  { hex: '#d8cfbd', name: 'Pergamen' },
  { hex: '#999ea1', name: 'Világosszürke' },
  { hex: '#66707a', name: 'Acélszürke' },
  { hex: '#3f4650', name: 'Palaszürke' },
  { hex: '#242630', name: 'Grafit' },
  { hex: '#230a19', name: 'Szilvafekete' },
  { hex: '#0f111a', name: 'Éjfekete' },
  { hex: '#7d2d3b', name: 'Bordó' },
  { hex: '#d3493b', name: 'Piros' },
  { hex: '#f25c54', name: 'Élénkpiros' },
  { hex: '#da7149', name: 'Korallnarancs' },
  { hex: '#e29958', name: 'Narancs' },
  { hex: '#f2b35d', name: 'Arany' },
  { hex: '#f5e57a', name: 'Halványsárga' },
  { hex: '#fff1a8', name: 'Vajfény' },
  { hex: '#4d5b32', name: 'Mohazöld' },
  { hex: '#718441', name: 'Olíva' },
  { hex: '#a5d967', name: 'Lime' },
  { hex: '#d4eb7a', name: 'Citromzöld' },
  { hex: '#2e6b4f', name: 'Erdőzöld' },
  { hex: '#67ba62', name: 'Zöld' },
  { hex: '#549d8c', name: 'Türkiz' },
  { hex: '#79cbb8', name: 'Mentafény' },
  { hex: '#1e4957', name: 'Mélytenger' },
  { hex: '#347f8c', name: 'Óceán' },
  { hex: '#33567e', name: 'Palakék' },
  { hex: '#4b79b8', name: 'Búzavirág' },
  { hex: '#221a5f', name: 'Indigó' },
  { hex: '#51439a', name: 'Ibolya' },
  { hex: '#8d5a9f', name: 'Szeder' },
  { hex: '#c57ca8', name: 'Rózsafény' },
]

export function colorsForPalette(size: PaletteSize) {
  if (size === 32) return editorPalette32
  return size === 16 ? expandedPalette : basePalette
}
