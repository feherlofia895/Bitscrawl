// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 14 }, (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
const anonymousUser = '40000000-0000-4000-8000-000000000001'
const unprofiledUser = '40000000-0000-4000-8000-000000000002'
const ids = {}
const drawing = JSON.stringify(Array.from({ length: 1024 }, (_, i) => i === 0 ? '#d3493b' : 'transparent'))

async function asUser(user, sql, params = [], { anonymous = false, role = 'authenticated' } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ is_anonymous: anonymous })])
  await db.exec(`set role ${role}`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
}
before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
    create schema extensions;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as
      $$ select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
    create publication supabase_realtime;
  `)
  for (const user of [...users, anonymousUser, unprofiledUser]) await db.query('insert into auth.users values ($1)', [user])
  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }

  for (let i=0;i<users.length;i++) await asUser(users[i],'select public.set_weekly_profile($1)',[`ScoreTester${i}`])
  await db.query('insert into private.app_admins (user_id) values ($1)',[users[13]])
  ids.challenge=(await db.query("insert into public.weekly_challenges (week_key,prompt,starts_at,ends_at) values ('test-score-1','Synthetic',clock_timestamp()-interval '2 days',clock_timestamp()+interval '2 days') returning id")).rows[0].id
  ids.entries=[]
  for (let i=0;i<6;i++) {
    const row=(await db.query('insert into public.weekly_entries (challenge_id,user_id,pixels) values ($1,$2,$3::jsonb) returning id',[ids.challenge,users[i],drawing])).rows[0]
    ids.entries.push(row.id)
    for (let v=0;v<[4,2,2,1,0,5][i];v++) await db.query('insert into public.weekly_votes (challenge_id,entry_id,voter_user_id) values ($1,$2,$3)',[ids.challenge,row.id,users[6+v]])
  }
  await db.query('update public.weekly_entries set excluded_at=clock_timestamp() where id=$1',[ids.entries[5]])
})
after(async()=>{await db.close()})
const publicRead=(sql,params=[])=>asUser(null,sql,params,{role:'anon'})
const scoreboard=()=>publicRead('select * from public.get_lifetime_scoreboard()')
const finalize=id=>asUser(users[13],'select * from public.finalize_weekly_challenge($1)',[id])

test('empty rankings are readable, but awarding and direct ledger access are protected',async()=>{
  assert.deepEqual(await scoreboard(),[])
  assert.deepEqual(await publicRead('select * from public.get_weekly_hall_of_fame()'),[])
  for (const schema of ['public','private']) {
    await assert.rejects(asUser(users[0],`select * from ${schema}.finalize_weekly_challenge($1)`,[ids.challenge]),/ADMIN_REQUIRED/)
    await assert.rejects(asUser(users[13],`select * from ${schema}.finalize_weekly_challenge($1)`,[ids.challenge],{anonymous:true}),/ADMIN_REQUIRED/)
    await assert.rejects(publicRead(`select * from ${schema}.finalize_weekly_challenge($1)`,[ids.challenge]),/permission denied/)
  }
  for (const user of [users[0],users[13]]) {
    await assert.rejects(asUser(user,'select * from private.weekly_score_awards'),/permission denied/)
    await assert.rejects(asUser(user,'insert into private.weekly_score_awards (challenge_id,user_id,vote_points) values ($1,$2,999)',[ids.challenge,user]),/permission denied/)
    await assert.rejects(asUser(user,'update private.weekly_score_awards set vote_points=999'),/permission denied/)
    await assert.rejects(asUser(user,'select private.recalculate_weekly_score_placements($1)',[ids.challenge]),/permission denied/)
  }
  await assert.rejects(finalize(900000000),/WEEKLY_CHALLENGE_NOT_FOUND/)
})

test('closing awards one participation point and each vote once, excludes ineligible entries and freezes voting',async()=>{
  const [result]=await finalize(ids.challenge)
  assert.equal(result.already_finalized,false)
  assert.equal(result.awards_count,5)
  assert.equal(Number(result.total_vote_points),9)
  const rows=await scoreboard()
  assert.deepEqual(rows.map(r=>[r.display_name,Number(r.total_points),Number(r.score_rank)]),[
    ['ScoreTester0',5,1],['ScoreTester1',3,2],['ScoreTester2',3,2],['ScoreTester3',2,3],['ScoreTester4',1,4],
  ])
  assert.ok(rows.every(r=>Number(r.bonus_points)===0&&Number(r.challenges_entered)===1))
  assert.ok(rows.every(r=>!('user_id' in r)&&!('email' in r)))
  const before=(await db.query('select * from private.weekly_score_awards order by user_id')).rows
  const [again]=await finalize(ids.challenge)
  assert.equal(again.already_finalized,true)
  assert.deepEqual((await db.query('select * from private.weekly_score_awards order by user_id')).rows,before)
  await assert.rejects(asUser(users[12],'select * from public.set_weekly_vote($1,true)',[ids.entries[0]]),/WEEKLY_CHALLENGE_CLOSED/)
  await assert.rejects(asUser(users[12],'select public.save_weekly_draft($1,$2::jsonb)',[ids.challenge,drawing]),/WEEKLY_CHALLENGE_CLOSED/)
})

test('podium medals match public profile totals and never award a medal for zero votes',async()=>{
  const podium=await publicRead('select * from public.get_weekly_hall_of_fame()')
  assert.deepEqual(podium.map(r=>[r.display_name,Number(r.placement),Number(r.points)]),[
    ['ScoreTester0',1,5],['ScoreTester1',2,3],['ScoreTester2',2,3],
  ])
  assert.ok(podium.every(r=>!('user_id' in r)&&!('email' in r)))
  for (let i=0;i<6;i++) {
    const [stats]=await publicRead('select * from public.get_public_profile_stats($1)',[` scoretester${i} `])
    assert.equal(stats.trophy_count,i<3?1:0)
    assert.equal(stats.trophy_count,stats.gold_count+stats.silver_count+stats.bronze_count)
    assert.deepEqual(Object.keys(stats).sort(),['avatar_like_count','bronze_count','gold_count','received_like_count','silver_count','trophy_count'])
  }
  for (const name of ['',null,'NoSuchProfile']) await assert.rejects(publicRead('select * from public.get_public_profile_stats($1)',[name]),/PROFILE_NOT_FOUND/)
})

test('public queries clamp requested limits and profile counts do not include comment likes',async()=>{
  assert.equal((await publicRead('select * from public.get_lifetime_scoreboard($1)',[0])).length,1)
  assert.equal((await publicRead('select * from public.get_weekly_hall_of_fame($1)',[-3])).length,1)
  assert.equal((await publicRead('select * from public.get_lifetime_scoreboard($1)',[null])).length,5)
  const post=(await db.query('insert into public.feed_posts (user_id,pixels) values ($1,$2::jsonb) returning id',[users[0],drawing])).rows[0].id
  await db.query('insert into public.feed_likes (post_id,user_id) values ($1,$2)',[post,users[1]])
  const comment=(await db.query("insert into public.feed_comments (post_id,user_id,content) values ($1,$2,'Synthetic') returning id",[post,users[0]])).rows[0].id
  const before=await publicRead('select * from public.get_public_profile_stats($1)',['ScoreTester0'])
  assert.equal(before[0].received_like_count,1)
  await asUser(users[1],'select * from public.set_comment_like($1,$2,true)',['feed',comment])
  assert.deepEqual(await publicRead('select * from public.get_public_profile_stats($1)',['ScoreTester0']),before)
  await asUser(users[0],'select public.set_profile_avatar($1::jsonb)',[drawing])
  await asUser(users[1],'select * from public.set_profile_avatar_like($1,true)',['ScoreTester0'])
  assert.equal((await publicRead('select * from public.get_public_profile_stats($1)',['ScoreTester0']))[0].avatar_like_count,1)
})

test('a second finalized challenge accumulates participation while repeated closes stay idempotent',async()=>{
  const second=(await db.query("insert into public.weekly_challenges (week_key,prompt,starts_at,ends_at) values ('test-score-2','Synthetic second',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day') returning id")).rows[0].id
  await db.query('insert into public.weekly_entries (challenge_id,user_id,pixels) values ($1,$2,$3::jsonb)',[second,users[4],drawing])
  await finalize(second)
  await finalize(second)
  const participant=(await scoreboard()).find(r=>r.display_name==='ScoreTester4')
  assert.equal(Number(participant.total_points),2)
  assert.equal(Number(participant.challenges_entered),2)
  assert.equal(Number(participant.gold_count)+Number(participant.silver_count)+Number(participant.bronze_count),0)
})

test('ledger exclusions remove awards from ranking and profile medals after privileged recalculation',async()=>{
  // This is the ledger correction path, NOT moderate_delete_content. Audit F05 remains open.
  await db.query("update private.weekly_score_awards set excluded_at=clock_timestamp(),exclusion_reason='Synthetic exclusion' where challenge_id=$1 and user_id=$2",[ids.challenge,users[0]])
  await db.query('select private.recalculate_weekly_score_placements($1)',[ids.challenge])
  assert.ok(!(await scoreboard()).some(r=>r.display_name==='ScoreTester0'))
  const podium=await publicRead('select * from public.get_weekly_hall_of_fame()')
  assert.deepEqual(podium.map(r=>[r.display_name,Number(r.placement)]),[['ScoreTester1',1],['ScoreTester2',1],['ScoreTester3',3]])
  assert.equal((await publicRead('select * from public.get_public_profile_stats($1)',['ScoreTester0']))[0].trophy_count,0)
})
