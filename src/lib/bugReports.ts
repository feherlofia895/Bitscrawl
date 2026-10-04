import type { Json } from '../types/database'
import { ensurePlayerSession, supabase } from './supabase'

export type BugReportCategory = 'bug' | 'ui' | 'connection' | 'idea'

const bugReportErrorMessages: Record<string, string> = {
  AUTH_REQUIRED: 'Nem sikerült létrehozni a játékos-munkamenetet.',
  BUG_REPORT_CATEGORY_INVALID: 'Válassz érvényes visszajelzéstípust.',
  BUG_REPORT_CONTEXT_INVALID: 'A technikai adatok túl nagyok vagy hibásak.',
  BUG_REPORT_DESCRIPTION_INVALID: 'A visszajelzés 10–1500 karakter hosszú lehet.',
  BUG_REPORT_RATE_LIMIT: 'Túl sok visszajelzést küldtél rövid idő alatt. Próbáld újra később.',
  BUG_REPORT_REPORTER_INVALID: 'A játékosnév túl hosszú.',
  BUG_REPORT_ROOM_INVALID: 'A játékmenet adatai hibásak.',
  BUG_REPORT_STEPS_INVALID: 'A hiba lépései legfeljebb 1500 karakteresek lehetnek.',
}

function readableBugReportError(error: unknown) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
  const knownCode = Object.keys(bugReportErrorMessages).find((code) =>
    message.includes(code),
  )

  if (knownCode) return new Error(bugReportErrorMessages[knownCode])
  return new Error('Nem sikerült elküldeni. Ellenőrizd az internetkapcsolatot, majd próbáld újra.')
}

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
  try {
    await ensurePlayerSession()
    const technicalContext: Json = {
      build_id: __BITSCRAWL_BUILD_ID__,
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

    const { error } = await supabase.rpc('submit_bug_report', {
      requested_category: input.category,
      requested_description: input.description.trim(),
      requested_reporter_name: input.playerName.trim() || null,
      requested_room_code: input.roomCode,
      requested_room_id: input.roomId,
      requested_steps: input.steps.trim() || null,
      requested_technical_context: technicalContext,
    })

    if (error) throw error
  } catch (error) {
    throw readableBugReportError(error)
  }
}
