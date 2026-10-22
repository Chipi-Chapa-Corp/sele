import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { createOpenCodeTerminalTasks } from './opencode/OpenCodeTerminalTasks.ts'
import { reconcileOpenCodeMessageSnapshot } from './opencode/OpenCodeEvents.ts'

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
      reconcileOpenCodeMessageSnapshot,
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

test('OpenCode verifies server liveness before reading the current shell step', async () => {
  const adapter = harness('opencode')
  const state = { session: { id: 'chat' }, directory: '/project', container: null, messages: [] }
  adapter.states = new Map([['chat', state]])
  let busy = true
  const entry = {
    terminalTasks: createOpenCodeTerminalTasks(() => 0),
    client: {
      session: {
        status: async (params) => {
          assert.equal(params.directory, '/project')
          return { data: busy ? { chat: { type: 'busy' } } : {} }
        }
      }
    }
  }
  adapter.clientEntries = new Map([['host', entry]])
  let finished = false
  adapter.loadMessages = async () => [
    {
      info: { id: 'message', role: 'assistant', time: { created: 1 } },
      parts: [
        {
          type: 'tool',
          tool: 'bash',
          callID: 'shell',
          state: { status: finished ? 'completed' : 'running', time: { start: 2 } }
        },
        { type: 'tool', tool: 'read', callID: 'file', state: { status: 'running' } },
        { type: 'tool', tool: 'bash', callID: 'old', state: { status: 'error' } }
      ]
    }
  ]
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell'])
  finished = true
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
  busy = false
  adapter.loadMessages = async () => assert.fail('idle sessions must not load history')
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
  adapter.clientEntries.clear()
  await assert.rejects(adapter.getChatTerminalTasks('chat'), /unavailable/)
})

test('OpenCode never pins an abandoned message after later assistant steps', async () => {
  const adapter = harness('opencode')
  const state = { session: { id: 'chat' }, directory: '/project', container: null, messages: [] }
  const message = {
    info: { id: 'terminal-message', role: 'assistant', time: { created: 1 } },
    parts: [
      {
        type: 'tool',
        tool: 'bash',
        callID: 'shell',
        state: { status: 'running', time: { start: 2 } }
      }
    ]
  }
  adapter.states = new Map([['chat', state]])
  adapter.clientEntries = new Map([
    [
      'host',
      {
        terminalTasks: createOpenCodeTerminalTasks(() => 0),
        client: {
          session: {
            status: async () => ({ data: { chat: { type: 'busy' } } }),
            message: async () => assert.fail('historical tool records are not live tasks')
          }
        }
      }
    ]
  ])
  let latest = [message]
  adapter.loadMessages = async () => [...latest]
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), ['shell'])
  latest = [{ info: { id: 'new-message', role: 'assistant', time: { created: 3 } }, parts: [] }]
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
})

test('OpenCode reconciles live tool completion received during a history poll', async () => {
  const adapter = harness('opencode')
  const message = {
    info: { id: 'reply', role: 'assistant', time: { created: 1 } },
    parts: [
      {
        type: 'tool',
        tool: 'bash',
        callID: 'shell',
        state: { status: 'running', time: { start: 2 } }
      }
    ]
  }
  const state = {
    session: { id: 'chat' },
    directory: '/project',
    container: null,
    messages: [message]
  }
  adapter.states = new Map([['chat', state]])
  adapter.clientEntries = new Map([
    [
      'host',
      {
        terminalTasks: createOpenCodeTerminalTasks(() => 0),
        client: { session: { status: async () => ({ data: { chat: { type: 'busy' } } }) } }
      }
    ]
  ])
  adapter.loadMessages = async () => {
    state.messages = [
      { ...message, parts: [{ ...message.parts[0], state: { status: 'completed' } }] }
    ]
    return [message]
  }
  assert.deepEqual(Array.from(await adapter.getChatTerminalTasks('chat')), [])
})

test('OpenCode server exit, event-stream loss and disposal invalidate outstanding reads', async () => {
  for (const loss of ['exit', 'stream', 'dispose']) {
    let exit
    let endStream
    let eventsDone
    let finishHistory
    let historyStarted
    const started = new Promise((resolve) => {
      historyStarted = resolve
    })
    const history = new Promise((resolve) => {
      finishHistory = resolve
    })
    const streamEnd = new Promise((resolve) => {
      endStream = resolve
    })
    const client = {
      session: { status: async () => ({ data: { chat: { type: 'busy' } } }) },
      global: {
        event: async ({ signal }) => {
          signal.addEventListener('abort', endStream, { once: true })
          return {
            stream: {
              [Symbol.asyncIterator]: () => ({
                next: async () => {
                  await streamEnd
                  return { done: true }
                }
              })
            }
          }
        }
      }
    }
    const adapter = harness(
      'opencode',
      {
        AbortController,
        console: { error() {} },
        normalizeStoredContainer: (container) => container ?? null,
        createOpenCodeTerminalTasks: () => createOpenCodeTerminalTasks(() => 0),
        OpenCodeServerClient: class {
          getClient = async () => client
          onExit = (listener) => {
            exit = listener
          }
          dispose = async () => {}
        }
      },
      ['getChatTerminalTasks', 'createClientEntry', 'consumeEvents', 'disposeClients']
    )
    const state = {
      session: { id: 'chat' },
      directory: '/project',
      container: null,
      messages: [],
      client
    }
    Object.assign(adapter, {
      states: new Map([['chat', state]]),
      clientEntries: new Map(),
      clientEntryPromises: new Map(),
      closeBrowser() {},
      loadMessages: async () => {
        historyStarted()
        return history
      }
    })
    const consume = adapter.consumeEvents
    adapter.consumeEvents = (entry) => {
      eventsDone = consume(entry)
      return eventsDone
    }
    const entry = await adapter.createClientEntry()
    adapter.clientEntries.set('host', entry)
    const reading = adapter.getChatTerminalTasks('chat')
    await started
    if (loss === 'exit') exit(new Error('server exited'))
    else if (loss === 'dispose') await adapter.disposeClients()
    else endStream()
    await eventsDone
    finishHistory([
      {
        info: { id: 'reply', role: 'assistant', time: { created: 1 } },
        parts: [
          {
            type: 'tool',
            tool: 'bash',
            callID: 'shell',
            state: { status: 'running', time: { start: 2 } }
          }
        ]
      }
    ])
    await assert.rejects(reading, /unavailable/, loss)
    assert.equal(adapter.clientEntries.has('host'), false, loss)
  }
})
