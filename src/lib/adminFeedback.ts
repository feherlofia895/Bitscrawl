import type { Json } from '../types/database'
import { supabase } from './supabase'

export type FeedbackStatus = 'new' | 'reviewed' | 'fixed' | 'closed'
export type FeedbackCategory = 'bug' | 'ui' | 'connection' | 'idea'

export type AdminFeedbackReport = {
  category: FeedbackCategory
  createdAt: string
  description: string
  id: number
  reporterName: string | null
  status: FeedbackStatus
  steps: string | null
  technicalContext: Json
}

export type AdminFeedbackSummary = {
  bugCount: number
  ideaCount: number
  newCount: number
}

const feedbackMessages: Record<string, string> = {
  ADMIN_REQUIRED: 'Ehhez adminisztrátori jogosultság szükséges.',
  FEEDBACK_REPORT_NOT_FOUND: 'A bejegyzés már nem található.',
  FEEDBACK_STATUS_INVALID: 'Ez a visszajelzési állapot nem használható.',
}

function feedbackError(error: unknown) {
  const raw = typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'A visszajelzési művelet nem sikerült.'
  const code = Object.keys(feedbackMessages).find(key => raw.includes(key))
  return new Error(code ? feedbackMessages[code] : raw)
}

function count(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export async function loadAdminFeedbackSummary(): Promise<AdminFeedbackSummary> {
  const { data, error } = await supabase.rpc('get_admin_feedback_summary')
  if (error) throw feedbackError(error)
  const summary = data?.[0]
  return {
    bugCount: count(summary?.bug_count),
    ideaCount: count(summary?.idea_count),
    newCount: count(summary?.new_count),
  }
}

export async function loadAdminFeedbackReports(status: FeedbackStatus | null): Promise<AdminFeedbackReport[]> {
  const { data, error } = await supabase.rpc('get_admin_feedback_reports', {
    requested_status: status,
  })
  if (error) throw feedbackError(error)
  return (data ?? []).map(report => ({
    category: report.category as FeedbackCategory,
    createdAt: report.created_at,
    description: report.description,
    id: report.report_id,
    reporterName: report.reporter_name,
    status: report.status as FeedbackStatus,
    steps: report.steps,
    technicalContext: report.technical_context,
  }))
}

export async function setAdminFeedbackStatus(id: number, status: FeedbackStatus) {
  const { data, error } = await supabase.rpc('set_admin_feedback_status', {
    requested_status: status,
    target_report_id: id,
  })
  if (error) throw feedbackError(error)
  const updated = data?.[0]
  if (!updated) throw new Error('A bejegyzés állapota nem frissült.')
  return updated.status as FeedbackStatus
}
