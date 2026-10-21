import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { PendingMessageEdits } from '../PendingMessageEdits.ts'
import { reconcileProviderRecords } from '../ProviderConversationEngine.ts'
import { forEachOpenCodeHistoryMessage, loadOpenCodeMessages } from './OpenCodeHistory.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'OpenCodeProviderAdapter'
)
const names = new Set([
  'pendingMessageEdits',
  'queueDrains',
  'beginPendingMessageEdit',
  'cancelPendingMessageEdit',
  'editPendingMessage',
  'drainQueue',
  'sendPrompt',
  'queueMessage',
  'sendActiveChatMessage',
  'refreshStateNow'
])
const code = ts.transpile(
  `class Adapter { ${declaration.members
    .filter((node) => names.has(node.name?.getText(source)))
    .map((node) => node.getText(source))
    .join('\n')} }; new Adapter()`,
  { target: ts.ScriptTarget.ES2022 }
)
const fixture = (kind = 'queued') => {
  const adapter = vm.runInNewContext(code, {
    PendingMessageEdits,
    basename,
    console,
    randomUUID: () => 'new',
    createPromptParts: async (text) => [{ type: 'text', text }],
    parseOpenCodeModelId: (model) => model,
    fallbackOpenCodeModels: [{ id: 'default' }],
    getOpenCodePermissionRules: () => [],
    getSelectedSkillsSystemPrompt: () => undefined,
    requireData: (response) => response.data,
    forEachOpenCodeHistoryMessage,
    loadOpenCodeMessages,
    reconcileProviderRecords
  })
  const state = {
    id: 'chat',
    active: false,
    stopped: false,
    failed: false,
    browserGeneration: 0,
    container: { kind: 'container' },
    directory: '/project',
    queuedMessages: [{ type: 'pendingMessage', id: 'pending', kind, content: 'original' }]
  }
  const sent = []
  const client = {
    session: {
      async update() {},
      async promptAsync(input) {
        sent.push(input)
      }
    }
  }
  Object.assign(adapter, {
    states: new Map([['chat', state]]),
    ensureState: async () => state,
    getClientEntry: async () => ({ client }),
    closeBrowser() {},
    completionCoordinator: { cancel() {} },
    scheduleUpdate() {},
    completeTurn: async () => {},
    createChatDetail: () => ({ id: 'chat', items: state.queuedMessages })
  })
  return { adapter, state, sent, client }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('OpenCode edit acquired during asynchronous preparation prevents dispatch', async () => {
  const { adapter, state, sent, client } = fixture()
  let prepared
  client.session.update = () =>
    new Promise((resolve) => {
      prepared = resolve
    })
  const draining = adapter.drainQueue(state)
  while (!prepared) await tick()
  await adapter.beginPendingMessageEdit('chat', 'pending', 'edit')
  prepared()
  await draining
  assert.equal(sent.length, 0)
  assert.equal(state.queuedMessages[0].id, 'pending')
  client.session.update = async () => {}
  await adapter.cancelPendingMessageEdit('chat', 'pending', 'edit')
  assert.equal(sent[0].parts[0].text, 'original')
})

test('saving before preparation finishes discards prepared old content and sends the new payload once', async () => {
  const { adapter, state, sent, client } = fixture()
  let prepared
  client.session.update = () =>
    new Promise((resolve) => {
      prepared = resolve
    })
  const draining = adapter.drainQueue(state)
  while (!prepared) await tick()
  await adapter.beginPendingMessageEdit('chat', 'pending', 'edit')
  await adapter.editPendingMessage('chat', 'pending', 'revised', { model: 'new' }, 'edit')
  client.session.update = async () => {}
  prepared()
  await draining
  await tick()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].parts[0].text, 'revised')
  assert.equal(sent[0].model, 'new')
  assert.equal(state.queuedMessages.length, 0)
})

test('editing a later queued message still sends the messages queued before it', async () => {
  const { adapter, state, sent } = fixture()
  state.queuedMessages = ['first', 'pending', 'third'].map((id) => ({
    type: 'pendingMessage',
    id,
    kind: 'queued',
    content: id
  }))
  await adapter.beginPendingMessageEdit('chat', 'pending', 'edit')
  await adapter.drainQueue(state)
  await tick()
  assert.deepEqual(
    sent.map((input) => input.parts[0].text),
    ['first']
  )
  state.active = false
  await adapter.drainQueue(state)
  assert.equal(sent.length, 1, 'the edited message and its successors wait for the edit')
  await adapter.cancelPendingMessageEdit('chat', 'pending', 'edit')
  assert.deepEqual(
    sent.map((input) => input.parts[0].text),
    ['first', 'pending']
  )
  assert.deepEqual(
    state.queuedMessages.map((message) => message.id),
    ['third']
  )
})

