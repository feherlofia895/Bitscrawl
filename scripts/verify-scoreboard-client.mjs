// Synthetic client and component tests. No real browser, network or account mutations.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import ts from 'typescript'

async function compile(path,modules) {
  const source=await readFile(new URL(path,import.meta.url),'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const exports={}
  new Function('require','exports','window','document',output)(name=>{
    assert.ok(name in modules,'Unexpected dependency: '+name)
    return modules[name]
  },exports,{localStorage:{getItem:()=>null},addEventListener(){},removeEventListener(){},setTimeout:fn=>fn()},{body:{}})
  return exports
}
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'}
const settle=()=>new Promise(resolve=>setImmediate(resolve))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function nodes(tree,predicate) {
  if(Array.isArray(tree))return tree.flatMap(child=>nodes(child,predicate))
  if(!tree||typeof tree!=='object')return []
  return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)]
}
function runtime() {
  let cursor=0
  const slots=[],pending=[]
  const react={
    useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
    useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i]},
    useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((v,j)=>v!==previous.deps[j])){slots[i]={deps,cleanup:previous?.cleanup};pending.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn()})}},
  }
  return {react,render(fn){cursor=0;return fn()},effects(){for(const fn of pending.splice(0))fn()},unmount(){for(const slot of slots)slot?.cleanup?.()}}
}

test('scoreboard RPC mapping preserves server rank, medal totals and safe avatar validation',async()=>{
  const calls=[]
  const api=await compile('../src/lib/scoreboard.ts',{
    './supabase':{supabase:{rpc:async(name,args)=>{calls.push([name,args]);return {error:null,data:[{score_rank:'4',display_name:'Synthetic',avatar_pixels:'bad',total_points:'8',vote_points:'6',bonus_points:'0',gold_count:'1',silver_count:'0',bronze_count:'0',challenges_entered:'2'}]}}}},
    './profile':{parseAvatarPixels:value=>Array.isArray(value)?value:null},
  })
  const [entry]=await api.loadLifetimeScoreboard(50)
  assert.deepEqual(entry,{rank:4,displayName:'Synthetic',avatarPixels:null,totalPoints:8,votePoints:6,bonusPoints:0,goldCount:1,silverCount:0,bronzeCount:0,challengesEntered:2})
  assert.deepEqual(calls,[['get_lifetime_scoreboard',{requested_limit:50}]])
})

test('scoreboard RPC errors are not silently presented as an empty ranking',async()=>{
  const api=await compile('../src/lib/scoreboard.ts',{'./supabase':{supabase:{rpc:async()=>({error:new Error('offline')})}},'./profile':{parseAvatarPixels:()=>null}})
  await assert.rejects(api.loadLifetimeScoreboard(),/offline/)
})

async function board(overrides={}) {
  const rt=runtime()
  const api=await compile('../src/components/Scoreboard.tsx',{
    react:rt.react,'react/jsx-runtime':jsx,'./ProfileAvatar':{ProfileAvatar:'Avatar'},'./ProfilePreviewButton':{ProfilePreviewButton:'Profile'},
    '../lib/scoreboard':{loadLifetimeScoreboard:async()=>[],...overrides},
  })
  let backs=0
  return {...rt,render:()=>rt.render(()=>api.Scoreboard({onBack:()=>backs++})),backs:()=>backs}
}

test('the coolest section shows each medalist once and excludes players without medals',async()=>{
  const entry={rank:1,displayName:'Pontkirály',avatarPixels:null,totalPoints:20,goldCount:0,silverCount:0,bronzeCount:0}
  const app=await board({
    loadLifetimeScoreboard:async()=>[
      entry,
      {...entry,rank:2,displayName:'Bronz',totalPoints:10,bronzeCount:2},
      {...entry,rank:3,displayName:'Arany',totalPoints:5,goldCount:1},
      {...entry,rank:4,displayName:'Ezüst',totalPoints:15,silverCount:3},
    ],
  })
  assert.match(JSON.stringify(app.render()),/Ranglista betöltése/)
  app.effects();await settle()
  const tree=app.render()
  assert.deepEqual(nodes(tree,n=>n.props?.className==='scoreboard-position').map(n=>n.props.children),[[1,'.'],[2,'.'],[3,'.'],[4,'.']])
  assert.deepEqual(nodes(tree,n=>n.type==='Profile'&&n.props.className==='hall-of-fame-profile-trigger').map(n=>n.props.name),['Arany','Ezüst','Bronz'])
  assert.equal(nodes(tree,n=>n.props?.className==='hall-of-fame-card').length,3)
  assert.equal(nodes(tree,n=>n.type==='strong'&&n.props?.children?.[0]===3&&n.props.children[1]===' érem').length,1)
  nodes(tree,n=>n.props?.className==='home-back-button')[0].props.onClick()
  assert.equal(app.backs(),1)
})

test('scoreboard separates empty, failed and unmounted loads',async()=>{
  const empty=await board();empty.render();empty.effects();await settle()
  assert.match(JSON.stringify(empty.render()),/első lezárt heti vagy havi kihívás/)
  const failure=await board({loadLifetimeScoreboard:async()=>{throw new Error('offline')}})
  failure.render();failure.effects();await settle()
  assert.equal(nodes(failure.render(),n=>n.props?.role==='alert').length,1)
  const request=deferred(),gone=await board({loadLifetimeScoreboard:()=>request.promise})
  gone.render();gone.effects();gone.unmount()
  request.resolve([{displayName:'Late'}]);await settle()
  assert.doesNotMatch(JSON.stringify(gone.render()),/Late/)
})

