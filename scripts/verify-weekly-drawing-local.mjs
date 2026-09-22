// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const users = Array.from({ length: 6 }, (_, index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
const anonymousUser = '20000000-0000-4000-8000-000000000001'
const unprofiledUser = '20000000-0000-4000-8000-000000000002'
let challengeId
let monthlyChallengeId
const colors = ['#d3493b', '#da7149', '#e29958', '#f5e57a', '#a5d967', '#67ba62']
const drawing = (color) => Array.from({ length: 1024 }, (_, index) => index < 4 ? color : 'transparent')

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
  ;[{ challenge_id: challengeId }] = await asUser(null, 'select * from public.get_weekly_challenges()', [], { role: 'anon' })
  ;[{ challenge_id: monthlyChallengeId }] = await asUser(null, 'select * from public.get_monthly_challenges()', [], { role: 'anon' })
})

after(async () => { await db.close() })

test('only permanent users can create unique, validated profiles', async () => {
  await assert.rejects(
    asUser(anonymousUser, 'select public.set_weekly_profile($1)', ['Anon'], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(asUser(users[0], 'select public.set_weekly_profile($1)', ['x']), /WEEKLY_NAME_INVALID/)
  for (let index = 0; index < users.length; index += 1) {
    const [{ set_weekly_profile: name }] = await asUser(
      users[index], 'select public.set_weekly_profile($1)', [`Artist${index + 1}`],
    )
    assert.equal(name, `Artist${index + 1}`)
  }
  await assert.rejects(
    asUser(users[1], 'select public.set_weekly_profile($1)', ['artist1']),
    /WEEKLY_NAME_TAKEN/,
  )
})

test('profile avatars are validated, private and copied beside room names', async () => {
  await assert.rejects(
    asUser(anonymousUser, 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(drawing(colors[0]))], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(['#d3493b'])]),
    /PROFILE_AVATAR_INVALID/,
  )
  const avatarWithNull = drawing(colors[0])
  avatarWithNull[8] = null
  await assert.rejects(
    asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(avatarWithNull)]),
    /PROFILE_AVATAR_INVALID/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(drawing('#ffffff'))]),
    /PROFILE_AVATAR_INVALID/,
  )

  const firstAvatar = drawing(colors[0])
  await asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(firstAvatar)])
  const ownProfile = await asUser(users[0], 'select avatar_pixels from public.profiles where user_id = $1', [users[0]])
  const hiddenProfile = await asUser(users[1], 'select avatar_pixels from public.profiles where user_id = $1', [users[0]])
  assert.deepEqual(ownProfile[0].avatar_pixels, firstAvatar)
  assert.equal(hiddenProfile.length, 0)

  const [{ id: roomId }] = (await db.query(
    "insert into public.rooms (code, host_user_id) values ('AVATAR', $1) returning id",
    [users[0]],
  )).rows
  await db.query(
    'insert into public.room_players (room_id, user_id, display_name) values ($1, $2, $3)',
    [roomId, users[0], 'Artist1'],
  )
  let [{ avatar_pixels: roomAvatar }] = (await db.query(
    'select avatar_pixels from public.room_players where room_id = $1 and user_id = $2',
    [roomId, users[0]],
  )).rows
  assert.deepEqual(roomAvatar, firstAvatar)

  const updatedAvatar = drawing('#f7f3e8')
  await asUser(users[0], 'select public.set_profile_avatar($1::jsonb)', [JSON.stringify(updatedAvatar)])
  ;[{ avatar_pixels: roomAvatar }] = (await db.query(
    'select avatar_pixels from public.room_players where room_id = $1 and user_id = $2',
    [roomId, users[0]],
  )).rows
  assert.deepEqual(roomAvatar, updatedAvatar)
})

