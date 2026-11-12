import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as expectedAbsence from '../shared/expectedAbsence.ts'
import * as containerTarget from './containerTarget.ts'
import * as optionalProbe from './optionalProbe.ts'
import * as targetShell from './targetShell.ts'
import * as windowsExecutableCommand from './windowsExecutableCommand.ts'
import { ProviderProcessStore, executionEnvironmentProbeSource } from './ProviderProcessStore.ts'
import { providerProcessContext } from './providerProcessContext.ts'

const require = createRequire(import.meta.url)
const load = (file, dependencies) => {
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    process,
    console,
    setTimeout,
    clearTimeout,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      assert.ok(name.startsWith('node:'), `Unexpected test dependency: ${name}`)
      return require(name)
    }
  })
  return module.exports
}

// Opt-in CLI integration: use an existing container and harmless Python fixtures.
// Exercise real transports and systemd, without launching a GUI or provider/account.
test('production provider launches stay inside a real container that shares the host user manager', {
  skip: process.platform !== 'linux' || !process.env.SELE_TEST_PROVIDER_CONTAINER,
  timeout: 90000
}, async (t) => {
  const directory = await mkdtemp(join(homedir(), '.sele-environment-test-'))
  const scopes = []
  let store
  t.after(async () => {
    try {
      for (const scope of scopes) if (!scope.record.unavailable) await store.stop(scope.record.id)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  const currentContainer = load('./currentContainer.ts', {
    './containerTarget': containerTarget,
    '../shared/expectedAbsence.ts': expectedAbsence
  })
  const host = load('./hostProcess.ts', {
    // Keep executable lookup on PATH; do not open the user's interactive shell.
    './pty': { isPtyShutdown: () => true },
    './currentContainer': currentContainer,
    './database/sshEnvironments': {},
    './sshCommand': {},
    './targetShell': targetShell,
    './windowsExecutableCommand': windowsExecutableCommand,
    './optionalProbe': optionalProbe,
    '../shared/expectedAbsence.ts': expectedAbsence
  })
  const providers = load('./providerProcesses.ts', {
    electron: { app: { getPath: () => directory } },
    './ProviderProcessStore': { ProviderProcessStore },
    './hostProcess': host,
    './providerProcessContext': { providerProcessContext }
  })
  const run = promisify(execFile)
  const execute = async (file, args, container) => {
    const command = await host.getHostCommand(file, args, { container })
    try {
      return (
        await run(command.file, command.args, {
          env: command.env,
          cwd: command.cwd,
          timeout: 15000
        })
      ).stdout
    } catch (error) {
      if (
        file === 'systemctl' &&
        args.includes('show') &&
        /^LoadState=not-found$/m.test(error.stdout ?? '')
      )
        return error.stdout
      throw error
    }
  }
  const container = {
    kind: 'container',
    tool: 'distrobox',
    name: process.env.SELE_TEST_PROVIDER_CONTAINER
  }
  const identity = JSON.parse(
    await execute('python3', ['-c', executionEnvironmentProbeSource], container)
  )
  const managerIdentity = JSON.parse(
    await execute(
      'systemd-run',
      [
        '--user',
        '--pipe',
        '--wait',
        '--collect',
        '--quiet',
        '--',
        'python3',
        '-c',
        executionEnvironmentProbeSource
      ],
      container
    )
  )
  assert.notDeepEqual(identity, managerIdentity, 'fixture must reproduce the foreign user manager')
  const input = '{"id":1,"method":"initialize"}\n{"method":"initialized"}\n'
  const argument = 'literal $() quotes\'"\nsecond line'
  const fixture = `import json, os, sys
root = os.stat('/')
print(json.dumps(dict(
    identity=[os.stat('/proc/self/ns/' + name).st_ino for name in ('mnt', 'pid', 'user')] + [root.st_dev, root.st_ino],
    input=sys.stdin.read(), argument=sys.argv[1], cwd=os.getcwd(), value=os.environ['SELE_FIXTURE_VALUE']
)))
`
  store = providers.getProviderProcessStore()
  for (const provider of ['codex', 'claude', 'copilot', 'opencode-v2']) {
    const scope = await store.create(provider, null, container)
    scopes.push(scope)
    await scope.bind(`fixture-${provider}`)
    const options = {
      container: { kind: 'host' },
      cwd: directory,
      env: { ...process.env, SELE_FIXTURE_VALUE: 'preserved' }
    }
    const sdk = provider === 'claude' || provider === 'copilot'
    const command = await providerProcessContext.run(scope, () =>
      sdk
        ? providers.getProviderHostExecutableCommand('python3', ['-c', fixture], options)
        : providers.getProviderHostCommand('python3', ['-c', fixture, argument], options)
    )
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command.file, [...command.args, ...(sdk ? [argument] : [])], {
        cwd: command.cwd,
        env: command.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000
      })
      let stdout = '',
        stderr = ''
      child.stdout.on('data', (data) => {
        stdout += data
      })
      child.stderr.on('data', (data) => {
        stderr += data
      })
      child.on('error', reject)
      child.on('close', (code, signal) => {
        if (code !== 0)
          return reject(new Error(`Fixture ${provider} exited ${code}/${signal}: ${stderr}`))
        try {
          resolve(JSON.parse(stdout))
        } catch (error) {
          reject(error)
        }
      })
      child.stdin.on('error', reject)
      child.stdin.end(input)
    })
    assert.deepEqual(
      result,
      {
        identity,
        input,
        argument,
        cwd: directory,
        value: 'preserved'
      },
      provider
    )
    assert.match(scope.record.unavailable, /outside the selected environment/)
    assert.deepEqual(scope.record.units, [])
    t.diagnostic(
      `${provider}: confirmed container namespaces, root, stdin, arguments, cwd and environment`
    )
  }

  // A manager in the right environment must still provide tracked execution.
  const hostScope = await store.create('claude', null, null)
  scopes.push(hostScope)
  const command = await providerProcessContext.run(hostScope, () =>
    providers.getProviderHostCommand('python3', ['-c', executionEnvironmentProbeSource], {
      env: process.env
    })
  )
  assert.equal(hostScope.record.unavailable, null)
  const result = await run(command.file, command.args, { env: command.env, timeout: 15000 })
  assert.deepEqual(JSON.parse(result.stdout), managerIdentity)
})
