import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getChatItems } from './CodexItemRenderers.ts'
import * as liveMerge from './CodexLiveMerge.ts'
import {
  getUnchangedTranscriptPrefix,
  markTranscriptRecordsChanged
} from '../transcriptProjection/recordChanges.ts'

// Exercise the actual notification and submission paths without launching a provider.
const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const methods = [
  'startSubmittedCodexTurn',
  'handleTurnNotification',
  'handleItemNotification',
  'normalizeLiveTurn',
  'normalizeLiveItem',
  'applyLiveItemStatus',
  'upsertItems',
  'getCarriedItems',
  'mergeTurn',
  'reconcileTurnItems',
  'mergeItem',
  'updateTurnItems',
  'replacePendingTurn',
  'clearPendingTurnId',
  'reconcileStartedTurn',
  'attachSubmittedUserMessages',
  'getPendingTurnIdForLiveTurn'
]
const helpers = source.statements.filter(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((entry) =>
      [
        'getThreadId',
        'getTurnId',
        'getOptionalStringValue',
        'isLocalTurnStartUserMessage',
        'getCodexUserMessageClientId',
        'isCompleteCodexUserMessage'
      ].includes(entry.name.getText(source))
    )
)
const code = ts.transpile(
  `${helpers.map((node) => node.getText(source)).join('\n')}
  class Adapter { ${declaration.members
    .filter((node) => methods.includes(node.name?.getText(source)))
    .map((node) => node.getText(source))
    .join('\n')} }; new Adapter()`,
  { target: ts.ScriptTarget.ES2022 }
)

const fixture = (globals = {}) => {
  const adapter = vm.runInNewContext(code, {
    ...liveMerge,
    getUnchangedTranscriptPrefix,
    markTranscriptRecordsChanged,
    getCodexSubagentDispatchTarget: () => null,
    isCodexSubagentThread: () => false,
    bindCodexSubmittedMessageToTurn: async () => {},
    deleteCodexSubmittedMessages: async () => {},
    getCodexSubmittedMessages: async () => [],
    ...globals
  })
  const original = {
    type: 'userMessage',
    id: 'client:user',
    clientId: 'client',
    local: true,
    content: [{ type: 'text', text: 'Fix the release' }]
  }
  Object.assign(adapter, {
    threads: new Map([
      [
        'chat',
        {
          id: 'chat',
          turns: [{ id: 'client', local: true, status: 'inProgress', items: [original] }]
        }
      ]
    ]),
    pendingTurnIds: new Map([['chat', 'client']]),
    pendingTurnStarts: new Map(),
    activeTurnIds: new Map(),
    steeringMessagesByThread: new Map(),
    rememberThreadContainer() {},
    recordSubagentRunOutcome() {},
    isRolledBackTurn: () => false,
    refreshLatestThread: () => assert.fail('submission events must not trigger a history read'),
    scheduleChatUpdated() {},
    commitThreadAction(id, action) {
      const thread = { ...this.threads.get(id), turns: action.turns }
      this.threads.set(id, thread)
      return thread
    },
    messageDelivery: { bind() {} },
    reconcileAuthoritativeTurnLifecycles: (_threadId, turns) => turns,
    emitChatUpdated() {},
    getActiveTurnId() {
      return this.activeTurnIds.get('chat') ?? null
    },
    setThreadStatus() {},
    scheduleQueueDrain() {}
  })
  const serverTurn = { id: 'server', status: 'inProgress', items: [] }
  return {
    adapter,
    serverTurn,
    echo(method, overrides = {}) {
      adapter.handleItemNotification(
        { method },
        {
          threadId: 'chat',
          turnId: 'server',
          item: { ...original, id: 'server-user', local: undefined, ...overrides }
        }
      )
    },
    assertSingleTurn() {
      const turns = adapter.threads.get('chat').turns
      assert.equal(turns.length, 1)
      const items = getChatItems(turns)
      assert.equal(
        items.filter((item) => item.type === 'message' && item.role === 'user').length,
        1
      )
      assert.equal(items.filter((item) => item.type === 'working').length, 1)
      assert.equal(items.find((item) => item.type === 'message').content, 'Fix the release')
    }
  }
}

