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

const library = rpc => compile('../src/lib/moderation.ts', { './supabase': { supabase: { rpc } } })
const settle = () => new Promise(resolve=>setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject} }

test('moderation RPCs use exact targets and only expose display names and timestamps', async () => {
  const calls=[]
  const api=await library(async(name,args)=>{calls.push([name,args]);return {data:name==='is_app_admin'?true:name.startsWith('moderate_delete_')?true:[{display_name:'Synthetic',reacted_at:'2026-01-01',user_id:'must-not-leak'}],error:null}})
  assert.equal(await api.loadModeratorAccess(),true)
  assert.equal(await api.moderateDeleteContent('feed-comment',12),true)
  assert.equal(await api.moderateDeleteLobbyMessage(56),true)
  assert.deepEqual(await api.loadAdminArtworkReactions('weekly-entry',34),[{displayName:'Synthetic',reactedAt:'2026-01-01'}])
  assert.deepEqual(calls,[['is_app_admin',undefined],['moderate_delete_content',{target_id:12,target_kind:'feed-comment'}],['moderate_delete_lobby_message',{target_message_id:56}],['get_admin_artwork_reactions',{target_id:34,target_kind:'weekly-entry'}]])
})

test('access requires literal true; permission and target errors reach the caller', async () => {
  for (const data of [null,false,'true',1]) assert.equal(await (await library(async()=>({data,error:null}))).loadModeratorAccess(),false)
  const api=await library(async()=>({data:null,error:{message:'ADMIN_REQUIRED'}}))
  await assert.rejects(api.loadModeratorAccess(),/jogosultság/)
  await assert.rejects(api.moderateDeleteContent('feed-post',1),/jogosultság/)
  await assert.rejects(api.moderateDeleteLobbyMessage(1),/jogosultság/)
  await assert.rejects(api.loadAdminArtworkReactions('feed-post',1),/jogosultság/)
  assert.deepEqual(await (await library(async()=>({data:null,error:null}))).loadAdminArtworkReactions('feed-post',1),[])
})

test('lobby UI exposes confirmed delete controls only through moderator state and refreshes deletes', async () => {
  const activeUsers=await readFile(new URL('../src/components/ActiveUsers.tsx',import.meta.url),'utf8')
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8')
  const lobby=await readFile(new URL('../src/lib/globalLobby.ts',import.meta.url),'utf8')
  assert.match(app,/<ActiveUsers[\s\S]*?isModerator=\{isModerator\}/)
  assert.match(activeUsers,/isModerator \? <button[\s\S]*?global-chat-delete-button/)
  assert.match(activeUsers,/moderateDeleteLobbyMessage\(target\.messageId\)/)
  assert.match(activeUsers,/Moderátorként törlöd ezt az üzenetet\?/)
  assert.match(lobby,/\{ event: 'DELETE', schema: 'public', table: 'lobby_messages' \}/)
})

function runtime() {
  let cursor=0
  const slots=[],pending=[]
  const react={
    useState(value) {
      const i=cursor++
      if (!(i in slots)) slots[i]=typeof value==='function'?value():value
      return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]
    },
    useEffect(fn,deps) {
      const i=cursor++,previous=slots[i]
      if (!previous||deps.some((value,j)=>value!==previous.deps[j])) {
        slots[i]={deps,cleanup:previous?.cleanup}
        pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn()})
      }
    },
  }
  return {react,render(fn){cursor=0;return fn()},effects(){for(const fn of pending.splice(0))fn()}}
}

test('admin state fails closed on identity changes before effects and ignores stale requests', async () => {
  const rt=runtime(),requests=[]
  const api=await compile('../src/hooks/useModeratorAccess.ts',{react:rt.react,'../lib/moderation':{loadModeratorAccess(){const request=deferred();requests.push(request);return request.promise}}})
  const render=id=>rt.render(()=>api.useModeratorAccess(id))
  assert.equal(render('admin'),false);rt.effects()
  requests[0].resolve(true);await settle()
  assert.equal(render('admin'),true)
  assert.equal(render('player'),false);rt.effects()
  assert.equal(render(null),false);rt.effects()
  requests[1].resolve(true);await settle()
  assert.equal(render(null),false)
  assert.equal(render('admin'),false);rt.effects()
  requests[2].reject(new Error('offline'));await settle()
  assert.equal(render('admin'),false)
})

test('out-of-order access response cannot grant the next account admin controls', async () => {
  const rt=runtime(),requests=[]
  const api=await compile('../src/hooks/useModeratorAccess.ts',{react:rt.react,'../lib/moderation':{loadModeratorAccess(){const request=deferred();requests.push(request);return request.promise}}})
  const render=id=>rt.render(()=>api.useModeratorAccess(id))
  render('admin');rt.effects()
  render('player');rt.effects()
  requests[1].resolve(false);await settle()
  requests[0].resolve(true);await settle()
  assert.equal(render('player'),false)
})

async function panel(loader) {
  const rt=runtime()
  const api=await compile('../src/components/AdminArtworkReactions.tsx',{
    react:rt.react,
    '../lib/moderation':{loadAdminArtworkReactions:loader},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  })
  return count=>rt.render(()=>api.AdminArtworkReactions({count,kind:'feed-post',targetId:17}))
}

test('reaction details are lazy, avoid refetch after success, and hide when count is zero', async () => {
  const calls=[],request=deferred()
  const render=await panel((...args)=>{calls.push(args);return request.promise})
  assert.equal(render(0),null)
  render(2)
  assert.equal(calls.length,0)
  render(2).props.onToggle({currentTarget:{open:false}})
  assert.equal(calls.length,0)
  render(2).props.onToggle({currentTarget:{open:true}})
  render(2).props.onToggle({currentTarget:{open:true}})
  assert.deepEqual(calls,[['feed-post',17]])
  request.resolve([{displayName:'Synthetic',reactedAt:'2026-01-01T00:00:00Z'}]);await settle()
  assert.match(JSON.stringify(render(2)),/Synthetic/)
  render(2).props.onToggle({currentTarget:{open:true}})
  assert.equal(calls.length,1)
})

test('failed reaction fetch displays an error rather than a fabricated empty list', async () => {
  const render=await panel(async()=>{throw new Error('denied')})
  render(1).props.onToggle({currentTarget:{open:true}})
  await settle()
  assert.match(JSON.stringify(render(1)),/Nem sikerült betölteni/)
  assert.doesNotMatch(JSON.stringify(render(1)),/Nincs aktív reakció/)
})
