// Synthetic client tests only. No real browser, network, email or account mutations.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function compile(path, modules) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  new Function('require', 'exports', output)(name => {
    assert.ok(name in modules, 'Unexpected dependency: ' + name)
    return modules[name]
  }, exports)
  return exports
}

const galleryModule = {
  CHALLENGE_GALLERY_PAGE_SIZE: 6,
  isMissingRpc: () => false,
  legacyDiscoveryScore: () => 0,
  loadGalleryComments: async () => [],
}

function challenge(overrides = {}) {
  return {
    challenge_id: 1,
    challenge_status: 'voting',
    description: null,
    ends_at: '2026-10-01T00:00:00Z',
    month_key: '2026-09',
    prompt: 'Synthetic',
    server_now: '2026-09-26T00:00:00Z',
    starts_at: '2026-09-01T00:00:00Z',
    submission_ends_at: '2026-09-25T00:00:00Z',
    voting_starts_at: '2026-09-24T00:00:00Z',
    ...overrides,
  }
}

test('monthly helper keeps new entry open while locking an already submitted image', async () => {
  const api = await compile('../src/lib/monthly.ts', {
    './supabase': { supabase: {} },
    './galleryComments': galleryModule,
  })
  const active = challenge()
  assert.equal(api.monthlyNewEntriesOpen(active), true)
  assert.equal(api.monthlyEntryCanBeEdited(active, null), true)
  assert.equal(api.monthlyEntryCanBeEdited(active, '2026-09-20T00:00:00Z'), false)
  assert.equal(api.monthlyNewEntriesOpen(challenge({ server_now: '2026-10-01T00:00:00Z' })), false)
  assert.equal(api.monthlyEntryCanBeEdited(challenge({ server_now: 'invalid' }), null), false)
})
async function weeklyApi({ session }) {
  const calls = []
  const api = await compile('../src/lib/weekly.ts', {
    './galleryComments': galleryModule,
    './supabase': { supabase: {
      auth: {
        signOut: async options => { calls.push(['signOut', options]); return { error: null } },
        signUp: async options => { calls.push(['signUp', options]); return { data: { session, user: { id: 'synthetic-user' } }, error: null } },
      },
      rpc: (name, args) => {
        calls.push(['rpc', name, args])
        return Promise.resolve({ data: 'Synthetic', error: null })
      },
    } },
  })
  return { api, calls }
}

test('registration works immediately when Supabase returns a session', async () => {
  const { api, calls } = await weeklyApi({ session: { access_token: 'synthetic' } })
  const result = await api.registerWeeklyAccount(' user@example.test ', 'password', ' Player ')
  assert.equal(result.confirmationRequired, false)
  assert.ok(calls.some(call => call[0] === 'rpc' && call[1] === 'set_weekly_profile'))
  assert.deepEqual(calls.find(call => call[0] === 'signUp')[1], {
    email: 'user@example.test',
    password: 'password',
    options: { data: { display_name: 'Player' } },
  })
})

test('registration keeps the confirmation fallback without creating a profile early', async () => {
  const { api, calls } = await weeklyApi({ session: null })
  const result = await api.registerWeeklyAccount('user@example.test', 'password', 'Player')
  assert.equal(result.confirmationRequired, true)
  assert.ok(!calls.some(call => call[0] === 'rpc'))
  assert.equal(api.suggestedProfileName({ user_metadata: { display_name: ' Player ' } }), 'Player')
  assert.equal(api.suggestedProfileName({ user_metadata: { display_name: 'x' } }), '')
})

test('both challenges expose official and custom palettes, and monthly entries remain open during voting', async () => {
  const [weekly, editor, monthly, pixelCanvas] = await Promise.all([
    readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(weekly, /allowColorMixer/)
  assert.match(weekly, /useState<EditorPaletteSize>\(32\)/)
  assert.match(monthly, /allowColorMixer/)
  assert.match(monthly, /useState<EditorPaletteSize>\(12\)/)
  assert.match(weekly, /Egyéni paletta/)
  assert.match(monthly, /Egyéni paletta/)
  assert.match(editor, /challenge_status === 'drawing' \|\| challenge\.challenge_status === 'voting'/)
  assert.match(editor, /A kevert színeket a heti és havi kihívás fogadja/)
  assert.match(monthly, /account\.submittedAt \? challenge\?\.submission_ends_at[^:]+: challenge\?\.ends_at/)
  assert.match(monthly, /Új nevezés:[\s\S]*Beküldött kép szerkesztése:[\s\S]*Szavazás:/)
  assert.match(pixelCanvas, /\{canvasSize\} × \{canvasSize\} pixel/)
  assert.doesNotMatch(pixelCanvas, />32 × 32 pixel</)
})
