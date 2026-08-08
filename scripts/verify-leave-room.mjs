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

const host = createTestClient()
const guest = createTestClient()
const outsider = createTestClient()

const [hostUser, guestUser] = await Promise.all([
  signIn(host),
  signIn(guest),
  signIn(outsider),
])

const room = await rpc(host, 'create_room', { player_name: 'LeaveHost' })
await rpc(guest, 'join_room', {
  player_name: 'LeaveGuest',
  room_code: room.room_code,
})

const outsiderLeave = await outsider.rpc('leave_room', {
  target_room_id: room.room_id,
})
assert(outsiderLeave.error, 'Egy kívülálló váratlanul kiléphetett a szobából.')
assert(
  outsiderLeave.error.message.includes('ROOM_MEMBERSHIP_NOT_FOUND'),
  'A kívülálló nem a várt tagsági hibát kapta.',
)

await rpc(host, 'start_game', { target_room_id: room.room_id })
const roundBefore = await rpc(host, 'get_round_view', {
  target_room_id: room.room_id,
})
assert(roundBefore.drawer_user_id === hostUser.id, 'Nem a host lett az első rajzoló.')

const hostLeave = await rpc(host, 'leave_room', {
  target_room_id: room.room_id,
})
assert(!hostLeave.room_deleted, 'A kétszemélyes szoba váratlanul törlődött.')
assert(hostLeave.host_changed, 'A host szerep nem került azonnal átadásra.')
assert(hostLeave.host_user_id === guestUser.id, 'Nem a vendég lett az új host.')
assert(hostLeave.round_finished, 'A kilépő rajzoló köre nem zárult le.')

const roomAfter = await guest
  .from('rooms')
  .select('host_user_id')
  .eq('id', room.room_id)
  .single()
if (roomAfter.error) throw roomAfter.error
assert(roomAfter.data.host_user_id === guestUser.id, 'Az adatbázisban nem frissült a host.')

const playersAfter = await guest
  .from('room_players')
  .select('user_id')
  .eq('room_id', room.room_id)
if (playersAfter.error) throw playersAfter.error
assert(playersAfter.data.length === 1, 'A kilépő játékos tagsága nem törlődött.')
assert(playersAfter.data[0].user_id === guestUser.id, 'Nem a vendég maradt a szobában.')

const roundAfter = await rpc(guest, 'get_round_view', {
  target_room_id: room.room_id,
})
assert(roundAfter.round_status === 'finished', 'A kilépő rajzoló köre aktív maradt.')

const resumeAfterLeave = await host.rpc('resume_room', {
  room_code: room.room_code,
})
assert(resumeAfterLeave.error, 'A kilépő játékos visszaállította a törölt tagságát.')
assert(
  resumeAfterLeave.error.message.includes('ROOM_MEMBERSHIP_NOT_FOUND'),
  'A kilépő játékos nem a várt visszatérési hibát kapta.',
)

const lastLeave = await rpc(guest, 'leave_room', {
  target_room_id: room.room_id,
})
assert(lastLeave.room_deleted, 'Az utolsó játékos után nem törlődött a szoba.')

const resumeDeletedRoom = await guest.rpc('resume_room', {
  room_code: room.room_code,
})
assert(resumeDeletedRoom.error, 'A törölt szoba váratlanul visszaállítható maradt.')
assert(
  resumeDeletedRoom.error.message.includes('ROOM_NOT_FOUND'),
  'A törölt szoba nem a várt hibát adta.',
)

console.log(
  JSON.stringify({
    event: 'leave-room-ok',
    hostChangedTo: hostLeave.host_user_id,
    roomDeletedAfterLastPlayer: lastLeave.room_deleted,
    roundFinished: hostLeave.round_finished,
  }),
)
