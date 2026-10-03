// Synthetic component checks; no account, browser or network writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type))
  if (!tree || typeof tree !== 'object') return []
  return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (!tree || typeof tree === 'boolean') return ''
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree)
}
async function component(name, window = {}) {
  const source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', 'window', output)(name => {
    assert.equal(name, 'react/jsx-runtime')
    return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  }, exports, window)
  return exports
}

test('gallery tabs mark the current view and only navigate to the other view', async () => {
  const { GalleryNavigation, ChallengePeriodNavigation } = await component('GalleryNavigation')
  const calls = []
  const buttons = nodes(GalleryNavigation({ busy: false, view: 'wall', onSelectWall: () => calls.push('wall'), onSelectChallenges: () => calls.push('challenges') }), 'button')
  assert.equal(buttons[0].props['aria-pressed'], true)
  assert.equal(buttons[0].props.onClick, undefined)
  buttons[1].props.onClick()
  assert.deepEqual(calls, ['challenges'])
  const periods = nodes(ChallengePeriodNavigation({ busy: true, period: 'monthly', onSelectWeekly() {}, onSelectMonthly() {} }), 'button')
  assert.ok(periods.every(button => button.props.disabled))
  assert.equal(periods[1].props['aria-pressed'], true)
})

test('challenge summary uses server time and routes weekly/monthly entry buttons separately', async () => {
  const { CurrentChallengesSummary } = await component('CurrentChallengesSummary')
  const calls = []
  const common = { server_now: '2026-01-01T12:00:00Z', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-05T12:00:00Z' }
  const tree = CurrentChallengesSummary({ weeklyChallenge: { ...common, challenge_status: 'active', prompt: 'Synthetic weekly' }, monthlyChallenge: { ...common, challenge_status: 'voting', prompt: 'Synthetic monthly', submission_ends_at: '2026-01-03T12:00:00Z' }, onOpenWeekly: () => calls.push('weekly'), onOpenMonthly: () => calls.push('monthly') })
  assert.match(text(tree), /4 nap múlva vége/)
  assert.match(text(tree), /2 nap a nevezés végéig · szavazás folyamatban/)
  nodes(tree, 'button').forEach(button => button.props.onClick())
  assert.deepEqual(calls, ['weekly', 'monthly'])
  const legacy = CurrentChallengesSummary({ weeklyChallenge: null, monthlyChallenge: { ...common, challenge_status: 'drawing', voting_starts_at: '2026-01-02T12:00:00Z' }, onOpenWeekly() {}, onOpenMonthly() {} })
  assert.match(text(legacy), /1 nap a nevezés végéig/)
})

test('pagination waits for loading and honors reduced motion even if storage is blocked', async () => {
  let resolvePage
  const loaded = new Promise(resolve => { resolvePage = resolve })
  const events = []
  const { GalleryPagination } = await component('GalleryPagination', { matchMedia: () => ({ matches: true }), localStorage: { getItem() { throw new Error('blocked') } } })
  const tree = GalleryPagination({ currentPage: 1, totalItems: 7, onPageChange: async page => { events.push(page); await loaded } })
  const buttons = nodes(tree, 'button')
  assert.equal(buttons[0].props.disabled, true)
  buttons[1].props.onClick({ currentTarget: { closest: selector => { assert.equal(selector, '.weekly-gallery'); return { scrollIntoView: options => events.push(options) } } } })
  assert.deepEqual(events, [2])
  resolvePage()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [2, { behavior: 'auto', block: 'start' }])
  assert.equal(GalleryPagination({ currentPage: 1, totalItems: 6, onPageChange() {} }), null)
})
