const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-done-chats-'))
  try {
    const entry = path.join(directory, 'database-check.cjs')
    await require('esbuild').build({
      stdin: {
        contents: `
          import assert from 'node:assert/strict'
          import Database from 'better-sqlite3'
          import * as chat from './src/main/database/chat'
          import { getChatTurnOutcomes, setChatTurnOutcome } from './src/main/database/chatTurnOutcome'
          import { getDatabase, disposeDatabase } from './src/main/database/sqlite'
          const run = async () => {
            // Upgrade an existing installation without assigning invented completion times.
            const legacy = new Database(process.env.SELE_DATABASE_PATH)
            legacy.exec("CREATE TABLE chat (id TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0); INSERT INTO chat (id, done) VALUES ('legacy', 1)")
            legacy.close()
            assert.equal((await chat.getChatMetadata('legacy')).doneAt, null)
            assert.equal((await chat.getChatMetadata('missing')).doneAt, null)
            let now = 1000
            Date.now = () => now
            assert.equal((await chat.setChatDone('first')).doneAt, 1000)
            now = 2000
            const ids = Array.from({ length: 205 }, (_, index) => 'bulk-' + index)
            const batch = await chat.setChatsDone(ids)
            assert.equal(batch.length, 205)
            assert.ok(batch.every(item => item.done && item.doneAt === 2000))
            await chat.setChatPinned('first', true)
            await chat.setChatSeen('first', 5000)
            assert.equal((await chat.getChatMetadata('first')).doneAt, 1000)
            await setChatTurnOutcome('codex', 'first', 'stopped')
            await setChatTurnOutcome('claude', 'first', 'failed')
            const listed = [
              { providerId: 'codex', id: 'first', updatedAt: 1000 },
              { providerId: 'claude', id: 'first', updatedAt: 1000 }
            ]
            await disposeDatabase()
            assert.deepEqual([...await getChatTurnOutcomes(listed)], [
              ['claude:first', 'failed'], ['codex:first', 'stopped']
            ])
            await chat.setChatSeen('first', 6000)
            assert.equal((await getChatTurnOutcomes(listed)).get('codex:first'), 'stopped')
            await setChatTurnOutcome('codex', 'first', null)
            assert.equal((await getChatTurnOutcomes(listed)).get('codex:first'), null)
            assert.equal((await getChatTurnOutcomes([{ ...listed[1], updatedAt: 3000 }])).size, 0)
            assert.equal((await chat.getChatMetadata('first')).doneAt, 1000)
            now = 3000
            const undone = await chat.setChatDone('first', false)
            assert.equal(undone.done, false)
            assert.equal(undone.doneAt, null)
            now = 4000
            assert.equal((await chat.setChatDone('first')).doneAt, 4000)
            const unmarked = await chat.setChatsDone(ids, false)
            assert.ok(unmarked.every(item => !item.done && item.doneAt === null))
            assert.equal((await chat.getChatMetadata('legacy')).doneAt, null)
            const db = await getDatabase()
            assert.equal((await db.selectFrom('chat').select('done_at').where('id', '=', 'first').executeTakeFirst()).done_at, 4000)
            await disposeDatabase()
            console.log('PASS Done database: migration, timestamps, bulk updates, undo and persistence')
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
