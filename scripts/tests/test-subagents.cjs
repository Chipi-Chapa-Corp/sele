// Real workspace regression checks with synthetic APIs and a disposable Electron profile.
// Run through isolated-gui; this never opens the user's application or provider sessions.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-subagents-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
          import React from 'react'
          import {createRoot} from 'react-dom/client'
          import './src/renderer/src/assets/main.css'
          import {getChatItems} from './src/main/providers/codex/CodexItemRenderers'
          window.addEventListener('error',event=>console.error(event.error?.stack??event.message))
          const noop=()=>{}
          const now=Date.now()
          const chat={id:'root',providerId:'codex',title:'Subagent fixture',preview:'',createdAt:now,
            updatedAt:now,status:null,cwd:'/fixture',cwdKind:'directory',projectCwd:null,
            branchName:null,worktreeBaseBranchName:null,pinned:false,sidebarOrder:null,done:false,
            seenUpdatedAt:now,purpose:null,container:null}
          const message=(id,content,role='assistant')=>({type:'message',id,role,content})
          const detail={...chat,revision:1,capabilities:{editMessages:true,activeMessages:true},
            pendingApproval:null,pendingUserInput:null,contextUsage:null,subagents:[],
            items:[message('prompt','The parent prompt','user'),message('answer','Parent answer')],
            turnCount:1,itemsStartTurnIndex:0}
          window.agents=[]; window.childReads=0; window.pageRequests=[]; window.historyMode=false
          window.startAgents=()=>{window.agents=[
            {id:'child',parentId:null,title:'Child agent',status:'running',createdAt:now,updatedAt:now},
            {id:'grandchild',parentId:'child',title:'Grandchild agent',status:'running',createdAt:now+1,updatedAt:now+1}
          ]}
          window.cancelCalls=[]
          window.emitParent=(items=detail.items)=>{
            chat.updatedAt=Date.now();detail.updatedAt=chat.updatedAt
            detail.items=items;detail.revision++;detail.subagents=window.agents
            detail.turnCount=items.filter(item=>item.type==='message'&&item.role==='user').length
            const snapshot={...detail}
            window.chatListener?.({providerId:'codex',chatId:'root',sequence:detail.revision,
              detail:{...snapshot,baseRevision:null,baseItemIds:null,itemIds:items.map(item=>item.id),changedItems:items},
              turnCompleted:true,summary:chat})
          }
          window.finishAgents=()=>{
            window.completedMode=true;window.historyMode=false;window.sleepMode=false
            window.agents=window.agents.map(agent=>({...agent,status:'completed',updatedAt:now+500,
              turnId:agent.id==='child'?'root-turn':'child-turn',
              afterItemId:agent.id==='child'?'root-turn:subagent-completed:child':'child-turn:subagent-completed:grandchild'}))
            window.emitParent([message('prompt','The parent prompt','user'),
              {type:'timelineAnchor',id:'root-turn:subagent-completed:child'},message('answer','Parent answer')])
          }
          window.appendTurn=()=>window.emitParent([...detail.items,
            message('new-prompt','A later prompt','user'),message('new-answer','A later answer')])
          window.setText=value=>{
            const element=document.querySelector('textarea')
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,value)
            element.dispatchEvent(new Event('input',{bubbles:true}))
          }
          const usage={updatedAt:now,statisticsLoaded:false,summary:null,dailyUsageBuckets:null,
            rateLimits:[],rateLimitResetCredits:null,errors:[]}
          const defaults={
            getSourceAvailability:()=>({gitAvailable:false,providers:[{providerId:'codex',available:true}]}),
            getChats:()=>({chats:[chat],nextCursor:null}),getChat:()=>detail,
            getConversationViews:()=>[],getKnownChats:()=>({chats:[],nextCursor:null}),getLimitResetMessages:()=>[],
            markChatSeen:(_provider,_id,seenUpdatedAt)=>{chat.seenUpdatedAt=Math.max(chat.seenUpdatedAt,seenUpdatedAt);return {...chat}},
            getModels:()=>[{id:'fixture',label:'Fixture model',isDefault:true,supportedReasoningEfforts:[],defaultReasoningEffort:'medium'}],
            getAccounts:()=>({available:true,unavailableMessage:null,accounts:[]}),getUsage:()=>usage,
            getDefaultCwd:()=>'/fixture',getWindowState:()=>({isMaximized:false}),getAppUpdate:()=>null,
            getProjects:()=>[],getContainerSuggestions:()=>[],getSshEnvironments:()=>[],getChatContainers:()=>[],
            getInstalledFontFamilies:()=>[],getAgentModes:()=>[],getApprovalModes:()=>[],getSandboxModes:()=>[],
            getSkills:()=>[],getApps:()=>[],getChatTerminalTasks:()=>[],getCwdNotes:()=>[],getProjectIcon:()=>null,getUpdateAvailability:()=>null,
            getSubagents:()=>window.agents,
            cancelSubagent:(_provider,_root,id)=>{
              window.cancelCalls.push(id)
              window.agents=window.agents.map(agent=>agent.id===id?{...agent,status:'stopped',updatedAt:Date.now()}:agent)
            },
            getSubagent:(_provider,_root,id,page)=>{
              window.pageRequests.push(page??null)
              const summary=window.agents.find(agent=>agent.id===id)
              window.childReads++
              if(window.completedMode)return {...summary,items:id==='child'?[
                {type:'timelineAnchor',id:'child-turn:subagent-completed:grandchild'},
                message('child-done','Child agent finished.')]:[message('grandchild-done','Grandchild finished.')],
                itemsStartTurnIndex:0,turnCount:1}
              if(window.sleepMode)return {...summary,status:window.sleepFinished?'completed':'running',
                items:getChatItems([{id:'sleep-turn',status:window.sleepFinished?'completed':'inProgress',
                  items:[{type:'sleep',id:'sleep',durationMs:30000},...(window.sleepFinished?
                    [{type:'agentMessage',id:'done',phase:'final_answer',text:'Nested child finished.'}]:[])]}]),
                itemsStartTurnIndex:0,turnCount:1}
              if(window.childReads===1)return {...summary,items:[],itemsStartTurnIndex:0,turnCount:1}
              if(window.cursorMode){
                const start=page?.cursor?Number(page.cursor.split('-')[1]):20
                return {...summary,items:Array.from({length:10},(_,i)=>
                  message('cursor-child-'+(start+i),'Cursor child message '+(start+i),'user')),
                  itemsStartTurnIndex:0,turnCount:10,
                  turnPagination:{kind:'cursor',olderCursor:start>0?'cursor-'+(start-10):null,
                    newerCursor:start<20?'cursor-'+(start+10):null}}
              }
              const start=window.historyMode?(page?.startIndex??20):0
              return {...summary,items:Array.from({length:window.historyMode?10:1},(_,i)=>
                message('child-'+(start+i),'Live child message '+(start+i),'user')),
                itemsStartTurnIndex:start,turnCount:window.historyMode?30:1}
            }
          }
          const api=new Proxy({}, {get:(_target,name)=>name==='onChatUpdated'?listener=>{window.chatListener=listener;return noop}:
            name.startsWith('on')?()=>noop:(...args)=>Promise.resolve(defaults[name]?.(...args)??null)})
          Object.assign(window,{appApi:api,providerApi:api,terminalApi:api,browserApi:api})
          const stored=new Map([['sele:app-settings:v1',JSON.stringify({appearance:{position:'hidden'}})]])
          window.preferencesApi={getItem:key=>({ok:true,value:stored.get(key)??null}),
            setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}},
            removeItem:key=>{stored.delete(key);return {ok:true,value:null}}}
          import('./src/renderer/src/App').then(({App})=>createRoot(document.getElementById('root')).render(<App/>))
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
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error) {
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    let win
    const errors = []
    try {
      win = new BrowserWindow({
        show: true,
        width: 1400,
        height: 950,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const ready = (condition) =>
        run(
          `new Promise((resolve,reject)=>{const until=performance.now()+10000;function check(){if(${condition})return resolve();if(performance.now()>until)return reject(new Error('Timed out: '+${JSON.stringify(condition)}));requestAnimationFrame(check)}check()})`
        )
      const settle = () =>
        run(
          'new Promise(resolve=>{let frames=4;const tick=()=>--frames?requestAnimationFrame(tick):resolve();requestAnimationFrame(tick)})'
        )
      const checkCursorNavigation = async () => {
        await run(`window.cursorMode=true;window.historyMode=false;window.pageRequests=[];
        document.querySelector('.chat-subagent-list .chat-list-item__main').click()`)
        await ready(`document.querySelector('[data-chat-message-id="cursor-child-29"]')`)
        await settle()
        await run(`(() => {
        const content=document.querySelector('#chat-search-content')
        content.scrollTop=0
        content.dispatchEvent(new WheelEvent('wheel',{deltaY:-500,bubbles:true}))
      })()`)
        await ready(`window.pageRequests.some(page=>page?.cursor==='cursor-10')`)
        await ready(`document.querySelector('[data-chat-message-id="cursor-child-19"]')`)
        const beforeCursorPoll = await run(`window.childReads`)
        await ready(`window.childReads>${beforeCursorPoll}`)
        assert.equal(
          await run(`Boolean(document.querySelector('[data-chat-message-id="cursor-child-19"]'))`),
          true,
          'a latest-tail poll must retain the historical cursor page'
        )
        await fs.mkdir(path.join(__dirname, '../../test-results/provider-history-fixes'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(__dirname, '../../test-results/provider-history-fixes/subagent-cursor.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        await settle()
        await run(`(() => {
        const content=document.querySelector('#chat-search-content')
        content.scrollTop=content.scrollHeight
        content.dispatchEvent(new WheelEvent('wheel',{deltaY:500,bubbles:true}))
      })()`)
        await ready(`window.pageRequests.some(page=>page?.cursor==='cursor-20')`)
        await ready(`document.querySelector('[data-chat-message-id="cursor-child-29"]')`)
        await run(
          `window.cursorMode=false;document.querySelector('[aria-label="Back to parent chat"]').click()`
        )
        await ready(`document.querySelector('[data-chat-message-id="answer"]')`)
      }
      await ready(`document.querySelector('[data-chat-id="root"] .chat-list-item__main')`)
      const sidebarListHeight = await run(
        `document.querySelector('[data-chat-id="root"]').closest('.chat-list').getBoundingClientRect().height`
      )
      await run(
        `window.startAgents();document.querySelector('[data-chat-id="root"] .chat-list-item__main').click()`
      )
      await ready(`document.querySelector('[data-chat-message-id="answer"]')`)
      await run(`window.setText('My real latest draft')`)
      await ready(`document.querySelectorAll('.chat-subagent-list__item').length===1`)
      assert.equal(
        await run(`document.querySelectorAll('.chat-subagent-list .app-loading-spinner').length`),
        1
      )
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-id="root"] .app-loading-spinner'))`),
        true,
        'an idle root displays a loader while a descendant works'
      )
      // Like chat row actions, stop appears only on hover, and only then takes width from the title.
      const stopOpacity = `getComputedStyle(document.querySelector('[aria-label="Stop Child agent"]').parentElement).opacity`
      const titlePadding = `getComputedStyle(document.querySelector('.chat-subagent-list .chat-list-item__header')).paddingRight`
      const hoverPadding = `parseFloat(getComputedStyle(document.documentElement).fontSize)*2+'px'`
      const subagentRow = JSON.parse(
        await run(
          `JSON.stringify(document.querySelector('.chat-subagent-list .chat-list-item').getBoundingClientRect())`
        )
      )
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
      await ready(`${stopOpacity}==='0'&&${titlePadding}==='0px'`)
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(subagentRow.x + subagentRow.width / 2),
        y: Math.round(subagentRow.y + subagentRow.height / 2)
      })
      await ready(`${stopOpacity}==='1'&&${titlePadding}===${hoverPadding}`)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
      await ready(`${stopOpacity}==='0'&&${titlePadding}==='0px'`)
      await run(`document.querySelector('.chat-subagent-list .chat-list-item__main').click()`)
      await ready(`document.querySelectorAll('.chat-subagent-list__item').length===2`)
      assert.equal(
        await run(
          `document.querySelectorAll('.chat-subagent-list__item')[1].style.getPropertyValue('--chat-subagent-depth')`
        ),
        '1'
      )
      await ready(`document.querySelector('[aria-label="Subagent working"]')`)
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-message-id="answer"]'))`),
        false
      )
      assert.equal(
        await run(
          `Array.from(document.querySelectorAll('button')).some(button=>['Load newer messages','Jump to latest'].includes(button.textContent))`
        ),
        false
      )
      await ready(`document.querySelector('[data-chat-message-id="child-0"]')`)
      assert.equal(
        await run(`document.querySelector('.chat-panel__composer').style.display`),
        'none'
      )
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-chat-message-id="answer"]')`)
      assert.equal(await run(`document.querySelector('textarea').value`), 'My real latest draft')
      if (process.env.SELE_SUBAGENT_CURSOR_ONLY === '1') {
        await checkCursorNavigation()
        assert.equal(errors.length, 0, errors.join('\n'))
        console.log(
          'Subagent cursor checks passed: older/newer navigation, poll retention, temporary profile.'
        )
        return
      }
      // Clearing a sent draft must survive another subagent round trip too.
      await run(`window.setText('')`)
      await settle()
      await run(`document.querySelector('.chat-subagent-list .chat-list-item__main').click()`)
      await ready(`document.querySelector('[data-chat-message-id="child-0"]')`)
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-chat-message-id="answer"]')`)
      assert.equal(await run(`document.querySelector('textarea').value`), '')
      // Long child histories page automatically when scrolling toward the older boundary.
      await run(
        `window.historyMode=true;window.pageRequests=[];document.querySelector('.chat-subagent-list .chat-list-item__main').click()`
      )
      await ready(`document.querySelector('[data-chat-message-id="child-29"]')`)
      await settle()
      await run(`(() => {
        const content=document.querySelector('#chat-search-content')
        content.scrollTop=0
        content.dispatchEvent(new WheelEvent('wheel',{deltaY:-500,bubbles:true}))
      })()`)
      await ready(`window.pageRequests.some(page=>page?.startIndex===10)`)
      await ready(`document.querySelector('[data-chat-message-id="child-19"]')`)
      await settle()
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-message-id="child-29"]'))`),
        false,
        'positioning an older page must not immediately page forward again'
      )
      const childHistoryTop = await run(`document.querySelector('#chat-search-content').scrollTop`)
      await run(`document.querySelectorAll('.chat-subagent-list .chat-list-item__main')[1].click()`)
      await ready(
        `document.querySelector('.chat-subagent-list [aria-current="true"]').title==='Grandchild agent'`
      )
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-chat-message-id="child-19"]')`)
      await settle()
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-message-id="child-29"]'))`),
        false,
        'returning from a nested agent retains the parent historical page'
      )
      assert.ok(
        Math.abs(
          (await run(`document.querySelector('#chat-search-content').scrollTop`)) - childHistoryTop
        ) < 2,
        'returning from a nested agent retains the parent viewport'
      )
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-chat-message-id="answer"]')`)
      await checkCursorNavigation()
      await run(
        `window.sleepMode=true;document.querySelector('.chat-subagent-list .chat-list-item__main').click()`
      )
      await ready(`document.querySelectorAll('.chat-subagent-list__item').length===2`)
      await run(`document.querySelectorAll('.chat-subagent-list .chat-list-item__main')[1].click()`)
      await ready(
        `Array.from(document.querySelectorAll('.chat-detail__tool-label')).some(node=>node.textContent==='Waiting 30s')`
      )
      assert.equal(
        await run(`Boolean(document.querySelector('[aria-label="Subagent working"]'))`),
        false,
        'a native sleep-only child renders its actual activity instead of a blank pane'
      )
      if (process.env.SELE_SUBAGENT_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_SUBAGENT_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run(`window.sleepFinished=true`)
      await ready(`document.querySelector('[data-chat-message-id="sleep-turn:done"]')`)
      await run(`window.finishAgents()`)
      await ready(`document.querySelectorAll('.chat-subagent-list__item').length===2`)
      // Back from a nested agent opens its actual parent; the nested completion lives there.
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-subagent-completion-id="grandchild"]')`)
      assert.equal(await run(`document.querySelectorAll('.chat-subagent-list__item').length`), 1)
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-subagent-completion-id="child"]')`)
      await ready(
        `document.querySelector('[data-chat-id="root"]').closest('.chat-list').children.length===1`
      )
      assert.equal(
        await run(
          `document.querySelector('[data-chat-id="root"]').closest('.chat-list').getBoundingClientRect().height`
        ),
        sidebarListHeight,
        'selecting a chat with only hidden completed subagents adds no empty row or list gap'
      )
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-id="root"] .app-loading-spinner'))`),
        false
      )
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.dataset.colorScheme='${theme}'`)
        await settle()
        const colors = await run(`(() => {
          const user=getComputedStyle(document.querySelector('[data-chat-message-id="prompt"] .chat-detail__message--user'))
          const bubble=getComputedStyle(document.querySelector('.chat-subagent-completion__bubble'))
          return [user.backgroundColor,bubble.backgroundColor,user.color,bubble.color]
        })()`)
        assert.equal(
          await run(`(() => {
          const bubble=document.querySelector('.chat-subagent-completion__bubble').getBoundingClientRect()
          const agent=document.querySelector('[data-chat-message-id="answer"]').getBoundingClientRect()
          return Math.abs(bubble.left-agent.left)<1
        })()`),
          true,
          theme + ' completion bubble is on the agent side'
        )
        assert.equal(colors[0], colors[1], theme + ' user bubble background')
        assert.equal(colors[2], colors[3], theme + ' user bubble text')
        if (process.env.SELE_SUBAGENT_COMPLETION_SCREENSHOT_DIR)
          await fs.writeFile(
            path.join(
              process.env.SELE_SUBAGENT_COMPLETION_SCREENSHOT_DIR,
              'completion-' + theme + '.png'
            ),
            (await win.webContents.capturePage()).toPNG()
          )
      }
      await run(`document.querySelector('.chat-subagent-completion__bubble').click()`)
      await ready(`document.querySelector('[data-chat-message-id="child-done"]')`)
      assert.equal(await run(`document.querySelectorAll('.chat-subagent-list__item').length`), 1)
      assert.equal(
        await run(
          `document.querySelector('.chat-subagent-list .chat-list-item__main').getAttribute('aria-current')`
        ),
        'true'
      )
      assert.equal(
        await run(`Boolean(document.querySelector('[aria-label="Stop Child agent"]'))`),
        false
      )
      await run(`document.querySelector('[aria-label="Back to parent chat"]').click()`)
      await ready(`document.querySelector('[data-subagent-completion-id="child"]')`)
      await run(`window.appendTurn()`)
      await ready(`document.querySelector('[data-chat-message-id="new-prompt"]')`)
      assert.equal(
        await run(`Boolean(document.querySelector('[data-subagent-completion-id="child"]').compareDocumentPosition(
        document.querySelector('[data-chat-message-id="new-prompt"]')) & Node.DOCUMENT_POSITION_FOLLOWING)`),
        true,
        'completion stays before subsequent turns'
      )
      // Returning from a completion bubble preserves a middle-of-history viewport.
      await run(`(() => {
        window.completedMode=true
        const items=Array.from({length:18},(_,i)=>[
          {id:'long-prompt-'+i,type:'message',role:'user',content:'Prompt '+i},
          ...(i===12?[{type:'timelineAnchor',id:'root-turn:subagent-completed:child'}]:[]),
          {id:'long-answer-'+i,type:'message',role:'assistant',content:('Answer '+i+' with enough text to form a long history. ').repeat(30)}
        ]).flat()
        window.emitParent(items)
      })()`)
      await ready(`document.querySelector('[data-chat-message-id="long-answer-17"]')`)
      await settle()
      for (const returnVia of ['back', 'sidebar']) {
        await run(`(() => {
          const content=document.querySelector('#chat-search-content')
          content.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}))
          document.querySelector('.chat-subagent-completion__bubble').scrollIntoView({block:'center'})
        })()`)
        await settle()
        const previousTop = await run(`document.querySelector('#chat-search-content').scrollTop`)
        assert.ok(previousTop > 100, 'fixture is scrolled within long history')
        await run(`document.querySelector('.chat-subagent-completion__bubble').click()`)
        await ready(`document.querySelector('[data-chat-message-id="child-done"]')`)
        // Simulate a provider summary arriving while its child is open.
        await run(`window.emitParent()`)
        await settle()
        assert.equal(
          await run(
            `Boolean(document.querySelector('[data-chat-id="root"].chat-list-item--unread'))`
          ),
          false
        )
        await run(
          returnVia === 'back'
            ? `document.querySelector('[aria-label="Back to parent chat"]').click()`
            : `document.querySelector('[data-chat-id="root"] .chat-list-item__main').click()`
        )
        await ready(`document.querySelector('[data-chat-message-id="long-answer-17"]')`)
        await settle()
        const returnedTop = await run(`document.querySelector('#chat-search-content').scrollTop`)
        assert.ok(
          Math.abs(returnedTop - previousTop) < 2,
          returnVia + ' restores prior position: ' + previousTop + ' -> ' + returnedTop
        )
        assert.equal(
          await run(
            `Boolean(document.querySelector('[data-chat-id="root"].chat-list-item--unread'))`
          ),
          false
        )
      }
      // The stop icon force-interrupts the selected branch, including a hidden active child.
      await run(
        `window.completedMode=false;window.sleepMode=false;window.startAgents();window.emitParent()`
      )
      await ready(`document.querySelector('[aria-label="Stop Child agent"]')`)
      await run(`document.querySelector('[aria-label="Stop Child agent"]').click()`)
      await ready(
        `window.cancelCalls.length===2 && document.querySelectorAll('.chat-subagent-list__item').length===0`
      )
      assert.deepEqual(await run(`window.cancelCalls.sort()`), ['child', 'grandchild'])
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(
        'Subagent workspace checks passed: live rows/spinners, nested depth, empty recovery, draft round trips, automatic history paging, native sleep activity, completion bubbles in both themes, scoped rows, selected completed agents, parent read state and scroll restoration, cascading stop.'
      )
    } catch (error) {
      console.error(error.stack)
      if (win)
        console.error(
          await win.webContents.executeJavaScript(
            `JSON.stringify({labels:Array.from(document.querySelectorAll('.chat-detail__tool-label')).map(n=>n.textContent),text:document.querySelector('#chat-search-content')?.textContent,reads:window.childReads,requests:window.pageRequests})`
          )
        )
      console.error(errors.join('\n'))
      code = 1
    } finally {
      win?.destroy()
      app.exit(code)
    }
  })
}
