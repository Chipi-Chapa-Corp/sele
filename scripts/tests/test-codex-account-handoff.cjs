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
    for (const id of [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002'
    ]) {
      const account = path.join(directory, 'codex', 'sele', 'accounts', id)
      await fs.mkdir(account, { recursive: true })
      await fs.writeFile(
        path.join(account, 'auth.json'),
        JSON.stringify({ OPENAI_API_KEY: 'sk-fixture-unused' })
      )
    }
    await require('esbuild').build({
      stdin: {
        resolveDir: project,
        loader: 'ts',
        contents: `
          import assert from 'node:assert/strict'
          import { readFile, lstat } from 'node:fs/promises'
          import { join } from 'node:path'
          import { CodexAppServerClient } from './src/main/providers/codex/CodexAppServerClient'
          const run = async () => {
          const a = new CodexAppServerClient(null, '00000000-0000-4000-8000-000000000001')
          const b = new CodexAppServerClient(null, '00000000-0000-4000-8000-000000000002')
          const canonical = new CodexAppServerClient(null, 'default')
          try {
            await a.request('account/login/start', { type: 'apiKey', apiKey: 'sk-fixture-a-unused' })
            await b.request('account/login/start', { type: 'apiKey', apiKey: 'sk-fixture-b-unused' })
            const root = process.env.CODEX_HOME
            assert.match(await readFile(join(root, 'sele/accounts/00000000-0000-4000-8000-000000000001/auth.json'), 'utf8'), /sk-fixture-a-unused/)
            assert.match(await readFile(join(root, 'sele/accounts/00000000-0000-4000-8000-000000000002/auth.json'), 'utf8'), /sk-fixture-b-unused/)
            await assert.rejects(readFile(join(root, 'auth.json')), { code: 'ENOENT' })
            await a.request('config/batchWrite', { edits: [{ keyPath: 'model_reasoning_effort', value: 'medium', mergeStrategy: 'upsert' }], reloadUserConfig: false })
            assert.match(await readFile(join(root, 'config.toml'), 'utf8'), /model_reasoning_effort/)
            assert.equal((await lstat(join(root, 'sele/accounts/00000000-0000-4000-8000-000000000001/config.toml'))).isSymbolicLink(), true)
            const { thread: source } = await a.request('thread/resume', {
              threadId: 'fixture', cwd: process.env.HOME, model: 'gpt-5.4',
              history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fixture history only' }] }]
            })
            const { thread: sibling } = await a.request('thread/start', { cwd: process.env.HOME, model: 'gpt-5.4' })
            await a.request('thread/name/set', { threadId: source.id, name: 'Shadow fixture' })
            assert.match(await readFile(join(root, 'session_index.jsonl'), 'utf8'), /Shadow fixture/)
            const read = await canonical.request('thread/read', { threadId: source.id, includeTurns: false })
            assert.equal(read.thread.id, source.id)
            await assert.rejects(b.request('thread/resume', { threadId: source.id }, { isExpectedError: error => /active writer/.test(error.message) }), /active writer/)
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
            console.log('PASS real Codex shadows: writer exclusion, four immediate handoffs, sibling ownership preserved')
          } finally {
            await Promise.all([a.disposeAndWait(), b.disposeAndWait(), canonical.disposeAndWait()])
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
            build.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'stub'
            }))
            build.onResolve({ filter: /\?raw$/ }, (args) => ({
              path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
              namespace: 'raw'
            }))
            build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
              contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))}`
            }))
            const stubs = {
              electron: `export const app = { getPath: () => { throw Error('Profile access is forbidden') } }`,
              hostProcess: `export const isRunningInFlatpak = () => false; export const getHostCommand = async (file, args, options) => ({ file, args, env: options?.env || process.env })`,
              CodexExecutable: `export const getCodexExecutable = () => process.env.SELE_TEST_CODEX_BINARY || 'codex'; export const getCodexExecutableError = error => error`,
              CodexAccountView: `import { getCodexAccountViewCommand as prepare } from ${JSON.stringify(path.join(project, 'src/main/providers/codex/CodexAccountView.ts'))}; export const getCodexAccountViewCommand = (binary, args, _posix, id) => prepare(binary, args, process.env.SELE_TEST_CODEX_NATIVE !== '1', id)`,
              CodexDesktopTools: `export const registerCodexDesktopTools = () => ({ close() {} })`,
              CodexBrowserSessions: `export const registerBrowserUseSession = () => {}; export const removeBrowserUseSessions = () => {}`
            }
            build.onResolve(
              {
                filter:
                  /\/(hostProcess|CodexExecutable|CodexAccountView|CodexAccounts|CodexDesktopTools|CodexBrowserSessions)$/
              },
              (args) => ({
                path: args.path.split('/').at(-1),
                namespace: 'stub'
              })
            )
            build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
              contents: stubs[args.path],
              resolveDir: project
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
        SELE_TEST_CODEX_NATIVE: process.env.SELE_TEST_CODEX_NATIVE,
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
