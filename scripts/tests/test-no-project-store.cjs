const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(
    path.join(require('node:os').tmpdir(), 'sele-no-project-store-')
  )
  try {
    const entry = path.join(directory, 'database-check.cjs')
    await require('esbuild').build({
      stdin: {
        contents: `
          import assert from 'node:assert/strict'
          import Database from 'better-sqlite3'
          import { getDatabase, disposeDatabase } from './src/main/database/sqlite'
          import * as chat from './src/main/database/chat'
          const run = async () => {
            const legacy = new Database(process.env.SELE_DATABASE_PATH)
            legacy.exec("CREATE TABLE chat (id TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0); INSERT INTO chat (id, pinned) VALUES ('home-project', 1)")
            legacy.close()
            assert.equal((await chat.getChatMetadata('home-project')).noProject, false)
            assert.equal((await chat.getChatMetadata('missing')).noProject, false)
            assert.equal((await chat.setChatNoProject('general')).noProject, true)
            await chat.setChatPinned('general', true)
            await chat.setChatDone('general', true)
            await chat.setChatSeen('general', 5000)
            await chat.setChatOrder(['general', 'home-project'])
            await chat.setChatPurpose('general', 'commit')
            await chat.setChatContainer('general', {kind:'host'})
            await disposeDatabase()
            const stored = await chat.getChatMetadata('general')
            assert.equal(stored.noProject, true)
            assert.equal(stored.pinned, true)
            assert.equal(stored.done, true)
            assert.equal(stored.seenUpdatedAt, 5000)
            const byId = await chat.getChatMetadataByIds(['general', 'home-project'])
            assert.equal(byId.get('general').noProject, true)
            assert.equal(byId.get('home-project').noProject, false)
            assert.equal(byId.get('home-project').pinned, true)
            const db = await getDatabase()
            assert.equal((await db.selectFrom('chat').select('no_project').where('id','=','general').executeTakeFirst()).no_project, 1)
            await disposeDatabase()
            console.log('PASS No Project store: upgrade, independent flags, metadata updates and restart persistence')
          }
          run().catch(error => { console.error(error); process.exitCode = 1 })
        `,
        resolveDir: path.resolve(__dirname, '../..'),
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: entry,
      plugins: [
        require('./helpers/node-workers.cjs')(directory),
        {
          name: 'isolated-database',
          setup(build) {
            build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
              path: require.resolve('better-sqlite3'),
              external: true
            }))
            build.onResolve({ filter: /^electron$/ }, () => ({
              path: 'electron',
              namespace: 'stub'
            }))
            build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
              contents:
                'export const app = { getPath() { throw new Error("Real profile access is forbidden") } }'
            }))
          }
        }
      ]
    })
    // Electron's Node runtime matches the installed SQLite native module ABI.
    // No Electron app or windows are created, and all data stays in this fixture.
    const result = spawnSync(require('electron'), [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SELE_DATABASE_PATH: path.join(directory, 'test.sqlite')
      },
      encoding: 'utf8',
      timeout: 20000
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, String(result.error || 'Database checks failed'))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
