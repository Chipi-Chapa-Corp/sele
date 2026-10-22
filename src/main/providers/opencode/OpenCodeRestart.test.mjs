import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { isDefaultOpenCodeTitle } from './OpenCodeChatTitle.ts'
import {
  getOpenCodeDisplayTitle,
  getOpenCodeTurnOutcome,
  renderOpenCodeChatItems,
  renderOpenCodeChatWindow
} from './OpenCodeItemRenderers.ts'
import { loadOpenCodeMessages } from './OpenCodeHistory.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'OpenCodeProviderAdapter'
)
const names = new Set([
  'getChats',
  'getOrCreateState',
  'rememberSession',
  'createChat',
  'getChatStatus',
  'createChatDetailFromState'
])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((member) => names.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const user = (id, text) => ({
  info: { id, role: 'user', time: { created: 1000 } },
  parts: [{ type: 'text', id: `${id}:text`, text }]
})
const assistant = (id, completed, finish) => ({
  info: { id, role: 'assistant', time: { created: 1100, completed }, finish },
  parts: [{ type: 'reasoning', id: `${id}:reasoning`, text: 'Thinking' }]
})
const defaultTitle = 'New session - 2026-10-22T12:00:00.000Z'

const fixture = (messages, { title = defaultTitle, status } = {}) => {
  const session = {
    id: 'chat',
    directory: '/project',
    title,
    time: { created: 1000, updated: 1200 }
  }
  const requests = []
  const client = {
    experimental: { session: { list: async () => ({ data: [session] }) } },
    session: {
      status: async () => ({ data: status ? { chat: { type: status } } : {} }),
      messages: async ({ limit, before }) => {
        requests.push({ limit, before })
        const end = before ? Number(before) : messages.length
        const start = Math.max(0, end - limit)
        return {
          data: messages.slice(start, end),
          response: new Response(null, {
            headers: start > 0 ? { 'x-next-cursor': String(start) } : {}
          })
        }
      }
    }
  }
  const context = vm.createContext({
    console,
    requireData: (result) => result.data,
    isOneShotSession: () => false,
    isDefaultOpenCodeTitle,
    getOpenCodeDisplayTitle,
    getOpenCodeTurnOutcome,
    getContainerTargetKey: () => 'host',
    getMessagePreview: () => '',
    getPendingApproval: () => null,
    getPendingUserInput: () => null,
    renderOpenCodeChatItems,
    renderOpenCodeChatWindow
  })
  vm.runInContext(code, context)
  const adapter = Object.assign(new context.Harness(), {
    states: new Map(),
    sessionContainers: new Map(),
    getClientEntry: async () => ({ client, container: null }),
    loadMessages: loadOpenCodeMessages,
    getContextUsage: () => null
  })
  return { adapter, requests, session }
}

test('restart restores an unfinished turn as stopped and keeps its original prompt name', async () => {
  const messages = [user('first', 'Original conversation name')]
  for (let index = 0; index < 20; index++) {
    messages.push(assistant(`answer-${index}`, 1200, 'stop'))
    messages.push(user(`followup-${index}`, `Follow-up ${index}`))
  }
  messages.push(assistant('interrupted'))
  const { adapter, requests } = fixture(messages)
  const { chats } = await adapter.getChats()
  assert.equal(chats[0].title, 'Original conversation name')
  assert.equal(chats[0].lastTurnOutcome, 'stopped')
  assert.equal(chats[0].status, null)
  assert.ok(requests.length > 1, 'name recovery follows history pagination to the original prompt')
  requests.length = 0
  assert.equal((await adapter.getChats()).chats[0].title, chats[0].title)
  assert.equal(requests.length, 1, 'later sidebar refreshes reuse the recovered name')
  assert.equal(requests[0].limit, 8)

  const state = adapter.states.get('chat')
  Object.assign(state, { messages, messagesHydrated: true })
  const detail = adapter.createChatDetailFromState(state)
  assert.equal(detail.title, chats[0].title)
  assert.equal(detail.lastTurnOutcome, 'stopped')
  assert.equal(detail.items.at(-1).status, 'stopped')
  assert.equal(
    adapter.createChatDetailFromState(state, { limit: 1 }).items.at(-1).status,
    'stopped'
  )
})

test('a running reply is active when rediscovered, while named sessions keep bounded reads', async () => {
  const messages = [user('first', 'Question'), assistant('streaming')]
  const { adapter, requests } = fixture(messages, { title: 'Saved name', status: 'busy' })
  const { chats } = await adapter.getChats()
  assert.equal(chats[0].title, 'Saved name')
  assert.equal(chats[0].status, 'active')
  assert.equal(chats[0].lastTurnOutcome, null)
  assert.equal(requests[0].limit, 8)
  assert.equal(requests.length, 1)
})

test('a completed tool step without a final reply is stopped only after activity ends', () => {
  const messages = [user('first', 'Question'), assistant('tool-step', 1200, 'tool-calls')]
  assert.equal(getOpenCodeTurnOutcome(messages), 'stopped')
  assert.equal(
    renderOpenCodeChatItems(messages, { active: false, stopped: false }).at(-1).status,
    'stopped'
  )
  assert.equal(
    renderOpenCodeChatItems(messages, { active: true, stopped: false }).at(-1).status,
    'working'
  )
  messages.push(assistant('final', 1300, 'stop'))
  assert.equal(getOpenCodeTurnOutcome(messages), null)
  assert.equal(
    renderOpenCodeChatItems(messages, { active: false, stopped: false }).at(-1).status,
    'worked'
  )
})

test('an interrupted historical turn stays stopped after a later successful turn', () => {
  const messages = [
    user('first', 'Question'),
    assistant('interrupted'),
    user('second', 'Try again'),
    assistant('final', 1300, 'stop')
  ]
  assert.equal(getOpenCodeTurnOutcome(messages), null)
  assert.deepEqual(
    renderOpenCodeChatItems(messages, { active: false, stopped: false })
      .filter((item) => item.type === 'working')
      .map((item) => item.status),
    ['stopped', 'worked']
  )
})

test('compaction during a tool loop does not mark the preceding work as stopped', () => {
  const messages = [
    user('first', 'Question'),
    assistant('tool-step', 1200, 'tool-calls'),
    {
      info: { id: 'compact', role: 'user', time: { created: 1200 } },
      parts: [{ type: 'compaction', id: 'compaction' }]
    },
    assistant('final', 1300, 'stop')
  ]
  assert.deepEqual(
    renderOpenCodeChatItems(messages, { active: false, stopped: false })
      .filter((item) => item.type === 'working')
      .map((item) => item.status),
    ['worked', 'worked']
  )
})
