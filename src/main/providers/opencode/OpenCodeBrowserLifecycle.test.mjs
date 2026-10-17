import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getOpenCodePermissionRules } from './OpenCodePermissions.ts'
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
const methods = new Set(['sendPrompt', 'closeBrowser', 'abortState', 'handleEvent'])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((x) => methods.has(x.name?.getText(source)))
    .map((x) => x.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const fixture = () => {
  const context = vm.createContext({
    console,
    getOpenCodePermissionRules,
    parseOpenCodeSessionEvent,
    createPromptParts: async (text) => [{ type: 'text', text }],
    parseOpenCodeModelId: () => ({}),
    fallbackOpenCodeModels: [{ id: 'fixture' }],
    getSelectedSkillsSystemPrompt: () => undefined,
    isRecord: (x) => !!x && typeof x === 'object',
    isOneShotSession: () => false,
    getOpenCodeErrorMessage: () => 'error',
    isOpenCodeAbortError: (error) => error?.name === 'MessageAbortedError'
  })
  vm.runInContext(code, context)
  const calls = []
  const state = {
    id: 'chat',
    directory: '/project',
    container: null,
    browser: null,
    browserGeneration: 0,
    messages: [],
    queuedMessages: [],
    session: null
  }
  const browser = {
    suspend() {
      calls.push('suspend')
    },
    async close() {
      calls.push('close')
    }
  }
  const client = {
    session: {
      async update(args) {
        calls.push(['permissions', args.permission])
      },
      async promptAsync() {
        calls.push('prompt')
      },
      async abort() {
        calls.push('abort')
      }
    }
  }
  const entry = {
    client,
    server: {
      async registerBrowser(scope) {
        calls.push(['register', scope])
        return browser
      }
    }
  }
  const adapter = Object.assign(new context.Harness(), {
    states: new Map([['chat', state]]),
    oneShotSessionIds: new Set(),
    sessionContainers: new Map(),
    getClientEntry: async () => entry,
    completionCoordinator: { cancel() {} },
    scheduleUpdate() {},
    completeTurn() {},
    getOrCreateState: () => state
  })
  return { adapter, state, calls, client, browser, entry }
}

test('adapter binds interactive turns and revokes before abort, while restricted/container turns get no capability', async () => {
  const { adapter, state, calls } = fixture()
  await adapter.sendPrompt(state, 'test')
  assert.equal(calls[0][0], 'register')
  assert.equal(calls[1][1].find((x) => x.permission === 'sele_browser_*').action, 'ask')
  await adapter.abortState(state)
  assert.deepEqual(calls.slice(-3), ['suspend', 'close', 'abort'])
  calls.length = 0
  await adapter.sendPrompt(state, 'test', { sandboxMode: 'read-only' })
  assert.ok(!calls.some((x) => x[0] === 'register'))
  assert.equal(calls[0][1].find((x) => x.permission === 'sele_browser_*').action, 'deny')
  calls.length = 0
  state.container = { kind: 'container', tool: 'ssh' }
  await adapter.sendPrompt(state, 'test')
  assert.ok(!calls.some((x) => x[0] === 'register'))
})

test('adapter revokes on idle, error, and deletion, and rejects an aborted registration', async () => {
  for (const type of ['session.idle', 'session.error', 'session.deleted']) {
    const { adapter, state, browser, calls, entry } = fixture()
    state.browser = browser
    adapter.handleEvent(entry, {
      directory: '/project',
      payload: { type, properties: { sessionID: 'chat' } }
    })
    assert.deepEqual(calls.slice(0, 2), ['suspend', 'close'])
    assert.equal(state.browser, null)
  }
  const { adapter, state, calls, entry, browser } = fixture()
  let finish
  entry.server.registerBrowser = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const sending = adapter.sendPrompt(state, 'test')
  while (!finish) await Promise.resolve()
  adapter.closeBrowser(state)
  finish(browser)
  await assert.rejects(sending, /startup was canceled/)
  assert.deepEqual(calls, ['close'])
})

test('adapter closes the capability if the session permission update fails', async () => {
  const { adapter, state, client, calls } = fixture()
  client.session.update = async () => {
    throw new Error('update failed')
  }
  await assert.rejects(adapter.sendPrompt(state, 'test'), /update failed/)
  assert.deepEqual(calls.slice(-2), ['suspend', 'close'])
  assert.equal(state.browser, null)
})
