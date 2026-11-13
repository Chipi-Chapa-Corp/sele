import assert from 'node:assert/strict'
import test from 'node:test'
import { getCodexApprovalPolicy } from './CodexApprovalPolicy.ts'

test('noninteractive command approvals still allow MCP app-consent forms to reach the user', () => {
  const policy = getCodexApprovalPolicy('never')
  assert.equal(policy.granular.mcp_elicitations, true)
  for (const category of ['sandbox_approval', 'rules', 'request_permissions', 'skill_approval'])
    assert.equal(policy.granular[category], false, category)
})

test('interactive command approval policies retain their selected behavior', () => {
  assert.equal(getCodexApprovalPolicy('on-request'), 'on-request')
  assert.equal(getCodexApprovalPolicy('on-failure'), 'on-failure')
})
