import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const harness = (provider, globals = {}, methods = ['getChatTerminalTasks']) => {
  const name = { codex: 'Codex', claude: 'Claude', copilot: 'Copilot', opencode: 'OpenCode' }[
    provider
  ]
  const source = ts.createSourceFile(
    'adapter.ts',
    readFileSync(new URL(`./${provider}/${name}ProviderAdapter.ts`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === `${name}ProviderAdapter`
  )
  return vm.runInNewContext(
    ts.transpile(
      `new (class { ${declaration.members
        .filter((node) => methods.includes(node.name?.getText(source)))
        .map((node) => node.getText(source))
        .join('\n')} })()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    {
      getContainerTargetKey: (target) => target?.name ?? 'host',
      requireData: (result) => result.data,
      ...globals
    }
  )
}

test('Codex lists actual background terminals across pages without opening a chat', async () => {
  const adapter = harness('codex')
  const requests = []
  adapter.clients = new Map([
    [
      'host',
      {
        request: async (method, params) => {
          requests.push({ method, params })
          return params.cursor
            ? { data: [{ processId: 'second' }] }
            : { data: [{ processId: 'first' }], nextCursor: 'next' }
        }
      }
    ]
  ])
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['first', 'second'])
  assert.ok(requests.every((request) => request.method === 'thread/backgroundTerminals/list'))
  assert.deepEqual(
    Array.from(await adapter.getChatTerminalTasks('chat', { container: { name: 'unopened' } })),
    []
  )
})

test('Claude uses shell-only nonambient task membership and notices its completion while idle', async () => {
  const adapter = harness('claude', {}, ['getChatTerminalTasks', 'handleQueryEvent'])
  adapter.queueUpdate = () => {}
  const state = {
    terminalTaskIds: new Set(),
    backgroundTaskIds: new Set(),
    active: false,
    waitingForSessionIdle: false
  }
  adapter.states = new Map([['chat', state]])
  await adapter.handleQueryEvent(
    state,
    {},
    {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: 'shell', task_type: 'local_bash' },
        { task_id: 'child', task_type: 'local_agent' },
        { task_id: 'ambient', task_type: 'local_bash', ambient: true }
      ]
    }
  )
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell'])
  await adapter.handleQueryEvent(
    state,
    {},
    { type: 'system', subtype: 'background_tasks_changed', tasks: [] }
  )
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
})

test('Copilot refreshes detached shells and excludes subagents and finished tasks without resuming sessions', async () => {
  const adapter = harness('copilot')
  let refreshes = 0
  adapter.states = new Map([
    [
      'chat',
      {
        session: {
          rpc: {
            tasks: {
              refresh: async () => {
                refreshes++
              },
              list: async () => ({
                tasks: [
                  { id: 'shell', type: 'shell', status: 'running' },
                  { id: 'idle-shell', type: 'shell', status: 'idle' },
                  { id: 'child', type: 'agent', status: 'running' },
                  { id: 'done', type: 'shell', status: 'completed' }
                ]
              })
            }
          }
        }
      }
    ]
  ])
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell', 'idle-shell'])
  assert.equal(refreshes, 1)
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('unopened')), [])
})

test('OpenCode reads live shell tool statuses and excludes failed, finished and nonterminal tools', async () => {
  const adapter = harness('opencode')
  const state = { session: { id: 'chat' }, container: null }
  adapter.states = new Map([['chat', state]])
  adapter.clientEntries = new Map([['host', { client: {} }]])
  let finished = false
  adapter.loadMessages = async () => [
    {
      info: { id: 'message' },
      parts: [
        {
          type: 'tool',
          tool: 'bash',
          callID: 'shell',
          state: { status: finished ? 'completed' : 'running' }
        },
        { type: 'tool', tool: 'read', callID: 'file', state: { status: 'running' } },
        { type: 'tool', tool: 'bash', callID: 'old', state: { status: 'error' } }
      ]
    }
  ]
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell'])
  finished = true
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
})

test('OpenCode keeps polling a known terminal after its message leaves the latest page', async () => {
  const adapter = harness('opencode')
  const state = { session: { id: 'chat' }, directory: '/project', container: null }
  const message = {
    info: { id: 'terminal-message' },
    parts: [{ type: 'tool', tool: 'bash', callID: 'shell', state: { status: 'running' } }]
  }
  const requests = []
  adapter.states = new Map([['chat', state]])
  adapter.clientEntries = new Map([
    [
      'host',
      {
        client: {
          session: {
            message: async (params) => {
              requests.push(params)
              return { data: message }
            }
          }
        }
      }
    ]
  ])
  let latest = [message]
  adapter.loadMessages = async () => [...latest]
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell'])
  latest = [{ info: { id: 'new-message' }, parts: [] }]
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell'])
  assert.equal(requests[0].messageID, 'terminal-message')
  message.parts[0].state.status = 'completed'
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
  assert.equal(requests.length, 2, 'completed messages no longer need individual polling')
})
