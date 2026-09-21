import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anchorCodexCommandsByStart,
  CodexCommandStartAnchors,
  readCodexItemStartTimes
} from './CodexCommandStartAnchors.ts'

const command = (id, status = 'completed') => ({
  id,
  type: 'commandExecution',
  command: 'host-spawn nmcli',
  status
})
const message = (id) => ({ id, type: 'agentMessage', phase: 'final_answer', text: id })
const event = (id, start, finish) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      turn_id: 'turn',
      item: { id },
      started_at_ms: start,
      completed_at_ms: finish
    }
  })
const transcript = [
  event('slow', 100, 1500),
  event('check', 200, 210),
  event('answer', 220, 230)
].join('\n')
const turn = {
  id: 'turn',
  status: 'completed',
  items: [command('check'), message('answer'), command('slow', 'failed')]
}

test('VPN late completion is anchored by start before the checks and final response', () => {
  const result = anchorCodexCommandsByStart(turn, readCodexItemStartTimes(transcript).get('turn'))
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['slow', 'check', 'answer']
  )
  assert.equal(result.items[0], turn.items[2], 'retain final status/output from the API')
  assert.deepEqual(
    turn.items.map((item) => item.id),
    ['check', 'answer', 'slow'],
    'do not mutate backend snapshots'
  )
})

test('actual post-answer work stays after the answer; missing timing never guesses an order', () => {
  assert.equal(
    anchorCodexCommandsByStart(
      turn,
      new Map([
        ['slow', 300],
        ['answer', 220]
      ])
    ),
    turn
  )
  assert.equal(anchorCodexCommandsByStart(turn, new Map()), turn)
  const steered = {
    ...turn,
    items: [message('answer'), { type: 'userMessage', id: 'steer' }, command('slow')]
  }
  assert.equal(
    anchorCodexCommandsByStart(
      steered,
      new Map([
        ['answer', 220],
        ['slow', 100]
      ])
    ),
    steered
  )
})

test('optional metadata is read once for the same snapshot and does not touch ordinary turns', async () => {
  const store = new CodexCommandStartAnchors()
  let reads = 0
  const read = async () => {
    reads++
    return transcript
  }
  const thread = { id: 'chat', path: '/rollout', turns: [turn] }
  assert.equal(await store.load(thread, read), true)
  assert.deepEqual(
    store.project(turn).items.map((item) => item.id),
    ['slow', 'check', 'answer']
  )
  assert.equal(await store.load(thread, read), false)
  assert.equal(reads, 1)
  const ordinary = { ...turn, items: [command('check'), message('answer')] }
  await store.load({ ...thread, turns: [ordinary] }, read)
  assert.equal(reads, 1)
  assert.equal(store.project(ordinary), ordinary)
})

test('missing rollout leaves usable history untouched', async () => {
  const store = new CodexCommandStartAnchors()
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })
  assert.equal(
    await store.load({ id: 'chat', path: '/missing', turns: [turn] }, async () => {
      throw missing
    }),
    false
  )
  assert.equal(store.project(turn), turn)
})

test('live completion updates the original command slot after the final response arrives', async () => {
  const { readFileSync } = await import('node:fs')
  const { default: vm } = await import('node:vm')
  const { default: ts } = await import('typescript')
  const source = ts.createSourceFile(
    'adapter.ts',
    readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
  )
  const method = declaration.members.find((node) => node.name?.getText(source) === 'upsertItems')
  const adapter = vm.runInNewContext(
    ts.transpile(`class Adapter { ${method.getText(source)} }; new Adapter()`, {
      target: ts.ScriptTarget.ES2022
    })
  )
  let items = [command('slow', 'running'), message('answer')]
  Object.assign(adapter, {
    updateTurnItems: (_thread, _turn, update) => {
      items = update(items)
    },
    reconcileTurnItems: (items) => items,
    getCarriedItems: (_thread, _turn, previous) => [...previous],
    mergeItem: (previous, next) => ({ ...previous, ...next })
  })
  adapter.upsertItems('chat', 'turn', [
    { ...command('slow', 'failed'), aggregatedOutput: 'Timed out' }
  ])
  assert.deepEqual(
    Array.from(items, (item) => item.id),
    ['slow', 'answer']
  )
  assert.equal(items[0].status, 'failed')
  assert.equal(items[0].aggregatedOutput, 'Timed out')
})
