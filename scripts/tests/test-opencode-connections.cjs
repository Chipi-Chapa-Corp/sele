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
            import { useOpenCodeConnectionHealth } from './src/renderer/src/useOpenCodeConnectionHealth'
            import { OpenCodeConnectionError } from './src/renderer/src/components/OpenCodeConnectionError'
            import { SidebarOpenCodeProvider } from './src/renderer/src/workspace/components/SidebarOpenCodeProvider'
            import { useOpenCodeProviders } from './src/renderer/src/useOpenCodeProviders'
            import { filterOpenCodeModels } from './src/renderer/src/openCodeProviderPreferences'
            import { Dropdown } from './src/renderer/src/components/Dropdown'
            import './src/renderer/src/assets/styles/base.css'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/workspace/styles/settings-sections.css'
            import './src/renderer/src/workspace/styles/settings-controls.css'
            import './src/renderer/src/workspace/styles/conversation-requests.css'
            const root = createRoot(document.getElementById('root'))
            function ProviderFixture({container}) {
              const [revision, refresh] = React.useState(0)
              const [manageOpen, setManageOpen] = React.useState(false)
              const [model, setModel] = React.useState('anthropic/claude')
              const state = useOpenCodeProviders({enabled:true, container, models:window.pickerModels, model, revision})
              const models = filterOpenCodeModels(window.pickerModels, state.selectedId)
              const effectiveModel = models.some(m=>m.id===model) ? model : models[0]?.id ?? ''
              const failure = useOpenCodeConnectionHealth({providerId:'opencode',container,available:true,model:effectiveModel,revision,chatKey:null})
              const onManage = () => setManageOpen(true)
              return <><SidebarOpenCodeProvider {...state} manageOpen={manageOpen} onManage={onManage} onClose={() => setManageOpen(false)} onSelect={id => {state.select(id);setModel(filterOpenCodeModels(window.pickerModels,id)[0]?.id ?? '')}} onChanged={id => {if(id)state.select(id);refresh(r=>r+1)}} container={container} available={true} />
                <Dropdown aria-label="Model" value={models.some(m=>m.id===model) ? model : models[0]?.id ?? ''} options={models.map(m=>({value:m.id,label:m.label}))} onChange={setModel} />
                {failure && <OpenCodeConnectionError failure={failure} onManage={onManage} />}
              </>
            }
            window.renderPicker = (container = {kind:'host'}, key = '') => flushSync(() => root.render(<React.StrictMode><ProviderFixture key={key + JSON.stringify(container)} container={container}/></React.StrictMode>))
            function HealthFixture(props) {
              const failure = useOpenCodeConnectionHealth(props)
              return <><button disabled={!!failure}>Send</button>{failure && <OpenCodeConnectionError failure={failure} onManage={() => window.managed++} />}</>
            }
            window.renderHealth = (props = {}) => flushSync(() => root.render(<React.StrictMode><HealthFixture providerId="opencode" container={{kind:'host'}} available={true} model="openai/test" revision={0} chatKey={null} {...props} /></React.StrictMode>))
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
        window.preferencesApi = {getItem: key => ({ok:true,value:localStorage.getItem(key)}),setItem: (key,value) => {localStorage.setItem(key,value);return {ok:true,value:null}}};
        window.catalog = [
          {id:'openai',name:'OpenAI',methods:[{type:'key',label:'API key'}],connections:[{type:'credential',id:'saved-one',label:'Personal key',status:{state:'failed',message:'This API key has expired.',checkedAt:1}},{type:'env',name:'OPENAI_API_KEY',status:{state:'verified',checkedAt:1}}]},
          {id:'copilot',name:'GitHub Copilot',methods:[{type:'oauth',id:'0',label:'Browser sign-in',prompts:[{type:'select',key:'account',message:'Account type',options:[{label:'Personal',value:'personal'},{label:'Enterprise',value:'enterprise'}]},{type:'text',key:'domain',message:'Enterprise domain',when:{key:'account',op:'eq',value:'enterprise'}}]},{type:'key',label:'API key'}],connections:[]}
        ];
        window.providerApi = {
          getConnections: async (provider, options) => {
            calls.push(['list',options]);
            if(failLoad) throw new Error('Fixture load failed');
            if(window.pickerMode) {
              if(window.deferPickerReads && !options.forceRefresh) return new Promise(resolve => (window.pendingPickerReads ??= []).push(() => resolve(structuredClone(window.pickerCatalog))));
              return structuredClone(window.pickerCatalog);
            }
            if(window.healthMode) {
              if(window.deferHealth) return new Promise(resolve => window.resolveHealth = resolve);
              if(options.forceRefresh) window.healthCatalog = structuredClone(window.checkedHealthCatalog);
              return structuredClone(window.healthCatalog);
            }
            return structuredClone(catalog)
          },
          connectProvider: async (provider,input,options) => {
            calls.push(['connect',input,options]);
            if(input.method === 'key') {
              const entry = (window.pickerMode ? pickerCatalog : catalog).find(p=>p.id===input.integrationId);
              const status = input.key === 'bad-key' ? {state:'failed',message:'invalid x-api-key',checkedAt:2} : {state:'verified',checkedAt:2};
              entry.connections = [{type:'credential',id:window.pickerMode ? entry.id : 'saved-one',label:'New key',status}, ...entry.connections.filter(c=>c.type!=='credential')];
              if(window.pickerMode) window.pickerModels=[...pickerModels,{id:entry.id+'/new',label:'New provider model'}];
              return null
            }
            if(window.deferStart) return new Promise(resolve => window.resolveStart = resolve)
            return {attemptId:'oauth-one',url:'https://example.test/auth',instructions:'Enter device code TEST-CODE',mode:nextMode}
          },
          getConnectionAttempt: async () => ({status:window.status}),
          completeConnection: async (provider,id,code,options) => {calls.push(['complete',id,code,options]); window.status='complete'},
          cancelConnection: async (provider,id,options) => {calls.push(['cancel',id,options])},
          deleteConnection: async (provider,id,options) => {
            calls.push(['delete',id,options]);
            catalog.forEach(p=>p.connections=p.connections.filter(c=>c.id!==id));
            if(window.pickerMode) {
              pickerCatalog.forEach(p=>p.connections=p.connections.filter(c=>c.id!==id));
              window.pickerModels=pickerModels.filter(m=>!m.id.startsWith(id+'/'));
            }
          }
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
        assert.equal(await run('window.changed'), 3)
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
        // Opening the chat checks both expired saved keys before any user message is sent.
        await run(`window.healthMode = true; window.managed = 0; window.calls = [];
          window.healthCatalog = ['openai','anthropic'].map(id => ({id,name:id,methods:[],connections:[{type:'credential',id,label:'API key'}]}));
          window.checkedHealthCatalog = healthCatalog.map(p => ({...p,connections:p.connections.map(c => ({...c,status:{state:'failed',message:'This API key has expired.',checkedAt:Date.now()}}))}));
          window.renderHealth()`)
        await tick()
        assert.match(
          await run('document.querySelector("[role=alert]").textContent'),
          /Request failedThis API key has expired/
        )
        assert.equal(await run('document.querySelector("button").disabled'), true)
        assert.equal(await run('calls.filter(c=>c[1].forceRefresh).length'), 1)
        // Revalidating the same environment must keep a known error visible while reads wait.
        await run('window.deferHealth=true;window.renderHealth({revision:1})')
        await tick()
        assert.equal(
          await run('!!document.querySelector(\'[aria-label="OpenCode connection error"]\')'),
          true
        )
        assert.equal(await run('document.querySelector("button").disabled'), true)
        await run('window.deferHealth=false;window.resolveHealth(window.checkedHealthCatalog)')
        await tick()
        if (process.env.SELE_HEALTH_SCREENSHOT)
          await fs.writeFile(
            process.env.SELE_HEALTH_SCREENSHOT,
            (await win.webContents.capturePage()).toPNG()
          )
        await click('Manage Providers')
        assert.equal(await run('window.managed'), 1)
        await run('window.renderHealth({model:"anthropic/test"})')
        await tick()
        assert.match(
          await run('document.querySelector("[role=alert]").textContent'),
          /Request failedThis API key has expired/
        )
        assert.equal(await run('calls.filter(c=>c[1].forceRefresh).length'), 1)
        // An unrelated expired key must not disable a working or credential-free provider.
        await run(
          `healthCatalog.push({id:'working',name:'Working',methods:[],connections:[{type:'credential',id:'working',label:'Key',status:{state:'verified',checkedAt:Date.now()}}]}); renderHealth({model:'working/test'})`
        )
        await tick()
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        assert.equal(await run('document.querySelector("button").disabled'), false)
        await run('window.renderHealth({model:"public/free"})')
        await tick()
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        // Saving a replacement and refreshing the model catalog clears the banner.
        await run(
          `healthCatalog[0].connections[0].status={state:'verified',checkedAt:Date.now()}; renderHealth({revision:1})`
        )
        await tick()
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        // A late result from the host cannot poison another source or provider.
        await run('window.deferHealth=true; window.renderHealth({revision:2})')
        await tick()
        await run(
          'window.renderHealth({providerId:"codex",revision:2}); window.resolveHealth(window.checkedHealthCatalog)'
        )
        await tick()
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        await run('window.renderHealth({revision:3})')
        await tick()
        await run(
          'window.oldHostHealth=window.resolveHealth; window.deferHealth=false; window.healthCatalog=[]; window.renderHealth({container:{kind:"container",tool:"podman",name:"fixture"},revision:3})'
        )
        await tick()
        await run('window.oldHostHealth(window.checkedHealthCatalog)')
        await tick()
        assert.equal(await run('!!document.querySelector("[role=alert]")'), false)
        // The sidebar provider picker remembers the environment and scopes its model dropdown.
        await run(`window.pickerMode=true; window.confirm=()=>true;
          window.pickerCatalog=[
            {id:'anthropic',name:'Anthropic',methods:[{type:'key',label:'API key'}],connections:[{type:'credential',id:'anthropic',label:'API key',status:{state:'verified',checkedAt:Date.now()}}]},
            {id:'opencode-go',name:'OpenCode Go',methods:[{type:'key',label:'API key'}],connections:[{type:'credential',id:'opencode-go',label:'API key',status:{state:'failed',message:'This API key has expired.',checkedAt:Date.now()}}]},
            {id:'new',name:'New Provider',methods:[{type:'key',label:'API key'}],connections:[]},
            {id:'env',name:'Environment Provider',methods:[],connections:[{type:'env',name:'ENV_KEY',status:{state:'verified',checkedAt:Date.now()}}]}
          ];
          window.pickerModels=[{id:'anthropic/claude',label:'Claude via Anthropic'},{id:'opencode-go/claude',label:'Claude via Go'}];
          window.renderPicker()`)
        await tick()
        await run('document.querySelector(\'button[aria-label="OpenCode provider"]\').click()')
        await tick()
        assert.equal(
          await run(
            '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Add account")'
          ),
          false
        )
        assert.equal(
          await run('!!document.querySelector(\'[aria-label="Delete Anthropic connection"]\')'),
          true
        )
        assert.equal(
          await run(
            '!!document.querySelector(\'[aria-label="Delete Environment Provider connection"]\')'
          ),
          false
        )
        await run(
          '[...document.querySelectorAll("[role=option]")].find(e=>e.textContent.includes("OpenCode Go")).click()'
        )
        await tick()
        await run('document.querySelector(\'button[aria-label="Model"]\').click()')
        await tick()
        assert.deepEqual(
          await run(
            '[...document.getElementById(document.querySelector(\'button[aria-label="Model"]\').getAttribute("aria-controls")).querySelectorAll("[role=option]")].map(e=>e.textContent.trim())'
          ),
          ['Claude via Go']
        )
        await run(
          'document.querySelector(\'button[aria-label="Model"]\').click(); window.renderPicker({kind:"host"}, "restart")'
        )
        await tick()
        assert.match(
          await run(
            'document.querySelector(\'button[aria-label="OpenCode provider"]\').textContent'
          ),
          /OpenCode Go/
        )
        await run('window.renderPicker({kind:"container",tool:"podman",name:"fixture"})')
        await tick()
        assert.match(
          await run(
            'document.querySelector(\'button[aria-label="OpenCode provider"]\').textContent'
          ),
          /Anthropic/
        )
        await run('window.renderPicker()')
        await tick()
        // Both entry points open the same modal without replacing the model or hiding its error.
        await run(`window.stableComposer = () => [document.querySelector('button[aria-label="Model"]').textContent, document.querySelector('[aria-label="OpenCode connection error"]')?.textContent];
          window.composerBefore=stableComposer(); window.composerChanges=[];
          window.composerObserver=new MutationObserver(()=>composerChanges.push(stableComposer()));
          composerObserver.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
          document.querySelector('[aria-label="OpenCode connection error"] button').click()`)
        await tick()
        assert.equal(
          await run(
            'document.querySelectorAll(\'[role="dialog"][aria-label="Manage Providers"]\').length'
          ),
          1
        )
        assert.deepEqual(await run('stableComposer()'), await run('composerBefore'))
        // Refresh completion bumps the catalog revision; keep cached presentation during that read.
        await run(
          `window.deferPickerReads=true; [...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Refresh').click()`
        )
        await tick()
        assert.deepEqual(await run('stableComposer()'), await run('composerBefore'))
        await run(
          'window.deferPickerReads=false;window.pendingPickerReads.forEach(resolve=>resolve());window.pendingPickerReads=[]'
        )
        await tick()
        assert.equal(
          await run(
            'composerChanges.every(value=>JSON.stringify(value)===JSON.stringify(composerBefore))'
          ),
          true
        )
        await run(
          'composerObserver.disconnect();document.querySelector(\'[aria-label="Close connections window"]\').click()'
        )
        await tick()
        await run('document.querySelector(\'button[aria-label="OpenCode provider"]\').click()')
        await tick()
        await run(
          '[...document.querySelectorAll(".ui-dropdown__action")].find(b=>b.textContent.trim()==="Manage Providers").click()'
        )
        await tick()
        if (process.env.SELE_PROVIDERS_SCREENSHOT)
          await fs.writeFile(
            process.env.SELE_PROVIDERS_SCREENSHOT,
            (await win.webContents.capturePage()).toPNG()
          )
        assert.equal(
          await run('!!document.querySelector(\'[role="dialog"][aria-label="Manage Providers"]\')'),
          true
        )
        assert.equal(await run('!!document.querySelector(\'[aria-label="Model provider"]\')'), true)
        await pick('Model provider', 'New Provider')
        await run('window.setInput(\'input[type="password"]\',"fixture-key")')
        await tick()
        await click('Connect')
        assert.match(
          await run(
            'document.querySelector(\'button[aria-label="OpenCode provider"]\').textContent'
          ),
          /New Provider/
        )
        await run('document.querySelector(\'[aria-label="Close connections window"]\').click()')
        await tick()
        await run('document.querySelector(\'button[aria-label="OpenCode provider"]\').click()')
        await tick()
        await run(
          'document.querySelector(\'[aria-label="Delete OpenCode Go connection"]\').click()'
        )
        await tick()
        assert.equal(await run('calls.some(c=>c[0]==="delete"&&c[1]==="opencode-go")'), true)
        assert.match(
          await run(
            'document.querySelector(\'button[aria-label="OpenCode provider"]\').textContent'
          ),
          /New Provider/
        )
        await run('document.querySelector(\'button[aria-label="OpenCode provider"]\').click()')
        await tick()
        await run(
          'document.querySelector(\'[aria-label="Delete New Provider connection"]\').click()'
        )
        await tick()
        assert.match(
          await run(
            'document.querySelector(\'button[aria-label="OpenCode provider"]\').textContent'
          ),
          /Anthropic/
        )
        await run(
          'window.pickerCatalog=[];window.pickerModels=[];window.renderPicker({kind:"host"},"empty")'
        )
        await tick()
        await run('document.querySelector(\'button[aria-label="OpenCode provider"]\').click()')
        await tick()
        await click('Manage Providers')
        assert.equal(
          await run('!!document.querySelector(\'[role="dialog"][aria-label="Manage Providers"]\')'),
          true
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
