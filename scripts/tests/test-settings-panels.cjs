// Real settings components, fixture APIs and a disposable Electron profile.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-settings-panels-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { renderSettingsPanel } from './src/renderer/src/components/SettingsPanel'
            import { defaultAppSettings } from './src/renderer/src/settings'
            const root = createRoot(document.getElementById('root'))
            window.calls = []
            window.settings = structuredClone(defaultAppSettings)
            const record = name => (...args) => window.calls.push([name,...args])
            const manual = [{value:'manual', label:'Manual'}]
            const props = {
              settingsPanelSettings:window.settings, settingsScopeKey:'global',
              getSettingsFieldClassName:(...names)=>['settings-dialog__field',...names.filter(Boolean)].join(' '),
              renderProjectSettingAction:()=>null, isScopedSettingControlDisabled:()=>false,
              forceAccessOptions:manual, forceModelOptions:manual, forceReasoningOptions:manual,
              forceReviewOptions:manual, forceSpeedOptions:manual,
              groupChatsByProject:true, chatSidebarTabs:{active:true,done:true,archived:true},
              installedFontFamilies:[], installedFontOptions:[], installedFontsLoaded:true,
              appearanceZoomLevelInput:'100', appearanceFontSizeInputDraft:null,
              browserDefaultScaleInput:'100', changesContainer:null,changesContainerKey:'local',
              newSessionContainer:{type:'host'}, newSessionContainerValue:'local',
              containerOptions:[{value:'local',label:'Local'}], newSessionProvider:'codex',
              newSessionProviderOptions:[{value:'codex',label:'Codex'}],
              newSessionSourceAvailabilityReady:true,
              providerResourcesLoadState:'ready',
              providerAccountUpdatingId:null,providerResourceUpdatingKey:null,providerResourcesError:null,
              settingsProviderApps:[],settingsProviderSkills:[],
              sshEnvironmentError:null, windowControlsHidden:false,
              gitCommitModelOptions:[{value:'current-chat',label:'Current chat'}],
              gitCommitModelValue:'current-chat',gitSettingsModelsCurrent:true,gitSettingsModelsReady:true,
              gitSettingsModelCatalogLoading:false
            }
            for (const name of ${JSON.stringify([
              'handleAppearanceControlStyleChange',
              'handleAppearanceFontFamilyChange',
              'handleAppearanceFontSizeInputBlur',
              'handleAppearanceFontSizeInputChange',
              'handleAppearancePositionChange',
              'handleAppearanceStyleChange',
              'handleAppearanceZoomLevelInputBlur',
              'handleAppearanceZoomLevelInputChange',
              'handleThemePreferenceChange',
              'handleBrowserDefaultScaleChange',
              'handleBrowserEnabledChange',
              'handleBrowserViewChange',
              'handleChatDropdownPreferenceChange',
              'handleChatDropdownSettingChange',
              'handleChatUsageDisplayChange',
              'handleCodexRecommendedPluginsChange',
              'handleNativeChromeChange',
              'handleNetworkRetrySettingChange',
              'handleContinuePromptChange',
              'handleLinkedChatSummaryPromptChange',
              'handleGroupChatsByProjectChange',
              'handleChatSidebarTabChange',
              'handleGitCommitMessageGenerationChange',
              'handleGitCommitModelChange',
              'handleGitCommitPromptChange',
              'handleGitErrorResolutionPromptChange',
              'handleGitQuickActionsChange',
              'handleGitPullRequestsEnabledChange',
              'handleGitUntrackedFilesPromptChange',
              'handleGitWorktreeChange',
              'handleMaxChatsRenderedChange',
              'handlePerformancePreferenceChange',
              'handleRecentChatCacheLimitChange',
              'handleRecentlyOpenedFilesLimitChange',
              'handleRecentsMessageLimitChange',
              'setBrowserDefaultScaleInputDraft',
              'setNewSessionProvider',
              'handleNewSessionContainerChange'
            ])}) props[name] = record(name)
            window.renderPanel = (tab, patch={}) => {
              Object.assign(props,patch)
              flushSync(()=>root.render(renderSettingsPanel({...props,settingsTab:tab})))
            }
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <div id="root"></div><script>
          const values = new Map();
          window.preferencesApi = {
            getItem:key=>({ok:true,value:values.get(key)??null}),
            setItem:(key,value)=>{values.set(key,value);return {ok:true}},
            removeItem:key=>{values.delete(key);return {ok:true}}
          };
          window.desktopApi = {getState:async()=>({computer:{connected:false,connecting:false,backend:null,error:null},chrome:{connected:false,pairingUrl:null}})};
          window.localAccessApi = {getState:async()=>({enabled:false,port:4589,urls:[],error:null})};
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
      assert.equal(result.status, 0, result.stderr || result.error?.message)
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
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    let code = 0
    try {
      const errors = []
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) =>
        win.webContents.executeJavaScript(source).catch((error) => {
          throw new Error(source + '\n' + errors.join('\n'), { cause: error })
        })
      const settle = () => run('new Promise(resolve=>setTimeout(resolve,60))')
      for (const tab of [
        'appearance',
        'chat',
        'chatSidebar',
        'performance',
        'git',
        'browser',
        'providers'
      ]) {
        await run(`renderPanel('${tab}')`)
        await settle()
        assert.equal(await run('document.querySelectorAll("[role=tabpanel]").length'), 1)
        assert.equal(
          await run('document.querySelector("[role=tabpanel]").id'),
          'settings-panel-' + tab
        )
      }
      await run("renderPanel('browser'); window.calls=[]")
      await settle()
      assert.match(
        await run('document.querySelector("#settings-native-chrome").parentElement.textContent'),
        /Keep using your existing browser setup/
      )
      assert.equal(
        await run(
          'document.querySelector("#settings-native-chrome").parentElement.querySelector("details").open'
        ),
        false,
        'official Chrome integrations are optional and off by default'
      )
      assert.equal(
        await run('document.querySelector("[aria-label^=Desktop] details").open'),
        false,
        'Sele extension pairing is collapsed by default'
      )
      await run(
        'document.querySelector("#settings-native-chrome").parentElement.querySelector("summary").click()'
      )
      assert.equal(
        await run(
          'Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="Connect computer").closest("details")'
        ),
        null,
        'desktop control is separate from the optional Chrome extension'
      )
      for (const provider of ['claude', 'codex']) {
        assert.equal(
          await run(
            `document.querySelector('[aria-labelledby="settings-native-chrome-${provider}"]').checked`
          ),
          false
        )
        await run(
          `document.querySelector('[aria-labelledby="settings-native-chrome-${provider}"]').click()`
        )
      }
      assert.deepEqual(await run('window.calls'), [
        ['handleNativeChromeChange', 'claude', true],
        ['handleNativeChromeChange', 'codex', true]
      ])
      await run('settings.providers.codex.nativeChrome=true; renderPanel("browser")')
      assert.equal(
        await run(
          'document.querySelector("#settings-native-chrome").parentElement.querySelector("details").open'
        ),
        true,
        'an enabled official integration is visible when reopening Settings'
      )
      await run('settings.providers.codex.nativeChrome=false; renderPanel("browser")')
      await run('document.querySelector("[aria-label^=Desktop] summary").click()')
      assert.equal(await run('document.querySelector("[aria-label^=Desktop] details").open'), true)
      for (const provider of ['claude', 'codex', 'copilot', 'opencode']) {
        await run(`renderPanel('providers', {newSessionProvider:${JSON.stringify(provider)}})`)
        await settle()
        assert.equal(await run('document.querySelector("#settings-native-chrome")'), null)
      }
      await run(`renderPanel('localNetwork')`)
      await settle()
      assert.ok(await run('document.querySelector("#settings-local-access-port")'))
      await run(`renderPanel('chat'); window.calls=[];
        document.querySelector('[aria-labelledby="settings-chat-prompt-suggestions"]').click();
        document.querySelector('[aria-labelledby="settings-chat-progress-expand-start"]').click()`)
      await settle()
      assert.deepEqual(await run('window.calls'), [
        ['handleChatDropdownPreferenceChange', 'promptSuggestions', false],
        ['handleChatDropdownPreferenceChange', 'expandProgressOnStart', false]
      ])
      await run(`renderPanel('chat',{isScopedSettingControlDisabled:path=>path.section==='chat'});
        window.calls=[];
        document.querySelector('[aria-labelledby="settings-chat-prompt-suggestions"]').click()`)
      await settle()
      assert.deepEqual(
        await run('window.calls'),
        [],
        'project-scoped disabled controls remain inert'
      )
      await run(`renderPanel('appearance',{isScopedSettingControlDisabled:()=>false});window.calls=[];
        Array.from(document.querySelectorAll('[aria-label="Theme"] button')).find(button=>button.textContent==='Dark').click()`)
      await settle()
      assert.deepEqual(await run('window.calls'), [['handleThemePreferenceChange', 'dark']])
      assert.deepEqual(errors, [])
      console.log(
        'Settings panel checks passed: all eight tabs, shared chat controls, project overrides and theme changes.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
