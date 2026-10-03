import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestPath = new URL('../public/manifest.webmanifest', import.meta.url)

test('the installable app manifest has the required Bitscrawl metadata', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  assert.equal(manifest.short_name, 'Bitscrawl')
  assert.equal(manifest.id, '/')
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

  const iconSizes = new Set(manifest.icons.map(icon => icon.sizes))
  assert.ok(iconSizes.has('192x192'))
  assert.ok(iconSizes.has('512x512'))
  assert.ok(manifest.icons.some(icon => (
    icon.src === '/icons/bitscrawl-app-maskable-512.png' &&
    icon.sizes === '512x512' &&
    icon.purpose === 'maskable'
  )))
})

test('the document advertises the manifest and mobile app colors', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')

  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/)
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/icons\/bitscrawl-app-180\.png"/)
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/)
  assert.match(html, /name="theme-color" content="#549d8c"/)
})

test('the PNG install icons have the advertised pixel sizes', async () => {
  for (const [fileName, size] of [
    ['bitscrawl-app-180.png', 180],
    ['bitscrawl-app-192.png', 192],
    ['bitscrawl-app-512.png', 512],
    ['bitscrawl-app-maskable-512.png', 512],
  ]) {
    const icon = await readFile(new URL(`../public/icons/${fileName}`, import.meta.url))
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    assert.equal(icon.readUInt32BE(16), size)
    assert.equal(icon.readUInt32BE(20), size)
  }
})

test('the production service worker stays network-only and updates without stale caches', async () => {
  const [worker, main, installHook, updateHook, bugReports, adminFeedback, app, config] = await Promise.all([
    readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/usePwaInstall.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/usePwaUpdate.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/bugReports.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/AdminFeedbackCenter.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.ts', import.meta.url), 'utf8'),
  ])

  assert.match(worker, /skipWaiting\(\)/)
  assert.match(worker, /clients\.claim\(\)/)
  assert.match(worker, /event\.respondWith\(fetch\(event\.request\)\)/)
  assert.doesNotMatch(worker, /caches\.(?:open|match)|CacheStorage/)
  assert.match(main, /import\.meta\.env\.PROD/)
  assert.match(main, /serviceWorker\.register\('\/service-worker\.js', \{ updateViaCache: 'none' \}\)/)
  assert.match(installHook, /beforeinstallprompt/)
  assert.match(installHook, /appinstalled/)
  assert.match(config, /fileName: 'build-info\.json'/)
  assert.match(config, /__BITSCRAWL_BUILD_ID__/)
  assert.match(updateHook, /fetch\(`\/build-info\.json\?t=\$\{Date\.now\(\)\}`/)
  assert.match(updateHook, /cache: 'no-store'/)
  assert.match(updateHook, /visibilitychange/)
  assert.match(updateHook, /document\.visibilityState === 'visible'/)
  assert.match(updateHook, /window\.location\.reload\(\)/)
  assert.doesNotMatch(updateHook, /controllerchange/)
  assert.match(bugReports, /build_id: __BITSCRAWL_BUILD_ID__/)
  assert.match(adminFeedback, /build_id: 'Build'/)
  assert.match(app, /Új Bitscrawl-verzió érhető el/)
  assert.match(app, /onClick=\{pwaUpdate\.reload\}/)
  assert.match(app, /Build \{pwaUpdate\.buildId\}/)
  assert.match(app, /Főképernyőhöz adás/)
  assert.match(app, /pwaInstall\.install\(\)/)
})
