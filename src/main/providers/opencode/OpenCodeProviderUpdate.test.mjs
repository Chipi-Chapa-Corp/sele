import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('./OpenCodeProviderUpdate.ts', import.meta.url), 'utf8')
const code = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022
})
function fixture(currentVersion, versions = { 1: '1.19.5', 2: '2.2.0' }) {
  const requests = []
  const commands = []
  const exports = {}
  const context = vm.createContext({
    exports,
    console: { warn() {} },
    AbortController,
    setTimeout,
    clearTimeout,
    require: (name) => {
      if (name === 'node:child_process')
        return {
          execFile: (file, args, options, callback) => {
            commands.push({ file, args, options })
            queueMicrotask(() => callback(null, currentVersion, ''))
            return { stdin: { end() {} } }
          }
        }
      if (name.includes('hostProcess'))
        return { getHostCommand: async (file, args, options) => ({ file, args, env: options.env }) }
      if (name.includes('OpenCodeInstallations'))
        return {
          resolveOpenCodeInstallation: async () => ({
            major: currentVersion.startsWith('2.') ? 2 : 1,
            version: currentVersion,
            executable: '/fixture/opencode'
          }),
          getOpenCodeInstallations: async () => [
            {
              major: currentVersion.startsWith('2.') ? 2 : 1,
              version: currentVersion,
              executable: '/fixture/opencode'
            }
          ],
          clearOpenCodeInstallationCache() {},
          managedOpenCodeV2Executable: () => '/fixture/managed/opencode'
        }
      if (name.includes('OpenCodeInstall'))
        return {
          installOpenCode: async () => {
            throw Error('Unexpected migration')
          }
        }
      if (name.includes('OpenCodeExecutable'))
        return {
          getOpenCodeExecutable: () => '/fixture/opencode',
          getOpenCodeExecutableError: (error) => error
        }
      if (name.includes('expectedAbsence')) return { isExpectedCommandAbsenceError: () => false }
      throw new Error(`Unexpected import ${name}`)
    },
    fetch: async (url) => {
      requests.push(url)
      const major = url.includes('opencode-ai') ? 1 : 2
      if (versions[major] instanceof Error) throw versions[major]
      return { ok: true, json: async () => ({ version: versions[major] }) }
    }
  })
  vm.runInContext(code, context)
  return { ...exports, requests, commands }
}
const plain = (value) => JSON.parse(JSON.stringify(value))

test('v2 checks the new package and never offers migration to itself', async () => {
  const f = fixture('2.1.4')
  assert.deepEqual(plain(await f.getOpenCodeUpdateAvailability()), {
    currentVersion: '2.1.4',
    latestVersion: '2.2.0'
  })
  assert.equal(f.requests.length, 1)
  assert.match(f.requests[0], /@opencode%2Fcli/)
  assert.equal(await fixture('2.2.0').getOpenCodeUpdateAvailability(), null)
})

test('updates use the selected v2 executable and environment', async () => {
  const f = fixture('2.1.4')
  const env = { PATH: '/fixture/bin' }
  await f.updateOpenCodeProvider({ env })
  assert.deepEqual(plain(f.commands[0]), {
    file: '/fixture/opencode',
    args: ['upgrade'],
    options: { encoding: 'utf8', env, maxBuffer: 2097152, timeout: 600000 }
  })
})
test('registry failures remain retryable and never suggest a downgrade', async () => {
  await assert.rejects(
    fixture('2.2.0', { 2: new Error('offline') }).getOpenCodeUpdateAvailability(),
    /offline/
  )
  assert.equal(await fixture('2.3.0').getOpenCodeUpdateAvailability(), null)
})
