import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import {
  applyOpenCodeMessageEvent,
  parseOpenCodeSessionEvent,
  reconcileOpenCodeMessageSnapshot
} from './OpenCodeEvents.ts'

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
  `class Harness { ${declaration.members
    .filter((member) => member.name?.getText(source) === 'handleEvent')
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const fixture = () => {
  const context = vm.createContext({
    console: { ...console, error() {} },
    parseOpenCodeSessionEvent,
    applyOpenCodeMessageEvent,
    reconcileOpenCodeMessageSnapshot,
    getContainerTargetKey: () => 'host',
    isRecord: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    isOneShotSession: () => false,
    getOpenCodeErrorMessage: (error) => error?.data?.message ?? 'error',
    isOpenCodeAbortError: (error) => error?.name === 'MessageAbortedError'
  })
  vm.runInContext(code, context)
  // A turn Sele just sent: active until OpenCode reports otherwise.
  const state = {
    id: 'chat',
    messages: [],
    eventRevision: 0,
    directory: '/project',
    container: null,
    active: true,
    queuedMessages: []
  }
  const adapter = Object.assign(new context.Harness(), {
    states: new Map([['chat', state]]),
    oneShotSessionIds: new Set(),
    sessionContainers: new Map(),
    credentialHealth: { record() {} },
    freeLimits: { observe() {} },
    completionCoordinator: { cancel() {} },
    reportMessageTokenUsage() {},
    closeBrowser() {},
    scheduleUpdate() {},
    completeTurn() {
      state.active = false
    },
    getOrCreateState: () => state
  })
  const timeline = []
  const send = (type, properties = {}) => {
    adapter.handleEvent(
      { container: null },
      {
        directory: '/project',
        payload: { type, properties: { sessionID: 'chat', ...properties } }
      }
    )
    timeline.push({
      type,
      active: state.active,
      failed: Boolean(state.failed),
      stopped: Boolean(state.stopped)
    })
  }
  return { state, send, timeline }
}

const reply = (fields = {}) => ({
  info: {
    id: 'msg',
    sessionID: 'chat',
    role: 'assistant',
    providerID: 'anthropic',
    time: { created: 1 },
    ...fields
  }
})

// Event order recorded from OpenCode 1.19.3 for a request the provider rejected.
const failedTurn = (send, error) => {
  send('session.status', { status: { type: 'busy' } })
  send('message.updated', reply())
  send('session.error', { error })
  send('session.status', { status: { type: 'idle' } })
  send('session.idle')
  send('message.updated', reply({ error, time: { created: 1, completed: 2 } }))
  send('session.status', { status: { type: 'idle' } })
  send('session.idle')
}

test('a failed turn stays failed when its final message arrives after session.idle', () => {
  const { send, timeline } = fixture()
  failedTurn(send, { name: 'APIError', data: { message: 'Rejected', statusCode: 400 } })
  const failedAt = timeline.findIndex((entry) => entry.failed)
  assert.equal(timeline[failedAt].type, 'session.error')
  assert.deepEqual(
    timeline.slice(failedAt).filter((entry) => entry.active || !entry.failed),
    [],
    'the failed turn must not flash back to working'
  )
})

test('a stopped turn stays stopped when its aborted message arrives after session.idle', () => {
  const { send, timeline } = fixture()
  failedTurn(send, { name: 'MessageAbortedError', data: { message: 'Aborted' } })
  const stoppedAt = timeline.findIndex((entry) => entry.stopped)
  assert.deepEqual(
    timeline.slice(stoppedAt).filter((entry) => entry.active || !entry.stopped),
    []
  )
})

test('the user message summary written after session.idle does not restart the turn', () => {
  const { state, send } = fixture()
  send('session.status', { status: { type: 'busy' } })
  send('message.updated', reply())
  send('message.updated', reply({ time: { created: 1, completed: 2 } }))
  send('session.status', { status: { type: 'idle' } })
  send('session.idle')
  assert.equal(state.active, false)
  // OpenCode's SessionSummary rewrites the user message once the diff is computed.
  send('message.updated', {
    info: { id: 'user', sessionID: 'chat', role: 'user', time: { created: 0 }, summary: {} }
  })
  assert.equal(state.active, false)
})

test('a new reply in progress still resumes a failed turn', () => {
  const { state, send } = fixture()
  failedTurn(send, { name: 'APIError', data: { message: 'Rejected', statusCode: 400 } })
  send('message.updated', reply({ id: 'msg-2' }))
  assert.equal(state.active, true)
  assert.equal(state.failed, false)
  assert.equal(state.failureMessage, null)
})

test('the real event handler updates cached parts and completion before idle', () => {
  const { state, send } = fixture()
  send('message.updated', reply())
  send('message.part.updated', {
    part: { id: 'part', messageID: 'msg', type: 'text', text: 'Final' }
  })
  send('message.part.delta', { messageID: 'msg', partID: 'part', field: 'text', delta: ' answer' })
  send('message.updated', reply({ finish: 'stop', time: { created: 1, completed: 2 } }))
  send('session.idle')
  assert.equal(state.active, false)
  assert.equal(state.messages[0].info.finish, 'stop')
  assert.equal(state.messages[0].parts[0].text, 'Final answer')
  assert.equal(Boolean(state.messagesDirty), false)
})

test('a hidden compaction summary cannot restart a completed turn', () => {
  const { state, send } = fixture()
  send('session.idle')
  send('message.updated', reply({ id: 'summary', summary: true }))
  assert.equal(state.active, false)
})
