import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { requireContainerTarget } from './containerTarget.ts'
import * as targetShell from './targetShell.ts'
import { terminalIpcChannels } from '../shared/terminal.ts'
import { createAgentTerminalSessions } from './agentTerminalSessions.ts'

const require = createRequire(import.meta.url)
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
const terminalSource = compile('./registerTerminalIpc.ts')
const hostSource = compile('./hostProcess.ts')

const load = (source, mocks, globals = {}) => {
  const context = {
    exports: {},
    require: (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name]
      assert.ok(name.startsWith('node:'), `Unexpected dependency: ${name}`)
      return require(name)
    },
    process: { platform: 'linux', env: { PATH: '/usr/bin:/bin', SHELL: '/bin/sh' } },
    console,
    setTimeout,
    clearTimeout,
    setImmediate,
    ...globals
  }
  vm.runInNewContext(source, context)
  return context.exports
}

const harness = (
  now = Date.now,
  { persistent = new Map(), cleanup, discoveryError, shell = '/bin/sh' } = {}
) => {
  const handlers = new Map()
  const events = new Map()
  const agentSessions = createAgentTerminalSessions(now)
  const launches = []
  const connections = []
  const logs = []
  let discoveries = 0
  const killed = []
  const ownerEvents = new Map()
  const makePty = () => ({
    pid: 123,
    onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }),
    kill() {
      this.killed = true
    }
  })
  const host = load(hostSource, {
    './pty': { spawnPty: () => assert.fail('Unexpected shell lookup') },
    './currentContainer': {
      getCurrentContainerHostBridge: async () => null,
      isCurrentContainerTarget: async (target) => target.name === 'fixture'
    },
    './database/sshEnvironments': {},
    './sshCommand': {},
    './targetShell': targetShell,
    './windowsExecutableCommand': { normalizeWindowsExecutableCommand: (command) => command },
    './optionalProbe': {},
    '../shared/expectedAbsence.ts': {}
  })
  const terminal = load(
    terminalSource,
    {
      electron: {
        app: { getPath: () => '/tmp' },
        ipcMain: { on: (channel, handler) => events.set(channel, handler) }
      },
      './clientIpc': { onClientMessage: (channel, handler) => events.set(channel, handler) },
      './agentTerminalSessions': { agentTerminalSessions: agentSessions },
      './persistentTerminal': {
        listPersistentTerminalIds: async () => {
          discoveries++
          if (discoveryError) throw discoveryError
          return [...persistent.keys()]
        },
        connectPersistentTerminal: async (_profile, id, launch) => {
          connections.push(id)
          if (persistent.get(id) instanceof Error) throw persistent.get(id)
          if (persistent.has(id)) return persistent.get(id)
          const pty = {
            ...makePty(),
            metadata: launch.metadata,
            refreshStatus: async () => {},
            attach: async () => {},
            stop: async () => {
              pty.killed = true
            },
            detach: () => {
              pty.detached = true
            }
          }
          persistent.set(id, pty)
          return pty
        }
      },
      './chatProcesses': {
        killTerminalProcesses: async (ids, target) => {
          killed.push([Array.from(ids), target])
          await cleanup?.(ids, target)
        }
      },
      '../shared/provider': { providerIds: ['codex', 'claude', 'copilot', 'opencode-v2'] },
      'node:os': { userInfo: () => ({ shell }) },
      './pty': {
        spawnPty: (file, args, options) => {
          const pty = makePty()
          launches.push({ file, args: Array.from(args), options, pty })
          return pty
        }
      },
      './logging': { handleClientRequest: (channel, handler) => handlers.set(channel, handler) },
      '../shared/terminal': { terminalIpcChannels },
      './containerTarget': { requireContainerTarget },
      './hostProcess': host
    },
    {
      Date: class extends Date {
        static now() {
          return now()
        }
      },
      console: { ...console, error: (...args) => logs.push(args) }
    }
  )
  terminal.registerTerminalIpc()
  const sent = []
  const owner = {
    id: 1,
    once: (name, listener) => ownerEvents.set(name, listener),
    isDestroyed: () => false,
    send: (...args) => sent.push(args)
  }
  return {
    agentSessions,
    owner,
    sent,
    events,
    handlers,
    dispose: terminal.disposeTerminalSessions,
    stopChats: terminal.stopChatTerminalSessions,
    persistent,
    killed,
    ownerEvents,
    launches,
    connections,
    logs,
    get discoveries() {
      return discoveries
    },
    create: (options) =>
      handlers.get(terminalIpcChannels.createSession)(
        { sender: owner },
        {
          sessionId: '12345678-1234-4234-8234-123456789abc',
          cwd: '/tmp',
          cols: 80,
          rows: 24,
          ...options
        }
      )
  }
}

