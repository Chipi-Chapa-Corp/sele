import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const code = ts.transpile(readFileSync(new URL('./OpenCodeInstall.ts', import.meta.url), 'utf8'), {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022
})
function fixture(options = {}) {
  const calls = []
  const exports = {}
  const state = { valid: true, healthy: true, download: true, ...options }
  const directory = "/fixture/managed folder's v2"
  const executable = path.join(directory, state.platform === 'win32' ? 'opencode.exe' : 'opencode')
  vm.runInNewContext(code, {
    exports,
    console,
    Buffer,
    process: { platform: state.platform ?? 'linux', arch: 'x64' },
    AbortSignal,
    fetch: async (url) => {
      calls.push(['download', url])
      return new Response(state.download ? 'fixture archive' : null, {
        status: state.download ? 200 : 503
      })
    },
    require: (name) => {
      if (name === 'node:path') return path
      if (name === 'node:stream') return { Readable }
      if (name === 'node:stream/promises') return { pipeline }
      if (name === 'node:fs')
        return {
          createWriteStream: () =>
            new Writable({
              write(_chunk, _encoding, done) {
                done()
              }
            })
        }
      if (name === 'node:fs/promises')
        return Object.fromEntries(
          ['chmod', 'mkdir', 'rename', 'rm', 'mkdtemp'].map((method) => [
            method,
            async (...args) => {
              calls.push([method, ...args])
              return method === 'mkdtemp' ? path.join(directory, '.staging') : undefined
            }
          ])
        )
      if (name === 'node:child_process')
        return {
          execFile: (file, args, _options, done) => {
            calls.push(['extract', file, args])
            queueMicrotask(() => done(null))
            return { stdin: { end() {} } }
          }
        }
      if (name.includes('hostProcess'))
        return { getHostCommand: async (file, args) => ({ file, args }) }
      if (name.includes('OpenCodeInstallations'))
        return {
          getOpenCodeInstallations: async () => [
            ...(state.installed ? [{ major: 2, version: '2.2.0', executable }] : [])
          ],
          managedOpenCodeV2Directory: () => directory,
          managedOpenCodeV2Executable: () => executable,
          probeOpenCodeInstallation: async () =>
            state.valid
              ? {
                  major: 2,
                  version: '2.2.0',
                  executable: path.join(directory, '.staging', 'opencode')
                }
              : null,
          clearOpenCodeInstallationCache: () => calls.push(['invalidate'])
        }
      if (name.includes('OpenCodeV2Profile'))
        return { ensureOpenCodeV2Profile: async () => calls.push(['profile']) }
      if (name.includes('OpenCodeServerClient'))
        return {
          OpenCodeServerClient: class {
            async getClient() {
              calls.push(['start'])
              if (!state.healthy) throw Error('Startup failed')
            }
            async dispose() {
              calls.push(['dispose'])
            }
          }
        }
      throw Error(name)
    }
  })
  return { ...exports, calls, state, executable }
}

test('installation verifies the staged binary before committing and checks startup', async () => {
  const f = fixture()
  const result = await f.installOpenCode()
  assert.equal(result.latestVersion, '2.2.0')
  assert.match(
    f.calls.find((call) => call[0] === 'download')[1],
    /^https:\/\/opencode.ai\/update\/api\/latest\/cli\/opencode\/opencode-linux-x64.tar.gz$/
  )
  assert.equal(f.calls.find((call) => call[0] === 'rename')[2], f.executable)
  assert.ok(
    f.calls.findIndex((call) => call[0] === 'profile') <
      f.calls.findIndex((call) => call[0] === 'start')
  )
  assert.ok(f.calls.some((call) => call[0] === 'rm'))
  assert.ok(f.calls.every((call) => call[0] !== 'rename' || !call.includes('/fixture/v1')))
})

test('a failed download or invalid executable removes staging files without replacing the binary', async () => {
  for (const options of [{ download: false }, { valid: false }]) {
    const f = fixture(options)
    await assert.rejects(f.installOpenCode())
    assert.ok(f.calls.some((call) => call[0] === 'rm'))
    assert.ok(!f.calls.some((call) => call[0] === 'rename' || call[0] === 'start'))
  }
})

test('an existing v2 is reused and startup errors never return an activation result', async () => {
  const f = fixture({ installed: true })
  assert.equal((await f.installOpenCode()).latestVersion, '2.2.0')
  assert.ok(!f.calls.some((call) => call[0] === 'download'))
  const broken = fixture({ installed: true, healthy: false })
  await assert.rejects(broken.installOpenCode(), /Startup failed/)
  assert.ok(broken.calls.some((call) => call[0] === 'dispose'))
})

test('Windows extraction preserves spaces and quotes in profile paths', async () => {
  const f = fixture({ platform: 'win32' })
  await f.installOpenCode()
  const args = f.calls.find((call) => call[0] === 'extract')[2]
  assert.ok(args.includes('-EncodedCommand'))
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
  assert.match(script, /managed folder''s v2/)
  assert.match(script, /Expand-Archive -LiteralPath '/)
})
