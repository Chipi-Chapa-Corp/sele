import assert from 'node:assert/strict'
import test from 'node:test'

import { getChatCommitLaunchMode, isChatCommitProjectLocked } from './chatCommitPolicy.ts'

test('always forks a commit that starts from an existing chat', () => {
  assert.equal(getChatCommitLaunchMode('chat-1'), 'fork')
  assert.equal(getChatCommitLaunchMode(null), 'new')
})

test('locks commit operations across the project while any commit is active or starting', () => {
  assert.equal(isChatCommitProjectLocked(1, false), true)
  assert.equal(isChatCommitProjectLocked(0, true), true)
  assert.equal(isChatCommitProjectLocked(0, false), false)
})