test('each permanent profile owns exactly two private editor gallery slots', async () => {
  const firstDrawing = drawing(colors[0])
  const secondDrawing = drawing('#f7f3e8')

  await assert.rejects(
    asUser(
      anonymousUser,
      'select public.save_own_editor_gallery_slot(1, $1::jsonb, 12)',
      [JSON.stringify(firstDrawing)],
      { anonymous: true },
    ),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(
    asUser(
      unprofiledUser,
      'select public.save_own_editor_gallery_slot(1, $1::jsonb, 12)',
      [JSON.stringify(firstDrawing)],
    ),
    /WEEKLY_PROFILE_REQUIRED/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.save_own_editor_gallery_slot(3, $1::jsonb, 12)', [JSON.stringify(firstDrawing)]),
    /EDITOR_GALLERY_SLOT_INVALID/,
  )
  await assert.rejects(
    asUser(
      users[0],
      'select public.save_own_editor_gallery_slot(1, $1::jsonb, 12)',
      [JSON.stringify(Array(1024).fill('transparent'))],
    ),
    /EDITOR_GALLERY_DRAWING_INVALID/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.save_own_editor_gallery_slot(1, $1::jsonb, 12)', [JSON.stringify(secondDrawing)]),
    /EDITOR_GALLERY_DRAWING_INVALID/,
  )

  await asUser(
    users[0],
    'select public.save_own_editor_gallery_slot(1, $1::jsonb, 12)',
    [JSON.stringify(firstDrawing)],
  )
  await asUser(
    users[0],
    'select public.save_own_editor_gallery_slot(2, $1::jsonb, 32)',
    [JSON.stringify(secondDrawing)],
  )
  let ownGallery = await asUser(users[0], 'select * from public.get_own_editor_gallery()')
  assert.deepEqual(ownGallery.map(slot => slot.slot_index), [1, 2])
  assert.deepEqual(ownGallery[0].pixels, firstDrawing)
  assert.equal(ownGallery[0].palette_size, 12)
  assert.deepEqual(ownGallery[1].pixels, secondDrawing)
  assert.equal(ownGallery[1].palette_size, 32)
  assert.deepEqual(await asUser(users[1], 'select * from public.get_own_editor_gallery()'), [])
  await assert.rejects(asUser(users[0], 'select * from private.editor_gallery_slots'), /permission denied/)

  const replacement = drawing(colors[2])
  await asUser(
    users[0],
    'select public.save_own_editor_gallery_slot(1, $1::jsonb, 12)',
    [JSON.stringify(replacement)],
  )
  ownGallery = await asUser(users[0], 'select * from public.get_own_editor_gallery()')
  assert.equal(ownGallery.length, 2)
  assert.deepEqual(ownGallery[0].pixels, replacement)

  assert.deepEqual(await asUser(users[0], 'select public.delete_own_editor_gallery_slot(2)'), [
    { delete_own_editor_gallery_slot: true },
  ])
  assert.deepEqual(await asUser(users[0], 'select public.delete_own_editor_gallery_slot(2)'), [
    { delete_own_editor_gallery_slot: false },
  ])
  ownGallery = await asUser(users[0], 'select * from public.get_own_editor_gallery()')
  assert.deepEqual(ownGallery.map(slot => slot.slot_index), [1])
})

test('daily feed limits posts by Budapest day and protects likes, comments and profile totals', async () => {
  const expandedDrawing = drawing('#f7f3e8')
  await assert.rejects(
    asUser(anonymousUser, 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(expandedDrawing)], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(Array(1024).fill('transparent'))]),
    /FEED_DRAWING_INVALID/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing('#ffffff'))]),
    /FEED_DRAWING_INVALID/,
  )
  await assert.rejects(
    asUser(
      users[0],
      'select public.publish_daily_feed_post($1::jsonb, null, $2)',
      [JSON.stringify(expandedDrawing), 'x'.repeat(161)],
    ),
    /FEED_DESCRIPTION_INVALID/,
  )
  await assert.rejects(
    asUser(
      users[0],
      'select public.publish_daily_feed_post($1::jsonb, null, $2)',
      [JSON.stringify(expandedDrawing), 'egy\nkettő\nhárom\nnégy'],
    ),
    /FEED_DESCRIPTION_INVALID/,
  )

  const [{ publish_daily_feed_post: firstPostId }] = await asUser(
    users[0],
    'select public.publish_daily_feed_post($1::jsonb, null, $2)',
    [JSON.stringify(expandedDrawing), 'Első sor\nMásodik sor\nHarmadik sor'],
  )
  const [{ publish_daily_feed_post: secondOwnPostId }] = await asUser(
    users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[0]))],
  )
  assert.notEqual(secondOwnPostId, firstPostId)
  await assert.rejects(
    asUser(users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[2]))]),
    /FEED_DAILY_LIMIT/,
  )
  const [{ publish_daily_feed_post: editedOwnPostId }] = await asUser(
    users[0],
    'select public.publish_daily_feed_post($1::jsonb, $2, $3)',
    [JSON.stringify(drawing(colors[3])), secondOwnPostId, 'Szerkesztett leírás'],
  )
  assert.equal(editedOwnPostId, secondOwnPostId)
  assert.equal((await db.query('select count(*)::integer as count from public.feed_posts where user_id = $1', [users[0]])).rows[0].count, 2)

  const [{ publish_daily_feed_post: otherUserPostId }] = await asUser(
    users[1], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[1]))],
  )
  await assert.rejects(
    asUser(users[1], 'select public.publish_daily_feed_post($1::jsonb, $2)', [JSON.stringify(drawing(colors[4])), firstPostId]),
    /FEED_POST_NOT_OWN/,
  )
  await assert.rejects(asUser(users[0], 'select * from public.feed_posts'), /permission denied/)

  const guestFeed = await asUser(null, 'select * from public.get_daily_feed(6, 0)', [], { role: 'anon' })
  assert.equal(guestFeed.length, 3)
  assert(guestFeed.every(post => Number(post.total_count) === 3 && !('user_id' in post)))
  assert.deepEqual(guestFeed.find(post => post.post_id === firstPostId).pixels, expandedDrawing)
  assert.equal(guestFeed.find(post => post.post_id === firstPostId).description, 'Első sor\nMásodik sor\nHarmadik sor')
  assert.equal(guestFeed.find(post => post.post_id === secondOwnPostId).description, 'Szerkesztett leírás')

  await assert.rejects(
    asUser(users[0], 'select * from public.set_daily_feed_like($1, true)', [firstPostId]),
    /FEED_OWN_LIKE_FORBIDDEN/,
  )
  await asUser(users[2], 'select * from public.set_daily_feed_like($1, true)', [firstPostId])
  await asUser(users[2], 'select * from public.set_daily_feed_like($1, true)', [firstPostId])
  const likedFeed = await asUser(null, "select * from public.get_daily_feed_page(6, 0, 'likes', 0)", [], { role: 'anon' })
  assert.equal(likedFeed[0].post_id, firstPostId)
  const newestFeed = await asUser(null, "select * from public.get_daily_feed_page(6, 0, 'newest', 0)", [], { role: 'anon' })
  assert.deepEqual(newestFeed.map(post => post.post_id), [otherUserPostId, secondOwnPostId, firstPostId])
  const discoveryFeed = await asUser(null, "select * from public.get_daily_feed_page(6, 0, 'discovery', 418)", [], { role: 'anon' })
  const repeatedDiscoveryFeed = await asUser(null, "select * from public.get_daily_feed_page(6, 0, 'discovery', 418)", [], { role: 'anon' })
  assert.deepEqual(repeatedDiscoveryFeed.map(post => post.post_id), discoveryFeed.map(post => post.post_id))
  assert(discoveryFeed.every(post => Number(post.total_count) === 3))
  const discoveryPageOne = await asUser(null, "select * from public.get_daily_feed_page(2, 0, 'discovery', 418)", [], { role: 'anon' })
  const discoveryPageTwo = await asUser(null, "select * from public.get_daily_feed_page(2, 2, 'discovery', 418)", [], { role: 'anon' })
  assert.equal(new Set([...discoveryPageOne, ...discoveryPageTwo].map(post => post.post_id)).size, 3)
  await assert.rejects(
    asUser(null, "select * from public.get_daily_feed_page(6, 0, 'unknown', 0)", [], { role: 'anon' }),
    /FEED_SORT_INVALID/,
  )
  const [account] = await asUser(users[0], 'select * from public.get_daily_feed_account_state()')
  assert.equal(account.received_like_count, 1)
  assert.equal(account.today_post_count, 2)
  const [stats] = await asUser(users[0], 'select * from public.get_own_feed_stats()')
  assert.equal(stats.post_count, 2)
  assert.equal(stats.received_like_count, 1)

  await assert.rejects(
    asUser(users[2], 'select public.add_daily_feed_comment($1, $2)', [firstPostId, '   ']),
    /GALLERY_COMMENT_INVALID/,
  )
  await asUser(users[2], 'select public.add_daily_feed_comment($1, $2)', [firstPostId, '  Nagyon   jó!  '])
  await assert.rejects(
    asUser(users[2], 'select public.add_daily_feed_comment($1, $2)', [otherUserPostId, 'Túl gyors']),
    /GALLERY_COMMENT_RATE_LIMIT/,
  )
  await asUser(users[3], 'select public.add_daily_feed_comment($1, $2)', [firstPostId, 'Nekem is tetszik.'])
  const comments = await asUser(null, 'select * from public.get_daily_feed_comments($1)', [[firstPostId]], { role: 'anon' })
  assert.deepEqual(comments.map(comment => comment.content), ['Nagyon jó!', 'Nekem is tetszik.'])
  assert(comments.every(comment => !('user_id' in comment)))
  await assert.rejects(
    asUser(users[3], 'select public.update_daily_feed_comment($1, $2)', [comments[0].comment_id, 'Nem az enyém']),
    /GALLERY_COMMENT_NOT_OWN/,
  )
  await asUser(users[2], 'select public.update_daily_feed_comment($1, $2)', [comments[0].comment_id, 'Még mindig jó!'])
  const edited = await asUser(null, 'select * from public.get_daily_feed_comments($1)', [[firstPostId]], { role: 'anon' })
  assert.equal(edited[0].content, 'Még mindig jó!')

  await assert.rejects(
    asUser(users[3], 'select public.delete_own_daily_feed_post($1)', [firstPostId]),
    /FEED_POST_NOT_OWN/,
  )
  const [{ delete_own_daily_feed_post: deleted }] = await asUser(
    users[0], 'select public.delete_own_daily_feed_post($1)', [firstPostId],
  )
  assert.equal(deleted, true)
  assert.equal((await db.query('select count(*)::integer as count from public.feed_likes where post_id = $1', [firstPostId])).rows[0].count, 0)
  assert.equal((await db.query('select count(*)::integer as count from public.feed_comments where post_id = $1', [firstPostId])).rows[0].count, 0)
  const [afterDelete] = await asUser(users[0], 'select * from public.get_daily_feed_account_state()')
  assert.equal(afterDelete.today_post_count, 1)

  const [{ publish_daily_feed_post: replacementPostId }] = await asUser(
    users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[2]))],
  )
  assert.notEqual(replacementPostId, firstPostId)
  await db.query('update public.feed_posts set post_date = post_date - 1 where user_id = $1', [users[0]])
  await asUser(users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[2]))])
  await asUser(users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[3]))])
  await assert.rejects(
    asUser(users[0], 'select public.publish_daily_feed_post($1::jsonb)', [JSON.stringify(drawing(colors[4]))]),
    /FEED_DAILY_LIMIT/,
  )
  const [nextDayStats] = await asUser(users[0], 'select * from public.get_own_feed_stats()')
  assert.equal(nextDayStats.post_count, 4)
})