for (const workspaceKey of [undefined, 'workspace']) {
  test(`terminal activity ignores alternate idle shells, persistent=${!!workspaceKey}`, async () => {
    const h = harness(Date.now, { shell: '/usr/bin/fish' })
    try {
      const session = await h.create({ workspaceKey })
      const pty = workspaceKey ? h.persistent.get(session.id) : h.launches[0].pty
      const status = () =>
        h.handlers.get(terminalIpcChannels.getProcessStatus)({ sender: h.owner }, session.id)
      for (const processName of [
        '/usr/bin/sh',
        ' /bin/bash ',
        '-zsh',
        '/bin/dash',
        '/usr/bin/fish',
        'pwsh.exe',
        'xterm-256color',
        ''
      ]) {
        pty.process = processName
        assert.equal((await status()).hasActiveProcess, false, processName)
      }
      for (const processName of ['/usr/bin/sleep', 'node', 'python3', 'ssh', 'fish-helper']) {
        pty.process = processName
        const result = await status()
        assert.equal(result.hasActiveProcess, true, processName)
        assert.equal(result.processName, processName)
      }
      pty.process = '/usr/bin/sh'
      assert.equal((await status()).hasActiveProcess, false, 'Completed commands return to idle')
      assert.equal(
        (
          await h.handlers.get(terminalIpcChannels.getProcessStatus)(
            { sender: { id: 2 } },
            session.id
          )
        ).hasActiveProcess,
        false,
        'Foreign owners cannot inspect terminal processes'
      )
    } finally {
      await h.dispose()
    }
  })
}

test('native terminal IPC attaches to the original process and restricts stream access to its owner', async () => {
  const h = harness()
  let stopped = 0
  const writes = []
  const native = h.agentSessions.register('native', {
    providerId: 'claude',
    chatId: 'chat',
    chatTitle: 'Chat',
    command: 'npm run dev',
    cwd: '/tmp',
    container: null,
    background: true,
    stop: async () => stopped++,
    write: (data) => writes.push(data)
  })
  native.append('already running\r\n')
  const id = '12345678-1234-4234-8234-123456789abc'
  const invoke = (channel, ...args) => h.handlers.get(channel)({ sender: h.owner }, ...args)
  try {
    await invoke(terminalIpcChannels.attachAgentSession, id, native.id)
    assert.equal(h.launches.length, 0, 'attaching must never launch another command')
    assert.deepEqual(structuredClone(h.sent[0]), [
      terminalIpcChannels.data,
      { sessionId: id, data: 'already running\r\n', replay: true }
    ])
    const write = h.events.get(terminalIpcChannels.write)
    write({ sender: { id: 2 } }, id, 'foreign input')
    write({ sender: h.owner }, id, 'status\r')
    assert.deepEqual(writes, ['status\r'])
    await h.handlers.get(terminalIpcChannels.closeSession)({ sender: { id: 2 } }, id)
    native.append('still attached')
    assert.equal(h.sent.at(-1)[1].data, 'still attached')
    assert.equal(h.sent.at(-1)[1].replay, undefined, 'Live output is not replayed')
    await invoke(terminalIpcChannels.closeSession, id)
    assert.equal(stopped, 0, 'unmounting or StrictMode cleanup only detaches')
    await invoke(terminalIpcChannels.stopAgentSession, native.id)
    assert.equal(stopped, 1)
  } finally {
    await h.dispose()
  }
})

test('expired attachment returns a normal result and replays saved completed output', async () => {
  let now = 0
  const h = harness(() => now)
  const native = h.agentSessions.register('finished', {
    providerId: 'claude',
    chatId: 'chat',
    chatTitle: 'Chat',
    command: 'npm test',
    cwd: '/tmp',
    container: null,
    background: true,
    stop: async () => {}
  })
  h.agentSessions.list()
  native.append('Saved command output\r\n')
  await native.finish(0)
  now = 121_000
  h.agentSessions.list()
  const attach = h.handlers.get(terminalIpcChannels.attachAgentSession)
  try {
    assert.equal((await attach({ sender: h.owner }, 'completed-view', native.id)).status, 'exited')
    assert.equal(h.sent[0][1].data, 'Saved command output\r\n')
    assert.equal(h.sent[0][1].replay, true)
    assert.equal(h.sent[1][1].exitCode, 0)
    assert.equal(
      (await attach({ sender: h.owner }, 'missing-view', 'missing')).status,
      'unavailable'
    )
    assert.equal(h.launches.length, 0)
  } finally {
    await h.dispose()
  }
})

