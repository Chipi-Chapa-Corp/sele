// Native Electron SQLite ABI, disposable files, no application or GUI.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
;(async () => {
  const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-sqlite-worker-'))
  try {
    const entry = path.join(directory, 'check.cjs')
    await require('esbuild').build({
      stdin: {
        resolveDir: path.resolve(__dirname, '../..'),
        loader: 'ts',
        contents: `
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
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: entry,
      plugins: [
        require('./helpers/node-workers.cjs')(directory),
        {
          name: 'native-fixture',
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
                'export const app={getPath(){throw new Error("Real profile access is forbidden")}}'
            }))
          }
        }
      ]
    })
    const result = require('node:child_process').spawnSync(require('electron'), [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        SELE_DATABASE_PATH: path.join(directory, 'fixture.sqlite')
      },
      encoding: 'utf8',
      timeout: 25000
    })
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    assert.equal(result.status, 0, String(result.error || 'SQLite worker fixture failed'))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