test('global lobby authenticates presence, exposes only safe profile fields and persists rate-limited chat', async () => {
  await assert.rejects(
    asUser(anonymousUser, 'select public.touch_global_lobby_presence()', [], { anonymous: true }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(
    asUser(unprofiledUser, 'select public.touch_global_lobby_presence()'),
    /LOBBY_PROFILE_REQUIRED/,
  )

  await assert.rejects(
    asUser(users[0], 'insert into private.lobby_presence (user_id) values ($1)', [users[1]]),
    /permission denied/,
  )
  await asUser(users[0], 'select public.touch_global_lobby_presence()')
  await asUser(users[1], 'select public.touch_global_lobby_presence()')

  const profiles = await asUser(users[0], 'select * from public.get_online_profiles()')
  assert.equal(profiles.length, 2)
  assert(profiles.every(profile => !('email' in profile) && !('created_at' in profile)))

  await db.query(
    "update private.lobby_presence set last_seen_at = clock_timestamp() - interval '46 seconds' where user_id = $1",
    [users[1]],
  )
  const freshProfiles = await asUser(users[0], 'select * from public.get_online_profiles()')
  assert.deepEqual(freshProfiles.map(profile => profile.user_id), [users[0]])

  await assert.rejects(
    asUser(users[0], 'insert into public.lobby_messages (user_id, content) values ($1, $2)', [users[0], 'Tiltott']),
    /permission denied/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.send_global_lobby_message($1)', ['   ']),
    /LOBBY_MESSAGE_INVALID/,
  )
  await asUser(users[0], 'select public.send_global_lobby_message($1)', ['  Sziasztok   mindenkinek!  '])
  await assert.rejects(
    asUser(users[0], 'select public.send_global_lobby_message($1)', ['Túl gyors']),
    /LOBBY_MESSAGE_RATE_LIMIT/,
  )
  await db.query("update public.lobby_messages set created_at = clock_timestamp() - interval '3 seconds'")
  await asUser(users[1], 'select public.send_global_lobby_message($1)', ['Helló!'])

  const ownMessages = await asUser(users[0], 'select * from public.get_global_lobby_messages()')
  const otherMessages = await asUser(users[1], 'select * from public.get_global_lobby_messages()')
  assert.deepEqual(ownMessages.map(message => message.content), ['Sziasztok mindenkinek!', 'Helló!'])
  assert.deepEqual(ownMessages.map(message => message.is_own), [true, false])
  assert.deepEqual(otherMessages.map(message => message.is_own), [false, true])
  assert(ownMessages.every(message => !('user_id' in message)))

  assert.equal((await asUser(users[0], 'select * from public.lobby_messages')).length, 2)
  assert.equal((await asUser(unprofiledUser, 'select * from public.lobby_messages')).length, 0)
})

test('monthly challenge keeps entries editable only before the seven-day voting window', async () => {
  const [challenge] = await asUser(null, 'select * from public.get_monthly_challenges()', [], { role: 'anon' })
  assert.equal(challenge.prompt, 'Béka')
  assert.equal(challenge.challenge_status, 'drawing')
  assert.equal(new Date(challenge.ends_at) - new Date(challenge.voting_starts_at), 7 * 24 * 60 * 60 * 1000)

  await asUser(
    users[5], 'select public.save_monthly_entry($1, $2::jsonb)',
    [monthlyChallengeId, JSON.stringify(Array(1024).fill('transparent'))],
  )
  await assert.rejects(
    asUser(users[5], 'select public.submit_monthly_entry($1)', [monthlyChallengeId]),
    /MONTHLY_DRAWING_INVALID/,
  )

  for (let index = 0; index < users.length; index += 1) {
    await asUser(
      users[index], 'select public.save_monthly_entry($1, $2::jsonb)',
      [monthlyChallengeId, JSON.stringify(drawing(colors[index]))],
    )
  }
  for (let index = 0; index < 5; index += 1) {
    await asUser(users[index], 'select public.submit_monthly_entry($1)', [monthlyChallengeId])
  }
  await asUser(
    users[0], 'select public.save_monthly_entry($1, $2::jsonb)',
    [monthlyChallengeId, JSON.stringify(drawing(colors[5]))],
  )
  const [account] = await asUser(users[0], 'select * from public.get_monthly_account_state($1)', [monthlyChallengeId])
  assert.deepEqual(account.entry_pixels, drawing(colors[5]))
  assert(account.submitted_at)
  const drawingPeriodGallery = await asUser(null, 'select * from public.get_monthly_gallery($1)', [monthlyChallengeId], { role: 'anon' })
  assert.equal(drawingPeriodGallery.length, 5)
  assert(drawingPeriodGallery.every(entry => Number(entry.vote_count) === 0 && entry.has_voted === false))
  const drawingPeriodPage = await asUser(
    null,
    'select * from public.get_monthly_gallery_page($1, $2, $3, $4, $5)',
    [monthlyChallengeId, 'newest', 0, 6, 0],
    { role: 'anon' },
  )
  assert.equal(drawingPeriodPage.length, 5)
  assert.equal(Number(drawingPeriodPage[0].total_count), 5)

  const [{ id: targetBeforeVoting }] = (await db.query(
    'select id from public.monthly_entries where challenge_id = $1 and user_id = $2',
    [monthlyChallengeId, users[1]],
  )).rows
  await assert.rejects(
    asUser(users[0], 'select * from public.set_monthly_vote($1, true)', [targetBeforeVoting]),
    /MONTHLY_VOTING_CLOSED/,
  )

  await db.query(
    "update public.monthly_challenges set voting_starts_at = clock_timestamp() - interval '1 second', ends_at = clock_timestamp() + interval '1 day' where id = $1",
    [monthlyChallengeId],
  )
  await assert.rejects(
    asUser(users[0], 'select public.save_monthly_entry($1, $2::jsonb)', [monthlyChallengeId, JSON.stringify(drawing(colors[0]))]),
    /MONTHLY_DRAWING_LOCKED/,
  )
  await assert.rejects(
    asUser(users[5], 'select public.submit_monthly_entry($1)', [monthlyChallengeId]),
    /MONTHLY_DRAWING_LOCKED/,
  )
  const [{ id: hiddenMonthlyEntryId }] = (await db.query(
    'select id from public.monthly_entries where challenge_id = $1 and user_id = $2',
    [monthlyChallengeId, users[5]],
  )).rows
  await assert.rejects(
    asUser(users[2], 'select * from public.set_monthly_vote($1, true)', [hiddenMonthlyEntryId]),
    /MONTHLY_ENTRY_NOT_FOUND/,
  )
  const [{ prosrc: monthlyVoteSource }] = (await db.query(`
    select p.prosrc
    from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'set_monthly_vote'
  `)).rows
  assert.match(monthlyVoteSource, /from public\.profiles[\s\S]*for update/i)
  const gallery = await asUser(users[0], 'select * from public.get_monthly_gallery($1)', [monthlyChallengeId])
  assert.equal(gallery.length, 5)
  assert(!gallery.some(entry => entry.author_name === 'Artist6'))
  assert(gallery.every(entry => !('user_id' in entry)))
  const own = gallery.find(entry => entry.is_own)
  const others = gallery.filter(entry => !entry.is_own)
  await assert.rejects(
    asUser(users[0], 'select * from public.set_monthly_vote($1, true)', [own.entry_id]),
    /MONTHLY_OWN_VOTE_FORBIDDEN/,
  )
  for (const entry of others.slice(0, 3)) {
    await asUser(users[0], 'select * from public.set_monthly_vote($1, true)', [entry.entry_id])
  }
  await assert.rejects(
    asUser(users[0], 'select * from public.set_monthly_vote($1, true)', [others[3].entry_id]),
    /MONTHLY_VOTE_LIMIT/,
  )

  await db.query("update public.monthly_challenges set ends_at = clock_timestamp() - interval '1 second' where id = $1", [monthlyChallengeId])
  await assert.rejects(
    asUser(users[1], 'select * from public.set_monthly_vote($1, true)', [others[0].entry_id]),
    /MONTHLY_VOTING_CLOSED/,
  )
  const closedGallery = await asUser(null, 'select * from public.get_monthly_gallery($1)', [monthlyChallengeId], { role: 'anon' })
  assert(closedGallery.some(entry => entry.is_winner))
  await assert.rejects(db.query('delete from public.monthly_challenges where id = $1', [monthlyChallengeId]), /foreign key/)
})

test('drafts are validated, private and atomically replaceable', async () => {
  await assert.rejects(
    asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(['#d3493b'])]),
    /WEEKLY_DRAWING_INVALID/,
  )
  const drawingWithNull = drawing(colors[0])
  drawingWithNull[8] = null
  await assert.rejects(
    asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawingWithNull)]),
    /WEEKLY_DRAWING_INVALID/,
  )
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[0]))])
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(Array(1024).fill('transparent'))])
  await asUser(users[0], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[0]))])
  const own = await asUser(users[0], 'select pixels from public.weekly_drafts where challenge_id = $1', [challengeId])
  const other = await asUser(users[1], 'select pixels from public.weekly_drafts where challenge_id = $1', [challengeId])
  assert.equal(own.length, 1)
  assert.equal(other.length, 0)
})

