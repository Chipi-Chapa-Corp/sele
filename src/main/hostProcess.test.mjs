import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as expectedAbsence from '../shared/expectedAbsence.ts'
import * as targetShell from './targetShell.ts'

const require = createRequire(import.meta.url)
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
const ptySource = compile('./pty.ts')
const hostSource = compile('./hostProcess.ts')

const harness = ({ flatpak = false, spawnError } = {}) => {
  const logs = []
  const launches = []
  const shellExecs = []
  const env = {
    PATH: '/fixture/bin',
    SHELL: '/bin/bash',
    ...(flatpak ? { FLATPAK_ID: 'test' } : {})
  }
  const load = (source, mocks) => {
    const context = {
      exports: {},
      require: (name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name]
        assert.ok(name.startsWith('node:'), `Unexpected dependency: ${name}`)
        return require(name)
      },
      process: { platform: 'linux', env },
      console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
      setTimeout,
      clearTimeout,
      setImmediate
    }
    vm.runInNewContext(source, context)
    return context.exports
  }
  let onStarted
  const started = new Promise((resolve) => {
    onStarted = resolve
  })
  const pty = load(ptySource, {
    '@lydell/node-pty': {
      spawn: (file, args) => {
        if (spawnError) throw spawnError
        const exitListeners = new Set()
        const dataListeners = new Set()
        const terminal = {
          onExit: (listener) => {
            exitListeners.add(listener)
            return { dispose: () => exitListeners.delete(listener) }
          },
          onData: (listener) => {
            dataListeners.add(listener)
            return { dispose: () => dataListeners.delete(listener) }
          },
          finish: (exitCode, output = '') => {
            for (const listener of dataListeners) listener(output)
            for (const listener of exitListeners) listener({ exitCode, signal: 15 })
          },
          kill: () => queueMicrotask(() => terminal.finish(143))
        }
        launches.push({ file, args, terminal })
        onStarted()
        return terminal
      }
    }
  })
  const host = load(hostSource, {
    './pty': pty,
    'node:child_process': {
      execFile: (file, args, _options, callback) => {
        if (file === 'flatpak-spawn' && args.at(-1) === '-0') {
          callback(null, `PATH=${env.PATH}\0SHELL=${env.SHELL}\0`)
          return
        }
        shellExecs.push({ file, args })
        callback(null, '', '')
      }
    },
    'node:os': { homedir: () => '/fixture', userInfo: () => ({ shell: '/bin/bash' }) },
    './currentContainer': { getCurrentContainerHostBridge: async () => null },
    './database/sshEnvironments': {},
    './sshCommand': {},
    './targetShell': targetShell,
    './windowsExecutableCommand': { normalizeWindowsExecutableCommand: (command) => command },
    './optionalProbe': {
      isExecutableFile: async (file) =>
        ['/bin/bash', '/fixture/bin/tool', '/custom/tool'].includes(file),
      isExpectedShellCandidateAbsence: expectedAbsence.isExpectedFileAbsenceError
    },
    '../shared/expectedAbsence.ts': expectedAbsence
  })
  const lookup = () => host.getHostCommand('tool', [])
  const settleLookup = (pending) =>
    flatpak
      ? assert.rejects(pending, { code: 'ENOENT' })
      : pending.then((command) => assert.equal(command.file, '/fixture/bin/tool'))
  return { pty, logs, launches, shellExecs, started, lookup, settleLookup }
}

for (const flatpak of [false, true]) {
  const target = flatpak ? 'Flatpak host' : 'local'
  test(`${target} shell lookup skips probes if shutdown begins before spawning`, async () => {
    const h = harness({ flatpak })
    const pending = h.settleLookup(h.lookup())
    await h.pty.stopPtys()
    await pending
    assert.equal(h.launches.length, 0)
    assert.equal(h.shellExecs.length, 0)
    assert.deepEqual(h.logs, [])
  })

  test(`${target} shell lookup stops retrying when shutdown kills its PTY`, async () => {
    const h = harness({ flatpak })
    const pending = h.settleLookup(h.lookup())
    await h.started
    await h.pty.stopPtys()
    await pending
    assert.equal(h.launches.length, 1)
    assert.equal(h.shellExecs.length, 0)
    assert.deepEqual(h.logs, [])
    assert.throws(() => h.pty.spawnPty('/bin/bash', []), /Sele is shutting down/)
  })
}

test('shell lookup still reports an unsuccessful PTY exit outside shutdown', async () => {
  const h = harness()
  const pending = h.lookup()
  await h.started
  h.launches[0].terminal.finish(1)
  await pending
  assert.equal(h.shellExecs.length, 1)
  assert.equal(h.logs.length, 1)
  assert.match(h.logs[0][0], /Shell lookup exited unsuccessfully/)
})

test('shell lookup still reports unexpected spawn failures outside shutdown', async () => {
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  const h = harness({ spawnError: error })
  await h.lookup()
  assert.equal(h.logs.length, 1)
  assert.equal(h.logs[0][1], error)
})

test('shell lookup still resolves executables from the interactive shell', async () => {
  const h = harness()
  const pending = h.lookup()
  await h.started
  h.launches[0].terminal.finish(0, 'FOUND=/custom/tool\nPATH=/custom:/fixture/bin\n')
  const command = await pending
  assert.equal(command.file, '/custom/tool')
  assert.equal(command.env.PATH, '/custom:/fixture/bin')
  assert.equal(h.shellExecs.length, 0)
  assert.deepEqual(h.logs, [])
})
