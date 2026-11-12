// Full App + durable conversation views, with deferred fixture provider replies.
// Run through isolated-gui. No real profile or provider processes.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

const fixtureItems = (id, prefix) =>
  Array.from({ length: id === 'first' ? 10 : id === 'cold' ? 4 : 1 }, (_, index) => [
    { type: 'message', id: id + ':user-' + index, role: 'user', content: 'Question ' + index },
    ...(id === 'cold'
      ? [
          {
            type: 'working',
            id: id + ':work-' + index,
            status: 'worked',
            items: [],
            startedAt: 1,
            completedAt: 2
          }
        ]
      : []),
    {
      type: 'message',
      id: id + ':answer-' + index,
      role: 'assistant',
      content:
        prefix +
        ' ' +
        id +
        '\n\n' +
        (id === 'first'
          ? Array.from(
              { length: 40 },
              (_, paragraph) =>
                'Paragraph ' + paragraph + ': ' + 'Saved messages remain readable. '.repeat(8)
            ).join('\n\n')
          : '')
    }
  ]).flat()

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
          export {getDatabase,getReadDatabase,disposeDatabase} from './src/main/database/sqlite'
          export {getChatMetadata} from './src/main/database/chat'
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
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixtureNative',{
          list:()=>ipcRenderer.invoke('fixture:list'),
          holdWriter:()=>ipcRenderer.invoke('fixture:hold-writer'),
          cached:(_provider,id)=>{if(id!=='cold')throw new Error('Prepared opening must not reread disk');return ipcRenderer.invoke('fixture:cached',id)}
        })`
      )
      await require('esbuild').build({
        entryPoints: [path.join(root, 'src/renderer/src/chatMarkdown.worker.ts')],
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: {
          'decode-named-character-reference': path.join(
            root,
            'node_modules/decode-named-character-reference/index.js'
          )
        },
        outfile: path.join(directory, 'markdown-worker.js')
      })
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
          import React from 'react'
          import {createRoot} from 'react-dom/client'
          import './src/renderer/src/assets/main.css'
          const noop=()=>{};
          const fixtureItems=${fixtureItems.toString()};
          window.viewport=()=>{const element=document.getElementById('chat-search-content');
            return {top:element.scrollTop,gap:element.scrollHeight-element.clientHeight-element.scrollTop}};
          window.scrollPreferenceWrites=[];
          const chats=['first','second','unknown','empty','fallback','no-default','cold'].map(id=>({id,providerId:'codex',createdAt:1,updatedAt:999,
            title:'Cached '+id,preview:'Saved answer',cwd:'/fixture',cwdKind:'directory',projectCwd:null,
            branchName:null,worktreeBaseBranchName:null,container:null,status:null,pinned:false,sidebarOrder:null,
            done:false,seenUpdatedAt:2,purpose:null,lastTurnOutcome:null,pendingApproval:null}));
          window.pending={};window.sends=0;window.discovery=0;window.chatReads={};window.accountSelections=[];
          window.defaultSelected=false;
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
          window.openColdChat=()=>new Promise((resolve,reject)=>{
            const start=performance.now();let firstReadableMs=null;let firstReadableTurns=null;let firstSelectionMs=null;let blankSelectedFrames=0;
            document.querySelector('[data-chat-id="cold"] .chat-list-item__main').click();
            requestAnimationFrame(function sample(){
              const content=document.getElementById('chat-search-content');
              const turns=content?.querySelectorAll('[data-chat-turn-id]').length??0;
              if(document.querySelector('.chat-list-item--selected')?.dataset.chatId==='cold'){
                firstSelectionMs??=performance.now()-start;
                if(!content?.textContent.includes('Saved answer cold'))blankSelectedFrames++;
              }
              if(content?.textContent.includes('Saved answer cold')){
                firstReadableMs??=performance.now()-start;firstReadableTurns??=turns;
                if(turns===4)return resolve({firstSelectionMs,blankSelectedFrames,firstReadableMs,firstReadableTurns,allTurnsMs:performance.now()-start});
              }
              if(performance.now()-start>8000)return reject(Error('Cold chat did not load'));
              requestAnimationFrame(sample);
            });
          });
          window.setDraft=()=>{const textarea=document.querySelector('.chat-panel__composer textarea');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Draft while refreshing');
            textarea.dispatchEvent(new Event('input',{bubbles:true}));};
          window.fresh=id=>({...chats.find(chat=>chat.id===id),revision:1,writeAccess:'writable',
            capabilities:{editMessages:true,activeMessages:true},pendingApproval:null,pendingUserInput:null,
            contextUsage:null,subagents:[],turnCount:id==='first'?10:id==='cold'?4:1,itemsStartTurnIndex:0,
            items:fixtureItems(id,'Fresh authoritative')});
          const usage={updatedAt:2,statisticsLoaded:false,summary:null,dailyUsageBuckets:null,rateLimits:[],rateLimitResetCredits:null,errors:[]};
          const defaults={
            getSourceAvailability:()=>({gitAvailable:false,providers:[{providerId:'codex',available:true}]}),
            getKnownChats:async()=>({chats:chats.filter(chat=>chat.id!=='unknown'),nextCursor:null,conversationViews:await window.fixtureNative.list()}),
            getChats:()=>new Promise(resolve=>{window.discovery++;window.finishDiscovery=()=>resolve({chats,nextCursor:null,conversationViews:[]})}),
            continueChat:()=>{window.sends++;throw new Error('Unexpected send from cached preview')},
            getCachedChat:(...args)=>window.fixtureNative.cached(...args),
            getChat:(_provider,id)=>new Promise((resolve,reject)=>{window.chatReads[id]=(window.chatReads[id]||0)+1;window.pending[id]={resolve,reject}}),
            markChatSeen:(_provider,id,seenUpdatedAt)=>({...chats.find(chat=>chat.id===id),seenUpdatedAt}),
            getModels:()=>[{id:'fixture',label:'Fixture',isDefault:true,supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}],
            getAccounts:(_provider,options)=>({available:true,unavailableMessage:null,
              accounts:options?.chatId==='fallback'
                ?[{id:'default',displayName:'Default Account',active:window.defaultSelected}]
                :options?.chatId==='no-default'?[{id:'alternate',active:false}]:[{id:'fixture',active:true}]}),
            useAccount:(_provider,id,options)=>{window.accountSelections.push({id,chatId:options?.chatId});
              window.defaultSelected=true;return {available:true,unavailableMessage:null,accounts:[{id,active:true}]};},
            getUsage:()=>usage,getDefaultCwd:()=>'/fixture',getWindowState:()=>({isMaximized:false}),getAppUpdate:()=>null,
            getProjects:()=>[],getContainerSuggestions:()=>[],getSshEnvironments:()=>[],getChatContainers:()=>[],
            getInstalledFontFamilies:()=>[],getAgentModes:()=>[],getApprovalModes:()=>[],getSandboxModes:()=>[],
            getSkills:()=>[],getApps:()=>[],getCwdNotes:()=>[],getProjectIcon:()=>null,getSubagents:()=>[],
            getChatTerminalTasks:()=>[],listAgentSessions:()=>[],getLimitResetMessages:()=>[],getUpdateAvailability:()=>null
          };
          const api=new Proxy({}, {get:(_target,name)=>name.startsWith('on')?()=>noop:(...args)=>Promise.resolve(defaults[name]?.(...args)??null)});
          Object.assign(window,{appApi:api,providerApi:api,terminalApi:api,browserApi:api});
          const stored=new Map([
            ['sele:app-settings:v1',JSON.stringify({appearance:{position:'hidden'},chat:{recentChatCacheLimit:0}})],
            ['sele:chat-viewport:v1:["codex","host",null,"first"]',JSON.stringify({following:false,anchor:{turnId:'first:user-2',offset:0}})]
          ]);
          window.preferencesApi={getItem:key=>({ok:true,value:stored.get(key)??null}),
            setItem:(key,value)=>{if(key.startsWith('sele:chat-viewport:'))window.scrollPreferenceWrites.push(key);stored.set(key,value);return {ok:true,value:null}},removeItem:key=>{stored.delete(key);return {ok:true,value:null}}};
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
              build.onLoad({ filter: /.*/, namespace: 'worker' }, ({ path: worker }) => ({
                contents: worker.includes('chatMarkdown.worker')
                  ? `export default class extends Worker {constructor(){super('./markdown-worker.js')}}`
                  : 'export default class {postMessage(){} terminate(){}}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
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
      const headers = ['first', 'second', 'empty', 'fallback', 'no-default', 'cold'].map((id) => ({
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
      let views = new backend.SqliteConversationViews(backend.getDatabase, backend.getReadDatabase)
      for (const chat of headers) {
        const detail = backend.prepareChatDetailForRenderer({
          ...chat,
          revision: 1000,
          capabilities: { editMessages: true, activeMessages: true },
          turnCount:
            chat.id === 'empty' ? 0 : chat.id === 'first' ? 10 : chat.id === 'cold' ? 4 : 1,
          itemsStartTurnIndex: 0,
          items: chat.id === 'empty' ? [] : fixtureItems(chat.id, 'Saved answer')
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
      views = new backend.SqliteConversationViews(backend.getDatabase, backend.getReadDatabase)
      ipcMain.handle('fixture:list', async () => {
        const scopes = headers
          .filter((chat) => chat.id !== 'cold')
          .map((chat) => identity.viewScope('codex', chat.id))
        return [...(await views.read(scopes, { opening: true })).values()]
      })
      ipcMain.handle('fixture:cached', async (_, id) => {
        await backend.getChatMetadata(id)
        const scope = identity.viewScope('codex', id)
        return (await views.read([scope])).get(scope.key)
      })
      let heldWrite
      ipcMain.handle('fixture:hold-writer', async () => {
        const db = await backend.getDatabase()
        let started
        const ready = new Promise((resolve) => {
          started = resolve
        })
        heldWrite = db.transaction().execute(async (trx) => {
          await trx.insertInto('chat').values({ id: 'unrelated-background-write' }).execute()
          started()
          await new Promise((resolve) => setTimeout(resolve, 1200))
        })
        await ready
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
          `new Promise((resolve,reject)=>{const deadline=performance.now()+8000;function check(){if(${condition})return resolve();if(performance.now()>deadline)return reject(new Error('Timed out: '+${JSON.stringify(condition)}+'; reads='+JSON.stringify(window.chatReads)+'; selections='+JSON.stringify(window.accountSelections)+'; composer='+document.querySelector('.chat-panel__composer')?.textContent));requestAnimationFrame(check)}check()})`
        )
      await ready(`document.querySelector('[data-chat-id="first"] .chat-list-item__main')`)
      assert.ok(
        await run('discovery >= 1'),
        'local rows become selectable with native discovery still pending'
      )
      assert.equal(
        await run('Object.keys(pending).length'),
        0,
        'publishing known views never opens a writable provider chat'
      )
      await run('window.fixtureNative.holdWriter()')
      const coldOpen = await run('openColdChat()')
      console.log(
        'Cold SQLite opening during unrelated writer transaction: ' + JSON.stringify(coldOpen)
      )
      if (process.env.SELE_CHAT_OPEN_RESULTS) {
        await fs.mkdir(process.env.SELE_CHAT_OPEN_RESULTS, { recursive: true })
        await fs.writeFile(
          path.join(process.env.SELE_CHAT_OPEN_RESULTS, 'cold-opening.json'),
          JSON.stringify(coldOpen, null, 2)
        )
        await fs.writeFile(
          path.join(process.env.SELE_CHAT_OPEN_RESULTS, 'cold-opening.png'),
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await heldWrite
      assert.ok(coldOpen.firstReadableMs < 200, 'saved chat must not queue behind unrelated writes')
      assert.equal(
        coldOpen.firstReadableTurns,
        4,
        'small histories paint completely, without per-turn frame delays'
      )
      assert.equal(
        coldOpen.blankSelectedFrames,
        0,
        'local selection and saved messages paint together'
      )
      await run(`pending.cold.resolve(fresh('cold'))`)
      const firstOpen = await run(`openChat('first')`)

      assert.match(
        firstOpen.text,
        /Paragraph 39:/,
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
        `document.querySelector('.chat-panel__composer [aria-label="Request error"]')?.textContent.includes('Fixture provider offline')`
      )
      assert.equal(await run(`document.querySelector('.chat-detail__history-preview')`), null)
      assert.equal(
        await run(`document.querySelectorAll('[aria-label="Request error"]').length`),
        1,
        'saved history uses the shared bottom request error without duplicate notices'
      )
      if (process.env.SELE_ERROR_SCREENSHOT) {
        await fs.mkdir(path.dirname(process.env.SELE_ERROR_SCREENSHOT), { recursive: true })
        await fs.writeFile(
          process.env.SELE_ERROR_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
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
        `document.querySelector('.chat-panel__composer [aria-label="Request error"] button').click()`
      )
      await ready(`window.chatReads.second === 2`)
      await run(`pending.second.reject(new Error('Fixture retry failed'))`)
      await ready(
        `document.querySelector('.chat-panel__composer [aria-label="Request error"]')?.textContent.includes('Fixture retry failed')`
      )
      await run(
        `document.querySelector('.chat-panel__composer [aria-label="Request error"] button').click()`
      )
      await ready(`window.chatReads.second === 3`)
      await run(`pending.second.resolve(fresh('second'))`)
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Fresh authoritative second')`
      )
      await ready(
        `!document.querySelector('.chat-panel__composer [aria-label="Send message"]').disabled`
      )
      assert.equal(await run(`document.querySelector('[aria-label="Request error"]')`), null)
      const emptyOpen = await run(`openChat('empty')`)
      assert.equal(emptyOpen.loader, false, 'a known empty conversation is ready, not loading')
      await run(`finishDiscovery()`)
      await ready(`document.querySelector('[data-chat-id="unknown"] .chat-list-item__main')`)
      const unknownOpen = await run(`openChatBeforePaint('unknown')`)
      assert.equal(unknownOpen.loader, false, 'the loader is delayed past fast openings')
      await ready(`document.querySelector('[aria-label="Loading messages"]')`)
      await run(`pending.unknown.reject(new Error('Fixture uncached load failed'))`)
      await ready(
        `document.querySelector('.chat-panel__composer [aria-label="Request error"]')?.textContent.includes('Fixture uncached load failed')`
      )
      assert.equal(
        await run(`document.querySelector('.chat-detail__messages-status[role="alert"]')`),
        null,
        'uncached failures use the same bottom banner'
      )
      await run(
        `document.querySelector('.chat-panel__composer [aria-label="Request error"] button').click()`
      )
      await ready(`window.chatReads.unknown === 2`)
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
      await run(`openChat('fallback')`)
      await ready(`window.defaultSelected && window.chatReads.fallback >= 2`)
      assert.deepEqual(await run('window.accountSelections'), [
        { id: 'default', chatId: 'fallback' }
      ])
      await run(`pending.fallback.resolve(fresh('fallback'))`)
      await ready(
        `document.getElementById('chat-search-content')?.textContent.includes('Fresh authoritative fallback')`
      )
      await run('setDraft()')
      await ready(
        `!document.querySelector('.chat-panel__composer [aria-label="Send message"]').disabled`
      )
      assert.equal(await run(`document.querySelector('[aria-label="Request error"]')`), null)
      await run(`openChat('no-default')`)
      await ready(`window.pending['no-default']`)
      await run(`pending['no-default'].reject(new Error('Fixture no account available'))`)
      await ready(
        `document.querySelector('.chat-panel__composer [aria-label="Request error"]')?.textContent.includes('Fixture no account available')`
      )
      assert.equal(await run('window.accountSelections.length'), 1, 'no fallback without Default')
      await run(`openChat('first')`)
      await ready(`!document.querySelector('[aria-label="Request error"]')`)
      await run(`pending.first.resolve(fresh('first'))`)
      await ready(
        `document.querySelectorAll('#chat-search-content [data-chat-turn-id]').length===10`
      )
      await ready(`viewport().gap<=1`)
      await run(`document.getElementById('chat-search-content').scrollTop *= 0.5`)
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      assert.ok((await run('viewport()')).gap > 1000, 'scroll away from latest')
      await run(`(async()=>{await openChat('second');await openChat('first')})()`)
      await ready('viewport().gap<=1')
      assert.ok((await run('viewport()')).top > 1000, 'reopening goes to the latest message')
      assert.deepEqual(
        await run('scrollPreferenceWrites'),
        [],
        'scroll position is never persisted'
      )
      await win.loadFile(path.join(directory, 'index.html'))
      await ready(`document.querySelector('[data-chat-id="first"] .chat-list-item__main')`)
      const restart = await run(`openChat('first')`)
      assert.equal(restart.loader, false)
      await ready(
        `document.querySelectorAll('#chat-search-content [data-chat-turn-id]').length===10`
      )
      await ready('viewport().gap<=1')
      assert.ok(
        (await run('viewport()')).top > 1000,
        'SQLite messages reopen at the bottom after restart'
      )
      await ready(
        `document.getElementById('chat-search-content').textContent.includes('Paragraph 0:')`
      )
      const firstText = await run(`document.getElementById('chat-search-content').textContent`)
      assert.match(firstText, /Question 0/, 'SQLite retains the whole processed list')
      assert.match(firstText, /Paragraph 0:/, 'long messages retain their beginning')
      assert.match(firstText, /Paragraph 39:/, 'long messages retain their end')
      assert.equal(await run('Boolean(pending.first)'), true, 'the provider is still pending')
      assert.deepEqual(await run('scrollPreferenceWrites'), [])
      if (process.env.SELE_MESSAGES_SCREENSHOT)
        await fs.writeFile(
          process.env.SELE_MESSAGES_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      assert.deepEqual(
        errors.filter(
          (error) =>
            !/Fixture (?:provider offline|retry failed|uncached load failed|no account available)/.test(
              error
            )
        ),
        []
      )
      console.log(
        'PASS durable known-chat opening: selection before paint ' +
          previewMs.toFixed(1) +
          ' ms, normal second click visible before next paint (' +
          secondOpen.ms.toFixed(1) +
          ' ms); full SQLite message list, long text, refresh, retry and bottom-on-reopen/restart passed'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    await backend.disposeDatabase()
    app.exit(code)
  })
}
