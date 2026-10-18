// Profile real message/sidebar mounting with synthetic chat data. No providers or user profile.
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-rendering-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
            import React, {useLayoutEffect, useMemo, useRef, useState, startTransition} from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {ChatList} from './src/renderer/src/components/ChatList'
            import {ChatDetailItem} from './src/renderer/src/components/ChatDetailItem'
            import {DeferredChatTurn} from './src/renderer/src/components/DeferredChatTurn'
            import {ConversationMessagesContent} from './src/renderer/src/workspace/components/ConversationMessagesContent'
            import {ChatMediaGallery} from './src/renderer/src/components/ChatMediaGallery'
            import {getProviderChatTurns} from './src/shared/chatTurns'
            import {getRecentChatReferences} from './src/renderer/src/chatRecents'
            import {alignChatContentToBottom} from './src/renderer/src/chatLayout'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            const noop = () => {}
            const chatIds=['running','small','rich','without-recents','without-gallery','transition','progressive']
            const chats = Array.from({length:300}, (_,i) => ({id:chatIds[i]??String(i),providerId:'codex',
              title:'Conversation '+i,cwd:'/fixture',createdAt:Date.now(),updatedAt:Date.now(),status:i===0?'active':null}))
            const histories = new Map()
            window.makeHistory = (key, paragraphs) => {
              const items = Array.from({length:10}, (_,i) => [
                {id:key+'-u'+i,type:'message',role:'user',content:'Inspect task '+i,createdAt:Date.now()},
                {id:key+'-a'+i,type:'message',role:'assistant',createdAt:Date.now(),content:Array.from({length:paragraphs}, (_,n) =>
                  '### Section '+key+'-'+i+'-'+n+'\\n\\nFindings with **important text** and [source](/fixture/source'+n+'.ts:10).\\n\\n'+
                  '\\x60\\x60\\x60ts\\nconst result'+n+' = {value: "'+key+'-'+i+'", ready: true};\\n\\x60\\x60\\x60\\n\\n').join('')}
              ]).flat()
              histories.set(key, items)
              return items.reduce((sum,item)=>sum+item.content.length,0)
            }
            const root = createRoot(document.getElementById('root'))
            window.marks = []
            window.options = {gallery:true,recents:true,transition:false,progressive:false}
            function Conversation({id}) {
              const ref = useRef(null)
              const autoScrollEnabled = useRef(true)
              const items = histories.get(id) ?? []
              const turns = useMemo(()=>getProviderChatTurns(items),[items])
              useMemo(()=>window.options.recents ? getRecentChatReferences(items,10) : [],[items])
              useLayoutEffect(()=>{if(ref.current) alignChatContentToBottom(ref.current)},[id])
              useLayoutEffect(()=>{window.marks.push({id,time:performance.now()})},[id])
              useLayoutEffect(()=>{
                const element=ref.current
                if(!element) return
                const observer=new ResizeObserver(()=>{alignChatContentToBottom(element)})
                observer.observe(element.firstElementChild ?? element)
                return ()=>observer.disconnect()
              },[id])
              const renderTurn=(turn,index)=><div key={turn.id} data-chat-turn-id={turn.id}
                data-chat-turn-index={index} className="chat-detail__turn">{turn.items.map(item=><ChatDetailItem
                  key={item.id} item={item} onOpenFileLink={noop} cwd="/fixture"/>)}</div>
              if(window.options.progressive) return <ConversationMessagesContent
                chatAutoScrollEnabledRef={autoScrollEnabled} scrollChatContentToBottom={alignChatContentToBottom}
                activeSubagentChatView={null} chatHasActiveTurn={false} changesContainer={null} changesCwd="/fixture"
                chatMediaStartIndex={0} chatMediaTotalCount={10} chatLoadState="ready" chatSearchContentRef={ref}
                chatTurnPageLoadDirection={null} commitChatReturnTarget={null} contentRef={ref} editingMessage={null}
                effectiveChatTurnWindow={{startIndex:0,endIndex:10}} handleNativeChatContentScroll={noop}
                handleNativeChatContentWheel={noop} handleReturnFromAiCommitChat={noop} handleReturnFromSubagentChat={noop}
                handleNavigateSubagentTurns={noop} loadChatTurnPage={noop} renderChatTurn={(index,turn)=>renderTurn(turn,index)}
                renderedChatTurns={turns} selectedChat={{...chats[0],id}} selectedChatCommitMarkers={[]}
                selectedChatKey={id} selectedChatSubagents={[]} sendState="idle" showChatTurnDownButton={false}
                subagentChatConversationModel={{turns:[]}} subagentContentRef={{current:null}}
                subagentVisibleChatItems={[]} visibleChatItems={items}/>
              const messages = <div ref={ref} className="chat-detail__messages" style={{height:700,overflow:'auto'}}>
                {turns.map((turn,index)=><DeferredChatTurn key={turn.id} priority={index}
                  eager={!window.options.progressive || index===turns.length-1}>
                  <div data-chat-turn-id={turn.id} className="chat-detail__turn">{turn.items.map(item=><ChatDetailItem
                  key={item.id} item={item} onOpenFileLink={noop} cwd="/fixture"/>)}</div>
                </DeferredChatTurn>)}
              </div>
              return window.options.gallery ? <ChatMediaGallery turns={turns} startIndex={0} totalCount={10}>{messages}</ChatMediaGallery> : messages
            }
            function Fixture() {
              const [id,setId]=useState('empty')
              window.switchChat = next => {
                window.switchStart=performance.now()
                if(window.options.transition) startTransition(()=>setId(next))
                else setId(next)
              }
              return <main style={{display:'flex',height:'100vh'}}>
                <aside style={{width:280,overflow:'auto'}}><ChatList chats={chats} selectedChatKey={'codex:'+id}
                  onSelect={chat=>window.switchChat(chat.id)} onMarkDone={noop} onRename={noop}
                  onResolveApproval={noop} onTogglePinned={noop}/></aside>
                <div className="chat-panel" style={{flex:1}}><Conversation key={id} id={id}/></div>
              </main>
            }
            flushSync(()=>root.render(<Fixture/>))
            window.longTasks=[]
            window.turnMountCounts=[]
            new MutationObserver(()=>window.turnMountCounts.push(document.querySelectorAll('[data-chat-turn-id]').length))
              .observe(document.getElementById('root'),{childList:true,subtree:true})
            new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true})
            window.frameGaps=[]
            let before=performance.now()
            requestAnimationFrame(function sample(now){window.frameGaps.push(now-before);before=now;requestAnimationFrame(sample)})
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'unused-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><style>.chat-panel .chat-detail__messages{height:700px;flex:none}</style><div id="root"></div><script>window.appApi={};</script><script src="fixture.js"></script></html>'
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
      const win = new BrowserWindow({
        show: true,
        width: 1400,
        height: 950,
        webPreferences: { backgroundThrottling: false }
      })
      const errors = []
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const waitForChat = (id, count) =>
        run(`new Promise((resolve,reject)=>{
        const deadline=performance.now()+10000;
        function check(){
          const count=document.querySelectorAll('[data-chat-turn-id]').length;
          if(window.marks.at(-1)?.id===${JSON.stringify(id)} && (${count}===null ? count>0 : count===${count}))
            return requestAnimationFrame(()=>requestAnimationFrame(resolve));
          if(performance.now()>deadline) return reject(new Error('Chat did not finish mounting'));
          setTimeout(check,20);
        }
        check();
      })`)
      await run('new Promise(resolve=>setTimeout(resolve,300))')
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Profiler.enable')
      await win.webContents.debugger.sendCommand('Profiler.start')
      const results = []
      for (const [name, paragraphs, options] of [
        ['small', 5, {}],
        ['rich', 40, {}],
        ['without-recents', 40, { recents: false }],
        ['without-gallery', 40, { gallery: false }],
        ['transition', 40, { transition: true }],
        ['progressive', 40, { progressive: true, transition: true }]
      ]) {
        const key = name
        const characters = await run(`window.makeHistory(${JSON.stringify(key)},${paragraphs})`)
        await run(`window.options={gallery:true,recents:true,transition:false,progressive:false,...${JSON.stringify(options)}};
          window.spinner=document.querySelector('.chat-list-item__loading');
          window.frameGaps=[];window.longTasks=[];window.turnMountCounts=[];window.switchChat(${JSON.stringify(key)})`)
        await waitForChat(key, 10)
        results.push({
          name,
          characters,
          ...(await run(`({commitMs:window.marks.at(-1).time-window.switchStart,
          maxFrameGap:Math.max(...window.frameGaps),longTasks:window.longTasks.map(t=>t.duration),
          domNodes:document.querySelector('.chat-panel').querySelectorAll('*').length,
          spinnerRetained:window.spinner===document.querySelector('.chat-list-item__loading'),
          bottomGap:(()=>{const el=document.querySelector('.chat-detail__messages');return el.scrollHeight-el.clientHeight-el.scrollTop})(),
          turns:document.querySelectorAll('[data-chat-turn-id]').length,
          mountCounts:[...new Set(window.turnMountCounts)],
          turnIndexes:[...document.querySelectorAll('[data-chat-turn-index]')].map(node=>Number(node.dataset.chatTurnIndex))})`))
        })
      }
      // Cancel partially mounted history, then ensure a subsequent chat still fills.
      await run(`window.options={gallery:true,recents:true,transition:true,progressive:true};
        window.makeHistory('rapid',40);window.switchChat('rapid')`)
      await waitForChat('rapid', null)
      await run(`window.switchChat('empty')`)
      await waitForChat('empty', 0)
      assert.equal(
        await run(`document.querySelectorAll('[data-chat-turn-id]').length`),
        0,
        'cancelled mounts cannot reappear in the empty view'
      )
      await run(`window.makeHistory('after-rapid',40);window.switchChat('after-rapid')`)
      await waitForChat('after-rapid', 10)
      assert.equal(
        await run(`document.querySelectorAll('[data-chat-turn-id]').length`),
        10,
        'cancelled work cannot block the next chat'
      )
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
          { results, hotFunctions: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 22), errors },
          null,
          2
        )
      )
      assert.deepEqual(errors, [])
      const progressive = results.find((result) => result.name === 'progressive')
      assert.equal(progressive.turns, 10, 'all loaded turns remain available')
      assert.equal(
        progressive.mountCounts[0],
        1,
        'the latest turn displays before mounting older history'
      )
      assert.deepEqual(
        progressive.turnIndexes,
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        'turn coordinates retain their order'
      )
      assert.equal(
        progressive.spinnerRetained,
        true,
        'switching does not restart the running chat spinner'
      )
      assert.ok(
        Math.abs(progressive.bottomGap) < 1,
        'newly mounted history preserves bottom following'
      )
      assert.ok(
        progressive.maxFrameGap < 100,
        'mounting history must yield between turns: ' + JSON.stringify(progressive)
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
