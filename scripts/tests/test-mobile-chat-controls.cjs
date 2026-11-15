const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const project = path.resolve(__dirname, '../..')
const requireProject = require('node:module').createRequire(path.join(project, 'package.json'))
let directory = process.versions.electron ? process.argv[2] : null
if (!process.versions.electron) {
  ;(async () => {
    directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-mobile-controls-'))
    await requireProject('esbuild').build({
      stdin: {
        resolveDir: project,
        loader: 'tsx',
        contents: `
    import React,{useRef,useState} from 'react'
    import {createRoot} from 'react-dom/client'
    import {flushSync} from 'react-dom'
    import {ChatSidebarHeader} from './src/renderer/src/workspace/components/ChatSidebarHeader'
    import {ChatConfigDropdown} from './src/renderer/src/components/ChatConfigDropdown'
    import {installMobileFocusPolicy} from './src/renderer/src/mobileFocus'
    import {installTouchEditingActivation} from './src/renderer/src/touchInput'
    import './src/renderer/src/assets/main.css'
    import './src/renderer/src/App.css'
    import './src/renderer/src/components/MessageBox.css'
    installMobileFocusPolicy();installTouchEditingActivation()
    const noop=()=>{}
    window.preferencesApi={getItem:()=>({ok:true,value:null}),setItem:()=>({ok:true,value:null}),onChanged:()=>()=>{}}
    function Fixture(){const [filter,setFilter]=useState('active');const [model,setModel]=useState('first');window.currentFilter=filter;return <main className="chat" data-mobile-pane="chats" data-mobile-view="conversation">
      <div id="fixture-sidebar" className="chat-sidebar">
        <ChatSidebarHeader chatSidebarFilter={filter} chatSidebarTabs={{all:true,active:true,sleeping:true,working:true}} hasWorkingChats={false} handleChatSidebarFilterChange={setFilter}
        chromeControlTheme="secondary" handleCloseSearch={noop} handleNewChat={noop} handleNewChatNoProject={noop} renderSettingsButton={()=>null} renderWindowControls={()=>null}
        searchInputRef={useRef(null)} searchOpen={false} searchQuery="" setSearchOpen={noop} setSearchQuery={noop} mobile={{onClose:noop,onSettings:noop}} openingImport={false} importDisabled={false} onOpenImport={noop} searchLoading={false}/>
      </div>
      <div className="chat-panel" style={{position:'absolute',top:'90px',left:'10px',right:'10px',height:'350px'}}>
        <ChatConfigDropdown id="config" modelsError={null} modelLabel={model} providerIcon={null} reasoningLabel={null}
        sections={[{id:'model',label:model,icon:null,groups:[{id:'models',selectedValue:model,onChange:setModel,options:[{value:'first',label:'First model'},{value:'second',label:'Second model'}]}]}]}
        statusIcons={[]} title="Chat settings" presetsEnabled={false} selectionAction="keep-open" providerId="codex" selection={{model}} getPresetDetails={()=>({modelLabel:model,statusIcons:[],title:'Preset',selected:false})} onPresetChange={noop}/>
      </div>
    </main>}
    flushSync(()=>createRoot(document.getElementById('root')).render(<Fixture/>))
  `
      },
      bundle: true,
      jsx: 'automatic',
      platform: 'browser',
      format: 'iife',
      define: { 'import.meta.env.VITE_SELE_ANDROID': '"true"' },
      outfile: path.join(directory, 'fixture.js')
    })
    await fs.writeFile(
      path.join(directory, 'index.html'),
      '<html data-color-scheme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>'
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(
      requireProject('electron'),
      [__filename, directory, '--no-sandbox', '--ozone-platform=x11'],
      { env, encoding: 'utf8', timeout: 45000 }
    )
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.status !== 0) process.exitCode = 1
  })()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      if (directory) await fs.rm(directory, { recursive: true, force: true })
    })
} else {
  const { app, BrowserWindow } = requireProject('electron')
  let window
  app.setPath('userData', path.join(directory, 'profile'))
  app
    .whenReady()
    .then(async () => {
      window = new BrowserWindow({
        width: 440,
        height: 800,
        show: true,
        webPreferences: { backgroundThrottling: false }
      })
      await window.loadFile(path.join(directory, 'index.html'))
      const run = (script) => window.webContents.executeJavaScript(script)
      window.webContents.debugger.attach('1.3')
      const command = (method, params) => window.webContents.debugger.sendCommand(method, params)
      await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await command('Emulation.setDeviceMetricsOverride', {
        width: 412,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true
      })
      await command('Emulation.setFocusEmulationEnabled', { enabled: true })
      const wait = async (expression) => {
        for (let i = 0; i < 100; i++) {
          if (await run(expression)) return
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw Error('Timed out: ' + expression)
      }
      const tap = async (selector) => {
        const point = await run(
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`
        )
        await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
        await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await new Promise((resolve) => setTimeout(resolve, 260))
      }
      console.log(
        'Mobile input capabilities:',
        await run(
          '({coarse:matchMedia("(pointer: coarse)").matches,hover:matchMedia("(hover: hover)").matches,width:innerWidth})'
        )
      )
      const states = []
      for (const label of [
        'All chats',
        'Sleeping chats',
        'Working chats',
        'Active chats',
        'Sleeping chats'
      ]) {
        await tap('[aria-label="' + label + '"]')
        const state = await run(
          `({selected:[...document.querySelectorAll('.chat-home__filter-tabs [aria-pressed=true]')].map(e=>e.getAttribute('aria-label')),extraFills:[...document.querySelectorAll('.chat-home__filter-tabs [aria-pressed=false]')].filter(e=>getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)').map(e=>({label:e.getAttribute('aria-label'),fill:getComputedStyle(e).backgroundColor,focus:e.matches(':focus-visible'),hover:e.matches(':hover')}))})`
        )
        assert.deepEqual(state.selected, [label])
        states.push(state)
      }
      await tap('.message-box__chat-config-trigger')
      await wait('Boolean(document.querySelector("button[data-chat-config-section=model]"))')
      await tap('button[data-chat-config-section=model]')
      await wait('Boolean(document.querySelector("[aria-label=\\"Search models\\"]"))')
      const focused = await run('document.activeElement?.getAttribute("aria-label")')
      console.log('Focused after opening models:', focused)
      assert.notEqual(
        focused,
        'Search models',
        'opening models must not summon the mobile keyboard'
      )
      assert.ok(
        states.every((state) => state.extraFills.length === 0),
        'only the selected mobile chat filter is filled'
      )
      await tap('[aria-label="Search models"]')
      assert.equal(
        await run('document.activeElement.getAttribute("aria-label")'),
        'Search models',
        'explicit touch can focus model search'
      )
      await command('Input.insertText', { text: 'Second' })
      assert.equal(
        await run('document.querySelector("[aria-label=\\"Search models\\"]").value'),
        'Second'
      )
      console.log(
        'MOBILE CONTROLS PASSED: actual sidebar filters stay single-selected; model search waits for touch and then accepts typing'
      )
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(() => {
      window?.destroy()
      app.exit(process.exitCode || 0)
    })
}