async function profileApi({rpc=async()=>({data:[],error:null}),feed=async()=>({postCount:2,receivedLikeCount:7}),user={id:'synthetic'},profile={display_name:'Synthetic',avatar_pixels:null}}={}) {
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:profile,error:null})}
  return compile('../src/lib/profile.ts',{
    './colorMixer':{isHexColor:value=>/^#[0-9a-f]{6}$/i.test(value)},
    './palette':{editorPalette32:[{hex:'#d3493b'}]},'./feed':{loadOwnFeedStats:feed},
    './supabase':{supabase:{rpc,from:()=>chain}},'./weekly':{getWeeklyUser:async()=>user},
  })
}

test('public profile stats preserve safe aggregate fields and reject real lookup errors',async()=>{
  const api=await profileApi({rpc:async(name,args)=>{assert.equal(name,'get_public_profile_stats');assert.deepEqual(args,{target_profile_name:'Synthetic'});return {data:[{received_like_count:7,avatar_like_count:2,gold_count:1,silver_count:2,bronze_count:3,trophy_count:6,user_id:'hidden'}],error:null}}})
  assert.deepEqual(await api.loadPublicProfileStats('Synthetic'),{receivedLikeCount:7,avatarLikeCount:2,goldCount:1,silverCount:2,bronzeCount:3,trophyCount:6})
  const broken=await profileApi({rpc:async()=>({data:null,error:{message:'PROFILE_NOT_FOUND'}})})
  await assert.rejects(broken.loadPublicProfileStats('Synthetic'),/nem található/)
})

test('own profile keeps existing feed likes if the new stats endpoint is missing',async()=>{
  const api=await profileApi({rpc:async()=>({data:null,error:{code:'PGRST202',message:'endpoint missing'}})})
  const {profile}=await api.loadOwnProfile()
  assert.equal(profile.receivedLikes,7)
  assert.equal(profile.feedPostCount,2)
  assert.equal(profile.trophyCount,0)
})

test('own profile can fall back to public totals when the feed stats request fails',async()=>{
  const api=await profileApi({feed:async()=>{throw new Error('offline')},rpc:async name=>({data:name==='get_public_profile_stats'?[{received_like_count:9,trophy_count:2}]:null,error:null})})
  const {profile}=await api.loadOwnProfile()
  assert.equal(profile.receivedLikes,9)
  assert.equal(profile.trophyCount,2)
})

test('profile preview opens stats independently of avatar-like failure and links by profile name',async()=>{
  const rt=runtime(),calls=[]
  const api=await compile('../src/components/ProfilePreviewButton.tsx',{
    react:rt.react,'react-dom':{createPortal:value=>value},'react/jsx-runtime':jsx,'./ProfileAvatar':{ProfileAvatar:'Avatar'},
    '../lib/profile':{
      loadProfileAvatarLikeState:async()=>{throw new Error('offline')},
      loadPublicProfileStats:async name=>{calls.push(name);return {receivedLikeCount:7,trophyCount:3,goldCount:1,silverCount:1,bronzeCount:1}},
      loadOwnProfileNote:async()=>null,
      setProfileAvatarLike:async()=>{throw new Error('unexpected write')},
    },
    '../lib/weekly':{getWeeklyUser:async()=>({id:'synthetic'})},
  })
  const render=()=>rt.render(()=>api.ProfilePreviewButton({name:'Synthetic',pixels:null,children:'Open'}))
  render();rt.effects()
  assert.deepEqual(calls,[])
  nodes(render(),n=>n.type==='button'&&n.props?.['aria-haspopup']==='dialog')[0].props.onClick()
  render();rt.effects();await settle()
  assert.deepEqual(calls,['Synthetic'])
  const tree=render()
  assert.deepEqual(nodes(tree,n=>n.props?.className==='profile-preview-stats').flatMap(n=>nodes(n,c=>c.type==='strong')).map(n=>n.props.children),[7,3])
  assert.equal(nodes(tree,n=>n.props?.className==='profile-preview-medals').length,1)
})

test('menu ordering, header settings and own achievements are wired into the app',async()=>{
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8')
  const menu=app.slice(app.indexOf('<div className="home-menu-actions">'))
  const targets=[...menu.matchAll(/openHomeView\('(scoreboard|play|challenge|gallery|editor)'\)/g)].slice(0,5).map(match=>match[1])
  assert.deepEqual(targets,['scoreboard','play','challenge','gallery','editor'])
  assert.match(app,/aria-label="Beállítások"[\s\S]*?disabled=\{Boolean\(lobby\) \|\| homeView === 'settings'\}/)
  assert.match(app,/<Scoreboard onBack=\{closeHomeView\} \/>/)
  const panel=await readFile(new URL('../src/components/ProfilePanel.tsx',import.meta.url),'utf8')
  assert.match(panel,/<h3>Elért eredmények:<\/h3>/)
  assert.match(panel,/profile\?\.trophyCount/)
})
