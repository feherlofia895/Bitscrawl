export const gameModes = ['classic', 'competition'] as const
export type GameMode = (typeof gameModes)[number]

export const competitionDrawDurations = [60, 90, 120] as const
export type CompetitionDrawDuration = (typeof competitionDrawDurations)[number]
export const DEFAULT_COMPETITION_DRAW_DURATION: CompetitionDrawDuration = 90

export const competitionRoundCounts = [1, 2, 3, 4, 5] as const
export type CompetitionRoundCount = (typeof competitionRoundCounts)[number]
export const DEFAULT_COMPETITION_ROUND_COUNT: CompetitionRoundCount = 2

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && gameModes.some(mode => mode === value)
}

export function isCompetitionDrawDuration(value: unknown): value is CompetitionDrawDuration {
  return typeof value === 'number' && competitionDrawDurations.some(duration => duration === value)
}

export function isCompetitionRoundCount(value: unknown): value is CompetitionRoundCount {
  return typeof value === 'number' && competitionRoundCounts.some(count => count === value)
}

export const gameModeText = {
  classic: 'Klasszikus',
  competition: 'Párhuzamos rajzverseny',
  competitionPreparing: 'Mindenki ugyanazt a szót rajzolja, majd névtelenül szavaztok.',
} as const
