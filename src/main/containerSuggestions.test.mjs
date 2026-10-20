import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as expectedAbsence from '../shared/expectedAbsence.ts'
import { getRemoteContainerDiscoveryScript } from './remoteContainerDiscovery.ts'
import * as remoteDiscovery from './remoteContainerDiscovery.ts'

const source = ts.transpileModule(
  readFileSync(new URL('./containerSuggestions.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

const fixture = (name, labels = {}, state = 'running', id = 'a'.repeat(64)) => ({
  Id: id,
  Names: [name],
  Image: 'registry.example/image:latest',
  State: state,
  Status: state === 'running' ? 'Up 5 minutes' : 'Exited (0) 1 hour ago',
  Labels: labels
})

const podmanRows = [
  fixture('dev', { manager: 'distrobox', 'com.github.containers.toolbox': 'true' }),
  fixture('work', { 'com.github.containers.toolbox': 'true' }, 'exited', 'b'.repeat(64)),
  fixture('legacy', { 'com.github.debarshiray.toolbox': 'true' }, 'running', 'c'.repeat(64)),
  fixture('mongo', {}, 'running', 'd'.repeat(64)),
  fixture('stopped-generic', {}, 'exited', 'e'.repeat(64)),
  fixture('stopped-distrobox', { manager: 'distrobox' }, 'exited', 'f'.repeat(64))
]
const distroboxTable =
  'ID | NAME | STATUS | IMAGE\naaaaaaaaaaaa | dev | Up 5 minutes | dev:latest\n'
const dockerTable = '123456abcdef\tdocker-mongo\tmongo:7\tUp 1 minute'

const harness = ({ current = null, podmanOutput = JSON.stringify(podmanRows) } = {}) => {
  const commands = []
  const logs = []
  const dependencies = {
    'node:child_process': {
      execFile: (file, args, _options, callback) => {
        commands.push({ file, args })
        assert.notEqual(file, 'toolbox', 'Discovery must never invoke Toolbx')
        const outputs = { distrobox: distroboxTable, podman: podmanOutput, docker: dockerTable }
        const output =
          file === 'sh'
            ? ['distrobox', 'podman', 'docker']
                .map((tool) => `__SELE_REMOTE_CONTAINER_OUTPUT__:${tool}\n${outputs[tool]}`)
                .join('\n')
            : outputs[file]
        assert.equal(typeof output, 'string', `Unexpected command: ${file}`)
        queueMicrotask(() => callback(null, output, ''))
        return { stdin: { end() {} } }
      }
    },
    '../shared/expectedAbsence.ts': expectedAbsence,
    './currentContainer': { getCurrentContainerTarget: async () => current },
    './hostProcess': { getHostCommand: async (file, args) => ({ file, args }) },
    './remoteContainerDiscovery': remoteDiscovery,
    './processFailure': { getProcessFailureMessage: (error) => String(error) }
  }
  const context = {
    exports: {},
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { platform: 'linux' },
    console: { error: (...args) => logs.push(args) }
  }
  vm.runInNewContext(source, context)
  return { ...context.exports, commands, logs }
}

for (const remote of [false, true]) {
  test(`${remote ? 'SSH' : 'local'} discovery preserves wrapper sources without running Toolbx`, async () => {
    const h = harness()
    const options = remote ? { container: { kind: 'container', tool: 'ssh', name: 'server' } } : {}
    const suggestions = JSON.parse(JSON.stringify(await h.getContainerSuggestions(options)))
    assert.deepEqual(
      suggestions.map(({ id }) => id).sort(),
      [
        'distrobox:dev',
        'distrobox:stopped-distrobox',
        'docker:docker-mongo',
        'podman:mongo',
        'toolbox:legacy',
        'toolbox:work'
      ].sort()
    )
    assert.match(suggestions.find(({ id }) => id === 'toolbox:work').description, /Toolbox.*Exited/)
    assert.equal(suggestions.find(({ name }) => name === 'dev').tool, 'distrobox')
    assert.deepEqual(h.logs, [])
    if (!remote) {
      assert.deepEqual(Array.from(h.commands.find(({ file }) => file === 'podman').args), [
        'ps',
        '--all',
        '--format',
        'json'
      ])
    }
  })
}

test('discovered Toolbx targets retain their saved identity and current marker', async () => {
  const h = harness({ current: { kind: 'container', tool: 'toolbox', name: 'legacy' } })
  const suggestions = await h.getContainerSuggestions()
  assert.equal(suggestions.filter(({ name }) => name === 'legacy').length, 1)
  const selected = suggestions.find(({ id }) => id === 'toolbox:legacy')
  assert.equal(selected.current, true)
  assert.equal(selected.tool, 'toolbox')
})

test('malformed Podman output does not hide containers from other runtimes', async () => {
  const h = harness({ podmanOutput: 'not json' })
  const suggestions = await h.getContainerSuggestions()
  assert.ok(suggestions.some(({ id }) => id === 'distrobox:dev'))
  assert.ok(suggestions.some(({ id }) => id === 'docker:docker-mongo'))
  assert.equal(h.logs.length, 1)
})

test('SSH discovery script reads Podman JSON and never invokes Toolbx', () => {
  const script = getRemoteContainerDiscoveryScript()
  assert.doesNotMatch(script, /\btoolbox\b|\bmigrate\b/)
  assert.match(script, /podman ps --all --format json/)
})

test('SSH shell output round-trips metadata without touching real runtimes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sele-discovery-'))
  const outputs = {
    distrobox: distroboxTable,
    podman: JSON.stringify(podmanRows),
    docker: dockerTable
  }
  try {
    for (const [tool, output] of Object.entries(outputs)) {
      const quoted = `'${output.replaceAll("'", "'\\''")}'`
      writeFileSync(join(directory, tool), `#!/bin/sh\nprintf '%s\\n' ${quoted}\n`, { mode: 0o700 })
    }
    const output = execFileSync('/bin/sh', ['-c', getRemoteContainerDiscoveryScript()], {
      encoding: 'utf8',
      env: { PATH: directory }
    })
    assert.deepEqual(remoteDiscovery.parseRemoteContainerDiscoveryOutput(output), {
      distrobox: distroboxTable.trimEnd(),
      podman: outputs.podman,
      docker: dockerTable
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
