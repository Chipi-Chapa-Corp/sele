import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Execute the actual adapter method with only transport and state dependencies isolated.
const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const method = declaration.members.find((node) => node.name?.getText(source) === 'steerActiveChat')
const code = ts.transpile(`class Adapter { ${method.getText(source)} }; new Adapter()`, {
  target: ts.ScriptTarget.ES2022
})

test('steering reaches an active turn even after a completed final-tagged message', async () => {
  const adapter = vm.runInNewContext(code)
  const processed = []
  Object.assign(adapter, {
    ensureChatTailLoaded: async () => {},
    getActiveTurnId: () => 'turn',
    threads: new Map([
      [
        'chat',
        {
          turns: [
            {
              id: 'turn',
              items: [{ type: 'agentMessage', phase: 'final_answer', status: 'completed' }]
            }
          ]
        }
      ]
    ]),
    hasPendingSteeringMessage: () => false,
    addWaitingSteeringMessage: (chat, turn, text) => ({ id: 'steer', text }),
    emitChatUpdated: () => {},
    processWaitingSteeringMessage: async (...args) => {
      processed.push(args)
    },
    getCachedChatDetail: () => ({ id: 'chat' }),
    queueChatMessage: () => assert.fail('active steering must not silently requeue')
  })
  await adapter.steerActiveChat('chat', 'The audit is done')
  assert.deepEqual(processed, [['chat', 'steer']])
})

const createAdapter = (methodNames, globals = {}) => {
  const methods = declaration.members.filter((node) =>
    methodNames.includes(node.name?.getText(source))
  )
  return vm.runInNewContext(
    ts.transpile(
      `class Adapter { ${methods.map((method) => method.getText(source)).join('\n')} }; new Adapter()`,
      {
        target: ts.ScriptTarget.ES2022
      }
    ),
    globals
  )
}

test('steering waits for delivery and reports transport failure to the caller', async () => {
  const failure = new Error('Connection lost')
  let rejectDelivery
  const delivery = new Promise((resolve, reject) => {
    rejectDelivery = reject
  })
  let removed = false
  const adapter = createAdapter(['steerActiveChat'], { console: { error() {} } })
  Object.assign(adapter, {
    ensureChatTailLoaded: async () => {},
    getActiveTurnId: () => 'turn',
    hasPendingSteeringMessage: () => false,
    addWaitingSteeringMessage: () => ({ id: 'steer' }),
    emitChatUpdated() {},
    processWaitingSteeringMessage: () => delivery,
    removeSteeringMessage: () => {
      removed = true
      return true
    },
    getCachedChatDetail: () => ({ id: 'chat' })
  })
  let settled = false
  const send = adapter.steerActiveChat('chat', 'Change direction')
  void send.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  rejectDelivery(failure)
  await assert.rejects(send, (error) => error === failure)
  assert.equal(removed, true)
})

for (const successor of [null, 'next-turn']) {
  test(`a late steering acknowledgment cannot resurrect a completed turn (successor: ${successor})`, async () => {
    let acknowledge
    const response = new Promise((resolve) => {
      acknowledge = resolve
    })
    const message = {
      id: 'steer',
      itemId: 'client-id',
      turnId: 'turn',
      text: 'Change direction',
      status: 'waiting'
    }
    const turn = { id: 'turn', status: 'inProgress' }
    const adapter = createAdapter(['processWaitingSteeringMessage', 'getActiveTurnId'], {
      createUserInput: (text) => [{ type: 'text', text }],
      getSteerResponseTurnId: (response) => response.turnId,
      isCodexTurnTerminal: (turn) => turn.status === 'completed'
    })
    Object.assign(adapter, {
      threads: new Map([['chat', { turns: [turn] }]]),
      activeTurnIds: new Map([['chat', 'turn']]),
      getSteeringMessage: () => message,
      markWaitingSteeringMessagePending: () => ({ ...message, status: 'pending' }),
      client: { request: () => response }
    })
    const send = adapter.processWaitingSteeringMessage('chat', 'steer')
    turn.status = 'completed'
    adapter.activeTurnIds.delete('chat')
    if (successor) adapter.activeTurnIds.set('chat', successor)
    acknowledge({ turnId: 'turn' })
    await send
    assert.equal(adapter.getActiveTurnId('chat'), successor)
  })
}
