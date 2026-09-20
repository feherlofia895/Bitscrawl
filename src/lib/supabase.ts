import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Hiányzik a VITE_SUPABASE_URL vagy a VITE_SUPABASE_PUBLISHABLE_KEY környezeti változó.',
  )
}

const parsedSupabaseUrl = new URL(supabaseUrl)

if (parsedSupabaseUrl.protocol !== 'https:') {
  throw new Error('A Supabase projekt URL-jének HTTPS-t kell használnia.')
}

if (!supabasePublishableKey.startsWith('sb_publishable_')) {
  throw new Error('A böngészős klienshez modern Supabase publishable key szükséges.')
}

export const supabase = createClient<Database>(
  supabaseUrl,
  supabasePublishableKey,
)

export async function ensurePlayerSession() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (user) return user

  if (userError) {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) throw sessionError
    if (session) throw userError
  }

  await supabase.auth.signOut({ scope: 'local' })

  const { data, error } = await supabase.auth.signInAnonymously()

  if (error) throw error
  if (!data.user) throw new Error('ANONYMOUS_SESSION_FAILED')

  return data.user
}

export async function checkSupabaseConnection(signal?: AbortSignal) {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: {
        apikey: supabasePublishableKey,
      },
      cache: 'no-store',
      signal,
    })

    return response.ok
  } catch {
    return false
  }
}
