import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as path from 'node:path'

const code = ts.transpile(
  readFileSync(new URL('./OpenCodeInstallations.ts', import.meta.url), 'utf8'),
  { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
)
function fixture() {
  const env = { PATH: '/first:/second' }
  const versions = {
    opencode: '1.19.5',
    '/first/opencode': '1.19.5',
    '/second/opencode': 'opencode v2.2.0'
  }
  const commands = []
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    process: { env, platform: 'linux' },
    Date,
    console,
    require: (name) => {
      if (name === 'node:path') return path
      if (name === 'node:os') return { homedir: () => '/home/fixture' }
      if (name.includes('hostProcess'))
        return {
          getHostCommand: async (file, args, options) => {
            commands.push({ file, args, options })
            return { file, args, env: options.env }
          }
        }
      if (name.includes('containerTarget'))
        return { getContainerTargetKey: (container) => container?.name ?? 'host' }
      if (name.includes('OpenCodeExecutable'))
        return { getOpenCodeExecutable: () => env.SELE_OPENCODE_PATH ?? 'opencode' }
      if (name === 'node:child_process')
        return {
          execFile: (file, _args, _options, callback) => {
            queueMicrotask(() =>
              file === 'sh'
                ? callback(null, '/first/opencode\n/second/opencode\n')
                : versions[file]
                  ? callback(null, versions[file])
                  : callback(Error('missing'), '')
            )
            return { stdin: { end() {} } }
          }
        }
      throw Error(name)
    }
  })
  return { ...exports, env, versions, commands }
}

test('ignores v1 even when it shadows the v2 executable on PATH', async () => {
  const f = fixture()
  const installations = await f.getOpenCodeInstallations()
  assert.deepEqual(
    Array.from(installations, (x) => x.major),
    [2]
  )
  assert.equal((await f.resolveOpenCodeInstallation(null)).executable, '/second/opencode')
  assert.ok(
    f.commands.every(
      (command) =>
        command.file === 'sh' || (command.args.length === 1 && command.args[0] === '--version')
    ),
    'discovery only performs version probes'
  )
})

test('explicit executables win for their major and installation changes invalidate the cache', async () => {
  const f = fixture()
  f.env.SELE_OPENCODE_V2_PATH = '/chosen/opencode'
  f.versions['/chosen/opencode'] = '2.1.4'
  assert.equal((await f.resolveOpenCodeInstallation(null)).executable, '/chosen/opencode')
  f.versions['/chosen/opencode'] = '2.2.0'
  assert.equal((await f.resolveOpenCodeInstallation(null)).version, '2.1.4')
  f.clearOpenCodeInstallationCache()
  assert.equal((await f.resolveOpenCodeInstallation(null)).version, '2.2.0')
})

test('inventory and version probes stay in the selected source', async () => {
  const f = fixture()
  const container = { kind: 'container', tool: 'toolbox', name: 'fixture' }
  await f.getOpenCodeInstallations(container)
  assert.ok(f.commands.every((command) => command.options.container === container))
  delete f.versions['/second/opencode']
  f.clearOpenCodeInstallationCache()
  await assert.rejects(f.resolveOpenCodeInstallation(container), /OpenCode 2 is required/)
})

test('a v1-only source does not expose an OpenCode provider', async () => {
  const f = fixture()
  delete f.versions['/second/opencode']
  assert.equal((await f.getOpenCodeInstallations()).length, 0)
  await assert.rejects(f.resolveOpenCodeInstallation(), /OpenCode 2 is required/)
})
