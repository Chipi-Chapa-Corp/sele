import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { isOpenCodeChildState } from './OpenCodeSubagents.ts'

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
    .filter((member) => ['emitUpdateNow', 'scheduleUpdate'].includes(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const session = (id, parentID) => ({ id, ...(parentID ? { parentID } : {}), time: { updated: 1 } })

const fixture = () => {
  const context = vm.createContext({
    console: { ...console, error() {} },
    setTimeout: (callback) => (callback(), 0),
    clearTimeout() {},
    updateDelayMs: 0,
    isOpenCodeChildState
  })
  vm.runInContext(code, context)
  const published = []
  const states = new Map()
  // The detail refresh is where a child's first event learns its session record.
  const refreshedSessions = new Map()
  const detail = (state) => {
    state.session = refreshedSessions.get(state.id) ?? state.session
    return { id: state.id }
  }
  const adapter = Object.assign(new context.Harness(), {
    states,
    updateTimers: new Map(),
    chatUpdatedListeners: new Set([(update) => published.push(update.id)]),
    createChatDetail: async (state) => detail(state),
    createChatDetailFromState: (state) => detail(state)
  })
  return { adapter, published, refreshedSessions, states }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('OpenCode child sessions never publish as top-level chats', async () => {
  const { adapter, published, refreshedSessions, states } = fixture()
  states.set('root', { id: 'root', session: session('root') })
  states.set('child', { id: 'child', session: session('child', 'root') })
  // A child's first events arrive before its session record names the parent.
  states.set('new-child', { id: 'new-child', session: null })
  refreshedSessions.set('new-child', session('new-child', 'child'))
  states.set('completed-child', { id: 'completed-child', session: null })
  refreshedSessions.set('completed-child', session('completed-child', 'root'))

  adapter.scheduleUpdate('root')
  adapter.scheduleUpdate('child')
  adapter.scheduleUpdate('new-child')
  await adapter.emitUpdateNow(states.get('child'), true)
  await adapter.emitUpdateNow(states.get('completed-child'), true)
  await settle()

  assert.deepEqual(published, ['root'])
})
