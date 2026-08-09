import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!supabaseUrl || !supabaseKey) throw new Error('Hiányzó Supabase környezet.')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const playerCount = Number.parseInt(process.argv[2] ?? '4', 10)
assert(Number.isInteger(playerCount) && playerCount >= 2 && playerCount <= 6,
  'A játékosszám 2 és 6 közötti egész szám legyen.')
const roundCount = playerCount * 3
const makeClient = () => createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const rpc = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return Array.isArray(data) ? data[0] : data
}

const clients = Array.from({ length: playerCount }, makeClient)
const users = await Promise.all(clients.map(async (client) => {
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('Sikertelen anonim belépés.')
  return data.user
}))

const room = await rpc(clients[0], 'create_room', { player_name: 'SimHost' })
try {
  await Promise.all(clients.slice(1).map((client, index) =>
    rpc(client, 'join_room', {
      player_name: `SimPlayer${index + 2}`,
      room_code: room.room_code,
    }),
  ))
  await rpc(clients[0], 'set_room_test_mode', {
    target_room_id: room.room_id,
    test_mode_enabled: true,
  })
  await rpc(clients[0], 'start_game', { target_room_id: room.room_id })

  const drawers = new Set()
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    await Promise.all(clients.map((client) =>
      rpc(client, 'touch_room_presence', { target_room_id: room.room_id }),
    ))
    const views = await Promise.all(clients.map((client) =>
      rpc(client, 'get_round_view', { target_room_id: room.room_id }),
    ))
    const drawerIndex = users.findIndex((user) => user.id === views[0].drawer_user_id)
    assert(drawerIndex >= 0, `A(z) ${roundNumber}. kör rajzolója nincs a szobában.`)
    drawers.add(drawerIndex)
    views.forEach((view, index) => {
      assert(view.round_number === roundNumber, `Hibás körszám: ${view.round_number}.`)
      assert(index === drawerIndex ? view.word_options?.length === 3 : view.word_options === null,
        `A titkos szólista láthatósága hibás a(z) ${roundNumber}. körben.`)
    })

    const word = views[drawerIndex].word_options[0]
    await rpc(clients[drawerIndex], 'choose_round_word', {
      selected_word: word,
      target_round_id: views[0].round_id,
    })
    await rpc(clients[drawerIndex], 'submit_pixel_changes', {
      pixel_changes: [
        { x: roundNumber % 32, y: drawerIndex, color: '#d3493b' },
        { x: (roundNumber + 1) % 32, y: drawerIndex, color: '#230a19' },
      ],
      target_round_id: views[0].round_id,
    })

    const guesserIndexes = clients.map((_, index) => index).filter((index) => index !== drawerIndex)
    const wrong = await rpc(clients[guesserIndexes[0]], 'submit_guess', {
      submitted_guess: `hibás-${roundNumber}`,
      target_round_id: views[0].round_id,
    })
    assert(!wrong.is_correct && wrong.message_id === null,
      `A hibás megfejtés kiszivárgott a(z) ${roundNumber}. körben.`)

    for (const [position, guesserIndex] of guesserIndexes.entries()) {
      const result = await rpc(clients[guesserIndex], 'submit_guess', {
        submitted_guess: position === 0 ? word.toLocaleUpperCase('hu-HU') : word,
        target_round_id: views[0].round_id,
      })
      assert(result.is_correct, `A helyes megfejtés elutasítva a(z) ${roundNumber}. körben.`)
      assert(result.round_finished === (position === guesserIndexes.length - 1),
        `A kör túl korán vagy későn zárult a(z) ${roundNumber}. körben.`)
    }

    const events = await clients[guesserIndexes[0]]
      .from('round_draw_events')
      .select('id')
      .eq('round_id', views[0].round_id)
    if (events.error) throw events.error
    assert(events.data.length > 0, `A rajz nem jutott el a nézőkhöz a(z) ${roundNumber}. körben.`)

    await wait(5_200)
    const advance = await rpc(clients[0], 'advance_game', {
      target_round_id: views[0].round_id,
    })
    assert(
      advance.room_status === (roundNumber === roundCount ? 'finished' : 'playing'),
      `Hibás meccsállapot a(z) ${roundNumber}. kör után: ${advance.room_status}.`,
    )
  }

  assert(drawers.size === playerCount, 'Nem került sorra minden rajzoló.')
  const scores = await clients[0]
    .from('room_players')
    .select('user_id, score')
    .eq('room_id', room.room_id)
  if (scores.error) throw scores.error
  assert(scores.data.length === playerCount, 'A meccs végére nem maradt meg minden játékos.')
  assert(scores.data.every((player) => player.score > 0), 'Valamelyik játékos nem kapott pontot.')

  console.log(JSON.stringify({
    event: 'multiplayer-game-ok',
    players: playerCount,
    rounds: roundCount,
    roomId: room.room_id,
    allPlayersDrew: drawers.size === playerCount,
    scores: scores.data.map((player) => player.score),
  }))
} finally {
  for (const client of clients) {
    await client.rpc('leave_room', { target_room_id: room.room_id })
  }
}
