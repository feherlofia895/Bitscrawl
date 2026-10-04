import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Hiányzó Supabase környezet.')

const client = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: authData, error: authError } = await client.auth.signInAnonymously()
if (authError || !authData.user) throw authError ?? new Error('Nincs tesztfelhasználó.')

const marker = `AUTOMATED_TEST_${Date.now()}`
const { data: reportId, error: submitError } = await client.rpc('submit_bug_report', {
  requested_category: 'bug',
  requested_description: `Automatizált hibajelentő próba ${marker}`,
  requested_reporter_name: 'BugReportTest',
  requested_room_code: null,
  requested_room_id: null,
  requested_steps: 'Automatikus RPC- és jogosultság-ellenőrzés.',
  requested_technical_context: { automated: true, marker },
})
if (submitError) throw submitError
if (!Number.isSafeInteger(Number(reportId))) throw new Error('A hibajelentő RPC nem adott azonosítót.')

const { data: visibleReports, error: readError } = await client
  .from('bug_reports')
  .select('id')
if (!readError && visibleReports.length > 0) {
  throw new Error('A tesztelő olvasni tudta a privát hibajelentéseket.')
}

const { error: directInsertError } = await client.from('bug_reports').insert({
  category: 'bug',
  description: 'Közvetlenül küldött tiltott automatizált jelentés.',
  technical_context: { automated: true },
  user_id: authData.user.id,
})
if (!directInsertError) throw new Error('A böngésző közvetlenül is írhatta a hibajelentés-táblát.')

const { error: rateLimitError } = await client.rpc('submit_bug_report', {
  requested_category: 'bug',
  requested_description: `Túl gyors ismételt próba ${marker}`,
  requested_reporter_name: 'BugReportTest',
  requested_room_code: null,
  requested_room_id: null,
  requested_steps: null,
  requested_technical_context: { automated: true, marker },
})
if (!rateLimitError?.message.includes('BUG_REPORT_RATE_LIMIT')) {
  throw new Error('A hibajelentések szerveroldali időkorlátja nem működött.')
}

console.log(JSON.stringify({
  event: 'bug-reports-ok',
  marker,
  reportId: Number(reportId),
  privateReadBlocked: true,
  directInsertBlocked: true,
  rateLimitBlocked: true,
}))