for (const container of [null, { kind: 'container', tool: 'toolbox', name: 'fixture' }]) {
  const target = container ? 'the current container' : 'the host'
  for (const keepAlive of [false, true]) {
    test(`runs terminal actions in ${target}, keepAlive=${keepAlive}`, async () => {
      const h = harness()
      // A shell function records SSH arguments without connecting to any server.
      const command = `ssh() { printf '<%s>\\n' "$@"; }; ssh -t user@fixture 'printf "remote command"'`
      await h.create({ container, initialCommand: command, keepAliveOnCommandFinish: keepAlive })
      const launch = h.launches[0]
      assert.equal(launch.file, '/bin/sh')
      assert.equal(launch.options.cwd, '/tmp')
      assert.equal(launch.options.env.TERM, 'xterm-256color')
      assert.equal(launch.args.at(-2), '-c')
      assert.equal(launch.args.at(-1).split('\n')[0], command)
      if (keepAlive) {
        assert.ok(launch.args.includes('-i'))
        assert.match(launch.args.at(-1), /\nexec '\/bin\/sh' -i$/)
      } else {
        const output = execFileSync(launch.file, launch.args, {
          cwd: launch.options.cwd,
          env: launch.options.env,
          encoding: 'utf8'
        })
        assert.equal(output, '<-t>\n<user@fixture>\n<printf "remote command">\n')
      }
    })
  }
  test(`opens a plain shell in ${target} without an initial command`, async () => {
    const h = harness()
    await h.create({ container })
    assert.deepEqual(h.launches[0].args, [])
  })
}

test('done stops live chat shells, including hidden tabs, and preserves other chats', async () => {
  const h = harness()
  const id = '12345678-1234-4234-8234-123456789abc'
  const target = { kind: 'container', tool: 'toolbox', name: 'fixture' }
  try {
    await h.create({ sessionId: id, chatKey: 'codex:chat', container: target })
    await h.create({ sessionId: id.slice(0, -1) + 'd', chatKey: 'codex:chat-other' })
    await h.create({ sessionId: id.slice(0, -1) + 'e' })
    assert.equal(h.launches[0].options.env.SELE_CHAT_ID, 'chat')
    assert.equal(h.launches[0].options.env.SELE_TERMINAL_ID, id)
    await h.stopChats(['chat'])
    assert.equal(h.launches[0].pty.killed, true)
    assert.equal(h.launches[1].pty.killed, undefined)
    assert.equal(h.launches[2].pty.killed, undefined)
    assert.deepEqual(structuredClone(h.killed), [[[id], target]])
    assert.deepEqual(structuredClone(h.sent.at(-1)), [
      terminalIpcChannels.exit,
      { sessionId: id, exitCode: 130 }
    ])
  } finally {
    await h.dispose()
  }
})

for (const action of ['done', 'quit']) {
  test(`${action} discovers and stops shells from previous app instances without opening their tabs`, async () => {
    const first = harness()
    const id = '12345678-1234-4234-8234-123456789abc'
    const target = { kind: 'container', tool: 'toolbox', name: 'fixture' }
    await first.create({
      sessionId: id,
      chatKey: 'codex:chat',
      workspaceKey: 'workspace',
      container: target
    })
    await first.dispose({ preserve: true })
    const shell = first.persistent.get(id)
    assert.equal(shell.killed, undefined)
    const restarted = harness(Date.now, { persistent: first.persistent })
    if (action === 'done') await restarted.stopChats(['chat'])
    else await restarted.dispose()
    assert.equal(shell.killed, true)
    assert.equal(restarted.launches.length, 0, 'cleanup must never relaunch a command')
    assert.deepEqual(structuredClone(restarted.killed), [[[id], target]])
    if (action === 'done') await restarted.dispose()
  })
}

test('quitting waits for cleanup already started by a closed window', async () => {
  let finish
  const cleanup = new Promise((resolve) => {
    finish = resolve
  })
  const h = harness(Date.now, { cleanup: () => cleanup })
  await h.create({ workspaceKey: 'workspace' })
  h.ownerEvents.get('destroyed')()
  let finished = false
  const quit = h.dispose().then(() => {
    finished = true
  })
  await new Promise(setImmediate)
  assert.equal(finished, false)
  finish()
  await quit
  assert.equal(h.persistent.values().next().value.killed, true)
})

test('quitting drains shell creation already in flight and rejects subsequent launches', async () => {
  const h = harness()
  const starting = h.create({ workspaceKey: 'workspace' })
  const quitting = h.dispose()
  await assert.rejects(starting, /Terminal owner closed during startup/)
  await quitting
  assert.equal(h.persistent.values().next().value.killed, true)
  await assert.rejects(h.create({}), /Sele is shutting down/)
})

