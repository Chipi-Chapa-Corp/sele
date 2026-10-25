// Real React/turn lifecycle with fixture data and a temporary Electron profile.
// Run through isolated-gui; never opens Sele or a provider.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-retained-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React, {Activity, useEffect, useState} from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {ConversationMessages} from './src/renderer/src/workspace/components/ConversationMessages'
            import {MarkdownMessage} from './src/renderer/src/components/ChatDetailItem'
            import {buildChatConversationModel} from './src/renderer/src/chatConversationModel'
            import {DeferredChatTurn} from './src/renderer/src/components/DeferredChatTurn'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            const noop=()=>{};
            window.appApi={}; window.providerApi={};
            window.created=[];window.effects=new Set();window.actions=[];window.bottomAlignments=0;
            const root=createRoot(document.getElementById('root'));
            const probeHost=document.createElement('div');document.body.append(probeHost);
            const probeRoot=createRoot(probeHost);window.mountNotifications=0;
            window.renderMountProbe=(hidden=false)=>flushSync(()=>probeRoot.render(
              <Activity mode={hidden?'hidden':'visible'}>
                <DeferredChatTurn eager={true} priority={0} onMount={()=>window.mountNotifications++}>
                  <span>Mounted turn</span>
                </DeferredChatTurn>
              </Activity>));
            const histories=new Map();
            window.allowed=['a','b','c','d','big','embedded'].map(id=>'codex:'+id);
            const contentRef={current:null},searchRef={current:null},subagentRef={current:null};
            window.refs={contentRef,searchRef,subagentRef};
            function Turn({turn,version,id,streaming}) {
              const [count,setCount]=useState(()=>{window.created.push(turn.id);return 0});
              useEffect(()=>{window.effects.add(turn.id);return ()=>window.effects.delete(turn.id)},[turn.id]);
              return <div data-chat-turn-id={turn.id}>
                <button onClick={()=>{setCount(n=>n+1);window.actions.push([id,version])}}>{count}</button>
                <MarkdownMessage className="fixture-message" content={turn.items[0].content} streaming={streaming}/>
                {id==='big' && Array.from({length:31000},(_,i)=><i key={i}/>)}
                {id==='embedded' && <iframe src="about:blank"/>}
              </div>
            }
            window.appendChatText=(id,text)=>{
              const items=histories.get(id);
              histories.set(id,items.map((item,index)=>index===items.length-1?{...item,content:item.content+text}:item));
            };
            window.renderChat=(id,{loading=false,version=1,active=false,subagent=false}={})=>{
              window.currentChat={id,loading,version,active,subagent};
              if(id&&!histories.has(id)) histories.set(id,Array.from({length:['big','embedded'].includes(id)?1:10},(_,i)=>({
                id:id+'-'+i,type:'message',role:'user',content:'### '+id+' turn '+i+'\\n\\n'+Array.from({length:10},()=>
                'A **cached** paragraph with some text.').join('\\n\\n')})));
              const items=id&&!loading?histories.get(id):[];
              const model=buildChatConversationModel(items);
              const props={visible:Boolean(id),cachedChatKeys:window.allowed,
                chatAutoScrollEnabledRef:{current:true},scrollChatContentToBottom:()=>window.bottomAlignments++,
                changesContainer:null,changesCwd:'/fixture',chatMediaTotalCount:model.turns.length,chatMediaStartIndex:0,
                activeSubagentChatView:null,chatHasActiveTurn:active,chatLoadState:loading?'loading':'ready',
                chatSearchContentRef:searchRef,chatTurnPageLoadDirection:null,commitChatReturnTarget:null,
                contentRef,editingMessage:null,effectiveChatTurnWindow:{startIndex:0,endIndex:model.turns.length},
                handleNativeChatContentScroll:noop,handleNativeChatContentWheel:noop,handleReturnFromAiCommitChat:noop,
                handleReturnFromSubagentChat:noop,handleNavigateSubagentTurns:noop,loadChatTurnPage:noop,
                renderChatTurn:(_index,turn)=><Turn turn={turn} version={version} id={id}
                  streaming={active&&turn===model.turns.at(-1)}/>,
                renderSubagentChatTurn:noop,renderedChatTurns:model.turns,
                selectedChat:id?{id,providerId:'codex'}:null,selectedChatCommitMarkers:[],selectedChatKey:id?'codex:'+id:null,
                selectedChatSubagents:[],sendState:'idle',showChatTurnDownButton:false,
                subagentChatConversationModel:{turns:[]},subagentContentRef:subagentRef,
                subagentVisibleChatItems:[],visibleChatItems:items};
              flushSync(()=>root.render(<ConversationMessages {...props}/>));
            };
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
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="fixture.css"><div class="chat-panel" id="root" style="height:700px"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 45000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0)
        throw new Error(result.stderr || String(result.error || 'Fixture failed'))
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
        width: 1200,
        height: 900,
        webPreferences: { backgroundThrottling: false }
      })
      const errors = []
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      await run('renderMountProbe();renderMountProbe();renderMountProbe(true);renderMountProbe()')
      assert.equal(
        await run('window.mountNotifications'),
        1,
        'callback changes and cached reveals must not replay a turn mount notification'
      )
      const open = async (id, options = {}, count = 10) => {
        await run(`renderChat(${JSON.stringify(id)},${JSON.stringify(options)})`)
        await run(`new Promise((resolve,reject)=>{
          const deadline=performance.now()+5000;
          function check(){const node=document.getElementById('chat-search-content');
            if(${count}===0?!node:node?.querySelectorAll('[data-chat-turn-id]').length===${count})return resolve();
            if(performance.now()>deadline)return reject(new Error('Turns did not mount: ${id} '+JSON.stringify({
              created:window.created,ids:[...document.querySelectorAll('[id]')].map(n=>n.id),
              html:document.getElementById('root').innerHTML.slice(0,2000)})));requestAnimationFrame(check)}check()
        })`)
      }
      await open('a')
      await run(`window.saved=document.querySelector('#chat-search-content [data-chat-turn-id="a-9"]');
        window.viewport=refs.contentRef.current; saved.querySelector('button').click()`)
      await open('b')
      assert.equal(await run('saved.isConnected'), true)
      assert.equal(await run(`document.querySelectorAll('#chat-search-content').length`), 1)
      assert.equal(
        await run(
          `refs.contentRef.current===refs.searchRef.current && refs.contentRef.current!==viewport`
        ),
        true
      )
      assert.equal(
        await run(`[...effects].every(id=>id.startsWith('b-'))`),
        true,
        'hidden effects are paused'
      )
      await run(`renderChat('a',{loading:true})`)
      assert.equal(await run('saved.isConnected'), true, 'loading must not discard warm turns')
      assert.equal(await run(`document.querySelectorAll('#chat-search-content').length`), 1)
      await run(`window.bottomAlignments=0;window.turnMeasurements=0;
        window.originalBounds=Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect=function(){
          if(this.hasAttribute('data-chat-turn-id'))window.turnMeasurements++;
          return originalBounds.call(this)
        };undefined`)
      await open('a', { version: 2 })
      assert.equal(
        await run('window.bottomAlignments'),
        0,
        'revealing retained turns must not replay their initial scroll corrections'
      )
      assert.equal(
        await run('window.turnMeasurements'),
        0,
        'navigation must not synchronously measure the outgoing transcript'
      )
      await run('window.turnMeasurements=0;renderChat(null)')
      assert.equal(
        await run('window.turnMeasurements'),
        0,
        'opening the empty composer must not synchronously measure the outgoing transcript'
      )
      await open('a', { version: 2 })
      await run('Element.prototype.getBoundingClientRect=originalBounds;undefined')
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content [data-chat-turn-id="a-9"]')===saved`
        ),
        true
      )
      assert.equal(
        await run(`saved.querySelector('button').textContent`),
        '1',
        'turn state survives reopening'
      )
      assert.equal(
        await run(`created.filter(id=>id.startsWith('a-')).length`),
        10,
        'no turn remounts on a cache hit'
      )
      await run(`saved.querySelector('button').click()`)
      assert.deepEqual(await run('actions.at(-1)'), ['a', 2], 'revealed views use current handlers')
      await open(null, {}, 0)
      assert.equal(await run('effects.size'), 0)
      await open('a')
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content [data-chat-turn-id="a-9"]')===saved`
        ),
        true
      )
      await open('b')
      await run(`allowed=allowed.filter(key=>key!=='codex:a');renderChat('b')`)
      assert.equal(
        await run('saved.isConnected'),
        false,
        'invalidated chat data evicts its DOM too'
      )
      await run(`allowed.push('codex:a')`)
      await open('a')
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content [data-chat-turn-id="a-9"]')===saved`
        ),
        false
      )
      await open('b')
      await open('c')
      await run(
        `window.oldest=document.querySelector('[data-chat-view="codex:a"] [data-chat-turn-id="a-9"]')`
      )
      await run(`renderChat('a',{loading:true})`)
      await open('a')
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content [data-chat-turn-id="a-9"]')===oldest`
        ),
        true,
        'a loading shell must not evict the oldest warm destination'
      )
      await run(`document.getElementById('chat-search-content').scrollTop=0`)
      await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      assert.equal(
        await run(`(() => {const viewport=document.getElementById('chat-search-content').getBoundingClientRect();
        const first=document.querySelector('#chat-search-content [data-chat-turn-id="a-0"]').getBoundingClientRect();
        return first.bottom>viewport.top && first.top<viewport.bottom})()`),
        true,
        'offscreen retained turns render when scrolled into view'
      )
      await open('b')
      await open('c')
      await open('d')
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-view="codex:a"]'))`),
        false,
        'oldest chat is evicted'
      )
      assert.ok(await run(`document.querySelectorAll('[data-chat-view]').length<=3`))
      await open('big', {}, 1)
      await open('b')
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-view="codex:big"]'))`),
        false,
        'retained DOM has a node budget'
      )
      await open('embedded', {}, 1)
      await open('b')
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-view="codex:embedded"]'))`),
        false,
        'embedded apps retain their normal lifecycle'
      )
      await open('a')
      await run(
        `const dialog=document.createElement('div');dialog.role='dialog';dialog.id='fixture-dialog';document.body.append(dialog)`
      )
      await open('b')
      assert.equal(
        await run(`Boolean(document.querySelector('[data-chat-view="codex:a"]'))`),
        false,
        'open dialogs retain their normal lifecycle'
      )
      await run(`document.getElementById('fixture-dialog').remove()`)
      // Both running conversations keep receiving provider data while only the
      // selected view renders. Revealing the other view reconciles its latest data.
      await run(`allowed=[];renderChat(null);allowed=['codex:a','codex:b'];created.length=0`)
      await open('a', { active: true })
      await run(`window.runningA=[...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')];
        runningA.at(-1).querySelector('button').click()`)
      await open('b', { active: true })
      assert.equal(
        await run('runningA.every(node=>node.isConnected)'),
        true,
        'running conversations retain their mounted turns'
      )
      await run(`window.runningB=[...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')];
        window.streamTick=0;window.activeSwitchGaps=[];window.activeSwitchTasks=[];
        window.activeSwitchObserver=new PerformanceObserver(list=>activeSwitchTasks.push(...list.getEntries().map(e=>e.duration)));
        activeSwitchObserver.observe({type:'longtask'});
        let before=performance.now();window.sampleActiveSwitches=true;
        requestAnimationFrame(function sample(now){if(!sampleActiveSwitches)return;
          activeSwitchGaps.push(now-before);before=now;requestAnimationFrame(sample)});
        window.streamTimer=setInterval(()=>{
          streamTick++;
          for(const id of ['a','b'])appendChatText(id,'\\n\\nStream '+id+' update '+streamTick+'.');
          const {id,...options}=currentChat;renderChat(id,options);
        },30)`)
      for (const id of ['a', 'b', 'a', 'b']) {
        await open(id, { active: true, version: 2 })
        await run(`new Promise(resolve=>setTimeout(resolve,75))`)
        assert.equal(
          await run(`(() => {const saved=${id === 'a' ? 'runningA' : 'runningB'};
            return [...document.querySelectorAll('#chat-search-content [data-chat-turn-id]')].every((node,index)=>node===saved[index])})()`),
          true,
          'stream updates and switching reuse every existing turn node'
        )
        assert.equal(await run(`document.querySelectorAll('#chat-search-content').length`), 1)
        assert.equal(
          await run(`refs.contentRef.current===refs.searchRef.current &&
            refs.contentRef.current===document.getElementById('chat-search-content')`),
          true,
          'only the selected running chat owns the viewport'
        )
        assert.equal(
          await run(`[...effects].every(id=>id.startsWith('${id}-'))`),
          true,
          'hidden running-chat effects stay paused'
        )
      }
      await run(
        `clearInterval(streamTimer);sampleActiveSwitches=false;activeSwitchObserver.disconnect()`
      )
      assert.equal(
        await run('created.length'),
        20,
        'warm running-chat switches never remount turns'
      )
      for (const id of ['a', 'b']) {
        await open(id, { active: true, version: 3 })
        await run(`new Promise((resolve,reject)=>{const deadline=performance.now()+3000;
          function check(){if(document.querySelector('#chat-search-content').textContent.includes('Stream ${id} update '+streamTick+'.'))return resolve();
            if(performance.now()>deadline)return reject(new Error('Missing latest streamed text'));requestAnimationFrame(check)}check()})`)
      }
      await open('a', { active: false, version: 4 })
      assert.equal(
        await run(
          `document.querySelector('#chat-search-content [data-chat-turn-id="a-9"]')===runningA.at(-1)`
        ),
        true,
        'completion reuses the running view'
      )
      assert.equal(await run(`runningA.at(-1).querySelector('button').textContent`), '1')
      await run(`runningA.at(-1).querySelector('button').click()`)
      assert.deepEqual(
        await run('actions.at(-1)'),
        ['a', 4],
        'running views refresh action handlers'
      )
      console.log(
        'Active switch measurements:',
        await run(`JSON.stringify({
        turnsMounted:created.length,maxFrameGap:Math.max(...activeSwitchGaps),longTasks:activeSwitchTasks})`)
      )
      await open('b', { active: true })
      await run(`allowed=allowed.filter(key=>key!=='codex:a');renderChat('b',{active:true})`)
      assert.equal(
        await run('runningA.some(node=>node.isConnected)'),
        false,
        'invalidating a formerly active chat releases its retained view'
      )
      await run(`allowed=[];renderChat(null)`)
      assert.equal(
        await run(`document.querySelectorAll('[data-chat-view]').length`),
        0,
        'disabling the data cache releases retained views'
      )
      assert.deepEqual(errors, [])
      console.log(
        'Retained chat checks passed: DOM/state reuse, concurrent streams, completion, live handlers, loading, refs, paused effects, invalidation, LRU, memory bounds, and embedded exclusions.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