test('one validated entry per account reaches the public gallery', async () => {
  await assert.rejects(
    asUser(users[0], 'select public.submit_weekly_entry($1, $2::jsonb)', [challengeId, JSON.stringify(Array(1024).fill('transparent'))]),
    /WEEKLY_DRAWING_INVALID/,
  )
  for (let index = 0; index < users.length; index += 1) {
    await asUser(
      users[index], 'select public.submit_weekly_entry($1, $2::jsonb)',
      [challengeId, JSON.stringify(drawing(colors[index]))],
    )
  }
  await assert.rejects(
    asUser(users[0], 'select public.submit_weekly_entry($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[0]))]),
    /WEEKLY_ALREADY_SUBMITTED/,
  )
  const gallery = await asUser(null, 'select * from public.get_weekly_gallery($1)', [challengeId], { role: 'anon' })
  assert.equal(gallery.length, users.length)
  assert(gallery.every(entry => Number(entry.vote_count) === 0 && entry.has_voted === false))
  assert.deepEqual(gallery.find(entry => entry.author_name === 'Artist1').author_avatar, drawing('#f7f3e8'))
  assert(gallery.filter(entry => entry.author_name !== 'Artist1').every(entry => entry.author_avatar === null))
  assert(gallery.every(entry => !('user_id' in entry)))
  await assert.rejects(
    asUser(null, 'select user_id from public.weekly_entries', [], { role: 'anon' }),
    /permission denied/,
  )
  const directOwn = await asUser(users[0], 'select user_id from public.weekly_entries')
  assert.deepEqual(directOwn.map(entry => entry.user_id), [users[0]])
})

test('weekly and monthly gallery comments persist without exposing account ids', async () => {
  const weeklyGallery = await asUser(null, 'select * from public.get_weekly_gallery($1)', [challengeId], { role: 'anon' })
  const weeklyEntryId = weeklyGallery[0].entry_id

  await assert.rejects(
    asUser(null, 'select public.add_gallery_comment($1, $2, $3)', ['weekly', weeklyEntryId, 'Vendég komment'], { role: 'authenticated' }),
    /WEEKLY_ACCOUNT_REQUIRED/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.add_gallery_comment($1, $2, $3)', ['weekly', weeklyEntryId, '   ']),
    /GALLERY_COMMENT_INVALID/,
  )
  await asUser(users[0], 'select public.add_gallery_comment($1, $2, $3)', ['weekly', weeklyEntryId, 'Nagyon szép!'])
  await assert.rejects(
    asUser(users[0], 'select public.add_gallery_comment($1, $2, $3)', ['weekly', weeklyEntryId, 'Túl gyors']),
    /GALLERY_COMMENT_RATE_LIMIT/,
  )
  await asUser(users[1], 'select public.add_gallery_comment($1, $2, $3)', ['weekly', weeklyEntryId, '  Jó   lett!  '])

  const weeklyComments = await asUser(
    null, 'select * from public.get_gallery_comments($1, $2)', ['weekly', challengeId], { role: 'anon' },
  )
  assert.equal(weeklyComments.length, 2)
  assert.deepEqual(weeklyComments.map(comment => comment.content), ['Nagyon szép!', 'Jó lett!'])
  assert(weeklyComments.every(comment => !('user_id' in comment)))
  await assert.rejects(
    asUser(users[1], 'select public.update_gallery_comment($1, $2)', [weeklyComments[0].comment_id, 'Nem az enyém']),
    /GALLERY_COMMENT_NOT_OWN/,
  )
  await assert.rejects(
    asUser(users[0], 'select public.update_gallery_comment($1, $2)', [weeklyComments[0].comment_id, '   ']),
    /GALLERY_COMMENT_INVALID/,
  )
  await asUser(
    users[0], 'select public.update_gallery_comment($1, $2)',
    [weeklyComments[0].comment_id, '  Még   szebb!  '],
  )
  const editedComments = await asUser(
    null, 'select * from public.get_gallery_comments($1, $2)', ['weekly', challengeId], { role: 'anon' },
  )
  assert.equal(editedComments[0].content, 'Még szebb!')
  await assert.rejects(asUser(users[0], 'select * from public.gallery_comments'), /permission denied/)

  const [{ id: submittedMonthlyEntryId }] = (await db.query(
    'select id from public.monthly_entries where challenge_id = $1 and user_id = $2',
    [monthlyChallengeId, users[0]],
  )).rows
  const [{ id: hiddenMonthlyEntryId }] = (await db.query(
    'select id from public.monthly_entries where challenge_id = $1 and user_id = $2',
    [monthlyChallengeId, users[5]],
  )).rows
  await asUser(users[2], 'select public.add_gallery_comment($1, $2, $3)', ['monthly', submittedMonthlyEntryId, 'Ez a béka aranyos.'])
  await assert.rejects(
    asUser(users[2], 'select public.add_gallery_comment($1, $2, $3)', ['monthly', hiddenMonthlyEntryId, 'Rejtett']),
    /MONTHLY_ENTRY_NOT_FOUND/,
  )
  const monthlyComments = await asUser(
    null, 'select * from public.get_gallery_comments($1, $2)', ['monthly', monthlyChallengeId], { role: 'anon' },
  )
  assert.equal(monthlyComments.length, 1)
  assert.equal(monthlyComments[0].content, 'Ez a béka aranyos.')
})

test('challenge galleries and entry comments are paginated and sorted on the server', async () => {
  const firstWeeklyPage = await asUser(
    null,
    'select * from public.get_weekly_gallery_page($1, $2, $3, $4, $5)',
    [challengeId, 'likes', 17, 2, 0],
    { role: 'anon' },
  )
  const secondWeeklyPage = await asUser(
    null,
    'select * from public.get_weekly_gallery_page($1, $2, $3, $4, $5)',
    [challengeId, 'likes', 17, 2, 2],
    { role: 'anon' },
  )
  assert.equal(firstWeeklyPage.length, 2)
  assert.equal(Number(firstWeeklyPage[0].total_count), users.length)
  assert.equal(new Set([...firstWeeklyPage, ...secondWeeklyPage].map(entry => entry.entry_id)).size, 4)

  const discovery = await asUser(
    null,
    'select * from public.get_weekly_gallery_page($1, $2, $3, $4, $5)',
    [challengeId, 'discovery', 12345, 6, 0],
    { role: 'anon' },
  )
  const sameDiscovery = await asUser(
    null,
    'select * from public.get_weekly_gallery_page($1, $2, $3, $4, $5)',
    [challengeId, 'discovery', 12345, 6, 0],
    { role: 'anon' },
  )
  const reshuffledDiscovery = await asUser(
    null,
    'select * from public.get_weekly_gallery_page($1, $2, $3, $4, $5)',
    [challengeId, 'discovery', 54321, 6, 0],
    { role: 'anon' },
  )
  assert.deepEqual(discovery.map(entry => entry.entry_id), sameDiscovery.map(entry => entry.entry_id))
  assert.notDeepEqual(discovery.map(entry => entry.entry_id), reshuffledDiscovery.map(entry => entry.entry_id))
  assert(discovery.some(entry => Number(entry.comment_count) === 2))
  await assert.rejects(
    asUser(null, 'select * from public.get_weekly_gallery_page($1, $2, $3, $4, $5)', [challengeId, 'invalid', 0, 6, 0], { role: 'anon' }),
    /GALLERY_SORT_INVALID/,
  )

  const monthlyPage = await asUser(
    null,
    'select * from public.get_monthly_gallery_page($1, $2, $3, $4, $5)',
    [monthlyChallengeId, 'newest', 0, 2, 0],
    { role: 'anon' },
  )
  assert.equal(monthlyPage.length, 2)
  assert.equal(Number(monthlyPage[0].total_count), 5)
  assert(Number(monthlyPage[0].vote_count) <= 3)

  const commentedEntry = discovery.find(entry => Number(entry.comment_count) === 2)
  assert(commentedEntry)
  const firstCommentPage = await asUser(
    null,
    'select * from public.get_gallery_comments_for_entry($1, $2, $3, $4)',
    ['weekly', commentedEntry.entry_id, 1, 0],
    { role: 'anon' },
  )
  const secondCommentPage = await asUser(
    null,
    'select * from public.get_gallery_comments_for_entry($1, $2, $3, $4)',
    ['weekly', commentedEntry.entry_id, 1, 1],
    { role: 'anon' },
  )
  assert.equal(firstCommentPage.length, 1)
  assert.equal(Number(firstCommentPage[0].total_count), 2)
  assert.notEqual(firstCommentPage[0].comment_id, secondCommentPage[0].comment_id)
  assert(firstCommentPage.every(comment => !('user_id' in comment)))
})

test('voting enforces ownership, the three-vote limit and moving a vote', async () => {
  const entries = await asUser(users[0], 'select entry_id, is_own from public.get_weekly_gallery($1)', [challengeId])
  const own = entries.find(entry => entry.is_own)
  const others = entries.filter(entry => !entry.is_own)
  await assert.rejects(
    asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [own.entry_id]),
    /WEEKLY_OWN_VOTE_FORBIDDEN/,
  )
  for (const entry of others.slice(0, 3)) {
    await asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [entry.entry_id])
  }
  await assert.rejects(
    asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [others[3].entry_id]),
    /WEEKLY_VOTE_LIMIT/,
  )
  await asUser(users[0], 'select * from public.set_weekly_vote($1, false)', [others[0].entry_id])
  const [moved] = await asUser(users[0], 'select * from public.set_weekly_vote($1, true)', [others[3].entry_id])
  assert.equal(moved.active_vote_count, 3)
})

