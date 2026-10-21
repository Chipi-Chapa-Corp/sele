import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { PendingMessageEdits } from '../PendingMessageEdits.ts'

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
  'queueMessage'
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
    getSelectedSkillsSystemPrompt: () => undefined
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
