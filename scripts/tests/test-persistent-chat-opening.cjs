// Full App + durable conversation views, with deferred fixture provider replies.
// Run through isolated-gui. No real profile or provider processes.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-sqlite-opening-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'ts',
          contents: `
          export {getDatabase,disposeDatabase} from './src/main/database/sqlite'
          export {SqliteChatHistoryCache} from './src/main/database/chatHistoryCache'
          export {SqliteConversationViews} from './src/main/database/conversationViews'
          export {createConversationView} from './src/shared/conversationView'
          export {PersistentChatHistory} from './src/main/providers/PersistentChatHistory'
          export {prepareChatDetailForRenderer} from './src/main/providers/chatDetailLazy'
        `
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        outfile: path.join(directory, 'backend.cjs'),
        plugins: [
          require('./helpers/node-workers.cjs')(directory),
          {
            name: 'native-sqlite',
            setup(build) {
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixtureNative',{list:()=>ipcRenderer.invoke('fixture:list'),cached:()=>{throw new Error('Known opening must never read a disk preview after selection')}})`
      )
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
          import React from 'react'
          import {createRoot} from 'react-dom/client'
          import './src/renderer/src/assets/main.css'
          const noop=()=>{};
          const chats=['first','second','unknown','empty'].map(id=>({id,providerId:'codex',createdAt:1,updatedAt:999,
            title:'Cached '+id,preview:'Saved answer',cwd:'/fixture',cwdKind:'directory',projectCwd:null,
            branchName:null,worktreeBaseBranchName:null,container:null,status:null,pinned:false,sidebarOrder:null,
            done:false,seenUpdatedAt:2,purpose:null,lastTurnOutcome:null,pendingApproval:null}));
          window.pending={};window.sends=0;window.discovery=0;
          // A navigation transition may retain the old screen for a frame.
          // Inspect the first paint selecting the destination, with its provider held.
          window.openChatBeforePaint=id=>new Promise((resolve,reject)=>{const start=performance.now();
            document.querySelector('[data-chat-id="'+id+'"] .chat-list-item__main').click();
            requestAnimationFrame(function sample(){
              if(document.querySelector('.chat-list-item--selected')?.dataset.chatId===id)
                return resolve({ms:performance.now()-start,
                  text:document.getElementById('chat-search-content')?.textContent,
                  loader:Boolean(document.querySelector('[aria-label="Loading messages"]'))});
              if(performance.now()-start>8000)return reject(new Error('Selection did not paint: '+id));
              requestAnimationFrame(sample);
            });});
          window.openChat=window.openChatBeforePaint;
          window.setDraft=()=>{const textarea=document.querySelector('.chat-panel__composer textarea');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Draft while refreshing');
            textarea.dispatchEvent(new Event('input',{bubbles:true}));};
          window.fresh=id=>({...chats.find(chat=>chat.id===id),revision:1,writeAccess:'writable',
            capabilities:{editMessages:true,activeMessages:true},pendingApproval:null,pendingUserInput:null,
            contextUsage:null,subagents:[],turnCount:1,itemsStartTurnIndex:0,
            items:[{type:'message',id:id+':user',role:'user',content:'Question'},
              {type:'message',id:id+':answer',role:'assistant',content:'Fresh authoritative '+id}]});
          const usage={updatedAt:2,statisticsLoaded:false,summary:null,dailyUsageBuckets:null,rateLimits:[],rateLimitResetCredits:null,errors:[]};
          const defaults={
            getSourceAvailability:()=>({gitAvailable:false,providers:[{providerId:'codex',available:true}]}),
            getKnownChats:async()=>({chats:chats.filter(chat=>chat.id!=='unknown'),nextCursor:null,conversationViews:await window.fixtureNative.list()}),
            getChats:()=>new Promise(resolve=>{window.discovery++;window.finishDiscovery=()=>resolve({chats,nextCursor:null,conversationViews:[]})}),
            continueChat:()=>{window.sends++;throw new Error('Unexpected send from cached preview')},
            getCachedChat:(...args)=>window.fixtureNative.cached(...args),
            getChat:(_provider,id)=>new Promise((resolve,reject)=>{window.pending[id]={resolve,reject}}),
            markChatSeen:(_provider,id,seenUpdatedAt)=>({...chats.find(chat=>chat.id===id),seenUpdatedAt}),
            getModels:()=>[{id:'fixture',label:'Fixture',isDefault:true,supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}],
            getAccounts:()=>({available:true,unavailableMessage:null,accounts:[{id:'fixture',active:true}]}),
            getUsage:()=>usage,getDefaultCwd:()=>'/fixture',getWindowState:()=>({isMaximized:false}),getAppUpdate:()=>null,
            getProjects:()=>[],getContainerSuggestions:()=>[],getSshEnvironments:()=>[],getChatContainers:()=>[],
            getInstalledFontFamilies:()=>[],getAgentModes:()=>[],getApprovalModes:()=>[],getSandboxModes:()=>[],
            getSkills:()=>[],getApps:()=>[],getCwdNotes:()=>[],getProjectIcon:()=>null,getSubagents:()=>[],
            getChatTerminalTasks:()=>[],getLimitResetMessages:()=>[],getUpdateAvailability:()=>null
          };
          const api=new Proxy({}, {get:(_target,name)=>name.startsWith('on')?()=>noop:(...args)=>Promise.resolve(defaults[name]?.(...args)??null)});
          Object.assign(window,{appApi:api,providerApi:api,terminalApi:api,browserApi:api});
          const stored=new Map([['sele:app-settings:v1',JSON.stringify({appearance:{position:'hidden'},chat:{recentChatCacheLimit:0}})]]);
          window.preferencesApi={getItem:key=>({ok:true,value:stored.get(key)??null}),
            setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}},removeItem:key=>{stored.delete(key);return {ok:true,value:null}}};
          window.addEventListener('error',event=>console.error(event.error?.stack??event.message));
          window.addEventListener('unhandledrejection',event=>console.error(event.reason?.stack??event.reason));
          import('./src/renderer/src/App').then(({App})=>createRoot(document.getElementById('root')).render(<App/>));
        `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        define: { 'process.env.NODE_ENV': '"production"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'unused-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {postMessage(){} terminate(){}}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env, SELE_DATABASE_PATH: path.join(directory, 'fixture.sqlite') }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 45000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error)
        throw new Error(result.stderr || String(result.error || 'Opening fixture failed'))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    const backend = require(path.join(directory, 'backend.cjs'))
    try {
      const headers = ['first', 'second', 'empty'].map((id) => ({
        providerId: 'codex',
        id,
        createdAt: 1,
        updatedAt: 2,
        title: 'Cached ' + id,
        preview: 'Saved answer',
        cwd: '/fixture',
        container: null,
        status: null,
        done: false,
        purpose: null
      }))
      const admit = (cache) => {
        cache.setAccount(
          'codex',
          null,
          { accounts: [{ id: 'fixture', active: true }] },
          cache.accountEpoch('codex')
        )
        cache.observe(headers)
      }
      let identity = new backend.PersistentChatHistory(
        new backend.SqliteChatHistoryCache(backend.getDatabase)
      )
      admit(identity)
      let views = new backend.SqliteConversationViews(backend.getDatabase)
      for (const chat of headers) {
        const detail = backend.prepareChatDetailForRenderer({
          ...chat,
          revision: 1000,
          capabilities: { editMessages: true, activeMessages: true },
          turnCount: chat.id === 'empty' ? 0 : 1,
          itemsStartTurnIndex: 0,
          items:
            chat.id === 'empty'
              ? []
              : [
                  { type: 'message', id: chat.id + ':user', role: 'user', content: 'Question' },
                  {
                    type: 'message',
                    id: chat.id + ':answer',
                    role: 'assistant',
                    content: 'Saved answer ' + chat.id
                  }
                ]
        })
        await views.write(
          identity.viewScope('codex', chat.id),
          backend.createConversationView(detail)
        )
      }
      await backend.disposeDatabase()
      identity = new backend.PersistentChatHistory(
        new backend.SqliteChatHistoryCache(backend.getDatabase)
      )
      admit(identity)
      views = new backend.SqliteConversationViews(backend.getDatabase)
      ipcMain.handle('fixture:list', async () => {
        const scopes = headers.map((chat) => identity.viewScope('codex', chat.id))
        return [...(await views.read(scopes)).values()]
      })
      const win = new BrowserWindow({
        show: true,
        width: 1400,
        height: 950,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          backgroundThrottling: false
        }
      })
      const errors = []
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') {
          errors.push(event.message)
          console.error(event.message)
        }
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const ready = (condition) =>
        run(
          `new Promise((resolve,reject)=>{const deadline=performance.now()+8000;function check(){if(${condition})return resolve();if(performance.now()>deadline)return reject(new Error('Timed out: '+${JSON.stringify(condition)}));requestAnimationFrame(check)}check()})`
        )
      await ready(`document.querySelector('[data-chat-id="first"] .chat-list-item__main')`)
      assert.equal(
        await run('discovery'),
        1,
        'local rows become selectable with native discovery still pending'
      )
      assert.equal(
        await run('Object.keys(pending).length'),
        0,
        'publishing known views never opens a writable provider chat'
      )
      const firstOpen = await run(`openChat('first')`)

      assert.match(
        firstOpen.text,
        /Saved answer first/,
        'prepared messages paint on selection with provider replies withheld'
      )
      assert.equal(firstOpen.loader, false, 'no intermediate loading view')
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Saved answer first')`
      )
      const previewMs = firstOpen.ms
      assert.equal(
        await run(`document.querySelector('.chat-detail__history-preview')`),
        null,
        'known views do not display a refreshing loader'
      )
      await run('setDraft()')
      await ready(
        `document.querySelector('.chat-panel__composer [aria-label="Send message"]').disabled`
      )
      await run(
        `document.querySelector('.chat-panel__composer form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`
      )
      assert.equal(await run('sends'), 0, 'saved previews cannot send messages')
      const followUpError = await run(`new Promise(resolve=>{
        document.getElementById('chat-search-content').dispatchEvent(new CustomEvent('sele:visualization-follow-up',{
          bubbles:true,cancelable:true,detail:{prompt:'Follow up on saved content',reply:resolve}}))
      })`)
      assert.match(followUpError, /Unable to send/)
      assert.equal(
        await run('sends'),
        0,
        'alternate follow-up actions cannot bypass preview gating'
      )
      assert.equal(
        await run(`Boolean(window.pending.first)`),
        true,
        'history paints while the provider request is still pending'
      )
      if (process.env.SELE_CACHE_SCREENSHOT)
        await fs.writeFile(
          process.env.SELE_CACHE_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      await run(`pending.first.resolve(fresh('first'))`)
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Fresh authoritative first')`
      )
      await ready(
        `!document.querySelector('.chat-panel__composer [aria-label="Send message"]').disabled`
      )
      assert.equal(await run(`document.querySelector('.chat-detail__history-preview')`), null)
      const secondOpen = await run(`openChatBeforePaint('second')`)
      assert.match(
        secondOpen.text,
        /Saved answer second/,
        'normal clicks display prepared messages in the first selected paint'
      )
      assert.equal(secondOpen.loader, false)
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Saved answer second')`
      )
      await run(`setDraft();pending.second.reject(new Error('Fixture provider offline'))`)
      await ready(
        `document.querySelector('.chat-detail__history-preview')?.textContent.includes('Unable to refresh')`
      )
      await run(
        `document.querySelector('.chat-panel__composer form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`
      )
      assert.equal(
        await run('sends'),
        0,
        'failed previews remain unable to send during the visual switch hold'
      )
      await ready(
        `document.querySelector('.chat-panel__composer [aria-label="Send message"]').disabled`
      )
      await run(
        `document.querySelector('.chat-detail__history-preview button').click();window.retry=pending.second;void 0`
      )
      await run(`retry.resolve(fresh('second'))`)
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Fresh authoritative second')`
      )
      await ready(
        `!document.querySelector('.chat-panel__composer [aria-label="Send message"]').disabled`
      )
      const emptyOpen = await run(`openChat('empty')`)
      assert.equal(emptyOpen.loader, false, 'a known empty conversation is ready, not loading')
      await run(`finishDiscovery()`)
      await ready(`document.querySelector('[data-chat-id="unknown"] .chat-list-item__main')`)
      const unknownOpen = await run(`openChatBeforePaint('unknown')`)
      assert.equal(unknownOpen.loader, false, 'the loader is delayed past fast openings')
      await ready(`document.querySelector('[aria-label="Loading messages"]')`)
      await run(`pending.unknown.resolve(fresh('unknown'))`)
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Fresh authoritative unknown')`
      )
      await run(`openChat('first')`)
      const processedOpen = await run(`openChatBeforePaint('unknown')`)
      assert.equal(
        processedOpen.loader,
        false,
        'processing establishes the view even with the recent-chat cache disabled'
      )
      assert.match(processedOpen.text, /Fresh authoritative unknown/)
      assert.deepEqual(
        errors.filter((error) => !error.includes('Fixture provider offline')),
        []
      )
      console.log(
        'PASS durable known-chat opening: selection before paint ' +
          previewMs.toFixed(1) +
          ' ms, normal second click visible before next paint (' +
          secondOpen.ms.toFixed(1) +
          ' ms); providers remained pending; refresh, read-only failure and retry passed'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    await backend.disposeDatabase()
    app.exit(code)
  })
}
