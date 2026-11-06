// Native SQLite regressions share one bundler, disposable database and Node runtime.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const cases = {
  'performance-accounting': `
import assert from 'node:assert/strict'
import * as usage from './src/main/database/tokenUsage'
import * as chat from './src/main/database/chat'
import * as reviews from './src/main/database/messageReviews'
import * as sqlite from './src/main/database/sqlite'
const api = {...usage, ...chat, ...reviews, ...sqlite}
const run = async () => {
  try {
      await api.getDatabase()
      let queries = []
      const stopObserving = api.observeDatabaseQueries((sql) => queries.push(sql))
      const usage = (input, cached = 0, output = 1) => ({
        inputTokens: input,
        cachedInputTokens: cached,
        outputTokens: output
      })
      const rates = { input: 2, cacheRead: 0.2, output: 10 }
      const record = (changes = {}) =>
        api.recordTokenUsage('codex', {
          chatId: 'root',
          sourceKey: 'host',
          turnId: 'turn',
          recordId: 'request',
          timestamp: Date.now(),
          usage: usage(10),
          models: [{ modelId: 'fixture', rates, usage: usage(10) }],
          ...changes
        })
      record()
      record({
        chatId: 'child',
        parentChatId: 'root',
        parentTurnId: 'turn',
        turnId: 'child-turn',
        recordId: 'child'
      })
      const first = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.equal(first.total.inputTokens, 20)
      queries = []
      for (let i = 0; i < 50; i++)
        assert.equal(await api.getChatTokenUsage('codex', 'host', 'root'), first)
      assert.deepEqual(queries, [], 'unchanged streaming updates perform no accounting SQL')
      record({ usage: usage(30), models: [{ modelId: 'fixture', rates, usage: usage(30) }] })
      record({
        chatId: 'child',
        parentChatId: 'root',
        parentTurnId: 'turn',
        turnId: 'child-turn',
        recordId: 'child',
        usage: usage(20),
        models: [{ modelId: 'fixture', rates, usage: usage(20) }]
      })
      const updated = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.equal(updated.total.inputTokens, 50)
      assert.equal(updated.byTurn.get('turn').inputTokens, 50)
      assert.equal(first.total.inputTokens, 20, 'published totals stay immutable')
      assert.equal(
        queries.some((sql) => /with recursive chat_tree|row_number\\(/i.test(sql)),
        false,
        'known usage changes update totals without rescanning history'
      )
      // A new descendant must invalidate the root membership index, including empty roots.
      await api.getChatTokenUsage('codex', 'host', 'empty')
      record({
        chatId: 'new-child',
        parentChatId: 'empty',
        parentTurnId: 'empty-turn',
        usage: usage(7),
        models: [{ modelId: 'fixture', rates, usage: usage(7) }]
      })
      assert.equal((await api.getChatTokenUsage('codex', 'host', 'empty')).total.inputTokens, 7)
      // Provisional records are deleted and replaced atomically; the aggregate cannot double count.
      record({ recordId: 'provisional', provisionalGroup: 'group', provisionalComplete: true })
      const before = await api.getChatTokenUsage('codex', 'host', 'root')
      record({
        recordId: 'final',
        replaceProvisionalGroup: 'group',
        usage: usage(15),
        models: [{ modelId: 'fixture', rates, usage: usage(15) }]
      })
      const after = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.equal(after.total.inputTokens, before.total.inputTokens + 5)
      // Fresh source prices also invalidate roots containing estimated, token-only history.
      record({ chatId: 'legacy', recordId: 'old', models: undefined })
      const estimated = await api.getChatTokenUsage('codex', 'host', 'legacy')
      assert.equal(estimated.total.costUsesFallback, true)
      record({
        chatId: 'new-price',
        recordId: 'quote',
        timestamp: Date.now() + 1000,
        models: [
          { modelId: 'new', rates: { input: 20, cacheRead: 2, output: 100 }, usage: usage(10) }
        ]
      })
      const repriced = await api.getChatTokenUsage('codex', 'host', 'legacy')
      assert.ok(repriced.total.cost.total > estimated.total.cost.total * 9)
      // Compare the cache to a cold database reopen after every mutation path above.
      await api.flushTokenUsage()
      await api.disposeDatabase()
      const cold = await api.getChatTokenUsage('codex', 'host', 'root')
      assert.ok(Math.abs(cold.total.cost.total - after.total.cost.total) < 1e-12)
      assert.equal(cold.total.inputTokens, after.total.inputTokens)
      // Pricing I/O for a newly ingested record must not hold up a streaming snapshot.
      const originalFetch = global.fetch
      let releasePricing
      global.fetch = () =>
        new Promise((resolve) => {
          releasePricing = () =>
            resolve({
              ok: true,
              json: async () => ({
                openai: { models: { held: { cost: { input: 2, cache_read: 0.2, output: 10 } } } },
                anthropic: {
                  models: { fixture: { cost: { input: 3, cache_read: 0.3, output: 15 } } }
                }
              })
            })
        })
      record({
        recordId: 'pending-price',
        models: [{ modelId: 'held', pricingProvider: 'openai', usage: usage(10) }]
      })
      const pricingDeadline = Date.now() + 5000
      while (!releasePricing && Date.now() < pricingDeadline)
        await new Promise((resolve) => setTimeout(resolve, 5))
      assert.equal(typeof releasePricing, 'function')
      assert.equal(
        (await api.getLiveChatTokenUsage('codex', 'host', 'root')).total.inputTokens,
        cold.total.inputTokens,
        'streaming reads committed usage while pricing remains unresolved'
      )
      releasePricing()
      await api.flushTokenUsage()
      global.fetch = originalFetch
      assert.equal(
        (await api.getChatTokenUsage('codex', 'host', 'root')).total.inputTokens,
        cold.total.inputTokens + 10
      )
      await api.getChatMetadata('metadata')
      await api.getMessageReviews('metadata')
      queries = []
      for (let i = 0; i < 50; i++) {
        await api.getChatMetadata('metadata')
        await api.getMessageReviews('metadata')
      }
      assert.deepEqual(queries, [], 'metadata and reviews share unchanged reads')
      assert.equal((await api.setChatPinned('metadata', true)).pinned, true)
      assert.equal((await api.setChatDone('metadata')).done, true)
      await api.setChatsDone(['metadata'], false)
      assert.equal((await api.getChatMetadata('metadata')).done, false)
      await api.setChatOrder(['other', 'metadata'])
      assert.equal((await api.getChatMetadata('metadata')).sidebarOrder, 1)
      const review = {
        id: 'review',
        comments: [
          { id: 'comment', path: '/fixture.ts', line: 1, endLine: 1, side: 'new', comment: 'Fix' }
        ]
      }
      await api.setMessageReview('metadata', 'serialized', 'prompt', review)
      assert.equal((await api.getMessageReviews('metadata')).length, 1)
      await api.setMessageReview('other', 'serialized', 'prompt', review)
      assert.equal((await api.getMessageReviews('metadata')).length, 0)
      assert.equal((await api.getMessageReviews('other')).length, 1)
      await api.deleteMessageReview('review')
      assert.equal((await api.getMessageReviews('other')).length, 0)
      stopObserving()
      console.log(
        'Accounting cache checks passed: 50 warm reads without SQL; incremental root/subagent totals; provisional replacement; pricing and metadata invalidation; cold-reopen equivalence.'
      )

  } finally {
    await api.disposeDatabase()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
`,
  'chat-account-store': `
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
  'chat-archive-store': `
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
  'done-chats': `
          import assert from 'node:assert/strict'
          import Database from 'better-sqlite3'
          import * as chat from './src/main/database/chat'
          import { getChatTurnOutcomes, setChatTurnOutcome } from './src/main/database/chatTurnOutcome'
          import { getDatabase, getSqliteConnection, disposeDatabase } from './src/main/database/sqlite'
          import { openPreferences } from './src/main/database/preferences'
          const run = async () => {
            // Upgrade an existing installation without assigning invented completion times.
            const legacy = new Database(process.env.SELE_DATABASE_PATH)
            legacy.exec("CREATE TABLE chat (id TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0); INSERT INTO chat (id, done) VALUES ('legacy', 1)")
            legacy.close()
            const openings = Array.from({ length: 20 }, () => getDatabase())
            assert.ok(openings.every(opening => opening === openings[0]), 'startup shares one schema initialization')
            await Promise.all(openings)
            const connection = getSqliteConnection()
            assert.equal(connection.pragma('journal_mode', { simple: true }), 'wal')
            assert.equal(connection.pragma('synchronous', { simple: true }), 2, 'FULL durability')
            const preferences = openPreferences(connection)
            preferences.migrate({ 'sele:test': 'saved' })
            const changes = () => connection.pragma('data_version', { simple: true })
            const beforeDuplicatePreferences = connection.prepare('SELECT total_changes() AS count').get().count
            preferences.setMany({ 'sele:test': 'saved', 'sele:missing': null })
            assert.equal(connection.prepare('SELECT total_changes() AS count').get().count, beforeDuplicatePreferences, 'unchanged preferences perform no writes')
            assert.throws(() => preferences.setMany({ 'sele:test': 'saved', invalid: 'bad' }))
            // A reader on another connection cannot hold up a UI metadata write.
            const reader = new Database(process.env.SELE_DATABASE_PATH)
            reader.exec('BEGIN')
            reader.prepare('SELECT * FROM chat').all()
            await chat.setChatSeen('wal-reader', 10)
            reader.exec('ROLLBACK')
            reader.close()
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
            const beforeDuplicateSeen = changes()
            await chat.setChatSeen('first', 5000)
            await chat.setChatSeen('first', 4000)
            assert.equal(changes(), beforeDuplicateSeen, 'duplicate and older markers perform no writes')
            assert.equal((await chat.getChatMetadata('first')).seenUpdatedAt, 5000)
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
  'limit-reset-store': `
          import assert from 'node:assert/strict'
          import { getDatabase, disposeDatabase } from './src/main/database/sqlite'
          import { limitResetMessageBackend as backend } from './src/main/database/limitResetMessages'
          import { sqlitePendingMessageBackend } from './src/main/database/pendingMessages'
          import { createLimitResetDelivery } from './src/main/providers/LimitResetDelivery'
          import { LimitResetQueue } from './src/main/providers/LimitResetQueue'
          const now = 1800000000000
          let clock = now
          const sent = ['existing normal message']
          const makeQueue = () => new LimitResetQueue(backend, async entry => { sent.push(entry.content) }, () => clock)
          const run = async () => {
            const options = { model:'test-model', sandboxMode:'workspace-write', approvalPolicy:'on-request', approvalsReviewer:'user', serviceTier:null }
            const limits = [{id:'primary',label:'Codex',kind:'primary',usedPercent:100,windowMinutes:300,resetsAt:(now+1000)/1000}]
            let queue = makeQueue()
            await queue.add('codex','chat','first',options,limits)
            await queue.add('codex','chat','second',options,limits)
            await queue.close()
            await disposeDatabase()
            queue = makeQueue()
            assert.deepEqual((await queue.list('codex','chat')).map(entry=>entry.content),['first','second'])
            assert.equal((await queue.list('codex','chat'))[0].createdAt, now)
            await queue.tick()
            assert.deepEqual(sent,['existing normal message'])
            await queue.close()
            await disposeDatabase()
            clock = now+2000
            queue = makeQueue()
            await queue.tick()
            assert.deepEqual(sent,['existing normal message','first','second'])
            assert.deepEqual(await backend.list(),[])
            await queue.close()
            await disposeDatabase()
            await makeQueue().tick()
            assert.deepEqual(sent,['existing normal message','first','second'])
            await disposeDatabase()
            // Simulate process exit after the handoff commits but before its caller returns.
            queue = makeQueue()
            clock = now
            await queue.add('codex','chat','atomic handoff',options,limits)
            const [entry] = await backend.list()
            await sqlitePendingMessageBackend.replace('codex','chat', [{id:entry.id, kind:'queued', submitted:false, createdAt:now, payload:JSON.stringify({id:entry.id,text:entry.content,options})}])
            await queue.close()
            await disposeDatabase()
            assert.deepEqual(await backend.list(),[])
            assert.equal((await sqlitePendingMessageBackend.read('codex','chat'))[0].id, entry.id)
            clock = now+2000
            await makeQueue().tick()
            assert.deepEqual(sent,['existing normal message','first','second'])
            await disposeDatabase()
            // A draft has no native chat until execution, including across a real DB reopen.
            let created = 0
            const target = {draftKey:'new-chat-repo'}
            const makeDraftQueue = () => new LimitResetQueue(backend, createLimitResetDelivery({
              backend,
              prepare:async entry=>({...entry.options,cwd:'/prepared-repo'}),
              create:async (entry,onCreated)=>{created++;assert.equal(entry.accountId,'saved-account');await onCreated('lazy-chat')},
              saveMetadata:async()=>{},
              enqueue:async entry=>sqlitePendingMessageBackend.replace('codex',entry.chatId,[{id:entry.id,kind:'queued',submitted:false,createdAt:now,payload:JSON.stringify({id:entry.id,text:entry.content,options:entry.options})}])
            }),()=>clock)
            clock = now
            queue = makeDraftQueue()
            await queue.add('codex',target,'new chat later',options,limits,undefined,'saved-account')
            await queue.tick()
            assert.equal(created,0)
            assert.equal((await backend.list())[0].chatId,null)
            await queue.close()
            await disposeDatabase()
            clock = now+2000
            queue = makeDraftQueue()
            await queue.tick()
            assert.equal(created,1)
            assert.equal((await sqlitePendingMessageBackend.read('codex','lazy-chat')).length,1)
            await queue.close()
            await disposeDatabase()
            await makeDraftQueue().tick()
            assert.equal(created,1)
            assert.deepEqual(await backend.list(),[])
            await disposeDatabase()
            console.log('PASS reset queue SQLite persistence, FIFO, missed reset recovery and no repeated release')
          }
          run().catch(error => { console.error(error); process.exitCode = 1 })
        `,
  'no-project-store': `
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
  'persistent-chat-cache': `
          import assert from 'node:assert/strict'
          import {performance} from 'node:perf_hooks'
          import Database from 'better-sqlite3'
          import {getDatabase, getSqliteConnection, disposeDatabase} from './src/main/database/sqlite'
          import {SqliteChatHistoryCache} from './src/main/database/chatHistoryCache'
          import {PersistentChatHistory} from './src/main/providers/PersistentChatHistory'
          const run=async()=>{
            const legacy=new Database(process.env.SELE_DATABASE_PATH)
            legacy.exec("CREATE TABLE chat (id TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0); INSERT INTO chat (id,pinned) VALUES ('existing',1)")
            legacy.close()
            let now=1_000_000
            const store=new SqliteChatHistoryCache(getDatabase,()=>now)
            const item=(id,content=id)=>({type:'message',id,role:'user',content})
            const page={items:[item('a'),item('b')],itemsStartTurnIndex:10,turnCount:12,
              turnPagination:{kind:'cursor',olderCursor:'before',newerCursor:null}}
            assert.equal(await store.save('key','source-1',page,()=>true),true)
            await disposeDatabase()
            assert.deepEqual(await store.read('key','source-1'),page,'prepared turns survive closing and reopening SQLite')
            assert.equal(await store.read('key','source-2'),null,'native source changes miss')
            const db=await getDatabase()
            assert.equal((await db.selectFrom('chat').select('pinned').where('id','=','existing').executeTakeFirst()).pinned,1,'schema upgrade preserves existing metadata')
            const sql=getSqliteConnection()
            sql.exec('CREATE TABLE cache_writes (turn_id TEXT); CREATE TRIGGER cache_turn_update AFTER UPDATE ON chat_history_turn BEGIN INSERT INTO cache_writes VALUES (new.turn_id); END;')
            await store.save('key','source-1',page,()=>true)
            assert.equal(sql.prepare('SELECT COUNT(*) n FROM cache_writes').get().n,0,'unchanged turns do not rewrite payloads')
            const edited={...page,items:[item('a'),item('b','edited')]}
            await store.save('key','source-1',edited,()=>true)
            assert.deepEqual(sql.prepare('SELECT turn_id FROM cache_writes').all(),[{turn_id:'b'}],'only the edited turn updates')
            assert.deepEqual(await store.read('key','source-1'),edited)
            await store.save('key','source-1',{...page,items:[item('b'),item('c')]},()=>true)
            assert.deepEqual(sql.prepare('SELECT turn_id FROM chat_history_turn WHERE cache_key=? ORDER BY position').all('key'),[{turn_id:'b'},{turn_id:'c'}],'old turns are removed with the new page')
            assert.equal(await store.save('oversized','source',{items:[item('huge','x'.repeat(2_000_001))]},()=>true),false)
            assert.equal(await store.read('oversized','source'),null)
            assert.equal(await store.save('too-many','source',{items:Array.from({length:11},(_,i)=>item('turn-'+i))},()=>true),false)
            let checks=0
            await store.save('raced','source',page,()=>++checks<4)
            assert.equal(await store.read('raced','source'),null,'invalidation during a write cannot leave a reusable row')
            await db.updateTable('chat_history_page').set({format_version:999}).where('cache_key','=','key').execute()
            assert.equal(await store.read('key','source-1'),null,'format changes invalidate persisted projections')
            await store.save('key','source-1',page,()=>true)
            await db.deleteFrom('chat_history_turn').where('cache_key','=','key').where('turn_id','=','b').execute()
            assert.equal(await store.read('key','source-1'),null,'partial/corrupt pages miss atomically')
            assert.equal(sql.prepare('SELECT COUNT(*) n FROM chat_history_turn WHERE cache_key=?').get('key').n,0,'corrupt pages remove orphaned turns')
            await store.save('key','source-1',page,()=>true)
            await db.updateTable('chat_history_turn').set({payload:'[]'}).where('cache_key','=','key').execute()
            assert.equal(await store.read('key','source-1'),null,'payload checksums detect corruption')
            await store.save('old','source',page,()=>true)
            now+=8*24*60*60*1000
            assert.equal(await store.read('old','source'),null,'expired projections miss')
            const clear=async()=>{await db.deleteFrom('chat_history_turn').execute();await db.deleteFrom('chat_history_page').execute()}
            await clear()
            for(let i=0;i<100;i++){now++;await store.save('lru-'+i,'source',page,()=>true)}
            now++;await store.read('lru-0','source')
            now++;await store.save('lru-100','source',page,()=>true)
            assert.ok(await store.read('lru-0','source'),'recently read page survives LRU eviction')
            assert.equal(await store.read('lru-1','source'),null,'oldest page is evicted')
            assert.equal(sql.prepare('SELECT COUNT(*) n FROM chat_history_page').get().n,100)
            assert.equal(sql.prepare('SELECT COUNT(*) n FROM chat_history_turn t LEFT JOIN chat_history_page p ON t.cache_key=p.cache_key WHERE p.cache_key IS NULL').get().n,0)
            await clear()
            const large={items:[item('large','x'.repeat(1_750_000))]}
            for(let i=0;i<40;i++){now++;await store.save('bytes-'+i,'source',large,()=>true)}
            assert.ok(sql.prepare('SELECT SUM(byte_size) n FROM chat_history_page').get().n<=64_000_000,'total retained payload bytes are bounded')
            assert.equal(await store.read('bytes-0','source'),null)
            assert.ok(await store.read('bytes-39','source'))
            await clear()
            const chat={providerId:'codex',id:'restart',createdAt:1,updatedAt:2,title:'Fixture',preview:'Answer',cwd:'/fixture',container:null,status:null,done:false,purpose:null}
            const admit=cache=>{cache.setAccount('codex',null,{accounts:[{id:'fixture',active:true}]},cache.accountEpoch('codex'));cache.observe([chat])}
            let cache=new PersistentChatHistory(store);admit(cache)
            await cache.save(cache.begin('codex','restart'),{...chat,revision:100,items:Array.from({length:10},(_,i)=>item('r'+i,'Prepared text '.repeat(1000))),turnCount:10})
            await disposeDatabase()
            cache=new PersistentChatHistory(new SqliteChatHistoryCache(getDatabase,()=>now));admit(cache)
            const samples=[]
            for(let i=0;i<11;i++) {const start=performance.now();const preview=await cache.preview('codex','restart');samples.push(performance.now()-start);assert.equal(preview.items.length,10);assert.equal(preview.revision,-1);assert.equal(preview.writeAccess,'checking')}
            console.log('SQLite prepared-page read median ms:',samples.slice(1).sort((a,b)=>a-b)[5].toFixed(3))
            await disposeDatabase()
            console.log('PASS Persistent chat cache: migration, restart, incremental turns, scopes, corruption, expiry, races, LRU, and byte bounds')
          }
          run().catch(error=>{console.error(error);process.exitCode=1})
        `,
  'sqlite-worker': `
        import assert from 'node:assert/strict'
        import {sql} from 'kysely'
        import fs from 'node:fs/promises'
        import {getDatabase,getSqliteConnection,disposeDatabase} from './src/main/database/sqlite'
        import {getPreferenceStorage} from './src/main/database/preferenceStorage'
        import {openPreferences} from './src/main/database/preferences'
        const run=async()=>{
          const openings=Array.from({length:20},()=>getDatabase())
          assert.ok(openings.every(opening=>opening===openings[0]))
          const db=await openings[0]
          assert.equal((await sql.raw('pragma synchronous').execute(db)).rows[0].synchronous,2)
          await sql.raw('create table fixture (id integer primary key, value text, bytes blob)').execute(db)
          const inserted=await db.insertInto('fixture').values({id:1,value:'one',bytes:Buffer.from([1,2,3])}).executeTakeFirst()
          assert.equal(inserted.insertId,1n)
          assert.equal(inserted.numInsertedOrUpdatedRows,1n)
          const row=await db.selectFrom('fixture').selectAll().executeTakeFirstOrThrow()
          assert.ok(Buffer.isBuffer(row.bytes));assert.deepEqual([...row.bytes],[1,2,3])
          await assert.rejects(db.transaction().execute(async trx=>{
            await trx.insertInto('fixture').values({id:2,value:'rollback'}).execute()
            throw new Error('rollback fixture')
          }),/rollback fixture/)
          assert.equal((await db.selectFrom('fixture').selectAll().execute()).length,1)
          await db.transaction().execute(async trx=>{
            await sql.raw('savepoint "quoted savepoint"').execute(trx)
            await trx.insertInto('fixture').values({id:2,value:'savepoint rollback'}).execute()
            await sql.raw('rollback to "quoted savepoint"').execute(trx)
            await sql.raw('release "quoted savepoint"').execute(trx)
          })
          const controlled = await db.startTransaction().execute()
          const saved = await controlled.savepoint('quoted"point').execute()
          await saved.insertInto('fixture').values({id:2,value:'controlled rollback'}).execute()
          await saved.rollbackToSavepoint('quoted"point').execute()
          await saved.releaseSavepoint('quoted"point').execute()
          await controlled.commit().execute()
          await assert.rejects(sql.raw('select * from missing_fixture_table').execute(db),error=>error.code==='SQLITE_ERROR')
          await Promise.all(Array.from({length:30},(_,i)=>db.insertInto('fixture').values({id:i+10,value:String(i)}).execute()))
          const streamed=[]
          for await(const item of db.selectFrom('fixture').selectAll().orderBy('id').stream(7)){
            streamed.push(item);if(streamed.length===11)break
          }
          assert.equal(streamed.length,11)
          await assert.rejects(async()=>{for await(const item of db.selectFrom('fixture').selectAll().stream(NaN)){}},/positive integer/)
          // Invalid streaming options also release the statement and transaction mutex.
          assert.equal((await db.selectFrom('fixture').select('id').execute()).length,31)
          const legacy=openPreferences(getSqliteConnection())
          legacy.migrate({'sele:theme':'legacy','sele:keep':'untouched'})
          const prefs=await getPreferenceStorage()
          const pref=(action)=>({kind:'preferences',senderId:7,request:action})
          const load=()=>prefs.request(pref({action:'load'}))
          assert.equal((await load()).value['sele:theme'],'legacy','existing preferences migrate atomically')
          const write=(revision,value)=>pref({action:'write',sourceId:'fixture',revision,values:{'sele:theme':value}})
          const older=prefs.request(write(1,'older'))
          prefs.commitPreferences(write(2,'close barrier'))
          await older
          await prefs.request(write(1,'late stale batch'))
          assert.equal((await load()).value['sele:theme'],'close barrier')
          await assert.rejects(db.transaction().execute(async trx=>{
            await trx.insertInto('fixture').values({id:3,value:'pending transaction'}).execute()
            prefs.commitPreferences(write(3,'independent commit'))
            throw new Error('rollback after preference close')
          }),/rollback after preference close/)
          assert.equal((await load()).value['sele:theme'],'independent commit')
          assert.equal(legacy.load()['sele:theme'],'legacy','migration never rewrites the legacy table')
          let completed=false,ticks=0
          const timer=setInterval(()=>ticks++,5)
          const busy=sql.raw('with recursive n(x) as (values(0) union all select x+1 from n where x<3000000) select sum(x) as value from n').execute(db).then(result=>{completed=true;return result})
          await new Promise(resolve=>setTimeout(resolve,20))
          assert.equal(completed,false,'the fixture executes substantial real SQLite work')
          await prefs.request(write(4,'responsive while SQL is busy'))
          assert.equal(completed,false,'preferences have an independent execution lane')
          assert.equal((await busy).rows[0].value,4500001500000)
          clearInterval(timer)
          assert.ok(ticks>=5,'the calling event loop kept running: '+ticks)
          await Promise.all([disposeDatabase(),disposeDatabase()])
          const reopened=await getDatabase()
          assert.equal((await reopened.selectFrom('fixture').select('id').execute()).length,31)
          const reopenedPrefs=await getPreferenceStorage()
          assert.equal((await reopenedPrefs.request(pref({action:'load'}))).value['sele:theme'],'responsive while SQL is busy')
          assert.equal((await reopenedPrefs.request(pref({action:'load'}))).value['sele:keep'],'untouched')
          await disposeDatabase()
          // Startup errors must preserve native diagnostics and release the failed
          // initialization promise so repaired storage can be reopened.
          for (const [file,open] of [
            [process.env.SELE_DATABASE_PATH,getDatabase],
            [process.env.SELE_DATABASE_PATH+'.preferences.sqlite',getPreferenceStorage]
          ]) {
            await fs.rename(file,file+'.saved')
            const invalid='deliberately invalid SQLite fixture'
            await fs.writeFile(file,invalid)
            await assert.rejects(open(),error=>error.code==='SQLITE_NOTADB' && /file is not a database/.test(error.message))
            assert.equal(await fs.readFile(file,'utf8'),invalid)
            await fs.unlink(file)
            await fs.rename(file+'.saved',file)
            await open()
            await disposeDatabase()
          }
          console.log('SQLite worker passed: real busy-query responsiveness ('+ticks+' timer ticks), transactions, cursors, errors, binary rows, ordered preference barriers, independent commits, migration, reopen and failed-startup recovery')
        }
        run().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>disposeDatabase())
      `
}
const filters = process.argv.slice(2).map((value) => value.toLowerCase())
const selected = [...Object.keys(cases), 'conversation-views'].filter(
  (name) => !filters.length || filters.some((filter) => name.includes(filter))
)
assert.ok(selected.length, 'No database tests matched: ' + filters.join(', '))

for (const name of selected) {
  test(name, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-database-'))
    try {
      const entry = path.join(directory, 'fixture.cjs')
      await require('esbuild').build({
        ...(cases[name]
          ? {
              stdin: {
                contents: cases[name],
                resolveDir: path.resolve(__dirname, '../..'),
                loader: 'ts'
              }
            }
          : { entryPoints: [path.join(__dirname, 'fixtures/conversation-views-store.ts')] }),
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
                namespace: 'fixture'
              }))
              build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents:
                  'export const app = { getPath() { throw new Error("Real profile access is forbidden") } }'
              }))
            }
          }
        ]
      })
      // Electron's Node ABI matches better-sqlite3; this never starts an app or windows.
      const result = spawnSync(require('electron'), [entry], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          SELE_DATABASE_PATH: path.join(directory, 'test.sqlite')
        },
        encoding: 'utf8',
        timeout: 60000
      })
      process.stdout.write(result.stdout || '')
      process.stderr.write(result.stderr || '')
      assert.equal(result.status, 0, String(result.error || name + ' failed'))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
}
