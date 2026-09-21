import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { createDrawingSaveQueue } from '../src/lib/drawingSaveQueue.ts'
import {
  clearChallengeDraft,
  loadChallengeDraft,
  saveChallengeDraft,
} from '../src/lib/challengeDrafts.ts'

const emptyDrawing = () => Array(1024).fill('transparent')
const turn = () => new Promise(resolve => setImmediate(resolve))

test('drawing saves stay ordered when the older request finishes slowly', async () => {
  const requests = []
  const completed = []
  const queue = createDrawingSaveQueue({
    save: (_key, pixels) => new Promise(resolve => {
      requests.push({ pixels, resolve: () => { completed.push(pixels[0]); resolve() } })
    }),
  })

  queue.schedule(1, ['old'])
  const first = queue.flush()
  await turn()
  queue.schedule(1, ['new'])
  const second = queue.flush()
  await turn()
  assert.equal(requests.length, 1)

  requests[0].resolve()
  await turn()
  assert.equal(requests.length, 2)
  requests[1].resolve()
  await Promise.all([first, second])

  assert.deepEqual(completed, ['old', 'new'])
  assert.equal(queue.hasUnsavedChanges(), false)
})

test('a failed drawing save remains pending and can be retried', async () => {
  let attempts = 0
  const queue = createDrawingSaveQueue({
    save: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary failure')
    },
  })

  queue.schedule(1, ['latest'])
  await assert.rejects(queue.flush(), /temporary failure/)
  assert.equal(queue.hasUnsavedChanges(), true)
  await queue.flush()
  assert.equal(attempts, 2)
  assert.equal(queue.hasUnsavedChanges(), false)
})

test('an unsent challenge drawing survives reload and only its saved version is cleared', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
  const first = emptyDrawing(); first[0] = '#d3493b'
  const newer = [...first]; newer[1] = '#67ba62'

  assert.equal(saveChallengeDraft('weekly', 'player-1', 7, first, storage), true)
  assert.deepEqual(loadChallengeDraft('weekly', 'player-1', 7, storage)?.pixels, first)
  assert.equal(saveChallengeDraft('weekly', 'player-1', 7, newer, storage), true)
  assert.equal(clearChallengeDraft('weekly', 'player-1', 7, first, storage), false)
  assert.deepEqual(loadChallengeDraft('weekly', 'player-1', 7, storage)?.pixels, newer)
  assert.equal(clearChallengeDraft('weekly', 'player-1', 7, newer, storage), true)
  assert.equal(loadChallengeDraft('weekly', 'player-1', 7, storage), null)
})

