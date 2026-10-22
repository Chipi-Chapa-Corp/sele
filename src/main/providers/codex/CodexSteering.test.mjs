import { PendingMessageEdits } from '../PendingMessageEdits.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { CodexMessageDelivery } from './CodexMessageDelivery.ts'
import {
  mergeCodexSnapshotsById,
  mergeCodexStreamedText,
  mergeCodexTurnStatus
} from './CodexLiveMerge.ts'

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
const code = ts.transpile(
  `class Adapter { pendingMessageEdits = new PendingMessageEdits(); ${method.getText(source)} }; new Adapter()`,
  {
    target: ts.ScriptTarget.ES2022
  }
)

test('steering reaches an active turn even after a completed final-tagged message', async () => {
  const adapter = vm.runInNewContext(code, { PendingMessageEdits })
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
  const helpers = source.statements.filter(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((entry) =>
        [
          'getOptionalStringValue',
          'getThreadId',
          'getTurnId',
          'isLocalTurnStartUserMessage',
          'getCodexUserMessageClientId',
          'isCompleteCodexUserMessage'
        ].includes(entry.name.getText(source))
      )
  )
  return vm.runInNewContext(
    ts.transpile(
      `${helpers.map((node) => node.getText(source)).join('\n')}
      class Adapter { pendingMessageEdits = new PendingMessageEdits(); ${methods.map((method) => method.getText(source)).join('\n')} }; new Adapter()`,
      {
        target: ts.ScriptTarget.ES2022
      }
    ),
    { PendingMessageEdits, ...globals }
  )
}

const userMessage = (id, clientId = id) => ({
  type: 'userMessage',
  id,
  clientId,
  content: [{ type: 'text', text: id }]
})

const reconciliationFixture = () => {
  const original = { ...userMessage('local-original', 'original-client'), local: true }
  let turn = { id: 'turn', status: 'inProgress', items: [original] }
  const adapter = createAdapter(
    [
      'getCarriedItems',
      'updateSteeringMessages',
      'reconcileTurnItems',
      'mergeItem',
      'mergeTurn',
      'upsertItems',
      'handleItemNotification',
      'normalizeLiveItem',
      'applyLiveItemStatus'
    ],
    {
      mergeCodexSnapshotsById,
      mergeCodexStreamedText,
      mergeCodexTurnStatus,
      getCodexSubagentDispatchTarget: () => null
    }
  )
  Object.assign(adapter, {
    steeringMessagesByThread: new Map([
      ['chat', [{ id: 'steer', itemId: 'steer-client', turnId: 'turn', status: 'pending' }]]
    ]),
    updateTurnItems: (_threadId, _turnId, update) => {
      turn = { ...turn, items: update(turn.items) }
    },
    scheduleChatUpdated() {}
  })
  return {
    adapter,
    original,
    get turn() {
      return turn
    },
    receive(method, items) {
      if (method === 'turn snapshot') {
        turn = adapter.mergeTurn('chat', turn, { ...turn, items })
      } else {
        for (const item of items) {
          adapter.handleItemNotification({ method }, { threadId: 'chat', turnId: 'turn', item })
        }
      }
    }
  }
}

for (const method of ['item/started', 'item/completed', 'turn snapshot']) {
  test(`${method}: steering before the original echo preserves both message identities`, () => {
    const f = reconciliationFixture()
    const steering = userMessage('server-steer', 'steer-client')
    f.receive(method, [steering])
    assert.deepEqual(
      Array.from(f.turn.items, (item) => item.id),
      ['local-original', 'server-steer']
    )
    assert.equal(f.turn.items[0], f.original)
    assert.equal(f.adapter.steeringMessagesByThread.get('chat')[0].status, 'sent')
    assert.equal(f.adapter.steeringMessagesByThread.get('chat')[0].itemId, 'server-steer')

    // Repeated partial updates must not duplicate either message or require the original echo.
    f.receive(method, [steering])
    assert.equal(f.turn.items.length, 2)
    f.receive(method, [userMessage('server-original', 'original-client')])
    assert.deepEqual(
      Array.from(f.turn.items, (item) => item.id),
      ['server-original', 'server-steer']
    )
    assert.equal(
      f.turn.items.some((item) => item.local),
      false
    )
  })
}

for (const clientId of ['unrelated-client', undefined, null, '']) {
  test(`an unmatched user message (${String(clientId)}) cannot discard the local submission`, () => {
    const f = reconciliationFixture()
    const unrelated = { ...userMessage('other'), clientId }
    f.receive('item/completed', [unrelated])
    assert.equal(f.turn.items[0], f.original)
    assert.equal(f.turn.items[1].id, 'other')
    assert.equal(f.adapter.steeringMessagesByThread.get('chat')[0].status, 'pending')
  })
}

test('an incomplete original echo waits for content while steering is reconciled independently', () => {
  const f = reconciliationFixture()
  f.receive('turn snapshot', [
    { ...userMessage('server-original', 'original-client'), content: [] },
    userMessage('server-steer', 'steer-client')
  ])
  assert.equal(f.turn.items[0], f.original)
  f.receive('item/completed', [userMessage('server-original', 'original-client')])
  assert.deepEqual(
    Array.from(f.turn.items, (item) => item.id),
    ['server-original', 'server-steer']
  )
})

test('a late complete echo replaces an already streamed empty item without restoring its stale status', () => {
  const f = reconciliationFixture()
  f.receive('item/started', [
    { ...userMessage('server-original', 'original-client'), content: [], startedAtMs: 1234 }
  ])
  const startedAtMs = f.turn.items[1].startedAtMs
  f.receive('item/completed', [userMessage('server-steer', 'steer-client')])
  f.receive('item/completed', [userMessage('server-original', 'original-client')])
  assert.deepEqual(
    Array.from(f.turn.items, (item) => item.id),
    ['server-original', 'server-steer']
  )
  assert.equal(f.turn.items[0].status, 'finished')
  assert.equal(f.turn.items[0].startedAtMs, startedAtMs)
})

test('a full snapshot replaces only the matching original and acknowledges only matching steering', () => {
  const f = reconciliationFixture()
  f.adapter.steeringMessagesByThread.set('other-chat', [
    { id: 'other', itemId: 'other-client', turnId: 'turn', status: 'pending' }
  ])
  f.adapter.steeringMessagesByThread.get('chat').push({
    id: 'other-turn',
    itemId: 'other-turn-client',
    turnId: 'other-turn',
    status: 'pending'
  })
  f.receive('turn snapshot', [
    userMessage('server-original', 'original-client'),
    userMessage('server-steer', 'steer-client'),
    userMessage('other', 'other-client'),
    userMessage('other-turn', 'other-turn-client')
  ])
  assert.deepEqual(
    Array.from(f.turn.items, (item) => item.id),
    ['server-original', 'server-steer', 'other', 'other-turn']
  )
  assert.equal(f.adapter.steeringMessagesByThread.get('chat')[0].status, 'sent')
  assert.equal(f.adapter.steeringMessagesByThread.get('chat')[1].status, 'pending')
  assert.equal(f.adapter.steeringMessagesByThread.get('other-chat')[0].status, 'pending')
})

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
    const adapter = createAdapter(
      ['processWaitingSteeringMessage', 'deliverWaitingSteeringMessage', 'getActiveTurnId'],
      {
        createUserInput: (text) => [{ type: 'text', text }],
        getSteerResponseTurnId: (response) => response.turnId,
        isCodexTurnTerminal: (turn) => turn.status === 'completed'
      }
    )
    Object.assign(adapter, {
      messageDelivery: new CodexMessageDelivery(),
      threads: new Map([['chat', { turns: [turn] }]]),
      activeTurnIds: new Map([['chat', 'turn']]),
      getSteeringMessage: () => message,
      markWaitingSteeringMessagePending: () => ({ ...message, status: 'pending' }),
      client: { request: () => response }
    })
    const send = adapter.processWaitingSteeringMessage('chat', 'steer')
    await Promise.resolve()
    turn.status = 'completed'
    adapter.activeTurnIds.delete('chat')
    if (successor) adapter.activeTurnIds.set('chat', successor)
    acknowledge({ turnId: 'turn' })
    await send
    assert.equal(adapter.getActiveTurnId('chat'), successor)
  })
}

