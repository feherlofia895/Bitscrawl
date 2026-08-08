import { createClient } from '@supabase/supabase-js'

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

export const supabase = createClient(supabaseUrl, supabasePublishableKey)

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
