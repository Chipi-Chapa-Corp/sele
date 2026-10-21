import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'sele-copilot-queue-'))
await symlink(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'), 'dir')
await build({
  entryPoints: ['src/main/providers/copilot/CopilotProviderAdapter.ts'],
  outfile: join(directory, 'adapter.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'queue-fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /(?:BrowserAutomation|BrowserMcpServer|SqliteUsageReader)$/ },
          (args) => ({
            path: args.path.split('/').at(-1),
            namespace: 'fixture'
          })
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: {
            BrowserAutomation: 'export const getBrowserAutomationService = () => ({})',
            BrowserMcpServer: 'export const createBrowserMcpServer = async () => null',
            SqliteUsageReader: 'export class SqliteUsageReader { dispose() {} }'
          }[path]
        }))
      }
    }
  ]
})
const { CopilotProviderAdapter } = createRequire(import.meta.url)(join(directory, 'adapter.cjs'))
test.after(() => rm(directory, { recursive: true, force: true }))

const fixture = ({ storeEvents = false } = {}) => {
  const adapter = new CopilotProviderAdapter()
  const state = adapter.createState('chat')
  const native = { items: [], steeringMessages: [], inFlightSteeringCount: 0 }
  const sent = []
  const updates = []
  let removals = 0
  state.active = true
  state.session = {
    async send(options) {
      sent.push(options)
      if (options.mode === 'immediate') native.steeringMessages.push(options.displayPrompt)
      return `sent-${sent.length}`
    },
    async abort() {
      state.active = false
      state.stopped = true
    },
    rpc: {
      queue: {
        async pendingItems() {
          return structuredClone(native)
        },
        async removeMostRecent() {
          removals++
          return {
            removed:
              native.steeringMessages.length > native.inFlightSteeringCount &&
              native.steeringMessages.pop() !== undefined
          }
        }
      }
    }
  }
  adapter.ensureSession = async () => state
  adapter.applyTurnOptions = async () => {}
  adapter.emitUpdate = () =>
    updates.push(state.pendingMessages.map(({ id, content, kind }) => ({ id, content, kind })))
  adapter.createChatDetail = () => ({
    id: 'chat',
    items: state.pendingMessages.map((message) => ({ ...message }))
  })
  adapter.completionCoordinator = {
    cancel() {},
    complete(_id, options) {
      options.publish()
      return Promise.resolve(true)
    }
  }
  if (!storeEvents) adapter.storeEvent = () => {}
  adapter.reportEventTokenUsage = () => {}
  adapter.queueUpdate = () => {}
  return {
    adapter,
    state,
    native,
    sent,
    updates,
    get removals() {
      return removals
    }
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('queued messages remain in Sele until native idle and retain per-message options and attachments', async () => {
  const { adapter, state, native, sent } = fixture()
  const first = await adapter.sendActiveChatMessage('chat', 'first', 'queue', {
    model: 'one',
    images: [{ path: '/screen.png' }]
  })
  await adapter.sendActiveChatMessage('chat', 'second', 'queue', { model: 'two' })
  assert.equal(sent.length, 0)
  assert.deepEqual(native.items, [])
  assert.equal(first.items[0].attachments[0].path, '/screen.png')
  const applied = []
  adapter.applyTurnOptions = async (_state, options) => applied.push(options.model)
  adapter.handleEvent('chat', { type: 'session.idle', data: {} })
  await tick()
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['first']
  )
  assert.equal(sent[0].attachments[0].path, '/screen.png')
  assert.equal(state.pendingMessages[0].content, 'second')
  adapter.handleEvent('chat', { type: 'session.idle', data: {} })
  await tick()
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['first', 'second']
  )
  assert.deepEqual(applied, ['one', 'two'])
})

