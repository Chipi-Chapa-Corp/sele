import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexGoals } from './CodexGoals.ts'

const goal = (status = 'active', objective = 'Build the requested feature') => ({
  threadId: 'chat',
  objective,
  status,
  tokenBudget: 1000,
  tokensUsed: 42,
  timeUsedSeconds: 3,
  createdAt: 1,
  updatedAt: 2
})
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('loads goal state directly without reading transcript history', async () => {
  const goals = new CodexGoals()
  await goals.read('chat', async (method, params) => {
    assert.equal(method, 'thread/goal/get')
    assert.deepEqual(params, { threadId: 'chat' })
    return { goal: goal() }
  })
  assert.equal(goals.get('chat').status, 'active')
  for (const status of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']) {
    goals.update('chat', goal(status))
    assert.equal(goals.get('chat').status, status)
  }
  goals.update('chat', null)
  assert.equal(goals.get('chat'), null)
})

test('saving edits only the objective and blank objectives clear the goal', async () => {
  const goals = new CodexGoals()
  goals.update('chat', goal())
  const updated = await goals.save('chat', '  Revised objective  ', async (method, params) => {
    assert.equal(method, 'thread/goal/set')
    assert.deepEqual(params, { threadId: 'chat', objective: 'Revised objective' })
    return { goal: goal('active', params.objective) }
  })
  assert.equal(updated.objective, 'Revised objective')
  assert.equal(updated.tokenBudget, 1000)
  for (const value of [null, '', '   ']) {
    goals.update('chat', goal())
    assert.equal(
      await goals.save('chat', value, async (method, params) => {
        assert.equal(method, 'thread/goal/clear')
        assert.deepEqual(params, { threadId: 'chat' })
        return {}
      }),
      null
    )
  }
})

test('late reads and mutation responses cannot resurrect a completed or cleared goal', async () => {
  const goals = new CodexGoals()
  const read = deferred()
  const loading = goals.read('chat', () => read.promise)
  goals.update('chat', goal('complete'))
  read.resolve({ goal: goal() })
  await loading
  assert.equal(goals.get('chat').status, 'complete')
  const save = deferred()
  const saving = goals.save('chat', 'Edit', () => save.promise)
  goals.update('chat', null)
  save.resolve({ goal: goal('active', 'Edit') })
  await saving
  assert.equal(goals.get('chat'), null)
})

test('reads racing with a save cannot overwrite the updated objective', async () => {
  const goals = new CodexGoals()
  goals.update('chat', goal())
  const read = deferred()
  const loading = goals.read('chat', () => read.promise)
  const mutation = deferred()
  const saving = goals.save('chat', 'Edited', () => mutation.promise)
  await goals.read('chat', () => assert.fail('Do not read stale state during a mutation'))
  read.resolve({ goal: goal() })
  await loading
  mutation.resolve({ goal: goal('active', 'Edited') })
  await saving
  assert.equal(goals.get('chat').objective, 'Edited')
})

test('unsupported goal reads do not break chat loading and failed mutations preserve state', async () => {
  const goals = new CodexGoals()
  await goals.read('chat', async () => {
    throw new Error('Unknown method')
  })
  assert.equal(goals.get('chat'), null)
  goals.update('chat', goal())
  await assert.rejects(
    goals.save('chat', null, async () => {
      throw new Error('Offline')
    }),
    /Offline/
  )
  assert.equal(goals.get('chat').status, 'active')
})
