import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { CodexMessageDelivery } from './CodexMessageDelivery.ts'
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
  'editPendingMessageInContext',
  'editQueuedTurn',
  'editSteeringMessage',
  'updateSteeringMessages',
  'processWaitingSteeringMessage',
  'deliverWaitingSteeringMessage',
  'getSteeringMessage',
  'markWaitingSteeringMessagePending',
  'runQueuedTurn',
  'deliverQueuedTurn',
  'reconcileStartedTurn'
]
const createAdapter = () => {
  const adapter = vm.runInNewContext(
    ts.transpile(
      `class Adapter { ${declaration.members
        .filter((node) => methods.includes(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')} }; new Adapter()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    {
      hasAttachmentInput: (options) => Boolean(options?.images?.length || options?.files?.length),
      createUserInput: (text, images) => ({ text, images }),
      getSteerResponseTurnId: (response) => response.turnId,
      isCodexTurnTerminal: (turn) => turn.status === 'completed',
      console: { error() {}, warn() {} }
    }
  )
  Object.assign(adapter, {
    messageDelivery: new CodexMessageDelivery(),
    queuedTurnsByThread: new Map(),
    steeringMessagesByThread: new Map(),
    activeTurnIds: new Map(),
    pendingTurnIds: new Map(),
    threads: new Map([['chat', { turns: [{ id: 'server-turn', status: 'inProgress' }] }]]),
    rememberThreadContainer() {},
    ensureChatTailLoaded: async () => {},
    emitChatUpdated() {},
    getCachedChatDetail: () => ({ id: 'chat' }),
    hasActiveOrSubmittingTurn: () => false,
    getActiveTurnId: () => 'server-turn',
    setThreadStatus() {},
    clearPendingTurnId() {},
    replacePendingTurn: (_chat, _pending, turn) => turn
  })
  return adapter
}
const image = { path: '/screenshot.png' }
const queue = (adapter) => {
  const pending = { id: 'queued', text: '', options: { images: [image] } }
  adapter.queuedTurnsByThread.set('chat', [pending])
  return pending
}
const steering = (adapter) => {
  const pending = {
    id: 'steer',
    itemId: 'client-item',
    turnId: 'server-turn',
    status: 'waiting',
    text: 'old description',
    options: { images: [image] }
  }
  adapter.steeringMessagesByThread.set('chat', [pending])
  return pending
}

test('queued edits preserve, replace, and explicitly remove images', async () => {
  const adapter = createAdapter()
  queue(adapter)
  await adapter.editPendingMessageInContext('chat', 'queued', 'caption', { model: 'test' })
  assert.equal(adapter.queuedTurnsByThread.get('chat')[0].options.images[0], image)
  await adapter.editPendingMessageInContext('chat', 'queued', '', {
    images: [{ path: '/replacement.png' }],
    files: []
  })
  assert.equal(
    adapter.queuedTurnsByThread.get('chat')[0].options.images[0].path,
    '/replacement.png'
  )
  await adapter.editPendingMessageInContext('chat', 'queued', 'caption', { images: [], files: [] })
  assert.equal(adapter.queuedTurnsByThread.get('chat')[0].options.images.length, 0)
})

test('waiting steering edits can replace images before submission', async () => {
  const adapter = createAdapter()
  steering(adapter)
  await adapter.editPendingMessageInContext('chat', 'steer', '', {
    images: [{ path: '/new.png' }],
    files: []
  })
  assert.equal(adapter.getSteeringMessage('chat', 'steer').options.images[0].path, '/new.png')
})

test('queued edit waits through removal and submission, then targets the server turn', async () => {
  const adapter = createAdapter()
  const pending = queue(adapter)
  let finishPersistence
  let acknowledge
  const edits = []
  adapter.addSubmittedPendingTurn = () =>
    new Promise((resolve) => {
      finishPersistence = resolve
    })
  adapter.startCodexTurn = () =>
    new Promise((resolve) => {
      acknowledge = () => {
        adapter.reconcileStartedTurn('chat', 'queued', { id: 'server-turn', status: 'inProgress' })
        resolve()
      }
    })
  adapter.editMessageInContext = async (...args) => {
    edits.push(args)
    return { id: 'chat' }
  }
  const sending = adapter.runQueuedTurn('chat', pending)
  await Promise.resolve()
  assert.equal(adapter.queuedTurnsByThread.has('chat'), false)
  const editing = adapter.editPendingMessageInContext('chat', 'queued', 'new caption', {
    images: [image],
    files: []
  })
  await Promise.resolve()
  assert.equal(edits.length, 0)
  finishPersistence({ id: 'queued' })
  await Promise.resolve()
  await Promise.resolve()
  acknowledge()
  await sending
  await editing
  assert.equal(edits[0][1], 'server-turn')
  assert.equal(edits[0][2], 'new caption')
  assert.equal(edits[0][3].images[0], image)
  // A session opened before delivery must still work after acknowledgment.
  await adapter.editPendingMessageInContext('chat', 'queued', 'later caption', { images: [] })
  assert.equal(edits[1][1], 'server-turn')
})

test('in-flight steering edits revise the delivered message rather than only changing local state', async () => {
  const adapter = createAdapter()
  steering(adapter)
  let acknowledge
  let request
  const edits = []
  adapter.client = {
    request: (_method, params) => {
      request = params
      return new Promise((resolve) => {
        acknowledge = resolve
      })
    }
  }
  adapter.editMessageInContext = async (...args) => {
    edits.push(args)
    return { id: 'chat' }
  }
  const sending = adapter.processWaitingSteeringMessage('chat', 'steer')
  await Promise.resolve()
  const editing = adapter.editPendingMessageInContext('chat', 'steer', 'new caption', {
    images: []
  })
  await Promise.resolve()
  assert.equal(edits.length, 0)
  assert.equal(adapter.getSteeringMessage('chat', 'steer').text, 'old description')
  assert.equal(request.input.text, 'old description')
  acknowledge({ turnId: 'server-turn' })
  await sending
  await editing
  assert.equal(edits[0][1], 'server-turn')
  assert.equal(edits[0][2], 'new caption')
  assert.equal(edits[0][4], 'client-item')
})

test('steering fallback preserves the pending message identity when its turn ends', async () => {
  const adapter = createAdapter()
  steering(adapter)
  adapter.getActiveTurnId = () => null
  adapter.removeSteeringMessage = () => true
  adapter.continueChatImmediately = async (_chat, _text, _options, clientId) => {
    assert.equal(clientId, 'steer')
    adapter.reconcileStartedTurn('chat', clientId, { id: 'next-turn', status: 'inProgress' })
  }
  const edits = []
  adapter.editMessageInContext = async (...args) => {
    edits.push(args)
  }
  await adapter.processWaitingSteeringMessage('chat', 'steer')
  await adapter.editPendingMessageInContext('chat', 'steer', 'revised', { images: [] })
  assert.equal(edits[0][1], 'next-turn')
  assert.equal(edits[0][4], undefined)
})

test('delivery failures are retryable and rollback removes obsolete edit targets', async () => {
  const delivery = new CodexMessageDelivery()
  let attempts = 0
  await assert.rejects(
    delivery.run('chat', 'id', async () => {
      attempts++
      throw new Error('offline')
    }),
    /offline/
  )
  await delivery.run('chat', 'id', async () => {
    attempts++
    delivery.bind('chat', 'id', { turnId: 'turn' })
  })
  assert.equal(attempts, 2)
  assert.equal((await delivery.wait('chat', 'id')).turnId, 'turn')
  delivery.removeTurns('chat', new Set(['turn']))
  assert.equal(delivery.wait('chat', 'id'), null)
  await delivery.run('chat', 'id', async () => {})
  assert.equal(delivery.wait('chat', 'id'), null)
})

const createHistoryAdapter = (loadedTurn, authoritativeTurn = loadedTurn) => {
  const requests = []
  const steering = []
  const hydrated = []
  const catalog = [{ id: loadedTurn.id, status: 'completed', items: [] }]
  const thread = { id: 'chat', historyMode: 'paginated', turns: [loadedTurn] }
  const declarations = source.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((entry) =>
          ['createUserInput', 'createUserTextInput'].includes(entry.name.getText(source))
        )
    )
    .map((node) => node.getText(source))
    .join('\n')
  const method = declaration.members.find(
    (node) => node.name?.getText(source) === 'editMessageInContext'
  )
  const adapter = vm.runInNewContext(
    ts.transpile(`${declarations}; class Adapter { ${method.getText(source)} }; new Adapter()`, {
      target: ts.ScriptTarget.ES2022
    }),
    {
      hasAttachmentInput: (options) => Boolean(options?.images?.length),
      getCodexUserMessageClientId: (item) => item.clientId,
      assertSupportedCodexHistory() {},
      assertCodexTurnCatalogDidNotRegress() {},
      loadCodexTurnCatalog: async () => catalog,
      hydrateCodexTurnRange: async (_request, _chat, _catalog, start, end) => {
        hydrated.push([start, end])
        return [authoritativeTurn]
      },
      getUserInputContent: (inputs) =>
        inputs
          .filter((input) => input.type === 'text')
          .map((input) => input.text)
          .join('\n'),
      planCodexHistoryEdit: () => ({
        retainedCatalog: [],
        rolledBackTurnIds: new Set([loadedTurn.id])
      }),
      rendererChatUpdateTurnLimit: 100,
      deleteCodexSubmittedMessagesForTurns: async () => {},
      getTurnModelOptions: () => ({}),
      getTurnAccessOptions: () => ({})
    }
  )
  Object.assign(adapter, {
    threads: new Map([['chat', thread]]),
    paginatedTurnCatalogs: new Map(),
    pausedQueuedTurnThreads: new Set(),
    rememberThreadContainer() {},
    resumeThread: async () => thread,
    stopActiveTurn: async () => {},
    filterRolledBackTurns: (_chat, turns) => turns,
    client: {
      request: async (method, params) => {
        requests.push({ method, params })
        return method === 'thread/revert' ? { thread } : { turn: { id: 'replacement' } }
      }
    },
    resolveThreadCwd: async () => null,
    resolveThreadName: async () => null,
    rememberRolledBackTurns() {},
    cacheThread() {},
    emitChatUpdated() {},
    addSubmittedPendingTurn: async () => ({ id: 'pending' }),
    startSubmittedCodexTurn: async (_chat, _pending, start) => start(),
    steerActiveChat: async (...args) => {
      steering.push(args)
    },
    getCachedChatDetail: () => ({ id: 'chat' })
  })
  return { adapter, requests, steering, hydrated }
}

for (const images of [[image, { path: '/added.png' }], []]) {
  test(`normal image message edits send the full replacement attachment list (${images.length} images)`, async () => {
    const fixture = createHistoryAdapter({
      id: 'turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'initial', content: [{ type: 'localImage', path: image.path }] }
      ]
    })
    await fixture.adapter.editMessageInContext('chat', 'turn', images.length ? '' : 'caption', {
      images,
      files: []
    })
    const input = fixture.requests.find((request) => request.method === 'turn/start').params.input
    assert.deepEqual(
      Array.from(
        input.filter((item) => item.type === 'localImage'),
        (item) => item.path
      ),
      images.map((image) => image.path)
    )
    assert.equal(
      input.some((item) => item.type === 'text'),
      images.length === 0
    )
  })
}

test('delivered steering resolves its authoritative item id and replays earlier screenshots intact', async () => {
  const initialInput = [
    { type: 'text', text: 'original' },
    { type: 'localImage', path: '/original.png' }
  ]
  const earlierInput = [{ type: 'localImage', path: '/earlier.png' }]
  const initial = { type: 'userMessage', id: 'initial', content: initialInput }
  const loaded = { id: 'turn', status: 'completed', items: [initial] }
  const full = {
    ...loaded,
    items: [
      initial,
      { type: 'userMessage', id: 'earlier', content: earlierInput },
      {
        type: 'userMessage',
        id: 'server-item',
        clientId: 'client-item',
        content: [{ type: 'localImage', path: '/old.png' }]
      }
    ]
  }
  const fixture = createHistoryAdapter(loaded, full)
  const options = { images: [{ path: '/new.png' }], files: [] }
  await fixture.adapter.editMessageInContext('chat', 'turn', '', options, 'client-item')
  assert.deepEqual(fixture.hydrated, [[0, 1]])
  assert.equal(fixture.requests[1].params.input, initialInput)
  assert.equal(fixture.steering[0][3], earlierInput)
  assert.equal(fixture.steering[1][2], options)
})
