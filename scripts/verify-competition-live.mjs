import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const playerCount = Number(process.argv[2] ?? 3)

if (!supabaseUrl || !supabaseKey) throw new Error('Hiányzó Supabase környezet.')
if (![3, 6].includes(playerCount)) throw new Error('A próba 3 vagy 6 játékossal futtatható.')

const palette = ['#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967', '#67ba62']
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
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
const signIn = async client => {
  const { data, error } = await client.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('Sikertelen anonim belépés.')
  return data.user
}
const rows = async (client, name, args) => {
  const { data, error } = await client.rpc(name, args)
  if (error) throw error
  return data
}

async function finishAfterDeadline(client, name, roundId, deadline, remainingCode) {
  while (true) {
    const result = await client.rpc(name, { target_round_id: roundId })
    if (!result.error) return Array.isArray(result.data) ? result.data[0] : result.data
    if (!result.error.message.includes(remainingCode)) throw result.error
    const remaining = Math.max(250, Date.parse(deadline) - Date.now() + 250)
    console.log(JSON.stringify({ event: 'competition-live-wait', playerCount, phase: name, remainingSeconds: Math.ceil(remaining / 1000) }))
    await sleep(Math.min(10_000, remaining))
  }
}

const clients = Array.from({ length: playerCount }, makeClient)
const users = await Promise.all(clients.map(signIn))
assert(new Set(users.map(user => user.id)).size === playerCount, 'A játékos-munkamenetek nem különültek el.')

const suffix = Date.now().toString(36).slice(-6)
let room = null

