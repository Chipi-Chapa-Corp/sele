import assert from 'node:assert/strict'
import test from 'node:test'
import { createAgentTerminalSessions } from './agentTerminalSessions.ts'
import { createClaudeTerminalSessions } from './providers/claude/ClaudeTerminalSessions.ts'
import { createCodexTerminalSessions } from './providers/codex/CodexTerminalSessions.ts'
import { createCopilotTerminalSessions } from './providers/copilot/CopilotTerminalSessions.ts'
import { createOpenCodeTerminalSessions } from './providers/opencode/OpenCodeTerminalSessions.ts'

const options = {
  providerId: 'claude',
  chatId: 'chat',
  chatTitle: 'Fix terminal visibility',
  cwd: '/project',
  container: null,
  command: 'npm test',
  stop: async () => {}
}
const listen = (registry, id) => {
  const events = []
  const detach = registry.attach(id, {
    data: (data) => events.push(['data', data]),
    exit: (code) => events.push(['exit', code])
  })
  return { events, detach }
}

test('completed output survives expiration of the provider process handle', async () => {
  let now = 0
  const registry = createAgentTerminalSessions(() => now)
  const handle = registry.register('completed', { ...options, background: true })
  registry.list()
  handle.append('output to keep\r\n')
  await handle.finish(7)
  now = 121_000
  assert.deepEqual(registry.list(), [])
  assert.equal(registry.available(handle.id), false)
  assert.deepEqual(registry.completed(handle.id), { output: 'output to keep\r\n', exitCode: 7 })
  registry.dismiss(handle.id)
  assert.equal(registry.completed(handle.id), undefined)
})

test('only long foreground commands and background jobs get tabs, with indexes per chat', async () => {
  let now = 0
  const registry = createAgentTerminalSessions(() => now)
  const quick = registry.register('quick', options)
  now = 100
  await quick.finish()
  const long = registry.register('long', options)
  assert.deepEqual(registry.list(), [])
  now = 2100
  assert.equal(registry.list()[0].id, long.id)
  assert.equal(registry.list()[0].index, 1)
  registry.register('background', { ...options, background: true })
  registry.register('other-chat', { ...options, chatId: 'other', background: true })
  assert.deepEqual(
    registry.list().map((task) => task.index),
    [1, 2, 1]
  )
  assert.doesNotThrow(() => structuredClone(registry.list()))
  registry.dismiss(long.id)
  assert.equal(
    registry.list().some((task) => task.id === long.id),
    false
  )
})

test('attaching and detaching replay output without stopping or re-executing the process', async () => {
  const registry = createAgentTerminalSessions()
  const writes = []
  let stopped = 0
  const handle = registry.register('original', {
    ...options,
    background: true,
    stop: async () => stopped++,
    write: (data) => writes.push(data)
  })
  handle.append('before attaching\r\n')
  const first = listen(registry, handle.id)
  first.detach()
  const second = listen(registry, handle.id)
  try {
    handle.append('live output\r\n')
    assert.deepEqual(second.events, [
      ['data', 'before attaching\r\n'],
      ['data', 'live output\r\n']
    ])
    assert.equal(stopped, 0)
    await registry.write(handle.id, 'typed input\r')
    assert.deepEqual(writes, ['typed input\r'])
    await registry.stop(handle.id)
    assert.equal(stopped, 1)
    assert.deepEqual(second.events.at(-1), ['exit', 130])
    await registry.stop(handle.id)
    assert.equal(stopped, 1)
  } finally {
    second.detach()
  }
})

test('a completion racing an output read drains pending output before the exit event', async () => {
  const registry = createAgentTerminalSessions()
  let resolve
  let reads = 0
  const handle = registry.register('race', {
    ...options,
    background: true,
    read: () =>
      ++reads === 1
        ? new Promise((done) => {
            resolve = done
          })
        : Promise.resolve({ data: reads === 2 ? 'last bytes' : '' })
  })
  const listener = listen(registry, handle.id)
  try {
    const finishing = handle.finish(7)
    resolve({ data: 'pending bytes' })
    await finishing
    assert.deepEqual(listener.events, [
      ['data', 'pending bytes'],
      ['data', 'last bytes'],
      ['exit', 7]
    ])
  } finally {
    listener.detach()
  }
})

