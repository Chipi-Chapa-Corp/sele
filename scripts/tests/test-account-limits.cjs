const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-account-limits-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { getVisibleUsageBadges } from './src/renderer/src/usageBadges'
            import { UsageIndicator } from './src/renderer/src/components/UsageIndicator'
            import { ChatSidebar } from './src/renderer/src/workspace/components/ChatSidebar'
            import { SidebarProviderAccount } from './src/renderer/src/workspace/components/SidebarProviderAccount'
            import { renderSettingsPanel } from './src/renderer/src/components/SettingsPanel'
            import { defaultAppSettings, readStoredAppSettings, writeStoredAppSettings } from './src/renderer/src/settings'
            import './src/renderer/src/App.css'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/workspace/styles/chat-sidebar.css'
            import './src/renderer/src/workspace/styles/settings-sections.css'
            import './src/renderer/src/workspace/styles/settings-controls.css'
            const root = createRoot(document.getElementById('root'))
            const noop = () => {}
            const limit = (windowMinutes, usedPercent) => ({id:windowMinutes === 300 ? 'five_hour' : 'seven_day',label:'Codex',kind:windowMinutes === 300 ? 'primary' : 'secondary',windowMinutes,usedPercent,resetsAt:null})
            window.fixture = { provider:'codex', context:true, limits:[limit(300,20),limit(10080,40)], settings:readStoredAppSettings(), tab:'chatSidebar', groupChatsByProject:true }
            window.renderFixture = (patch={}) => {
              Object.assign(window.fixture,patch)
              const s=window.fixture
              const contextUsage=s.context ? {source:'exact',usedTokens:20000,maxTokens:100000} : {source:'unavailable',usedTokens:null,maxTokens:null}
              if (s.sidebar) {
                flushSync(()=>root.render(<ChatSidebar
                  chats={[]} chromeControlTheme="transparent" displayedActiveChatGroups={[]} pinnedChatGroup={null} importedChatGroup={null} doneChatGroup={null}
                  loadState="ready" searchOpen={false} searchQuery="" searchInputRef={{current:null}}
                  sidebarSearch={{loading:false,error:null,hasMore:false}} renderWindowControls={()=>null}
                  renderSettingsButton={()=><button aria-label="Settings">Settings</button>} renderChatGroup={()=>null}
                  handleNewChat={noop} handleCloseSearch={noop} handleProjectDrop={noop} handleProjectStackDragOver={noop} handleImportedChat={noop}
                  setSearchOpen={noop} setSearchQuery={noop}
                  providerAccount={{openCode:{loading:s.providersLoading??false,providers:s.providers??[],selectedId:s.selectedProvider??'',error:null,manageOpen:false,onManage:noop,onClose:noop,onChanged:noop,onSelect:id=>window.renderFixture({selectedProvider:id})},key:'fixture:'+s.accountRevision,providerId:s.provider,container:s.container??null,available:true,updating:false,onSelect:async id=>{window.activeAccount=id},onCreate:()=>window.createAccount(s.provider),onDelete:id=>window.deleteAccount(s.provider,id)}}
                  usageIndicator={{chatId:s.chatId,providerId:s.provider,accountUsage:s.usageLoading?null:{rateLimits:s.limits,errors:[],updatedAt:1},accountUsageError:null,accountUsageState:s.usageLoading?'loading':'ready',contextUsage,displayUsage:s.settings.chat.displayUsage}}
                />))
                return
              }
              const settingsProps = {
                settingsTab:s.tab,settingsPanelSettings:s.settings,groupChatsByProject:s.groupChatsByProject,
                handleGroupChatsByProjectChange:enabled=>window.renderFixture({groupChatsByProject:enabled}),
                getSettingsFieldClassName:(...classes)=>['settings-dialog__field',...classes].join(' '),
                renderProjectSettingAction:()=>null,isScopedSettingControlDisabled:()=>false,
                forceAccessOptions:[],forceReviewOptions:[],forceModelOptions:[],forceReasoningOptions:[],forceSpeedOptions:[],
                handleChatDropdownPreferenceChange:noop,handleChatForcedDropdownChange:noop,
                handleNetworkRetrySettingChange:noop,handleContinuePromptChange:noop,
                handleChatUsageDisplayChange:displayUsage=>{
                  writeStoredAppSettings({...s.settings,chat:{...s.settings.chat,displayUsage}})
                  window.renderFixture({settings:readStoredAppSettings()})
                }
              }
              flushSync(()=>root.render(<main style={{padding:24,width:700}}>
                <div className="chat-sidebar__account-row" style={{width:340,marginBottom:24}}>
                  <SidebarProviderAccount refreshKey={String(s.accountRevision)} providerId={s.provider} container={null} available updating={false}
                    hasVisibleLimits={getVisibleUsageBadges(s.limits,contextUsage,s.settings.chat.displayUsage).length>0}
                    onSelect={async id=>{window.activeAccount=id}}
                    onCreate={()=>window.createAccount(s.provider)} onDelete={id=>window.deleteAccount(s.provider,id)}/>
                  <UsageIndicator providerId={s.provider} accountUsage={{rateLimits:s.limits,balances:s.balances??[],errors:[],updatedAt:1}} chatId={s.chatId}
                    modelProviderId={s.modelProviderId}
                    accountUsageState="ready" accountUsageError={null}
                    contextUsage={contextUsage}
                    displayUsage={s.settings.chat.displayUsage}/>
                </div>
                <div style={{maxHeight:620,overflow:'auto'}}>{renderSettingsPanel(settingsProps)}</div>
              </main>))
            }
            window.renderFixture()
          `,
          loader: 'tsx',
          resolveDir: path.resolve(__dirname, '../..')
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'no-update-checks',
            setup(build) {
              build.onResolve({ filter: /AppUpdatePrompt$/ }, (args) => ({
                path: args.path,
                namespace: 'fixture'
              }))
              build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents: 'export const AppUpdatePrompt=()=>null'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'bootstrap.js'),
        `
        const stored=new Map();window.activeAccount='default';
        window.preferencesApi={getItem:key=>({ok:true,value:stored.get(key)??null}),setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}},removeItem:key=>{stored.delete(key);return {ok:true,value:null}}};
        window.accountDelay=0;window.accountReads=0;window.importCalls=0;
        window.deletedAccounts=[];window.createdAccounts=[];window.removedWork=false;
        window.deleteAccount=async(provider,id)=>{window.deletedAccounts.push({provider,id});window.removedWork=true;window.activeAccount='default'};
        window.createAccount=async(provider)=>{window.createdAccounts.push({provider});return {userCode:null,completion:new Promise(resolve=>{window.completeAccount=resolve}),authorize:async()=>{},cancel:async()=>{}}};
        window.providerApi={getTokenUsage:async()=>({chat:{inputTokens:1000,cachedInputTokens:0,outputTokens:100,cost:{input:0.3,cachedInput:0,output:0.12,total:0.42}},week:{inputTokens:0,cachedInputTokens:0,outputTokens:0},month:{inputTokens:0,cachedInputTokens:0,outputTokens:0},updatedAt:1}),openChatImport:async()=>{window.importCalls++;return null},getAccounts:async provider=>{
          window.accountReads++;
          const response={available:provider==='codex'||provider==='claude',unavailableMessage:null,accounts:provider==='opencode' ? [{id:'default',displayName:'Default Account',active:true}] : [{id:'default',displayName:provider==='claude'?'Claude Name':'Jane Doe',active:window.activeAccount==='default'},{id:'work',displayName:provider==='claude'?'Claude at Work':'Jane at Work',active:window.activeAccount==='work'}].filter(account=>account.id!=='work'||!window.removedWork)};
          if(window.accountDelay) await new Promise(resolve=>setTimeout(resolve,window.accountDelay));
          return response;
        }};
      `
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="bootstrap.js"></script><script src="fixture.js"></script></html>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 40000 }
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    try {
      const errors = []
      const win = new BrowserWindow({
        width: 850,
        height: 800,
        show: true,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = async (source) => {
        try {
          return await win.webContents.executeJavaScript(source)
        } catch (error) {
          throw new Error(source + ': ' + error.message)
        }
      }
      const waitFor = async (source) => {
        for (let i = 0; i < 100; i++) {
          if (await run(source)) return
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error('Timed out: ' + source)
      }
      const badges = () =>
        run(
          'Array.from(document.querySelectorAll("[data-usage-limit]:not([inert])")).map(node=>node.dataset.usageLimit)'
        )
      await waitFor(
        'document.querySelector("[aria-label=\\"Codex account\\"]")?.textContent.includes("Jane Doe")'
      )
      assert.deepEqual(await badges(), ['short', 'long'])
      assert.equal(
        await run(
          'document.querySelector("[aria-labelledby=settings-group-chats-by-project]").checked'
        ),
        true
      )
      await run(
        'document.querySelector("[aria-labelledby=settings-group-chats-by-project]").click()'
      )
      assert.equal(await run('window.fixture.groupChatsByProject'), false)
      await run('window.renderFixture({tab:"chat"})')
      assert.equal(
        await run('Boolean(document.querySelector(".settings-dialog__limit-toggles"))'),
        false
      )
      await run('window.renderFixture({tab:"chatSidebar"})')

      assert.deepEqual(
        await run(
          'Array.from(document.querySelectorAll(".settings-dialog__limit-toggle input")).map(node=>[node.getAttribute("aria-label"),node.checked])'
        ),
        [
          ['Context', false],
          ['Short', true],
          ['Long', true]
        ]
      )
      await run(
        'document.querySelector(".settings-dialog__limit-toggle input[aria-label=Context]").click()'
      )
      assert.deepEqual(await badges(), ['context', 'short', 'long'])
      assert.deepEqual(
        await run(
          'Array.from(document.querySelectorAll("[data-usage-limit]:not([inert])")).map(node=>node.getBoundingClientRect().left)'
        ),
        await run(
          'Array.from(document.querySelectorAll("[data-usage-limit]:not([inert])")).map(node=>node.getBoundingClientRect().left).sort((a,b)=>a-b)'
        )
      )
      await run(
        'window.renderFixture({limits:window.fixture.limits.filter(limit=>limit.windowMinutes===10080),context:false})'
      )
      assert.deepEqual(await badges(), ['long'])
      await run('document.querySelector("[data-usage-limit=long]").click()')
      await waitFor('document.querySelector(".message-box__usage-popover")')
      await run(
        'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'
      )
      await run('window.renderFixture({limits:[]})')
      assert.deepEqual(await badges(), [])
      await run(
        'window.renderFixture({modelProviderId:"deepseek",balances:[{id:"deepseek:USD",modelProviderId:"deepseek",modelProviderName:"DeepSeek",label:"Balance",kind:"remaining",amount:12.5,currency:"USD"},{id:"openrouter:budget",modelProviderId:"openrouter",modelProviderName:"OpenRouter",label:"Budget (weekly)",kind:"spent",amount:40,limit:50,currency:"USD"}]})'
      )
      await waitFor('document.querySelector("[data-usage-balance=remaining]:not([inert])")')
      assert.match(
        await run('document.querySelector("[data-usage-balance=remaining]").textContent'),
        /12\.5/
      )
      await run('document.querySelector("[data-usage-balance=remaining]").click()')
      await waitFor('document.querySelector(".message-box__usage-popover")')
      assert.deepEqual(
        await run(
          'Array.from(document.querySelectorAll(".message-box__balances .message-box__balance-provider")).map(node=>node.textContent)'
        ),
        ['DeepSeek', 'OpenRouter']
      )
      assert.equal(
        await run(
          'document.querySelectorAll(".message-box__balance .message-box__usage-meter").length'
        ),
        1
      )
      await run(
        'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'
      )
      await run('window.renderFixture({modelProviderId:"openrouter"})')
      await waitFor('document.querySelector("[data-usage-balance=limit]:not([inert])")')
      await run('window.renderFixture({modelProviderId:"anthropic"})')
      await waitFor('!document.querySelector("[data-usage-balance]:not([inert])")')
      await run('window.renderFixture({modelProviderId:undefined,balances:[]})')
      // OpenCode: the chat cost opens a popover with no tabs and a "This chat" row.
      await run(
        'window.renderFixture({provider:"opencode",chatId:"chat-1",modelProviderId:"anthropic",balances:[{id:"anthropic:month",modelProviderId:"anthropic",modelProviderName:"Anthropic",label:"This month (organization)",kind:"spent",amount:9.7,currency:"USD"}]})'
      )
      await waitFor('document.querySelector("[data-usage-balance=spent]:not([inert])")')
      assert.match(
        await run('document.querySelector("[data-usage-balance=spent]").textContent'),
        /0\.42/
      )
      await run('document.querySelector("[data-usage-balance=spent]").click()')
      await waitFor('document.querySelector(".message-box__usage-popover")')
      assert.equal(await run('Boolean(document.querySelector(".message-box__usage-tabs"))'), false)
      assert.equal(
        await run(
          'document.querySelector(".message-box__usage-popover").textContent.includes("organization")'
        ),
        false
      )
      assert.match(
        await run('document.querySelector(".message-box__usage-popover").textContent'),
        /This chat\$0\.42/
      )
      await run(
        'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'
      )
      await run(
        'window.renderFixture({provider:"codex",chatId:undefined,modelProviderId:undefined,balances:[]})'
      )
      await run('document.querySelector("[aria-label=\\"Codex account\\"]").click()')
      await waitFor(
        'Array.from(document.querySelectorAll("[role=option]")).some(node=>node.textContent.includes("Jane at Work"))'
      )
      await run(
        'Array.from(document.querySelectorAll("[role=option]")).find(node=>node.textContent.includes("Jane at Work")).click()'
      )
      await waitFor(
        'document.querySelector("[aria-label=\\"Codex account\\"]")?.textContent.includes("Jane at Work")'
      )
      await run('window.renderFixture({provider:"opencode"})')
      await waitFor('!document.querySelector("[aria-label=\\"OpenCode account\\"]")')
      await run('window.renderFixture({context:true})')
      await waitFor(
        'document.querySelector("[aria-label=\\"OpenCode account\\"]")?.textContent.includes("Default Account")'
      )
      assert.deepEqual(await badges(), ['context'])
      await run(
        'document.querySelector(".settings-dialog__limit-toggle input[aria-label=Context]").click()'
      )
      await waitFor('!document.querySelector("[aria-label=\\"OpenCode account\\"]")')
      await run(
        'document.querySelector(".settings-dialog__limit-toggle input[aria-label=Context]").click()'
      )
      await run(
        'window.renderFixture({provider:"codex",context:true,limits:[{id:"five_hour",label:"Codex",kind:"primary",windowMinutes:300,usedPercent:20,resetsAt:null},{id:"seven_day",label:"Codex",kind:"secondary",windowMinutes:10080,usedPercent:40,resetsAt:null}]})'
      )
      await waitFor(
        'document.querySelector("[aria-label=\\"Codex account\\"]")?.textContent.includes("Jane at Work")'
      )
      const screenshot = path.join(
        process.env.HOME,
        '.cache/agent-desktops/sele-account-limits/result.png'
      )
      await fs.mkdir(path.dirname(screenshot), { recursive: true })
      await new Promise((resolve) => setTimeout(resolve, 150))
      await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG())
      await run('window.renderFixture({sidebar:true})')
      assert.equal(
        await run(
          'Boolean(document.querySelector(".chat-home__actions-left [aria-label=\\"Import chat\\"]"))'
        ),
        true
      )
      assert.equal(
        await run(
          'Boolean(document.querySelector(".chat-home__actions-right [aria-label=\\"Import chat\\"]"))'
        ),
        false
      )
      assert.equal(
        await run('Boolean(document.querySelector("button[aria-label^=\\"Chat grouping\\"]"))'),
        false
      )
      await run(
        'document.querySelector(".chat-home__actions-left [aria-label=\\"Import chat\\"]").click()'
      )
      await waitFor('window.importCalls === 1')
      await waitFor(
        'document.querySelector("[aria-label=\\"Codex account\\"]")?.textContent.includes("Jane at Work")'
      )
      // Existing usage badges survive chat/account switches; only changed values pop and pulse.
      await new Promise((resolve) => setTimeout(resolve, 250))
      await run(`
        window.shortBadge=document.querySelector('[data-usage-limit=short]');
        window.longBadge=document.querySelector('[data-usage-limit=long]');
        window.usageRing=window.shortBadge.querySelector('.message-box__usage-ring');
        window.usageSamples=[];
        const sampleUsage=()=>{
          const ring=getComputedStyle(window.usageRing);
          window.usageSamples.push({scale:ring.scale,transform:ring.transform,pulse:Number(getComputedStyle(window.shortBadge.querySelector('.message-box__usage-pulse')).opacity)});
          window.usageFrame=requestAnimationFrame(sampleUsage);
        };
        window.usageFrame=requestAnimationFrame(sampleUsage);
        window.renderFixture({chatId:'usage-chat',accountRevision:10,usageLoading:true});
      `)
      assert.equal(
        await run(
          `document.querySelector('[data-usage-limit=short]')===window.shortBadge && !window.shortBadge.inert`
        ),
        true
      )
      assert.equal(await run('window.shortBadge.textContent.trim()'), '80%')
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(await run('window.shortBadge.isConnected'), true)
      await run(
        `window.renderFixture({usageLoading:false,limits:window.fixture.limits.map(l=>({...l,usedPercent:l.windowMinutes===300?30:l.usedPercent}))})`
      )
      assert.equal(
        await run(
          `document.querySelector('[data-usage-limit=short]')===window.shortBadge && document.querySelector('[data-usage-limit=long]')===window.longBadge`
        ),
        true
      )
      assert.equal(await run('window.shortBadge.textContent.trim()'), '70%')
      await waitFor(
        `window.usageSamples.some(s=>s.scale!=='none'&&s.scale!=='1'||s.transform!=='none')`
      )
      await waitFor(`window.usageSamples.some(s=>s.pulse>0.1)`)
      await new Promise((resolve) => setTimeout(resolve, 400))
      await run('window.usageSamples=[];window.renderFixture()')
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(
        await run(
          `window.usageSamples.some(s=>s.pulse>0||s.scale!=='none'&&s.scale!=='1'||s.transform!=='none'&&s.transform!=='matrix(1, 0, 0, 1, 0, 0)')`
        ),
        false
      )
      await run(
        `window.renderFixture({limits:window.fixture.limits.filter(l=>l.windowMinutes===10080)})`
      )
      assert.equal(
        await run(
          'window.shortBadge.isConnected && window.shortBadge.inert && window.shortBadge.disabled'
        ),
        true
      )
      assert.equal(
        await run(`document.querySelector('[data-usage-limit=long]')===window.longBadge`),
        true
      )
      await waitFor('!window.shortBadge.isConnected')
      await run(
        `window.renderFixture({limits:[{id:'five_hour',label:'Codex',kind:'primary',windowMinutes:300,usedPercent:35,resetsAt:null},...window.fixture.limits]})`
      )
      assert.equal(
        await run(`document.querySelector('[data-usage-limit=short]')!==window.shortBadge`),
        true
      )
      await waitFor(
        `document.querySelector('[data-usage-limit=short]').getBoundingClientRect().width>50`
      )
      // Rapid remove/re-add cancels the exit and keeps surviving controls usable.
      await run(`
        window.returningBadge=document.querySelector('[data-usage-limit=short]');
        window.savedLimits=window.fixture.limits;
        window.renderFixture({limits:[]});
        window.renderFixture({limits:window.savedLimits});
      `)
      await new Promise((resolve) => setTimeout(resolve, 250))
      assert.equal(
        await run(
          `document.querySelector('[data-usage-limit=short]')===window.returningBadge && !window.returningBadge.inert && !window.returningBadge.disabled`
        ),
        true
      )
      await run(`window.longBadge.click()`)
      await waitFor(`document.querySelector('[role=dialog][aria-label=Usage]')`)
      await run(`window.renderFixture({chatId:'other-chat'})`)
      await waitFor(`!document.querySelector('[role=dialog][aria-label=Usage]')`)
      assert.equal(
        await run(`document.querySelector('[data-usage-limit=long]')===window.longBadge`),
        true
      )
      await run(`window.longBadge.click()`)
      await waitFor(`document.querySelector('[role=dialog][aria-label=Usage]')`)
      await run(`window.renderFixture({limits:[],context:false})`)
      await waitFor(`!document.querySelector('[data-usage-limit]')`)
      await waitFor(`!document.querySelector('[role=dialog][aria-label=Usage]')`)
      await run(`window.renderFixture({limits:window.savedLimits,context:true})`)
      await new Promise((resolve) => setTimeout(resolve, 250))
      assert.equal(
        await run(`Boolean(document.querySelector('[role=dialog][aria-label=Usage]'))`),
        false
      )
      // Reduced motion switches updates and presence changes to immediate, quiet changes.
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await waitFor(`matchMedia('(prefers-reduced-motion: reduce)').matches`)
      await new Promise((resolve) => setTimeout(resolve, 50))
      await run(`
        window.shortBadge=document.querySelector('[data-usage-limit=short]');
        window.usageRing=window.shortBadge.querySelector('.message-box__usage-ring');
        window.usageSamples=[];
        window.renderFixture({limits:window.fixture.limits.filter(l=>l.windowMinutes===300).map(l=>({...l,usedPercent:50}))});
      `)
      await waitFor(`!document.querySelector('[data-usage-limit=long]')`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(await run('window.shortBadge.textContent.trim()'), '50%')
      assert.equal(
        await run(
          `window.usageSamples.some(s=>s.pulse>0||s.scale!=='none'&&s.scale!=='1'||s.transform!=='none'&&s.transform!=='matrix(1, 0, 0, 1, 0, 0)')`
        ),
        false
      )
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
      win.webContents.debugger.detach()
      await waitFor(`!matchMedia('(prefers-reduced-motion: reduce)').matches`)
      await run('cancelAnimationFrame(window.usageFrame)')
      await run(`
        window.accountButton=document.querySelector('[aria-label="Codex account"]');
        window.accountLabel=window.accountButton.querySelector('.ui-dropdown__value-label');
        window.accountLabels=[];window.accountAnimations=[];
        window.labelObserver=new MutationObserver(()=>window.accountLabels.push(window.accountLabel.textContent));
        window.labelObserver.observe(window.accountLabel,{childList:true,subtree:true,characterData:true});
        const sampleMotion=()=>{
          const style=getComputedStyle(window.accountLabel);
          if(style.transform!=='none'||(style.scale!=='none'&&style.scale!=='1')) window.accountAnimations.push({transform:style.transform,scale:style.scale});
          window.accountMotionFrame=requestAnimationFrame(sampleMotion);
        };
        window.accountMotionFrame=requestAnimationFrame(sampleMotion);
        window.accountDelay=100;
        window.renderFixture({accountRevision:1});
      `)
      assert.equal(
        await run(
          'document.querySelector("[aria-label=\\"Codex account\\"]") === window.accountButton'
        ),
        true
      )
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Jane at Work')
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Jane at Work')
      await run('window.renderFixture({provider:"claude"})')
      assert.equal(
        await run(
          'document.querySelector("[aria-label=\\"Claude account\\"]") === window.accountButton'
        ),
        true
      )
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Jane at Work')
      await waitFor('window.accountLabel.textContent.includes("Claude at Work")')
      assert.equal(
        await run('window.accountLabels.some(label=>label.includes("Loading account"))'),
        false
      )
      await waitFor('window.accountAnimations.length > 0')
      await run('window.renderFixture({provider:"codex"})')
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Jane at Work')
      assert.equal(
        await run(
          'document.querySelector("[aria-label=\\"Codex account\\"]") === window.accountButton'
        ),
        true
      )
      // Crossing the account/provider boundary must retain the trigger, even without usage badges.
      await run(`
        window.accountAnimations=[];
        window.renderFixture({provider:'opencode',limits:[],context:false,providersLoading:true});
      `)
      assert.equal(
        await run(
          `document.querySelector('[aria-label="OpenCode provider"]') === window.accountButton`
        ),
        true
      )
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Jane at Work')
      assert.equal(
        await run('window.accountButton.isConnected && window.accountLabel.isConnected'),
        true
      )
      await run(`window.renderFixture({providers:[
        {id:'openai',name:'OpenAI',connections:[]},
        {id:'anthropic',name:'Anthropic',connections:[]}
      ],selectedProvider:'openai',providersLoading:false})`)
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'OpenAI')
      await waitFor('window.accountAnimations.length > 0')
      await run('window.accountButton.click()')
      await waitFor(
        `document.querySelector('.ui-dropdown__action')?.textContent.includes('Manage Providers')`
      )
      assert.equal(
        await run(
          `Array.from(document.querySelectorAll('.ui-dropdown__option')).some(el=>el.textContent.includes('Anthropic'))`
        ),
        true
      )
      assert.equal(
        await run(
          `Array.from(document.querySelectorAll('.ui-dropdown__action')).some(el=>el.textContent.includes('Add account'))`
        ),
        false
      )
      await run(
        `Array.from(document.querySelectorAll('.ui-dropdown__option')).find(el=>el.textContent.includes('Anthropic')).click()`
      )
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Anthropic')
      assert.equal(
        await run(
          `document.querySelector('[aria-label="OpenCode provider"]') === window.accountButton`
        ),
        true
      )
      // An uncached account source holds the provider label until the lookup resolves.
      await run(`window.renderFixture({provider:'codex',container:{kind:'host'}})`)
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Codex account"]') === window.accountButton`
        ),
        true
      )
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Anthropic')
      assert.equal(await run('window.accountButton.disabled'), true)
      // Navigate away before that lookup resolves; stale results cannot change the provider label.
      await run(`window.renderFixture({provider:'opencode'})`)
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Anthropic')
      assert.equal(
        await run(
          `document.querySelector('[aria-label="OpenCode provider"]') === window.accountButton`
        ),
        true
      )
      await run(`window.renderFixture({provider:'codex'})`)
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Anthropic')
      await waitFor(`window.accountLabel.textContent.trim() === 'Jane at Work'`)
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Codex account"]') === window.accountButton`
        ),
        true
      )
      await run(`window.renderFixture({provider:'opencode',providers:[],selectedProvider:''})`)
      assert.equal(await run('window.accountLabel.textContent.trim()'), 'Providers')
      assert.equal(
        await run(
          `document.querySelector('[aria-label="OpenCode provider"]') === window.accountButton`
        ),
        true
      )
      await run(`window.renderFixture({provider:'codex',container:null})`)
      await run('window.labelObserver.disconnect();cancelAnimationFrame(window.accountMotionFrame)')

      await run(
        'window.accountDelay=0;window.confirmations=[];window.confirm=message=>{window.confirmations.push(message);return false};void 0'
      )
      await run('document.querySelector("[aria-label=\\"Codex account\\"]").click()')
      await waitFor('document.querySelector("[aria-label=\\"Delete account Jane at Work\\"]")')
      assert.equal(
        await run(
          'document.querySelector("[aria-label=\\"Delete account Jane at Work\\"]").classList.contains("ui-button-menu__inline-action")'
        ),
        true
      )
      assert.equal(
        await run(
          'Boolean(document.querySelector("[aria-label=\\"Delete account Jane at Work\\"] svg.lucide-x"))'
        ),
        true
      )
      await new Promise((resolve) => setTimeout(resolve, 150))
      await fs.writeFile(
        path.join(path.dirname(screenshot), 'shared-account-menu.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      assert.equal(
        await run('Boolean(document.querySelector("[aria-label=\\"Delete account Jane Doe\\"]"))'),
        false
      )
      await run('document.querySelector("[aria-label=\\"Delete account Jane at Work\\"]").click()')
      assert.equal(await run('window.deletedAccounts.length'), 0)
      assert.equal(await run('window.confirmations[0].includes("Jane at Work")'), true)
      await run(
        'window.confirm=()=>true;document.querySelector("[aria-label=\\"Codex account\\"]").click()'
      )
      await waitFor('document.querySelector("[aria-label=\\"Delete account Jane at Work\\"]")')
      await run('document.querySelector("[aria-label=\\"Delete account Jane at Work\\"]").click()')
      await waitFor(
        'window.deletedAccounts.length===1 && document.querySelector("[aria-label=\\"Codex account\\"]").textContent.includes("Jane Doe")'
      )
      assert.deepEqual(await run('window.deletedAccounts'), [{ provider: 'codex', id: 'work' }])
      await run('document.querySelector("[aria-label=\\"Codex account\\"]").click()')
      await waitFor(
        'Array.from(document.querySelectorAll(".ui-dropdown__action")).some(node=>node.textContent.includes("Add account"))'
      )
      await run(
        'Array.from(document.querySelectorAll(".ui-dropdown__action")).find(node=>node.textContent.includes("Add account")).click()'
      )
      await waitFor('Boolean(document.querySelector("[aria-label=\\"Authorize Codex account\\"]"))')
      assert.equal(await run('Boolean(document.getElementById("account-dialog-name"))'), false)
      assert.deepEqual(await run('window.createdAccounts'), [{ provider: 'codex' }])
      await run('window.completeAccount();void 0')
      await waitFor('!document.querySelector(".account-dialog")')
      assert.deepEqual(errors, [])
      console.log('Account and limit UI checks passed; screenshot: ' + screenshot)
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