test('editing a queue entry holds it and its successors, while earlier entries still send', async () => {
  const { adapter, state, sent } = fixture()
  await adapter.sendActiveChatMessage('chat', 'first', 'queue')
  await adapter.sendActiveChatMessage('chat', 'second', 'queue')
  await adapter.sendActiveChatMessage('chat', 'third', 'queue')
  const id = state.pendingMessages[1].id
  await adapter.beginPendingMessageEdit('chat', id, 'edit')
  state.active = false
  await adapter.continueChat('chat', 'fourth')
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['first']
  )
  assert.deepEqual(
    state.pendingMessages.map((message) => message.content),
    ['second', 'third', 'fourth']
  )
  state.active = false
  await adapter.drainQueue(state)
  assert.equal(sent.length, 1, 'the edited entry and everything after it wait for the edit')
  await adapter.cancelPendingMessageEdit('chat', id, 'stale')
  assert.equal(sent.length, 1)
  await adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['first', 'second']
  )
  await adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.equal(sent.length, 2)
})

for (const action of ['save', 'cancel']) {
  test(`steering is withdrawn without changing its row or id, then resubmitted on ${action}`, async () => {
    const f = fixture()
    const { adapter, state, native, sent, updates } = f
    await adapter.sendActiveChatMessage('chat', 'original', 'steer', {
      images: [{ path: '/screen.png' }],
      model: 'original-model'
    })
    const id = state.pendingMessages[0].id
    await adapter.sendActiveChatMessage('chat', 'later', 'queue')
    await adapter.beginPendingMessageEdit('chat', id, 'edit')
    assert.equal(f.removals, 1)
    assert.deepEqual(native.steeringMessages, [])
    assert.equal(state.pendingMessages[0].id, id)
    assert.equal(state.pendingMessages[0].content, 'original')
    await adapter.refreshPendingMessages(state)
    assert.equal(state.pendingMessages[0].id, id)
    state.active = false
    await adapter.drainQueue(state)
    assert.equal(sent.length, 1, 'later queue must wait even when the running turn finishes')
    if (action === 'save') {
      await adapter.editPendingMessage(
        'chat',
        id,
        'revised',
        { model: 'new-model', images: [] },
        'edit'
      )
    } else {
      await adapter.cancelPendingMessageEdit('chat', id, 'edit')
    }
    assert.deepEqual(
      sent.map((message) => message.prompt),
      ['original', action === 'save' ? 'revised' : 'original']
    )
    assert.equal(state.pendingMessages[0].id, id)
    assert.ok(
      updates.every((items) => items.some((message) => message.id === id)),
      'the held row never disappears'
    )
    assert.equal(sent[1].attachments?.[0]?.path, action === 'cancel' ? '/screen.png' : undefined)
    assert.equal(state.pendingMessages[1].content, 'later')
  })
}

test('a hold acquired while options are being prepared prevents dispatch after that await', async () => {
  const { adapter, state, sent } = fixture()
  await adapter.sendActiveChatMessage('chat', 'original', 'queue')
  const id = state.pendingMessages[0].id
  state.active = false
  let prepared
  adapter.applyTurnOptions = () =>
    new Promise((resolve) => {
      prepared = resolve
    })
  const draining = adapter.drainQueue(state)
  await adapter.beginPendingMessageEdit('chat', id, 'edit')
  prepared()
  await draining
  assert.equal(sent.length, 0)
  assert.equal(state.pendingMessages[0].id, id)
  adapter.applyTurnOptions = async () => {}
  await adapter.editPendingMessage('chat', id, 'revised', { model: 'new' }, 'edit')
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['revised']
  )
})

test('later steering stays local and only one outstanding steering reaches the provider', async () => {
  const f = fixture()
  await f.adapter.sendActiveChatMessage('chat', 'first', 'steer')
  const id = f.state.pendingMessages[0].id
  await f.adapter.sendActiveChatMessage('chat', 'second', 'steer')
  assert.deepEqual(f.native.steeringMessages, ['first'])
  assert.equal(f.state.pendingMessages[1].delivery, 'local')
  await f.adapter.beginPendingMessageEdit('chat', id, 'edit')
  assert.deepEqual(f.native.steeringMessages, [])
  await f.adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.deepEqual(
    f.sent.map((message) => message.prompt),
    ['first', 'first']
  )
  f.native.steeringMessages = []
  f.adapter.handleEvent('chat', { type: 'pending_messages.modified', data: {} })
  await tick()
  assert.deepEqual(
    f.sent.map((message) => message.prompt),
    ['first', 'first', 'second']
  )
})

