// Disposable native SQLite integration. Electron runs as Node: no app or GUI.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-history-cache-'))
  try {
    const entry = path.join(directory, 'check.cjs')
    await require('esbuild').build({
      stdin: {
        resolveDir: path.resolve(__dirname, '../..'),
        loader: 'ts',
        contents: `
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
        `
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: entry,
      plugins: [
          require('./helpers/node-workers.cjs')(directory),
        {
          name: 'isolated-native-cache',
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
      timeout: 60000
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, String(result.error || 'SQLite cache fixture failed'))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