test('failed discovery still stops live terminals during quit and reports incomplete cleanup', async () => {
  const h = harness(Date.now, { discoveryError: new Error('profile unavailable') })
  await h.create({})
  await assert.rejects(h.dispose(), (error) => error.errors[0].message === 'profile unavailable')
  assert.equal(h.launches[0].pty.killed, true)
})

test('failed container cleanup still stops its PTY launcher and rejects close', async () => {
  const h = harness(Date.now, {
    cleanup: async () => {
      throw new Error('container offline')
    }
  })
  const session = await h.create({ workspaceKey: 'workspace' })
  await assert.rejects(
    h.handlers.get(terminalIpcChannels.closeSession)({ sender: h.owner }, session.id),
    (error) => error.errors[0].message === 'container offline'
  )
  assert.equal(h.persistent.get(session.id).killed, true)
  h.persistent.delete(session.id) // The stopped broker's endpoint no longer accepts connections.
  await h.dispose()
})

test('container terminal scripts explicitly export safely quoted ownership markers', () => {
  const env = { SELE_CHAT_ID: "chat'quoted", SELE_TERMINAL_ID: 'terminal', PATH: '/do-not-export' }
  const script = targetShell.getTargetTerminalScript({
    env,
    command: 'printf "%s\\n%s\\n" "$SELE_CHAT_ID" "$SELE_TERMINAL_ID"'
  })
  const output = execFileSync('/bin/sh', ['-c', script], {
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8'
  })
  assert.equal(output, "chat'quoted\nterminal\n")
  assert.equal(script.includes('/do-not-export'), false)
})

for (const code of ['ERR_PROCESS_RUNTIME_REJECTED', 'EBUSY']) {
  test(`${code} recovery uses backoff, logs once and keeps healthy sessions available`, async () => {
    let now = 0
    const first = harness()
    const good = await first.create({ workspaceKey: 'workspace', chatKey: 'codex:healthy' })
    await first.dispose({ preserve: true })
    const persistent = first.persistent
    const bad = '12345678-1234-4234-8234-123456789abd'
    persistent.set(
      bad,
      Object.assign(new Error('Process runtime rejected the connection.'), { code })
    )
    const h = harness(() => now, { persistent })
    const poll = () => h.handlers.get(terminalIpcChannels.listAgentSessions)()
    for (let i = 0; i < 100; i++) assert.equal((await poll()).length, 1)
    assert.equal(h.connections.filter((id) => id === bad).length, 1)
    assert.equal(h.logs.length, 1)
    now = 999
    await poll()
    assert.equal(h.connections.filter((id) => id === bad).length, 1)
    now = 1000
    await poll()
    assert.equal(h.connections.filter((id) => id === bad).length, 2)
    for (let i = 0; i < 100; i++) await poll()
    assert.equal(h.logs.length, 1)
    assert.equal(h.connections.filter((id) => id === bad).length, 2)
    const recovered = {
      ...persistent.get(good.id),
      metadata: {
        ...persistent.get(good.id).metadata,
        sessionId: bad,
        chatKey: 'codex:recovered'
      }
    }
    persistent.set(bad, recovered)
    now = 3000
    assert.equal((await poll()).length, 2)
    assert.equal(h.connections.filter((id) => id === bad).length, 3)
    assert.equal(h.logs.length, 1)
    assert.equal(h.launches.length, 0, 'discovery must never replay a terminal command')
    await h.dispose()
  })
}

test('stale authentication endpoints expire quietly without blocking healthy terminal recovery', async () => {
  const first = harness()
  await first.create({ workspaceKey: 'workspace', chatKey: 'codex:healthy' })
  await first.dispose({ preserve: true })
  first.persistent.set(
    'stale',
    Object.assign(new Error('Authentication rejected'), { code: 'ESTALE' })
  )
  const h = harness(Date.now, { persistent: first.persistent })
  for (let i = 0; i < 100; i++)
    assert.equal((await h.handlers.get(terminalIpcChannels.listAgentSessions)()).length, 1)
  assert.equal(h.connections.filter((id) => id === 'stale').length, 1)
  assert.equal(h.logs.length, 0)
  await h.dispose()
})

test('discovery failures are throttled during listing but explicit cleanup still reports failure', async () => {
  const h = harness(() => 0, { discoveryError: new Error('profile unavailable') })
  for (let i = 0; i < 100; i++)
    assert.equal((await h.handlers.get(terminalIpcChannels.listAgentSessions)()).length, 0)
  assert.equal(h.discoveries, 1)
  assert.equal(h.logs.length, 1)
  await assert.rejects(h.dispose(), (error) => error.errors[0].message === 'profile unavailable')
})
