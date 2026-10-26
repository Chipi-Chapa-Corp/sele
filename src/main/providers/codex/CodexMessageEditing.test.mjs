import { PendingMessageEdits } from '../PendingMessageEdits.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { CodexMessageDelivery } from './CodexMessageDelivery.ts'
import { hydrateCodexTurnRange, planCodexHistoryEdit } from './CodexPaginatedHistory.ts'
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
  'beginPendingMessageEdit',
  'cancelPendingMessageEdit',
  'resumePendingMessageDelivery',
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
  'reconcileStartedTurn',
  'interruptPendingMessageInContext',
  'steerPendingMessageInContext'
]
const createAdapter = () => {
  const adapter = vm.runInNewContext(
    ts.transpile(
      `class Adapter { pendingMessageEdits = new PendingMessageEdits(); ${declaration.members
        .filter((node) => methods.includes(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')} }; new Adapter()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    {
      PendingMessageEdits,
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
    getThreadContainer: () => null,
    runWithContainer: (_container, action) => action(),
    scheduleQueueDrain() {},
    ensureChatTailLoaded: async () => {},
    emitChatUpdated() {},
    getCachedChatDetail: () => ({ id: 'chat' }),
    hasPendingSteeringMessage: () => false,
    takeQueuedTurn: (_chat, id) =>
      adapter.queuedTurnsByThread.get('chat')?.find((turn) => turn.id === id) ?? null,
    takeSteeringMessage: () => null,
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

for (const action of ['interruptPendingMessageInContext', 'steerPendingMessageInContext']) {
  test(`${action} still sends a message that has not entered automatic delivery`, async () => {
    const adapter = createAdapter()
    const pending = queue(adapter)
    pending.text = 'Send this now'
    adapter.hasPendingSteeringMessage = () => false
    adapter.takeSteeringMessage = () => null
    adapter.takeQueuedTurn = (_chat, id) => (id === pending.id ? pending : null)
    const sent = []
    adapter.interruptAndContinueChat = adapter.steerActiveChat = async (...args) => {
      sent.push(args)
      return { id: 'chat' }
    }
    assert.equal((await adapter[action]('chat', 'queued')).id, 'chat')
    assert.equal(sent.length, 1)
    assert.equal(sent[0][1], 'Send this now')
    assert.equal(sent[0][2].images[0], image)
    await assert.rejects(adapter[action]('chat', 'missing'), /Pending message cannot be/)
  })

  test(`${action} waits for automatic delivery and does not resend the queued message`, async () => {
    const adapter = createAdapter()
    const pending = queue(adapter)
    let finishPersistence
    let acknowledge
    let refreshed = 0
    adapter.emitChatUpdated = () => refreshed++
    adapter.addSubmittedPendingTurn = () =>
      new Promise((resolve) => {
        finishPersistence = resolve
      })
    adapter.startCodexTurn = () =>
      new Promise((resolve) => {
        acknowledge = () => {
          adapter.reconcileStartedTurn('chat', 'queued', {
            id: 'server-turn',
            status: 'inProgress'
          })
          resolve()
        }
      })
    adapter.interruptAndContinueChat = () => assert.fail('must not submit a duplicate')
    adapter.steerActiveChat = () => assert.fail('must not steer a duplicate')

    const sending = adapter.runQueuedTurn('chat', pending)
    await Promise.resolve()
    assert.equal(adapter.queuedTurnsByThread.has('chat'), false)
    let settled = false
    const clicking = adapter[action]('chat', 'queued').then((detail) => {
      settled = true
      return detail
    })
    await Promise.resolve()
    assert.equal(settled, false)
    finishPersistence({ id: 'queued' })
    await Promise.resolve()
    await Promise.resolve()
    acknowledge()
    await sending
    assert.equal((await clicking).id, 'chat')
    const beforeRefresh = refreshed
    assert.equal((await adapter[action]('chat', 'queued')).id, 'chat')
    assert.equal(refreshed, beforeRefresh + 1, 'a stale queue click refreshes delivered detail')
  })
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

const createHistoryAdapter = (loadedTurn, authoritativeTurn = loadedTurn, history = {}) => {
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
      getTurnAccessOptions: () => ({}),
      ...history
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

for (const targetIndex of [0, 65, 129]) {
  test(`editing failed turn ${targetIndex} loads retained history before reverting the full server catalog`, async () => {
    const turns = Array.from({ length: 132 }, (_, index) => ({
      id: `turn-${index}`,
      status: index === targetIndex ? 'failed' : 'completed',
      items: [
        {
          type: 'userMessage',
          id: `message-${index}`,
          content: [{ type: 'text', text: `Prompt ${index}` }]
        }
      ]
    }))
    const fixture = createHistoryAdapter(turns[targetIndex], undefined, {
      loadCodexTurnCatalog: async () => turns.map((turn) => ({ ...turn, items: [] })),
      hydrateCodexTurnRange,
      planCodexHistoryEdit
    })
    // Editing from a history window: earlier retained turns and newer turns are not loaded.
    const thread = fixture.adapter.threads.get('chat')
    thread.turnWindowStartIndex = targetIndex
    const requests = []
    let reverted = false
    let cached
    fixture.adapter.cacheThread = (next) => {
      cached = next
    }
    fixture.adapter.client.request = async (method, params) => {
      requests.push({ method, params })
      if (method === 'thread/turns/list') {
        assert.equal(reverted, false, 'history must be hydrated before mutation')
        const offset = Number(params.cursor ?? 0)
        const data = turns.toReversed().slice(offset, offset + params.limit)
        return {
          data,
          nextCursor: offset + data.length < turns.length ? String(offset + data.length) : null
        }
      }
      if (method === 'thread/revert') {
        assert.equal(params.beforeTurnId, turns[targetIndex].id)
        reverted = true
        return { thread }
      }
      assert.equal(method, 'turn/start')
      assert.equal(reverted, true)
      assert.equal(params.input[0].text, 'Revised prompt')
      return { turn: { id: 'replacement' } }
    }

    await fixture.adapter.editMessageInContext('chat', turns[targetIndex].id, 'Revised prompt')

    const retainedStart = Math.max(0, targetIndex - 99)
    assert.deepEqual(
      Array.from(cached.turns, (turn) => turn.id),
      turns.slice(retainedStart, targetIndex).map((turn) => turn.id)
    )
    assert.equal(cached.turnWindowStartIndex, retainedStart)
    assert.equal(requests.filter(({ method }) => method === 'thread/revert').length, 1)
    assert.equal(requests.filter(({ method }) => method === 'turn/start').length, 1)
  })
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

test('a pending edit holds automatic Codex delivery and saves in place before resuming', async () => {
  const adapter = createAdapter()
  const pending = queue(adapter)
  await adapter.beginPendingMessageEdit('chat', pending.id, 'edit')
  adapter.addSubmittedPendingTurn = () => assert.fail('held messages cannot enter delivery')
  await adapter.runQueuedTurn('chat', pending)
  assert.equal(adapter.queuedTurnsByThread.get('chat')[0], pending)
  await assert.rejects(
    adapter.editPendingMessageInContext('chat', pending.id, 'wrong', {}, 'old-edit'),
    /no longer active/
  )
  let resumes = 0
  adapter.scheduleQueueDrain = () => resumes++
  await adapter.editPendingMessageInContext('chat', pending.id, 'revised', { images: [] }, 'edit')
  assert.equal(adapter.queuedTurnsByThread.get('chat')[0].id, pending.id)
  assert.equal(adapter.queuedTurnsByThread.get('chat')[0].text, 'revised')
  assert.equal(adapter.pendingMessageEdits.has('chat'), false)
  assert.equal(resumes, 1)
})

test('a pending Codex edit holds only the edited turn and its successors', async () => {
  const adapter = createAdapter()
  const turns = ['first', 'edited', 'third'].map((id) => ({ id, text: id, options: {} }))
  adapter.queuedTurnsByThread.set('chat', [...turns])
  await adapter.beginPendingMessageEdit('chat', 'edited', 'edit')
  const started = []
  adapter.addSubmittedPendingTurn = async () => ({})
  adapter.startCodexTurn = async (_chat, text) => started.push(text)
  await adapter.runQueuedTurn('chat', turns[0])
  assert.deepEqual(started, ['first'])
  await adapter.runQueuedTurn('chat', turns[1])
  assert.deepEqual(started, ['first'], 'the edited turn waits for the edit')
  assert.deepEqual(
    adapter.queuedTurnsByThread.get('chat').map((turn) => turn.id),
    ['edited', 'third']
  )
})

test('Codex cancel resumes waiting local steering once and refuses already submitted steering', async () => {
  const adapter = createAdapter()
  const pending = steering(adapter)
  await adapter.beginPendingMessageEdit('chat', pending.id, 'edit')
  const sent = []
  adapter.processWaitingSteeringMessage = async (_chat, id) => sent.push(id)
  await adapter.cancelPendingMessageEdit('chat', pending.id, 'stale')
  assert.deepEqual(sent, [])
  await adapter.cancelPendingMessageEdit('chat', pending.id, 'edit')
  await adapter.cancelPendingMessageEdit('chat', pending.id, 'edit')
  assert.deepEqual(sent, [pending.id])
  pending.status = 'pending'
  await assert.rejects(
    adapter.beginPendingMessageEdit('chat', pending.id, 'next'),
    /already started delivery/
  )
  assert.equal(adapter.pendingMessageEdits.has('chat'), false)
})
