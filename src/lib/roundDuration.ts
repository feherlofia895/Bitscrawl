export const roundDurations = [30, 45, 60, 75, 90] as const
export type RoundDuration = (typeof roundDurations)[number]
export const DEFAULT_ROUND_DURATION: RoundDuration = 90

export function isRoundDuration(value: unknown): value is RoundDuration {
  return typeof value === 'number' && roundDurations.some(duration => duration === value)
}

export const roundDurationText = {
  label: 'Rajzolási idő',
  seconds: 'másodperc',
  updating: 'Köridő mentése…',
  updated: 'Köridő elmentve.',
  failed: 'Nem sikerült módosítani a köridőt. Próbáld újra.',
  invalid: 'A köridő 30, 45, 60, 75 vagy 90 másodperc lehet.',
  unavailable: 'A választható köridő még nem érhető el. Egyelőre 90 másodperccel tudsz szobát indítani.',
  locked: 'A meccs közben a köridő már nem módosítható.',
  testOverride: 'Tesztmódban a külön tesztidő érvényes; ez a normál meccs köridője.',
  hostOnly: 'Csak a szoba hostja módosíthatja a köridőt.',
} as const
