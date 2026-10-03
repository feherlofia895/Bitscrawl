import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createPixelSendQueue } from '../src/lib/pixelSendQueue.ts'
import { loadCompetitionDrawingStream, mergeCompetitionDrawEvents } from '../src/lib/competitionDrawingStream.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))
const pixel = (color, x = 0, y = 0) => ({ x, y, color })
const event = (id, drawing = 'first', changes = [pixel(String(id))]) => ({
  id, round_id: 1, drawing_id: drawing, changes,
})

test('failed old pixel cannot be retried over a newer successful pixel', async () => {
  const queue = createPixelSendQueue()
  const retries = []
  let rejectOld
  let stored
  const old = queue.enqueue({ changes: [pixel('red')], submit: () => new Promise((_, reject) => { rejectOld = reject }), onError: (_, changes) => retries.push(...changes) })
  await tick()
  const newer = queue.enqueue({ changes: [pixel('blue')], submit: async changes => { stored = changes[0].color }, onError: (_, changes) => retries.push(...changes) })
  rejectOld(new Error('temporary failure'))
  await Promise.all([old, newer])
  assert.equal(stored, 'blue')
  assert.deepEqual(retries, [])
})

test('only the newest failed version is returned for retry', async () => {
  const queue = createPixelSendQueue()
  const retries = []
  const options = { submit: async () => { throw new Error('offline') }, onError: (_, changes) => retries.push(...changes) }
  const first = queue.enqueue({ ...options, changes: [pixel('red')] })
  const second = queue.enqueue({ ...options, changes: [pixel('blue')] })
  await Promise.all([first, second])
  assert.deepEqual(retries, [pixel('blue')])
})

test('failure keeps unchanged coordinates while discarding superseded ones', async () => {
  const queue = createPixelSendQueue()
  const retries = []
  const first = queue.enqueue({ changes: [pixel('red'), pixel('green', 1)], submit: async () => { throw new Error('offline') }, onError: (_, changes) => retries.push(...changes) })
  const second = queue.enqueue({ changes: [pixel('blue')], submit: async () => {}, onError: assert.fail })
  await Promise.all([first, second])
  assert.deepEqual(retries, [pixel('green', 1)])
})

test('single failed pixel remains retryable and send order is preserved', async () => {
  const queue = createPixelSendQueue()
  let retry
  const calls = []
  await queue.enqueue({ changes: [pixel('transparent')], submit: async () => { calls.push('failed'); throw new Error('offline') }, onError: (_, changes) => { retry = changes } })
  await queue.enqueue({ changes: retry, submit: async changes => { calls.push(changes[0].color) }, onError: assert.fail })
  assert.deepEqual(calls, ['failed', 'transparent'])
})

test('round reset drops queued old work and does not retry an old in-flight error', async () => {
  const queue = createPixelSendQueue()
  const calls = []
  let rejectOld
  const first = queue.enqueue({ changes: [pixel('red')], submit: () => new Promise((_, reject) => { calls.push('old'); rejectOld = reject }), onError: assert.fail })
  await tick()
  const queued = queue.enqueue({ changes: [pixel('green')], submit: async () => { calls.push('stale') }, onError: assert.fail })
  queue.reset()
  const next = queue.enqueue({ changes: [pixel('blue')], submit: async () => { calls.push('new') }, onError: assert.fail })
  rejectOld(new Error('old round expired'))
  await Promise.all([first, queued, next])
  assert.deepEqual(calls, ['old', 'new'])
})

test('queued sender and pixels are snapshots, not mutable caller state', async () => {
  const queue = createPixelSendQueue()
  const changes = [pixel('red')]
  let sender = async sent => { assert.equal(sent[0].color, 'red') }
  const sending = queue.enqueue({ changes, submit: sender, onError: assert.fail })
  changes[0].color = 'blue'
  sender = async () => { assert.fail('must not call replacement sender') }
  await sending
})

test('competition loader drains more than 500 events across multiple drawings', async () => {
  const events = Array.from({ length: 1601 }, (_, i) => event(i + 1, i % 2 ? 'first' : 'second', [pixel(i === 1600 ? 'transparent' : String(i), i % 32, Math.floor(i / 32) % 32)]))
  const cursors = []
  const snapshots = await loadCompetitionDrawingStream(async (cursor, limit) => {
    cursors.push(cursor)
    return events.filter(row => cursor === null || row.id > cursor).slice(0, limit)
  })
  assert.deepEqual(cursors, [null, 500, 1000, 1500])
  assert.equal(snapshots.length, 2)
  for (const drawing of ['first', 'second']) {
    const expected = new Map()
    for (const row of events.filter(row => row.drawing_id === drawing)) {
      for (const change of row.changes) expected.set(change.y * 32 + change.x, change)
    }
    const actual = new Map(snapshots.find(row => row.drawing_id === drawing).changes.map(change => [change.y * 32 + change.x, change]))
    assert.deepEqual(actual, expected)
  }
  assert.equal(Math.max(...snapshots.map(row => row.id)), 1601)
})

test('exactly 500 events fetch the terminating page, and delta loads use their cursor', async () => {
  const events = Array.from({ length: 500 }, (_, i) => event(i + 11))
  const cursors = []
  const result = await loadCompetitionDrawingStream(async (cursor, limit) => {
    cursors.push(cursor)
    return events.filter(row => row.id > cursor).slice(0, limit)
  }, 10)
  assert.deepEqual(cursors, [10, 510])
  assert.equal(result[0].id, 510)
})

test('a later page failure rejects the whole load instead of returning partial images', async () => {
  await assert.rejects(loadCompetitionDrawingStream(async cursor => {
    if (cursor !== null) throw new Error('offline')
    return Array.from({ length: 500 }, (_, i) => event(i + 1))
  }), /offline/)
})

test('invalid or stuck cursors fail without a pagination loop', async () => {
  await assert.rejects(loadCompetitionDrawingStream(async () => [event(10)], 10), /CURSOR_INVALID/)
  await assert.rejects(loadCompetitionDrawingStream(async () => [event(2), event(1)]), /CURSOR_INVALID/)
  assert.deepEqual(await loadCompetitionDrawingStream(async () => []), [])
})

test('compacting deltas preserves old pixels, erasures and separate round/drawing identities', () => {
  const original = [event(1, 'first', [pixel('red'), pixel('green', 1)])]
  const merged = mergeCompetitionDrawEvents(original, [event(1001, 'first', [pixel('transparent')]), event(1002, 'second', [pixel('blue')])])
  assert.deepEqual(merged.find(row => row.drawing_id === 'first').changes, [pixel('transparent'), pixel('green', 1)])
  assert.deepEqual(original[0].changes, [pixel('red'), pixel('green', 1)])
  assert.equal(mergeCompetitionDrawEvents(merged, [{ ...event(2000), round_id: 2 }]).length, 3)
})

test('canvas and competition integration use versioned sends and complete snapshots', async () => {
  const [canvas, app, game] = await Promise.all([
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/competitionGame.ts', import.meta.url), 'utf8'),
  ])
  assert.match(canvas, /retryChanges\.forEach/)
  assert.match(canvas, /if \(!pendingChangesRef\.current\.has\(key\)\)/)
  assert.match(canvas, /sendQueueRef\.current\?\.reset\(\)/)
  assert.match(app, /mergeCompetitionDrawEvents\(current, updates\)/)
  assert.doesNotMatch(app, /mergeRecentById\(current, updates, 500\)/)
  assert.match(game, /return await loadCompetitionDrawingStream/)
})
