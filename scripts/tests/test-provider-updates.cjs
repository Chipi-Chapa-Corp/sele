// Synthetic provider APIs and a temporary Electron profile. Run with isolated-gui.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-provider-updates-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
            import React, {useState} from 'react'
            import {createRoot} from 'react-dom/client'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/workspace/styles/conversation-requests.css'
            const stored = new Map()
            window.preferencesApi = {
              getItem:key=>({ok:true,value:stored.get(key)??null}),
              setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}}
            }
            window.calls=[]; window.failUpdate=false; window.failCheck=false; window.noopUpdate=false
            const versions={codex:['0.1.0','0.2.0'],claude:['2.1.0','2.2.0'],opencode:['1.19.5','2.2.0'],'opencode-v2':['2.1.0','2.2.0']}
            window.providerApi={
              getUpdateAvailability:async(id,options)=>{
                window.calls.push({method:'check',id,options})
                if(window.failCheck && id==='claude')throw Error('Fixture lookup failure')
                if(!versions[id])return null
                return {currentVersion:versions[id][0],latestVersion:versions[id][1]}
              },
              getProviderUpdateImpact:async(id,options)=>{window.calls.push({method:'impact',id,options});return {activeChatCount:0}},
              updateProvider:async(id,options)=>{
                window.calls.push({method:'update',id,options})
                if(window.failUpdate)throw Error('Fixture installation failure')
                if(window.noopUpdate)return {currentVersion:versions[id][0],latestVersion:versions[id][1]}
                await new Promise(resolve=>window.finishUpdate=resolve)
                versions[id][0]=versions[id][1];return null
              }
            }
            window.appApi={handleExternalLink:async options=>{window.calls.push({method:'link',options});return null}}
            Promise.all([
              import('./src/renderer/src/useProviderUpdates'),
              import('./src/renderer/src/workspace/components/ConversationComposer'),
              import('./src/renderer/src/settings'),
              import('./src/shared/provider')
            ]).then(([{useProviderUpdates},{ConversationComposer},{defaultAppSettings},{fallbackProviderModels}])=>{
              function Fixture(){
                const [container,setContainer]=useState({kind:'host'})
                const [selected,setSelected]=useState('codex')
                const [chat,setChat]=useState(null)
                const [active,setActive]=useState(false)
                const [model,setModel]=useState(fallbackProviderModels[0].id)
                const updates=useProviderUpdates({providerIds:['codex','claude','copilot','opencode','opencode-v2'],container,onUpdated:()=>{}})
                window.updates=updates;window.select=setSelected;window.setSource=setContainer
                window.setChat=setChat;window.setActive=setActive
                const providerId=chat?.providerId??selected
                const providerUpdating=updates.isProviderUpdating(providerId,chat?chat.container:container)
                const noop=()=>{}
                const settings={...defaultAppSettings,chat:{...defaultAppSettings.chat,presets:false}}
                return <main style={{padding:24,width:'min(100%, 1100px)',margin:'0 auto'}}>
                  <p>Chat · {providerId} · {container.kind==='host'?'Host':container.name}</p>
                  <ConversationComposer {...updates}
                    anyProviderUpdateInProgress={updates.providerUpdateInProgress}
                    providerUpdateInProgress={providerUpdating}
                    newChatOpen={!chat} selectedChat={chat} selectedChatKey={chat?.id??null}
                    chatHasActiveTurn={active} appSettings={settings} effectiveAppSettings={settings}
                    newSessionProvider={selected} newSessionCwd={null} newSessionNoProject={true}
                    newSessionProviderOptions={['codex','claude','copilot','opencode-v2'].map(value=>({value,label:value,disabled:updates.isProviderUpdating(value,container)}))}
                    newSessionProviderAvailable={true} messageBoxProviderAvailable={true}
                    newSessionLocation="folder" newSessionLocationOptions={[{value:'folder',label:'Folder'}]}
                    projectOptions={[]} newSessionProjectValue="none" containerOptions={[{value:'host',label:'Host'}]}
                    newSessionContainerValue="host" setNewSessionProvider={setSelected}
                    changesContainer={chat?chat.container:container} changesCwd={null} changesProjectCwd={null}
                    worktreeCreationState="idle" sendState="idle" terminalWorkspaceKey="fixture"
                    effectiveModel={model} models={fallbackProviderModels} agentMode="default" agentModes={[]}
                    effectiveApprovalMode="on-request" approvalModes={[]} effectiveSandboxMode="workspace-write" sandboxModes={[]}
                    effectiveReasoningEffort="medium" effectiveServiceTier={null} accountUsage={null}
                    accountUsageError={null} accountUsageState="idle"
                    messageBoxContextUsage={{source:'unavailable',usedTokens:null,maxTokens:null}}
                    setAgentMode={noop} handleApprovalModeChange={noop} handleModelChange={setModel}
                    handleReasoningEffortChange={noop} setServiceTier={noop} handleSandboxModeChange={noop}
                    handleSendMessage={message=>{window.calls.push({method:'send',id:providerId,message});return true}}
                    handleStopChat={()=>window.calls.push({method:'stop',id:providerId})}
                  />
                </main>
              }
              createRoot(document.getElementById('root')).render(<Fixture/>);
            })
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
                contents: 'export default class Worker { postMessage() {} terminate() {} }',
                loader: 'js'
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
        { env, encoding: 'utf8', timeout: 50000 }
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
    let code = 0
    let win
    try {
      win = new BrowserWindow({
        show: true,
        width: 1200,
        height: 800,
        webPreferences: { backgroundThrottling: false }
      })
      const rendererErrors = []
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') rendererErrors.push(details.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) =>
        win.webContents.executeJavaScript(source).catch((error) => {
          throw new Error(source + '\n' + rendererErrors.join('\n'), { cause: error })
        })
      const ready = (condition) =>
        run(
          `new Promise((resolve,reject)=>{const deadline=performance.now()+8000;function check(){if(${condition})return resolve();if(performanceNow()>deadline)return reject(Error('Timed out: '+${JSON.stringify(condition)}));requestAnimationFrame(check)}const performanceNow=()=>performance.now();check()})`
        )
      const count = () => run('document.querySelectorAll(".chat-provider-update").length')
      await ready('window.updates?.providerUpdateSuggestions.length===3')
      assert.equal(await count(), 3)
      assert.deepEqual(
        await run(
          'Array.from(document.querySelectorAll(".chat-provider-update__label"),x=>x.textContent)'
        ),
        ['Codex update available', 'Claude update available', 'OpenCode update available']
      )
      assert.equal(await run('document.body.textContent.includes("undefined")'), false)
      assert.equal(
        await run(
          'document.querySelectorAll(".chat-provider-update .provider-icon path[d]").length'
        ),
        3,
        'every suggestion has a provider icon'
      )
      assert.deepEqual(await run('window.calls.filter(x=>x.method==="check").map(x=>x.id)'), [
        'codex',
        'claude',
        'copilot',
        'opencode-v2'
      ])
      const rectangles = await run(
        'Array.from(document.querySelectorAll(".chat-provider-update"),x=>({top:x.getBoundingClientRect().top,bottom:x.getBoundingClientRect().bottom}))'
      )
      for (let i = 1; i < rectangles.length; i++)
        assert.ok(rectangles[i].top >= rectangles[i - 1].bottom, 'banners stack without overlap')
      const report = path.resolve(__dirname, '../../test-results/provider-updates')
      await fs.mkdir(report, { recursive: true })
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await new Promise((resolve) => setTimeout(resolve, 150))
      await fs.writeFile(
        path.join(report, 'stacked.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      await run('document.querySelector(".chat-provider-update .ui-button--secondary").click()')
      await ready('window.updates.providerUpdateSuggestions.length===2')
      await run('window.select("opencode-v2")')
      assert.equal(await count(), 2, 'provider selection does not discard other notices')
      assert.equal(await run('window.calls.filter(x=>x.method==="check").length'), 4)
      assert.equal(
        await run('window.calls.filter(x=>x.method==="check"&&x.id==="opencode").length'),
        0,
        'v1 is never queried'
      )
      assert.equal(await run('document.body.textContent.includes("Migrate")'), false)
      await run(
        'window.updates.handleNeverSuggestProviderUpdateVersion(window.updates.providerUpdateSuggestions.find(x=>x.providerId==="opencode-v2"))'
      )
      await ready('window.updates.providerUpdateSuggestions.length===1')
      await run('window.setSource({kind:"container",tool:"toolbox",name:"before-update"})')
      await ready('window.updates.providerUpdateSuggestions.length===2')
      await run(
        'window.updates.handleSkipProviderUpdate(window.updates.providerUpdateSuggestions.find(x=>x.providerId==="codex"))'
      )
      await ready('window.updates.providerUpdateSuggestions.length===1')
      await run(
        'window.failUpdate=true;window.updates.handleUpdateProvider(window.updates.providerUpdateSuggestions.find(x=>x.providerId==="claude"))'
      )
      await ready('document.querySelector(".chat-approval__error")')
      assert.equal(await count(), 1, 'failed updates remain retryable')
      await run(
        'window.failUpdate=false;window.noopUpdate=true;document.querySelector(".chat-provider-update .ui-button--primary").click()'
      )
      await ready(
        'document.querySelector(".chat-approval__error")?.textContent.includes("2.1.0 is still installed; 2.2.0 is available")'
      )
      assert.equal(await count(), 1, 'no-op updates show an error and remain retryable')
      assert.equal(
        await run('document.querySelector(".chat-provider-update .ui-button--primary").disabled'),
        false
      )
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await new Promise((resolve) => setTimeout(resolve, 150))
      await fs.writeFile(
        path.join(report, 'incomplete-update.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      await run(
        'window.noopUpdate=false;document.querySelector(".chat-provider-update .ui-button--primary").click()'
      )
      await ready('window.finishUpdate&&window.updates.providerUpdateInProgress')
      assert.equal(
        await run(
          'Array.from(document.querySelectorAll(".chat-provider-update")).filter(x=>x.textContent.includes("Updating")).length'
        ),
        1
      )
      // Claude is updating; the selected OpenCode provider stays fully usable.
      const disabled = (selector) =>
        run(`document.querySelector(${JSON.stringify(selector)})?.disabled`)
      const setText = (text) =>
        run(`
          {const input=document.querySelector('textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});
          input.dispatchEvent(new Event('input',{bubbles:true}));}void 0
      `)
      const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
      const providerRows = async () => {
        await click('[aria-label="Provider"]')
        await ready('document.querySelectorAll("[role=option]").length===4')
        return run(
          'Array.from(document.querySelectorAll("[role=option]"),x=>({label:x.textContent,disabled:x.getAttribute("aria-disabled")==="true"}))'
        )
      }
      assert.equal(await disabled('[aria-label="Provider"]'), false)
      assert.equal(await disabled('[aria-label="Project"]'), false)
      assert.equal(await disabled('[aria-label="Runtime"]'), false)
      assert.deepEqual(
        (await providerRows()).map((row) => row.disabled),
        [false, true, false, false]
      )
      await click('[role="option"][aria-disabled="true"]')
      assert.equal(
        await run('document.querySelector("[aria-label=Provider]").textContent'),
        'opencode-v2'
      )
      await click('[aria-label="Provider"]')
      await setText('unrelated provider')
      await ready(`!document.querySelector('[aria-label="Send message"]').disabled`)
      await click('[aria-label="Send message"]')
      await ready('window.calls.some(x=>x.method==="send"&&x.id==="opencode-v2")')
      await click('#chat-config-mode')
      await ready('document.querySelector("[data-chat-config-section=model]")')
      assert.equal(await disabled('[data-chat-config-section="model"]'), false)
      await click('#chat-config-mode')

      // An already selected provider is blocked only for sending and model selection.
      await run('window.select("claude")')
      await setText('keep editing during update')
      await ready(`document.querySelector('[aria-label="Send message"]').disabled`)
      assert.equal(await disabled('textarea'), false)
      assert.equal(
        await run('document.querySelector("textarea").value'),
        'keep editing during update'
      )
      await run(
        'document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}))'
      )
      assert.equal(
        await run('window.calls.filter(x=>x.method==="send"&&x.id==="claude").length'),
        0
      )
      await click('#chat-config-mode')
      await ready('document.querySelector("[data-chat-config-section=model]")')
      assert.equal(await disabled('[data-chat-config-section="model"]'), true)
      assert.equal(await disabled('[data-chat-config-section="access"]'), false)
      await click('#chat-config-mode')
      await run('window.setActive(true)')
      await ready(`document.querySelector('[aria-label="Stop response"]')`)
      assert.equal(await disabled('[aria-label="Stop response"]'), false)
      await click('[aria-label="Stop response"]')
      assert.equal(await run('window.calls.filter(x=>x.method==="stop").length'), 1)
      await run('window.setActive(false)')

      // Changing runtimes releases the new-chat controls, while existing chats retain
      // the update lock belonging to their own runtime.
      await run('window.setSource({kind:"host"})')
      await ready(`!document.querySelector('[aria-label="Send message"]').disabled`)
      assert.ok((await providerRows()).every((row) => !row.disabled))
      await click('[aria-label="Provider"]')
      assert.equal(
        await run(
          'window.updates.isProviderUpdating("claude",{kind:"container",tool:"toolbox",name:"before-update"})'
        ),
        true
      )
      assert.equal(
        await run(
          'window.updates.isProviderUpdating("codex",{kind:"container",tool:"toolbox",name:"before-update"})'
        ),
        false
      )
      await run(
        'window.setChat({id:"existing",providerId:"claude",container:{kind:"container",tool:"toolbox",name:"before-update"}})'
      )
      await setText('existing selected provider')
      await ready(`document.querySelector('[aria-label="Send message"]').disabled`)
      await run(
        'window.setChat({id:"other",providerId:"codex",container:{kind:"container",tool:"toolbox",name:"before-update"}})'
      )
      await setText('existing unrelated provider')
      await ready(`!document.querySelector('[aria-label="Send message"]').disabled`)
      await click('[aria-label="Send message"]')
      await ready('window.calls.some(x=>x.method==="send"&&x.id==="codex")')
      await run(
        'window.setChat(null);window.setSource({kind:"container",tool:"toolbox",name:"before-update"})'
      )
      await setText('send after completion')
      await run('window.finishUpdate()')
      await ready(
        'window.updates.providerUpdateSuggestions.length===0&&!window.updates.providerUpdateInProgress'
      )
      await ready(`!document.querySelector('[aria-label="Send message"]').disabled`)
      await click('#chat-config-mode')
      await ready('document.querySelector("[data-chat-config-section=model]")')
      assert.equal(await disabled('[data-chat-config-section="model"]'), false)
      await click('#chat-config-mode')
      await run(
        'window.failCheck=true;window.setSource({kind:"container",tool:"toolbox",name:"fixture"})'
      )
      await ready('window.updates.providerUpdateSuggestions.length===1')
      assert.equal(
        await run('window.updates.providerUpdateSuggestions[0].providerId'),
        'codex',
        'skips are scoped to the source'
      )
      console.log(
        'PASS: v2-only OpenCode, all-provider checks, stacked banners, independent dismissals, update failure/no-op/retry, source scoping, provider/runtime-scoped sending and model selection'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win?.destroy()
      app.exit(code)
    }
  })
}
