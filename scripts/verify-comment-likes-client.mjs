// Mocked client/component logic only; no real network, session, or browser mutations.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function compile(path, modules, document = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  new Function('require', 'exports', 'document', output)(name => {
    assert.ok(name in modules, 'Unexpected dependency: ' + name)
    return modules[name]
  }, exports, document)
  return exports
}
const library = rpc => compile('../src/lib/galleryComments.ts', { './supabase': { supabase: { rpc } } })
test('comment actions have compact styles without replacing edit-button styles', async () => {
  const css = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.match(css, /\.gallery-comment-actions\s*\{[^}]*display:\s*flex/)
  assert.match(css, /\.gallery-comment-like-button\s*\{[^}]*min-height:\s*30px/)
  assert.match(css, /\.gallery-comment-like-button\[aria-pressed='true'\]/)
  assert.doesNotMatch(css, /\.gallery-comment-edit button,\s*\.gallery-comment-actions/)
})
const comments = n => Array.from({ length: n }, (_, i) => ({ comment_id: i + 1, content: 'Synthetic' }))

test('hydration keeps comment order and safely defaults missing counts', async () => {
  const api = await library(async (name, args) => {
    assert.equal(name, 'get_comment_like_states')
    assert.equal(args.target_kind, 'feed')
    return { data: [{ comment_id: 2, like_count: -3, has_liked: false }, { comment_id: 1, like_count: 7, has_liked: true }], error: null }
  })
  const result = await api.hydrateCommentLikes('feed', comments(3))
  assert.deepEqual(result.map(c => [c.comment_id, c.like_count, c.has_liked]), [[1, 7, true], [2, 0, false], [3, 0, false]])
})

test('empty hydration skips RPC and missing endpoint falls back without hiding comments', async () => {
  let calls = 0
  const api = await library(async () => { calls++; return { error: { code: 'PGRST202', message: 'get_comment_like_states missing' } } })
  assert.deepEqual(await api.hydrateCommentLikes('gallery', []), [])
  assert.equal(calls, 0)
  assert.deepEqual((await api.hydrateCommentLikes('gallery', comments(1))).map(c => [c.like_count, c.has_liked]), [[0, false]])
})

test('large comment lists respect the 100-ID server limit without losing comments', async () => {
  const batches = []
  const api = await library(async (_name, args) => {
    batches.push(args.target_comment_ids)
    assert.ok(args.target_comment_ids.length <= 100)
    return { data: args.target_comment_ids.map(id => ({ comment_id: id, like_count: id, has_liked: true })), error: null }
  })
  const result = await api.hydrateCommentLikes('gallery', comments(205))
  assert.deepEqual(batches.map(batch => batch.length), [100, 100, 5])
  assert.equal(result.length, 205)
  assert.deepEqual(result.map(c => c.like_count), Array.from({length:205}, (_, i) => i + 1))
})

test('RPC errors surface and successful toggles use server counts', async () => {
  const failing = await library(async () => ({ error: { message: 'COMMENT_KIND_INVALID' } }))
  await assert.rejects(failing.hydrateCommentLikes('feed', comments(1)), /kommentreakció/)
  const api = await library((name, args) => {
    assert.equal(name, 'set_comment_like')
    assert.deepEqual(args, { like_enabled: false, target_comment_id: 9, target_kind: 'feed' })
    return { single: async () => ({ data: { liked: false, active_like_count: 4 }, error: null }) }
  })
  assert.deepEqual(await api.setCommentLike('feed', 9, false), { liked: false, likeCount: 4 })
})

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate))
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]
}
async function panel({ isSignedIn = true, reactToComment = async () => ({ liked:true, likeCount:1 }) } = {}) {
  let cursor = 0
  const state = []
  const react = {
    useState(value) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof value === 'function' ? value() : value
      return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }]
    },
    useRef(value) { const i = cursor++; if (!(i in state)) state[i] = {current:value}; return state[i] },
    useCallback: fn => fn,
    useEffect() {}, // Focus/lifecycle behavior is deliberately not claimed by this test.
    useId: () => 'synthetic-title',
  }
  const api = await compile('../src/components/GalleryComments.tsx', {
    react,
    'react-dom': {createPortal: value => value},
    'react/jsx-runtime': {jsx:(type, props)=>({type,props}), jsxs:(type, props)=>({type,props}), Fragment:'Fragment'},
    '../lib/galleryComments': {GALLERY_COMMENT_PAGE_SIZE:20, setCommentLike:reactToComment},
    './ProfileAvatar': {ProfileAvatar:'Avatar'},
    './ProfilePreviewButton': {ProfilePreviewButton:'Profile'},
    './ConfirmModal': {ConfirmModal:'ConfirmModal'},
  }, {body:{}})
  const props = {busy:false, isSignedIn, artworkAuthor:'Synthetic', reactionKind:'feed', onSubmit:async()=>{}, onUpdate:async()=>{}, comments:[{comment_id:7, author_name:'Synthetic', created_at:'2026-01-01T00:00:00Z', content:'Test', like_count:0, has_liked:false, is_own:false}]}
  const render = () => {cursor=0;return api.GalleryComments(props)}
  nodes(render(), n=>n.props?.className==='gallery-comments-toggle')[0]?.props.onClick()
  return {
    render,
    heart: () => nodes(render(), n=>n.props?.className==='gallery-comment-like-button')[0],
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('heart uses feed kind, blocks pending clicks, and reflects the returned count', async () => {
  let resolve
  const calls = []
  const pending = new Promise(done => {resolve=done})
  const app = await panel({reactToComment:(...args)=>{calls.push(args);return pending}})
  app.heart().props.onClick()
  assert.equal(app.heart().props.disabled, true)
  app.heart().props.onClick()
  assert.deepEqual(calls, [['feed',7,true]])
  resolve({liked:true,likeCount:8})
  await settle()
  assert.equal(app.heart().props['aria-pressed'], true)
  assert.equal(app.heart().props.disabled, false)
  assert.equal(nodes(app.heart(), n=>n.type==='strong')[0].props.children, 8)
})

test('failed reaction leaves the old count and offers retry; guest cannot trigger an RPC', async () => {
  const app = await panel({reactToComment:async()=>{throw new Error('Synthetic offline')}})
  app.heart().props.onClick()
  await settle()
  assert.equal(app.heart().props['aria-pressed'], false)
  assert.equal(app.heart().props.disabled, false)
  assert.equal(nodes(app.render(), n=>n.props?.['aria-live']==='polite')[0].props.children, 'Synthetic offline')
  let calls = 0
  const guest = await panel({isSignedIn:false,reactToComment:async()=>{calls++}})
  assert.equal(guest.render(), null)
  assert.equal(guest.heart(), undefined)
  await settle()
  assert.equal(calls,0)
})
