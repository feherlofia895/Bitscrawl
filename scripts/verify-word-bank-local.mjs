// Isolated in-memory PostgreSQL. Does not load .env.local or contact Supabase.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const host = '53000000-0000-4000-8000-000000000001'
const guest = '53000000-0000-4000-8000-000000000002'

async function asUser(user, sql, params = [], role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ''])
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ is_anonymous: true })])
  await db.exec(`set role ${role}`)
  try { return (await db.query(sql, params)).rows }
  finally { await db.exec('reset role') }
}

function quotedArray(functionDefinition) {
  const body = functionDefinition.match(/prompts text\[\]\s*:=\s*array\[([\s\S]*?)\];/)?.[1]
  assert.ok(body, 'A kihívás szólistája nem található a függvényben.')
  return [...body.matchAll(/'([^']+)'/g)].map(match => match[1])
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
  await db.query('insert into auth.users values ($1), ($2)', [host, guest])
  const migrationDir = new URL('../supabase/migrations/', import.meta.url)
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) {
    try { await db.exec(await readFile(new URL(file, migrationDir), 'utf8')) }
    catch (error) { throw new Error(`Migration failed: ${file}: ${error.message}`) }
  }
})

after(async () => { await db.close() })

test('classic guessing and competition drawing share a curated prompt bank', async () => {
  const words = (await db.query('select word from private.word_bank order by word')).rows.map(row => row.word)
  const expectedReplacements = [
    'evővilla', 'fagylalt', 'falevél', 'falióra', 'játékbaba', 'kastély',
    'kisegér', 'macska', 'motorkerékpár', 'repülőgép', 'sütemény', 'televízió',
  ]
  const rejectedPrompts = [
    'baba', 'burgonya', 'cica', 'egér', 'fagyi', 'levél', 'motor', 'repülő',
    'süti', 'teve', 'tévé', 'vár', 'villa', 'óra',
  ]

  assert.equal(words.length, 168)
  assert.ok(expectedReplacements.every(word => words.includes(word)))
  assert.ok(rejectedPrompts.every(word => !words.includes(word)))
  assert.ok(words.every(word => word.length >= 2 && word.length <= 24 && word === word.trim().toLowerCase()))

  const collisions = (await db.query(`
    select private.normalize_answer(word) as normalized, array_agg(word order by word) as words
    from private.word_bank
    group by private.normalize_answer(word)
    having count(*) > 1
  `)).rows
  assert.deepEqual(collisions, [])

  const [{ definition: classicDefinition }] = (await db.query(
    "select pg_get_functiondef('public.start_game(bigint)'::regprocedure) as definition",
  )).rows
  const [{ definition: competitionDefinition }] = (await db.query(
    "select pg_get_functiondef('public.start_competition_game(bigint)'::regprocedure) as definition",
  )).rows
  assert.match(classicDefinition, /private\.word_bank/)
  assert.match(competitionDefinition, /private\.start_competition_game/)
  const [{ definition: privateCompetitionDefinition }] = (await db.query(
    "select pg_get_functiondef('private.start_competition_game(bigint)'::regprocedure) as definition",
  )).rows
  assert.match(privateCompetitionDefinition, /private\.word_bank/)

  const [{ definition: competitionVotingDefinition }] = (await db.query(
    "select pg_get_functiondef('private.finish_competition_voting(bigint)'::regprocedure) as definition",
  )).rows
  assert.match(competitionVotingDefinition, /private\.competition_votes/)
  assert.match(competitionVotingDefinition, /score = rp\.score \+ votes\.vote_count/)
  assert.doesNotMatch(competitionVotingDefinition, /answer_matches/)
})

test('public-vote challenges use only reviewed visual themes without answer matching', async () => {
  const [{ definition: weeklyDefinition }] = (await db.query(
    "select pg_get_functiondef('private.ensure_weekly_challenge()'::regprocedure) as definition",
  )).rows
  const [{ definition: monthlyDefinition }] = (await db.query(
    "select pg_get_functiondef('private.ensure_monthly_challenge()'::regprocedure) as definition",
  )).rows

  const weeklyRotation = [
    'Sárkány', 'Világítótorony', 'Űrhajó', 'Gombaház', 'Gomba', 'Polip',
    'Vulkán', 'Robot', 'Kastély', 'Macska', 'Hőlégballon', 'Tengeralattjáró',
  ]
  const monthlyRotation = [
    'Béka', 'Bagoly', 'Űrállomás', 'Kalózhajó', 'Varázserdő', 'Tengeri szörny',
    'Robotváros', 'Sárkánytojás', 'Kísértetház', 'Halloween', 'Vidámpark',
    'Víz alatti kastély',
  ]

  assert.deepEqual(quotedArray(weeklyDefinition), weeklyRotation)
  assert.deepEqual(quotedArray(monthlyDefinition), monthlyRotation)
  assert.doesNotMatch(weeklyDefinition, /answer_matches/)
  assert.doesNotMatch(monthlyDefinition, /answer_matches/)

  const storedWeeklyPrompts = (await db.query(
    'select distinct prompt from public.weekly_challenges order by prompt',
  )).rows.map(row => row.prompt)
  const storedMonthlyPrompts = (await db.query(
    'select distinct prompt from public.monthly_challenges order by prompt',
  )).rows.map(row => row.prompt)
  const approvedWeeklyPrompts = new Set([...weeklyRotation, 'Boszorkány'])
  const approvedMonthlyPrompts = new Set(monthlyRotation)

  assert.ok(storedWeeklyPrompts.every(prompt => approvedWeeklyPrompts.has(prompt)))
  assert.ok(storedMonthlyPrompts.every(prompt => approvedMonthlyPrompts.has(prompt)))
})