test('accepted steering cannot be withdrawn or resubmitted by opening an edit', async () => {
  const f = fixture()
  await f.adapter.sendActiveChatMessage('chat', 'first', 'steer')
  const id = f.state.pendingMessages[0].id
  f.native.inFlightSteeringCount = 1
  await assert.rejects(f.adapter.beginPendingMessageEdit('chat', id, 'edit'), /accepted|withdrawn/)
  assert.equal(f.removals, 0)
  assert.equal(f.adapter.pendingMessageEdits.has('chat'), false)
})

test('save validation keeps the hold and original steering for a later cancel', async () => {
  const { adapter, state, sent } = fixture()
  await adapter.sendActiveChatMessage('chat', 'original', 'steer')
  const id = state.pendingMessages[0].id
  await adapter.beginPendingMessageEdit('chat', id, 'edit')
  await assert.rejects(adapter.editPendingMessage('chat', id, '', undefined, 'edit'), /empty/)
  assert.equal(adapter.pendingMessageEdits.has('chat'), true)
  assert.equal(state.pendingMessages[0].content, 'original')
  await adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['original', 'original']
  )
})

test('stop keeps the local queue paused after an edit is cancelled', async () => {
  const { adapter, state, sent } = fixture()
  await adapter.sendActiveChatMessage('chat', 'original', 'queue')
  const id = state.pendingMessages[0].id
  await adapter.beginPendingMessageEdit('chat', id, 'edit')
  await adapter.stopChat('chat')
  await adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.equal(sent.length, 0)
  assert.equal(state.pendingMessages[0].id, id)
})

test('failed steering resubmission retains the edit hold and cancel restores the original payload', async () => {
  const { adapter, state, sent } = fixture()
  await adapter.sendActiveChatMessage('chat', 'original', 'steer')
  const id = state.pendingMessages[0].id
  await adapter.beginPendingMessageEdit('chat', id, 'edit')
  const send = state.session.send
  state.session.send = async () => {
    throw new Error('offline')
  }
  await assert.rejects(
    adapter.editPendingMessage('chat', id, 'revised', undefined, 'edit'),
    /offline/
  )
  assert.equal(adapter.pendingMessageEdits.has('chat'), true)
  assert.equal(state.pendingMessages[0].content, 'original')
  state.session.send = send
  await adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.deepEqual(
    sent.map((message) => message.prompt),
    ['original', 'original']
  )
})

test('a steering snapshot arriving before send acknowledgment reuses the submitting row', async () => {
  const { adapter, state, updates } = fixture()
  const send = state.session.send
  state.session.send = async (options) => {
    const id = await send(options)
    await adapter.refreshPendingMessages(state)
    adapter.emitUpdate(state)
    return id
  }
  await adapter.sendActiveChatMessage('chat', 'original', 'steer')
  const id = state.pendingMessages[0].id
  await adapter.beginPendingMessageEdit('chat', id, 'edit')
  await adapter.cancelPendingMessageEdit('chat', id, 'edit')
  assert.ok(updates.every((items) => items.length === 1 && items[0].id === id))
})

test('Copilot accepts distinct steering events and repeated echoes without replacing the original', async () => {
  const { adapter, state, native } = fixture({ storeEvents: true })
  const original = {
    id: 'original',
    type: 'user.message',
    timestamp: new Date(1).toISOString(),
    data: { content: 'original prompt' }
  }
  adapter.handleEvent('chat', original)
  await adapter.sendActiveChatMessage('chat', 'change direction', 'steer')
  const steering = {
    id: 'server-steer',
    type: 'user.message',
    timestamp: new Date(2).toISOString(),
    data: { content: 'change direction' }
  }
  adapter.handleEvent('chat', steering)
  adapter.handleEvent('chat', steering)
  adapter.handleEvent('chat', original)
  native.steeringMessages = []
  await adapter.refreshPendingMessages(state)
  assert.deepEqual(
    state.events.map((event) => event.id),
    ['original', 'server-steer']
  )
  assert.equal(state.events[0].data.content, 'original prompt')
  assert.equal(state.events[1].data.content, 'change direction')
  assert.equal(state.pendingMessages.length, 0)
  assert.equal(state.active, true)
})
