// Run with Node; the child process verifies the real Electron sandbox and CSP.
if (!process.versions.electron) {
  const { build } = require('esbuild')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const os = require('node:os')
  const { spawnSync } = require('node:child_process')
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-visualization-test-'))
    try {
      for (const legacy of [false, true]) {
        await build({
          entryPoints: [path.resolve(__dirname, '../../src/main/visualizationProtocol.ts')],
          bundle: true,
          platform: 'node',
          outfile: path.join(directory, legacy ? 'legacy-protocol.cjs' : 'protocol.cjs'),
          external: ['electron'],
          plugins: [
            {
              name: 'raw',
              setup(builder) {
                builder.onResolve({ filter: /\?raw$/ }, (args) => ({
                  path: path.resolve(args.resolveDir, args.path.slice(0, -4)),
                  namespace: 'raw'
                }))
                builder.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
                  contents:
                    legacy && args.path.endsWith('/runtime.js')
                      ? (await fs.readFile(args.path, 'utf8'))
                          .replace(/send\('visualization:rendered',[\s\S]*?\n {4}\}\)/, '')
                          .replace(
                            'supportsRenderedMessage: true',
                            'supportsRenderedMessage: false'
                          )
                      : await fs.readFile(args.path, 'utf8'),
                  loader: 'text'
                }))
              }
            }
          ]
        })
      }
      await build({
        entryPoints: [path.resolve(__dirname, 'fixtures/visualization-message.tsx')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        outfile: path.join(directory, 'message.js'),
        jsx: 'automatic',
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' },
        define: { 'process.env.NODE_ENV': '"development"' },
        plugins: [
          {
            name: 'unused-editor-workers',
            setup(builder) {
              // Monaco is imported by the message's file preview, which this test never opens.
              builder.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused-worker'
              }))
              builder.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents: 'export default class {}',
                loader: 'js'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'message.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src sele-visualize:"><link rel="stylesheet" href="message.css"></head><body><div id="root"></div></body></html>`
      )
      await fs.writeFile(
        path.join(directory, 'host.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src sele-visualize:"></head><body style="margin:0"></body></html>`
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const result = spawnSync(require('electron'), [__filename, directory, '--no-sandbox'], {
        env: environment,
        encoding: 'utf8',
        timeout: 40000
      })
      process.stdout.write(result.stdout || '')
      if (result.status === 0 && process.env.SELE_VISUALIZATION_SCREENSHOTS) {
        await fs.mkdir(process.env.SELE_VISUALIZATION_SCREENSHOTS, { recursive: true })
        for (const name of ['expanded-popup.png', 'inline-controls.png']) {
          await fs.copyFile(
            path.join(directory, name),
            path.join(process.env.SELE_VISUALIZATION_SCREENSHOTS, name)
          )
        }
      }
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error || 'Electron check failed'))
        process.exitCode = 1
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, protocol } = require('electron')
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const { registerVisualizationProtocol } = require(
    require('node:path').join(process.argv[2], 'protocol.cjs')
  )
  protocol.registerSchemesAsPrivileged([
    { scheme: 'sele-visualize', privileges: { standard: true, secure: true } }
  ])
  const fragment = `<div id="sample"><h3>Interactive check</h3><label class="form-label">Value <output id="value">5</output><input class="form-range" id="range" type="range" value="5"></label><button class="btn" id="follow">Investigate</button><i data-lucide="chart-line"></i><div class="nav nav-pills" role="tablist"><button class="nav-link active" role="tab" id="one" aria-controls="panel-one" aria-selected="true">One</button><button class="nav-link" role="tab" id="two" aria-controls="panel-two">Two</button></div><div id="panel-one" role="tabpanel">First</div><div id="panel-two" role="tabpanel" hidden>Second</div></div><script>const root = document.getElementById('sample'); root.querySelector('#range').oninput = event => root.querySelector('#value').textContent = event.target.value; root.querySelector('#follow').onclick = () => window.openai.sendFollowUpMessage({prompt:'Explain selected value'}); const state={radius:8}; new Tweak({container:root,onChange:()=>root.style.borderRadius=state.radius+'px'}).addSlider(state,'radius',{min:0,max:40});</script>`
  app.whenReady().then(async () => {
    registerVisualizationProtocol()
    const window = new BrowserWindow({
      show: false,
      width: 736,
      height: 650,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    try {
      await window.loadFile(process.argv[2] + '/host.html')
      await window.webContents.executeJavaScript(
        `window.messages=[]; window.addEventListener('message', event => { messages.push(event.data); if(event.data.type==='visualization:ready') event.source.postMessage({type:'visualization:init',html:${JSON.stringify(fragment)},dark:false},'*'); }); const frame=document.createElement('iframe'); frame.sandbox='allow-scripts'; frame.src='sele-visualize://frame/'; frame.style='width:100%;height:580px;border:0'; document.body.append(frame);`
      )
      let child
      for (let i = 0; i < 100; i++) {
        child = window.webContents.mainFrame.frames[0]
        if (
          child &&
          (await child.executeJavaScript(
            `!!document.getElementById('value') && !!document.querySelector('svg.lucide')`
          ))
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert(child, 'Frame loads under the actual parent CSP')
      assert.equal(
        await child.executeJavaScript(`document.querySelector('svg.lucide') !== null`),
        true
      )
      assert.equal(
        await child.executeJavaScript(
          `document.querySelector('#range').value='42'; document.querySelector('#range').dispatchEvent(new Event('input')); document.querySelector('#value').textContent`
        ),
        '42'
      )
      assert.equal(
        await child.executeJavaScript(`typeof window.appApi + ':' + typeof require`),
        'undefined:undefined'
      )
      assert.equal(
        await child.executeJavaScript(
          `(() => {try {return !!parent.document} catch {return false}})()`
        ),
        false
      )
      assert.equal(
        await child.executeJavaScript(`fetch('https://example.com').then(()=>false,()=>true)`),
        true
      )
      // CDN tooltips may finish loading after the fragment; wait for the tab runtime.
      for (let i = 0; i < 150; i++) {
        if (
          await child.executeJavaScript(
            `document.getElementById('codex-visualization-tabs') !== null`
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.equal(
        await child.executeJavaScript(
          `document.querySelector('#two').click(); document.querySelector('#panel-one').hidden`
        ),
        true
      )
      await child.executeJavaScript(`document.querySelector('#follow').click()`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(
        await window.webContents.executeJavaScript(
          `messages.some(message=>message.type==='visualization:follow-up' && message.prompt==='Explain selected value')`
        ),
        true
      )
      await window.webContents.executeJavaScript(
        `document.querySelector('iframe').contentWindow.postMessage({type:'visualization:theme',dark:true},'*')`
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(
        await child.executeJavaScript(`document.documentElement.style.colorScheme`),
        'dark'
      )
      assert.equal(
        await child.executeJavaScript(
          `const tweakInput = document.querySelector('details input'); tweakInput.value='24'; tweakInput.dispatchEvent(new Event('input')); document.querySelector('#sample').style.borderRadius`
        ),
        '24px'
      )
      await fs.writeFile(
        process.argv[2] + '/dark.png',
        (await window.webContents.capturePage()).toPNG()
      )
      window.setSize(360, 650)
      await window.webContents.executeJavaScript(
        `document.querySelector('iframe').contentWindow.postMessage({type:'visualization:theme',dark:false},'*')`
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(
        await child.executeJavaScript(`document.documentElement.scrollWidth <= innerWidth`),
        true
      )
      await fs.writeFile(
        process.argv[2] + '/narrow.png',
        (await window.webContents.capturePage()).toPNG()
      )
      console.log(
        'PASS: frame loading, icons, interaction, tabs, Tweak, follow-up bridge, themes, sizing, parent isolation, API isolation and network blocking'
      )
      await window.loadFile(process.argv[2] + '/message.html')
      await window.webContents.executeJavaScript(
        `window.visualizationFixture={contents:${JSON.stringify(fragment)},delay:40,error:null,reads:0};window.appApi={getFileContents:async()=>{visualizationFixture.reads++;await new Promise(resolve=>setTimeout(resolve,visualizationFixture.delay));if(visualizationFixture.error)throw new Error(visualizationFixture.error);return {contents:visualizationFixture.contents}}};const script=document.createElement('script');script.src='message.js';document.body.append(script);`
      )
      for (let i = 0; i < 100; i++) {
        child = window.webContents.mainFrame.frames[0]
        if (child && (await child.executeJavaScript(`!!document.getElementById('range')`))) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('.test-message iframe').length`
        ),
        1,
        'The actual MarkdownMessage mounts its visualization portal'
      )
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('pre code').textContent.includes('visualize')`
        ),
        true,
        'Code examples remain literal'
      )
      await child.executeJavaScript(
        `document.querySelector('#range').value='73';document.querySelector('#range').dispatchEvent(new Event('input'));`
      )
      // Expansion must use the shared resizable dialog without recreating the iframe.
      const assertSeparatedButtons = async (selector) => {
        assert.equal(
          await window.webContents.executeJavaScript(`(() => {
            const buttons = [...document.querySelectorAll(${JSON.stringify(selector)} + ' button')];
            const [left, right] = buttons.map(button => button.getBoundingClientRect());
            const centered = buttons.every(button => {
              const bounds = button.getBoundingClientRect();
              const icon = button.querySelector('svg').getBoundingClientRect();
              return Math.abs((bounds.left + bounds.right) - (icon.left + icon.right)) < 1 &&
                Math.abs((bounds.top + bounds.bottom) - (icon.top + icon.bottom)) < 1;
            });
            return buttons.length === 2 && buttons.every(button => button.classList.contains('ui-button')) &&
              centered && left.width > 0 && left.right <= right.left && left.top === right.top;
          })()`),
          true,
          'Standard action buttons have centered icons and remain side by side without overlapping'
        )
      }
      await assertSeparatedButtons('.visualization__actions')
      window.setSize(1000, 800)
      await window.webContents.executeJavaScript(
        `window.inlineFrame=document.querySelector('.test-message iframe');document.querySelector('[aria-label="Expand visualization"]').focus();document.querySelector('[aria-label="Expand visualization"]').click();`
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      await assertSeparatedButtons('.resizable-lightbox__actions')
      assert.equal(
        await window.webContents.executeJavaScript(`(() => {
          const actions = document.querySelector('.resizable-lightbox__actions').getBoundingClientRect();
          const content = document.querySelector('.visualization__viewport').getBoundingClientRect();
          return actions.bottom <= content.top;
        })()`),
        true,
        'Popup controls occupy their own row above the visualization content'
      )
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.visualization dialog').matches(':modal') && getComputedStyle(document.querySelector('.visualization dialog')).resize==='both'`
        ),
        true,
        'Visualization expands into the shared modal with resizing enabled'
      )
      assert.equal(
        await child.executeJavaScript(`document.querySelector('#value').textContent`),
        '73'
      )
      const expandedWidth = await child.executeJavaScript('innerWidth')
      await window.webContents.executeJavaScript(
        `Object.assign(document.querySelector('.visualization dialog').style,{width:'600px',height:'420px'})`
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.ok(
        (await child.executeJavaScript('innerWidth')) < expandedWidth,
        'The live visualization follows the resized popup width'
      )
      await fs.writeFile(
        process.argv[2] + '/expanded-popup.png',
        (await window.webContents.capturePage()).toPNG()
      )
      await child.executeJavaScript(
        `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(
        await window.webContents.executeJavaScript(
          `!document.querySelector('.visualization dialog').open && document.querySelector('.test-message iframe')===inlineFrame && document.activeElement.matches('[aria-label="Expand visualization"]')`
        ),
        true,
        'Escape inside the iframe restores the inline view and focus without replacing its DOM'
      )
      assert.equal(
        await child.executeJavaScript(`document.querySelector('#value').textContent`),
        '73'
      )
      await fs.writeFile(
        process.argv[2] + '/inline-controls.png',
        (await window.webContents.capturePage()).toPNG()
      )
      console.log(
        'PASS: shared resizable popup, iframe state preservation and Escape focus restoration'
      )
      // Expanding a Markdown table changes state in the same message component.
      await window.webContents.executeJavaScript(
        `window.originalFrame=document.querySelector('.test-message iframe');window.originalReads=visualizationFixture.reads;document.querySelector('.chat-detail__table-expand').click();`
      )
      for (let i = 0; i < 100; i++) {
        if (
          await window.webContents.executeJavaScript(
            `!!document.querySelector('.resizable-lightbox[open]')`
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.equal(
        await window.webContents.executeJavaScript(
          `!!document.querySelector('.resizable-lightbox[open]')`
        ),
        true
      )
      assert.equal(
        await window.webContents.executeJavaScript(
          `originalFrame.isConnected && document.querySelector('.test-message iframe')===originalFrame`
        ),
        true,
        'Message state updates preserve the live visualization DOM'
      )
      assert.equal(
        await child.executeJavaScript(`document.querySelector('#value').textContent`),
        '73',
        'Interactions survive message re-renders'
      )
      await window.webContents.executeJavaScript(
        `document.querySelector('.resizable-lightbox__actions button').click();document.querySelector('#send-message').click();`
      )
      for (let i = 0; i < 100; i++) {
        if (
          await window.webContents.executeJavaScript(
            `!!document.querySelector('.test-new-message')`
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(
        await window.webContents.executeJavaScript(
          `originalFrame.isConnected && document.querySelector('.test-message iframe')===originalFrame`
        ),
        true,
        'Sending a message with freshly copied workspace metadata preserves the iframe'
      )
      assert.equal(
        await child.executeJavaScript(`document.querySelector('#value').textContent`),
        '73',
        'Selections survive new chat messages'
      )
      assert.equal(
        await window.webContents.executeJavaScript(`visualizationFixture.reads===originalReads`),
        true,
        'Equivalent workspace objects do not reread the file'
      )
      // Observe visible frames on every paint while a slow reload is in progress.
      await window.webContents.executeJavaScript(
        `window.reloadGaps=[];window.reloadPaintChecks=0;window.oldHeight=document.querySelector('.visualization__viewport').offsetHeight;window.monitorReload=true;function inspectReload(){if(!monitorReload)return;reloadPaintChecks++;const visible=document.querySelector('.visualization__frame:not(.visualization__frame--pending)');if(!visible || document.querySelector('.visualization__viewport').offsetHeight!==oldHeight)reloadGaps.push('missing frame or changed height');requestAnimationFrame(inspectReload)}requestAnimationFrame(inspectReload);document.querySelector('.visualization__actions button').click();`
      )
      const waitForReload = async () => {
        for (let i = 0; i < 100; i++) {
          if (
            await window.webContents.executeJavaScript(
              `!document.querySelector('.visualization__actions button').disabled`
            )
          )
            return
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert.fail('Visualization reload did not finish')
      }
      await waitForReload()
      assert.equal(
        await window.webContents.executeJavaScript(
          `originalFrame.isConnected && document.querySelector('.test-message iframe')===originalFrame`
        ),
        true,
        'Reloading an unchanged file preserves its document'
      )
      assert.equal(
        await child.executeJavaScript(`document.querySelector('#value').textContent`),
        '73',
        'Unchanged reloads retain selections'
      )
      assert.equal(
        await window.webContents.executeJavaScript(`visualizationFixture.reads`),
        await window.webContents.executeJavaScript(`originalReads+1`),
        'Reload still rereads the source file'
      )
      // A delayed module keeps the replacement busy long enough to inspect the staged frame.
      const updatedFragment =
        fragment.replace('Interactive check', 'Updated check') +
        '<script type="module">await new Promise(resolve=>setTimeout(resolve,250));document.getElementById("sample").dataset.updated="true";</script>'
      await window.webContents.executeJavaScript(
        `visualizationFixture.contents=${JSON.stringify(updatedFragment)};document.querySelector('.visualization__actions button').click();`
      )
      for (let i = 0; i < 100; i++) {
        if (
          await window.webContents.executeJavaScript(
            `!!document.querySelector('.visualization__frame--pending')`
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.equal(
        await window.webContents.executeJavaScript(
          `originalFrame.isConnected && !originalFrame.classList.contains('visualization__frame--pending') && document.querySelectorAll('.test-message iframe').length===2`
        ),
        true,
        'The old frame stays visible while its replacement initializes'
      )
      await window.webContents.executeJavaScript(
        `window.stagedFrame=document.querySelector('.visualization__frame--pending');document.querySelector('#send-message').click();`
      )
      await waitForReload()
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.test-message iframe')===stagedFrame && !originalFrame.isConnected`
        ),
        true,
        'The staged frame is promoted without remounting'
      )
      child = window.webContents.mainFrame.frames[0]
      assert.equal(
        await child.executeJavaScript(`document.getElementById('sample').dataset.updated`),
        'true',
        'Replacement appears only after its scripts finish'
      )
      await child.executeJavaScript(
        `document.querySelector('#range').value='21';document.querySelector('#range').dispatchEvent(new Event('input'));`
      )
      await window.webContents.executeJavaScript(
        `visualizationFixture.error='File unavailable';document.querySelector('.visualization__actions button').click();`
      )
      await waitForReload()
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelector('.test-message iframe')===stagedFrame && document.querySelector('.visualization [role="alert"]').textContent==='File unavailable'`
        ),
        true,
        'Read failures leave the existing visualization intact'
      )
      assert.equal(
        await child.executeJavaScript(`document.querySelector('#value').textContent`),
        '21'
      )
      assert.equal(
        await window.webContents.executeJavaScript(`monitorReload=false;reloadGaps.length`),
        0,
        'Reload never blanks or collapses the visualization'
      )
      assert.equal(
        await window.webContents.executeJavaScript(`reloadPaintChecks>0`),
        true,
        'The reload visibility check observed actual paint frames'
      )
      console.log(
        'PASS: actual MarkdownMessage rendering, code examples, portal persistence and interaction state'
      )
      console.log(
        'PASS: stable workspace identity, unchanged reloads, atomic document replacement and reload failure recovery'
      )
      await window.loadURL('about:blank')
      protocol.unhandle('sele-visualize')
      require(
        require('node:path').join(process.argv[2], 'legacy-protocol.cjs')
      ).registerVisualizationProtocol()
      await window.loadFile(process.argv[2] + '/message.html')
      await window.webContents.executeJavaScript(
        `window.appApi={getFileContents:async()=>({contents:${JSON.stringify(fragment)}})};const script=document.createElement('script');script.src='message.js';document.body.append(script);`
      )
      for (let i = 0; i < 100; i++) {
        if (
          await window.webContents.executeJavaScript(
            `!!document.querySelector('.visualization__frame:not(.visualization__frame--pending)')`
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.equal(
        await window.webContents.executeJavaScript(
          `!!document.querySelector('.visualization__frame:not(.visualization__frame--pending)') && !document.querySelector('.visualization__actions button').disabled`
        ),
        true,
        'An older main-process runtime cannot leave the refreshed UI stuck loading'
      )
      console.log('PASS: renderer hot reload with the older sandbox handshake')
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
  setTimeout(() => {
    console.error('Timed out')
    app.exit(1)
  }, 30000)
}