test('a temporary auth error preserves an existing local session', async () => {
  const source = await readFile(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
  const body = source
    .slice(source.indexOf('export async function ensurePlayerSession()'), source.indexOf('export async function checkSupabaseConnection'))
    .replace('export ', '')
  const calls = []
  const networkError = new Error('temporary network failure')
  const fakeClient = { auth: {
    getUser: async () => ({ data: { user: null }, error: networkError }),
    getSession: async () => ({ data: { session: { access_token: 'existing' } }, error: null }),
    signOut: async () => { calls.push('sign-out') },
    signInAnonymously: async () => { calls.push('anonymous'); return { data: { user: { id: 'new' } }, error: null } },
  } }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const run = new AsyncFunction('supabase', `${body}; return ensurePlayerSession()`)

  await assert.rejects(run(fakeClient), /temporary network failure/)
  assert.deepEqual(calls, [])
})

test('the profile dialog owns Escape before the background page', async () => {
  const [profile, comments] = await Promise.all([
    readFile(new URL('../src/components/ProfilePreviewButton.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/GalleryComments.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(profile, /event\.stopImmediatePropagation\(\)/)
  assert.match(profile, /addEventListener\('keydown', handleKeyDown, true\)/)
  assert.match(comments, /document\.querySelector\('\.profile-preview-modal'\)/)
})

test('home navigation restores history state and escapes stale duplicate entries', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(source, /useState<HomeView>\(historyHomeView\)/)
  assert.match(source, /pushState\(\{ \.\.\.historyState\(\), bitscrawlHomeView: view \}/)
  assert.match(source, /requestedHomeBackTargetRef\.current = fallback/)
  assert.match(source, /if \(nextView === homeView\) \{[\s\S]*requestedBackTarget !== null[\s\S]*setHomeView\(requestedBackTarget\)/)
})

test('a selected gallery vote uses one plain color instead of layered button artwork', async () => {
  const css = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
  const selectedVoteRule = css.match(/\.weekly-entry > button\[aria-pressed='true'\] \{([^}]*)\}/)?.[1] ?? ''
  assert.match(selectedVoteRule, /background-color:\s*var\(--olive\)/)
  assert.match(selectedVoteRule, /background-image:\s*none/)
  assert.doesNotMatch(selectedVoteRule, /url\(/)
})

test('gallery defaults to most-liked while discovery receives a fresh random order', async () => {
  const weeklyDraw = await readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8')

  assert.match(weeklyDraw, /useState<GallerySort>\('likes'\)/)
  assert.match(weeklyDraw, /function createDiscoverySeed\(\)[\s\S]*?Math\.random\(\)/)
  assert.match(weeklyDraw, /discoveryScore\(first, discoverySeed\) - discoveryScore\(second, discoverySeed\)/)
  assert.match(weeklyDraw, /nextSort === 'discovery'\) setDiscoverySeed\(createDiscoverySeed\(\)\)/)
  assert.match(weeklyDraw, /<option value="likes">Legkedveltebb<\/option><option value="discovery">Felfedezés<\/option>/)
})

test('mobile guessers keep a compact guess dock visible below the live drawing and room chat', async () => {
  const [app, chat, roomChat, css] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/RoundChat.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/RoomChat.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
  ])
  assert.match(app, /round-play-area \$\{roundView\.is_drawer \? 'is-drawer' : 'is-guesser'\}/)
  assert.match(app, /avoidGuessBar=\{!roundView\.is_drawer\}/)
  assert.match(chat, /canSubmitGuess \? 'is-guessing' : ''/)
  assert.match(roomChat, /avoidGuessBar \? ' has-guess-bar' : ''/)
  assert.match(css, /\.round-play-area\.is-guesser \.guess-panel\.is-guessing\s*\{[\s\S]*?position:\s*fixed[\s\S]*?z-index:\s*1200/)
  assert.match(css, /\.mobile-chat-toggle\.has-guess-bar\s*\{[^}]*bottom:\s*calc\(/)
  assert.match(css, /\.room-chat\.has-guess-bar\s*\{[^}]*bottom:\s*calc\(/)
  assert.match(css, /\.round-play-area \.guess-panel\s*\{[\s\S]*?order:\s*1/)
})

test('very narrow phones keep the guess input readable beside a compact send button', async () => {
  const [chat, css] = await Promise.all([
    readFile(new URL('../src/components/RoundChat.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
  ])

  assert.match(chat, /className="guess-submit-long">Tipp küldése/)
  assert.match(chat, /className="guess-submit-short">Küldés/)
  assert.match(css, /@media \(max-width: 400px\)[\s\S]*?\.guess-panel\.is-guessing \.round-chat-heading\s*\{\s*display:\s*none;/)
  assert.match(css, /@media \(max-width: 400px\)[\s\S]*?\.guess-panel\.is-guessing \.guess-form\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) 78px;/)
  assert.match(css, /@media \(max-width: 400px\)[\s\S]*?\.guess-panel\.is-guessing \.guess-form input\s*\{[\s\S]*?max-width:\s*100%;/)
})

test('the same guess form stays available over immersive canvas on desktop and mobile', async () => {
  const [app, canvas, chat, css] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/RoundChat.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
  ])
  assert.match(app, /onImmersiveChange=\{setIsRoundCanvasImmersive\}/)
  assert.match(app, /isImmersive=\{isRoundCanvasImmersive\}/)
  assert.match(canvas, /onImmersiveChange\?\.\(isImmersive\)/)
  assert.match(chat, /isImmersive \? 'is-immersive' : ''/)
  assert.match(css, /\.guess-panel\.is-immersive\.is-guessing\s*\{[\s\S]*?z-index:\s*1200/)
})

test('failed multiplayer pixel chunks stay queued for a later retry', async () => {
  const source = await readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8')
  assert.match(source, /if \(!pendingChangesRef\.current\.has\(key\)\) pendingChangesRef\.current\.set\(key, change\)/)
  assert.match(source, /if \(pendingChangesRef\.current\.size\) flushPendingChangesRef\.current\(\)/)
  assert.match(source, /addEventListener\('online', retryPendingChanges\)/)
})

function hookRuntime() {
  let position = 0
  const slots = []
  const effects = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => value === b[index])
  const api = {
    useState(initial) {
      const index = position++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) {
      const index = position++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo(factory, dependencies) {
      const index = position++
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        slots[index] = { dependencies, value: factory() }
      }
      return slots[index].value
    },
    useCallback(callback, dependencies) { return api.useMemo(() => callback, dependencies) },
    useEffect(callback, dependencies) {
      const index = position++
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) {
        const cleanup = slots[index]?.cleanup
        slots[index] = { dependencies }
        effects.push(() => { cleanup?.(); slots[index].cleanup = callback() })
      }
    },
  }
  return {
    api,
    flushEffects: () => { for (const effect of effects.splice(0)) effect() },
    render: callback => { position = 0; return callback() },
  }
}

function nodes(tree, type) {
  if (!tree) return []
  if (Array.isArray(tree)) return tree.flatMap(item => nodes(item, type))
  if (typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)]
}

async function loadComponent(file, imports, hooks) {
  let source = await readFile(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
  source = source.replace('function WeeklyDrawContent(', 'export function WeeklyDrawContent(')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  const available = {
    react: hooks.api,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    '../lib/drawing': { emptyDrawing },
    '../lib/drawingSaveQueue': { createDrawingSaveQueue },
    '../lib/challengeDrafts': {
      clearChallengeDraft: () => true,
      loadChallengeDraft: () => null,
      saveChallengeDraft: () => true,
    },
    '../lib/weekly': { getWeeklyUser: async () => ({ id: 'audit-user', user_metadata: { display_name: 'Audit' } }) },
    './PixelCanvas': { PixelCanvas: 'PixelCanvas' },
    './GalleryPagination': { GALLERY_PAGE_SIZE: 6, GalleryPagination: 'Pagination' },
    ...imports,
  }
  new Function('require', 'exports', 'window', output)(name => available[name] ?? {}, module.exports, {
    addEventListener() {}, removeEventListener() {},
  })
  return module.exports
}

test('monthly editor stays closed when the saved drawing fails to load', async () => {
  const hooks = hookRuntime()
  const component = await loadComponent('MonthlyDraw.tsx', {
    '../lib/monthly': {
      loadMonthlyChallenges: async () => [{ challenge_id: 1, challenge_status: 'drawing', prompt: 'Audit', starts_at: '2026-09-01T00:00:00Z', voting_starts_at: '2026-09-24T00:00:00Z', ends_at: '2026-10-01T00:00:00Z' }],
      loadMonthlyGallery: async () => [],
      loadMonthlyAccountState: async () => { throw new Error('simulated account load failure') },
    },
  }, hooks)

  hooks.render(() => component.MonthlyDraw({ mode: 'challenge', onBack() {}, onSelectWeekly() {} }))
  hooks.flushEffects()
  await turn()
  const tree = hooks.render(() => component.MonthlyDraw({ mode: 'challenge', onBack() {}, onSelectWeekly() {} }))
  assert.equal(nodes(tree, 'PixelCanvas').length, 0)
  assert(nodes(tree, 'button').some(button => button.props.children === 'Betöltés újra'))
})

test('weekly editor stays unmounted while the newly selected draft is loading', async () => {
  const hooks = hookRuntime()
  let resolveAccount
  let hold = false
  const delayedAccount = new Promise(resolve => { resolveAccount = resolve })
  const challenges = [
    { challenge_id: 2, challenge_status: 'active', prompt: 'New', starts_at: '2026-09-21T00:00:00Z', ends_at: '2026-09-28T00:00:00Z' },
    { challenge_id: 1, challenge_status: 'closed', prompt: 'Old', starts_at: '2026-09-14T00:00:00Z', ends_at: '2026-09-20T00:00:00Z' },
  ]
  const oldDrawing = emptyDrawing(); oldDrawing[0] = '#d3493b'
  const newDrawing = emptyDrawing(); newDrawing[0] = '#67ba62'
  const account = id => ({ profileName: 'Audit', entryId: null, entryPixels: null, draftPixels: id === 1 ? oldDrawing : newDrawing, votesUsed: 0 })
  const component = await loadComponent('WeeklyDraw.tsx', {
    '../lib/weekly': {
      getWeeklyUser: async () => ({ id: 'audit-user', user_metadata: { display_name: 'Audit' } }),
      loadWeeklyChallenges: async () => challenges,
      loadWeeklyGallery: async () => [],
      loadWeeklyAccountState: async id => hold ? delayedAccount : account(id),
      saveWeeklyDraft: async () => undefined,
    },
  }, hooks)
  const render = () => hooks.render(() => component.WeeklyDrawContent({ mode: 'challenge', onBack() {}, onSelectMonthly() {} }))

  render(); hooks.flushEffects(); await turn()
  let tree = render()
  nodes(tree, 'select')[0].props.onChange({ target: { value: '1' } })
  await turn(); await turn(); tree = render()
  hold = true
  nodes(tree, 'select')[0].props.onChange({ target: { value: '2' } })
  await turn()
  tree = render()
  assert.equal(nodes(tree, 'PixelCanvas').length, 0)

  resolveAccount(account(2))
  await turn(); await turn()
  tree = render()
  const canvas = nodes(tree, 'PixelCanvas')[0]
  assert.equal(canvas.props.roundId, 2)
  assert.deepEqual(canvas.props.localDrawing.initialPixels, newDrawing)
})
