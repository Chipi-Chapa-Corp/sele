import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const code = ts.transpile(
  readFileSync(new URL('./OpenCodeServerClient.ts', import.meta.url), 'utf8'),
  {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
)

test('wrapped startup captures the same fresh credentials that the SDK uses', async () => {
  const exports = {}
  const prepared = []
  const launches = []
  let clientPassword
  const env = {
    OPENCODE_SERVER_PASSWORD: 'inherited-password',
    OPENCODE_SERVER_USERNAME: 'other-user'
  }
  vm.runInNewContext(code, {
    exports,
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    process: { env },
    require(name) {
      if (name === 'node:child_process')
        return {
          spawn(file, args, options) {
            launches.push({ file, args, options })
            const child = Object.assign(new EventEmitter(), {
              stdout: new EventEmitter(),
              stderr: new EventEmitter(),
              kill() {
                this.emit('close', 0)
              }
            })
            queueMicrotask(() =>
              child.stdout.emit('data', Buffer.from('server listening on http://127.0.0.1:12345\n'))
            )
            return child
          },
          execFile() {
            throw Error('No real processes should be launched')
          }
        }
      if (name.includes('currentContainer'))
        return {
          getCurrentContainerHostBridge: async () => ({}),
          isCurrentContainerTarget: async () => false
        }
      if (name.includes('hostProcess'))
        return {
          isRunningInFlatpak: () => false,
          async getHostCommand(file, args, options) {
            // A launcher serializes target overrides before the outer spawn occurs.
            const targetEnv = { ...options.env }
            prepared.push(targetEnv)
            return { file, args, env: targetEnv, cwd: options.cwd }
          }
        }
      if (name.includes('OpenCodeInstallations'))
        return {
          resolveOpenCodeInstallation: async () => ({ major: 2, executable: '/fixture/opencode' })
        }
      if (name.includes('OpenCodeExecutable'))
        return { getOpenCodeExecutableError: (error) => error }
      if (name.includes('OpenCodeV2Profile'))
        return { ensureOpenCodeV2Profile: async () => '/fixture/profile.db' }
      if (name.includes('OpenCodeV2Client'))
        return {
          createOpenCodeV2Client(options) {
            const credentials = Buffer.from(
              options.headers.authorization.slice(6),
              'base64'
            ).toString()
            clientPassword = credentials.slice('opencode:'.length)
            return {
              global: {
                async health() {
                  assert.equal(prepared[0].OPENCODE_SERVER_USERNAME, 'opencode')
                  assert.equal(prepared[0].OPENCODE_SERVER_PASSWORD, clientPassword)
                  assert.notEqual(clientPassword, env.OPENCODE_SERVER_PASSWORD)
                  return { data: { healthy: true } }
                }
              }
            }
          }
        }
      if (name.includes('BrowserAutomation')) return { getBrowserAutomationService: () => null }
      if (name.includes('OpenCodeBrowserBridge')) return {}
      if (name.includes('targetShell')) return { quotePosixShellArg: (value) => `'${value}'` }
      assert.ok(name.startsWith('node:'), `Unexpected dependency: ${name}`)
      return require(name)
    }
  })
  const server = new exports.OpenCodeServerClient()
  try {
    await server.getClient()
    assert.equal(launches.length, 1)
    assert.equal(launches[0].options.env.OPENCODE_SERVER_PASSWORD, clientPassword)
    assert.equal(
      env.OPENCODE_SERVER_PASSWORD,
      'inherited-password',
      'startup leaves the parent environment unchanged'
    )
  } finally {
    await server.dispose()
  }
})
