import { parseAvatarPixels } from './profile'
import { supabase } from './supabase'

export type ScoreboardEntry = {
  rank: number
  displayName: string
  avatarPixels: string[] | null
  totalPoints: number
  votePoints: number
  bonusPoints: number
  goldCount: number
  silverCount: number
  bronzeCount: number
  challengesEntered: number
}

export type HallOfFameEntry = {
  weekKey: string
  challengePrompt: string
  placement: 1 | 2 | 3
  displayName: string
  avatarPixels: string[] | null
  points: number
  awardedAt: string
}

export async function loadLifetimeScoreboard(limit = 100): Promise<ScoreboardEntry[]> {
  const { data, error } = await supabase.rpc('get_lifetime_scoreboard', {
    requested_limit: limit,
  })

  if (error) throw error

  return (data ?? []).map((entry) => ({
    rank: Number(entry.score_rank),
    displayName: entry.display_name,
    avatarPixels: parseAvatarPixels(entry.avatar_pixels),
    totalPoints: Number(entry.total_points),
    votePoints: Number(entry.vote_points),
    bonusPoints: Number(entry.bonus_points),
    goldCount: Number(entry.gold_count),
    silverCount: Number(entry.silver_count),
    bronzeCount: Number(entry.bronze_count),
    challengesEntered: Number(entry.challenges_entered),
  }))
}

export async function loadWeeklyHallOfFame(limit = 30): Promise<HallOfFameEntry[]> {
  const { data, error } = await supabase.rpc('get_weekly_hall_of_fame', {
    requested_limit: limit,
  })

  if (error) throw error

  return (data ?? []).map((entry) => ({
    weekKey: entry.week_key,
    challengePrompt: entry.challenge_prompt,
    placement: Number(entry.placement) as 1 | 2 | 3,
    displayName: entry.display_name,
    avatarPixels: parseAvatarPixels(entry.avatar_pixels),
    points: Number(entry.points),
    awardedAt: entry.awarded_at,
  }))
}
