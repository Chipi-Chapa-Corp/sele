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

const fixture = () => {
  const adapter = vm.runInNewContext(code, {
    ...liveMerge,
    getUnchangedTranscriptPrefix,
    markTranscriptRecordsChanged,
    getCodexSubagentDispatchTarget: () => null,
    isCodexSubagentThread: () => false,
    bindCodexSubmittedMessageToTurn: async () => {},
    deleteCodexSubmittedMessages: async () => {}
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
