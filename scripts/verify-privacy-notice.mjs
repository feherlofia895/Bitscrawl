import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const privacySource = await readFile(new URL('../src/components/PrivacyPolicy.tsx', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const profileSource = await readFile(new URL('../src/components/ProfilePanel.tsx', import.meta.url), 'utf8')
const weeklySource = await readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8')
const monthlySource = await readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8')

test('the privacy notice covers the real account and community data flow', () => {
  for (const requiredText of [
    'E-mail-cím',
    'Megjelenített név',
    'Rajzfalra feltöltött rajzok és animációk',
    'Saját piszkozatok, paletták',
    'chat- és tippüzenetek',
    'IP-cím',
    'Supabase Auth',
    'bcrypt',
    'Cloudflare, Inc.',
  ]) {
    assert.match(privacySource, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('the notice identifies the controller and states the chosen retention periods', () => {
  assert.match(privacySource, /Sárközi Martin János/)
  assert.match(privacySource, /mailto:bitscrawl\.adatvedelem@gmail\.com/)
  assert.doesNotMatch(privacySource, /\[KITÖLTENDŐ:/)
  assert.doesNotMatch(privacySource, /tervezet/i)
  assert.match(privacySource, /legfeljebb 30 napig/)
  assert.match(privacySource, /Határozatlan ideig, amíg a galéria vagy archívum működik/)
})

test('the notice lists the principal GDPR rights and complaint route', () => {
  for (const requiredText of [
    'hozzáférést',
    'helyesbítést',
    'törlést',
    'korlátozását',
    'adathordozhatóságot',
    'tiltakozhatsz',
    'Nemzeti Adatvédelmi és Információszabadság Hatóságnál',
  ]) {
    assert.match(privacySource, new RegExp(requiredText))
  }
})

test('the privacy page is routed from the footer and every registration form', () => {
  assert.match(appSource, /homeView === 'privacy'/)
  assert.match(appSource, /Adatvédelmi tájékoztató/)
  for (const source of [profileSource, weeklySource, monthlySource]) {
    assert.match(source, /PrivacyNoticePrompt/)
    assert.match(source, /onOpenPrivacy/)
  }
})
