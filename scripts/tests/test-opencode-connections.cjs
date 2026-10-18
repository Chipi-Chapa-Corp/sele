const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Run with isolated-gui. This renderer fixture never launches Sele/OpenCode or reads real accounts.
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-connections-ui-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ProviderSettingsContent } from './src/renderer/src/components/ProviderSettingsContent'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/workspace/styles/settings-sections.css'
            import './src/renderer/src/workspace/styles/settings-controls.css'
            const root = createRoot(document.getElementById('root'))
            window.render = (id = 'opencode', container = {kind:'host'}) => flushSync(() => root.render(
              <React.StrictMode><ProviderSettingsContent key={id + JSON.stringify(container)} providerId={id} container={container} onConnectionsChanged={() => window.changed++}>
                <p>General settings</p>{() => <p>Skills</p>}
              </ProviderSettingsContent></React.StrictMode>
            ))
            window.setInput = (selector, value) => {
              const input = document.querySelector(selector)
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
              input.dispatchEvent(new Event('input', { bubbles: true }))
            }
            window.render()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'ui.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html><html data-color-scheme="dark"><head><link rel="stylesheet" href="ui.css"><style>
        body { background:#19191b;color:#eee;font:14px system-ui;margin:24px;--lead:#eee;--ink:#ddd;--muted:#aaa;--glass-line:#444;--glass-strong:#252528;--glass-edge:#555; }
        #root { display:flex;flex-direction:column;align-items:center; }
      </style></head><body><div id="root"></div><script>
        window.changed = 0; window.calls = []; window.failLoad = false; window.status = 'pending'; window.nextMode = 'auto';
        window.catalog = [
          {id:'openai',name:'OpenAI',methods:[{type:'key',label:'API key'}],connections:[{type:'credential',id:'saved-one',label:'Personal key',status:{state:'failed',message:'This API key has expired.',checkedAt:1}},{type:'env',name:'OPENAI_API_KEY',status:{state:'verified',checkedAt:1}}]},
          {id:'copilot',name:'GitHub Copilot',methods:[{type:'oauth',id:'0',label:'Browser sign-in',prompts:[{type:'select',key:'account',message:'Account type',options:[{label:'Personal',value:'personal'},{label:'Enterprise',value:'enterprise'}]},{type:'text',key:'domain',message:'Enterprise domain',when:{key:'account',op:'eq',value:'enterprise'}}]},{type:'key',label:'API key'}],connections:[]}
        ];
        window.providerApi = {
          getConnections: async (provider, options) => { calls.push(['list',options]); if(failLoad) throw new Error('Fixture load failed'); return structuredClone(catalog) },
          connectProvider: async (provider,input,options) => {
            calls.push(['connect',input,options]);
            if(input.method === 'key') {
              const entry = catalog.find(p=>p.id===input.integrationId);
              const status = input.key === 'bad-key' ? {state:'failed',message:'invalid x-api-key',checkedAt:2} : {state:'verified',checkedAt:2};
              entry.connections = [{type:'credential',id:'saved-one',label:'New key',status}, ...entry.connections.filter(c=>c.type!=='credential')];
              return null
            }
            if(window.deferStart) return new Promise(resolve => window.resolveStart = resolve)
            return {attemptId:'oauth-one',url:'https://example.test/auth',instructions:'Enter device code TEST-CODE',mode:nextMode}
          },
          getConnectionAttempt: async () => ({status:window.status}),
          completeConnection: async (provider,id,code,options) => {calls.push(['complete',id,code,options]); window.status='complete'},
          cancelConnection: async (provider,id,options) => {calls.push(['cancel',id,options])},
          deleteConnection: async (provider,id,options) => {calls.push(['delete',id,options]); catalog.forEach(p=>p.connections=p.connections.filter(c=>c.id!==id))}
        };
        window.appApi = {handleExternalLink: async input => calls.push(['open',input])};
      </script><script src="ui.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error)
        throw new Error(result.stderr || String(result.error))
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
  app
    .whenReady()
    .then(async () => {
      const win = new BrowserWindow({
        show: false,
        width: 820,
        height: 900,
        webPreferences: { offscreen: true, backgroundThrottling: false }
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const tick = () => run('new Promise(resolve => setTimeout(resolve, 60))')
      const click = async (text) => {
        await run(
          `(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw new Error('Missing/enabled button: '+${JSON.stringify(text)});b.click()})()`
        )
        await tick()
      }
      const pick = async (label, text) => {
        await run(`document.querySelector('button[aria-label="${label}"]').click()`)
        await tick()
        await run(
          `(() => {const b=[...document.querySelectorAll('[role=option]')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing option '+${JSON.stringify(text)});b.click()})()`
        )
        await tick()
      }
      try {
        await win.loadFile(path.join(process.argv[2], 'index.html'))
        await click('Connections')
        assert.equal(
          await run(
            'document.querySelectorAll(\'[aria-label="Remove OpenAI connection"]\').length'
          ),
          1
        )
        // The fixture's results are old, so opening the panel re-tests the connections once.
        assert.equal(await run('calls.filter(c=>c[0]==="list"&&c[1].forceRefresh).length'), 1)
        assert.match(
          await run('document.getElementById("root").textContent'),
          /Environment variable · OPENAI_API_KEY/
        )
        // Only the rejected saved key is flagged, in the error color; the working env variable is not.
        assert.deepEqual(
          await run(
            '[...document.querySelectorAll(".settings-dialog__connection-rejected")].map(e=>[e.textContent,e.getAttribute("role"),getComputedStyle(e).color===getComputedStyle(e.previousElementSibling).color])'
          ),
          [['Rejected by the provider: This API key has expired.', 'alert', false]]
        )
        await pick('Model provider', 'OpenAI')
        assert.equal(
          await run(
            'document.querySelector(\'button[aria-label="Model provider"]\').textContent.trim()'
          ),
          'OpenAI'
        )
        assert.equal(
          await run('document.querySelector(\'input[type="password"]\').autocomplete'),
          'off'
        )
        await run('window.setInput(\'input[type="password"]\',"bad-key")')
        await tick()
        await click('Connect')
        assert.equal(
          await run('document.querySelector("[role=alert]").textContent'),
          'Saved, but OpenAI rejected it: invalid x-api-key'
        )
        assert.match(
          await run('document.getElementById("root").textContent'),
          /Rejected by the provider: invalid x-api-key/
        )
        await run('window.setInput(\'input[type="password"]\',"fixture-key")')
        await tick()
        await click('Connect')
        assert.equal(await run('window.changed'), 2)
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        assert.equal(
          await run('document.querySelector("[role=status]").textContent'),
          'Connected and verified.'
        )
        assert.match(await run('document.getElementById("root").textContent'), /Working\./)
        assert.equal(await run('document.querySelector(\'input[type="password"]\').value'), '')
        assert.match(await run('document.getElementById("root").textContent'), /New key/)
        await run('document.querySelector(\'[aria-label="Remove OpenAI connection"]\').click()')
        await tick()
        assert.deepEqual(await run('calls.filter(c=>c[0]==="delete").map(c=>c[1])'), ['saved-one'])
        await pick('Model provider', 'GitHub Copilot')
        assert.equal(
          await run('document.getElementById("root").textContent.includes("Enterprise domain")'),
          false
        )
        await pick('Account type', 'Enterprise')
        assert.equal(
          await run('document.getElementById("root").textContent.includes("Enterprise domain")'),
          true
        )
        await run(
          'window.setInput(\'.settings-dialog__connection-input input\',"enterprise.example.test")'
        )
        await tick()
        await click('Connect')
        await click('Open authorization page')
        assert.equal(await run('calls.find(c=>c[0]==="open")[1].url'), 'https://example.test/auth')
        await click('Cancel')
        assert.equal(await run('calls.filter(c=>c[0]==="cancel").length'), 1)
        await run('window.nextMode="code"')
        await click('Connect')
        await run('window.setInput(\'.settings-dialog__connection-input input\',"fixture-code")')
        await tick()
        await click('Complete connection')
        assert.equal(await run('calls.find(c=>c[0]==="complete")[2]'), 'fixture-code')
        assert.match(await run('document.getElementById("root").textContent'), /Connected\./)
        await run('window.status="pending";window.nextMode="auto"')
        await click('Connect')
        await run('window.status="complete"')
        await run('new Promise(resolve=>setTimeout(resolve,1300))')
        assert.match(await run('document.getElementById("root").textContent'), /Connected\./)
        await run('window.status="pending"')
        await click('Connect')
        await run(
          'catalog.forEach(p=>p.connections.forEach(c=>{c.status={state:"verified",checkedAt:Date.now()}}));window.checksBefore=calls.filter(c=>c[0]==="list"&&c[1].forceRefresh).length'
        )
        await run('window.render("opencode", {kind:"container",tool:"toolbox",name:"fixture"})')
        await tick()
        assert.equal(await run('calls.filter(c=>c[0]==="cancel").length'), 2)
        await click('Connections')
        // Recent results are shown as they are; opening the panel does not spend another check.
        assert.equal(
          await run(
            'calls.filter(c=>c[0]==="list"&&c[1].forceRefresh).length - window.checksBefore'
          ),
          0
        )
        assert.deepEqual(await run('calls.filter(c=>c[0]==="list").at(-1)[1].container'), {
          kind: 'container',
          tool: 'toolbox',
          name: 'fixture'
        })
        await run('window.failLoad=true')
        await click('Refresh')
        assert.match(
          await run('document.querySelector("[role=alert]").textContent'),
          /Fixture load failed/
        )
        await run('window.failLoad=false')
        await click('Refresh')
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        // Refresh asks main to test every saved connection, not just reread the list.
        assert.equal(await run('calls.filter(c=>c[0]==="list").at(-1)[1].forceRefresh'), true)
        if (process.env.SELE_CONNECTIONS_SCREENSHOT)
          await fs.writeFile(
            process.env.SELE_CONNECTIONS_SCREENSHOT,
            (await win.webContents.capturePage()).toPNG()
          )
        await run('window.render("codex")')
        assert.equal(
          await run(
            '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Connections")'
          ),
          false
        )
        console.log('OpenCode connections UI checks passed')
        app.exit(0)
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
