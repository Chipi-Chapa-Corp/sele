import assert from 'node:assert/strict'
import test from 'node:test'
import { getClaudePermissionAction, getClaudePermissionMode } from './ClaudePermissions.ts'

test('keeps host permission callbacks enabled for no-approval sessions', () => {
  assert.equal(getClaudePermissionMode({ approvalPolicy: 'never' }), 'default')
})

test('uses the SDK classifier for automatic review sessions', () => {
  assert.equal(getClaudePermissionMode({ approvalsReviewer: 'auto_review' }), 'auto')
})

test('routes user questions through the host even when approvals are disabled', () => {
  assert.deepEqual(getClaudePermissionAction({ approvalPolicy: 'never' }, 'AskUserQuestion', {}), {
    kind: 'userQuestion'
  })
})

test('auto-allows ordinary tools when approvals are disabled', () => {
  const input = { command: 'pwd' }
  assert.deepEqual(getClaudePermissionAction({ approvalPolicy: 'never' }, 'Bash', input), {
    kind: 'resolve',
    result: { behavior: 'allow', updatedInput: input }
  })
})

test('read-only restrictions take precedence over the no-approval policy', () => {
  assert.deepEqual(
    getClaudePermissionAction({ approvalPolicy: 'never', sandboxMode: 'read-only' }, 'Write', {
      file_path: 'example.txt'
    }),
    {
      kind: 'resolve',
      result: { behavior: 'deny', message: 'This chat is in read-only mode.' }
    }
  )
})