for (const firstEcho of ['item/started', 'item/completed']) {
  test(`${firstEcho} reconciles the pending turn before the start reply`, async () => {
    const f = fixture()
    let acknowledge
    const sending = f.adapter.startSubmittedCodexTurn(
      'chat',
      'client',
      () =>
        new Promise((resolve) => {
          acknowledge = resolve
        })
    )
    f.adapter.handleTurnNotification(
      { method: 'turn/started' },
      { threadId: 'chat', turn: f.serverTurn }
    )
    f.assertSingleTurn()
    // item/started may identify the message before its content is available.
    f.echo(firstEcho, firstEcho === 'item/started' ? { content: [] } : {})
    f.assertSingleTurn()
    assert.equal(f.adapter.threads.get('chat').turns[0].id, 'server')
    assert.equal(f.adapter.pendingTurnIds.has('chat'), false)
    assert.equal(f.adapter.pendingTurnStarts.has('chat'), true, 'keep the submission lock')
    f.echo('item/completed')
    f.assertSingleTurn()

    const turn = f.adapter.threads.get('chat').turns[0]
    f.adapter.threads.set('chat', {
      id: 'chat',
      turns: [
        {
          ...turn,
          items: [
            ...turn.items,
            { type: 'agentMessage', id: 'answer', text: 'I’ll fix it.', phase: 'commentary' }
          ]
        }
      ]
    })
    acknowledge({ turn: f.serverTurn })
    await sending
    f.assertSingleTurn()
    assert.equal(f.adapter.threads.get('chat').turns[0].items.at(-1).text, 'I’ll fix it.')
    assert.equal(f.adapter.pendingTurnStarts.has('chat'), false)
  })
}

test('an unrelated client ID cannot replace the pending submission', () => {
  const f = fixture()
  f.echo('item/completed', { clientId: 'unrelated' })
  assert.equal(f.adapter.pendingTurnIds.get('chat'), 'client')
  assert.equal(f.adapter.threads.get('chat').turns[0].id, 'client')
})

test('a rolled-back user echo cannot reconcile a pending submission', () => {
  const f = fixture()
  f.adapter.isRolledBackTurn = () => true
  f.echo('item/completed')
  f.assertSingleTurn()
  assert.equal(f.adapter.pendingTurnIds.get('chat'), 'client')
  assert.equal(f.adapter.threads.get('chat').turns[0].id, 'client')
})

