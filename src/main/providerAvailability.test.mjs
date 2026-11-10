import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { isExpectedCommandAbsenceError } from '../shared/expectedAbsence.ts'
import { availabilityFoundMarker, getContainerCommandAvailabilityScript } from './optionalProbe.ts'

const source = ts.createSourceFile(
  'providerAvailability.ts',
  readFileSync(new URL('./providerAvailability.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const code = ts.transpile(
  source.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(source).replace(/^export /, ''))
    .join('\n') + '\n;({ isProviderAvailableInSource, getSourceAvailability })',
  { target: ts.ScriptTarget.ES2022 }
)

const fixture = ({ resolveError, stdout = '', executeError = null } = {}) => {
  const commands = []
  const warnings = []
  const api = vm.runInNewContext(code, {
    process: { env: {} },
    console: { warn: (...args) => warnings.push(args) },
    isExpectedCommandAbsenceError,
    availabilityFoundMarker,
    getContainerCommandAvailabilityScript,
    getCurrentContainerHostBridge: async () => null,
    getCodexExecutable: () => '/configured/codex',
    getClaudeExecutable: () => '/configured/claude',
    getCopilotExecutable: () => '/configured/copilot',
    supportsOpenCodeServerContainer: async () => true,
    getOpenCodeInstallations: async () => [],
    getHostCommand: async (file, args, options) => {
      commands.push({ file, args: Array.from(args), container: options.container })
      if (resolveError) throw resolveError
      return { file, args, env: {} }
    },
    execFile: (_file, _args, _options, callback) => {
      callback(executeError, stdout)
      return { stdin: { end() {} } }
    }
  })
  return { ...api, commands, warnings }
}

test('missing host Codex is unavailable without logging a discovery error', async () => {
  const f = fixture({ resolveError: Object.assign(new Error('missing'), { code: 'ENOENT' }) })
  assert.equal(await f.isProviderAvailableInSource('codex', null), false)
  assert.deepEqual(f.commands, [
    { file: '/configured/codex', args: ['--version'], container: null }
  ])
  assert.equal(f.warnings.length, 0)
})

test('host Codex availability honors the configured executable', async () => {
  const f = fixture()
  assert.equal(await f.isProviderAvailableInSource('codex', { kind: 'host' }), true)
  assert.equal(f.commands[0].file, '/configured/codex')
})

test('remote Codex is checked in its own source and missing commands stay quiet', async () => {
  const container = { kind: 'container', tool: 'ssh', name: 'remote' }
  for (const available of [false, true]) {
    const f = fixture({ stdout: available ? availabilityFoundMarker : '' })
    assert.equal(await f.isProviderAvailableInSource('codex', container), available)
    assert.deepEqual(f.commands, [
      {
        file: 'sh',
        args: ['-lc', getContainerCommandAvailabilityScript('codex')],
        container
      }
    ])
    assert.equal(f.warnings.length, 0)
  }
})

test('transport failures remain unavailable even if stdout includes the found marker', async () => {
  const f = fixture({ stdout: availabilityFoundMarker, executeError: new Error('SSH failed') })
  const container = { kind: 'container', tool: 'ssh', name: 'remote' }
  assert.equal(await f.isProviderAvailableInSource('codex', container), false)
  assert.equal(f.warnings.length, 1)
})
