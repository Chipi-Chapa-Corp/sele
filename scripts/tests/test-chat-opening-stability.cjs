// Verify painted text while the real workspace progressively mounts history.
// Uses synthetic APIs and a temporary profile. Run through isolated-gui.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const provider = process.env.SELE_TEST_PROVIDER === 'claude' ? 'claude' : 'codex'
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-opening-stability-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import './src/renderer/src/assets/main.css'
            const noop = () => {}
            const now = Date.now()
            const chats = Array.from({length:20}, (_,i) => ({id:String(i),providerId:'${provider}',
              title:'Conversation '+i,preview:'',createdAt:now-i*1000,updatedAt:now-i*1000,
              status:null,cwd:'/fixture',cwdKind:'directory',projectCwd:null,branchName:null,
              worktreeBaseBranchName:null,pinned:false,sidebarOrder:null,done:false,
              seenUpdatedAt:now,purpose:null,container:null}))
            const items = Array.from({length:10}, (_,i) => [
              {id:'user-'+i,type:'message',role:'user',content:'Inspect migration stage '+i},
              {id:'answer-'+i,type:'message',role:'assistant',content:
                '### Migration stage '+i+'\\n\\n'+Array.from({length:2+i%4},(_,j)=>
                  'Paragraph '+j+': Review the **migration results** and verify all records remain available. Check reads, writes, indexes, and rollback behavior before continuing.').join('\\n\\n')+
                '\\n\\nThe visible text must remain completely stationary while older history fills above it.'}
            ]).flat()
            const tools=Array.from({length:42},(_,i)=>({type:'tool',id:'tool-'+i,toolId:'Read',
              status:'finished',activity:'reading',icon:null,label:'Read migration file '+i,
              command:null,cwd:'/fixture',stdout:null,diffs:[],backgroundSessionId:null,
              finishedBackgroundSessionId:null,rawInput:{path:'file-'+i+'.ts'},rawOutput:null,images:[]}))
            const singleTurn=count=>[items.at(-2),{id:'working',type:'working',status:'worked',items:tools.slice(0,count)},items.at(-1)]
            const detail=(id,revision=1,history=id==='3'?singleTurn(1):items)=>({
              ...chats.find(chat=>chat.id===id),revision,capabilities:{editMessages:true,activeMessages:true},
              pendingApproval:null,pendingUserInput:null,contextUsage:null,items:history,
              subagents:[],turnCount:history.length===0?0:id==='3'?1:10,itemsStartTurnIndex:0,
              ...('${provider}'==='claude'?{turnPagination:{kind:'cursor',olderCursor:null,newerCursor:null}}:{})})
            let revision=1
            window.growTools=count=>{
              const snapshot=detail('3',++revision,singleTurn(count))
              window.chatListener?.({providerId:'${provider}',chatId:'3',sequence:revision,
                detail:{...snapshot,baseRevision:null,baseItemIds:null,itemIds:snapshot.items.map(item=>item.id),changedItems:snapshot.items},
                turnCompleted:false,summary:chats[3]})
            }
            const usage={updatedAt:now,statisticsLoaded:false,summary:null,dailyUsageBuckets:null,
              rateLimits:[],rateLimitResetCredits:null,errors:[]}
            const defaults={
              getSourceAvailability:()=>({gitAvailable:false,providers:[{providerId:'${provider}',available:true}]}),
              getChats:()=>({chats,nextCursor:null}),
              getChat:(_provider,id)=>['4','5'].includes(id)?new Promise(resolve=>{
                window.pendingChatReads??={};window.pendingChatReads[id]=()=>resolve(detail(id,1,id==='5'?[]:items))
              }):detail(id),
              markChatSeen:(_provider,id,seenUpdatedAt)=>({...chats.find(chat=>chat.id===id),seenUpdatedAt}),
              getModels:()=>[{id:'fixture',label:'Fixture model',description:'Fixture',isDefault:true,
                supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}],
              getAccounts:()=>({available:true,unavailableMessage:null,accounts:[]}),getUsage:()=>usage,
              getDefaultCwd:()=>'/fixture',getWindowState:()=>({isMaximized:false}),getAppUpdate:()=>null,
              getProjects:()=>[],getContainerSuggestions:()=>[],getSshEnvironments:()=>[],getChatContainers:()=>[],
              getInstalledFontFamilies:()=>[],getAgentModes:()=>[],getApprovalModes:()=>[],getSandboxModes:()=>[],
              getSkills:()=>[],getApps:()=>[],getChatTerminalTasks:()=>[],getCwdNotes:()=>[],getProjectIcon:()=>null,getSubagents:()=>[],
              getUpdateAvailability:()=>null
            }
            const api=new Proxy({}, {get:(_target,name)=>name==='onChatUpdated' ? listener=>{window.chatListener=listener;return noop} : name.startsWith('on') ? ()=>noop :
              (...args)=>Promise.resolve(defaults[name]?.(...args)??null)})
            Object.assign(window,{appApi:api,providerApi:api,terminalApi:api,browserApi:api})
            const stored=new Map([['sele:app-settings:v1',JSON.stringify({appearance:{position:'hidden'},
              chat:{collapseProgressOnFinish:false,collapseProgressOnNextTurn:false}})]])
            window.preferencesApi={getItem:key=>({ok:true,value:stored.get(key)??null}),
              setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}},
              removeItem:key=>{stored.delete(key);return {ok:true,value:null}}}
            window.addEventListener('error',event=>console.error(event.error?.stack??event.message))
            window.addEventListener('unhandledrejection',event=>console.error(event.reason?.stack??event.reason))
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
                contents: 'export default class { postMessage() {} terminate() {} }'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<html><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 60000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error))
        process.exitCode = 1
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, nativeImage } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    let win
    const errors = []
    try {
      win = new BrowserWindow({
        show: true,
        width: 1500,
        height: 950,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const ready = (condition) =>
        run(`new Promise((resolve,reject)=>{
        const deadline=performance.now()+10000;
        function check(){if(${condition})return resolve();
          if(performance.now()>deadline)return reject(new Error('Opening timed out'));requestAnimationFrame(check)}check()
      })`)
      await ready(`document.querySelector('[data-chat-id="1"] .chat-list-item__main')`)
      await run('document.fonts.ready')
      await run(`document.querySelector('[data-chat-id="4"] .chat-list-item__main').click()`)
      await ready(
        `window.pendingChatReads?.['4'] && document.querySelector('[role="status"][aria-label="Loading messages"]')`
      )
      assert.equal(
        await run(`document.querySelector('#chat-search-content').getAttribute('aria-busy')`),
        'true'
      )
      assert.equal(
        await run(
          `document.querySelectorAll('#chat-search-content [data-chat-message-id]').length`
        ),
        0
      )
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content')?.closest('.chat-detail__messages-shell').textContent.includes('No messages found.')`
        ),
        false
      )
      assert.equal(
        await run(`new Promise(resolve=>{let frames=0;function check(){
        if(!document.querySelector('[role="status"][aria-label="Loading messages"]'))return resolve(false);
        if(++frames===8)return resolve(true);requestAnimationFrame(check)}check()})`),
        true,
        'show a loader throughout a delayed initial history read'
      )
      await run(`window.pendingChatReads['4']()`)
      await ready(
        `document.querySelector('#chat-search-content [data-chat-message-id="answer-9"] p:last-child')`
      )
      assert.equal(
        await run(
          `Boolean(document.querySelector('[role="status"][aria-label="Loading messages"]'))`
        ),
        false
      )

      await run(`document.querySelector('[data-chat-id="5"] .chat-list-item__main').click()`)
      await ready(
        `window.pendingChatReads?.['5'] && document.querySelector('[role="status"][aria-label="Loading messages"]')`
      )
      await run(`window.pendingChatReads['5']()`)
      await ready(
        `document.querySelector('#chat-search-content')?.closest('.chat-detail__messages-shell')?.textContent.includes('No messages found.')`
      )
      assert.equal(
        await run(
          `Boolean(document.querySelector('[role="status"][aria-label="Loading messages"]'))`
        ),
        false
      )

      const cachedOpening = await run(`new Promise(resolve=>{
        const frames=[];const deadline=performance.now()+3000;
        document.querySelector('[data-chat-id="4"] .chat-list-item__main').click();
        function check(){
          if(document.querySelector('[data-chat-id="4"].chat-list-item--selected')){
            const messages=Boolean(document.querySelector('#chat-search-content [data-chat-message-id="answer-9"]'));
            frames.push({messages,loading:Boolean(document.querySelector('[role="status"][aria-label="Loading messages"]'))});
            if(messages)return resolve(frames)
          }
          if(performance.now()>deadline)return resolve(frames);requestAnimationFrame(check)
        }check()
      })`)
      assert.ok(
        cachedOpening.some((frame) => frame.messages),
        'cached messages mount'
      )
      assert.ok(
        cachedOpening.every((frame) => frame.messages || frame.loading),
        'cached opening never paints empty without a loader'
      )
      await run(`window.pendingChatReads['4']()`)
      const results = []
      for (const [zoom, id] of [
        [1, '1'],
        [1.25, '2'],
        [1.25, '3']
      ]) {
        win.webContents.setZoomFactor(zoom)
        await run(`document.querySelector('[data-chat-id="${id}"] .chat-list-item__main').click()`)
        await ready(
          `document.querySelector('#chat-search-content [data-chat-message-id="answer-9"] p:last-child')`
        )
        const rect =
          await run(`(()=>{const r=document.querySelector('#chat-search-content [data-chat-message-id="answer-9"] p:last-child').getBoundingClientRect();
          const ratio=devicePixelRatio;return {x:Math.ceil(r.x*ratio),y:Math.ceil(r.y*ratio),width:Math.floor(r.width*ratio)-2,height:Math.floor(r.height*ratio)-2}})()`)
        const frames = []
        const framePNGs = []
        const capture = (_event, method, params) => {
          if (method !== 'Page.screencastFrame') return
          const frame = nativeImage
            .createFromDataURL('data:image/png;base64,' + params.data)
            .crop(rect)
          frames.push(frame.toBitmap())
          framePNGs.push(frame.toPNG())
          if (!win.webContents.isDestroyed())
            win.webContents.debugger
              .sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId })
              .catch(() => {})
        }
        win.webContents.debugger.on('message', capture)
        await win.webContents.debugger.sendCommand('Page.startScreencast', {
          format: 'png',
          everyNthFrame: 1
        })
        if (id === '3') {
          for (const count of [7, 14, 21, 28, 35, 42]) {
            await run(`window.growTools(${count})`)
            await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
          }
          assert.equal(
            await run(
              'document.querySelectorAll("#chat-search-content [data-chat-turn-id]").length'
            ),
            1
          )
          assert.ok(
            await run('document.querySelector("#chat-search-content .chat-detail__working").open'),
            'render expanded tool history'
          )
        } else {
          await ready(
            `document.querySelectorAll('#chat-search-content [data-chat-turn-id]').length===10`
          )
        }
        await run('new Promise(r=>setTimeout(r,150))')
        await win.webContents.debugger.sendCommand('Page.stopScreencast')
        win.webContents.debugger.removeListener('message', capture)
        const final = (await win.webContents.capturePage()).crop(rect).toBitmap()
        // CDP starts with a cached surface that may precede the selected chat's first paint.
        const paintedFrames = frames.slice(1)
        const changed = paintedFrames.filter((frame) => !frame.equals(final)).length
        results.push({
          zoom,
          history: id === '3' ? 'single turn with 42 tools' : '10 turns',
          frames: paintedFrames.length,
          changed
        })
        if (changed) {
          const output = path.resolve(__dirname, '../../test-results/chat-opening-stability')
          await fs.mkdir(output, { recursive: true })
          await fs.writeFile(
            path.join(output, 'final.png'),
            (await win.webContents.capturePage()).toPNG()
          )
          await fs.writeFile(
            path.join(output, 'final-crop.png'),
            (await win.webContents.capturePage()).crop(rect).toPNG()
          )
          for (let i = 0; i < framePNGs.length; i++)
            await fs.writeFile(path.join(output, 'crop-' + i + '.png'), framePNGs[i])
          console.log(
            'rect before/after',
            rect,
            await run(
              `document.querySelector('#chat-search-content [data-chat-message-id="answer-9"] p:last-child').getBoundingClientRect().toJSON()`
            )
          )
        }
        assert.ok(
          paintedFrames.length >= 5,
          'capture painted loading frames: ' + JSON.stringify(results)
        )
        assert.equal(
          changed,
          0,
          'visible text pixels must stay identical while history loads: ' + JSON.stringify(results)
        )
      }
      assert.deepEqual(errors, [])
      console.log('Opening stability checks passed: ' + JSON.stringify(results))
    } catch (error) {
      console.error(error, errors)
      code = 1
    }
    if (win && !win.webContents.isDestroyed() && win.webContents.debugger.isAttached())
      win.webContents.debugger.detach()
    app.exit(code)
  })
}
