const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-continue-reset-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {renderRootChatTurn} from './src/renderer/src/workspace/chatTurnRendering'
            import {renderSettingsPanel} from './src/renderer/src/components/SettingsPanel'
            import {readStoredAppSettings,writeStoredAppSettings} from './src/renderer/src/settings'
            import {LimitResetQueueMessages} from './src/renderer/src/components/LimitResetQueueMessages'
            import './src/renderer/src/App.css'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/workspace/styles/settings-sections.css'
            import './src/renderer/src/workspace/styles/settings-controls.css'
            const stored = new Map()
            window.preferencesApi = {
              getItem:key=>({ok:true,value:stored.get(key)??null}),
              setItem:(key,value)=>{stored.set(key,value);return {ok:true,value:null}},
              removeItem:key=>{stored.delete(key);return {ok:true,value:null}}
            }
            window.settings=readStoredAppSettings()
            window.queueEntries=[]
            const root = createRoot(document.getElementById('root'))
            const noop = () => {}
            window.calls = []
            const item = {type:'working', id:'failed', status:'failed', failureReason:'rateLimit',
              failureMessage:'OpenCode usage limit reached. Free usage exceeded, subscribe to Go', items:[]}
            const inputs = {
              itemIndexesById:new Map([['failed', 0]]), visibleChatItems:[item],
              followingWorkingStepsById:new Map(), workingStepIdsWithNextWorkingStep:new Set(),
              steeredWorkingStepDisclosureTargets:new Map(), subagentCompletions:{before:new Map(),after:new Map()},
              renderSubagentCompletion:noop, chatCommitMarkersByBeforeItemId:new Map(),
              chatCommitMarkersByAfterItemId:new Map(), trailingChatCommitMarkers:[], renderChatCommitMarker:noop,
              firstPendingChatItemId:null, scheduleChatAutoScroll:noop, continuedStoppedWorkingStepIds:new Set(),
              pinnedChatMessageIds:new Set(), stoppedTurnRetryMessages:new Map(), canRetryStoppedTurns:false,
              continuePrompt:'  Keep working.  ', availableRateLimitResets:0,
              onContinueStoppedTurn:async (id,prompt) => window.calls.push(['now',id,prompt]),

            }
            window.renderFixture = (changes={}, step={}) => {
              Object.assign(inputs,changes)
              inputs.visibleChatItems = [{...item,...step}]
              const props = {
                settingsTab:'chat',settingsPanelSettings:window.settings,
                getSettingsFieldClassName:(...classes)=>['settings-dialog__field',...classes].join(' '),
                renderProjectSettingAction:()=>null,isScopedSettingControlDisabled:()=>false,
                forceAccessOptions:[],forceReviewOptions:[],forceModelOptions:[],forceReasoningOptions:[],forceSpeedOptions:[],
                handleChatDropdownPreferenceChange:(key,enabled)=>{
                  writeStoredAppSettings({...window.settings,chat:{...window.settings.chat,[key]:enabled}})
                  window.settings=readStoredAppSettings();window.renderFixture()
                },
                handleChatDropdownSettingChange:noop,handleNetworkRetrySettingChange:noop,
                handleContinuePromptChange:noop,handleLinkedChatSummaryPromptChange:noop
              }
              flushSync(() => root.render(<main style={{padding:20,display:'grid',gridTemplateColumns:'600px 420px',gap:24}}>
                <div id="settings" style={{height:860,overflow:'auto'}}>{renderSettingsPanel(props)}</div>
                <div key={inputs.motionChatKey}>
                  {renderRootChatTurn(inputs,0,{id:'turn',items:inputs.visibleChatItems})}
                  <LimitResetQueueMessages providerId="claude" target="chat"/>
                </div>
              </main>))
            }
            window.renderFixture()
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'worker-fixture',
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
        '<link rel="stylesheet" href="fixture.css"><div id="root"></div><script>window.queueEntries=[];window.providerApi={getLimitResetMessages:async()=>window.queueEntries,deleteLimitResetMessage:async()=>{}}</script><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 30000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Continue on limit reset checks passed')) {
        throw new Error(result.stderr || String(result.error || 'Electron fixture failed'))
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
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        width: 1100,
        height: 940,
        show: false,
        webPreferences: { backgroundThrottling: false }
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) =>
        win.webContents.executeJavaScript(source).catch((error) => {
          throw new Error(source + ': ' + error.message)
        })
      const settle = () => run('new Promise(resolve => setTimeout(resolve,40))')
      const timedButton = `document.querySelector('[aria-label^="Continue in "]')`
      const continueButton = `document.querySelector('[aria-label="Continue failed turn"]')`
      const toggle = `document.querySelector('[aria-labelledby="settings-chat-continue-on-usage-reset"]')`
      for (let attempt = 0; attempt < 100 && !(await run(`Boolean(${continueButton})`)); attempt++)
        await settle()
      assert.equal(await run(timedButton), null)
      assert.equal(
        await run(`Boolean(${continueButton})`),
        true,
        await run('document.body.innerText')
      )
      assert.equal(await run(`${toggle}.checked`), true)
      assert.match(await run('document.body.textContent'), /Failure Retries/)
      assert.doesNotMatch(await run('document.body.textContent'), /Network Retries/)
      await run(`${toggle}.click()`)
      await settle()
      assert.equal(await run(`${toggle}.checked`), false)
      assert.equal(await run('window.settings.chat.continueOnUsageReset'), false)
      await run('window.renderFixture()')
      assert.equal(await run(`${toggle}.checked`), false)

      // A failure no longer offers the timed action; the ordinary Continue action still works.
      await run(`${continueButton}.click()`)
      await settle()
      assert.deepEqual(await run('window.calls'), [['now', 'failed', 'Keep working.']])
      assert.equal(await run(timedButton), null)

      // Backend-created continuations appear in the existing reset queue.
      await run(
        `window.queueEntries=[{id:'auto',content:'Keep working.',createdAt:Date.now(),resetsAt:Date.now()+7200000,error:null}];window.dispatchEvent(new Event('sele-limit-reset-queue-changed'))`
      )
      await settle()
      assert.match(
        await run(`document.querySelector('[aria-label="On Limit Reset queue"]').textContent`),
        /Keep working\./
      )
      assert.equal(await run(timedButton), null)

      // Claude grants retain their type through the actual failed-turn renderer.
      await run(`
        window.confirms=[];window.claims=[];window.acceptReset=false;window.claimOutcome='noCredit';
        window.confirm=message=>{window.confirms.push(message);return window.acceptReset};
        window.renderFixture({motionChatKey:'claude-resets',availableRateLimitResets:4,
          rateLimitResetOptions:[
            {id:'full',label:'Full reset',description:'Refills five-hour and weekly limits.',availableCount:1,expiresAt:Date.now()+86400000,usable:true},
            {id:'fable',label:'Fable reset',description:'Restores Fable weekly usage. Other weekly usage stays unchanged.',availableCount:2,expiresAt:Date.now()+86400000,usable:true},
            {id:'paused',label:'Weekly reset',description:'Temporarily unavailable.',availableCount:1,expiresAt:null,usable:false}
          ],onUsageReset:async id=>{window.claims.push(id);return window.claimOutcome},onUsageRefresh:async()=>{}},
          {failureMessage:'Claude usage limit reached.'})
      `)
      await settle()
      const resetButton = `document.querySelector('.rate-limit-reset-controls button')`
      const resetSelect = `document.querySelector('select[aria-label="Reset type"]')`
      assert.equal(await run(`${resetSelect}.options.length`), 3)
      assert.equal(await run(`${resetSelect}.options[2].disabled`), true)
      await run(
        `${resetSelect}.value='fable';${resetSelect}.dispatchEvent(new Event('change',{bubbles:true}))`
      )
      await settle()
      await run(`${resetButton}.click()`)
      await settle()
      assert.deepEqual(await run('window.claims'), [])
      assert.match(await run('window.confirms.at(-1)'), /Fable weekly usage/)
      assert.doesNotMatch(await run('window.confirms.at(-1)'), /Codex/)
      await run('window.acceptReset=true')
      await run(`${resetButton}.click()`)
      await settle()
      assert.deepEqual(await run('window.claims'), ['fable'])
      assert.match(await run('document.body.textContent'), /No reset credits are available/)
      assert.equal(await run('window.calls.length'), 1, 'an unsuccessful claim must not continue')
      if (process.env.SELE_CLAUDE_RESETS_SCREENSHOT) {
        win.showInactive()
        await run('new Promise(resolve=>setTimeout(resolve,250))')
        await fs.writeFile(
          process.env.SELE_CLAUDE_RESETS_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run("window.claimOutcome='reset'")
      await run(`${resetButton}.click()`)
      await settle()
      assert.deepEqual(await run('window.claims'), ['fable', 'fable'])
      assert.equal(
        await run('window.calls.length'),
        2,
        'a confirmed reset continues the failed turn'
      )

      await run(
        'document.querySelector("#settings-chat-failure-retries").scrollIntoView({block:"center"})'
      )
      if (process.env.SELE_FAILURE_RETRIES_SCREENSHOT) {
        win.showInactive()
        await run('new Promise(resolve => setTimeout(resolve,250))')
        await fs.writeFile(
          process.env.SELE_FAILURE_RETRIES_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run(`${toggle}.click()`)
      await settle()
      assert.equal(await run('window.settings.chat.continueOnUsageReset'), true)
      console.log('Continue on limit reset checks passed.')
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
