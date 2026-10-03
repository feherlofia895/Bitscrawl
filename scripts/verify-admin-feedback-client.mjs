import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

async function library(rpc) {
  const source = await readFile(new URL('../src/lib/adminFeedback.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  new Function('require', 'exports', output)(name => {
    assert.equal(name, './supabase')
    return { supabase: { rpc } }
  }, exports)
  return exports
}

test('admin feedback client maps reports and summary without leaking account ids', async () => {
  const calls = []
  const api = await library(async (name, args) => {
    calls.push([name, args])
    if (name === 'get_admin_feedback_summary') {
      return { data: [{ new_count: '3', bug_count: 2, idea_count: 1 }], error: null }
    }
    if (name === 'get_admin_feedback_reports') {
      return { data: [{
        report_id: 7,
        created_at: '2026-10-02T12:00:00Z',
        reporter_name: 'Synthetic',
        category: 'idea',
        description: 'Synthetic idea',
        steps: null,
        technical_context: { viewport: '390x844' },
        status: 'new',
        user_id: 'must-not-leak',
      }], error: null }
    }
    return { data: [{ report_id: 7, status: 'reviewed' }], error: null }
  })

  assert.deepEqual(await api.loadAdminFeedbackSummary(), { bugCount: 2, ideaCount: 1, newCount: 3 })
  assert.deepEqual(await api.loadAdminFeedbackReports('new'), [{
    category: 'idea',
    createdAt: '2026-10-02T12:00:00Z',
    description: 'Synthetic idea',
    id: 7,
    reporterName: 'Synthetic',
    status: 'new',
    steps: null,
    technicalContext: { viewport: '390x844' },
  }])
  assert.equal(await api.setAdminFeedbackStatus(7, 'reviewed'), 'reviewed')
  assert.deepEqual(calls, [
    ['get_admin_feedback_summary', undefined],
    ['get_admin_feedback_reports', { requested_status: 'new' }],
    ['set_admin_feedback_status', { requested_status: 'reviewed', target_report_id: 7 }],
  ])
})

test('admin feedback client translates authorization and validation failures', async () => {
  for (const [message, pattern] of [
    ['ADMIN_REQUIRED', /jogosultság/],
    ['FEEDBACK_REPORT_NOT_FOUND', /nem található/],
    ['FEEDBACK_STATUS_INVALID', /állapot/],
  ]) {
    const api = await library(async () => ({ data: null, error: { message } }))
    await assert.rejects(api.loadAdminFeedbackReports(null), pattern)
  }
})
