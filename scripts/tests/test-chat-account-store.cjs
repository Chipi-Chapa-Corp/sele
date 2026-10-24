const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(
    path.join(require('node:os').tmpdir(), 'sele-chat-account-store-')
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
            legacy.exec('CREATE TABLE conversation_view (scope_key TEXT PRIMARY KEY, format_version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)')
            const source = JSON.stringify(['codex', 'host'])
            const oldScope = account => JSON.stringify([source, JSON.stringify([[account, null]]), 'home-project'])
            legacy.prepare('INSERT INTO conversation_view VALUES (?, 1, ?, ?)').run(oldScope('account-a'), 'older', 10)
            legacy.prepare('INSERT INTO conversation_view VALUES (?, 1, ?, ?)').run(oldScope('account-b'), 'newest', 20)
            legacy.close()
            assert.equal((await chat.getChatMetadata('home-project')).accountId, null)
            const views = await (await getDatabase()).selectFrom('conversation_view').selectAll().execute()
            assert.equal(views.length, 1)
            assert.equal(views[0].scope_key, oldScope('chat-accounts'))
            assert.equal(views[0].payload, 'newest')
            assert.equal(await chat.setChatAccount('home-project', 'account-a'), 'account-a')
            assert.equal(await chat.setChatAccount('home-project', 'account-b'), 'account-a')
            await chat.setChatNoProject('home-project')
            await chat.setChatSeen('home-project', 5000)
            await chat.setChatContainer('home-project', { kind: 'container', tool: 'toolbox', name: 'fixture' })
            await chat.bindChatAccounts(['home-project', 'new-chat', 'another-chat'].map(id => ({ id, container: { kind: 'container', tool: 'toolbox', name: 'fixture' } })), 'account-b')
            const byId = await chat.getChatMetadataByIds(['home-project', 'new-chat', 'another-chat'])
            assert.equal(byId.get('home-project').accountId, 'account-a')
            assert.equal(byId.get('new-chat').accountId, 'account-b')
            assert.equal(byId.get('new-chat').container.name, 'fixture')
            assert.equal(byId.get('another-chat').accountId, 'account-b')
            await disposeDatabase()
            const stored = await chat.getChatMetadata('home-project')
            assert.equal(stored.accountId, 'account-a')
            assert.equal(stored.noProject, true)
            assert.equal(stored.pinned, true)
            assert.equal(stored.seenUpdatedAt, 5000)
            assert.equal(stored.container.name, 'fixture')
            assert.equal(await chat.setChatAccount('home-project', 'account-b', true), 'account-b')
            await disposeDatabase()
            assert.equal((await chat.getChatMetadata('home-project')).accountId, 'account-b')
            await disposeDatabase()
            console.log('PASS per-chat accounts: schema upgrade, default isolation, batch binding, metadata preservation, explicit switching and restart persistence')
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
