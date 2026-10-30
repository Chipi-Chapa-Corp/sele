import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'
import vm from 'node:vm'
import ts from 'typescript'
import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'
import { getClaudeExecutableError } from './ClaudeExecutable.ts'
import { getClaudeUpdateAvailabilityFromVersions, parseClaudeVersion } from './ClaudeVersion.ts'

const code = ts.transpile(
  readFileSync(new URL('./ClaudeProviderUpdate.ts', import.meta.url), 'utf8'),
  { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
)

function fixture({
  version = '2.1.310',
  installedVersion = '2.1.314',
  stdout = '',
  stderr = '',
  updateError = null,
  channel = 'latest'
} = {}) {
  const exports = {}
  const commands = []
  const requests = []
  vm.runInNewContext(code, {
    exports,
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      requests.push(url)
      return { ok: true, text: async () => '2.1.314' }
    },
    require: (name) => {
      if (name === 'node:util') return { stripVTControlCharacters }
      if (name.includes('ClaudeExecutable'))
        return { getClaudeExecutable: () => '/fixture/claude', getClaudeExecutableError }
      if (name.includes('ClaudeVersion'))
        return { getClaudeUpdateAvailabilityFromVersions, parseClaudeVersion }
      if (name.includes('expectedAbsence')) return { isExpectedCommandAbsenceError }
      if (name.includes('hostProcess'))
        return {
          getHostCommand: async (file, args, options) => {
            commands.push({ file, args, options })
            return { file, args, env: options.env }
          }
        }
      if (name === 'node:child_process')
        return {
          execFile: (_file, args, _options, callback) => {
            let output
            if (args[0] === 'update') {
              if (!updateError) version = installedVersion
              queueMicrotask(() => callback(updateError, stdout, stderr))
            } else {
              output =
                args[0] === 'doctor'
                  ? `Auto-update channel: ${channel}`
                  : `${version} (Claude Code)`
              queueMicrotask(() => callback(null, output, ''))
            }
            return { stdin: { end() {} } }
          }
        }
      throw Error(name)
    }
  })
  return { ...exports, commands, requests }
}

test('checks the configured release channel without installing anything', async () => {
  const f = fixture({ channel: 'stable' })
  const update = await f.getClaudeUpdateAvailability()
  assert.equal(update.currentVersion, '2.1.310')
  assert.deepEqual(f.requests, ['https://downloads.claude.ai/claude-code-releases/stable'])
  assert.ok(f.commands.every(({ args }) => args[0] !== 'update'))
})

test('verifies a successful update in the selected environment', async () => {
  const f = fixture()
  const container = { kind: 'container', tool: 'toolbox', name: 'fixture' }
  const env = { PATH: '/fixture/bin' }
  assert.equal(await f.updateClaudeProvider({ container, env }), null)
  assert.equal(f.commands[0].file, 'claude')
  assert.deepEqual(Array.from(f.commands[0].args), ['update'])
  assert.ok(f.commands.some(({ args }) => args[0] === '--version'))
  assert.ok(
    f.commands.every(({ options }) => options.container === container && options.env === env)
  )
})

test('a zero exit code with an unchanged version surfaces the lock message from stdout', async () => {
  const f = fixture({
    installedVersion: '2.1.310',
    stdout:
      '\x1b[33mAnother Claude process is currently running. Please try again in a moment.\x1b[0m'
  })
  await assert.rejects(f.updateClaudeProvider(), (error) => {
    assert.match(error.message, /2\.1\.310 is still installed; 2\.1\.314 is available/)
    assert.match(error.message, /Another Claude process is currently running/)
    assert.ok(!error.message.includes('\x1b'))
    return true
  })
})

test('a zero exit code preserves package-manager instructions and stderr', async () => {
  const f = fixture({
    installedVersion: '2.1.310',
    stdout: 'Claude is managed by Homebrew. To update, run: brew upgrade claude-code',
    stderr: 'Additional installation warning'
  })
  await assert.rejects(f.updateClaudeProvider(), (error) => {
    assert.match(error.message, /brew upgrade claude-code/)
    assert.match(error.message, /Additional installation warning/)
    return true
  })
})

test('a silent no-op provides installation diagnostics guidance', async () => {
  const f = fixture({ installedVersion: '2.1.310' })
  await assert.rejects(f.updateClaudeProvider(), /Run claude doctor in the selected environment/)
})

test('failed commands retain both output streams', async () => {
  const f = fixture({
    updateError: Error('Command failed'),
    stdout: 'Installation cannot be updated',
    stderr: 'Permission denied'
  })
  await assert.rejects(
    f.updateClaudeProvider(),
    /Installation cannot be updated\nPermission denied/
  )
})

test('an already current or newer installation does not fail verification', async () => {
  const f = fixture({ installedVersion: '2.1.315' })
  assert.equal(await f.updateClaudeProvider(), null)
})
