import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const code = ts.transpile(
  readFileSync(new URL('./CopilotProviderUpdate.ts', import.meta.url), 'utf8'),
  { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
)
function fixture(version = '1.0.20') {
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
      if (name.includes('expectedAbsence')) return { isExpectedCommandAbsenceError: () => false }
      if (name === 'node:child_process')
        return {
          execFile: (file, args, options, callback) => {
            commands.push({ file, args, options })
            if (args[0] === 'update') version = '1.0.26'
            queueMicrotask(() => callback(null, `GitHub Copilot CLI ${version}`, ''))
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
