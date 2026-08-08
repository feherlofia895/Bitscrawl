import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Hiányoznak a Supabase környezeti változók.')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function createTestClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function signIn(client) {
  const { error } = await client.auth.signInAnonymously()
  if (error) throw error
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

async function startSoloRound(client, roomId) {
  await rpc(client, 'set_room_test_mode', {
    target_room_id: roomId,
    test_mode_enabled: true,
  })
  await rpc(client, 'start_game', { target_room_id: roomId })
  const round = await rpc(client, 'get_round_view', { target_room_id: roomId })
  await rpc(client, 'choose_round_word', {
    selected_word: round.word_options[0],
    target_round_id: round.round_id,
  })
  return round.round_id
}

const host8 = createTestClient()
const host16 = createTestClient()
const outsider = createTestClient()
await Promise.all([signIn(host8), signIn(host16), signIn(outsider)])

const room8 = await rpc(host8, 'create_room', { player_name: 'Palette8' })
const room16 = await rpc(host16, 'create_room', { player_name: 'Palette16' })

try {
  const defaultRoom = await host8
    .from('rooms')
    .select('palette_size')
    .eq('id', room8.room_id)
    .single()
  if (defaultRoom.error) throw defaultRoom.error
  assert(defaultRoom.data.palette_size === 8, 'Az új szoba nem 8 színnel indul.')

  const outsiderChange = await outsider.rpc('set_room_palette_size', {
    palette_size_value: 16,
    target_room_id: room8.room_id,
  })
  assert(outsiderChange.error?.message.includes('NOT_ROOM_HOST'), 'A kívülálló palettát váltott.')

  await rpc(host16, 'set_room_palette_size', {
    palette_size_value: 16,
    target_room_id: room16.room_id,
  })

  const round8 = await startSoloRound(host8, room8.room_id)
  const round16 = await startSoloRound(host16, room16.room_id)

  const rejectedShadow = await host8.rpc('submit_pixel_changes', {
    pixel_changes: [{ x: 0, y: 0, color: '#6446a6' }],
    target_round_id: round8,
  })
  assert(
    rejectedShadow.error?.message.includes('PIXEL_CHANGES_INVALID'),
    'A 8 színű szoba elfogadott egy árnyékszínt.',
  )

  await rpc(host8, 'submit_pixel_changes', {
    pixel_changes: [{ x: 0, y: 0, color: '#9b7ede' }],
    target_round_id: round8,
  })
  await rpc(host16, 'submit_pixel_changes', {
    pixel_changes: [{ x: 0, y: 0, color: '#6446a6' }],
    target_round_id: round16,
  })

  const lateChange = await host16.rpc('set_room_palette_size', {
    palette_size_value: 8,
    target_room_id: room16.room_id,
  })
  assert(
    lateChange.error?.message.includes('ROOM_ALREADY_STARTED'),
    'Elindult meccs közben módosítható maradt a paletta.',
  )

  console.log(
    JSON.stringify({
      baseColorAccepted: true,
      event: 'palette-modes-ok',
      lateChangeBlocked: true,
      shadowAcceptedIn16: true,
      shadowBlockedIn8: true,
    }),
  )
} finally {
  await Promise.all([
    host8.rpc('leave_room', { target_room_id: room8.room_id }),
    host16.rpc('leave_room', { target_room_id: room16.room_id }),
  ])
}
