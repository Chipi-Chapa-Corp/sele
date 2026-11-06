const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict')
if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..'),
      dir = await fs.mkdtemp('/tmp/sele-icon-test-')
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {flushSync} from 'react-dom';
            import {Spinner} from './src/renderer/src/components/Spinner';
            import {WorkingChatsIcon} from './src/renderer/src/components/WorkingChatsIcon';
            import './src/renderer/src/assets/main.css';
            document.body.style.cssText='margin:0;background:#000;color:#fff;--control-icon-size:64px';
            const root=createRoot(document.getElementById('root'));
            window.renderIcons=(active=true)=>flushSync(()=>root.render(
              <div><Spinner size={64} aria-label="Loading"/><WorkingChatsIcon active={active}/></div>));
            window.renderIcons();
            window.iconMutations=0;
            new MutationObserver(records=>window.iconMutations+=records.length)
              .observe(document.getElementById('root'),{subtree:true,attributes:true,childList:true,characterData:true});
          `
        },
        outfile: path.join(dir, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' }
      })
      await fs.writeFile(
        path.join(dir, 'index.html'),
        '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const code = await new Promise((resolve) =>
        require('child_process')
          .spawn(require('electron'), [__filename, dir, '--no-sandbox'], { env, stdio: 'inherit' })
          .on('exit', resolve)
      )
      process.exitCode = code ?? 1
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    try {
      const w = new BrowserWindow({
        width: 400,
        height: 300,
        webPreferences: { backgroundThrottling: false }
      })
      await w.loadFile(path.join(process.argv[2], 'index.html'))
      const pause = (ms) => new Promise((r) => setTimeout(r, ms))
      await pause(200)
      await w.webContents.debugger.attach('1.3')
      const events = []
      let finishTrace
      const traceDone = new Promise((resolve) => {
        finishTrace = resolve
      })
      w.webContents.debugger.on('message', (_event, method, params) => {
        if (method === 'Tracing.dataCollected') events.push(...params.value)
        if (method === 'Tracing.tracingComplete') finishTrace()
      })
      await w.webContents.debugger.sendCommand('Tracing.start', { categories: 'devtools.timeline' })
      await pause(2200)
      await w.webContents.debugger.sendCommand('Tracing.end')
      await traceDone
      const paints = events.filter((event) => event.name === 'Paint' && event.ph === 'X')
      console.log(
        'steady icon paints',
        JSON.stringify({
          count: paints.length,
          ms: paints.reduce((sum, e) => sum + e.dur / 1000, 0)
        })
      )
      assert.ok(
        paints.length < 25,
        'steady status animations must reuse painted layers: ' + paints.length
      )
      if (process.env.SELE_ICON_TRACE)
        await fs.writeFile(process.env.SELE_ICON_TRACE, JSON.stringify(events))
      for (const selector of ['.ui-spinner', '.working-chats-icon']) {
        const rect = await w.webContents.executeJavaScript(
          `(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`
        )
        const images = []
        for (let i = 0; i < 4; i++) {
          await pause(170)
          images.push((await w.webContents.capturePage(rect)).toBitmap())
        }
        for (let i = 1; i < 4; i++) {
          let diff = 0
          for (let j = 0; j < images[0].length; j++) diff += images[0][j] !== images[i][j]
          console.log('pixel difference', diff)
          assert.ok(diff > 50, 'status animation must actually render and change')
        }
      }
      assert.equal(
        await w.webContents.executeJavaScript('window.iconMutations'),
        0,
        'animation must not write host DOM on each frame'
      )
      assert.equal(
        await w.webContents.executeJavaScript(
          'document.querySelector(".ui-spinner").getAttribute("role")'
        ),
        'img'
      )
      assert.ok(
        await w.webContents.executeJavaScript(
          `document.getAnimations().every(animation=>animation.effect.getKeyframes().every(frame=>
            Object.keys(frame).every(key=>['offset','computedOffset','easing','composite','transform','opacity'].includes(key))))`
        ),
        'status animations must change only compositor transform/opacity properties'
      )
      const rect = await w.webContents.executeJavaScript(`(()=>{
        const r=document.querySelector('.ui-spinner').getBoundingClientRect();
        return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};
      })()`)
      let unblocked = false
      const block = w.webContents
        .executeJavaScript(`(()=>{
        const end=performance.now()+800;while(performance.now()<end){};
      })()`)
        .then(() => {
          unblocked = true
        })
      await pause(100)
      const first = (await w.webContents.capturePage(rect)).toBitmap()
      await pause(150)
      const second = (await w.webContents.capturePage(rect)).toBitmap()
      assert.equal(unblocked, false, 'sample animation while renderer JavaScript is blocked')
      let changed = 0
      for (let i = 0; i < first.length; i++) changed += first[i] !== second[i]
      assert.ok(changed > 50, 'spinner must keep moving during a renderer stall')
      await block
      await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await pause(100)
      assert.equal(
        await w.webContents.executeJavaScript('!!document.querySelector(".working-chats-icon")'),
        false,
        'reduced motion shows the static bot'
      )
      await w.webContents.executeJavaScript('window.renderIcons(false)')
      assert.equal(
        await w.webContents.executeJavaScript('!!document.querySelector(".working-chats-icon")'),
        false
      )
      console.log(
        'Status icon checks passed: visible transform/opacity animation, bounded steady paint, no host DOM writes, accessible label, reduced motion and inactive state.'
      )
      app.exit(0)
    } catch (e) {
      console.error(e)
      app.exit(1)
    }
  })
}
