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
const { error: insertError } = await client.from('bug_reports').insert({
  category: 'bug',
  description: `Automatizált hibajelentő próba ${marker}`,
  reporter_name: 'BugReportTest',
  room_code: null,
  room_id: null,
  steps: 'Automatikus beszúrási és RLS-ellenőrzés.',
  technical_context: { automated: true, marker },
  user_id: authData.user.id,
})
if (insertError) throw insertError

const { data: visibleReports, error: readError } = await client
  .from('bug_reports')
  .select('id')
if (!readError && visibleReports.length > 0) {
  throw new Error('A tesztelő olvasni tudta a privát hibajelentéseket.')
}

const otherClient = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: otherAuth, error: otherAuthError } =
  await otherClient.auth.signInAnonymously()
if (otherAuthError || !otherAuth.user) throw otherAuthError ?? new Error('Nincs második tesztfelhasználó.')

const { error: forgedInsertError } = await otherClient.from('bug_reports').insert({
  category: 'bug',
  description: 'Más nevében küldött tiltott automatizált jelentés.',
  technical_context: { automated: true },
  user_id: authData.user.id,
})
if (!forgedInsertError) throw new Error('Más felhasználó nevében is lehetett jelentést küldeni.')

console.log(JSON.stringify({ event: 'bug-reports-ok', marker, privateReadBlocked: true, forgedInsertBlocked: true }))
