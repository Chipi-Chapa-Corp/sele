import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { applyOpenCodeMessageEvent, reconcileOpenCodeMessageSnapshot } from './OpenCodeEvents.ts'
import { renderOpenCodeChatItems } from './OpenCodeItemRenderers.ts'

const user = {
  info: { id: 'msg-1', role: 'user', time: { created: 1 } },
  parts: [{ id: 'prompt', type: 'text', text: 'Question' }]
}
const reply = { id: 'msg-2', role: 'assistant', time: { created: 2 } }
const text = { id: 'part-2', messageID: 'msg-2', sessionID: 'chat', type: 'text', text: 'Answer' }
const tool = {
  id: 'part-1',
  messageID: 'msg-2',
  sessionID: 'chat',
  type: 'tool',
  tool: 'bash',
  callID: 'call',
  state: {
    status: 'completed',
    input: { command: 'pwd' },
    output: '/fixture',
    time: { start: 2, end: 3 }
  }
}

const apply = (messages, type, properties) => {
  const result = applyOpenCodeMessageEvent(messages, type, properties)
  assert.ok(result, `event ${type} must be applied`)
  return result
}

test('streamed tools and final text are available before idle publishes the terminal snapshot', () => {
  let messages = [user]
  messages = apply(messages, 'message.updated', { info: reply })
  messages = apply(messages, 'message.part.updated', { part: tool })
  const old = messages
  messages = apply(messages, 'message.part.updated', { part: text })
  messages = apply(messages, 'message.part.delta', {
    messageID: reply.id,
    partID: text.id,
    field: 'text',
    delta: ' streamed'
  })
  // The provider's completed text snapshot replaces the accumulated deltas, without duplication.
  messages = apply(messages, 'message.part.updated', { part: { ...text, text: 'Answer streamed' } })
  messages = apply(messages, 'message.updated', {
    info: { ...reply, finish: 'stop', time: { created: 2, completed: 4 } }
  })
  assert.equal(old[1].parts.length, 1, 'published snapshots must remain immutable')
  const items = renderOpenCodeChatItems(messages, { active: false, stopped: false })
  assert.equal(items.find((item) => item.type === 'working').status, 'worked')
  assert.equal(items.at(-1).role, 'assistant')
  assert.equal(items.at(-1).content, 'Answer streamed')
})

test('a history response cannot overwrite streamed text, completions, additions, or removals received in flight', () => {
  const before = [user, { info: reply, parts: [text] }]
  let current = apply(before, 'message.part.delta', {
    messageID: reply.id,
    partID: text.id,
    field: 'text',
    delta: ' newer'
  })
  current = apply(current, 'message.updated', {
    info: { ...reply, finish: 'stop', time: { created: 2, completed: 4 } }
  })
  current = apply(current, 'message.updated', { info: { ...reply, id: 'msg-3' } })
  current = apply(current, 'message.removed', { messageID: user.info.id })
  const result = reconcileOpenCodeMessageSnapshot(before, current, structuredClone(before))
  assert.deepEqual(
    result.map((message) => message.info.id),
    ['msg-2', 'msg-3']
  )
  assert.equal(result[0].parts[0].text, 'Answer newer')
  assert.equal(result[0].info.finish, 'stop')
})

test('part removals stay removed and an unrecognized delta requires history recovery', () => {
  const before = [user, { info: reply, parts: [tool, text] }]
  const current = apply(before, 'message.part.removed', { messageID: reply.id, partID: tool.id })
  assert.deepEqual(reconcileOpenCodeMessageSnapshot(before, current, before)[1].parts, [text])
  assert.equal(
    applyOpenCodeMessageEvent(current, 'message.part.delta', {
      messageID: reply.id,
      partID: 'missing',
      field: 'text',
      delta: 'chunk'
    }),
    null
  )
})

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'OpenCodeProviderAdapter'
)
const code = ts.transpileModule(
  `class Harness { ${declaration.members.find((member) => member.name?.getText(source) === 'scheduleUpdate').getText(source)} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

test('continuous tokens cannot postpone publication and hydrated streams avoid HTTP history reloads', async () => {
  let nextTimer = 0
  const timers = new Map()
  const context = vm.createContext({
    console,
    updateDelayMs: 80,
    isOpenCodeChildState: () => false,
    setTimeout: (callback) => {
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout: (id) => timers.delete(id)
  })
  vm.runInContext(code, context)
  const state = { id: 'chat', messagesHydrated: true, messagesDirty: false }
  const updates = []
  const adapter = Object.assign(new context.Harness(), {
    states: new Map([['chat', state]]),
    updateTimers: new Map(),
    chatUpdatedListeners: new Set([(detail) => updates.push(detail)]),
    createChatDetail: () => {
      throw new Error('stream must not reload history')
    },
    createChatDetailFromState: () => ({ text: state.text })
  })
  adapter.scheduleUpdate('chat')
  const first = nextTimer
  for (let i = 0; i < 100; i++) {
    state.text = `chunk ${i}`
    adapter.scheduleUpdate('chat')
  }
  assert.equal(nextTimer, first, 'token arrivals must not reset the publication deadline')
  timers.get(first)()
  await Promise.resolve()
  assert.equal(updates.length, 1)
  assert.equal(updates[0].text, 'chunk 99')
  adapter.scheduleUpdate('chat')
  assert.equal(nextTimer, first + 1, 'later chunks receive another bounded publication')
})
