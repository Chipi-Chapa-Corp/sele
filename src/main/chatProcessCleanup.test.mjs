import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { copilotProcessHooks } from './chatProcessOwnership.ts'
import { createChatProcessCleanup } from './providers/ChatProcessCleanup.ts'
import { getContainerTargetKey } from './containerTarget.ts'

const run = promisify(execFile)
const source = await readFile(new URL('./chatProcessCleanup.py', import.meta.url), 'utf8')
const alive = async (pid) => {
  try {
    const fields = (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ')
    return fields[0] !== 'Z'
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

test('done cleanup kills detached tagged processes and untagged children, preserving other chats', {
  skip: process.platform !== 'linux'
}, async (t) => {
  const chat = randomUUID()
  const children = []
  const start = async (script, env) => {
    const child = spawn('python3', ['-u', '-c', script], {
      env: { ...process.env, ...env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    children.push(child)
    let output = ''
    for await (const data of child.stdout) {
      output += data
      if (output.includes('\n')) return Number(output.trim())
    }
    throw new Error('Fixture did not start')
  }
  t.after(() => {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  })
  const tree = await start(
    `
import os,signal,subprocess,time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child = subprocess.Popen(['sleep','60'], env={})
print(child.pid, flush=True)
time.sleep(60)
`,
    { SELE_CHAT_ID: chat }
  )
  const ownedParent = children.at(-1).pid
  const detached = await start(
    `
import os,time
if os.fork(): os._exit(0)
os.setsid()
print(os.getpid(), flush=True)
time.sleep(60)
`,
    { CODEX_THREAD_ID: chat }
  )
  t.after(() => {
    try {
      process.kill(detached, 'SIGKILL')
    } catch {}
  })
  const other = await start('import os,time; print(os.getpid(),flush=True); time.sleep(60)', {
    SELE_CHAT_ID: chat + '-other',
    CODEX_THREAD_ID: 'another-chat'
  })
  await run('python3', ['-c', source, JSON.stringify([chat])], {
    timeout: 10_000,
    env: { ...process.env, SELE_CHAT_ID: chat }
  })
  assert.equal(await alive(ownedParent), false, 'SIGTERM-resistant owner is force-killed')
  assert.equal(await alive(tree), false, 'children with cleared environments are included')
  assert.equal(await alive(detached), false, 'reparented Codex processes are rediscovered')
  assert.equal(await alive(other), true, 'chat ownership uses exact equality')
  // Repeating done after a restart, with no retained process handles, is harmless.
  await run('python3', ['-c', source, JSON.stringify([chat])])
})

test('Copilot tags original shell commands without changing other tool arguments or permissions', async () => {
  const hook = copilotProcessHooks("chat'quoted").onPreToolUse
  const result = await hook({
    toolName: 'bash',
    toolArgs: { command: 'printf %s "$SELE_CHAT_ID"', timeout: 5 }
  })
  assert.equal(result.modifiedArgs.timeout, 5)
  assert.equal(result.permissionDecision, undefined)
  assert.equal((await run('sh', ['-c', result.modifiedArgs.command])).stdout, "chat'quoted")
  assert.equal(await hook({ toolName: 'read_file', toolArgs: { command: 'unchanged' } }), undefined)
})

test('bulk cleanup pauses providers, stops even hidden terminals, then kills in each saved target', async () => {
  const events = []
  const remote = { kind: 'container', tool: 'ssh', name: 'fixture' }
  const cleanup = createChatProcessCleanup({
    adapters: {
      codex: {
        stopChatProcesses: async (id) => {
          events.push(['pause', id])
          return [id + '-child']
        }
      }
    },
    metadata: async (id) => ({ container: id === 'remote' ? remote : null }),
    stopTerminals: async (ids) => events.push(['terminals', ids]),
    killProcesses: async (ids, target) => events.push(['kill', ids, target])
  })
  await cleanup(['local', 'local', 'remote'])
  assert.deepEqual(events, [
    ['pause', 'local'],
    ['pause', 'remote'],
    ['terminals', ['local', 'local-child']],
    ['kill', ['local', 'local-child'], null],
    ['terminals', ['remote', 'remote-child']],
    ['kill', ['remote', 'remote-child'], remote]
  ])
})

test('a provider cancellation error still attempts orphan cleanup and prevents a false success', async () => {
  let killed = false
  const cleanup = createChatProcessCleanup({
    adapters: {
      codex: {
        stopChatProcesses: async () => {
          throw new Error('offline')
        }
      }
    },
    metadata: async () => ({ container: null }),
    stopTerminals: async () => {
      throw new Error('terminal unavailable')
    },
    killProcesses: async () => {
      killed = true
    }
  })
  await assert.rejects(cleanup(['chat'], 'codex'), (error) => error.errors.length === 2)
  assert.equal(killed, true)
})

test('a PID reused between discovery and signalling is never killed', async () => {
  await run('python3', [
    '-c',
    `
import os,tempfile
from pathlib import Path as RealPath
namespace = {'__name__': 'fixture'}
exec(${JSON.stringify(source)}, namespace)
with tempfile.TemporaryDirectory() as directory:
    root = RealPath(directory)
    (root/'self').mkdir()
    (root/'self'/'stat').touch()
    (root/'123').mkdir()
    stat = root/'123'/'stat'
    def record(start):
        stat.write_text('123 (fixture) ' + ' '.join(['S','1'] + ['0']*17 + [str(start)]))
    record(100)
    (root/'123'/'environ').write_bytes(b'SELE_CHAT_ID=fixture\\0')
    class FakePath(type(RealPath())):
        def read_bytes(self):
            value = super().read_bytes()
            record(200)  # Same PID now belongs to a different process.
            (root/'123'/'environ').write_bytes(b'SELE_CHAT_ID=another-chat\\0')
            return value
    def path(value):
        if value == '/proc': return FakePath(root)
        if value.startswith('/proc/'): return FakePath(root/value[6:])
        return FakePath(value)
    namespace['Path'] = path
    signals = []
    namespace['os'].kill = lambda pid,sig: signals.append(pid)
    namespace['cleanup'](['fixture'], grace=0)
    assert not signals, signals
`
  ])
})

test('single and bulk done wait for cleanup; undo and failed cleanup cannot kill or save done', async () => {
  const service = await readFile(new URL('./providers/providerService.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('providerService.ts', service, ts.ScriptTarget.Latest, true)
  const api = ast.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((node) => node.name.getText(ast) === 'providerApi').initializer
  const events = []
  let fail = false
  const globals = {
    cleanupChatProcesses: async (...args) => {
      events.push(['cleanup', ...args])
      if (fail) throw new Error('busy')
    },
    setChatDone: async (...args) => events.push(['save', ...args]),
    setChatsDone: async (...args) => events.push(['save-many', ...args])
  }
  const methods = Object.fromEntries(
    ['markChatDone', 'markChatsDone'].map((name) => {
      const method = api.properties.find((node) => node.name.getText(ast) === name)
      return [
        name,
        vm.runInNewContext(
          ts.transpile(`(${method.initializer.getText(ast)})`, { target: ts.ScriptTarget.ES2022 }),
          globals
        )
      ]
    })
  )
  await methods.markChatDone('codex', 'one')
  await methods.markChatDone('codex', 'one', false)
  await methods.markChatsDone(['one', 'two'])
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [
    ['cleanup', ['one'], 'codex'],
    ['save', 'one', true],
    ['save', 'one', false],
    ['cleanup', ['one', 'two']],
    ['save-many', ['one', 'two'], true]
  ])
  events.length = 0
  fail = true
  await assert.rejects(methods.markChatDone('codex', 'one'), /busy/)
  assert.equal(events.length, 1)
})

test('Codex done finds persisted descendants and background jobs without launching an idle runtime', async () => {
  const file = await readFile(
    new URL('./providers/codex/CodexProviderAdapter.ts', import.meta.url),
    'utf8'
  )
  const ast = ts.createSourceFile('adapter.ts', file, ts.ScriptTarget.Latest, true)
  const adapter = ast.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === 'CodexProviderAdapter'
  )
  const method = adapter.members.find((node) => node.name?.getText(ast) === 'stopChatProcesses')
  const fixture = vm.runInNewContext(
    ts.transpile(`class Fixture { ${method.getText(ast)} }; new Fixture()`, {
      target: ts.ScriptTarget.ES2022
    }),
    { getContainerTargetKey, Set }
  )
  const calls = []
  const client = {
    connectionIdentity: {},
    request: async (name, args) => {
      calls.push([name, args.ancestorThreadId])
      return { data: [{ id: 'child' }], nextCursor: null }
    },
    ownsThread: (id) => id === 'child'
  }
  Object.assign(fixture, {
    runWithContainer: (_target, callback) => callback(),
    getThreadContainer: () => null,
    clients: new Map(),
    threads: new Map(),
    activeTurnIds: new Map([['root', 'turn']]),
    pendingTurnIds: new Map(),
    pendingTurnStarts: new Map(),
    queuedTurnsByThread: new Map(),
    completionCoordinator: { cancel: (id) => calls.push(['cancel-continuation', id]) },
    stopActiveTurn: async (id) => calls.push(['stop', id]),
    cancelSubagentInContext: async (_root, id) => calls.push(['stop-child', id]),
    getChatTerminalTasks: async (id) => calls.push(['discover-terminals', id])
  })
  assert.deepEqual(Array.from(await fixture.stopChatProcesses('root')), [])
  assert.deepEqual(calls, [])
  fixture.clients.set(getContainerTargetKey(null), client)
  assert.deepEqual(Array.from(await fixture.stopChatProcesses('root')), ['root', 'child'])
  assert.deepEqual(calls, [
    ['thread/list', 'root'],
    ['cancel-continuation', 'root'],
    ['stop', 'root'],
    ['discover-terminals', 'root'],
    ['cancel-continuation', 'child'],
    ['stop-child', 'child'],
    ['discover-terminals', 'child']
  ])
})
