import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { stripVTControlCharacters } from 'node:util'
import ts from 'typescript'
import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'

const code = ts.transpile(
  readFileSync(new URL('./CopilotProviderUpdate.ts', import.meta.url), 'utf8'),
  { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
)
function fixture(version = '1.0.20', { executeError, updateOutput, updates = true } = {}) {
  const exports = {}
  const commands = []
  vm.runInNewContext(code, {
    exports,
    console,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      assert.equal(url, 'https://registry.npmjs.org/@github%2Fcopilot/latest')
      return { ok: true, json: async () => ({ version: '1.0.26' }) }
    },
    require: (name) => {
      if (name.includes('CopilotExecutable'))
        return { getCopilotExecutable: () => '/fixture/copilot' }
      if (name.includes('hostProcess'))
        return { getHostCommand: async (file, args, options) => ({ file, args, env: options.env }) }
      if (name.includes('expectedAbsence')) return { isExpectedCommandAbsenceError }
      if (name === 'node:util') return { stripVTControlCharacters }
      if (name === 'node:child_process')
        return {
          execFile: (file, args, options, callback) => {
            commands.push({ file, args, options })
            const updating = args[0] === 'update'
            if (updating && updates && !executeError) version = '1.0.26'
            queueMicrotask(() =>
              callback(
                executeError ?? null,
                updating && updateOutput !== undefined
                  ? updateOutput
                  : `GitHub Copilot CLI ${version}`,
                ''
              )
            )
            return { stdin: { end() {} } }
          }
        }
      throw Error(name)
    }
  })
  return { ...exports, commands }
}
test('Copilot checks for updates without downloading anything', async () => {
  const f = fixture()
  const update = await f.getCopilotUpdateAvailability()
  assert.equal(update.currentVersion, '1.0.20')
  assert.equal(update.latestVersion, '1.0.26')
  assert.ok(f.commands.every((command) => command.args[0] === '--version'))
})
test('Copilot uses its native update command in the selected environment', async () => {
  const f = fixture()
  assert.equal(
    await f.updateCopilotProvider({
      container: { kind: 'container', tool: 'toolbox', name: 'fixture' }
    }),
    null
  )
  assert.equal(f.commands[0].file, 'copilot')
  assert.deepEqual(Array.from(f.commands[0].args), ['update'])
})
test('Copilot never suggests downgrading a newer installation', async () => {
  assert.equal(await fixture('1.0.27').getCopilotUpdateAvailability(), null)
})

test('missing Copilot remains an expected absence when spawning the CLI fails', async () => {
  const f = fixture('1.0.20', {
    executeError: Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  assert.equal(await f.getCopilotUpdateAvailability(), null)
})

test('interrupted Copilot probes are reported instead of treated as absent', async () => {
  const error = Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' })
  await assert.rejects(fixture('1.0.20', { executeError: error }).getCopilotUpdateAvailability(), {
    killed: true,
    signal: 'SIGTERM'
  })
})

test('a zero-exit update must still replace the installed version', async () => {
  const f = fixture('1.0.20', {
    updates: false,
    updateOutput: '\u001b[31mInstallation directory is not writable.\u001b[0m'
  })
  await assert.rejects(f.updateCopilotProvider(), (error) => {
    assert.match(error.message, /1\.0\.20 is still installed; 1\.0\.26 is available/)
    assert.match(error.message, /Installation directory is not writable\./)
    assert.equal(error.message.includes('\u001b'), false)
    return true
  })
})

test('permission failures explain how to repair the selected installation without retrying', async () => {
  for (const container of [null, { kind: 'container', tool: 'distrobox', name: 'dev' }]) {
    const f = fixture('1.0.20', {
      executeError: Object.assign(new Error('denied'), { code: 1 }),
      updateOutput: "EACCES: permission denied, mkdir '/usr/lib/node_modules/@github/copilot'"
    })
    await assert.rejects(f.updateCopilotProvider({ container }), (error) => {
      assert.match(error.message, /reinstall Copilot in a user-writable directory/)
      assert.match(error.message, container ? /selected environment \(dev\)/ : /host environment/)
      assert.equal(error.message.includes('SELE_COPILOT_PATH'), !container)
      assert.match(error.message, /EACCES: permission denied/)
      return true
    })
    assert.equal(f.commands.length, 1)
  }
})

test('unrelated update failures keep their original error details', async () => {
  const error = Object.assign(new Error('network unavailable'), { code: 1 })
  const f = fixture('1.0.20', { executeError: error, updateOutput: 'Network unavailable' })
  await assert.rejects(f.updateCopilotProvider(), (actual) => actual === error)
})
