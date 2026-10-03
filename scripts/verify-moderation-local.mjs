// Isolated in-memory PostgreSQL with synthetic accounts. Never loads .env.local.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 3 }, (_, i) => `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
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
  for (let i = 0; i < users.length; i++) await asUser(users[i], 'select public.set_weekly_profile($1)', [`LikeTester${i}`])
  const [post] = (await db.query('insert into public.feed_posts (user_id, pixels) values ($1, $2::jsonb) returning id', [users[0], drawing])).rows
  ids.post = post.id
  ids.feed = (await db.query("insert into public.feed_comments (post_id, user_id, content) values ($1, $2, 'Synthetic comment') returning id", [post.id, users[0]])).rows[0].id
  for (const kind of ['weekly', 'monthly']) {
    const [challenge] = (await db.query(`select id from public.${kind}_challenges order by id limit 1`)).rows
    const [entry] = (await db.query(`insert into public.${kind}_entries (challenge_id, user_id, pixels) values ($1, $2, $3::jsonb) returning id`, [challenge.id, users[0], drawing])).rows
    ids[kind + 'Entry'] = entry.id
    ids[kind + 'Challenge'] = challenge.id
    ids[kind] = (await db.query(`insert into public.gallery_comments (${kind}_entry_id, user_id, content) values ($1, $2, 'Synthetic comment') returning id`, [entry.id, users[0]])).rows[0].id
  }
  await db.query('insert into private.app_admins (user_id) values ($1)', [users[2]])
  ids.lobby = (await db.query("insert into public.lobby_messages (user_id, content) values ($1, 'Synthetic lobby message') returning id", [users[0]])).rows[0].id
  ids.feedback = (await db.query(`
    insert into public.bug_reports (user_id, reporter_name, category, description, technical_context)
    values ($1, 'FeedbackTester', 'idea', 'Synthetic admin feedback item', '{"viewport":"390x844"}'::jsonb)
    returning id
  `, [users[0]])).rows[0].id
  await db.query('insert into public.feed_likes (post_id, user_id) values ($1,$2)', [ids.post,users[1]])
  for (const kind of ['weekly','monthly']) await db.query(`insert into public.${kind}_votes (challenge_id,entry_id,voter_user_id) values ($1,$2,$3)`, [ids[kind+'Challenge'],ids[kind+'Entry'],users[1]])
})
after(async () => { await db.close() })

const targets = () => [['feed-post',ids.post],['feed-comment',ids.feed],['gallery-comment',ids.weekly],['weekly-entry',ids.weeklyEntry],['monthly-entry',ids.monthlyEntry]]
const remove = (kind,id) => asUser(users[2], 'select public.moderate_delete_content($1,$2)',[kind,id])

test('allowlist cannot be read or self-granted, including by the admin', async () => {
  for (const user of [users[0],users[2]]) {
    await assert.rejects(asUser(user,'select * from private.app_admins'),/permission denied/)
    await assert.rejects(asUser(user,'insert into private.app_admins (user_id) values ($1)',[users[0]]),/permission denied/)
  }
  assert.deepEqual(await asUser(users[2],'select public.is_app_admin()'),[{is_app_admin:true}])
  assert.deepEqual(await asUser(users[2],'select public.is_app_admin()',[],{anonymous:true}),[{is_app_admin:false}])
  await db.query("update public.profiles set display_name='martinteteme' where user_id=$1",[users[0]])
  assert.deepEqual(await asUser(users[0],'select public.is_app_admin()'),[{is_app_admin:false}])
})

test('normal users, guests and even allowlisted anonymous sessions cannot moderate', async () => {
  for (const [kind,id] of targets()) for (const schema of ['public','private']) {
    for (const [user,options,pattern] of [[users[0],{},/ADMIN_REQUIRED/],[users[2],{anonymous:true},/ADMIN_REQUIRED/],[null,{role:'anon'},/permission denied/]]) {
      await assert.rejects(asUser(user,`select ${schema}.moderate_delete_content($1,$2)`,[kind,id],options),pattern)
    }
  }
  for (const schema of ['public','private']) {
    await assert.rejects(asUser(users[0],`select ${schema}.moderate_delete_lobby_message($1)`,[ids.lobby]),/ADMIN_REQUIRED/)
    await assert.rejects(asUser(users[2],`select ${schema}.moderate_delete_lobby_message($1)`,[ids.lobby],{anonymous:true}),/ADMIN_REQUIRED/)
    await assert.rejects(asUser(null,`select ${schema}.moderate_delete_lobby_message($1)`,[ids.lobby],{role:'anon'}),/permission denied/)
  }
})

test('all reaction lists are admin-only and return names/times without account identifiers', async () => {
  for (const [kind,id] of targets().filter(([kind])=>kind.endsWith('entry')||kind==='feed-post')) {
    for (const schema of ['public','private']) {
      await assert.rejects(asUser(users[0],`select * from ${schema}.get_admin_artwork_reactions($1,$2)`,[kind,id]),/ADMIN_REQUIRED/)
      await assert.rejects(asUser(users[2],`select * from ${schema}.get_admin_artwork_reactions($1,$2)`,[kind,id],{anonymous:true}),/ADMIN_REQUIRED/)
      await assert.rejects(asUser(null,`select * from ${schema}.get_admin_artwork_reactions($1,$2)`,[kind,id],{role:'anon'}),/permission denied/)
    }
    const rows=await asUser(users[2],'select * from public.get_admin_artwork_reactions($1,$2)',[kind,id])
    assert.equal(rows.length,1)
    assert.deepEqual(Object.keys(rows[0]).sort(),['display_name','reacted_at'])
    assert.equal(rows[0].display_name,'LikeTester1')
  }
})

