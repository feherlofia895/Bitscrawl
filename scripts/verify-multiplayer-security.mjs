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
  const { data, error } = await client.auth.signInAnonymously()
  if (error) throw error
  return data.user
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

async function expectRpcError(client, name, args, expectedCode) {
  const { error } = await client.rpc(name, args)
  assert(error, `${name}: a tiltott művelet váratlanul sikerült.`)
  assert(
    error.message.includes(expectedCode),
    `${name}: ${expectedCode} helyett ezt kaptuk: ${error.message}`,
  )
}

async function expectWriteDenied(request, label) {
  const { error } = await request
  assert(error, `${label}: a közvetlen adatbázis-írás váratlanul sikerült.`)
}

const host = createTestClient()
const guest = createTestClient()
const outsider = createTestClient()
const solo = createTestClient()
const unauthenticated = createTestClient()

const [hostUser, guestUser, outsiderUser, soloUser] = await Promise.all([
  signIn(host),
  signIn(guest),
  signIn(outsider),
  signIn(solo),
])

await expectRpcError(
  unauthenticated,
  'create_room',
  { player_name: 'NoSession' },
  'permission denied',
)

const roomA = await rpc(host, 'create_room', { player_name: 'SecurityHost' })
await rpc(guest, 'join_room', {
  player_name: 'SecurityGuest',
  room_code: roomA.room_code,
})
const roomB = await rpc(outsider, 'create_room', {
  player_name: 'SecurityOutsider',
})

await expectRpcError(
  guest,
  'set_room_test_mode',
  { target_room_id: roomA.room_id, test_mode_enabled: true },
  'NOT_ROOM_HOST',
)
await expectRpcError(
  guest,
  'start_game',
  { target_room_id: roomA.room_id },
  'NOT_ROOM_HOST',
)
await expectRpcError(
  outsider,
  'resume_room',
  { room_code: roomA.room_code },
  'ROOM_MEMBERSHIP_NOT_FOUND',
)

const outsiderRooms = await outsider
  .from('rooms')
  .select('id')
  .eq('id', roomA.room_id)
const outsiderPlayers = await outsider
  .from('room_players')
  .select('id')
  .eq('room_id', roomA.room_id)

if (outsiderRooms.error) throw outsiderRooms.error
if (outsiderPlayers.error) throw outsiderPlayers.error
assert(outsiderRooms.data.length === 0, 'Másik szoba adatai láthatók voltak.')
assert(outsiderPlayers.data.length === 0, 'Másik szoba játékosai láthatók voltak.')

await expectWriteDenied(
  host.from('rooms').update({ status: 'finished' }).eq('id', roomA.room_id),
  'Szobaállapot módosítása',
)
await expectWriteDenied(
  host
    .from('room_players')
    .update({ score: 999_999 })
    .eq('room_id', roomA.room_id),
  'Pontszám módosítása',
)

const privateRead = await host.schema('private').from('round_secrets').select('*')
assert(privateRead.error, 'A titkos szó táblája közvetlenül olvasható volt.')

await rpc(host, 'set_room_test_mode', {
  target_room_id: roomA.room_id,
  test_mode_enabled: true,
})
await rpc(host, 'start_game', { target_room_id: roomA.room_id })

const hostRound = await rpc(host, 'get_round_view', {
  target_room_id: roomA.room_id,
})
const guestRound = await rpc(guest, 'get_round_view', {
  target_room_id: roomA.room_id,
})

assert(hostRound.word_options.length === 3, 'A rajzoló nem kapott három szót.')
assert(guestRound.word_options === null, 'A tippelő megkapta a titkos szólistát.')
assert(guestRound.chosen_word === null, 'A tippelő megkapta a kiválasztott szót.')

await expectRpcError(
  outsider,
  'get_round_view',
  { target_room_id: roomA.room_id },
  'ROOM_NOT_FOUND',
)
await expectRpcError(
  guest,
  'choose_round_word',
  { target_round_id: hostRound.round_id, selected_word: hostRound.word_options[0] },
  'NOT_ROUND_DRAWER',
)
await expectRpcError(
  guest,
  'submit_pixel_changes',
  {
    target_round_id: hostRound.round_id,
    pixel_changes: [{ x: 0, y: 0, color: '#230a19' }],
  },
  'NOT_ROUND_DRAWER',
)

await rpc(host, 'choose_round_word', {
  target_round_id: hostRound.round_id,
  selected_word: hostRound.word_options[0],
})
const timedRound = await rpc(host, 'get_round_view', {
  target_room_id: roomA.room_id,
})
const timedSeconds =
  (Date.parse(timedRound.drawing_ends_at) - Date.parse(timedRound.server_now)) /
  1_000

assert(
  timedSeconds > 10 && timedSeconds <= 15,
  `A többjátékos tesztkör ideje nem 15 másodperc: ${timedSeconds}`,
)

await expectRpcError(
  guest,
  'submit_pixel_changes',
  {
    target_round_id: hostRound.round_id,
    pixel_changes: [{ x: 1, y: 1, color: '#230a19' }],
  },
  'NOT_ROUND_DRAWER',
)
await expectRpcError(
  outsider,
  'submit_guess',
  { target_round_id: hostRound.round_id, submitted_guess: hostRound.word_options[0] },
  'ROOM_NOT_FOUND',
)
await expectRpcError(
  host,
  'submit_guess',
  { target_round_id: hostRound.round_id, submitted_guess: hostRound.word_options[0] },
  'DRAWER_CANNOT_GUESS',
)