test('completion preserves the native exit code and output replay stays bounded', async () => {
  const registry = createAgentTerminalSessions()
  let reads = 0
  const handle = registry.register('output', {
    ...options,
    background: true,
    read: async () => ({ data: reads++ === 0 ? 'native output' : '', exitCode: 23 })
  })
  handle.append('x'.repeat(1024 * 1024))
  const listener = listen(registry, handle.id)
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(listener.events[0][1].length, 512 * 1024)
    assert.deepEqual(listener.events.at(-1), ['exit', 23])
    assert.equal(registry.status(handle.id), 'exited')
  } finally {
    listener.detach()
  }
})

test('failed cancellation retains the live process', async () => {
  const registry = createAgentTerminalSessions(() => 100)
  const error = new Error('native stop refused')
  const handle = registry.register('refused', {
    ...options,
    background: true,
    stop: async () => {
      throw error
    }
  })
  await assert.rejects(registry.stop(handle.id), error)
  assert.equal(registry.status(handle.id), 'running')
})

const claudeEvent = (type, blocks, tool_use_result) => ({
  type,
  message: { content: blocks },
  tool_use_result
})
test('Claude joins background membership to the original Bash call and reads its output file', async () => {
  const registry = createAgentTerminalSessions(() => 0)
  const stops = []
  const files = []
  let reads = 0
  const controller = createClaudeTerminalSessions(
    {
      ...options,
      stop: async (id) => stops.push(id),
      interrupt: async () => {},
      readOutputFile: (file) => {
        files.push(file)
        return async () => ({ data: reads++ === 0 ? 'server ready\r\n' : '' })
      }
    },
    registry
  )
  controller.consume(
    claudeEvent('assistant', [
      { type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'npm run dev' } }
    ])
  )
  controller.consume({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [{ task_id: 'job', task_type: 'local_bash', description: 'Development server' }]
  })
  controller.consume({
    type: 'system',
    subtype: 'task_started',
    task_id: 'job',
    tool_use_id: 'bash',
    task_type: 'local_bash',
    is_backgrounded: true,
    description: 'Development server'
  })
  controller.consume(
    claudeEvent(
      'user',
      [
        {
          type: 'tool_result',
          tool_use_id: 'bash',
          content:
            'Command running in background with ID: job. Output is being written to: /tmp/tasks/job.output'
        }
      ],
      { backgroundTaskId: 'job' }
    )
  )
  const tasks = registry.list()
  assert.equal(tasks.length, 1, 'membership and bookends must not duplicate the tab')
  assert.equal(tasks[0].command, 'npm run dev')
  assert.equal(tasks[0].stopScope, 'process')
  const listener = listen(registry, tasks[0].id)
  try {
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(files, ['/tmp/tasks/job.output'])
    assert.match(listener.events[0][1], /server ready/)
    await registry.stop(tasks[0].id)
    assert.deepEqual(stops, ['job'])
  } finally {
    listener.detach()
    controller.dispose()
  }
})

test('Claude foreground commands expose turn-scoped cancellation and finalize ordinary output', async () => {
  let now = 0
  const registry = createAgentTerminalSessions(() => now)
  let interrupts = 0
  const controller = createClaudeTerminalSessions(
    {
      ...options,
      stop: async () => {},
      interrupt: async () => interrupts++,
      readOutputFile: () => async () => ({ data: '' })
    },
    registry
  )
  controller.consume(
    claudeEvent('assistant', [
      { type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'npm test' } }
    ])
  )
  now = 3000
  const [source] = registry.list()
  assert.equal(source.stopScope, 'turn')
  const listener = listen(registry, source.id)
  try {
    controller.consume(
      claudeEvent('user', [{ type: 'tool_result', tool_use_id: 'bash', content: 'done' }], {
        stdout: 'All checks passed\n',
        stderr: ''
      })
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(listener.events, [
      ['data', 'All checks passed\r\n'],
      ['exit', 0]
    ])
    assert.equal(interrupts, 0)
  } finally {
    listener.detach()
    controller.dispose()
  }
})