test('feedback inbox is admin-only and omits account identifiers', async () => {
  for (const schema of ['public', 'private']) {
    await assert.rejects(asUser(users[0], `select * from ${schema}.get_admin_feedback_reports(null)`), /ADMIN_REQUIRED/)
    await assert.rejects(asUser(users[2], `select * from ${schema}.get_admin_feedback_reports(null)`, [], { anonymous: true }), /ADMIN_REQUIRED/)
    await assert.rejects(asUser(null, `select * from ${schema}.get_admin_feedback_reports(null)`, [], { role: 'anon' }), /permission denied/)
  }

  const reports = await asUser(users[2], 'select * from public.get_admin_feedback_reports(null)')
  const report = reports.find(item => Number(item.report_id) === Number(ids.feedback))
  assert.ok(report)
  assert.deepEqual(Object.keys(report).sort(), [
    'category', 'created_at', 'description', 'report_id', 'reporter_name', 'status', 'steps', 'technical_context',
  ])
  assert.equal(report.reporter_name, 'FeedbackTester')
})

test('only an admin can move feedback through valid workflow states', async () => {
  await assert.rejects(
    asUser(users[0], 'select * from public.set_admin_feedback_status($1,$2)', [ids.feedback, 'reviewed']),
    /ADMIN_REQUIRED/,
  )
  await assert.rejects(
    asUser(users[2], 'select * from public.set_admin_feedback_status($1,$2)', [ids.feedback, 'invalid']),
    /FEEDBACK_STATUS_INVALID/,
  )
  await assert.rejects(
    asUser(users[2], 'select * from public.set_admin_feedback_status($1,$2)', [900000000, 'closed']),
    /FEEDBACK_REPORT_NOT_FOUND/,
  )

  assert.deepEqual(
    await asUser(users[2], 'select * from public.set_admin_feedback_status($1,$2)', [ids.feedback, 'reviewed']),
    [{ report_id: ids.feedback, status: 'reviewed' }],
  )
  const reviewed = await asUser(users[2], 'select report_id from public.get_admin_feedback_reports($1)', ['reviewed'])
  assert.ok(reviewed.some(item => Number(item.report_id) === Number(ids.feedback)))
})

test('invalid kinds and missing targets fail without touching existing content', async () => {
  await assert.rejects(remove('invalid',ids.post),/MODERATION_KIND_INVALID/)
  for (const [kind] of targets()) await assert.rejects(remove(kind,900000000),/MODERATION_TARGET_NOT_FOUND/)
  await assert.rejects(asUser(users[2],'select * from public.get_admin_artwork_reactions($1,$2)',['invalid',ids.post]),/MODERATION_KIND_INVALID/)
  await assert.rejects(asUser(users[2],'select public.moderate_delete_lobby_message($1)',[900000000]),/MODERATION_TARGET_NOT_FOUND/)
})

test('admin can delete exactly one lobby message', async () => {
  const keptId = (await db.query("insert into public.lobby_messages (user_id, content) values ($1, 'Keep this message') returning id", [users[1]])).rows[0].id
  assert.deepEqual(
    await asUser(users[2], 'select public.moderate_delete_lobby_message($1)', [ids.lobby]),
    [{ moderate_delete_lobby_message: true }],
  )
  assert.equal((await db.query('select count(*)::integer as n from public.lobby_messages where id=$1',[ids.lobby])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::integer as n from public.lobby_messages where id=$1',[keptId])).rows[0].n,1)
  await assert.rejects(asUser(users[2], 'select public.moderate_delete_lobby_message($1)', [ids.lobby]), /MODERATION_TARGET_NOT_FOUND/)
})

test('admin comment removal cascades comment likes', async () => {
  for (const [kind,id,target,table] of [['feed',ids.feed,'feed-comment','feed_comment_likes'],['gallery',ids.weekly,'gallery-comment','gallery_comment_likes']]) {
    await asUser(users[1],'select * from public.set_comment_like($1,$2,true)',[kind,id])
    assert.deepEqual(await remove(target,id),[{moderate_delete_content:true}])
    assert.equal((await db.query(`select count(*)::integer as n from private.${table} where comment_id=$1`,[id])).rows[0].n,0)
    await assert.rejects(remove(target,id),/MODERATION_TARGET_NOT_FOUND/)
  }
})

test('challenge moderation hides entries without deleting drawings; repeated exclusion is stable', async () => {
  for (const kind of ['weekly','monthly']) {
    const id=ids[kind+'Entry']
    await remove(kind+'-entry',id)
    const before=(await db.query(`select pixels,excluded_at from public.${kind}_entries where id=$1`,[id])).rows[0]
    assert.ok(before.excluded_at)
    assert.deepEqual(before.pixels,JSON.parse(drawing))
    await remove(kind+'-entry',id)
    assert.deepEqual((await db.query(`select pixels,excluded_at from public.${kind}_entries where id=$1`,[id])).rows[0],before)
    const gallery=await asUser(null,`select entry_id from public.get_${kind}_gallery($1)`,[ids[kind+'Challenge']],{role:'anon'})
    assert.ok(!gallery.some(row=>row.entry_id===id))
  }
})

test('admin feed removal cascades its likes and remaining comments', async () => {
  await db.query("insert into public.feed_comments (post_id,user_id,content) values ($1,$2,'Cascade fixture')",[ids.post,users[1]])
  await remove('feed-post',ids.post)
  for (const table of ['feed_likes','feed_comments']) assert.equal((await db.query(`select count(*)::integer as n from public.${table} where post_id=$1`,[ids.post])).rows[0].n,0)
  assert.equal((await db.query('select count(*)::integer as n from public.feed_posts where id=$1',[ids.post])).rows[0].n,0)
})
