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

const host = createTestClient()
const outsider = createTestClient()
await Promise.all([signIn(host), signIn(outsider)])

const room = await rpc(host, 'create_room', { player_name: 'Palette12' })
let expandedRoom = null

try {
  const defaultRoom = await host
    .from('rooms')
    .select('palette_id,palette_size')
    .eq('id', room.room_id)
    .single()
  if (defaultRoom.error) throw defaultRoom.error
  assert(defaultRoom.data.palette_size === 12, 'Az új szoba nem 12 színnel indul.')
  assert(defaultRoom.data.palette_id === 'base-12-v1', 'Az új szoba palettaverziója hibás.')

  const outsiderChange = await outsider.rpc('set_room_palette_size', {
    palette_size_value: 32,
    target_room_id: room.room_id,
  })
  assert(outsiderChange.error?.message.includes('NOT_ROOM_HOST'), 'A kívülálló palettát váltott.')

  const hiddenPaletteChange = await host.rpc('set_room_palette_size', {
    palette_size_value: 16,
    target_room_id: room.room_id,
  })
  assert(
    hiddenPaletteChange.error?.message.includes('PALETTE_SIZE_UNAVAILABLE'),
    'A rejtett bővített paletta új szobánál továbbra is kiválasztható.',
  )

  const rejectedEditorColor = await host.rpc('submit_pixel_changes', {
    pixel_changes: [{ x: 0, y: 0, color: '#c57ca8' }],
    target_round_id: await startSoloRound(host, room.room_id),
  })
  assert(
    rejectedEditorColor.error?.message.includes('PIXEL_CHANGES_INVALID'),
    'A 12 színű szoba elfogadott egy 32 színű palettaszínt.',
  )

  await host.rpc('leave_room', { target_room_id: room.room_id })
  expandedRoom = await rpc(host, 'create_room', { player_name: 'Palette32' })
  await rpc(host, 'set_room_palette_size', {
    palette_size_value: 32,
    target_room_id: expandedRoom.room_id,
  })
  const expandedStored = await host.from('rooms').select('palette_id,palette_size')
    .eq('id', expandedRoom.room_id).single()
  if (expandedStored.error) throw expandedStored.error
  assert(expandedStored.data.palette_size === 32, 'A host nem tudta bekapcsolni a 32 színű módot.')
  assert(expandedStored.data.palette_id === 'editor-32-v1', 'A 32 színű palettaverzió hibás.')

  const roundId = await startSoloRound(host, expandedRoom.room_id)

  await rpc(host, 'submit_pixel_changes', {
    pixel_changes: [{ x: 0, y: 0, color: '#c57ca8' }],
    target_round_id: roundId,
  })

  const rejectedCustomColor = await host.rpc('submit_pixel_changes', {
    pixel_changes: [{ x: 1, y: 0, color: '#123456' }],
    target_round_id: roundId,
  })
  assert(
    rejectedCustomColor.error?.message.includes('PIXEL_CHANGES_INVALID'),
    'A 32 színű szoba elfogadott egy nem engedélyezett kevert színt.',
  )

  await rpc(host, 'submit_pixel_changes', {
    pixel_changes: [
      { x: 0, y: 0, color: '#d3493b' },
      { x: 1, y: 0, color: '#230a19' },
      { x: 2, y: 0, color: '#999ea1' },
    ],
    target_round_id: roundId,
  })

  const rejectedOldColors = await host.rpc('submit_pixel_changes', {
    pixel_changes: [
      { x: 3, y: 0, color: '#e8d7b8' },
      { x: 4, y: 0, color: '#7b8794' },
      { x: 5, y: 0, color: '#120d1c' },
    ],
    target_round_id: roundId,
  })
  assert(
    rejectedOldColors.error?.message.includes('PIXEL_CHANGES_INVALID'),
    'A lecserélt színek továbbra is elküldhetők maradtak.',
  )

  const lateChange = await host.rpc('set_room_palette_size', {
    palette_size_value: 12,
    target_room_id: expandedRoom.room_id,
  })
  assert(
    lateChange.error?.message.includes('ROOM_ALREADY_STARTED'),
    'Elindult meccs közben módosítható maradt a paletta.',
  )

  console.log(
    JSON.stringify({
      twelveColorBaseAccepted: true,
      event: 'palette-modes-ok',
      expandedPaletteAccepted: true,
      hiddenPaletteBlocked: true,
      lateChangeBlocked: true,
      legacyColorsBlocked: true,
      customColorBlockedIn32: true,
      editorColorBlockedIn12: true,
    }),
  )
} finally {
  await host.rpc('leave_room', { target_room_id: room.room_id })
  if (expandedRoom) await host.rpc('leave_room', { target_room_id: expandedRoom.room_id })
}
