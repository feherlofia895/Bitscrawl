import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  brushFootprint,
  composeDrawingLayers,
  compositeDrawingPixel,
  emptyDrawing,
  movePixelSelection,
  parseDrawingDraft,
  rasterizeDrawing,
  replaceDrawingColor,
  transformPixelSelection,
} from '../src/lib/drawing.ts'
import { basePalette, editorPalette32 } from '../src/lib/palette.ts'

test('the visible 12-color buttons use the same hex values as drawing and saving', async () => {
  const [css, canvasSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])

  assert.equal(basePalette.length, 12)
  assert.equal(new Set(basePalette.map(({ hex }) => hex)).size, 12)
  assert(basePalette.every(({ hex }) => /^#[0-9a-f]{6}$/.test(hex)))
  assert.match(canvasSource, /style=\{\{ backgroundColor: color\.hex \}\}/)
  assert.doesNotMatch(
    css,
    /\.drawing-palette\[data-palette-size=['"]12['"]\]\s+button\s*\{[^}]*background-color:\s*transparent/,
  )
  assert.match(
    css,
    /\.drawing-palette\[data-palette-size=['"]12['"]\]\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*16px\)/,
  )
  assert.match(
    css,
    /\.drawing-palette\[data-palette-size=['"]12['"]\]\s+button\s*\{[^}]*background-image:\s*none/,
  )
})

test('the editor 32-color palette is unique, keeps every base color and uses a four-row grid', async () => {
  const css = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.equal(editorPalette32.length, 32)
  assert.equal(new Set(editorPalette32.map(({ hex }) => hex)).size, 32)
  assert(editorPalette32.every(({ hex }) => /^#[0-9a-f]{6}$/.test(hex)))
  assert(basePalette.every(({ hex }) => editorPalette32.some(color => color.hex === hex)))
  assert.match(
    css,
    /\.drawing-palette\[data-palette-size=['"]32['"]\]\s*\{[^}]*grid-template-columns:\s*repeat\(8,\s*20px\)[^}]*grid-template-rows:\s*repeat\(4,\s*20px\)/,
  )
})

test('canvas controls swap above the palette while fullscreen becomes the eleventh tool', async () => {
  const [css, canvasSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(canvasSource, /className="canvas-zoom-button mobile-overflow-view-control"[\s\S]*?>\s*−\s*<\/button>/)
  assert.match(canvasSource, /className="canvas-zoom-button mobile-overflow-view-control"[\s\S]*?>\s*\+\s*<\/button>/)
  assert.match(canvasSource, />\s*Rács\s*<\/button>/)
  assert.doesNotMatch(canvasSource, /Koordináták|showCoordinates|PIXEL_COORDINATES/)
  const primaryControls = canvasSource.indexOf('canvas-view-controls canvas-view-controls-primary')
  const primaryControlsEnd = canvasSource.indexOf('<div className="pixel-toolbar"', primaryControls)
  const primaryControlsSource = canvasSource.slice(primaryControls, primaryControlsEnd)
  const palette = canvasSource.indexOf('className="drawing-palette"')
  const tools = canvasSource.indexOf('<div className={`tool-buttons')
  const canvas = canvasSource.indexOf('className="pixel-canvas-frame"')
  assert(primaryControls >= 0 && primaryControls < tools)
  assert.match(primaryControlsSource, /className="canvas-palette-button"/)
  assert.match(primaryControlsSource, /Paletta szerkesztése/)
  assert.match(primaryControlsSource, />Színkeverő<\/button>/)
  assert(tools < palette && palette < canvas)
  assert.doesNotMatch(canvasSource, /A mentett színek az Egyéni palettára kerülnek\./)
  assert.match(canvasSource, /className="tool-icon-button canvas-immersive-tool-button"/)
  assert.match(canvasSource, /src="\/icons\/tools\/fullscreen\.svg"/)
  assert.match(canvasSource, /className="immersive-floating-palette"/)
  assert.match(canvasSource, /aria-label="Gyors színpaletta"/)
  assert.match(canvasSource, /className="immersive-quick-tools" aria-label="Gyors rajzeszközök"/)
  assert.match(canvasSource, /const immersiveQuickTools: DrawingTool\[\] = \[[\s\S]*?'pencil'[\s\S]*?'eraser'[\s\S]*?'eyedropper'[\s\S]*?'fill'/)
  assert.match(canvasSource, /className="immersive-quick-tools"[\s\S]*?aria-label="Visszavonás"[\s\S]*?<\/nav>/)
  assert.match(canvasSource, /aria-label="További eszközök"[\s\S]*?<span aria-hidden="true">•••<\/span>/)
  assert.match(canvasSource, /!immersiveQuickTools\.includes\(tool\)/)
  assert.match(canvasSource, /!canDraw \? \([\s\S]*?canvas-immersive-controls[\s\S]*?Teljes nézet/)
  assert.match(
    css,
    /\.canvas-view-controls \.canvas-zoom-button,[\s\S]*?width:\s*34px/,
  )
  assert.match(css, /\.pixel-toolbar > \.tool-buttons\s*\{[^}]*order:\s*20/)
  assert.match(css, /\.tool-buttons\.is-compact-mobile\s*\{[^}]*grid-template-columns:\s*repeat\(7, 42px\)/)
  assert.match(css, /\.immersive-floating-palette\s*\{[^}]*position:\s*fixed[^}]*grid-template-columns:\s*repeat\(12, 22px\)/)
  assert.match(css, /\.immersive-quick-tools\s*\{[^}]*position:\s*fixed[^}]*grid-template-columns:\s*repeat\(5, 42px\)/)
})

test('the regular toolbar omits its duplicate pan hand and enlarges the drawn controls', async () => {
  const [css, canvasSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])
  const toolbarStart = canvasSource.indexOf('<div className={`tool-buttons')
  const toolbarEnd = canvasSource.indexOf('className="drawing-palette"', toolbarStart)
  const regularToolbar = canvasSource.slice(toolbarStart, toolbarEnd)

  assert(toolbarStart >= 0 && toolbarEnd > toolbarStart)
  assert.doesNotMatch(regularToolbar, /Vászon mozgatása|\/icons\/tools\/pan\.svg/)
  assert.match(css, /\.tool-buttons \.tool-sprite-button\s*\{[^}]*width:\s*42px[^}]*height:\s*48px/)
  assert.match(css, /background-size:\s*78px 384px/)
  assert.match(css, /\.immersive-side-controls \.tool-sprite-button,[\s\S]*?\.immersive-quick-tools \.tool-sprite-button\s*\{[^}]*width:\s*42px[^}]*height:\s*48px[^}]*background-size:\s*78px 384px/)
  assert.match(css, /\.tool-buttons \.tool-icon-button,[\s\S]*?\.immersive-quick-tools \.tool-icon-button\s*\{[^}]*width:\s*42px[^}]*height:\s*48px/)
  assert.match(css, /\.tool-buttons \.tool-icon-button img,[\s\S]*?\.immersive-quick-tools \.tool-icon-button img\s*\{[^}]*width:\s*27px[^}]*height:\s*27px/)
  assert.match(css, /\.immersive-side-controls \.tool-sprite-button\[aria-pressed='true'\],[\s\S]*?background-image:\s*url\('\/ui\/toolbar-normal\.png'\)[^}]*outline:\s*3px solid var\(--blue\)/)
  assert.match(css, /\.tool-buttons \.tool-sprite-button\[aria-pressed='true'\][\s\S]*?background-image:\s*url\('\/ui\/toolbar-normal\.png'\)[^}]*outline:\s*3px solid var\(--blue\)/)
  assert.match(css, /\.tool-buttons button\[aria-pressed='true'\]\s*\{[^}]*background-color:\s*var\(--mint\)/)
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*?\.tool-buttons\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*42px\)/)
  assert.match(regularToolbar, /aria-label=\{clearCanvasLabel\}[\s\S]*?aria-label="Kijelölés"/)
  assert.match(regularToolbar, /onClick=\{handleClearClick\}[\s\S]*?onPointerUp=\{handleClearPointerUp\}/)
  assert.match(canvasSource, /onLostPointerCapture=\{\(event\) => \{[\s\S]*?finishStroke\(\)/)
  assert.match(canvasSource, /label: 'Pipetta'/)
  assert.match(regularToolbar, /aria-label="Újra"/)
  assert.match(canvasSource, /const brushSizeControls/)
  assert.match(canvasSource, /const \[isBrushSizeOpen, setIsBrushSizeOpen\] = useState\(true\)/)
  assert.match(canvasSource, /const selectToolbarTool = \(tool: DrawingTool\)[\s\S]*?activeTool === tool \? !current : true/)
  assert.match(canvasSource, /setBrushSize\(size\)[\s\S]*?setIsBrushSizeOpen\(false\)/)
  assert.match(canvasSource, /isBrushTool\(activeTool\) && isBrushSizeOpen[\s\S]*?brushSizeControls\(\)/)
  assert.match(canvasSource, /className="immersive-quick-tools"[\s\S]*?isBrushSizeOpen[\s\S]*?brushSizeControls\(true\)/)
  assert.match(canvasSource, />Teljes vászon<\/button>/)
  assert.match(canvasSource, />Kijelölésben<\/button>/)
})

test('advanced drawing tools are enabled in the editor and both challenges', async () => {
  const [
    canvasSource,
    drawingEditorSource,
    appSource,
    weeklySource,
    monthlySource,
    feedSource,
    profileSource,
  ] = await Promise.all([
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DailyFeed.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ProfilePanel.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(canvasSource, /allowEditorTools = false/)
  assert.match(drawingEditorSource, /<PixelCanvas[\s\S]*?allowEditorTools/)
  assert.match(weeklySource, /<PixelCanvas[\s\S]*?allowEditorTools/)
  assert.match(monthlySource, /<PixelCanvas[\s\S]*?allowEditorTools/)
  assert.match(weeklySource, /useChallengeEditorPalettes/)
  assert.match(monthlySource, /useChallengeEditorPalettes/)
  assert.match(weeklySource, /<ChallengePalettePicker/)
  assert.match(monthlySource, /<ChallengePalettePicker/)
  for (const source of [appSource, feedSource, profileSource]) {
    assert.doesNotMatch(source, /allowEditorTools/)
  }
})

test('guest editor access keeps basic colors and PNG export while locking advanced features', async () => {
  const [appSource, editorSource, commentsSource, profilePreviewSource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/GalleryComments.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ProfilePreviewButton.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(appSource, /hasAdvancedAccess=\{Boolean\(currentUserId && playerProfile\)\}/)
  assert.match(editorSource, /hasAdvancedAccess \? initial\.paletteSize : 12/)
  assert.match(editorSource, /setCustomPaletteActive\(false\)[\s\S]*?setPaletteSize\(12\)/)
  assert.match(editorSource, /<EditorAnimationControls[\s\S]*?allowAnimation=\{hasAdvancedAccess\}/)
  assert.match(editorSource, /allowColorMixer=\{hasAdvancedAccess\}/)
  assert.match(editorSource, /allowEditorTools=\{hasAdvancedAccess\}/)
  assert.match(editorSource, /paletteSize=\{hasAdvancedAccess \? paletteSize : 12\}/)
  assert.match(editorSource, /Vendég mód[\s\S]*?12 alapszínnel[\s\S]*?Belépés \/ regisztráció/)
  assert.match(editorSource, /<strong>Kép mentése<\/strong>/)
  assert.match(editorSource, /onClick=\{\(\) => void downloadPng\(\)\}/)
  assert.match(commentsSource, /if \(!isSignedIn\) return null/)
  assert.match(profilePreviewSource, /getWeeklyUser\(\)/)
  assert.match(profilePreviewSource, /\{socialVisible \? <button[\s\S]*?profile-avatar-like-button/)
  assert.match(profilePreviewSource, /\{socialVisible \? <>[\s\S]*?<span><strong>\{receivedLikes/)
})

test('empty drawings do not share mutable data', () => {
  const first = emptyDrawing()
  first[0] = '#d3493b'
  assert.equal(emptyDrawing()[0], 'transparent')
  assert.equal(first.length, 1024)
})

test('brush footprints support one to three pixels and stay inside the canvas', () => {
  assert.deepEqual(brushFootprint({ x: 5, y: 6 }, 1), [{ x: 5, y: 6 }])
  assert.equal(brushFootprint({ x: 5, y: 6 }, 2).length, 4)
  assert.equal(brushFootprint({ x: 5, y: 6 }, 3).length, 9)
  assert.deepEqual(brushFootprint({ x: 0, y: 0 }, 3), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ])
  assert.deepEqual(brushFootprint({ x: 127, y: 127 }, 3, 128), [
    { x: 126, y: 126 },
    { x: 127, y: 126 },
    { x: 126, y: 127 },
    { x: 127, y: 127 },
  ])
})

test('exact color replacement can target either the whole canvas or a selection', () => {
  const source = emptyDrawing()
  source[0] = '#d3493b'
  source[1] = '#d3493b'
  source[33] = '#d3493b'
  source[34] = '#7db4bf'

  const fullCanvas = replaceDrawingColor(source, '#d3493b', '#7db4bf')
  assert.equal(fullCanvas.filter(color => color === '#7db4bf').length, 4)
  assert.equal(source[0], '#d3493b')

  const selected = replaceDrawingColor(
    source,
    '#d3493b',
    '#7db4bf',
    { left: 0, top: 0, right: 0, bottom: 1 },
  )
  assert.equal(selected[0], '#7db4bf')
  assert.equal(selected[1], '#d3493b')
  assert.equal(selected[33], '#d3493b')
})

test('signed-in profiles supply the immutable multiplayer display name', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(appSource, /const profilePlayerName = playerProfile\?\.displayName\.trim\(\) \?\? ''/)
  assert.match(appSource, /const effectivePlayerName = profilePlayerName \|\| playerName\.trim\(\)/)
  assert.match(appSource, /createRoom\(effectivePlayerName, newRoomDuration, \{[\s\S]*?gameMode: newRoomGameMode/)
  assert.match(appSource, /joinRoom\(effectivePlayerName, code \?\? ''\)/)
  assert.match(appSource, /profilePlayerName \? \([\s\S]*?className="profile-player-name"[\s\S]*?: \([\s\S]*?id="create-player-name"/)
  assert.match(appSource, /profilePlayerName \? \([\s\S]*?className="profile-player-name"[\s\S]*?: \([\s\S]*?id="join-player-name"/)
})

test('competition mode exposes timed rounds, parallel drawing and anonymous voting', async () => {
  const [appSource, gameModeSource, gallerySource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/gameMode.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/CompetitionGallery.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(gameModeSource, /competitionDrawDurations = \[60, 90, 120\]/)
  assert.match(gameModeSource, /competitionRoundCounts = \[1, 2, 3, 4, 5\]/)
  assert.match(appSource, /startCompetitionGame\(lobby\.room\.id\)/)
  assert.match(appSource, /submitCompetitionPixelChanges\(competitionRoundView\.round_id, changes\)/)
  assert.match(appSource, /finishCompetitionDrawing\(competitionRoundView\.round_id\)/)
  assert.match(appSource, /finishCompetitionVoting\(competitionRoundView\.round_id\)/)
  assert.match(appSource, /minimumPlayers = roomIsCompetition \? 2/)
  assert.match(gallerySource, /isOwn \|\| votePending/)
  assert.match(gallerySource, /A szavazatodat az idő lejártáig módosíthatod/)
})

test('the monthly canvas waits for the saved drawing before mounting', async () => {
  const source = await readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8')
  assert.match(source, /const accountReady = loadedChallengeId === selectedId/)
  assert.match(source, /const canEdit = !loading && accountReady && monthlyEntryCanBeEdited\(challenge, account\.submittedAt\)/)
  assert.match(source, /initialPixels: account\.entryPixels \?\? emptyDrawing\(challenge\?\.canvas_size \?\? 32\)/)
})

test('monthly gallery keeps comments hidden until voting starts', async () => {
  const source = await readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8')
  assert.match(source, /isDrawing \? null : <GalleryComments/)
})

test('gallery pagination returns to the gallery heading after the requested page loads', async () => {
  const source = await readFile(new URL('../src/components/GalleryPagination.tsx', import.meta.url), 'utf8')
  assert.match(source, /await onPageChange\(nextPage\)/)
  assert.match(source, /closest\('\.weekly-gallery'\)/)
  assert.match(source, /scrollIntoView\(\{ behavior: pageScrollBehavior\(\), block: 'start' \}\)/)
  assert.match(source, /bitscrawl-reduce-motion/)
})

test('gallery navigation groups the drawing wall and challenge periods compactly', async () => {
  const [navigationSource, weeklySource, monthlySource, feedSource, cssSource] = await Promise.all([
    readFile(new URL('../src/components/GalleryNavigation.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DailyFeed.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
  ])

  assert.match(navigationSource, />Rajzfal<\/button>/)
  assert.match(navigationSource, />Kihívásgaléria<\/button>/)
  assert.match(navigationSource, /export function ChallengePeriodNavigation/)
  assert.match(navigationSource, />Heti<\/button>/)
  assert.match(navigationSource, />Havi<\/button>/)
  assert.match(weeklySource, /period="weekly"/)
  assert.match(monthlySource, /period="monthly"/)
  assert.match(feedSource, /view="wall"/)
  assert.match(cssSource, /\.gallery-view-navigation\s*\{[\s\S]*width:\s*min\(100%, 300px\)/)
  assert.match(cssSource, /\.gallery-view-navigation button,\s*\.gallery-period-tabs button\s*\{[\s\S]*menu-button-1\.png/)
  assert.match(cssSource, /\.gallery-view-tabs button\[aria-pressed='true'\][\s\S]*menu-button-yellow-1\.png/)
  assert.match(cssSource, /\.gallery-period-tabs button\s*\{[\s\S]*menu-button-small-mint\.png/)
  assert.match(cssSource, /\.gallery-period-tabs button\[aria-pressed='true'\][\s\S]*menu-button-small-green\.png/)
  assert.match(cssSource, /\.gallery-subcontrols\s*\{[\s\S]*border-top:/)
  assert.match(cssSource, /font:\s*900 \.68rem/)
})

test('the editor uses one share menu for the feed and both challenge entries', async () => {
  const [editorSource, gallerySource, feedSource, cssSource, canvasSource] = await Promise.all([
    readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/DailyFeed.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(editorSource, /<details className="editor-share-menu is-canvas-triggered"/)
  assert.match(editorSource, /onShare=\{openShareMenu\}/)
  assert.match(canvasSource, /className="canvas-share-button"[\s\S]*?>Megosztás<\/button>/)
  const shareMenuIndex = editorSource.indexOf('<details className="editor-share-menu is-canvas-triggered"')
  const exportActionIndex = editorSource.indexOf('onClick={() => void downloadPng()}')
  assert.ok(shareMenuIndex >= 0 && exportActionIndex > shareMenuIndex)
  assert.match(editorSource, /<div className="editor-export-options">[\s\S]*?<strong>Kép mentése<\/strong>[\s\S]*?text\.export/)
  assert.match(editorSource, /status !== text\.local \? <p className="status-message editor-share-status"/)
  assert.doesNotMatch(editorSource, /<\/details>[\s\S]*?<\/div>\s*<p className="status-message" role="status">\{status\}<\/p>/)
  assert.match(editorSource, /event\.target === event\.currentTarget && event\.currentTarget\.open/)
  assert.match(editorSource, /shareDrawing\('feed'\)/)
  assert.match(editorSource, /shareDrawing\('weekly'\)/)
  assert.match(editorSource, /shareDrawing\('monthly'\)/)
  assert.match(editorSource, /saveProfileAvatar\(snapshot\)/)
  assert.match(editorSource, />\s*Beállítás profilképnek\s*<\/button>/)
  assert.match(editorSource, /Biztosan beállítod ezt a rajzot profilképnek\? A mostani profilképed elveszik/)
  assert.match(editorSource, /A kevert színeket a Rajzfal, a profilkép/)
  assert.match(editorSource, /disabled=\{sharing \|\| !shareState\.weekly/)
  assert.match(editorSource, /disabled=\{sharing \|\| !shareState\.monthly/)
  assert.match(editorSource, /A Rajzfal adatbázis-frissítése még nincs telepítve/)
  assert.match(editorSource, /shareState\.feedPostCount >= FEED_DAILY_POST_LIMIT/)
  assert.match(editorSource, /Megosztás a Rajzfalon \(\$\{shareState\.feedPostCount\}\/\$\{FEED_DAILY_POST_LIMIT\}\)/)
  assert.match(editorSource, /Projekt betöltése \(\{shareState\.projectSlots\.length\}\/4\)/)
  assert.match(editorSource, /saveOwnEditorProject\(slotIndex, snapshot\)/)
  assert.match(editorSource, /deleteOwnEditorProject\(slotIndex\)/)
  assert.match(editorSource, /A mentett projekt minden képkockája és rétege/)
  assert.match(editorSource, /<EditorAnimationThumbnail[^>]*frames=\{slot\.previewFrames\}/)
  assert.match(editorSource, /onLoadFromGallery=\{hasAdvancedAccess \? \(\) => void openGalleryAction\('load'\) : undefined\}/)
  assert.match(editorSource, /onSaveToGallery=\{hasAdvancedAccess \? \(\) => void openGalleryAction\('save'\) : undefined\}/)
  assert.match(canvasSource, />Mentés<\/button>/)
  assert.match(canvasSource, />Betöltés<\/button>/)
  assert.match(editorSource, /saveGalleryAction \? 'Teljes projekt mentése' : 'Projekt betöltése'/)
  assert.match(cssSource, /\.editor-gallery-dialog-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/)
  assert.match(gallerySource, /'weekly' \| 'monthly' \| 'feed'/)
  assert.match(gallerySource, /view="challenges"/)
  assert.match(feedSource, /view="wall"/)
  assert.match(feedSource, /todayPostCount}\/\{FEED_DAILY_POST_LIMIT\} képet tettél közzé/)
  assert.match(feedSource, /deleteOwnDailyFeedPost\(post\.post_id\)/)
  assert.match(feedSource, /a napi hely azonnal felszabadul/)
  assert.match(feedSource, /FEED_DESCRIPTION_MAX_LENGTH/)
  assert.match(feedSource, /rows=\{FEED_DESCRIPTION_MAX_LINES\}/)
  assert.match(feedSource, /disabled=\{busy \|\| !user \|\| post\.is_own\}/)
  assert.match(feedSource, />❤<\/button>/)
  assert.match(cssSource, /\.feed-entry-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,/)
})

test('the profile avatar editor accepts official and mixed hexadecimal colors', async () => {
  const [panelSource, profileSource] = await Promise.all([
    readFile(new URL('../src/components/ProfilePanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/profile.ts', import.meta.url), 'utf8'),
  ])
  assert.match(panelSource, /32 színű bővített palettával/)
  assert.match(panelSource, /<PixelCanvas[\s\S]*?paletteSize=\{32\}/)
  assert.match(profileSource, /color === 'transparent' \|\| isHexColor\(color\)/)
})

test('the mobile lobby chat keeps its composer inside the panel', async () => {
  const [css, activeUsers] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ActiveUsers.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(css, /\.global-lobby-chat-form label\s*\{\s*min-width:\s*0;/)
  assert.match(css, /\.global-lobby-chat-form input\s*\{[\s\S]*?max-width:\s*100%;/)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.global-lobby-chat\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;[\s\S]*?overflow:\s*hidden;/)
  assert.match(activeUsers, /useState\(!initialMobile\)/)
  assert.match(activeUsers, /aria-controls="online-profile-content"/)
  assert.match(activeUsers, /aria-expanded=\{isMobile \? isOnlineProfilesOpen : undefined\}/)
  assert.match(activeUsers, /hidden=\{!isOnlineProfilesOpen\}/)
  assert.match(css, /\.active-users-layout\.has-collapsed-online\s*\{\s*grid-template-rows:\s*auto minmax\(280px, 1fr\);/)
})

test('very narrow mobile layouts can shrink below 320px without clipping editor controls', async () => {
  const [appCss, rootCss, appSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  ])

  assert.match(rootCss, /html\s*\{[^}]*min-width:\s*0;/)
  assert.match(rootCss, /body\s*\{[^}]*min-width:\s*0;/)
  assert.match(appSource, /className="topbar-brand-logo">[\s\S]*?topbar-logo-frame logo-frame-off" src="\/ui\/bitscrawl-logo\.png"[\s\S]*?topbar-logo-frame logo-frame-cursor" src="\/ui\/bitscrawl-logo-cursor\.png"/)
  assert.match(appSource, /<div className="environment-badge">[\s\S]*?className="backend-badge"[\s\S]*?className="prototype-badge"/)
  assert.match(appCss, /@media \(max-width: 320px\)[\s\S]*?\.tool-buttons\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*42px\)\)/)
  assert.match(appCss, /@media \(max-width: 320px\)[\s\S]*?\.drawing-palette\[data-palette-size='12'\]\s*\{[^}]*grid-template-columns:\s*repeat\(6,\s*16px\);[^}]*grid-template-rows:\s*repeat\(2,\s*16px\)/)
  assert.match(appCss, /@media \(max-width: 320px\)[\s\S]*?\.gallery-comments-heading[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/)
  assert.match(appCss, /@media \(max-width: 760px\)[\s\S]*?\.topbar-statuses\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 38px;/)
  assert.match(appCss, /@media \(max-width: 760px\)[\s\S]*?\.topbar-settings-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*min-height:\s*34px;[\s\S]*?\.topbar-admin-button\s*\{[^}]*right:\s*50px;/)
  assert.match(appCss, /\.topbar-brand-logo\s*\{[^}]*width:\s*132px;[^}]*height:\s*28px;[^}]*overflow:\s*hidden;/)
  assert.match(appCss, /\.topbar-logo-frame\s*\{[^}]*width:\s*156px;[^}]*image-rendering:\s*pixelated;/)
  assert.match(appCss, /@media \(max-width: 760px\)[\s\S]*?\.environment-badge\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*38px;/)
  assert.match(appCss, /@media \(max-width: 760px\)[\s\S]*?\.profile-menu-button > span:last-child\s*\{[^}]*display:\s*none;/)
  assert.match(appCss, /\.weekly-gallery,\s*\.weekly-challenge-card,\s*\.current-challenges-card,\s*\.scoreboard-heading\s*\{[^}]*background-clip:\s*padding-box;[^}]*border-image-slice:\s*16;/)
  assert.match(appCss, /\.weekly-gallery::before,[\s\S]*?\.scoreboard-heading::after\s*\{[^}]*width:\s*14px;[^}]*height:\s*16px;/)
  assert.doesNotMatch(appCss, /\.current-challenges-card::before,[\s\S]*?\.current-challenges-card::after\s*\{[^}]*top:\s*-/)
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.current-challenges-card li\s*\{[^}]*grid-template-columns:\s*10px minmax\(0,\s*1fr\);/)
})

test('the lobby button shows unread chat without moving and profile previews expose avatar likes', async () => {
  const [css, activeUsersSource, previewSource, profileSource] = await Promise.all([
    readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ActiveUsers.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ProfilePreviewButton.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/profile.ts', import.meta.url), 'utf8'),
  ])
  assert.match(activeUsersSource, /getGlobalLobbyUnreadCount/)
  assert.match(activeUsersSource, /markGlobalLobbyRead/)
  assert.match(activeUsersSource, /\{identity \? <button[\s\S]*?active-users-trigger/)
  assert.match(activeUsersSource, /\{isOpen && identity \? createPortal/)
  assert.doesNotMatch(activeUsersSource, /Jelentkezz be az előszobához/)
  assert.match(activeUsersSource, /className="active-users-unread">!<\/span>/)
  assert.match(css, /\.active-users-trigger\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*visible;/)
  assert.match(css, /\.active-users-unread\s*\{[^}]*position:\s*absolute;/)
  assert.match(previewSource, /className="profile-avatar-like-button"/)
  assert.match(previewSource, /aria-pressed=\{likeState\?\.liked \?\? false\}/)
  assert.match(previewSource, />♥<\/span>/)
  assert.match(profileSource, /setProfileAvatarLike/)
  assert.match(css, /\.profile-avatar-like-button\[aria-pressed='true'\]/)
})

test('local draft restores colors, transparency and export status', () => {
  const pixels = emptyDrawing()
  basePalette.forEach(({ hex }, index) => { pixels[index * 32 + index] = hex })
  assert.deepEqual(parseDrawingDraft(JSON.stringify({ pixels, exported: false })), {
    activeLayer: 0,
    pixels,
    layers: [pixels, emptyDrawing()],
    layerVisibility: [true, true],
    exported: false,
    paletteSize: 12,
    version: 2,
  })
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels, exported: true })).exported, true)
  assert.equal(parseDrawingDraft(JSON.stringify({ pixels })).exported, false)
})

test('local draft restores the expanded editor palette and its colors', () => {
  const pixels = emptyDrawing()
  pixels[0] = editorPalette32[0].hex
  pixels[1] = editorPalette32.at(-1).hex
  assert.deepEqual(parseDrawingDraft(JSON.stringify({ pixels, exported: false, paletteSize: 32 })), {
    activeLayer: 0,
    pixels,
    layers: [pixels, emptyDrawing()],
    layerVisibility: [true, true],
    exported: false,
    paletteSize: 32,
    version: 2,
  })
})

test('two-layer editor drafts restore both layers and their controls', () => {
  const bottom = emptyDrawing()
  const top = emptyDrawing()
  bottom[0] = '#33567e'
  top[1] = '#d3493b'
  const draft = parseDrawingDraft(JSON.stringify({
    activeLayer: 1,
    exported: false,
    layers: [bottom, top],
    layerVisibility: [true, false],
    paletteSize: 32,
    version: 2,
  }))
  assert.deepEqual(draft.layers, [bottom, top])
  assert.deepEqual(draft.layerVisibility, [true, false])
  assert.equal(draft.activeLayer, 1)
  assert.equal(draft.pixels[0], '#33567e')
  assert.equal(draft.pixels[1], 'transparent')
})

test('drawing layers flatten in fixed order and preserve alpha blending', () => {
  const bottom = emptyDrawing()
  const top = emptyDrawing()
  bottom[0] = '#0000ff'
  top[0] = '#ff000080'
  bottom[1] = '#33567e'
  top[1] = '#d3493b'
  assert.equal(compositeDrawingPixel(bottom[0], top[0]), '#80007f')
  assert.deepEqual(composeDrawingLayers([bottom, top]).slice(0, 2), ['#80007f', '#d3493b'])
  assert.deepEqual(composeDrawingLayers([bottom, top], [true, false]).slice(0, 2), ['#0000ff', '#33567e'])
  assert.deepEqual(composeDrawingLayers([bottom, top], [false, true]).slice(0, 2), ['#ff000080', '#d3493b'])
})

test('compact mobile tools and the unified timeline stay out of challenges', async () => {
  const [editorSource, pixelCanvasSource, weeklySource, monthlySource] = await Promise.all([
    readFile(new URL('../src/components/DrawingEditor.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PixelCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WeeklyDraw.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MonthlyDraw.tsx', import.meta.url), 'utf8'),
  ])
  assert.match(editorSource, /<EditorAnimationControls/)
  assert.match(editorSource, /<details className="editor-project-panel editor-collapsible-panel">/)
  assert.match(editorSource, /onSelectCell=\{selectEditorCell\}/)
  assert.doesNotMatch(editorSource, /Felső réteg|Középső réteg|Alsó réteg/)
  assert.match(editorSource, /<details className="editor-palette-panel editor-collapsible-panel">/)
  assert.match(editorSource, /<summary className="editor-collapsible-summary">/)
  assert.match(editorSource, /compactMobileToolbar/)
  assert.match(editorSource, /showDrawModeBadge=\{false\}/)
  assert.match(pixelCanvasSource, /compactMobileToolbar = true/)
  assert.match(pixelCanvasSource, /className="tool-icon-button mobile-more-tools-toggle"/)
  assert.match(pixelCanvasSource, /className="mobile-extra-tool-options"/)
  assert.match(pixelCanvasSource, /className="canvas-zoom-button mobile-overflow-view-control"/)
  assert.match(pixelCanvasSource, /className="canvas-grid-button mobile-overflow-view-control"/)
  assert.match(
    pixelCanvasSource,
    /aria-label="Visszavonás"[\s\S]*?className="tool-icon-button mobile-more-tools-toggle"[\s\S]*?aria-label="Teljes nézet"/,
  )
  assert.match(
    pixelCanvasSource,
    /className="mobile-extra-tool-options"[\s\S]*?isShapeTool\(tool\)[\s\S]*?aria-label="Újra"[\s\S]*?aria-label=\{clearCanvasLabel\}[\s\S]*?aria-label="Kijelölés"[\s\S]*?aria-label="Színcsere"[\s\S]*?aria-label="Kicsinyítés"[\s\S]*?aria-label="Nagyítás"[\s\S]*?aria-label="Rács"/,
  )
  assert.match(
    await readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
    /\.canvas-view-controls-primary\.has-compact-mobile-toolbar \.mobile-overflow-view-control,[\s\S]*?display:\s*none/,
  )
  assert.match(pixelCanvasSource, /className="canvas-palette-button"/)
  assert.doesNotMatch(pixelCanvasSource, /editor-palette-actions|editor-color-mixer-note/)
  assert.match(editorSource, /getDisplayColor: displayEditorLayerColor/)
  assert.doesNotMatch(weeklySource, /EditorAnimationControls|composeDrawingLayers/)
  assert.doesNotMatch(monthlySource, /EditorAnimationControls|composeDrawingLayers/)
  assert.doesNotMatch(weeklySource, /compactMobileToolbar=\{false\}/)
  assert.doesNotMatch(monthlySource, /compactMobileToolbar=\{false\}/)
})

test('corrupt or unsupported drafts cannot become pixel data', () => {
  const cases = [null, '', '{', 'null', '42', '[]', JSON.stringify({ pixels: ['red'] }),
    JSON.stringify({ pixels: Array(1024).fill('#fff') }),
    JSON.stringify({ pixels: Array(1024).fill(123) })]
  for (const value of cases) {
    assert.deepEqual(parseDrawingDraft(value), {
      activeLayer: 0,
      pixels: emptyDrawing(),
      layers: [emptyDrawing(), emptyDrawing()],
      layerVisibility: [true, true],
      exported: true,
      paletteSize: 12,
      version: 2,
    })
  }
})

test('32px PNG raster has exact palette colors and a fully transparent background', () => {
  const pixels = emptyDrawing()
  pixels[0] = '#d3493b'
  pixels[1023] = '#230a19'
  const raster = rasterizeDrawing(pixels, 1)
  assert.equal(raster.width, 32)
  assert.equal(raster.height, 32)
  assert.deepEqual([...raster.data.slice(0, 4)], [211, 73, 59, 255])
  assert.deepEqual([...raster.data.slice(-4)], [35, 10, 25, 255])
  assert.ok(raster.data.slice(4, -4).every(value => value === 0))
})

test('8x PNG raster repeats pixels exactly without smoothing or checkerboard', () => {
  const pixels = emptyDrawing()
  basePalette.forEach(({ hex }, index) => { pixels[index * 33] = hex })
  pixels[1023] = '#230a19'
  const original = rasterizeDrawing(pixels, 1)
  const large = rasterizeDrawing(pixels, 8)
  assert.equal(large.width, 256)
  assert.equal(large.height, 256)
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const originalIndex = (Math.floor(y / 8) * 32 + Math.floor(x / 8)) * 4
      const largeIndex = (y * 256 + x) * 4
      assert.deepEqual(large.data.slice(largeIndex, largeIndex + 4), original.data.slice(originalIndex, originalIndex + 4))
    }
  }
})

test('invalid export size or pixels are rejected', () => {
  for (const scale of [0, -1, 2, 8.5, NaN, Infinity]) {
    assert.throws(() => rasterizeDrawing(emptyDrawing(), scale), /EXPORT_SCALE_INVALID/)
  }
  assert.throws(() => rasterizeDrawing([], 1), /DRAWING_INVALID/)
  assert.throws(() => rasterizeDrawing(Array(1024).fill('red'), 1), /DRAWING_INVALID/)
})

test('a rectangular selection moves as one intact pixel block', () => {
  const pixels = emptyDrawing()
  pixels[1 * 32 + 1] = '#d3493b'
  pixels[1 * 32 + 2] = '#e29958'
  pixels[2 * 32 + 1] = '#67ba62'
  pixels[2 * 32 + 2] = '#33567e'
  const result = movePixelSelection(pixels, { left: 1, top: 1, right: 2, bottom: 2 }, { x: 3, y: 2 })
  assert.deepEqual(result.offset, { x: 3, y: 2 })
  assert.equal(result.pixels[1 * 32 + 1], 'transparent')
  assert.equal(result.pixels[3 * 32 + 4], '#d3493b')
  assert.equal(result.pixels[3 * 32 + 5], '#e29958')
  assert.equal(result.pixels[4 * 32 + 4], '#67ba62')
  assert.equal(result.pixels[4 * 32 + 5], '#33567e')
})

test('selection movement is overlap-safe and stops at the canvas edge', () => {
  const overlapping = emptyDrawing()
  overlapping[1 * 32 + 1] = '#d3493b'
  overlapping[1 * 32 + 2] = '#e29958'
  const overlapResult = movePixelSelection(
    overlapping,
    { left: 1, top: 1, right: 2, bottom: 1 },
    { x: 1, y: 0 },
  )
  assert.equal(overlapResult.pixels[1 * 32 + 1], 'transparent')
  assert.equal(overlapResult.pixels[1 * 32 + 2], '#d3493b')
  assert.equal(overlapResult.pixels[1 * 32 + 3], '#e29958')

  const pixels = emptyDrawing()
  pixels[30 * 32 + 29] = '#d3493b'
  pixels[30 * 32 + 30] = '#e29958'
  const result = movePixelSelection(
    pixels,
    { left: 29, top: 30, right: 30, bottom: 30 },
    { x: 12, y: 8 },
  )
  assert.deepEqual(result.offset, { x: 1, y: 1 })
  assert.equal(result.pixels[31 * 32 + 30], '#d3493b')
  assert.equal(result.pixels[31 * 32 + 31], '#e29958')
  assert.equal(result.pixels[30 * 32 + 29], 'transparent')
  assert.equal(result.pixels[30 * 32 + 30], 'transparent')
})

test('a non-square selection rotates clockwise and swaps its bounds', () => {
  const pixels = emptyDrawing()
  const colors = ['#d3493b', '#e29958', '#67ba62', '#33567e', '#f6e8b1', '#7b3f83']
  colors.forEach((color, index) => {
    const x = 1 + (index % 3)
    const y = 2 + Math.floor(index / 3)
    pixels[y * 32 + x] = color
  })

  const result = transformPixelSelection(
    pixels,
    { left: 1, top: 2, right: 3, bottom: 3 },
    'rotate-clockwise',
  )

  assert.deepEqual(result.bounds, { left: 2, top: 2, right: 3, bottom: 4 })
  assert.deepEqual([
    result.pixels[2 * 32 + 2], result.pixels[2 * 32 + 3],
    result.pixels[3 * 32 + 2], result.pixels[3 * 32 + 3],
    result.pixels[4 * 32 + 2], result.pixels[4 * 32 + 3],
  ], [colors[3], colors[0], colors[4], colors[1], colors[5], colors[2]])
  assert.equal(result.pixels[2 * 32 + 1], 'transparent')
})

test('a selection mirrors independently from left to right and top to bottom', () => {
  const pixels = emptyDrawing()
  const colors = ['#d3493b', '#e29958', '#67ba62', '#33567e', '#f6e8b1', '#7b3f83']
  colors.forEach((color, index) => {
    const x = 4 + (index % 3)
    const y = 5 + Math.floor(index / 3)
    pixels[y * 32 + x] = color
  })
  const bounds = { left: 4, top: 5, right: 6, bottom: 6 }

  const horizontal = transformPixelSelection(pixels, bounds, 'flip-horizontal')
  assert.deepEqual(horizontal.bounds, bounds)
  assert.deepEqual([
    horizontal.pixels[5 * 32 + 4], horizontal.pixels[5 * 32 + 5], horizontal.pixels[5 * 32 + 6],
    horizontal.pixels[6 * 32 + 4], horizontal.pixels[6 * 32 + 5], horizontal.pixels[6 * 32 + 6],
  ], [colors[2], colors[1], colors[0], colors[5], colors[4], colors[3]])

  const vertical = transformPixelSelection(pixels, bounds, 'flip-vertical')
  assert.deepEqual(vertical.bounds, bounds)
  assert.deepEqual([
    vertical.pixels[5 * 32 + 4], vertical.pixels[5 * 32 + 5], vertical.pixels[5 * 32 + 6],
    vertical.pixels[6 * 32 + 4], vertical.pixels[6 * 32 + 5], vertical.pixels[6 * 32 + 6],
  ], [colors[3], colors[4], colors[5], colors[0], colors[1], colors[2]])
})

test('a rotated selection remains fully inside the canvas edge', () => {
  const pixels = emptyDrawing()
  pixels[28 * 32 + 30] = '#d3493b'
  pixels[31 * 32 + 31] = '#e29958'
  const result = transformPixelSelection(
    pixels,
    { left: 30, top: 28, right: 31, bottom: 31 },
    'rotate-clockwise',
  )

  assert.deepEqual(result.bounds, { left: 28, top: 29, right: 31, bottom: 30 })
  assert.equal(result.pixels[29 * 32 + 31], '#d3493b')
  assert.equal(result.pixels[30 * 32 + 28], '#e29958')
  assert.equal(result.pixels[28 * 32 + 30], 'transparent')
  assert.equal(result.pixels[31 * 32 + 31], 'transparent')
})