try {
  room = await rpc(clients[0], 'create_room_with_listing_settings', {
    player_name: `V${playerCount}P1${suffix}`.slice(0, 16),
    duration_seconds: 90,
    requested_game_mode: 'competition',
    requested_competition_draw_seconds: 60,
    requested_competition_round_count: 1,
    requested_palette_size: 12,
    requested_room_name: null,
    requested_is_public: false,
  })

  await Promise.all(clients.slice(1).map((client, index) => rpc(client, 'join_room', {
    player_name: `V${playerCount}P${index + 2}${suffix}`.slice(0, 16),
    room_code: room.room_code,
  })))

  await rpc(clients[0], 'start_competition_game', { target_room_id: room.room_id })
  const views = await Promise.all(clients.map(client => rpc(client, 'get_competition_round_view', {
    target_room_id: room.room_id,
  })))
  const roundId = views[0].round_id
  assert(views.every(view => view.round_id === roundId), 'A játékosok nem ugyanazt a fordulót látják.')
  assert(views.every(view => view.chosen_word === views[0].chosen_word), 'A játékosok nem ugyanazt a szót kapták.')
  assert(views.every(view => view.round_status === 'drawing'), 'A forduló nem rajzolással indult.')

  await Promise.all(clients.map((client, index) => rpc(client, 'submit_competition_pixel_changes', {
    pixel_changes: [{ x: index, y: index, color: palette[index] }],
    target_round_id: roundId,
  })))

  const privateStreams = await Promise.all(clients.map(client => rows(client, 'get_competition_draw_updates', {
    after_event_id: null,
    requested_limit: 500,
    target_round_id: roundId,
  })))
  assert(privateStreams.every(events => events.length === 1), 'Rajzolás közben láthatóvá vált egy másik játékos képe.')
  assert(new Set(privateStreams.map(events => events[0].drawing_id)).size === playerCount, 'A rajzok nem kaptak külön névtelen azonosítót.')

  const earlyVote = await clients[0].rpc('set_competition_vote', {
    target_drawing_id: privateStreams[1][0].drawing_id,
    target_round_id: roundId,
  })
  assert(earlyVote.error?.message.includes('VOTING_NOT_OPEN'), 'A szerver rajzolás közben elfogadott szavazatot.')

  const voting = await finishAfterDeadline(
    clients[0],
    'finish_competition_drawing',
    roundId,
    views[0].drawing_ends_at,
    'ROUND_TIME_REMAINING',
  )
  assert(voting.round_status === 'voting', 'A rajzolás után nem indult el a szavazás.')

  const [visibleStreams, votingResultsByPlayer] = await Promise.all([
    Promise.all(clients.map(client => rows(client, 'get_competition_draw_updates', {
      after_event_id: null,
      requested_limit: 500,
      target_round_id: roundId,
    }))),
    Promise.all(clients.map(client => rows(client, 'get_competition_results', {
      target_round_id: roundId,
    }))),
  ])
  assert(visibleStreams.every(events => events.length === playerCount), 'A szavazáskor nem jelent meg minden rajz.')
  assert(votingResultsByPlayer.every(results => results.length === playerCount), 'A szavazási lista nem teljes.')
  assert(votingResultsByPlayer.flat().every(result => result.display_name === null && result.vote_count === null), 'A név vagy eredmény idő előtt láthatóvá vált.')

  const ownDrawingIds = votingResultsByPlayer.map(results => {
    const own = results.filter(result => result.is_own)
    assert(own.length === 1, 'Nem azonosítható pontosan a játékos saját rajza.')
    return own[0].drawing_id
  })

  const selfVote = await clients[0].rpc('set_competition_vote', {
    target_drawing_id: ownDrawingIds[0],
    target_round_id: roundId,
  })
  assert(selfVote.error?.message.includes('SELF_VOTE_FORBIDDEN'), 'A szerver elfogadta a saját rajzra adott szavazatot.')

  await rpc(clients[0], 'set_competition_vote', {
    target_drawing_id: ownDrawingIds[2],
    target_round_id: roundId,
  })
  await rpc(clients[0], 'set_competition_vote', {
    target_drawing_id: ownDrawingIds[1],
    target_round_id: roundId,
  })
  await rpc(clients[1], 'set_competition_vote', {
    target_drawing_id: ownDrawingIds[0],
    target_round_id: roundId,
  })

  if (playerCount === 6) {
    await rpc(clients[2], 'set_competition_vote', { target_drawing_id: ownDrawingIds[0], target_round_id: roundId })
    await rpc(clients[3], 'set_competition_vote', { target_drawing_id: ownDrawingIds[2], target_round_id: roundId })
    await rpc(clients[4], 'set_competition_vote', { target_drawing_id: ownDrawingIds[2], target_round_id: roundId })
  }

  const reloadedView = await rpc(clients[0], 'get_competition_round_view', { target_room_id: room.room_id })
  assert(reloadedView.voted_for_drawing_id === ownDrawingIds[1], 'A módosított szavazat nem töltődött vissza.')

  const finished = await finishAfterDeadline(
    clients[1],
    'finish_competition_voting',
    roundId,
    voting.voting_ends_at,
    'VOTING_TIME_REMAINING',
  )
  assert(finished.round_status === 'finished', 'A szavazás után nem zárult le a forduló.')

  const finalResults = await rows(clients[0], 'get_competition_results', { target_round_id: roundId })
  assert(finalResults.every(result => result.display_name !== null && result.vote_count !== null), 'Lezárás után hiányzik a név vagy szavazatszám.')
  assert(finalResults.reduce((sum, result) => sum + result.vote_count, 0) === playerCount - 1, 'A módosított vagy hiányzó szavazatot rosszul számolta a szerver.')
  const maxVotes = Math.max(...finalResults.map(result => result.vote_count))
  assert(finalResults.filter(result => result.vote_count === maxVotes).length === 2, 'A holtversenyt nem őrizte meg a szerver.')

  const { data: scoreRows, error: scoreError } = await clients[0]
    .from('room_players')
    .select('score')
    .eq('room_id', room.room_id)
  if (scoreError) throw scoreError
  assert(scoreRows.reduce((sum, player) => sum + player.score, 0) === playerCount - 1, 'A pontszámok nem egyeznek a végleges szavazatokkal.')

  const advanced = await finishAfterDeadline(
    clients[0],
    'advance_competition_game',
    roundId,
    new Date(Date.parse(finished.finished_at) + 5_000).toISOString(),
    'ROUND_TRANSITION_PENDING',
  )
  assert(advanced.room_status === 'finished', 'Az egyfordulós verseny nem zárta le a szobát.')

  console.log(JSON.stringify({
    event: 'competition-live-ok',
    playerCount,
    distinctUsers: true,
    hiddenDuringDrawing: true,
    anonymousVoting: true,
    selfVoteBlocked: true,
    changedVoteCountedOnce: true,
    missingVoterHandled: true,
    tiedWinners: 2,
    totalVotes: playerCount - 1,
  }))
} finally {
  if (room) {
    for (const client of clients) {
      await client.rpc('leave_room', { target_room_id: room.room_id })
    }
  }
}