test('aliases are target-specific, accent tolerant and reject unrelated guesses', async () => {
  const cases = [
    ['macska', ' CÍCA ', true],
    ['krumpli', 'burgonya', true],
    ['fagylalt', 'jégkrém', true],
    ['televízió', 'TV', true],
    ['motorkerékpár', 'motor', true],
    ['macska', 'kutya', false],
    ['krumpli', 'körte', false],
    ['televízió', 'macska', false],
  ]
  for (const [prompt, answer, expected] of cases) {
    const [{ matches }] = (await db.query(
      'select private.answer_matches($1, $2) as matches',
      [prompt, answer],
    )).rows
    assert.equal(matches, expected, `${prompt} / ${answer}`)
  }

  const ambiguousAliases = (await db.query(`
    select alias.prompt, alias.accepted_answer, bank.word
    from private.word_answer_aliases as alias
    join private.word_bank as prompt_bank
      on private.normalize_answer(prompt_bank.word) = private.normalize_answer(alias.prompt)
    join private.word_bank as bank
      on private.normalize_answer(bank.word) = private.normalize_answer(alias.accepted_answer)
    where private.normalize_answer(bank.word) <> private.normalize_answer(alias.prompt)
  `)).rows
  assert.deepEqual(ambiguousAliases, [])
})

test('the synonym list stays private and submit_guess uses the protected matcher', async () => {
  await assert.rejects(
    asUser(host, 'select * from private.word_answer_aliases'),
    /permission denied/,
  )
  await assert.rejects(
    asUser(host, "select private.answer_matches('macska', 'cica')"),
    /permission denied/,
  )
  const [{ matcher_definer: matcherDefiner, matcher_volatility: matcherVolatility, submit_definer: submitDefiner, submit_source: submitSource }] = (await db.query(`
    select
      matcher.prosecdef as matcher_definer,
      matcher.provolatile as matcher_volatility,
      submit.prosecdef as submit_definer,
      pg_get_functiondef(submit.oid) as submit_source
    from pg_proc as matcher
    cross join pg_proc as submit
    where matcher.oid = 'private.answer_matches(text,text)'::regprocedure
      and submit.oid = 'public.submit_guess(bigint,text)'::regprocedure
  `)).rows
  assert.equal(matcherDefiner, false)
  assert.equal(matcherVolatility, 's')
  assert.equal(submitDefiner, true)
  assert.match(submitSource, /private\.answer_matches\(target_word, clean_guess\)/)
})

test('submit_guess accepts cica for macska without leaking the secret or accepting a stranger word', async () => {
  const [room] = await asUser(host, "select * from public.create_room('WordHost')")
  await asUser(guest, 'select * from public.join_room($1, $2)', [room.room_code, 'WordGuest'])
  await asUser(host, 'select * from public.set_room_test_mode($1, true)', [room.room_id])
  await asUser(host, 'select * from public.start_game($1)', [room.room_id])
  const [choosing] = await asUser(host, 'select * from public.get_round_view($1)', [room.room_id])
  await db.query(
    "update private.round_secrets set word_options = array['macska', 'kutya', 'ház'] where round_id = $1",
    [choosing.round_id],
  )
  await asUser(host, "select * from public.choose_round_word($1, 'macska')", [choosing.round_id])

  const [guestView] = await asUser(guest, 'select * from public.get_round_view($1)', [room.room_id])
  assert.equal(guestView.chosen_word, null)
  assert.equal(guestView.word_options, null)

  const [wrong] = await asUser(guest, "select * from public.submit_guess($1, 'kutyus')", [choosing.round_id])
  assert.equal(wrong.is_correct, false)
  assert.equal(wrong.message_id, null)

  const [correct] = await asUser(guest, "select * from public.submit_guess($1, '  CÍCA  ')", [choosing.round_id])
  assert.equal(correct.is_correct, true)
  assert.ok(correct.awarded_points >= 100)
  assert.equal(correct.round_finished, true)
})
