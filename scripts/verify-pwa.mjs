import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestPath = new URL('../public/manifest.webmanifest', import.meta.url)

test('the installable app manifest has the required Bitscrawl metadata', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  assert.equal(manifest.short_name, 'Bitscrawl')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i)
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i)
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0)

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/'))
    await access(new URL(`../public${icon.src}`, import.meta.url))
  }
})

test('the document advertises the manifest and mobile app colors', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
  assert.match(html, /name="theme-color" content="#549d8c"/)
})