test('steering accepted by Codex is no longer offered for editing', () => {
  const pendingMethod = declaration.members.find(
    (node) => node.name?.getText(source) === 'getProviderPendingMessages'
  )
  const adapter = vm.runInNewContext(
    ts.transpile(`class Adapter { ${pendingMethod.getText(source)} }; new Adapter()`, {
      target: ts.ScriptTarget.ES2022
    }),
    { collectUserInputAttachments: () => [], getMessageAttachments: () => [] }
  )
  Object.assign(adapter, {
    queuedTurnsByThread: new Map([['chat', [{ id: 'queued', text: 'later', createdAt: 3 }]]]),
    steeringMessagesByThread: new Map([
      [
        'chat',
        [
          { id: 'local', text: 'still local', status: 'waiting', createdAt: 1 },
          { id: 'accepted', text: 'handed to Codex', status: 'pending', createdAt: 2 },
          { id: 'done', text: 'consumed', status: 'sent', createdAt: 0 }
        ]
      ]
    ]),
    hiddenPendingMessageIdsByThread: new Map()
  })
  // The adapter runs in another realm; compare plain data.
  const pending = JSON.parse(JSON.stringify(adapter.getProviderPendingMessages('chat')))
  assert.deepEqual(
    pending.map((message) => [message.id, message.editable !== false]),
    [
      ['local', true],
      ['accepted', false],
      ['queued', true]
    ]
  )
})
