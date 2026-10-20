import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as subagents from './CodexSubagents.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'CodexProviderAdapter'
)
const methods = [
  'getSubagentsInContext',
  'cancelSubagentInContext',
  'getThreadSubagents',
  'recordSubagentRunOutcome',
  'emitChatUpdated',
  'handleNotification'
]
const code = ts.transpile(
  `class Harness { ${declaration.members
    .filter((node) => methods.includes(node.name?.getText(source)))
    .map((node) => node.getText(source))
    .join('\n')} }; new Harness()`,
  { target: ts.ScriptTarget.ES2022 }
)
const thread = (id, parentThreadId = null) => ({
  id,
  parentThreadId,
  agentNickname: id,
  preview: '',
  createdAt: 100,
  updatedAt: 101,
  source: parentThreadId
    ? { subAgent: { thread_spawn: { parent_thread_id: parentThreadId } } }
    : 'vscode',
  status: { type: 'notLoaded' },
  turns: []
})
const setup = () => {
  const adapter = vm.runInNewContext(code, { ...subagents, console })
  const scheduled = []
  Object.assign(adapter, {
    threads: new Map([['root', thread('root')]]),
    subagentRunOutcomes: new Map(),
    threadRevisions: new Map(),
    rememberThreadContainer() {},
    getRenderableTurns: (value) => value.turns,
    reconcileUnsettledSubagents() {},
    scheduleChatUpdated: (id) => scheduled.push(id),
    cacheThread: (value) => adapter.threads.set(value.id, value)
  })
  return { adapter, scheduled }
}

test('native metadata discovers running descendants before parent transcript markers exist', async () => {
  const { adapter } = setup()
  const requests = []
  adapter.client = {
    request: async (method, params) => {
      requests.push({ method, ...params })
      if (method === 'thread/list') {
        assert.equal(params.ancestorThreadId, 'root')
        return params.cursor
          ? { data: [thread('child', 'root')], nextCursor: null }
          : { data: [thread('grandchild', 'child')], nextCursor: 'second' }
      }
      assert.equal(method, 'thread/turns/list')
      assert.equal(params.itemsView, 'notLoaded')
      assert.equal(params.limit, 1)
      return { data: [{ id: 'live-turn', status: 'inProgress', startedAt: 100, items: [] }] }
    }
  }
  const agents = await adapter.getSubagentsInContext('root')
  assert.deepEqual(
    Array.from(agents, (agent) => [agent.id, agent.parentId, agent.status]),
    [
      ['child', null, 'running'],
      ['grandchild', 'child', 'running']
    ]
  )
  assert.equal(requests.filter((request) => request.method === 'thread/list').length, 2)
  assert.equal(
    requests.some((request) => request.itemsView === 'full'),
    false
  )
})

test('child and grandchild thread-start notifications refresh the root sidebar', () => {
  const { adapter, scheduled } = setup()
  adapter.handleNotification({
    method: 'thread/started',
    params: { thread: thread('child', 'root') }
  })
  adapter.handleNotification({
    method: 'thread/started',
    params: { thread: thread('grandchild', 'child') }
  })
  assert.deepEqual(scheduled, ['child', 'grandchild'])
  scheduled.length = 0
  adapter.emitChatUpdated('grandchild')
  assert.deepEqual(scheduled, ['root'])
  assert.equal(adapter.getThreadSubagents(adapter.threads.get('root'), []).length, 2)
})

test('unknown metadata settles from a failed child turn independently of parent completion', async () => {
  const { adapter } = setup()
  adapter.client = {
    request: async (method) =>
      method === 'thread/list'
        ? { data: [thread('child', 'root')], nextCursor: null }
        : { data: [{ id: 'failed', status: 'failed', completedAt: 102, items: [] }] }
  }
  const [agent] = await adapter.getSubagentsInContext('root')
  assert.equal(agent.status, 'failed')
})

test('Codex stop interrupts the live child turn before it is persisted', async () => {
  const { adapter, scheduled } = setup()
  adapter.threads.set('child', thread('child', 'root'))
  adapter.activeTurnIds = new Map([['child', 'live-turn']])
  const interrupted = []
  adapter.client = {
    request: async () => {
      throw new Error('Should use the live turn ID')
    }
  }
  adapter.interruptTurnWithClient = async (_client, id, turnId) => {
    interrupted.push([id, turnId])
    return { interrupted: true, turnId }
  }
  adapter.markTurnInterrupted = () => {}
  adapter.setThreadStatus = () => {}
  await adapter.cancelSubagentInContext('root', 'child')
  assert.deepEqual(interrupted, [['child', 'live-turn']])
  assert.equal(adapter.activeTurnIds.has('child'), false)
  assert.equal(adapter.subagentRunOutcomes.get('child').status, 'stopped')
  assert.deepEqual(scheduled, ['root'])
})
