const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const project = path.resolve(__dirname, '../..')
let directory = process.versions.electron ? process.argv[2] : null
if (!process.versions.electron) {
  ;(async () => {
    directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-mobile-links-'))
    const { build } = require('esbuild')
    await build({
      stdin: {
        resolveDir: project,
        contents: `export {startLocalAccessServer} from './src/main/localAccessServer'; export {loadLocalAccessTls} from './src/main/localAccessTls'; export {visualizationFrame} from './vite.visualization'`,
        loader: 'ts'
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      outfile: path.join(directory, 'server.cjs')
    })
    // The server bundle resolves dependencies through the project, not the temporary profile.
    await fs.symlink(
      path.join(project, 'node_modules'),
      path.join(directory, 'node_modules'),
      'dir'
    )
    await build({
      stdin: {
        resolveDir: project,
        loader: 'tsx',
        contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {Visualization} from './src/renderer/src/components/Visualization';
        import {MobileLinkActions} from './src/renderer/src/components/MobileLinkActions';
        import {resolveRemoteUrl} from './src/renderer/src/remoteUrl';
        import {dismissMobileOverlay} from './src/renderer/src/mobileBack';
        import './src/renderer/src/assets/main.css';
        window.dismissMobileOverlay=dismissMobileOverlay;
        window.resolveRemoteUrl=resolveRemoteUrl;
        createRoot(document.getElementById('root')).render(<><a id="link" href="http://127.0.0.1:5173/path?q=1#test">Local preview</a><Visualization reference={{path:'/fixture.html'}}/><MobileLinkActions/></>);
      `
      },
      bundle: true,
      jsx: 'automatic',
      platform: 'browser',
      format: 'iife',
      outfile: path.join(directory, 'fixture.js')
    })
    await fs.writeFile(
      path.join(directory, 'setup.js'),
      `
      window.seleRemoteClient=true;window.seleHostOrigin=()=> 'http://192.168.1.24:4589';window.opens=0;window.copies=[];
      document.addEventListener('click',event=>{if(event.target.closest('a')){event.preventDefault();window.opens++}});
      window.appApi={getFileContents:async()=>({contents:'<label>Value <input id="range" type="range" value="42" oninput="document.getElementById(\\'value\\').textContent=this.value"></label><output id="value">42</output><script type="module">await Promise.resolve();document.body.dataset.ready="yes"</script>'}),handleExternalLink:async({url,action})=>{window.copies.push({url,action});return {action,always:false}}};
    `
    )
    await fs.writeFile(
      path.join(directory, 'index.html'),
      '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="setup.js"></script><script src="fixture.js"></script></body></html>'
    )
    // Exercise the same generated asset as the Android and desktop renderer builds.
    const { visualizationFrame } = require(path.join(directory, 'server.cjs'))
    visualizationFrame().generateBundle.call({
      addWatchFile() {},
      emitFile(asset) {
        require('node:fs').writeFileSync(path.join(directory, asset.fileName), asset.source)
      }
    })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(
      require('electron'),
      [__filename, directory, '--no-sandbox', '--ozone-platform=x11'],
      { env, encoding: 'utf8', timeout: 45000 }
    )
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.status !== 0) throw result.error ?? Error('Mobile fixture failed: ' + result.status)
  })()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      if (directory) await fs.rm(directory, { recursive: true, force: true })
    })
} else {
  const { app, BrowserWindow } = require('electron')
  let window, server
  app.setPath('userData', path.join(directory, 'profile'))
  app
    .whenReady()
    .then(async () => {
      const { startLocalAccessServer, loadLocalAccessTls } = require(path.join(directory, 'server.cjs'))
      const tls = await loadLocalAccessTls(path.join(directory, 'test-tls.json'))
      require('electron').session.defaultSession.setCertificateVerifyProc((request, done) => {
        const actual = new (require('node:crypto').X509Certificate)(request.certificate.data).fingerprint256.replaceAll(':', '').toLowerCase()
        done(actual === tls.fingerprint ? 0 : -2)
      })
      server = await startLocalAccessServer({
        tls,
        port: 0,
        host: '127.0.0.1',
        token: 'fixture',
        assetsDirectory: directory,
        invoke() {},
        receive() {}
      })
      window = new BrowserWindow({
        width: 412,
        height: 800,
        show: true,
        webPreferences: { backgroundThrottling: false }
      })
      await window.loadURL(`https://127.0.0.1:${server.port}`)
      const run = (script) => window.webContents.executeJavaScript(script)
      const wait = async (expression) => {
        for (let i = 0; i < 100; i++) {
          if (await run(expression)) return
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        throw Error('Timed out: ' + expression)
      }
      await wait(
        `!!document.querySelector('.visualization__frame:not(.visualization__frame--pending)')`
      )
      const frame = window.webContents.mainFrame.frames[0]
      assert.equal(
        await frame.executeJavaScript('document.body.dataset.ready'),
        'yes',
        'inline modules finish over HTTP without secure-context randomUUID'
      )
      assert.equal(
        await frame.executeJavaScript(`(()=>{try{return !!parent.document}catch{return false}})()`),
        false,
        'frame remains an opaque sandbox'
      )
      assert.equal(await run(`document.querySelector('iframe').sandbox.value`), 'allow-scripts')
      await frame.executeJavaScript(
        `document.querySelector('#range').value='71';document.querySelector('#range').dispatchEvent(new Event('input'))`
      )
      assert.equal(
        await frame.executeJavaScript(`document.querySelector('#value').textContent`),
        '71'
      )
      assert.equal(
        await run(`resolveRemoteUrl('http://localhost:3000/a?x=1#z')`),
        'http://192.168.1.24:3000/a?x=1#z'
      )
      window.webContents.debugger.attach('1.3')
      const command = (method, params) => window.webContents.debugger.sendCommand(method, params)
      await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      const point = await run(
        `(()=>{const r=document.querySelector('#link').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`
      )
      const start = () =>
        command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      const end = () => command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await start()
      await wait(`!!document.querySelector('.mobile-link-actions[open]')`)
      await end()
      assert.equal(await run('opens'), 0, 'holding never navigates')
      await run(`document.querySelector('.mobile-link-actions button').click()`)
      await wait(`!document.querySelector('.mobile-link-actions')`)
      assert.deepEqual(await run('copies'), [
        { url: 'http://192.168.1.24:5173/path?q=1#test', action: 'copy' }
      ])
      await start()
      await command('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x + 40, y: point.y }]
      })
      await new Promise((resolve) => setTimeout(resolve, 550))
      await end()
      assert.equal(
        await run(`!!document.querySelector('.mobile-link-actions')`),
        false,
        'moving cancels a hold'
      )
      await start()
      await wait(`!!document.querySelector('.mobile-link-actions[open]')`)
      await end()
      assert.equal(await run('dismissMobileOverlay()'), true)
      await wait(`!document.querySelector('.mobile-link-actions')`)
      await start()
      await end()
      await wait('opens===1')
      console.log(
        'PASS: mobile HTTPS visualization renders and runs modules in an opaque sandbox; touch hold copies rewritten addresses, drag cancels, Back dismisses, tap opens'
      )
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      window?.destroy()
      await server?.stop()
      app.exit(process.exitCode || 0)
    })
}
