import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Hiányzó Supabase környezet.')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const makeClient = () => createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}
const signIn = async (client) => {
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('Sikertelen anonim belépés.')
  return data.user
}
const readDuration = async (client, roomId) => {
  const { data, error } = await client
    .from('rooms')
    .select('round_duration_seconds')
    .eq('id', roomId)
    .single()
  if (error) throw error
  return data.round_duration_seconds
}

const host = makeClient()
const guest = makeClient()
const [hostUser, guestUser] = await Promise.all([signIn(host), signIn(guest)])
const room = await rpc(host, 'create_room_with_duration', {
  player_name: 'RoundHost',
  duration_seconds: 30,
})

try {
  await rpc(guest, 'join_room', {
    player_name: 'RoundGuest',
    room_code: room.room_code,
  })
  assert(await readDuration(host, room.room_id) === 30, 'A host nem 30 másodpercet lát.')
  assert(await readDuration(guest, room.room_id) === 30, 'A vendég nem 30 másodpercet lát.')

  const guestChange = await guest.rpc('set_room_round_duration', {
    target_room_id: room.room_id,
    duration_seconds: 45,
  })
  assert(guestChange.error?.message.includes('NOT_ROOM_HOST'), 'A vendég módosítani tudta a köridőt.')

  await rpc(host, 'set_room_round_duration', {
    target_room_id: room.room_id,
    duration_seconds: 45,
  })
  assert(await readDuration(guest, room.room_id) === 45, 'A vendég nem látja a host 45 másodperces beállítását.')

  await rpc(host, 'start_game', { target_room_id: room.room_id })
  const views = await Promise.all([
    rpc(host, 'get_round_view', { target_room_id: room.room_id }),
    rpc(guest, 'get_round_view', { target_room_id: room.room_id }),
  ])
  const drawerIndex = views[0].drawer_user_id === hostUser.id ? 0 : 1
  const drawer = drawerIndex === 0 ? host : guest
  const word = views[drawerIndex].word_options?.[0]
  assert(word, 'A rajzoló nem kapott szóválasztási lehetőséget.')
  await rpc(drawer, 'choose_round_word', {
    selected_word: word,
    target_round_id: views[0].round_id,
  })

  const { data: activeRound, error: activeRoundError } = await host
    .from('game_rounds')
    .select('drawing_started_at, drawing_ends_at')
    .eq('id', views[0].round_id)
    .single()
  if (activeRoundError) throw activeRoundError
  const startedAt = Date.parse(activeRound.drawing_started_at)
  const endsAt = Date.parse(activeRound.drawing_ends_at)
  const durationSeconds = Math.round((endsAt - startedAt) / 1000)
  assert(durationSeconds === 45, `Az éles kör ${durationSeconds} másodpercre indult 45 helyett.`)

  const lateChange = await host.rpc('set_room_round_duration', {
    target_room_id: room.room_id,
    duration_seconds: 90,
  })
  assert(lateChange.error?.message.includes('GAME_ALREADY_STARTED'), 'Indulás után módosítható maradt a köridő.')

  console.log(JSON.stringify({
    event: 'round-duration-live-ok',
    players: 2,
    roomId: room.room_id,
    initialDurationSeconds: 30,
    activeDurationSeconds: durationSeconds,
    guestReadConfirmed: true,
    guestChangeBlocked: true,
    lateChangeBlocked: true,
    distinctUsers: hostUser.id !== guestUser.id,
  }))
} finally {
  await Promise.all([
    host.rpc('leave_room', { target_room_id: room.room_id }),
    guest.rpc('leave_room', { target_room_id: room.room_id }),
  ])
}
