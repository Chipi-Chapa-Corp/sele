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

const require = createRequire(import.meta.url)
const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
const terminalSource = compile('./registerTerminalIpc.ts')
const hostSource = compile('./hostProcess.ts')

const load = (source, mocks) => {
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
    setImmediate
  }
  vm.runInNewContext(source, context)
  return context.exports
}

const harness = () => {
  const handlers = new Map()
  const launches = []
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
  const terminal = load(terminalSource, {
    electron: { app: { getPath: () => '/tmp' }, ipcMain: { on: () => {} } },
    'node:os': { userInfo: () => ({ shell: '/bin/sh' }) },
    './pty': {
      spawnPty: (file, args, options) => {
        launches.push({ file, args: Array.from(args), options })
        return { pid: 123, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) }
      }
    },
    './logging': { handleLoggedIpc: (channel, handler) => handlers.set(channel, handler) },
    '../shared/terminal': { terminalIpcChannels },
    './containerTarget': { requireContainerTarget },
    './hostProcess': host
  })
  terminal.registerTerminalIpc()
  const owner = { id: 1, once() {} }
  return {
    launches,
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
