// Production turn renderer, media and retention, with a disposable profile.
// Run through isolated-gui. No providers or personal data are opened.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-continuity-'))
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {ConversationMessages} from './src/renderer/src/workspace/components/ConversationMessages'
            import {renderRootChatTurn} from './src/renderer/src/workspace/chatTurnRendering'
            import {buildChatConversationModel} from './src/renderer/src/chatConversationModel'
            import {reuseChatSnapshotItems} from './src/renderer/src/chatSnapshotItems'
            import {captureMessageFlight} from './src/renderer/src/motion/messageFlight'
            import './src/renderer/src/App.css'
            import './src/renderer/src/assets/main.css'
            const root=createRoot(document.getElementById('root'))
            const noop=()=>{}, map=new Map(), set=new Set()
            const contentRef={current:null}, searchRef={current:null}, subagentRef={current:null}
            window.current={id:'chat',items:[]}
            window.showConversation=(items=window.current.items,visible=true)=>{
              const detail=reuseChatSnapshotItems(window.current,{id:'chat',items})
              window.current=detail
              const model=buildChatConversationModel(detail.items)
              const inputs={...model,visibleChatItems:detail.items,
                subagentCompletions:{before:map,after:map},renderSubagentCompletion:noop,
                chatCommitMarkersByBeforeItemId:map,chatCommitMarkersByAfterItemId:map,
                trailingChatCommitMarkers:[],renderChatCommitMarker:noop,
                continuedStoppedWorkingStepIds:set,pinnedChatMessageIds:set,
                motionChatKey:'codex:chat',scheduleChatAutoScroll:noop,
                container:null,cwd:'/fixture',projectCwd:'/fixture',
                latestRenderedTurn:model.turns.at(-1),windowIncludesLatest:true}
              const props={visible,cachedChatKeys:['codex:chat'],
                chatAutoScrollEnabledRef:{current:true},scrollChatContentToBottom:noop,
                changesContainer:null,changesCwd:'/fixture',chatMediaStartIndex:0,
                chatMediaTotalCount:model.turns.length,activeSubagentChatView:null,
                chatHasActiveTurn:true,chatKnown:true,chatLoadState:'ready',
                chatSearchContentRef:searchRef,chatTurnPageLoadDirection:null,
                contentRef,subagentContentRef:subagentRef,editingMessage:null,
                effectiveChatTurnWindow:{startIndex:0,endIndex:model.turns.length},
                handleNativeChatContentScroll:noop,handleNativeChatContentWheel:noop,
                renderChatTurn:(index,turn)=>renderRootChatTurn(inputs,index,turn),
                renderedChatTurns:model.turns,selectedChat:{id:'chat',providerId:'codex'},
                selectedChatKey:'codex:chat',selectedChatCommitMarkers:[],selectedChatSubagents:[],
                subagentChatConversationModel:{turns:[]},subagentVisibleChatItems:[],
                visibleChatItems:detail.items,sendState:'idle',showChatTurnDownButton:false}
              flushSync(()=>root.render(<React.StrictMode><ConversationMessages {...props}/></React.StrictMode>))
            }
            window.send=()=>{
              captureMessageFlight(document.getElementById('composer'),'Look at this','codex:chat')
              window.showConversation([{type:'message',role:'user',id:'optimistic:1:user',
                content:'Look at this',createdAt:Date.now(),attachments:[{
                  kind:'image',name:'Attached image',path:'/fixture/attached.png',dataUrl:window.pixel}]}])
            }
            window.showConversation()
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
              build.onLoad({ filter: /localMediaCache\.ts$/ }, async (args) => ({
                contents: (await fs.readFile(args.path, 'utf8')).replace(
                  'idleTtlMs = 30_000',
                  'idleTtlMs = 100'
                ),
                loader: 'ts',
                resolveDir: path.dirname(args.path)
              }))
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
        `
        <link rel="stylesheet" href="fixture.css"><div class="chat-panel" id="root" style="height:600px"></div>
        <textarea id="composer" style="position:fixed;bottom:0;left:100px">Look at this</textarea>
        <script>
          window.pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
          window.reads=[];window.pendingReads=[];
          window.appApi={getLocalImage:options=>{window.reads.push(options);return new Promise(resolve=>window.pendingReads.push(resolve))}};
          window.providerApi={};
          window.resolveImages=async()=>{const data=await(await fetch(pixel)).arrayBuffer();pendingReads.splice(0).forEach(resolve=>resolve({data,mimeType:'image/png'}))};
        </script><script src="fixture.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 30000 }
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
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        show: true,
        width: 1000,
        height: 800,
        webPreferences: { backgroundThrottling: false }
      })
      const errors = []
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const frames = () =>
        run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await run(`send();window.row=document.querySelector('[data-chat-message-id]');
        window.turn=document.querySelector('[data-chat-turn-id]');
        window.attachment=document.querySelector('.chat-detail__generated-image-thumbnail img')`)
      assert.equal(
        await run('Boolean(attachment) && attachment.src===pixel'),
        true,
        'selected image displays during a delayed file read'
      )
      await frames()
      assert.equal(await run('Boolean(document.querySelector(".message-flight"))'), true)
      await run(`window.showConversation([{...current.items[0],id:'native-user',editTargetId:'native-turn',
        attachments:[{kind:'image',name:'Attached image',path:'/fixture/attached.png'}]}])`)
      assert.equal(
        await run(`row===document.querySelector('[data-chat-message-id="native-user"]') &&
        turn===document.querySelector('[data-chat-turn-id="native-user"]') &&
        attachment===document.querySelector('.chat-detail__generated-image-thumbnail img') && attachment.src===pixel`),
        true,
        'provider confirmation preserves the turn, message and attached image before paint'
      )
      await run('resolveImages()')
      await frames()
      assert.equal(
        await run(
          'attachment===document.querySelector(".chat-detail__generated-image-thumbnail img")'
        ),
        true
      )
      await new Promise((resolve) => setTimeout(resolve, 500))
      assert.equal(
        await run('getComputedStyle(row).opacity'),
        '1',
        'confirmed row remains visible after landing'
      )
      assert.equal(await run('document.querySelector(".message-flight")'), null)
      await run(
        `showConversation([...current.items,{id:'answer',type:'message',role:'assistant',content:'![Result](/fixture/result.png)'}]);resolveImages()`
      )
      await frames()
      await run(
        `window.markdownImage=document.querySelector('.chat-detail__markdown-image img');markdownImage.decode()`
      )
      await run('showConversation(current.items,false)')
      await frames()
      await run('showConversation()')
      await frames()
      assert.equal(
        await run('markdownImage===document.querySelector(".chat-detail__markdown-image img")'),
        true,
        'Activity reconnect preserves the decoded Markdown image node'
      )
      assert.equal(await run('reads.length'), 2, 'reconnection reuses both media leases')
      await run('showConversation(current.items,false)')
      await new Promise((resolve) => setTimeout(resolve, 250))
      await run('showConversation()')
      assert.equal(
        await run(`attachment===document.querySelector('.chat-detail__generated-image-thumbnail img') &&
        markdownImage===document.querySelector('.chat-detail__markdown-image img')`),
        true,
        'expired idle leases retain mounted pixels while replacement file reads are pending'
      )
      assert.equal(
        await run('reads.length'),
        4,
        'the fixture actually expired and reacquired both resources'
      )
      await run('resolveImages()')
      await frames()
      assert.equal(
        await run(`document.querySelectorAll('.chat-detail__generated-image-loading').length===0 &&
        [...document.querySelectorAll('img')].every(image=>image.complete && image.naturalWidth>0)`),
        true
      )
      assert.deepEqual(errors, [])
      console.log(
        'Message continuity passed: delayed attachments, canonical IDs, turn/message/image DOM, send landing, Activity media reconnect'
      )
      win.destroy()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
