import assert from 'node:assert/strict'
import test from 'node:test'
import { getOpenCodePermissionRules } from './OpenCodePermissions.ts'

const actionFor = (rules, permission, pattern = '*') =>
  rules.findLast((rule) => rule.permission === permission && rule.pattern === pattern)?.action

test('full access allows tools without depending on the separate approval policy', () => {
  for (const approvalPolicy of [undefined, 'on-request', 'never']) {
    const rules = getOpenCodePermissionRules(
      { sandboxMode: 'danger-full-access', approvalPolicy },
      true
    )
    for (const permission of [
      '*',
      'bash',
      'edit',
      'external_directory',
      'doom_loop',
      'sele_browser_*'
    ]) {
      assert.equal(actionFor(rules, permission), 'allow', `${approvalPolicy}: ${permission}`)
    }
    assert.ok(rules.every((rule) => rule.action === 'allow'))
  }
})

test('full access still requires a bound browser capability', () => {
  assert.equal(
    actionFor(getOpenCodePermissionRules({ sandboxMode: 'danger-full-access' }), 'sele_browser_*'),
    'deny'
  )
})

test('workspace access keeps command approvals and external directory restrictions', () => {
  const rules = getOpenCodePermissionRules({
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    additionalDirectories: ['/reference/']
  })
  for (const permission of ['*', 'bash', 'edit', 'external_directory', 'doom_loop']) {
    assert.equal(actionFor(rules, permission), 'ask', permission)
  }
  assert.equal(actionFor(rules, 'read'), 'allow')
  assert.equal(actionFor(rules, 'external_directory', '/reference/**'), 'allow')

  const noApprovals = getOpenCodePermissionRules({ approvalPolicy: 'never' })
  assert.equal(actionFor(noApprovals, 'bash'), 'allow')
  assert.equal(actionFor(noApprovals, 'external_directory'), 'deny')
})

test('read-only access keeps mutations denied even with approvals disabled', () => {
  const rules = getOpenCodePermissionRules(
    { sandboxMode: 'read-only', approvalPolicy: 'never' },
    true
  )
  for (const permission of ['*', 'bash', 'edit', 'task', 'external_directory', 'sele_browser_*']) {
    assert.equal(actionFor(rules, permission), 'deny', permission)
  }
  assert.equal(actionFor(rules, 'read'), 'allow')
})
