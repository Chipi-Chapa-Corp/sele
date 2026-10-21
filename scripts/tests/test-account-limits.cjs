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
                  providerAccount={{key:'fixture:'+s.accountRevision,providerId:s.provider,container:null,available:true,updating:false,onSelect:async id=>{window.activeAccount=id},onCreate:()=>window.createAccount(s.provider),onDelete:id=>window.deleteAccount(s.provider,id)}}
                  usageIndicator={{providerId:s.provider,accountUsage:{rateLimits:s.limits,errors:[],updatedAt:1},accountUsageError:null,accountUsageState:'ready',contextUsage,displayUsage:s.settings.chat.displayUsage}}
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
                  <UsageIndicator providerId={s.provider} accountUsage={{rateLimits:s.limits,errors:[],updatedAt:1}}
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
        window.providerApi={openChatImport:async()=>{window.importCalls++;return null},getAccounts:async provider=>{
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
          'Array.from(document.querySelectorAll("[data-usage-limit]")).map(node=>node.dataset.usageLimit)'
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
          'Array.from(document.querySelectorAll("[data-usage-limit]")).map(node=>node.getBoundingClientRect().left)'
        ),
        await run(
          'Array.from(document.querySelectorAll("[data-usage-limit]")).map(node=>node.getBoundingClientRect().left).sort((a,b)=>a-b)'
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
