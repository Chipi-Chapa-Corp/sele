const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Opt-in integration check: two real Codex app-servers share disposable history.
// No user profile, credentials, inference requests, or GUI applications are used.
;(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-codex-handoff-'))
  try {
    const project = path.resolve(__dirname, '../..')
    const entry = path.join(directory, 'handoff.cjs')
    await fs.mkdir(path.join(directory, 'codex'))
    await require('esbuild').build({
      stdin: {
        resolveDir: project,
        loader: 'ts',
        contents: `
          import assert from 'node:assert/strict'
          import { CodexAppServerClient } from './src/main/providers/codex/CodexAppServerClient'
          const run = async () => {
          const a = new CodexAppServerClient(null, 'default')
          const b = new CodexAppServerClient(null, 'default')
          try {
            const { thread: source } = await a.request('thread/resume', {
              threadId: 'fixture', cwd: process.env.HOME, model: 'gpt-5.4',
              history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fixture history only' }] }]
            })
            const { thread: sibling } = await a.request('thread/start', { cwd: process.env.HOME, model: 'gpt-5.4' })
            await assert.rejects(b.request('thread/resume', { threadId: source.id }), /active writer/)
            for (let index = 0; index < 4; index++) {
              const from = index % 2 === 0 ? a : b
              const to = index % 2 === 0 ? b : a
              await from.releaseThread(source.id)
              const resumed = await to.request('thread/resume', { threadId: source.id })
              assert.equal(resumed.thread.id, source.id)
              assert.equal(to.ownsThread(source.id), true)
              assert.equal(from.ownsThread(source.id), false)
              assert.equal(a.ownsThread(sibling.id), true)
            }
            console.log('PASS real Codex: writer exclusion, four immediate handoffs, sibling ownership preserved')
          } finally {
            await Promise.all([a.disposeAndWait(), b.disposeAndWait()])
          }
          }
          run().catch(error => { console.error(error); process.exitCode = 1 })
        `
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: entry,
      plugins: [
        {
          name: 'isolated-codex-runtime',
          setup(build) {
            const stubs = {
              hostProcess: `export const isRunningInFlatpak = () => false; export const getHostCommand = async (file, args) => ({ file, args, env: process.env })`,
              CodexExecutable: `export const getCodexExecutable = () => process.env.SELE_TEST_CODEX_BINARY || 'codex'; export const getCodexExecutableError = error => error`,
              CodexAccounts: `export const ensureCodexAccountView = () => { throw Error('Real account access is forbidden') }`,
              CodexDesktopTools: `export const registerCodexDesktopTools = () => ({ close() {} })`,
              CodexBrowserSessions: `export const registerBrowserUseSession = () => {}; export const removeBrowserUseSessions = () => {}`
            }
            build.onResolve(
              {
                filter:
                  /\/(hostProcess|CodexExecutable|CodexAccounts|CodexDesktopTools|CodexBrowserSessions)$/
              },
              (args) => ({
                path: args.path.split('/').at(-1),
                namespace: 'stub'
              })
            )
            build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
              contents: stubs[args.path]
            }))
          }
        }
      ]
    })
    const result = spawnSync(process.execPath, [entry], {
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        CODEX_HOME: path.join(directory, 'codex'),
        OPENAI_API_KEY: 'sk-fixture-unused',
        SELE_TEST_CODEX_BINARY: process.env.SELE_TEST_CODEX_BINARY,
        SELE_DISABLE_CODEX_RESOURCE_ISOLATION: '1'
      },
      encoding: 'utf8',
      timeout: 60_000
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, String(result.error || 'Codex handoff checks failed'))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
