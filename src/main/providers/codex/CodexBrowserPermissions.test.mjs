import assert from 'node:assert/strict'
import test from 'node:test'
import { isBrowserPermissionRequest } from './CodexBrowserPermissions.ts'

const request = {
  mode: 'form',
  _meta: { connector_id: 'browser-use', codex_approval_kind: 'mcp_tool_call' },
  requestedSchema: { type: 'object', properties: {}, additionalProperties: false }
}
test('ordinary browser permissions support each app-server form spelling', () => {
  for (const mode of ['form', 'openai/form', 'openaiForm'])
    assert.equal(isBrowserPermissionRequest({ ...request, mode }), true)
})
test('specialized browser requests cannot become ordinary user approvals', () => {
  for (const meta of [
    { codex_strict_auto_review: true },
    { codex_requires_user_input: true },
    { codex_approval_kind: 'browser_auth' },
    { connector_id: 'unrelated' }
  ])
    assert.equal(
      isBrowserPermissionRequest({ ...request, _meta: { ...request._meta, ...meta } }),
      false
    )
  assert.equal(isBrowserPermissionRequest({ ...request, mode: 'url' }), false)
  assert.equal(
    isBrowserPermissionRequest({
      ...request,
      requestedSchema: {
        type: 'object',
        properties: { password: { type: 'string' } }
      }
    }),
    false
  )
  assert.equal(isBrowserPermissionRequest({}), false)
})
