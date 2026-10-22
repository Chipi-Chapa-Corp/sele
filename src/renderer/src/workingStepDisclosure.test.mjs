import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel } from './chatConversationModel.ts'
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

test('steering keeps the preceding Worked block open when both steered collapse settings are off', () => {
  const settings = {
    ...defaultSettings,
    collapseProgressOnNextTurn: true,
    collapseStoppedSteeredFailedProgressOnFinish: false,
    collapseStoppedSteeredFailedProgressOnNextTurn: false
  }
  const step = workingStep()
  const nextStep = { ...workingStep('working'), id: 'next-working' }
  const steeringMessage = {
    type: 'message',
    id: 'steering-message',
    role: 'user',
    content: 'Change direction',
    kind: 'steering'
  }
  const model = buildChatConversationModel([
    { type: 'message', id: 'initial', role: 'user', content: 'Start here' },
    step,
    steeringMessage,
    nextStep
  ])
  assert.equal(model.turns.length, 2, 'steering begins a separate displayed turn')
  const policy = getWorkingStepProgressPolicy(step, model.turns[0].items, model.turns[1].items[0])
  assert.equal(policy, 'stoppedSteeredFailed')
  assert.equal(
    getWorkingStepDefaultOpen(
      step.status,
      policy,
      settings,
      model.workingStepIdsWithNextWorkingStep.has(step.id)
    ),
    true
  )
  assert.equal(
    getWorkingStepDefaultOpen(
      'worked',
      policy,
      { ...settings, collapseStoppedSteeredFailedProgressOnFinish: true },
      false
    ),
    false
  )
  assert.equal(
    getWorkingStepDefaultOpen(
      'worked',
      policy,
      { ...settings, collapseStoppedSteeredFailedProgressOnNextTurn: true },
      true
    ),
    false
  )
  assert.equal(getWorkingStepProgressPolicy(nextStep, model.turns[1].items), policy)

  for (const nextTurnStartItem of [
    undefined,
    { ...steeringMessage, kind: undefined },
    { type: 'pendingMessage', id: 'queued', kind: 'queued', content: 'Next' }
  ]) {
    const regularPolicy = getWorkingStepProgressPolicy(
      step,
      model.turns[0].items,
      nextTurnStartItem
    )
    assert.equal(regularPolicy, 'regular', 'ordinary next turns retain regular collapse settings')
    assert.equal(getWorkingStepDefaultOpen('worked', regularPolicy, settings, true), false)
  }
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

test('a new turn preserves manual disclosure unless its policy collapses on the next turn', () => {
  for (const status of ['working', 'worked', 'stopped', 'failed']) {
    for (const progressPolicy of ['regular', 'stoppedSteeredFailed']) {
      const before = getWorkingStepDisclosureKey(status, progressPolicy, defaultSettings, false)
      const after = getWorkingStepDisclosureKey(status, progressPolicy, defaultSettings, true)
      assert.equal(after, before)
      assert.equal(resolveWorkingStepOpen({ key: before, open: true }, after, false), true)

      const settings = {
        ...defaultSettings,
        collapseProgressOnNextTurn: true,
        collapseStoppedSteeredFailedProgressOnNextTurn: true
      }
      assert.notEqual(
        getWorkingStepDisclosureKey(status, progressPolicy, settings, false),
        getWorkingStepDisclosureKey(status, progressPolicy, settings, true)
      )
    }
  }
})

test('all steering segments follow the final block through finish and the next ordinary turn', () => {
  const previous = { ...workingStep(), id: 'previous' }
  const middle = { ...workingStep(), id: 'middle' }
  const steer = (id) => ({
    type: 'message',
    id,
    role: 'user',
    content: 'Steer',
    kind: 'steering'
  })

  for (const status of ['working', 'worked', 'stopped', 'failed']) {
    for (const hasNextTurn of [false, true]) {
      const final = { ...workingStep(status), id: 'final' }
      const model = buildChatConversationModel([
        { type: 'message', id: 'initial', role: 'user', content: 'Start' },
        previous,
        steer('steer-1'),
        middle,
        steer('steer-2'),
        final,
        ...(hasNextTurn
          ? [
              { type: 'message', id: 'next-user', role: 'user', content: 'Next ordinary turn' },
              { ...workingStep('working'), id: 'next-working' }
            ]
          : [])
      ])
      const target = model.steeredWorkingStepDisclosureTargets.get(final.id)
      const finalPolicy =
        status === 'stopped' || status === 'failed' ? 'stoppedSteeredFailed' : 'regular'
      assert.deepEqual(target, {
        status,
        progressPolicy: finalPolicy,
        hasNextWorkingStep: hasNextTurn
      })
      assert.equal(model.steeredWorkingStepDisclosureTargets.has('next-working'), false)

      for (const expandOnStart of [false, true]) {
        for (const collapseOnFinish of [false, true]) {
          for (const collapseOnNextTurn of [false, true]) {
            const settings = {
              ...defaultSettings,
              expandProgressOnStart: expandOnStart,
              collapseProgressOnFinish: collapseOnFinish,
              collapseProgressOnNextTurn: collapseOnNextTurn,
              collapseStoppedSteeredFailedProgressOnFinish:
                finalPolicy === 'regular' ? !collapseOnFinish : collapseOnFinish,
              collapseStoppedSteeredFailedProgressOnNextTurn:
                finalPolicy === 'regular' ? !collapseOnNextTurn : collapseOnNextTurn
            }
            const expectedOpen =
              (status === 'working' ? expandOnStart : !collapseOnFinish) &&
              !(hasNextTurn && collapseOnNextTurn)
            const finalKey = getWorkingStepDisclosureKey(status, finalPolicy, settings, hasNextTurn)

            for (const step of [previous, middle, final]) {
              const stepTarget = model.steeredWorkingStepDisclosureTargets.get(step.id)
              assert.equal(stepTarget, target, 'multiple steers share the final lifecycle')
              assert.equal(
                getWorkingStepDefaultOpen(
                  stepTarget.status,
                  stepTarget.progressPolicy,
                  settings,
                  stepTarget.hasNextWorkingStep
                ),
                expectedOpen
              )
              assert.equal(
                getWorkingStepDisclosureKey(
                  stepTarget.status,
                  stepTarget.progressPolicy,
                  settings,
                  stepTarget.hasNextWorkingStep
                ),
                finalKey
              )
            }
          }
        }
      }
    }
  }
})
