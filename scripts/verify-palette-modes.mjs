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

const host12 = createTestClient()
const host16 = createTestClient()
const outsider = createTestClient()
await Promise.all([signIn(host12), signIn(host16), signIn(outsider)])

const room12 = await rpc(host12, 'create_room', { player_name: 'Palette12' })
const room16 = await rpc(host16, 'create_room', { player_name: 'Palette16' })

try {
  const defaultRoom = await host12
    .from('rooms')
    .select('palette_size')
    .eq('id', room12.room_id)
    .single()
  if (defaultRoom.error) throw defaultRoom.error
  assert(defaultRoom.data.palette_size === 12, 'Az új szoba nem 12 színnel indul.')

  const outsiderChange = await outsider.rpc('set_room_palette_size', {
    palette_size_value: 16,
    target_room_id: room12.room_id,
  })
  assert(outsiderChange.error?.message.includes('NOT_ROOM_HOST'), 'A kívülálló palettát váltott.')

  await rpc(host16, 'set_room_palette_size', {
    palette_size_value: 16,
    target_room_id: room16.room_id,
  })

  const round12 = await startSoloRound(host12, room12.room_id)
  const round16 = await startSoloRound(host16, room16.room_id)

  const rejectedLegacyColor = await host12.rpc('submit_pixel_changes', {
    pixel_changes: [{ x: 0, y: 0, color: '#6446a6' }],
    target_round_id: round12,
  })
  assert(
    rejectedLegacyColor.error?.message.includes('PIXEL_CHANGES_INVALID'),
    'A 12 színű szoba elfogadott egy régi bővített színt.',
  )

  await rpc(host12, 'submit_pixel_changes', {
    pixel_changes: [
      { x: 0, y: 0, color: '#d3493b' },
      { x: 1, y: 0, color: '#230a19' },
      { x: 2, y: 0, color: '#999ea1' },
    ],
    target_round_id: round12,
  })
  await rpc(host16, 'submit_pixel_changes', {
    pixel_changes: [
      { x: 0, y: 0, color: '#e8d7b8' },
      { x: 1, y: 0, color: '#5f7443' },
      { x: 2, y: 0, color: '#8f4f35' },
    ],
    target_round_id: round16,
  })

  const rejectedOldColors = await host16.rpc('submit_pixel_changes', {
    pixel_changes: [
      { x: 3, y: 0, color: '#f7f3e8' },
      { x: 4, y: 0, color: '#7b8794' },
      { x: 5, y: 0, color: '#120d1c' },
    ],
    target_round_id: round16,
  })
  assert(
    rejectedOldColors.error?.message.includes('PIXEL_CHANGES_INVALID'),
    'A lecserélt színek továbbra is elküldhetők maradtak.',
  )

  const lateChange = await host16.rpc('set_room_palette_size', {
    palette_size_value: 12,
    target_room_id: room16.room_id,
  })
  assert(
    lateChange.error?.message.includes('ROOM_ALREADY_STARTED'),
    'Elindult meccs közben módosítható maradt a paletta.',
  )

  console.log(
    JSON.stringify({
      twelveColorBaseAccepted: true,
      event: 'palette-modes-ok',
      lateChangeBlocked: true,
      oldColorsBlocked: true,
      shadowAcceptedIn16: true,
      legacyColorBlockedIn12: true,
    }),
  )
} finally {
  await Promise.all([
    host12.rpc('leave_room', { target_room_id: room12.room_id }),
    host16.rpc('leave_room', { target_room_id: room16.room_id }),
  ])
}
