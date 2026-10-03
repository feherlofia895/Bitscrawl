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
const setLike = (user, kind, id, enabled = true, options) =>
  asUser(user, 'select * from public.set_comment_like($1, $2, $3)', [kind, id, enabled], options)
const states = (user, kind, commentIds, options) =>
  asUser(user, 'select * from public.get_comment_like_states($1, $2)', [kind, commentIds], options)
async function totals() {
  return (await db.query(`select
    (select count(*) from public.feed_likes)::integer as feed,
    (select count(*) from public.weekly_votes)::integer as weekly,
    (select count(*) from public.monthly_votes)::integer as monthly`)).rows
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
    ids[kind] = (await db.query(`insert into public.gallery_comments (${kind}_entry_id, user_id, content) values ($1, $2, 'Synthetic comment') returning id`, [entry.id, users[0]])).rows[0].id
  }
})
after(async () => { await db.close() })

test('reaction tables deny direct access and RPC privilege/volatility contracts are correct', async () => {
  for (const table of ['feed_comment_likes', 'gallery_comment_likes']) {
    await assert.rejects(asUser(users[0], `select * from private.${table}`), /permission denied/)
    await assert.rejects(asUser(users[0], `insert into private.${table} (comment_id, user_id) values ($1, $2)`, [ids.feed, users[1]]), /permission denied/)
  }
  const rows = (await db.query("select relrowsecurity from pg_class where oid in ('private.feed_comment_likes'::regclass, 'private.gallery_comment_likes'::regclass)")).rows
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.relrowsecurity))
  const functions = (await db.query("select n.nspname, p.prosecdef, p.provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('get_comment_like_states','set_comment_like')")).rows
  assert.equal(functions.length, 4)
  assert.ok(functions.every(fn => fn.provolatile === 'v'))
  assert.ok(functions.filter(fn => fn.nspname === 'public').every(fn => fn.prosecdef === false))
})

test('guests, anonymous sessions and unprofiled users cannot create reactions', async () => {
  for (const kind of ['feed', 'gallery']) {
    const id = kind === 'feed' ? ids.feed : ids.weekly
    await assert.rejects(setLike(null, kind, id, true, { role: 'anon' }), /permission denied/)
    await assert.rejects(setLike(anonymousUser, kind, id, true, { anonymous: true }), /WEEKLY_ACCOUNT_REQUIRED/)
    await assert.rejects(setLike(unprofiledUser, kind, id), /WEEKLY_PROFILE_REQUIRED/)
  }
  await assert.rejects(states(null, 'feed', [ids.feed], { role: 'anon' }), /WEEKLY_ACCOUNT_REQUIRED/)
})

for (const target of ['feed', 'weekly', 'monthly']) {
  test(`${target} likes are idempotent and undo affects only the calling profile`, async () => {
    const kind = target === 'feed' ? 'feed' : 'gallery'
    const id = ids[target]
    const previousTotals = await totals()
    const previousProfile = await asUser(users[0], 'select * from public.get_own_feed_stats()')
    assert.deepEqual(await setLike(users[1], kind, id), [{ liked: true, active_like_count: 1 }])
    assert.deepEqual(await setLike(users[1], kind, id), [{ liked: true, active_like_count: 1 }])
    assert.deepEqual(await setLike(users[2], kind, id), [{ liked: true, active_like_count: 2 }])
    assert.deepEqual(await states(users[1], kind, [id]), [{ comment_id: id, like_count: 2, has_liked: true }])
    assert.deepEqual(await setLike(users[1], kind, id, false), [{ liked: false, active_like_count: 1 }])
    assert.deepEqual(await setLike(users[1], kind, id, false), [{ liked: false, active_like_count: 1 }])
    assert.deepEqual(await states(users[2], kind, [id]), [{ comment_id: id, like_count: 1, has_liked: true }])
    assert.deepEqual(await totals(), previousTotals)
    assert.deepEqual(await asUser(users[0], 'select * from public.get_own_feed_stats()'), previousProfile)
  })
}

test('gallery counts are public without voter identities; feed counts require a permanent session', async () => {
  assert.deepEqual(await states(null, 'gallery', [ids.weekly], { role: 'anon' }), [{ comment_id: ids.weekly, like_count: 1, has_liked: false }])
  await assert.rejects(states(anonymousUser, 'feed', [ids.feed], { anonymous: true }), /WEEKLY_ACCOUNT_REQUIRED/)
  await assert.rejects(states(users[0], 'gallery', Array(101).fill(ids.weekly)), /COMMENT_PAGE_INVALID/)
  await assert.rejects(states(users[0], 'invalid', []), /COMMENT_KIND_INVALID/)
  await assert.rejects(setLike(users[0], 'invalid', ids.feed), /COMMENT_KIND_INVALID/)
  await assert.rejects(setLike(users[0], 'feed', 900000000), /COMMENT_NOT_FOUND/)
  await assert.rejects(setLike(users[0], 'gallery', 900000000), /COMMENT_NOT_FOUND/)
})

test('deleting comments cascades reactions and missing comments cannot be liked', async () => {
  await db.query('delete from public.feed_comments where id = $1', [ids.feed])
  await db.query('delete from public.gallery_comments where id = any($1)', [[ids.weekly, ids.monthly]])
  for (const table of ['feed_comment_likes', 'gallery_comment_likes']) {
    assert.equal((await db.query(`select count(*)::integer as count from private.${table}`)).rows[0].count, 0)
  }
  await assert.rejects(setLike(users[0], 'feed', ids.feed), /COMMENT_NOT_FOUND/)
  assert.deepEqual(await states(users[0], 'gallery', [ids.weekly]), [])
})
