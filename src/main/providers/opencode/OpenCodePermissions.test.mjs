import assert from 'node:assert/strict'
import test from 'node:test'
import { getOpenCodePermissionRules } from './OpenCodePermissions.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const ruleAction = (rules, permission, pattern = '*') =>
  rules.findLast((rule) => rule.permission === permission && rule.pattern === pattern)?.action

test('asks for workspace mutations and outside-directory access by default', () => {
  const rules = getOpenCodePermissionRules({
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    additionalDirectories: ['/shared/work/']
  })

  assert.equal(ruleAction(rules, 'edit'), 'ask')
  assert.equal(ruleAction(rules, 'bash'), 'ask')
  assert.equal(ruleAction(rules, 'external_directory'), 'ask')
  assert.equal(ruleAction(rules, 'external_directory', '/shared/work/**'), 'allow')
  assert.equal(ruleAction(rules, 'task'), 'allow')
  assert.equal(ruleAction(rules, '*'), 'ask')
  assert.equal(ruleAction(rules, 'read'), 'allow')
})

test('enforces read-only mode even when approvals are disabled', () => {
  const rules = getOpenCodePermissionRules({
    approvalPolicy: 'never',
    sandboxMode: 'read-only'
  })

  assert.equal(ruleAction(rules, 'edit'), 'deny')
  assert.equal(ruleAction(rules, 'bash'), 'deny')
  assert.equal(ruleAction(rules, 'task'), 'deny')
  assert.equal(ruleAction(rules, 'external_directory'), 'deny')
  assert.equal(ruleAction(rules, 'doom_loop'), 'allow')
  assert.equal(ruleAction(rules, '*'), 'deny')
})

test('allows mutations and asks for outside access in full-access approval mode', () => {
  const rules = getOpenCodePermissionRules({
    approvalPolicy: 'on-request',
    sandboxMode: 'danger-full-access'
  })

  assert.equal(ruleAction(rules, 'edit'), 'ask')
  assert.equal(ruleAction(rules, 'bash'), 'ask')
  assert.equal(ruleAction(rules, 'external_directory'), 'ask')
})
