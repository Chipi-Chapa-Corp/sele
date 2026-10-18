// Full App/controller navigation with empty chats and synthetic API responses.
// Run through isolated-gui. Never starts provider processes or opens real profiles.
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-workspace-'))
    try {
      await require('esbuild').build({
        entryPoints: [path.join(root, 'src/renderer/src/components/vegvisir.worker.ts')],
        bundle: true,
        outfile: path.join(directory, 'art.worker.js')
      })
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
          import React from 'react'
          import {createRoot} from 'react-dom/client'
          import {App} from './src/renderer/src/App'
          createRoot(document.getElementById('root')).render(<App/>);
          window.frameGaps=[];window.longTasks=[];
          new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration)))
            .observe({type:'longtask',buffered:true});
          let before=performance.now();
          requestAnimationFrame(function frame(now){window.frameGaps.push(now-before);before=now;requestAnimationFrame(frame)});
          window.measureNavigation=async destination=>{
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            window.frameGaps=[];window.longTasks=[];
            window.fixtureRowRenders=[];window.fixtureMotionRenders=0;
            const spinner=document.querySelector('[data-chat-id="0"] .chat-list-item__loading');
            if(!spinner)throw new Error('Missing background running spinner');
            const start=performance.now();
            const button=destination==='new' ? document.querySelector('button[aria-label="New chat"]') :
              document.querySelector('[data-chat-id="'+destination+'"] .chat-list-item__main');
            if(!button)throw new Error('No navigation button '+destination);
            button.click();
            const clickMs=performance.now()-start;
            await new Promise(resolve=>setTimeout(resolve,300));
            return {destination,clickMs,maxFrameGap:Math.max(...window.frameGaps),longTasks:window.longTasks,
              selected:document.querySelector('.chat-list-item--selected')?.dataset.chatId??null,
              spinnerRetained:spinner===document.querySelector('[data-chat-id="0"] .chat-list-item__loading'),
              rowRenders:window.fixtureRowRenders.length,rowIds:[...new Set(window.fixtureRowRenders)].slice(0,10),uniqueRows:new Set(window.fixtureRowRenders).size,motionRenders:window.fixtureMotionRenders,
              messages:document.querySelectorAll('[data-chat-message-id]').length};
          };
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
            name: 'fixture-workers',
            setup(build) {
              build.onLoad(
                { filter: /(?:ChatListItem\.tsx|MotionListItem\.tsx)$/ },
                async (args) => {
                  let contents = await fs.readFile(args.path, 'utf8')
                  contents = args.path.endsWith('ChatListItem.tsx')
                    ? contents.replace(
                        '  const chatTitle =',
                        '  window.fixtureRowRenders.push(chat.id);\n  const chatTitle ='
                      )
                    : contents.replace(
                        '  const present =',
                        '  window.fixtureMotionRenders++;\n  const present ='
                      )
                  return { contents, loader: 'tsx', resolveDir: path.dirname(args.path) }
                }
              )
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, (args) => ({
                contents: args.path.includes('vegvisir')
                  ? "export default class extends Worker {constructor(){super(new URL('art.worker.js',document.baseURI))}}"
                  : 'export default class {constructor(){throw new Error("Editor outside navigation fixture")}}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'api.js'),
        `
        const now=Date.now();
        window.fixtureChats=Array.from({length:400},(_,i)=>({id:String(i),providerId:'codex',title:'Empty conversation '+i,
          preview:'',createdAt:now-i*1000,updatedAt:now-i*1000,status:i===0?'active':null,cwd:'/fixture/project-'+(i%20),
          cwdKind:'directory',projectCwd:null,branchName:null,worktreeBaseBranchName:null,pinned:false,sidebarOrder:null,
          done:false,seenUpdatedAt:now,purpose:null,container:null}));
        window.fixtureCalls=[];
        window.fixtureRowRenders=[];window.fixtureMotionRenders=0;
        const usage={updatedAt:now,statisticsLoaded:false,summary:null,dailyUsageBuckets:null,rateLimits:[],rateLimitResetCredits:null,errors:[]};
        const detail=id=>({...fixtureChats.find(chat=>chat.id===id),revision:1,capabilities:{editMessages:true,activeMessages:true},
          pendingApproval:null,pendingUserInput:null,contextUsage:null,items:[],subagents:[],turnCount:0,itemsStartTurnIndex:0});
        const defaults={
          getSourceAvailability:()=>({gitAvailable:false,providers:[{providerId:'codex',available:true}]}),
          getChats:()=>({chats:fixtureChats,nextCursor:null}),getChat:(_provider,id)=>detail(id),
          markChatSeen:(_provider,id,seenUpdatedAt)=>({...fixtureChats.find(chat=>chat.id===id),seenUpdatedAt}),
          getModels:()=>[{id:'fixture',label:'Fixture model',description:'Fixture',isDefault:true,supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}],
          getAccounts:()=>({available:true,unavailableMessage:null,accounts:[]}),getUsage:()=>usage,
          getDefaultCwd:()=>'/fixture/project-0',getWindowState:()=>({isMaximized:false}),getAppUpdate:()=>null,
          getProjects:()=>[],getContainerSuggestions:()=>[],getSshEnvironments:()=>[],getChatContainers:()=>[],
          getInstalledFontFamilies:()=>[],getAgentModes:()=>[],getApprovalModes:()=>[],getSandboxModes:()=>[],
          getSkills:()=>[],getApps:()=>[],getCwdNotes:()=>[],getProjectIcon:()=>null,getSubagents:()=>[],
          getUpdateAvailability:()=>null
        };
        const api=new Proxy({}, {get:(_target,name)=>{
          if(name==='onChatUpdated')return listener=>{window.fixtureChatListener=listener;return ()=>{if(window.fixtureChatListener===listener)window.fixtureChatListener=null}};
          if(name.startsWith('on'))return ()=>()=>{};
          return (...args)=>{fixtureCalls.push(name);return Promise.resolve(defaults[name]?.(...args)??null)};
        }});
        window.appApi=api;window.providerApi=api;window.terminalApi=api;window.browserApi=api;
        window.beginBackgroundUpdates=()=>{let revision=10;return setInterval(()=>{
          revision++;
          window.fixtureChatListener?.({providerId:'codex',chatId:'0',detail:null,sequence:revision,turnCompleted:false,
            summary:{...fixtureChats[0],revision,currentActivity:null,previewLength:0,updatedAt:Date.now()}})
        },100)};
        const stored=new Map();
        window.preferencesApi={getItem:key=>({ok:true,value:stored.get(key)??null}),
          setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}},
          removeItem:key=>{stored.delete(key);return {ok:true,value:null}}};
        window.addEventListener('error',event=>console.error('Fixture error',event.error?.stack??event.message));
        window.addEventListener('unhandledrejection',event=>console.error('Fixture rejection',event.reason?.stack??event.reason));
      `
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="api.js"></script><script src="fixture.js"></script></html>'
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
  const { app, BrowserWindow } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const errors = []
      const win = new BrowserWindow({
        show: true,
        width: 1500,
        height: 950,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      await run('new Promise(resolve=>setTimeout(resolve,1200))')
      await run('window.backgroundUpdates=window.beginBackgroundUpdates()')
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Profiler.enable')
      await win.webContents.debugger.sendCommand('Profiler.start')
      const results = []
      for (const destination of ['1', '2', 'new', '1', 'new', '3', 'new']) {
        results.push(await run('window.measureNavigation(' + JSON.stringify(destination) + ')'))
      }
      const { profile } = await win.webContents.debugger.sendCommand('Profiler.stop')
      const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
      const counts = new Map()
      for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
        const frame = nodes.get(profile.samples[i]).callFrame
        const name = frame.functionName || '(anonymous)'
        counts.set(name, (counts.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
      }
      console.log(
        JSON.stringify(
          {
            results,
            errors,
            hotFunctions: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25),
            calls: await run('[...new Set(window.fixtureCalls)]')
          },
          null,
          2
        )
      )
      assert.deepEqual(errors, [])
      for (const result of results) {
        assert.equal(result.messages, 0, 'this regression must exercise empty conversations')
        assert.equal(result.selected, result.destination === 'new' ? null : result.destination)
        assert.equal(
          result.spinnerRetained,
          true,
          'navigation preserves the background running spinner'
        )
        assert.ok(
          result.uniqueRows <= 3,
          'only the previous selection, next selection and running chat should render: ' +
            JSON.stringify(result)
        )
        assert.ok(result.rowRenders < 40, 'empty navigation must not rerender the whole sidebar')
        assert.ok(
          result.motionRenders < 500,
          'presence context must not rerender all animation wrappers'
        )
      }
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
