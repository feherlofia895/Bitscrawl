import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addEditorProjectFrame,
  composeEditorProjectFrame,
  createEmptyEditorProject,
  deleteEditorProjectFrame,
  EDITOR_PROJECT_FRAME_LIMIT,
  EDITOR_PROJECT_LAYER_LIMIT,
  EDITOR_PROJECT_MAX_BYTES,
  editorProjectSerializedBytes,
  migrateEditorProject,
  moveEditorProjectLayer,
  parseEditorProject,
  replaceEditorProjectLayer,
} from '../src/lib/editorProject.ts'
import { emptyDrawing } from '../src/lib/drawing.ts'

const colored = color => {
  const pixels = emptyDrawing()
  pixels[37] = color
  return pixels
}

test('a project has three layers, grows to five frames and never loses its last frame', () => {
  let project = createEmptyEditorProject()
  assert.equal(project.frames[0].layers.length, EDITOR_PROJECT_LAYER_LIMIT)
  for (let index = 1; index < EDITOR_PROJECT_FRAME_LIMIT; index += 1) {
    project = addEditorProjectFrame(project, false)
  }
  assert.equal(project.frames.length, 5)
  assert.equal(addEditorProjectFrame(project, false).frames.length, 5)
  while (project.frames.length > 1) project = deleteEditorProjectFrame(project, 0)
  assert.equal(deleteEditorProjectFrame(project, 0).frames.length, 1)
})

test('layer editing and reordering apply to the selected cel and every frame stack', () => {
  const bottom = colored('#112233')
  const middle = colored('#445566')
  let project = createEmptyEditorProject()
  project = replaceEditorProjectLayer(project, 0, 0, bottom)
  project = addEditorProjectFrame(project, false)
  project = replaceEditorProjectLayer(project, 1, 1, middle)
  project.activeLayer = 1
  project.layerVisibility = [true, false, true]
  project = moveEditorProjectLayer(project, 1, 2)
  assert.deepEqual(project.frames[0].layers[0], bottom)
  assert.deepEqual(project.frames[1].layers[2], middle)
  assert.equal(project.activeLayer, 2)
  assert.deepEqual(project.layerVisibility, [true, true, false])
  assert.equal(composeEditorProjectFrame(project, 1)[37], 'transparent')
})

test('legacy two-layer drawings and standalone animations migrate without flattening', () => {
  const bottom = colored('#112233')
  const top = colored('#44556680')
  const animationOne = colored('#778899')
  const animationTwo = colored('#abcdef')
  const project = migrateEditorProject(
    JSON.stringify({
      activeLayer: 1,
      exported: false,
      layers: [bottom, top],
      layerVisibility: [true, false],
      paletteSize: 32,
      version: 2,
    }),
    JSON.stringify({ activeFrameIndex: 1, fps: 6, frames: [animationOne, animationTwo], onionSkin: false }),
  )
  assert.equal(project.version, 3)
  assert.equal(project.frames.length, 3)
  assert.deepEqual(project.frames[0].layers, [bottom, top, emptyDrawing()])
  assert.deepEqual(project.frames[1].layers[0], animationOne)
  assert.deepEqual(project.frames[2].layers[0], animationTwo)
  assert.equal(project.fps, 6)
  assert.equal(project.paletteSize, 32)
})

test('strict parsing rejects malformed and oversized document shapes', () => {
  const project = createEmptyEditorProject()
  assert.ok(parseEditorProject(project))
  assert.equal(parseEditorProject({ ...project, frames: [] }), null)
  assert.equal(parseEditorProject({ ...project, layerVisibility: [true, true] }), null)
  assert.ok(editorProjectSerializedBytes(project) < EDITOR_PROJECT_MAX_BYTES)
  let maximal = createEmptyEditorProject(32)
  maximal.frames = Array.from({ length: 5 }, () => ({
    layers: Array.from({ length: 3 }, () => Array(1024).fill('#12345678')),
  }))
  assert.ok(editorProjectSerializedBytes(maximal) < EDITOR_PROJECT_MAX_BYTES)
})
