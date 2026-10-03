import type { Json } from '../types/database'
import { ensurePlayerSession, supabase } from './supabase'

export type BugReportCategory = 'bug' | 'ui' | 'connection' | 'idea'

type SubmitBugReportInput = {
  category: BugReportCategory
  description: string
  playerName: string
  roomCode: string | null
  roomId: number | null
  roundId: number | null
  roundStatus: string | null
  steps: string
}

export async function submitBugReport(input: SubmitBugReportInput) {
  const user = await ensurePlayerSession()
  const technicalContext: Json = {
    captured_at: new Date().toISOString(),
    language: navigator.language,
    online: navigator.onLine,
    page_url: window.location.href,
    round_id: input.roundId,
    round_status: input.roundStatus,
    screen: `${window.screen.width}x${window.screen.height}`,
    user_agent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  }

  const { error } = await supabase.from('bug_reports').insert({
    category: input.category,
    description: input.description.trim(),
    reporter_name: input.playerName.trim() || null,
    room_code: input.roomCode,
    room_id: input.roomId,
    steps: input.steps.trim() || null,
    technical_context: technicalContext,
    user_id: user.id,
  })

  if (error) throw error
}
