import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatWriteAccessPresentation } from './chatWriteAccess.ts'

test('presents legacy Codex history as permanently read-only', () => {
  assert.deepEqual(
    getChatWriteAccessPresentation({
      writeAccess: 'readOnly',
      writeAccessReason: 'legacyHistory'
    }),
    { readOnly: true, openedElsewhere: false, legacyHistory: true }
  )
})

test('keeps unspecified read-only ownership compatible with external-owner retry', () => {
  assert.deepEqual(getChatWriteAccessPresentation({ writeAccess: 'readOnly' }), {
    readOnly: true,
    openedElsewhere: true,
    legacyHistory: false
  })
})