test('a queue-mode send to a turn that already ended is sent, not parked', async () => {
  const { adapter, state, sent } = fixture()
  state.queuedMessages = []
  await adapter.sendActiveChatMessage('chat', 'next', 'queue')
  assert.deepEqual(
    sent.map((input) => input.parts[0].text),
    ['next']
  )
  assert.equal(state.queuedMessages.length, 0)
})

test('a queue-mode send during an active turn waits for the turn', async () => {
  const { adapter, state, sent } = fixture()
  state.queuedMessages = []
  state.active = true
  await adapter.sendActiveChatMessage('chat', 'next', 'queue')
  assert.equal(sent.length, 0)
  assert.equal(state.queuedMessages.length, 1)
})

const refreshClient = (client, status) =>
  Object.assign(client, {
    session: {
      ...client.session,
      get: async () => ({ data: { id: 'chat', time: { updated: 1 } } }),
      messages: async () => ({ data: [], response: new Response() }),
      status: async () => ({ data: status ? { chat: status } : {} })
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) }
  })

test('a refresh that finds the server idle ends the turn and sends the queue', async () => {
  const { adapter, state, sent, client } = fixture()
  Object.assign(state, { active: true, eventRevision: 0, messages: [], session: null })
  adapter.reportMessageTokenUsage = () => {}
  await adapter.refreshStateNow(state, refreshClient(client), false)
  await tick()
  assert.deepEqual(
    sent.map((input) => input.parts[0].text),
    ['original']
  )
})

test('a refresh outdated by a live event while the server is idle schedules another', async () => {
  const { adapter, state, client } = fixture()
  Object.assign(state, { active: true, eventRevision: 0, messages: [], session: null })
  adapter.reportMessageTokenUsage = () => {}
  let scheduled = 0
  adapter.scheduleUpdate = () => (scheduled += 1)
  const c = refreshClient(client)
  const get = c.session.get
  c.session.get = async () => {
    state.eventRevision += 1
    return get()
  }
  await adapter.refreshStateNow(state, c, false)
  assert.equal(state.active, true)
  assert.equal(scheduled, 1)
})

test('cancelling held local steering resubmits it during the active turn', async () => {
  const { adapter, state, sent } = fixture('steering')
  state.active = true
  await adapter.beginPendingMessageEdit('chat', 'pending', 'edit')
  await adapter.drainQueue(state)
  assert.equal(sent.length, 0)
  await adapter.cancelPendingMessageEdit('chat', 'pending', 'edit')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].parts[0].text, 'original')
})

test('OpenCode steering retains the original and distinct server message IDs across refreshes', async () => {
  const { adapter, state, sent, client } = fixture('steering')
  const original = {
    info: { id: 'original', sessionID: 'chat', role: 'user', time: { created: 1 } },
    parts: [{ id: 'original-text', type: 'text', text: 'original prompt' }]
  }
  Object.assign(state, { active: true, eventRevision: 0, messages: [original], session: null })
  await adapter.drainQueue(state)
  assert.equal(sent.length, 1)
  assert.equal(state.queuedMessages.length, 0)
  const steering = {
    info: { id: 'server-steer', sessionID: 'chat', role: 'user', time: { created: 2 } },
    parts: [{ id: 'steer-text', type: 'text', text: sent[0].parts[0].text }]
  }
  const c = refreshClient(client, { type: 'busy' })
  c.session.messages = async () => ({
    data: structuredClone([original, steering]),
    response: new Response()
  })
  adapter.reportMessageTokenUsage = () => {}
  await adapter.refreshStateNow(state, c, false)
  await adapter.refreshStateNow(state, c, false)
  assert.deepEqual(
    Array.from(state.messages, (message) => message.info.id),
    ['original', 'server-steer']
  )
  assert.equal(state.messages[0].parts[0].text, 'original prompt')
  assert.equal(state.messages[1].parts[0].text, 'original')
  assert.equal(state.active, true)
})
