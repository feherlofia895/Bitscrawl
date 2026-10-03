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
