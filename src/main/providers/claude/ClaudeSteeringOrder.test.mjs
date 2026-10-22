import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Run the adapter's real steering methods; Claude Code itself is replaced by its input queue.
const source = ts.createSourceFile(
  'ClaudeProviderAdapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'ClaudeProviderAdapter'
)
const members = ['pushSteering', 'releaseDeferredSteering']
  .map((name) => declaration.members.find((node) => node.name?.getText(source) === name))
  .map((node) => node.getText(source))
  .join('\n')
const createAdapter = () =>
  vm.runInNewContext(
    ts.transpile(`class Adapter { ${members} }; new Adapter()`, { target: ts.ScriptTarget.ES2022 })
  )
const createState = () => {
  const pushed = []
  return {
    pushed,
    turnAwaitingStart: false,
    deferredSteering: [],
    input: { push: (m) => pushed.push(m) }
  }
}

test('steering sent before Claude starts the turn waits behind the turn prompt', () => {
  const adapter = createAdapter()
  const state = createState()
  state.input.push({ uuid: 'prompt' })
  state.turnAwaitingStart = true
  adapter.pushSteering(state, { uuid: 'steer', priority: 'now' })
  assert.deepEqual(
    state.pushed.map((message) => message.uuid),
    ['prompt']
  )

  // The first streamed event of the turn releases it as steering.
  assert.equal(adapter.releaseDeferredSteering(state, true), 0)
  assert.deepEqual(
    state.pushed.map((message) => [message.uuid, message.priority]),
    [
      ['prompt', undefined],
      ['steer', 'now']
    ]
  )
  assert.equal(state.turnAwaitingStart, false)

  // Once the turn runs, steering goes straight to Claude Code.
  adapter.pushSteering(state, { uuid: 'second', priority: 'now' })
  assert.equal(state.pushed.at(-1).uuid, 'second')
})

test('steering for a turn that never started becomes the next prompt', () => {
  const adapter = createAdapter()
  const state = createState()
  state.turnAwaitingStart = true
  adapter.pushSteering(state, { uuid: 'steer', priority: 'now' })
  assert.equal(adapter.releaseDeferredSteering(state, false), 1)
  assert.deepEqual(
    state.pushed.map((message) => [message.uuid, message.priority]),
    [['steer', 'next']]
  )
  assert.equal(state.turnAwaitingStart, true, 'the follow-up prompt has not started either')
})
