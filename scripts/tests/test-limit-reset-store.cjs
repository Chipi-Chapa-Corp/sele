const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

;(async () => {
  const directory = await fs.mkdtemp(
    path.join(require('node:os').tmpdir(), 'sele-limit-reset-store-')
  )
  try {
    const entry = path.join(directory, 'database-check.cjs')
    await require('esbuild').build({
      stdin: {
        contents: `
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
    assert.equal(result.status, 0, String(result.error || 'Reset queue database checks failed'))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