test('a late matching user echo reconciles a server turn that already completed', () => {
  const f = fixture()
  const pending = f.adapter.threads.get('chat').turns[0]
  f.adapter.threads.set('chat', {
    id: 'chat',
    turns: [
      pending,
      {
        id: 'server',
        status: 'completed',
        completedAt: 3,
        items: [
          { type: 'agentMessage', id: 'progress', phase: 'commentary', text: 'Checking.' },
          { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Done.' }
        ]
      }
    ]
  })
  f.echo('item/completed')
  f.assertSingleTurn()
  const turn = f.adapter.threads.get('chat').turns[0]
  assert.equal(turn.id, 'server')
  assert.equal(turn.status, 'completed')
  assert.equal(turn.local, false)
  assert.equal(f.adapter.pendingTurnIds.has('chat'), false)
  assert.equal(f.adapter.activeTurnIds.has('chat'), false)
  assert.equal(getChatItems([turn]).find((item) => item.type === 'working').status, 'worked')
})

test('a start reply binds native turn identity before its database write finishes', async () => {
  let finishBinding
  const binding = new Promise((resolve) => {
    finishBinding = resolve
  })
  const f = fixture({ bindCodexSubmittedMessageToTurn: () => binding })
  const sending = f.adapter.startSubmittedCodexTurn('chat', 'client', async () => ({
    turn: f.serverTurn
  }))
  await new Promise((resolve) => setImmediate(resolve))
  try {
    assert.equal(f.adapter.threads.get('chat').turns[0].id, 'server')
    assert.equal(f.adapter.pendingTurnIds.has('chat'), false)
    assert.equal(
      f.adapter.pendingTurnStarts.has('chat'),
      true,
      'the submission lock still protects queue delivery'
    )
  } finally {
    finishBinding()
    await sending
  }
})

test('a failed recovery database write cannot undo an accepted native turn', async () => {
  const f = fixture({
    bindCodexSubmittedMessageToTurn: async () => {
      throw new Error('SQLite unavailable')
    }
  })
  const turn = await f.adapter.startSubmittedCodexTurn('chat', 'client', async () => ({
    turn: f.serverTurn
  }))
  assert.equal(turn.id, 'server')
  assert.equal(f.adapter.threads.get('chat').turns[0].id, 'server')
  assert.equal(f.adapter.pendingTurnIds.has('chat'), false)
})

test('a history echo binds its local turn before cleanup and cannot delete an unacknowledged submission', async () => {
  const submission = {
    clientMessageId: 'client',
    turnId: null,
    input: [{ type: 'text', text: 'Fix the release' }]
  }
  let stored = [submission]
  const f = fixture({
    getCodexSubmittedMessages: async () => structuredClone(stored),
    deleteCodexSubmittedMessages: async (ids) => {
      stored = stored.filter((row) => !ids.includes(row.clientMessageId))
    },
    bindCodexSubmittedMessageToTurn: async (clientId, turnId) => {
      const row = stored.find((row) => row.clientMessageId === clientId)
      assert.ok(row, 'a history echo must not delete the row before turn/start binds it')
      row.turnId = turnId
    }
  })
  let acknowledge
  const sending = f.adapter.startSubmittedCodexTurn(
    'chat',
    'client',
    () =>
      new Promise((resolve) => {
        acknowledge = resolve
      })
  )
  const completed = {
    id: 'server',
    status: 'completed',
    items: [
      { type: 'userMessage', id: 'server-user', clientId: 'client', content: submission.input },
      { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Done.' }
    ]
  }
  const page = await f.adapter.attachSubmittedUserMessages('chat', [completed])
  const turns = f.adapter.threads.get('chat').turns
  assert.equal(turns.length, 1)
  assert.equal(turns[0].id, 'server')
  assert.equal(turns[0].status, 'completed')
  assert.equal(f.adapter.pendingTurnIds.has('chat'), false)
  assert.equal(stored.length, 1, 'the request has not yet persisted the binding')
  const projected = liveMerge.projectCodexTurnTail(
    page,
    turns,
    10,
    new Set(),
    (_previous, next) => next
  )
  assert.deepEqual(
    Array.from(projected, (turn) => turn.id),
    ['server']
  )
  acknowledge({ turn: f.serverTurn })
  await sending
  assert.equal(stored[0].turnId, 'server')
  await f.adapter.attachSubmittedUserMessages('chat', [completed])
  assert.equal(stored.length, 0, 'acknowledged echoes can retire the recovery row')
  assert.equal(f.adapter.threads.get('chat').turns.length, 1)
})

test('an accepted turn survives a lost start reply even after completion', async () => {
  const deleted = []
  const f = fixture({ deleteCodexSubmittedMessages: async (ids) => deleted.push(...ids) })
  let rejectStart
  const sending = f.adapter.startSubmittedCodexTurn(
    'chat',
    'client',
    () =>
      new Promise((_resolve, reject) => {
        rejectStart = reject
      })
  )
  f.echo('item/completed')
  const accepted = f.adapter.threads.get('chat').turns[0]
  f.adapter.threads.set('chat', {
    id: 'chat',
    turns: [
      {
        ...accepted,
        status: 'completed',
        items: [
          ...accepted.items,
          { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Done.' }
        ]
      }
    ]
  })
  f.adapter.activeTurnIds.clear()
  rejectStart(new Error('Connection closed before the reply'))
  const turn = await sending
  assert.equal(turn.id, 'server')
  assert.equal(turn.status, 'completed')
  assert.deepEqual(deleted, [], 'accepted work must not be discarded or retried')
  assert.equal(f.adapter.threads.get('chat').turns.length, 1)
  assert.equal(f.adapter.pendingTurnIds.has('chat'), false)
})

test('a rejected start without a matching native echo still fails and cleans up', async () => {
  const deleted = []
  const f = fixture({ deleteCodexSubmittedMessages: async (ids) => deleted.push(...ids) })
  const error = new Error('Native request rejected')
  await assert.rejects(
    f.adapter.startSubmittedCodexTurn('chat', 'client', async () => {
      throw error
    }),
    (value) => value === error
  )
  assert.deepEqual(deleted, ['client'])
  assert.equal(f.adapter.pendingTurnStarts.has('chat'), false)
})

test('a persisted binding repairs an orphan even when history omits the original user echo', async () => {
  const f = fixture({
    getCodexSubmittedMessages: async () => [
      {
        clientMessageId: 'client',
        turnId: 'server',
        input: [{ type: 'text', text: 'Fix the release' }]
      }
    ]
  })
  f.adapter.pendingTurnIds.clear()
  const completed = {
    id: 'server',
    status: 'completed',
    items: [{ type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Done.' }]
  }
  const page = await f.adapter.attachSubmittedUserMessages('chat', [completed])
  const turns = f.adapter.threads.get('chat').turns
  assert.deepEqual(
    Array.from(turns, (turn) => turn.id),
    ['server']
  )
  assert.equal(turns[0].status, 'completed')
  assert.equal(turns[0].items[0].content[0].text, 'Fix the release')
  assert.equal(page[0].items[0].clientId, 'client')
})

test('history can clean up a recovered echo when no start acknowledgment is in flight', async () => {
  const deleted = []
  const f = fixture({
    getCodexSubmittedMessages: async () => [{ clientMessageId: 'client', turnId: null }],
    deleteCodexSubmittedMessages: async (ids) => deleted.push(...ids)
  })
  await f.adapter.attachSubmittedUserMessages('chat', [
    {
      id: 'server',
      status: 'completed',
      items: [
        {
          type: 'userMessage',
          id: 'native-user',
          clientId: 'client',
          content: [{ type: 'text', text: 'Fix the release' }]
        }
      ]
    }
  ])
  assert.deepEqual(deleted, ['client'])
  assert.equal(f.adapter.threads.get('chat').turns[0].id, 'server')
})
