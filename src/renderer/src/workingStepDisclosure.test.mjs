import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getWorkingStepDefaultOpen,
  getWorkingStepDisclosureKey,
  getWorkingStepProgressPolicy,
  resolveWorkingStepOpen
} from './workingStepDisclosure.ts'

const defaultSettings = {
  expandProgressOnStart: true,
  collapseProgressOnFinish: true,
  collapseProgressOnNextTurn: false,
  collapseStoppedSteeredFailedProgressOnFinish: true,
  collapseStoppedSteeredFailedProgressOnNextTurn: false
}

// Test fixtures intentionally omit optional presentation fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const workingStep = (status = 'worked') => ({
  type: 'working',
  id: `working-${status}`,
  status,
  items: []
})

test('progress expands on start and collapses on finish by default for both policies', () => {
  assert.equal(getWorkingStepDefaultOpen('working', 'regular', defaultSettings, false), true)
  assert.equal(getWorkingStepDefaultOpen('worked', 'regular', defaultSettings, false), false)
  assert.equal(
    getWorkingStepDefaultOpen('working', 'stoppedSteeredFailed', defaultSettings, false),
    true
  )
  assert.equal(
    getWorkingStepDefaultOpen('stopped', 'stoppedSteeredFailed', defaultSettings, false),
    false
  )
})

test('the general start setting controls active steered progress', () => {
  const settings = { ...defaultSettings, expandProgressOnStart: false }

  assert.equal(getWorkingStepDefaultOpen('working', 'regular', settings, false), false)
  assert.equal(getWorkingStepDefaultOpen('working', 'stoppedSteeredFailed', settings, false), false)
})

test('stopped, failed, and steered turns share one progress policy', () => {
  const regularStep = workingStep()
  const stoppedStep = workingStep('stopped')
  const failedStep = workingStep('failed')
  const steeredMessage = {
    type: 'message',
    id: 'steering-message',
    role: 'user',
    content: 'Change direction',
    kind: 'steering'
  }

  assert.equal(getWorkingStepProgressPolicy(regularStep, [regularStep]), 'regular')
  assert.equal(getWorkingStepProgressPolicy(stoppedStep, [stoppedStep]), 'stoppedSteeredFailed')
  assert.equal(getWorkingStepProgressPolicy(failedStep, [failedStep]), 'stoppedSteeredFailed')
  assert.equal(
    getWorkingStepProgressPolicy(regularStep, [steeredMessage, regularStep]),
    'stoppedSteeredFailed'
  )
})

test('exceptional finish and next-turn controls are independent from regular progress', () => {
  const settings = {
    ...defaultSettings,
    collapseProgressOnFinish: true,
    collapseStoppedSteeredFailedProgressOnFinish: false,
    collapseStoppedSteeredFailedProgressOnNextTurn: true
  }

  assert.equal(getWorkingStepDefaultOpen('worked', 'regular', settings, false), false)
  assert.equal(getWorkingStepDefaultOpen('stopped', 'stoppedSteeredFailed', settings, false), true)
  assert.equal(getWorkingStepDefaultOpen('stopped', 'stoppedSteeredFailed', settings, true), false)
})

test('a status or policy change resets stale manual disclosure state', () => {
  const stoppedSettings = {
    ...defaultSettings,
    collapseStoppedSteeredFailedProgressOnFinish: false
  }
  const workingKey = getWorkingStepDisclosureKey('working', 'regular', defaultSettings, false)
  const stoppedKey = getWorkingStepDisclosureKey(
    'stopped',
    'stoppedSteeredFailed',
    stoppedSettings,
    false
  )
  const stoppedDefaultOpen = getWorkingStepDefaultOpen(
    'stopped',
    'stoppedSteeredFailed',
    stoppedSettings,
    false
  )

  assert.notEqual(stoppedKey, workingKey)
  assert.equal(
    resolveWorkingStepOpen({ key: workingKey, open: false }, stoppedKey, stoppedDefaultOpen),
    true
  )
})