test('Codex preserves output deltas, original process IDs and individual termination', async () => {
  const registry = createAgentTerminalSessions()
  const stops = []
  const controller = createCodexTerminalSessions(
    {
      container: null,
      metadata: () => ({ title: 'Codex chat', cwd: '/project' }),
      stop: async (...args) => stops.push(args),
      interrupt: async () => assert.fail('Must stop only the background process')
    },
    registry
  )
  const event = (method, item, extra = {}) => ({
    method,
    params: { threadId: 'chat', turnId: 'turn', item, ...extra }
  })
  controller.consume(
    event('item/started', { id: 'item', type: 'commandExecution', command: 'npm run dev' })
  )
  controller.consume(
    event('item/commandExecution/outputDelta', undefined, { itemId: 'item', delta: 'ready\r\n' })
  )
  controller.consume(
    event('item/completed', {
      id: 'item',
      type: 'commandExecution',
      processId: '17',
      aggregatedOutput: 'ready\r\n'
    })
  )
  controller.background('chat', [
    { processId: '17', itemId: 'item', command: 'npm run dev', cwd: '/project' }
  ])
  assert.equal(registry.list().length, 1)
  const [source] = registry.list()
  const listener = listen(registry, source.id)
  try {
    assert.deepEqual(listener.events, [['data', 'ready\r\n']])
    await registry.stop(source.id)
    assert.deepEqual(stops, [['chat', '17']])
  } finally {
    listener.detach()
    controller.dispose()
  }
})

test('Copilot detached shells use cursor reads and task-specific cancellation', async () => {
  const registry = createAgentTerminalSessions()
  const cursors = []
  const canceled = []
  const controller = createCopilotTerminalSessions(
    {
      ...options,
      session: {
        rpc: {
          tasks: {
            cancel: async (value) => {
              canceled.push(value)
              return { cancelled: true }
            },
            readOutput: async ({ cursor }) => {
              cursors.push(cursor)
              return { text: cursor ? '' : 'hello\n', cursor: 'next' }
            }
          }
        }
      }
    },
    registry
  )
  controller.sync([
    {
      type: 'shell',
      id: 'job',
      command: 'npm run dev',
      executionMode: 'background',
      attachmentMode: 'detached',
      status: 'running'
    }
  ])
  const [source] = registry.list()
  const listener = listen(registry, source.id)
  try {
    await new Promise((resolve) => setImmediate(resolve))
    await registry.stop(source.id)
    assert.deepEqual(canceled, [{ id: 'job' }])
    assert.deepEqual(cursors, [undefined, 'next'])
    assert.deepEqual(listener.events, [
      ['data', 'hello\r\n'],
      ['exit', 130]
    ])
  } finally {
    listener.detach()
    controller.dispose()
  }
})

test('OpenCode shell events reuse one tab and disclose cancellation of the owning turn', async () => {
  let now = 0
  const registry = createAgentTerminalSessions(() => now)
  let aborted = 0
  const controller = createOpenCodeTerminalSessions(
    { ...options, abortTurn: async () => aborted++ },
    registry
  )
  const update = (status, output = '') =>
    controller.consume('message.part.updated', {
      part: {
        type: 'tool',
        tool: 'bash',
        callID: 'call',
        state: { status, input: { command: 'npm test' }, metadata: { output } }
      }
    })
  update('running')
  now = 3000
  const [source] = registry.list()
  assert.equal(source.providerId, 'opencode-v2')
  assert.equal(source.stopScope, 'turn')
  const listener = listen(registry, source.id)
  try {
    update('running', 'Testing\n')
    update('running', 'Testing\nPassed\n')
    assert.equal(registry.list().length, 1)
    assert.deepEqual(listener.events, [
      ['data', 'Testing\r\n'],
      ['data', 'Passed\r\n']
    ])
    await registry.stop(source.id)
    assert.equal(aborted, 1)
  } finally {
    listener.detach()
    controller.dispose()
  }
})
