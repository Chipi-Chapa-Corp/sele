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
            window.calls=[]; window.failUpdate=false; window.failCheck=false
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
                await new Promise(resolve=>window.finishUpdate=resolve)
                versions[id][0]=versions[id][1];return null
              }
            }
            window.appApi={handleExternalLink:async options=>{window.calls.push({method:'link',options});return null}}
            Promise.all([
              import('./src/renderer/src/useProviderUpdates'),
              import('./src/renderer/src/components/ProviderUpdateBanners')
            ]).then(([{useProviderUpdates},{ProviderUpdateBanners}])=>{
              function Fixture(){
                const [container,setContainer]=useState({kind:'host'})
                const [selected,setSelected]=useState('codex')
                const [mounted,setMounted]=useState(true)
                const updates=useProviderUpdates({providerIds:['codex','claude','copilot','opencode','opencode-v2'],container,onUpdated:()=>{}})
                window.updates=updates;window.select=setSelected;window.setSource=setContainer;window.toggle=()=>setMounted(x=>!x)
                return <main style={{padding:24,width:'min(100%, 1100px)',margin:'0 auto'}}>
                  <p>New chat · {selected} · {container.kind==='host'?'Host':container.name}</p>
                  {mounted&&<ProviderUpdateBanners {...updates}/>}
                  <textarea aria-label="Message" style={{width:'100%',height:90}} placeholder="Send a message"/>
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
        outfile: path.join(directory, 'fixture.js')
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
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
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
        'window.failUpdate=false;void window.updates.handleUpdateProvider(window.updates.providerUpdateSuggestions.find(x=>x.providerId==="claude"))'
      )
      await ready('window.finishUpdate&&window.updates.providerUpdateInProgress')
      assert.equal(
        await run(
          'Array.from(document.querySelectorAll(".chat-provider-update")).filter(x=>x.textContent.includes("Updating")).length'
        ),
        1
      )
      await run('window.finishUpdate()')
      await ready(
        'window.updates.providerUpdateSuggestions.length===0&&!window.updates.providerUpdateInProgress'
      )
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
        'PASS: v2-only OpenCode, all-provider checks, stacked banners, independent dismissals, update failure/retry, source scoping'
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
