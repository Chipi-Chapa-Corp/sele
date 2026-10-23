// Full App/controller navigation and completion with synthetic data.
// Set SELE_BENCHMARK_RICH_HISTORY=1 to include rich transcripts and cached switches.
// Set SELE_BENCHMARK_ACTIVE_CHATS=1 to switch rich conversations while both stream.
// Run through isolated-gui. Never starts provider processes or opens real profiles.
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const activeChats = process.env.SELE_BENCHMARK_ACTIVE_CHATS === '1'
if (activeChats) process.env.SELE_BENCHMARK_RICH_HISTORY = '1'
if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const richHistory = process.env.SELE_BENCHMARK_RICH_HISTORY === '1'
    const chatCount = Math.max(400, Number(process.env.SELE_BENCHMARK_CHAT_COUNT) || 1000)
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
          const root=createRoot(document.getElementById('root'));root.render(<App/>);window.unmountFixture=()=>root.unmount();
          window.frameGaps=[];window.longTasks=[];window.fixtureTurnNodes=new Map();
          new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration)))
            .observe({type:'longtask',buffered:true});
          let before=performance.now();
          requestAnimationFrame(function frame(now){window.frameGaps.push(now-before);before=now;requestAnimationFrame(frame)});
          window.measureNavigation=async (destination,action='select')=>{
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            window.frameGaps=[];window.longTasks=[];
            const paintSamples=[];
            let measuring=true;
            const sample=()=>{
              const selected=document.getElementsByClassName('chat-list-item--selected')[0]?.dataset.chatId??null;
              const content=document.getElementById('chat-search-content');
              const turns=content?[...content.getElementsByClassName('chat-detail__turn')].map(node=>node.dataset.chatTurnId):[];
              const shell=content?.parentElement;
              const loading=Boolean(shell?.getElementsByClassName('chat-detail__messages-status-icon--loading').length);
              paintSamples.push({ms:performance.now()-start,selected,turns,loading,faded:shell&&getComputedStyle(shell).opacity!=='1'});
              if(measuring)requestAnimationFrame(sample);
            };
            window.fixtureRowRenders=[];window.fixtureMotionRenders=0;window.fixtureGroupRenders=[];
            const spinner=document.querySelector('[data-chat-id="0"] .chat-list-item__loading');
            if(!spinner)throw new Error('Missing background running spinner');
            const historyRequests=window.fixtureCalls.filter(name=>name==='getChats').length;
            const detailRequests=window.fixtureCalls.filter(name=>name==='getChat').length;
            const selectedBefore=document.querySelector('.chat-list-item--selected')?.dataset.chatId??null;
            const styleSheetCount=document.styleSheets.length;
            const popLayoutRules=window.fixturePopLayoutRules;
            const canvasTransfers=window.fixtureCanvasTransfers;
            const start=performance.now();
            const measurementId='navigate:'+action+':'+destination+':'+start;
            const button=action==='done-project' ? document.querySelector('[data-chat-id="'+destination+'"]')?.closest('.chat-list-group').querySelector('[title="Mark project chats done"]') : action==='done' ? document.querySelector('[data-chat-id="'+destination+'"] [aria-label="Mark chat done"]') : destination==='new' ? document.querySelector('button[aria-label="New chat"]') :
              document.querySelector('[data-chat-id="'+destination+'"] .chat-list-item__main');
            if(!button)throw new Error('No navigation button '+destination);
            const affectedChatIds=action==='done-project' ? Array.from(button.closest('.chat-list-group').querySelectorAll('[data-chat-id]'),row=>row.dataset.chatId) : [destination];
            performance.mark(measurementId+':start');
            requestAnimationFrame(sample);
            button.click();
            const clickMs=performance.now()-start;
            await new Promise(resolve=>setTimeout(resolve,${richHistory ? 650 : 300}));
            if(${activeChats})await new Promise((resolve,reject)=>{
              const deadline=performance.now()+10000;
              function check(){if(document.querySelectorAll('#chat-search-content [data-chat-turn-id]').length===10)return resolve();
                if(performance.now()>deadline)return reject(new Error('Running history did not finish mounting'));requestAnimationFrame(check)}check()
            });
            measuring=false;
            performance.mark(measurementId+':end');
            const turnNodes=[...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')];
            const previousNodes=window.fixtureTurnNodes.get(destination);
            const reusedTurns=previousNodes?turnNodes.filter(node=>previousNodes.get(node.dataset.chatTurnId)===node).length:null;
            if(action==='select'&&destination!=='new'&&turnNodes.length)
              window.fixtureTurnNodes.set(destination,new Map(turnNodes.map(node=>[node.dataset.chatTurnId,node])));
            return {measurementId,destination,action,selectedBefore,affectedChatIds,clickMs,reusedTurns,
              detailRequests:window.fixtureCalls.filter(name=>name==='getChat').length-detailRequests,
              firstSelectionMs:paintSamples.find(sample=>sample.selected===destination)?.ms??null,
              firstMessagesMs:paintSamples.find(sample=>sample.selected===destination&&sample.turns.some(id=>id.startsWith(destination+':')))?.ms??null,
              allTurnsMs:paintSamples.find(sample=>sample.selected===destination&&sample.turns.length===10)?.ms??null,
              fadedFrames:paintSamples.filter(sample=>sample.selected&&sample.faded).length,
              mixedChatFrames:paintSamples.filter(sample=>sample.selected&&sample.turns.some(id=>!id.startsWith(sample.selected+':'))).length,
              blankFrames:paintSamples.filter(sample=>sample.selected===destination&&!sample.turns.length&&!sample.loading).length,canvasTransfers:window.fixtureCanvasTransfers-canvasTransfers,artActive:window.fixtureArtActive,styleSheetCountChange:document.styleSheets.length-styleSheetCount,popLayoutRules:window.fixturePopLayoutRules-popLayoutRules,
              groupRenders:[...new Set(window.fixtureGroupRenders)],
              unexpectedRowIds:[...new Set(window.fixtureRowRenders)].filter(id=>id!=='0'&&id!==selectedBefore&&!affectedChatIds.includes(id)),maxFrameGap:Math.max(...window.frameGaps),longTasks:window.longTasks,
              selected:document.querySelector('.chat-list-item--selected')?.dataset.chatId??null,
              spinnerRetained:spinner===document.querySelector('[data-chat-id="0"] .chat-list-item__loading'),
              rowRenders:window.fixtureRowRenders.length,rowIds:[...new Set(window.fixtureRowRenders)].slice(0,10),uniqueRows:new Set(window.fixtureRowRenders).size,motionRenders:window.fixtureMotionRenders,
              historyRequests:window.fixtureCalls.filter(name=>name==='getChats').length-historyRequests,messages:document.querySelectorAll('#chat-search-content [data-chat-message-id]').length,
              done:window.fixtureChats.find(chat=>chat.id===destination)?.done??false,
              activeRowPresent:Boolean(document.querySelector('.chat-list-group--cwd [data-chat-id="'+destination+'"]'))};
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
              if (process.env.SELE_BENCHMARK_UNRETAINED === '1') {
                build.onLoad({ filter: /RetainedChatViews\.tsx$/ }, () => ({
                  contents: 'export function RetainedChatViews({children}) { return children }',
                  loader: 'tsx'
                }))
              }
              build.onLoad(
                { filter: /(?:ChatListItem\.tsx|ChatListGroup\.tsx|MotionListItem\.tsx)$/ },
                async (args) => {
                  let contents = await fs.readFile(args.path, 'utf8')
                  contents = args.path.endsWith('ChatListGroup.tsx')
                    ? contents.replace(
                        '  const projectLike =',
                        '  window.fixtureGroupRenders.push(group.key);\n  const projectLike ='
                      )
                    : args.path.endsWith('ChatListItem.tsx')
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
                  ? "export default class extends Worker {constructor(){super(new URL('art.worker.js',document.baseURI));window.fixtureArtWorkers=(window.fixtureArtWorkers??0)+1} postMessage(...args){if(args[0]?.type==='active')window.fixtureArtActive=args[0].active;return super.postMessage(...args)} terminate(){window.fixtureArtTerminated=(window.fixtureArtTerminated??0)+1;return super.terminate()}}"
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
        window.fixturePopLayoutRules=0;
        const insertRule=CSSStyleSheet.prototype.insertRule;
        CSSStyleSheet.prototype.insertRule=function(rule,...args){
          if(rule.includes('data-motion-pop-id'))window.fixturePopLayoutRules++;
          return insertRule.call(this,rule,...args);
        };
        window.fixtureCanvasTransfers=0;
        const transfer=HTMLCanvasElement.prototype.transferControlToOffscreen;
        if(transfer)HTMLCanvasElement.prototype.transferControlToOffscreen=function(...args){fixtureCanvasTransfers++;return transfer.apply(this,args)};
        window.fixtureChats=Array.from({length:${chatCount}},(_,i)=>({id:String(i),providerId:'codex',title:'Empty conversation '+i,
          preview:'',createdAt:now-i*1000,updatedAt:now-i*1000,status:i===0||(${activeChats}&&i<3)?'active':null,cwd:'/fixture/project-'+(i===1?'single':i%20),
          cwdKind:'directory',projectCwd:null,branchName:null,worktreeBaseBranchName:null,pinned:false,sidebarOrder:null,
          done:false,seenUpdatedAt:now,purpose:null,container:null}));
        window.fixtureCalls=[];
        window.fixtureRowRenders=[];window.fixtureMotionRenders=0;window.fixtureGroupRenders=[];
        const usage={updatedAt:now,statisticsLoaded:false,summary:null,dailyUsageBuckets:null,rateLimits:[],rateLimitResetCredits:null,errors:[]};
        const histories=new Map();
        const history=id=>histories.get(id)??(${richHistory} ? Array.from({length:10},(_,i)=>[
          {id:id+':user-'+i,type:'message',role:'user',content:'Inspect '+id+' task '+i},
          {id:id+':answer-'+i,type:'message',role:'assistant',content:Array.from({length:40},(_,n)=>
            '### Section '+id+'-'+i+'-'+n+'\\n\\nFindings with **important text** and [source](/fixture/source'+n+'.ts:10).\\n\\n'+
            String.fromCharCode(96).repeat(3)+'ts\\nconst result'+n+' = {value: "'+id+'-'+i+'", ready: true};\\n'+String.fromCharCode(96).repeat(3)+'\\n\\n').join('')}
        ]).flat() : []);
        const detail=id=>({...fixtureChats.find(chat=>chat.id===id),revision:window.fixtureRevision??1,capabilities:{editMessages:true,activeMessages:true},
          pendingApproval:null,pendingUserInput:null,contextUsage:null,items:history(id),subagents:[],turnCount:${richHistory ? 10 : 0},itemsStartTurnIndex:0});
        const defaults={
          getSourceAvailability:()=>({gitAvailable:false,providers:[{providerId:'codex',available:true}]}),
          // IPC returns fresh objects; sharing the fixture's source objects hides list reloads.
          getChats:()=>({chats:fixtureChats.map(chat=>({...chat})),nextCursor:null}),getChat:(_provider,id)=>detail(id),
          markChatDone:(_provider,id,done=true)=>{const chat=fixtureChats.find(chat=>chat.id===id);Object.assign(chat,{done,doneAt:done?Date.now():null});return {...chat}},
          markChatsDone:ids=>ids.map(id=>{const chat=fixtureChats.find(chat=>chat.id===id);Object.assign(chat,{done:true,doneAt:Date.now()});return {...chat}}),
          markChatSeen:(_provider,id,seenUpdatedAt)=>({...fixtureChats.find(chat=>chat.id===id),seenUpdatedAt}),
          getModels:()=>[{id:'fixture',label:'Fixture model',description:'Fixture',isDefault:true,supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}],
          getAccounts:()=>({available:true,unavailableMessage:null,accounts:[]}),getUsage:()=>usage,
          getDefaultCwd:()=>'/fixture/project-0',getWindowState:()=>({isMaximized:false}),getAppUpdate:()=>null,
          getProjects:()=>[],getContainerSuggestions:()=>[],getSshEnvironments:()=>[],getChatContainers:()=>[],
          getInstalledFontFamilies:()=>[],getAgentModes:()=>[],getApprovalModes:()=>[],getSandboxModes:()=>[],
          getSkills:()=>[],getApps:()=>[],getChatTerminalTasks:()=>[],getCwdNotes:()=>[],getProjectIcon:()=>null,getSubagents:()=>[],
          getUpdateAvailability:()=>null,
          setViewedChat:(_provider,id)=>{window.fixtureViewedChat=id}
        };
        const api=new Proxy({}, {get:(_target,name)=>{
          if(name==='onChatUpdated')return listener=>{window.fixtureChatListener=listener;return ()=>{if(window.fixtureChatListener===listener)window.fixtureChatListener=null}};
          if(name.startsWith('on'))return ()=>()=>{};
          return (...args)=>{fixtureCalls.push(name);return Promise.resolve(defaults[name]?.(...args)??null)};
        }});
        window.appApi=api;window.providerApi=api;window.terminalApi=api;window.browserApi=api;
        window.beginBackgroundUpdates=()=>{let revision=10;return setInterval(()=>{
          revision++;
          window.fixtureRevision=revision;
          if(${activeChats}){
            for(const id of ['1','2']){
              const items=history(id);histories.set(id,items.map((item,index)=>index===items.length-1?
                {...item,content:item.content+'\\n\\nLive '+id+' update '+revision+'.'}:item));
              const chat=fixtureChats.find(chat=>chat.id===id);chat.updatedAt=Date.now();
              const snapshot=detail(id);
              window.fixtureChatListener?.({providerId:'codex',chatId:id,sequence:revision*10+Number(id),turnCompleted:false,
                detail:fixtureViewedChat===id?{...snapshot,baseRevision:null,baseItemIds:null,
                  itemIds:snapshot.items.map(item=>item.id),changedItems:snapshot.items}:null,
                summary:{...chat,revision,currentActivity:null,previewLength:0}});
            }
          }
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
      const trace = []
      if (process.env.SELE_BENCHMARK_TRACE) {
        win.webContents.debugger.on('message', (_event, method, params) => {
          if (method === 'Tracing.dataCollected') trace.push(...params.value)
        })
        await win.webContents.debugger.sendCommand('Tracing.start', {
          categories:
            'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack'
        })
      }
      const results = []
      const destinations = activeChats
        ? ['1', '2', '1', '2', '1', '2']
        : process.env.SELE_BENCHMARK_RICH_HISTORY === '1'
          ? ['1', '2', '1', '2', 'new', '1', 'new', '3', 'new']
          : ['1', '2', 'new', '1', 'new', '3', 'new']
      for (const destination of destinations) {
        results.push(await run('window.measureNavigation(' + JSON.stringify(destination) + ')'))
      }
      if (activeChats) {
        await run('clearInterval(window.backgroundUpdates)')
        const warm = results.filter((result) => result.reusedTurns !== null)
        assert.equal(warm.length, 4, 'exercise both running chats repeatedly')
        for (const result of warm) {
          assert.equal(result.reusedTurns, 10, 'streaming chats reuse every mounted turn')
          assert.equal(result.mixedChatFrames, 0, 'never paint the other running chat')
          assert.equal(result.blankFrames, 0, 'warm streaming chats stay readable')
          assert.equal(result.selected, result.destination)
        }
        const caughtUp = await run(`new Promise(resolve=>{const deadline=performance.now()+3000;
          function check(){if(document.querySelector('#chat-search-content')?.textContent.includes('Live 2 update '+fixtureRevision+'.'))return resolve(true);
            if(performance.now()>deadline)return resolve(false);requestAnimationFrame(check)}check()})`)
        assert.equal(
          caughtUp,
          true,
          'the selected stream catches up to the latest provider revision'
        )
        assert.deepEqual(errors, [])
        console.log(JSON.stringify({ activeChats: true, results, errors }, null, 2))
        await run('window.unmountFixture()')
        app.exit(0)
        return
      }
      for (const id of ['1', '2', '3']) {
        await run('window.measureNavigation(' + JSON.stringify(id) + ')')
        results.push(await run('window.measureNavigation(' + JSON.stringify(id) + ',"done")'))
        if (id === '1') {
          await run(
            `document.querySelector('.chat-list-group--done .chat-list-group__toggle').click()`
          )
          await run('new Promise(resolve=>setTimeout(resolve,300))')
        }
      }
      // Completing an unselected chat must retain the current conversation.
      await run('window.measureNavigation("5")')
      results.push(await run('window.measureNavigation("4","done")'))
      // Also remove a whole project containing the selected chat.
      await run('window.measureNavigation("6")')
      results.push(await run('window.measureNavigation("6","done-project")'))
      if (process.env.SELE_BENCHMARK_TRACE) {
        const complete = new Promise((resolve) => {
          const listener = (_event, method) => {
            if (method === 'Tracing.tracingComplete') {
              win.webContents.debugger.off('message', listener)
              resolve()
            }
          }
          win.webContents.debugger.on('message', listener)
        })
        await win.webContents.debugger.sendCommand('Tracing.end')
        await complete
      }
      const traceSummary = results
        .filter(
          (r) => r.action.startsWith('done') || process.env.SELE_BENCHMARK_RICH_HISTORY === '1'
        )
        .map((result) => {
          const prefix = result.measurementId + ':'
          const start = trace.find((e) => e.name === prefix + 'start')?.ts
          const end = trace.find((e) => e.name === prefix + 'end')?.ts
          const events = trace.filter(
            (e) =>
              e.ts >= start &&
              e.ts <= end &&
              e.dur &&
              ['Layout', 'UpdateLayoutTree', 'Paint', 'FunctionCall'].includes(e.name)
          )
          return {
            action: result.action,
            id: result.destination,
            events: events
              .sort((a, b) => b.dur - a.dur)
              .slice(0, 8)
              .map((e) => ({ name: e.name, ms: e.dur / 1000, data: e.args }))
          }
        })
      const { profile } = await win.webContents.debugger.sendCommand('Profiler.stop')
      const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
      const parents = new Map(
        profile.nodes.flatMap((node) => (node.children ?? []).map((id) => [id, node.id]))
      )
      const paths = new Map()
      const counts = new Map()
      for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
        const frame = nodes.get(profile.samples[i]).callFrame
        const name = frame.functionName || '(anonymous)'
        if (
          [
            'querySelectorAll',
            'querySelector',
            'requestAnimationFrame',
            'alignChatContentToBottom'
          ].includes(name)
        ) {
          let id = profile.samples[i]
          const path = []
          for (let depth = 0; id && depth < 6; depth++, id = parents.get(id))
            path.push(nodes.get(id).callFrame.functionName || '(anonymous)')
          const key = path.join(' <- ')
          paths.set(key, (paths.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
        }
        counts.set(name, (counts.get(name) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
      }
      console.log(
        JSON.stringify(
          {
            chatCount: await run('window.fixtureChats.length'),
            traceSummary,
            results,
            errors,
            hotPaths: [...paths].sort((a, b) => b[1] - a[1]).slice(0, 18),
            hotFunctions: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25),
            calls: await run('[...new Set(window.fixtureCalls)]')
          },
          null,
          2
        )
      )
      assert.deepEqual(errors, [])
      if (
        process.env.SELE_BENCHMARK_RICH_HISTORY === '1' &&
        process.env.SELE_BENCHMARK_UNRETAINED !== '1'
      ) {
        const warm = results.filter(
          (result) =>
            result.action === 'select' &&
            ['1', '2'].includes(result.destination) &&
            result.reusedTurns !== null
        )
        assert.ok(warm.length >= 2, 'exercise repeated rich-chat reopening')
        for (const result of warm)
          assert.equal(
            result.reusedTurns,
            10,
            'warm reopening must reuse every mounted turn: ' + JSON.stringify(result)
          )
      }
      for (const result of results) {
        if (process.env.SELE_BENCHMARK_RICH_HISTORY !== '1') {
          assert.equal(result.messages, 0, 'the default regression exercises empty conversations')
        } else if (result.action === 'select' && result.destination !== 'new') {
          assert.equal(result.fadedFrames, 0, 'conversation navigation must not fade the viewport')
          assert.equal(result.mixedChatFrames, 0, 'never paint messages from the previous chat')
          assert.equal(result.blankFrames, 0, 'loading conversations must have a loader')
        }
        const expectedGroups = await run(`(() => {
          const ids = ${JSON.stringify([...result.affectedChatIds, result.selectedBefore, '0'].filter(Boolean))};
          return ['done', ...ids.map(id => window.fixtureChats.find(chat => chat.id === id)).filter(Boolean).map(chat => 'cwd:' + chat.cwd)];
        })()`)
        assert.deepEqual(
          result.groupRenders.filter((key) => !expectedGroups.includes(key)),
          [],
          'unaffected project groups must not rebuild their lists'
        )
        assert.equal(
          result.canvasTransfers,
          0,
          'navigation/completion must reuse the artwork canvas'
        )
        assert.equal(result.styleSheetCountChange, 0, 'completion never leaves an extra stylesheet')
        assert.equal(result.popLayoutRules, 0, 'completion never injects document-wide exit rules')
        const completing = result.action === 'done' || result.action === 'done-project'
        const expectedSelection = completing
          ? result.affectedChatIds.includes(result.selectedBefore)
            ? null
            : result.selectedBefore
          : result.destination === 'new'
            ? null
            : result.destination
        assert.equal(result.selected, expectedSelection)
        assert.equal(
          result.artActive,
          expectedSelection === null,
          'hidden artwork pauses its worker'
        )
        assert.equal(
          result.historyRequests,
          0,
          'navigation/completion must not reload chat history'
        )
        if (completing) {
          assert.equal(result.done, true, 'completion metadata was saved by the fixture API')
          assert.equal(result.activeRowPresent, false, 'completed chats leave the active project')
        }
        assert.equal(
          result.spinnerRetained,
          true,
          'navigation preserves the background running spinner'
        )
        assert.deepEqual(
          result.unexpectedRowIds,
          [],
          'only affected chats, the previous selection and running chat should render'
        )
        assert.ok(
          result.rowRenders < 40 + result.affectedChatIds.length * 3,
          'navigation/completion must not rerender the whole sidebar'
        )
        assert.ok(
          result.motionRenders < 120 + result.affectedChatIds.length * 6,
          'presence context must not rerender all animation wrappers'
        )
      }
      assert.equal(
        await run('window.fixtureArtWorkers'),
        1,
        'one artwork worker serves every completion'
      )
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await run('new Promise(resolve=>setTimeout(resolve,100))')
      assert.equal(
        await run('document.querySelectorAll(".chat-panel__new-chat-vegvisir > canvas").length'),
        0
      )
      assert.equal(
        await run('document.querySelectorAll(".chat-panel__new-chat-vegvisir > svg").length'),
        1
      )
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
      })
      await run('new Promise(resolve=>setTimeout(resolve,100))')
      assert.equal(await run('window.fixtureArtActive'), true)
      assert.equal(
        await run('document.querySelectorAll(".chat-panel__new-chat-vegvisir > canvas").length'),
        1
      )
      await run('window.unmountFixture()')
      assert.equal(
        await run('window.fixtureArtTerminated'),
        await run('window.fixtureArtWorkers'),
        'unmount terminates every artwork worker'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
