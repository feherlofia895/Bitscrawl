import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function library({ ensurePlayerSession, rpc }) {
  const source = await readFile(new URL('../src/lib/bugReports.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  const navigator = { language: 'hu-HU', onLine: true, userAgent: 'Automated browser' }
  const window = {
    innerHeight: 844,
    innerWidth: 390,
    location: { href: 'https://bitscrawl.pages.dev/' },
    screen: { height: 844, width: 390 },
  }
  new Function(
    'require', 'exports', '__BITSCRAWL_BUILD_ID__', 'navigator', 'window', output,
  )(
    (name) => {
      assert.equal(name, './supabase')
      return { ensurePlayerSession, supabase: { rpc } }
    },
    exports,
    'CLIENT_TEST_BUILD',
    navigator,
    window,
  )
  return exports
}

const input = {
  category: 'idea',
  description: '  Legyen még több pixel!  ',
  playerName: '  Tesztelő  ',
  roomCode: null,
  roomId: null,
  roundId: null,
  roundStatus: null,
  steps: '',
}

test('client submits feedback only through the RPC without an owner id', async () => {
  const calls = []
  const api = await library({
    ensurePlayerSession: async () => ({ id: 'client-user-id' }),
    rpc: async (name, args) => {
      calls.push([name, args])
      return { data: 7, error: null }
    },
  })
  await api.submitBugReport(input)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'submit_bug_report')
  assert.equal('user_id' in calls[0][1], false)
  assert.deepEqual(calls[0][1], {
    requested_category: 'idea',
    requested_description: 'Legyen még több pixel!',
    requested_reporter_name: 'Tesztelő',
    requested_room_code: null,
    requested_room_id: null,
    requested_steps: null,
    requested_technical_context: {
      build_id: 'CLIENT_TEST_BUILD',
      captured_at: calls[0][1].requested_technical_context.captured_at,
      language: 'hu-HU',
      online: true,
      page_url: 'https://bitscrawl.pages.dev/',
      round_id: null,
      round_status: null,
      screen: '390x844',
      user_agent: 'Automated browser',
      viewport: '390x844',
    },
  })
})

test('client translates rate limits and keeps unexpected server details private', async () => {
  const session = async () => ({ id: 'client-user-id' })
  const limited = await library({
    ensurePlayerSession: session,
    rpc: async () => ({ data: null, error: { message: 'BUG_REPORT_RATE_LIMIT' } }),
  })
  await assert.rejects(limited.submitBugReport(input), /Túl sok visszajelzést/)

  const unexpected = await library({
    ensurePlayerSession: session,
    rpc: async () => ({ data: null, error: { message: 'secret database detail' } }),
  })
  await assert.rejects(
    unexpected.submitBugReport(input),
    (error) => error.message.includes('Ellenőrizd az internetkapcsolatot')
      && !error.message.includes('secret database detail'),
  )
})
