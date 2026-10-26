// Real React lane interleaving, using fixture data and a temporary profile.
// Run through isolated-gui.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-view-state-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React,{Suspense,startTransition,useLayoutEffect} from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {useChatViewState} from './src/renderer/src/workspace/useChatViewState'
            import {getChatDetailFromUpdate} from './src/renderer/src/workspace/chatControllerUtils'
            import {useAccountUsageState} from './src/renderer/src/workspace/useAccountUsageState'
            const blocked=new Map()
            const chat=id=>({id,providerId:'codex'})
            const detail=(id,revision=1)=>({id,revision,items:[]})
            window.commits=[]
            function Gate({id}) {if(blocked.has(id))throw blocked.get(id).promise;return null}
            function Probe(){
              const view=useChatViewState();window.viewApi=view
              useLayoutEffect(()=>{window.commits.push([view.selectedChat?.id??null,view.chatDetail?.id??null,view.chatDetail?.revision??null])})
              return <><output id="view">{JSON.stringify([view.selectedChat?.id??null,view.chatDetail?.id??null,view.chatDetail?.revision??null])}</output><Gate id={view.selectedChat?.id}/></>
            }
            window.hold=id=>{let release;const promise=new Promise(resolve=>release=resolve);blocked.set(id,{promise,release})}
            window.release=id=>{const block=blocked.get(id);blocked.delete(id);block.release()}
            window.selectNow=id=>flushSync(()=>viewApi.selectChatView(chat(id),detail(id)))
            window.navigate=id=>startTransition(()=>viewApi.selectChatView(chat(id),detail(id)))
            window.refreshNow=(id,revision)=>flushSync(()=>viewApi.setChatDetail(detail(id,revision)))
            window.selectMetadata=id=>flushSync(()=>viewApi.setSelectedChat(chat(id)))
            window.clearOldNow=()=>flushSync(()=>window.oldClear(null))
            window.checkAcknowledgement=()=>{
              const current={id:'a',revision:1,container:null,items:[{id:'message',type:'message',role:'user',content:'Unchanged'}]}
              const next=structuredClone(current)
              const result=getChatDetailFromUpdate({...next,revision:2,baseRevision:null,baseItemIds:null,itemIds:['message'],changedItems:next.items},current)
              return {applied:result.detailApplied,reused:result.detail.items===current.items,revision:result.detail.revision}
            }
            createRoot(document.getElementById('root')).render(<Suspense fallback={<span>Loading</span>}><Probe/></Suspense>)
            const usageHost=document.createElement('div');document.body.append(usageHost)
            const usageRoot=createRoot(usageHost),usageScopes=new Map(['a','b'].map(id=>[id,{id}]))
            function UsageProbe({id}) {
              const usage=useAccountUsageState(usageScopes.get(id));window.usageApi=usage
              return <output id="usage">{JSON.stringify([id,usage.accountUsage?.updatedAt??null,usage.accountUsageState,usage.accountUsageError])}</output>
            }
            window.renderUsage=id=>flushSync(()=>usageRoot.render(<UsageProbe id={id}/>))
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        {
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw new Error(result.stderr || String(result.error))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { backgroundThrottling: false }
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const wait = () => run('new Promise(resolve=>setTimeout(resolve,40))')
      const state = () => run('JSON.parse(document.getElementById("view").textContent)')
      await wait()
      assert.deepEqual(
        await run('checkAcknowledgement()'),
        { applied: true, reused: true, revision: 2 },
        'reused IPC snapshots remain valid delta bases'
      )
      await run('selectNow("a");hold("b");navigate("b")')
      await wait()
      assert.deepEqual(await state(), ['a', 'a', 1])
      await run('refreshNow("b",2)')
      assert.deepEqual(
        await state(),
        ['a', 'a', 1],
        'new-chat replies cannot overwrite the still visible old chat'
      )
      await run('release("b")')
      await wait()
      assert.deepEqual(
        await state(),
        ['b', 'b', 2],
        'the pending reply rebases onto its matching navigation'
      )
      await run('hold("c");navigate("c")')
      await wait()
      await run('refreshNow("b",7);release("c")')
      await wait()
      assert.deepEqual(
        await state(),
        ['c', 'c', 1],
        'old-chat replies cannot overwrite the next chat after rebasing'
      )
      await run('hold("a");navigate("a");navigate("d")')
      await wait()
      assert.deepEqual(
        await state(),
        ['d', 'd', 1],
        'rapid navigation commits the latest complete view'
      )
      await run(
        'release("a");selectNow("a");window.oldClear=viewApi.setChatDetail;hold("b");navigate("b")'
      )
      await wait()
      await run('clearOldNow();release("b")')
      await wait()
      assert.deepEqual(
        await state(),
        ['b', 'b', 1],
        'a failed old-chat read cannot clear the pending new transcript'
      )
      await run('selectNow("d")')
      await run('selectMetadata("d")')
      assert.deepEqual(await state(), ['d', 'd', 1], 'metadata retains the matching transcript')
      await run('selectMetadata("e")')
      assert.deepEqual(
        await state(),
        ['e', null, null],
        'uncached selections never inherit another transcript'
      )
      assert.equal(await run('commits.some(([chat,detail])=>detail!==null&&chat!==detail)'), false)
      await run(
        'renderUsage("a");usageApi.setAccountUsage({updatedAt:1});usageApi.setAccountUsageState("ready")'
      )
      await wait()
      assert.deepEqual(await run('JSON.parse(document.getElementById("usage").textContent)'), [
        'a',
        1,
        'ready',
        null
      ])
      await run('window.oldUsage=usageApi;renderUsage("b")')
      assert.deepEqual(
        await run('JSON.parse(document.getElementById("usage").textContent)'),
        ['b', null, 'loading', null],
        'the first new-account render cannot expose old usage'
      )
      await run(
        'oldUsage.setAccountUsage({updatedAt:999});oldUsage.setAccountUsageError("Old error")'
      )
      await wait()
      assert.deepEqual(
        await run('JSON.parse(document.getElementById("usage").textContent)'),
        ['b', null, 'loading', null],
        'late old-account replies are ignored'
      )
      await run('usageApi.setAccountUsage({updatedAt:2});usageApi.setAccountUsageState("ready")')
      await wait()
      assert.deepEqual(await run('JSON.parse(document.getElementById("usage").textContent)'), [
        'b',
        2,
        'ready',
        null
      ])
      console.log(
        'Chat view state checks passed: interleaved replies, atomic navigation, rapid selection, metadata.'
      )
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
