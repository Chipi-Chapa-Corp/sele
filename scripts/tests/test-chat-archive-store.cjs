const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(
    path.join(require('node:os').tmpdir(), 'sele-chat-archive-store-')
  )
  try {
    const entry = path.join(directory, 'database-check.cjs')
    await require('esbuild').build({
      stdin: {
        contents: `
          import assert from 'node:assert/strict'
          import Database from 'better-sqlite3'
          import { getDatabase, disposeDatabase } from './src/main/database/sqlite'
          import { importedConversationStore as store } from './src/main/database/importedConversations'
          const run = async () => {
            const legacy = new Database(process.env.SELE_DATABASE_PATH)
            legacy.exec("CREATE TABLE chat (id TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0); INSERT INTO chat (id, pinned) VALUES ('existing', 1)")
            legacy.close()
            const archive = {format:'sele-chat',version:1,providerId:'codex',chat:{id:'source',title:'Full tools',items:[{id:'work',type:'working',items:[{type:'tool',stdout:'Exact tool output'.repeat(10000)}]}]},assets:[],subagents:[]}
            const record = {providerId:'claude',chatId:'imported',state:'loading',title:'Full tools',createdAt:123,original:{providerId:'codex',chatId:'source'},archive,baseline:['synthetic-user','synthetic-answer']}
            await store.save(record)
            assert.deepEqual(await store.get('claude:imported'), record)
            const index = await store.list()
            assert.equal(index.length, 1)
            assert.equal(index[0].archive, undefined)
            assert.equal(index[0].baseline, undefined)
            record.state = 'ready'
            await store.save(record)
            await disposeDatabase()
            assert.deepEqual(await store.get('claude:imported'), record)
            assert.equal((await store.list())[0].state, 'ready')
            const db = await getDatabase()
            assert.equal((await db.selectFrom('chat').select('pinned').where('id','=','existing').executeTakeFirst()).pinned, 1)
            record.state = 'cancelled'
            await store.save(record)
            assert.equal((await store.list())[0].state, 'cancelled')
            await disposeDatabase()
            console.log('PASS Imported conversation store: upgrade, full tool persistence, small sidebar index, restart and cancellation')
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