test('closing the challenge freezes writes and marks every tied leader', async () => {
  const entries = await asUser(users[1], 'select entry_id, is_own from public.get_weekly_gallery($1)', [challengeId])
  const targets = entries.filter(entry => !entry.is_own).slice(0, 2)
  for (const target of targets) {
    await asUser(users[1], 'select * from public.set_weekly_vote($1, true)', [target.entry_id])
  }
  await db.query("update public.weekly_challenges set ends_at = clock_timestamp() - interval '1 second' where id = $1", [challengeId])
  await assert.rejects(
    asUser(users[2], 'select * from public.set_weekly_vote($1, true)', [targets[0].entry_id]),
    /WEEKLY_CHALLENGE_CLOSED/,
  )
  await assert.rejects(
    asUser(users[2], 'select public.save_weekly_draft($1, $2::jsonb)', [challengeId, JSON.stringify(drawing(colors[2]))]),
    /WEEKLY_CHALLENGE_CLOSED/,
  )
  const gallery = await asUser(null, 'select * from public.get_weekly_gallery($1)', [challengeId], { role: 'anon' })
  const topVotes = gallery.reduce((max, entry) => Math.max(max, Number(entry.vote_count)), 0)
  assert(gallery.filter(entry => entry.is_winner).every(entry => Number(entry.vote_count) === topVotes))
  assert(gallery.some(entry => entry.is_winner))
  const [challenge] = await asUser(null, 'select * from public.get_weekly_challenges()', [], { role: 'anon' })
  assert.equal(challenge.challenge_status, 'closed')
})
