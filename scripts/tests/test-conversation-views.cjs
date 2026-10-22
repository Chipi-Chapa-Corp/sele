// Native SQLite fixture. Electron runs as Node and creates no application/windows.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(
    path.join(require('node:os').tmpdir(), 'sele-conversation-views-')
  )
  try {
    const entry = path.join(directory, 'fixture.cjs')
    await require('esbuild').build({
      entryPoints: [path.join(__dirname, 'fixtures/conversation-views-store.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: entry,
      plugins: [
        {
          name: 'isolated-native-views',
          setup(build) {
            build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
              path: require.resolve('better-sqlite3'),
              external: true
            }))
            build.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'fixture'
            }))
            build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents:
                'export const app={getPath(){throw new Error("Real profile access forbidden")}}'
            }))
          }
        }
      ]
    })
    const result = spawnSync(require('electron'), [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SELE_DATABASE_PATH: path.join(directory, 'fixture.sqlite')
      },
      encoding: 'utf8',
      timeout: 30000
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, String(result.error || 'Conversation view fixture failed'))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
