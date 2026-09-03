import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getWorkingStepDefaultOpen,
  getWorkingStepDisclosureKey,
  resolveWorkingStepOpen
} from './workingStepDisclosure.ts'

const reportedSettings = {
  expandThoughtsOnStart: true,
  collapseThoughtsOnFinish: true,
  collapseThoughtsOnNextTurn: false,
  expandStoppedTurns: true,
  collapseStoppedOnNextTurn: false
}

test('a stopped step gets a new disclosure preference and expands when configured', () => {
  const workingKey = getWorkingStepDisclosureKey('working', reportedSettings, false)
  const stoppedKey = getWorkingStepDisclosureKey('stopped', reportedSettings, false)
  const stoppedDefaultOpen = getWorkingStepDefaultOpen('stopped', reportedSettings, false)

  assert.notEqual(stoppedKey, workingKey)
  assert.equal(stoppedDefaultOpen, true)
  assert.equal(
    resolveWorkingStepOpen({ key: workingKey, open: false }, stoppedKey, stoppedDefaultOpen),
    true
  )
})

test('the reported settings still collapse completed pre-steering work', () => {
  assert.equal(getWorkingStepDefaultOpen('worked', reportedSettings, false), false)
})
