import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Hiányoznak a Supabase környezeti változók.')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function makeClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function signIn(client) {
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('Sikertelen anonim belépés.')
  return data.user
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

const unauthenticated = makeClient()
const unauthenticatedList = await unauthenticated.rpc('list_public_rooms', {
  search_term: null,
})
assert(unauthenticatedList.error, 'A bejelentkezés nélküli szobalista váratlanul elérhető.')

const host = makeClient()
const guest = makeClient()
const outsider = makeClient()
const [hostUser, guestUser, outsiderUser] = await Promise.all([
  signIn(host),
  signIn(guest),
  signIn(outsider),
])

const suffix = Date.now().toString(36).slice(-6)
const roomName = `Élő próba ${suffix}`
let room = null
let guestJoined = false

try {
  room = await rpc(host, 'create_room_with_listing_settings', {
    player_name: `Host${suffix}`.slice(0, 16),
    duration_seconds: 90,
    requested_game_mode: 'classic',
    requested_competition_draw_seconds: 90,
    requested_competition_round_count: 2,
    requested_palette_size: 12,
    requested_room_name: roomName,
    requested_is_public: true,
  })

  const { data: listedRooms, error: listError } = await outsider.rpc('list_public_rooms', {
    search_term: suffix,
  })
  if (listError) throw listError
  assert(listedRooms.length === 1, 'A létrehozott nyilvános szoba nem található egyértelműen.')

  const listed = listedRooms[0]
  assert(listed.room_name === roomName, 'A listában hibás szobanév jelent meg.')
  assert(listed.player_count === 1, 'A listában hibás a kezdeti játékosszám.')
  assert(listed.max_players === 6, 'A listában hibás a maximális játékosszám.')
  assert(listed.game_mode === 'classic', 'A listában hibás a játékmód.')
  assert(listed.palette_size === 12, 'A listában hibás a palettaméret.')
  assert(
    JSON.stringify(Object.keys(listed).sort()) === JSON.stringify([
      'game_mode',
      'host_name',
      'listing_id',
      'max_players',
      'palette_size',
      'player_count',
      'public_listed_at',
      'room_name',
    ]),
    'A nyilvános lista a megengedettnél több mezőt adott vissza.',
  )
  assert(!('room_id' in listed) && !('code' in listed), 'A lista belső szobaadatot szivárogtat.')

  const { data: hiddenRoomRows, error: hiddenRoomError } = await outsider
    .from('rooms')
    .select('id, code')
    .eq('id', room.room_id)
  if (hiddenRoomError) throw hiddenRoomError
  assert(hiddenRoomRows.length === 0, 'A kívülálló közvetlenül kiolvasta a szobakódot.')

  const joined = await rpc(guest, 'join_public_room', {
    requested_listing_id: listed.listing_id,
    player_name: `Vendég${suffix}`.slice(0, 16),
  })
  guestJoined = true
  assert(joined.room_id === room.room_id, 'A nyilvános csatlakozás rossz szobába vitt.')
  assert(joined.normalized_room_code === room.room_code, 'A sikeres csatlakozás után hibás kód érkezett.')

  const { data: updatedRooms, error: updatedError } = await outsider.rpc('list_public_rooms', {
    search_term: suffix,
  })
  if (updatedError) throw updatedError
  assert(updatedRooms[0]?.player_count === 2, 'A lista nem frissítette a játékosszámot.')

  const invalidRename = await host.rpc('set_room_listing', {
    target_room_id: room.room_id,
    requested_room_name: 'https://tiltott.hu',
    requested_is_public: true,
  })
  assert(invalidRename.error?.message.includes('ROOM_NAME_INVALID'), 'A szerver elfogadott egy linkes szobanevet.')

  await rpc(host, 'set_room_listing', {
    target_room_id: room.room_id,
    requested_room_name: null,
    requested_is_public: false,
  })
  const { data: hiddenRooms, error: hiddenError } = await outsider.rpc('list_public_rooms', {
    search_term: suffix,
  })
  if (hiddenError) throw hiddenError
  assert(hiddenRooms.length === 0, 'A privátra állított szoba a listában maradt.')

  console.log(JSON.stringify({
    event: 'public-rooms-live-ok',
    distinctUsers: new Set([hostUser.id, guestUser.id, outsiderUser.id]).size === 3,
    safeFieldCount: Object.keys(listed).length,
    joinedByOpaqueListingId: true,
    privateAfterToggle: true,
    roomNameValidation: true,
  }))
} finally {
  if (room) {
    await host.rpc('leave_room', { target_room_id: room.room_id })
    if (guestJoined) await guest.rpc('leave_room', { target_room_id: room.room_id })
  }
}
