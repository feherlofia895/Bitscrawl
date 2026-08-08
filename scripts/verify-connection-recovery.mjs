import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Hiányoznak a Supabase környezeti változók.')
}

function createTestClient() {
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data[0]
}

const host = createTestClient()
const guest = createTestClient()

const hostAuth = await host.auth.signInAnonymously()
const guestAuth = await guest.auth.signInAnonymously()

if (hostAuth.error) throw hostAuth.error
if (guestAuth.error) throw guestAuth.error

const hostUserId = hostAuth.data.user.id
const guestUserId = guestAuth.data.user.id
const room = await rpc(host, 'create_room', { player_name: 'RecoveryHost' })

await rpc(guest, 'join_room', {
  player_name: 'RecoveryGuest',
  room_code: room.room_code,
})
await rpc(host, 'touch_room_presence', { target_room_id: room.room_id })
await rpc(guest, 'touch_room_presence', { target_room_id: room.room_id })
await rpc(host, 'start_game', { target_room_id: room.room_id })

const roundBefore = await rpc(host, 'get_round_view', {
  target_room_id: room.room_id,
})

console.log(
  JSON.stringify({
    event: 'recovery-test-room-created',
    guestUserId,
    hostUserId,
    roomCode: room.room_code,
    roomId: room.room_id,
    roundId: roundBefore.round_id,
  }),
)

let recovery

for (let attempt = 0; attempt < 12; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  const heartbeat = await rpc(guest, 'touch_room_presence', {
    target_room_id: room.room_id,
  })

  if (heartbeat.host_changed || heartbeat.round_finished) {
    recovery = heartbeat
    break
  }
}

if (!recovery) throw new Error('A kiesési türelmi idő után sem történt helyreállítás.')
if (!recovery.host_changed) throw new Error('A host szerep nem került átadásra.')
if (!recovery.round_finished) throw new Error('A kiesett rajzoló köre nem zárult le.')
if (recovery.host_user_id !== guestUserId) {
  throw new Error('Nem az aktív játékos lett az új host.')
}

const roomAfter = await guest
  .from('rooms')
  .select('host_user_id')
  .eq('id', room.room_id)
  .single()
const roundAfter = await rpc(guest, 'get_round_view', {
  target_room_id: room.room_id,
})

if (roomAfter.error) throw roomAfter.error
if (roomAfter.data.host_user_id !== guestUserId) {
  throw new Error('Az adatbázisban nem frissült a host.')
}
if (roundAfter.round_status !== 'finished') {
  throw new Error('Az adatbázisban nem zárult le a kör.')
}

const nextRoundDelay = Math.max(
  0,
  new Date(roundAfter.next_round_at).getTime() -
    new Date(roundAfter.server_now).getTime() +
    500,
)
await new Promise((resolve) => setTimeout(resolve, nextRoundDelay))

const advance = await rpc(guest, 'advance_game', {
  target_round_id: roundAfter.round_id,
})
const nextRound = await rpc(guest, 'get_round_view', {
  target_room_id: room.room_id,
})

if (advance.room_status !== 'playing') {
  throw new Error('A meccs nem folytatódott.')
}
if (nextRound.drawer_user_id !== guestUserId) {
  throw new Error('A következő kör nem az aktív játékoshoz került.')
}

console.log(
  JSON.stringify({
    event: 'connection-recovery-ok',
    hostChanged: recovery.host_changed,
    nextDrawerUserId: nextRound.drawer_user_id,
    nextRoundNumber: nextRound.round_number,
    roundFinished: recovery.round_finished,
  }),
)
