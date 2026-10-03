import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EDITOR_PALETTE_COLOR_LIMIT,
  loadLocalEditorPalettes,
  loadOwnEditorPalettes,
  sanitizeEditorPaletteColors,
  saveLocalEditorPalettes,
  saveOwnEditorPalette,
  type EditorCustomPalette,
  type EditorPaletteSlotIndex,
} from '../lib/editorPalettes'
import type { EditorPaletteSize } from '../lib/palette'

export function useChallengeEditorPalettes(
  syncKey: string,
  initialPaletteSize: EditorPaletteSize,
) {
  const [paletteSize, setPaletteSize] = useState<EditorPaletteSize>(initialPaletteSize)
  const [customPaletteActive, setCustomPaletteActive] = useState(true)
  const [customPalettes, setCustomPalettes] = useState(loadLocalEditorPalettes)
  const [activePaletteSlot, setActivePaletteSlot] = useState<EditorPaletteSlotIndex>(1)
  const [paletteSyncStatus, setPaletteSyncStatus] = useState('Saját paletták betöltése…')
  const mountedRef = useRef(true)
  const touchedRef = useRef(false)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let active = true
    touchedRef.current = false
    void loadOwnEditorPalettes()
      .then(result => {
        if (!active || !mountedRef.current) return
        if (!touchedRef.current) setCustomPalettes(result.palettes)
        setPaletteSyncStatus(result.storage === 'cloud'
          ? 'Profillal szinkronizálva.'
          : 'Ezen az eszközön mentve.')
      })
      .catch(error => {
        if (active && mountedRef.current) {
          setPaletteSyncStatus(error instanceof Error
            ? error.message
            : 'A profilszinkron most nem érhető el.')
        }
      })
    return () => { active = false }
  }, [syncKey])

  const activeCustomPalette = customPalettes[activePaletteSlot - 1]

  const queueSave = useCallback((palette: EditorCustomPalette) => {
    setPaletteSyncStatus('Paletta mentése…')
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveOwnEditorPalette(palette))
      .then(storage => {
        if (mountedRef.current) {
          setPaletteSyncStatus(storage === 'cloud'
            ? 'Profillal szinkronizálva.'
            : 'Ezen az eszközön mentve.')
        }
      })
      .catch(error => {
        if (mountedRef.current) {
          setPaletteSyncStatus(error instanceof Error
            ? error.message
            : 'A paletta mentése nem sikerült.')
        }
      })
  }, [])

  const replacePalette = useCallback((palette: EditorCustomPalette) => {
    touchedRef.current = true
    setCustomPalettes(current => {
      const next = current.map(item => item.slotIndex === palette.slotIndex ? palette : item)
      saveLocalEditorPalettes(next)
      return next
    })
    queueSave(palette)
  }, [queueSave])

  const updateCustomPaletteColors = useCallback((colors: string[]) => {
    replacePalette({
      ...activeCustomPalette,
      colors: sanitizeEditorPaletteColors(colors),
    })
  }, [activeCustomPalette, replacePalette])

  const saveCustomColor = useCallback((color: string) => {
    updateCustomPaletteColors([
      color,
      ...activeCustomPalette.colors.filter(saved => saved.toLowerCase() !== color.toLowerCase()),
    ])
  }, [activeCustomPalette.colors, updateCustomPaletteColors])

  const selectPalette = useCallback((value: string) => {
    if (value === 'custom') {
      setCustomPaletteActive(true)
      return
    }
    setCustomPaletteActive(false)
    setPaletteSize(value === '32' ? 32 : 12)
  }, [])

  const selectCustomPaletteSlot = useCallback((slotIndex: number) => {
    if (slotIndex === 1 || slotIndex === 2 || slotIndex === 3) setActivePaletteSlot(slotIndex)
  }, [])

  const customPaletteOptions = useMemo(() => customPalettes.map(palette => ({
    label: `${palette.name || `Saját paletta ${palette.slotIndex}`} · ${palette.colors.length}/${EDITOR_PALETTE_COLOR_LIMIT}`,
    slotIndex: palette.slotIndex,
  })), [customPalettes])

  return {
    activeCustomPalette,
    activePaletteSlot,
    customPaletteActive,
    customPaletteOptions,
    customPalettes,
    paletteSize,
    paletteSyncStatus,
    saveCustomColor,
    selectCustomPaletteSlot,
    selectPalette,
    setCustomPaletteActive,
    updateCustomPaletteColors,
  }
}
