import assert from 'node:assert/strict'
import test from 'node:test'
import { isExpectedCommandAbsenceError, isExpectedFileAbsenceError } from './expectedAbsence.ts'

test('classifies optional filesystem absence without hiding operational failures', () => {
  assert.equal(isExpectedFileAbsenceError({ code: 'ENOENT' }), true)
  assert.equal(isExpectedFileAbsenceError({ code: 'ENOTDIR' }), true)
  assert.equal(isExpectedFileAbsenceError({ code: 'EACCES' }), false)
  assert.equal(isExpectedFileAbsenceError({ code: 'EIO' }), false)
  assert.equal(isExpectedFileAbsenceError({ code: 'ETIMEDOUT' }), false)
})

test('classifies command absence only for explicit missing-command signals', () => {
  assert.equal(isExpectedCommandAbsenceError({ code: 'ENOENT' }), true)
  assert.equal(isExpectedCommandAbsenceError({ code: 127 }), true)
  assert.equal(isExpectedCommandAbsenceError(new Error('sh: tool: command not found')), true)
  assert.equal(
    isExpectedCommandAbsenceError(new Error('Executable was not found: opencode.')),
    true
  )
  assert.equal(isExpectedCommandAbsenceError(new Error('not found: python3')), true)
  assert.equal(isExpectedCommandAbsenceError({ code: 1 }, [1]), true)
  assert.equal(isExpectedCommandAbsenceError({ code: 1 }), false)
  assert.equal(isExpectedCommandAbsenceError({ code: 'EACCES' }), false)
  assert.equal(isExpectedCommandAbsenceError({ code: 'ENETUNREACH' }), false)
  assert.equal(isExpectedCommandAbsenceError(new Error('Request timed out')), false)
  assert.equal(isExpectedCommandAbsenceError({ code: 127, killed: true }), false)
  assert.equal(isExpectedCommandAbsenceError({ code: 127, signal: 'SIGTERM' }), false)
  assert.equal(
    isExpectedCommandAbsenceError({ code: 127, message: 'command not found after timeout' }),
    false
  )
  assert.equal(
    isExpectedCommandAbsenceError(new Error('Executable was not found after request timeout')),
    false
  )
})
