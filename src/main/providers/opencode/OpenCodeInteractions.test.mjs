import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { reconcileProviderRecords } from '../ProviderConversationEngine.ts'
import { parseOpenCodeSessionEvent } from './OpenCodeEvents.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'OpenCodeProviderAdapter'
)
const methods = new Set([
  'handleEvent',
  'publishInteractionUpdate',
  'refreshState',
  'refreshStateNow',
  'emitUpdateNow',
  'getChatStatus'
])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((member) => methods.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const fixture = () => {
  const context = vm.createContext({
    console,
    clearTimeout,
    parseOpenCodeSessionEvent,
    reconcileProviderRecords,
    requireData: (result) => result.data,
    isRecord: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    isOneShotSession: () => false
  })
  vm.runInContext(code, context)
  const state = {
    id: 'chat',
    directory: '/project',
    session: { id: 'chat', time: { created: 1, updated: 1 } },
    eventRevision: 0,
    messages: [],
    pendingApprovals: [],
    pendingQuestions: [],
    active: true
  }
  const updates = []
  const adapter = Object.assign(new context.Harness(), {
    states: new Map([['chat', state]]),
    oneShotSessionIds: new Set(),
    refreshes: new WeakMap(),
    updateTimers: new Map(),
    chatUpdatedListeners: new Set([(detail) => updates.push(detail)]),
    getOrCreateState: () => state,
    reportMessageTokenUsage() {},
    scheduleUpdate() {},
    createChatDetailFromState: () => ({
      status: adapter.getChatStatus(state),
      approvals: Array.from(state.pendingApprovals, (request) => request.id),
      questions: Array.from(state.pendingQuestions, (request) => request.id)
    })
  })
  const send = (type, properties) =>
    adapter.handleEvent(
      { container: null },
      {
        directory: '/project',
        payload: { type, properties: { sessionID: state.id, ...properties } }
      }
    )
  return { adapter, state, updates, send }
}

const approval = {
  id: 'approval',
  permission: 'bash',
  patterns: ['cat README.md'],
  metadata: { command: 'cat README.md' },
  always: []
}
const question = {
  id: 'question',
  questions: [{ question: 'Which branch?', header: 'Branch', options: [] }]
}

test('an approval arriving during a snapshot is published before the snapshot finishes', async () => {
  const { adapter, state, send, updates } = fixture()
  let finishMessages
  const messages = new Promise((resolve) => {
    finishMessages = resolve
  })
  const response = (data) => Promise.resolve({ data })
  const client = {
    session: {
      get: () => response(state.session),
      messages: () => messages,
      status: () => response({ chat: { type: 'busy' } })
    },
    permission: { list: () => response([]) },
    question: { list: () => response([]) }
  }
  const refresh = adapter.refreshState(state, client)
  try {
    send('permission.asked', approval)
    assert.deepEqual(updates.at(-1), {
      status: 'waitingOnApproval',
      approvals: ['approval'],
      questions: []
    })
    finishMessages({ data: [] })
    await refresh
    assert.equal(
      state.pendingApprovals[0].id,
      'approval',
      'a stale snapshot must not hide the request'
    )
  } finally {
    finishMessages({ data: [] })
    await refresh
  }
})

test('permission events update the visible requests without another user message', () => {
  const { send, updates } = fixture()
  send('permission.asked', approval)
  send('permission.asked', { ...approval, metadata: { command: 'updated' } })
  assert.deepEqual(updates.at(-1).approvals, ['approval'])
  send('permission.asked', { ...approval, id: 'second' })
  send('permission.replied', { requestID: 'approval', reply: 'once' })
  assert.deepEqual(updates.at(-1).approvals, ['second'])
  send('permission.replied', { requestID: 'second', reply: 'reject' })
  assert.deepEqual(updates.at(-1), { status: 'active', approvals: [], questions: [] })
})

test('questions are published immediately and removed on replies or rejection', () => {
  for (const type of ['question.replied', 'question.rejected']) {
    const { send, updates } = fixture()
    send('question.asked', question)
    assert.deepEqual(updates.at(-1), {
      status: 'waitingOnUserInput',
      approvals: [],
      questions: ['question']
    })
    send(type, { requestID: question.id })
    assert.deepEqual(updates.at(-1), { status: 'active', approvals: [], questions: [] })
  }
})
