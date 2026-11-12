import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { providerProcessContext } from './providerProcessContext.ts'

const require = createRequire(import.meta.url)
const source = ts.transpileModule(
  readFileSync(new URL('./providerProcesses.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

const setup = () => {
  const calls = []
  const command = (method) => async (file, args, options) => {
    calls.push({ method, file, args, options })
    return { file, args, env: options.env }
  }
  const dependencies = {
    electron: { app: { getPath: () => '/fixture' } },
    './ProviderProcessStore': {},
    './providerProcessContext': { providerProcessContext },
    './hostProcess': {
      getHostCommand: command('launch'),
      getHostExecutableCommand: command('executable'),
      resolveHostExecutable: async (file, options) => {
        calls.push({ method: 'resolve', file, options })
        return { file: '/container/bin/provider', env: { PATH: '/container/bin' } }
      }
    }
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name) => dependencies[name] ?? require(name)
  })
  const scope = (container) => ({
    record: { container },
    prepare: async (file, args, options) => {
      calls.push({ method: 'prepare', file, args, options })
      return { file, args }
    }
  })
  return { ...module.exports, calls, scope }
}

const dev = { kind: 'container', tool: 'distrobox', name: 'dev' }
const host = { kind: 'host' }

test('a chat provider launches in its saved environment even when its caller supplies host', async () => {
  const h = setup()
  await providerProcessContext.run(h.scope(dev), () =>
    h.getProviderHostCommand('codex', ['app-server'], { container: host })
  )
  assert.deepEqual(
    h.calls.map((call) => call.method),
    ['prepare', 'launch']
  )
  for (const call of h.calls) assert.equal(call.options.container, dev)
})

test('provider executable lookup and launch use the same saved container', async () => {
  const h = setup()
  await providerProcessContext.run(h.scope(dev), () =>
    h.getProviderHostExecutableCommand('claude', ['--version'], { container: host })
  )
  assert.deepEqual(
    h.calls.map((call) => call.method),
    ['resolve', 'prepare', 'launch']
  )
  for (const call of h.calls) assert.equal(call.options.container, dev)
  assert.equal(h.calls.at(-1).file, '/container/bin/provider')
  assert.equal(h.calls.at(-1).options.env.PATH, '/container/bin')
})

test('saved host chats and operations without chat ownership retain their explicit targets', async () => {
  const h = setup()
  await providerProcessContext.run(h.scope(null), () =>
    h.getProviderHostCommand('codex', [], { container: dev })
  )
  assert.equal(h.calls.at(-1).options.container, null)
  await h.getProviderHostCommand('codex', [], { container: dev })
  assert.equal(h.calls.at(-1).options.container, dev)
  await h.getProviderHostExecutableCommand('codex', [], { container: dev })
  assert.equal(h.calls.at(-1).method, 'executable')
  assert.equal(h.calls.at(-1).options.container, dev)
})
