const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-presets-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import * as settings from './src/renderer/src/settings'
            import { chatDropdownSettingFields } from './src/renderer/src/appProjectSettings'
            import './src/renderer/src/App.css'
            import './src/renderer/src/assets/main.css'
            const stored = {
              get: key => localStorage.getItem(key),
              set: (key,value) => localStorage.setItem(key,value),
              delete: key => localStorage.removeItem(key)
            }
            window.preferencesApi = {
              getItem: key => ({ok: true, value: stored.get(key) ?? null}),
              setItem: (key, value) => { stored.set(key, value); return {ok: true, value: null} },
              removeItem: key => { stored.delete(key); return {ok: true, value: null} }
            }
            window.settings = settings
            window.dropdownFields = chatDropdownSettingFields
            window.stored = stored
            window.selection = {model:'alpha', reasoningEffort:'low', sandboxMode:'workspace-write',
              approvalMode:'ask-user', agentMode:'interactive', serviceTier:null}
            window.props = {}
            window.applied = []
            const change = patch => { Object.assign(window.selection, patch); window.renderFixture() }
            const root = createRoot(document.getElementById('root'))
            window.renderFixture = (patch = {}) => {
              Object.assign(window.props, patch)
              flushSync(() => root.render(<React.StrictMode>
                <main style={{padding:40,paddingTop:550,width:800}}>
                  <MessageBox draftScopeKey="presets-fixture" providerId="codex" {...window.selection}
                    models={[
                      {id:'alpha',label:'Alpha',isDefault:true,defaultReasoningEffort:'low',
                        supportedReasoningEfforts:[{id:'low',label:'Low'},{id:'high',label:'High'}],
                        supportedServiceTiers:[{id:'priority',label:'Fast'}]},
                      {id:'beta',label:'Beta',defaultReasoningEffort:'low',supportedReasoningEfforts:[]}
                    ]}
                    agentModes={[]}
                    approvalModes={[{id:'ask-user',label:'Ask user'},{id:'never',label:'Allow all'}]}
                    sandboxModes={[{id:'workspace-write',label:'Workspace write'},
                      {id:'read-only',label:'Read only'},{id:'danger-full-access',label:'Full access'}]}
                    accountUsage={null} accountUsageError={null} accountUsageState="idle"
                    contextUsage={{source:'unavailable',usedTokens:null,maxTokens:null}}
                    displayUsage={{context:true,short:false,long:false}}
                    onModelChange={model=>change({model,reasoningEffort:'low',serviceTier:null})}
                    onReasoningEffortChange={reasoningEffort=>change({reasoningEffort})}
                    onServiceTierChange={serviceTier=>change({serviceTier})}
                    onSandboxModeChange={sandboxMode=>change({sandboxMode,approvalMode:sandboxMode==='danger-full-access'?'never':'ask-user'})}
                    onApprovalModeChange={approvalMode=>change({approvalMode})}
                    onAgentModeChange={agentMode=>change({agentMode})}
                    onPresetChange={preset=>{ window.applied.push(preset); change(preset) }}
                    onSend={()=>true} {...window.props}/>
                </main>
              </React.StrictMode>))
            }
            window.renderFixture()
          `,
          resolveDir: process.cwd(),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>'
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
      assert.match(result.stdout, /Chat preset UI checks passed/)
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
    try {
      const errors = []
      const win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 800,
        webPreferences: { offscreen: true, backgroundThrottling: false }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const wait = () => run('new Promise(resolve=>setTimeout(resolve,260))')
      const click = async (text) => {
        assert.equal(
          await run(`(() => {
          const button=[...document.querySelectorAll('.message-box__chat-config-menu button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})
          if(!button || button.disabled) return false
          button.click(); return true
        })()`),
          true,
          `Missing enabled button: ${text}`
        )
        await wait()
      }
      const open = async () => {
        await run(`document.querySelector('.message-box__chat-config-trigger').click()`)
        await wait()
      }
      const labels = () =>
        run(
          `[...document.querySelectorAll('.message-box__chat-config-section-label')].map(n=>n.textContent.trim())`
        )
      const rows = () =>
        run(
          `[...document.querySelectorAll('.message-box__chat-config-preset')].map(n=>({text:n.textContent,disabled:n.disabled,selected:n.getAttribute('aria-pressed')}))`
        )
      await wait()
      // Settings default, durable opt-out, and project overrides.
      assert.equal(await run('settings.readStoredAppSettings().chat.presets'), true)
      assert.equal(await run('settings.readStoredAppSettings().chat.selectionAction'), 'back')
      for (const action of ['stay', 'back', 'close']) {
        await run(
          `settings.writeStoredAppSettings({...settings.defaultAppSettings,chat:{...settings.defaultAppSettings.chat,selectionAction:${JSON.stringify(action)}}})`
        )
        assert.equal(await run('settings.readStoredAppSettings().chat.selectionAction'), action)
        await run(
          `settings.writeStoredAppProjectSettings({'/fixture':{chat:{selectionAction:${JSON.stringify(action)}}}})`
        )
        assert.equal(
          await run(`settings.readStoredAppProjectSettings()['/fixture'].chat.selectionAction`),
          action
        )
      }
      await run(
        `stored.set(settings.appSettingsStorageKey, JSON.stringify({chat:{selectionAction:'invalid'}}))`
      )
      assert.equal(await run('settings.readStoredAppSettings().chat.selectionAction'), 'back')
      await run(
        'settings.writeStoredAppSettings({...settings.defaultAppSettings,chat:{...settings.defaultAppSettings.chat,presets:false}})'
      )
      assert.equal(await run('settings.readStoredAppSettings().chat.presets'), false)
      assert.equal(await run(`dropdownFields.find(f=>f.key==='presets').label`), 'Presets')
      await run(`settings.writeStoredAppProjectSettings({'/fixture':{chat:{presets:false}}})`)
      assert.equal(
        await run(`settings.readStoredAppProjectSettings()['/fixture'].chat.presets`),
        false
      )
      await open()
      assert.equal((await rows()).length, 0, 'no synthetic presets before the first save')
      assert.equal(
        await run(`document.querySelector('.message-box__chat-config-back') === null`),
        true,
        'an empty preset library opens directly into configuration'
      )
      const columns = () =>
        run(
          `[...document.querySelectorAll('.message-box__chat-config-column')].map(n=>n.getAttribute('aria-label'))`
        )
      assert.deepEqual(await columns(), ['Model', 'Reasoning', 'Access', 'Speed'])
      const assertColumnLayout = async () => {
        const layout = await run(`(() => {
          const menu=document.querySelector('.message-box__chat-config-menu').getBoundingClientRect()
          const columns=[...document.querySelectorAll('.message-box__chat-config-column')].map(n=>n.getBoundingClientRect())
          return {inside:menu.left>=0 && menu.right<=innerWidth && menu.top>=0 && menu.bottom<=innerHeight,
            aligned:columns.every(c=>c.top===columns[0].top),
            sideBySide:columns.every((c,i)=>i===0 || c.left>=columns[i-1].right)}
        })()`)
        assert.deepEqual(layout, { inside: true, aligned: true, sideBySide: true })
      }
      await assertColumnLayout()
      // Large catalogs scroll independently without hiding the save controls.
      await run(`window.renderFixture({models:[
        {id:'alpha',label:'Alpha',supportedReasoningEfforts:[{id:'low'},{id:'high'}],supportedServiceTiers:[{id:'priority',label:'Fast'}]},
        ...Array.from({length:80},(_,i)=>({id:'extra-'+i,label:'Extra model '+i,supportedReasoningEfforts:[]}))
      ]})`)
      await wait()
      await assertColumnLayout()
      assert.equal(
        await run(`(() => {
        const list=document.querySelector('.message-box__chat-config-column .message-box__chat-config-option-groups')
        const footer=document.querySelector('.message-box__chat-config-footer .message-box__chat-config-section-button').getBoundingClientRect()
        return list.scrollHeight>list.clientHeight && footer.bottom<innerHeight
      })()`),
        true
      )
      await run(`(() => {
        const input=document.querySelector('input[aria-label="Search models"]')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'extra model 79')
        input.dispatchEvent(new Event('input',{bubbles:true}))
      })()`)
      await wait()
      assert.equal(
        await run(
          `document.querySelectorAll('[data-chat-config-section="model"] .message-box__chat-config-option').length`
        ),
        1
      )
      assert.deepEqual(await columns(), ['Model', 'Reasoning', 'Access', 'Speed'])
      await run(`delete window.props.models; window.renderFixture()`)
      // Reopening clears search; a narrow viewport keeps columns horizontally scrollable.
      await open()
      await open()
      win.setSize(700, 800)
      await wait()
      await assertColumnLayout()
      assert.equal(
        await run(`(() => {
        const lists=document.querySelector('.message-box__chat-config-columns')
        return lists.scrollWidth>lists.clientWidth
      })()`),
        true
      )
      win.setSize(1100, 800)
      await wait()

      await click('High')
      assert.equal(await run(`window.selection.reasoningEffort`), 'high')
      assert.deepEqual(await columns(), ['Model', 'Reasoning', 'Access', 'Speed'])
      await click('Beta')
      assert.equal(await run(`window.selection.model`), 'beta')
      assert.equal(
        await run(`document.querySelectorAll('.message-box__chat-config-empty').length`),
        2
      )
      await click('Alpha (default)')
      await run(`window.renderFixture({selectionAction:'stay'})`)
      await click('High')
      assert.equal(
        await run(
          `document.querySelector('.message-box__chat-config-trigger').getAttribute('aria-expanded')`
        ),
        'true',
        'changing parameters keeps all lists open'
      )
      await click('Low')
      await open()
      await open()
      assert.equal((await rows()).length, 0)
      assert.ok((await labels()).includes('Save preset'))
      await click('Save preset')
      assert.equal((await rows()).length, 1)
      await click('Configure')
      assert.equal(
        await run(
          `document.querySelector('.message-box__chat-config-footer .message-box__chat-config-section-button').disabled`
        ),
        true
      )
      await click('High')
      await click('Fast')
      await click('Full access')
      await assertColumnLayout()
      if (process.env.SELE_PRESETS_CONFIG_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_PRESETS_CONFIG_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await click('Save preset')
      const savedRows = await rows()
      assert.equal(savedRows.length, 2)
      assert.match(savedRows[1].text, /AlphaHighFast/)
      assert.equal(savedRows[1].selected, 'true')
      assert.ok(
        await run(`(() => {
        const parts=document.querySelectorAll('.message-box__chat-config-preset')[1].querySelectorAll('.message-box__chat-config-label-part')
        return parts[1].getBoundingClientRect().left - parts[0].getBoundingClientRect().right < 24
      })()`),
        'preset parameters stay together like the trigger button'
      )
      if (process.env.SELE_PRESETS_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_PRESETS_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run(`document.querySelector('.message-box__chat-config-preset').click()`)
      await wait()
      assert.deepEqual(await run('window.selection'), {
        model: 'alpha',
        reasoningEffort: 'low',
        sandboxMode: 'workspace-write',
        approvalMode: 'ask-user',
        agentMode: 'interactive',
        serviceTier: null
      })
      assert.equal(
        await run(
          `document.querySelector('.message-box__chat-config-trigger').getAttribute('aria-expanded')`
        ),
        'false'
      )
      await Promise.all([
        new Promise((resolve) => win.webContents.once('did-finish-load', resolve)),
        win.webContents.reload()
      ])
      await wait()
      await open()
      assert.equal((await rows()).length, 2, 'presets survive remount')
      // Forced fields are omitted when applying a saved configuration.
      await run(
        `window.renderFixture({showAccessSelector:false,showReasoningSelector:false,showSpeedSelector:false})`
      )
      await run(`document.querySelectorAll('.message-box__chat-config-preset')[1].click()`)
      await wait()
      assert.deepEqual(await run('window.applied.at(-1)'), {
        model: 'alpha',
        approvalMode: 'never'
      })
      // Opt-out restores direct sections with no Save preset or Configure entry.
      await run(
        `window.renderFixture({presetsEnabled:false,selectionAction:'stay',showAccessSelector:true,showReasoningSelector:true,showSpeedSelector:true})`
      )
      await open()
      assert.deepEqual(await labels(), ['Alpha', 'Low', 'Workspace write', 'Standard'])
      await click('Alpha')
      await click('Beta')
      await click('Back')
      assert.deepEqual(await labels(), ['Beta', 'Reasoning', 'Workspace write', 'Speed'])
      assert.equal(
        await run(
          `document.querySelectorAll('.message-box__chat-config-section-button:disabled').length`
        ),
        2
      )
      await run(`window.renderFixture({selectionAction:'close'})`)
      await click('Beta')
      await click('Alpha (default)')
      assert.equal(
        await run(
          `document.querySelector('.message-box__chat-config-trigger').getAttribute('aria-expanded')`
        ),
        'false',
        'Close dismisses the popup'
      )
      assert.equal(
        await run(`document.activeElement.id`),
        'chat-config-mode',
        'Close restores focus to the trigger'
      )
      await run(`window.renderFixture({presetsEnabled:true,selectionAction:'back'})`)
      await open()
      await click('Configure')
      await click('High')
      assert.deepEqual(await columns(), ['Model', 'Reasoning', 'Access', 'Speed'])
      await click('Fast')
      assert.equal(await run(`window.selection.serviceTier`), 'priority')
      await click('Read only')
      assert.equal(await run(`window.selection.sandboxMode`), 'read-only')
      await open()
      await run(
        `window.renderFixture({presetsEnabled:true,model:'beta',reasoningEffort:'low',serviceTier:null})`
      )
      await open()
      // Both saved Alpha presets remain available; missing catalog entries stay visible and disabled.
      await run(
        `window.renderFixture({models:[{id:'beta',label:'Beta',supportedReasoningEfforts:[]}]})`
      )
      assert.equal(
        (await rows()).every((row) => row.disabled),
        true
      )
      assert.equal(
        await run(
          `document.querySelectorAll('button[title="Delete preset"]:not(:disabled)').length`
        ),
        2,
        'unavailable presets can still be deleted'
      )
      await Promise.all([
        new Promise((resolve) => win.webContents.once('did-finish-load', resolve)),
        win.webContents.reload()
      ])
      await wait()
      await run(`window.renderFixture({selectionAction:'close'})`)
      await open()
      await run(`document.querySelector('button[title="Edit preset"]').click()`)
      await wait()
      assert.ok((await labels()).includes('Save changes'))
      await click('High')
      assert.ok((await labels()).includes('Save changes'), 'editing stays open until saved')
      await click('Save changes')
      assert.equal((await rows()).length, 2, 'editing replaces the original preset')
      assert.match((await rows())[0].text, /AlphaHigh/)
      await Promise.all([
        new Promise((resolve) => win.webContents.once('did-finish-load', resolve)),
        win.webContents.reload()
      ])
      await wait()
      await open()
      assert.match((await rows())[0].text, /AlphaHigh/, 'edits survive remount')
      const beforeDelete = await run('JSON.stringify(window.selection)')
      await run(`document.querySelector('button[title="Delete preset"]').click()`)
      await wait()
      assert.equal((await rows()).length, 1)
      assert.equal(await run('JSON.stringify(window.selection)'), beforeDelete)
      assert.equal(await run('document.activeElement.disabled'), false)
      await run(`document.querySelector('button[title="Delete preset"]').click()`)
      await wait()
      assert.equal((await rows()).length, 0)
      assert.ok(
        (await labels()).includes('Save preset'),
        'deleting the final preset opens configuration'
      )
      await open()
      await open()
      assert.equal((await rows()).length, 0, 'deletions survive reopening')
      assert.deepEqual(errors, [])
      console.log('Chat preset UI checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