const roomMessageId = await rpc(host, 'send_room_message', {
  target_room_id: roomA.room_id,
  message_content: 'Biztonsági chatpróba',
})
assert(roomMessageId > 0, 'A szerver nem mentette el a szobachat üzenetét.')

await expectRpcError(
  outsider,
  'send_room_message',
  { target_room_id: roomA.room_id, message_content: 'Illetéktelen üzenet' },
  'ROOM_NOT_FOUND',
)

await expectWriteDenied(
  guest.from('room_messages').insert({
    content: 'Közvetlen írás',
    room_id: roomA.room_id,
    sender_user_id: guestUser.id,
  }),
  'Szobachat közvetlen írása',
)

const wrongGuess = await rpc(guest, 'submit_guess', {
  target_round_id: hostRound.round_id,
  submitted_guess: 'biztosan hibás megfejtés',
})
assert(!wrongGuess.is_correct, 'A szerver helyesnek fogadta el a hibás megfejtést.')
assert(wrongGuess.message_id === null, 'A hibás megfejtés közös eseményt hozott létre.')

const messagesAfterWrongGuess = await host
  .from('round_messages')
  .select('id, kind, content')
  .eq('round_id', hostRound.round_id)

if (messagesAfterWrongGuess.error) throw messagesAfterWrongGuess.error
assert(
  messagesAfterWrongGuess.data.length === 0,
  'A hibás megfejtés más szobatag számára olvashatóvá vált.',
)

await expectWriteDenied(
  guest.from('round_messages').insert({
    content: null,
    kind: 'correct',
    room_id: roomA.room_id,
    round_id: hostRound.round_id,
    sender_user_id: guestUser.id,
  }),
  'Hamis helyes megfejtés beszúrása',
)
await expectWriteDenied(
  guest.from('round_draw_events').insert({
    changes: [{ x: 2, y: 2, color: '#230a19' }],
    created_by: guestUser.id,
    room_id: roomA.room_id,
    round_id: hostRound.round_id,
  }),
  'Hamis rajzesemény beszúrása',
)
await expectWriteDenied(
  host
    .from('game_rounds')
    .update({ drawer_user_id: guestUser.id })
    .eq('id', hostRound.round_id),
  'Rajzoló közvetlen átírása',
)

const correctGuess = await rpc(guest, 'submit_guess', {
  target_round_id: hostRound.round_id,
  submitted_guess: hostRound.word_options[0],
})
assert(correctGuess.is_correct, 'A szerver nem fogadta el a helyes megfejtést.')

const scores = await host
  .from('room_players')
  .select('user_id, score')
  .eq('room_id', roomA.room_id)

if (scores.error) throw scores.error
const hostScore = scores.data.find((player) => player.user_id === hostUser.id)?.score
const guestScore = scores.data.find((player) => player.user_id === guestUser.id)?.score
assert(hostScore === 100, `A rajzoló szerverpontja hibás: ${hostScore}`)
assert(guestScore > 0 && guestScore <= 500, `A tippelő szerverpontja hibás: ${guestScore}`)

const hiddenMessages = await outsider
  .from('round_messages')
  .select('id')
  .eq('room_id', roomA.room_id)
const hiddenDrawEvents = await outsider
  .from('round_draw_events')
  .select('id')
  .eq('room_id', roomA.room_id)
const hiddenRoomMessages = await outsider
  .from('room_messages')
  .select('id')
  .eq('room_id', roomA.room_id)

if (hiddenMessages.error) throw hiddenMessages.error
if (hiddenDrawEvents.error) throw hiddenDrawEvents.error
if (hiddenRoomMessages.error) throw hiddenRoomMessages.error
assert(hiddenMessages.data.length === 0, 'Másik szoba chatje látható volt.')
assert(hiddenDrawEvents.data.length === 0, 'Másik szoba rajza látható volt.')
assert(hiddenRoomMessages.data.length === 0, 'Másik szoba beszélgetése látható volt.')

const soloRoom = await rpc(solo, 'create_room', { player_name: 'SecuritySolo' })
await rpc(solo, 'set_room_test_mode', {
  target_room_id: soloRoom.room_id,
  test_mode_enabled: true,
})
await rpc(solo, 'start_game', { target_room_id: soloRoom.room_id })
const soloChoosing = await rpc(solo, 'get_round_view', {
  target_room_id: soloRoom.room_id,
})
await rpc(solo, 'choose_round_word', {
  target_round_id: soloChoosing.round_id,
  selected_word: soloChoosing.word_options[0],
})
const soloDrawing = await rpc(solo, 'get_round_view', {
  target_room_id: soloRoom.room_id,
})

assert(
  soloDrawing.drawing_ends_at === null,
  'Az egyszemélyes tesztkör még mindig időkorlátos.',
)

await rpc(solo, 'submit_pixel_changes', {
  target_round_id: soloDrawing.round_id,
  pixel_changes: [{ x: 3, y: 3, color: '#d3493b' }],
})
await expectRpcError(
  solo,
  'finish_expired_round',
  { target_round_id: soloDrawing.round_id },
  'ROUND_TIME_REMAINING',
)

console.log(
  JSON.stringify({
    event: 'multiplayer-security-ok',
    hostUserId: hostUser.id,
    outsiderUserId: outsiderUser.id,
    protectedRoomId: roomA.room_id,
    separateRoomId: roomB.room_id,
    soloUnlimited: soloDrawing.drawing_ends_at === null,
    soloUserId: soloUser.id,
    testedAttackCount: 20,
  }),
)
