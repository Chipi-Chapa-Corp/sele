import assert from 'node:assert/strict'
import test from 'node:test'
import { readCopilotGoalState } from './CopilotGoals.ts'

const fixture = (events) => {
  let reads = 0
  const session = {
    rpc: {
      eventLog: {
        read: async (options) => {
          assert.deepEqual(options.types, ['session.autopilot_objective_changed'])
          assert.equal(options.max, 1)
          assert.equal(options.includeEphemeral, false)
          return { cursorStatus: 'ok', events }
        }
      },
      autopilotObjective: {
        getState: async () => {
          reads++
          return { state: { objective: 'Native goal', status: 'paused' } }
        }
      }
    }
  }
  return { session, reads: () => reads }
}

test('never initializes Copilot autopilot for an ordinary conversation or deleted goal', async () => {
  for (const events of [
    [],
    [{ type: 'session.autopilot_objective_changed', data: { operation: 'delete' } }]
  ]) {
    const f = fixture(events)
    assert.deepEqual(await readCopilotGoalState(f.session), { state: null })
    assert.equal(f.reads(), 0, 'an absent-objective read can strand ordinary runtime messages')
  }
})

test('existing native goals retain canonical active, paused, and completed state reads', async () => {
  for (const operation of ['create', 'update']) {
    const f = fixture([{ type: 'session.autopilot_objective_changed', data: { operation } }])
    assert.equal((await readCopilotGoalState(f.session)).state.objective, 'Native goal')
    assert.equal(f.reads(), 1)
  }
})

test('a failed goal journal read does not fabricate empty goal state', async () => {
  const f = fixture([])
  f.session.rpc.eventLog.read = async () => ({ cursorStatus: 'expired', events: [] })
  await assert.rejects(readCopilotGoalState(f.session), /cursor expired/)
  assert.equal(f.reads(), 0)
})
