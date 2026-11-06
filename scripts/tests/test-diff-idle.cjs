// Real development React and DOM; no provider, real profile, or editor runtime.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp('/tmp/sele-diff-idle-')
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React, {Profiler, StrictMode} from 'react';
            import {createRoot} from 'react-dom/client';
            import {UnifiedDiff} from './src/renderer/src/components/UnifiedDiff';
            import './src/renderer/src/assets/main.css';
            window.idleDiffCommits={emptyReview:0,reviewed:0};window.idleDiffReads=0;
            const read=Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect=function(){if(this.closest('.unified-diff,.unified-diff__review-host'))window.idleDiffReads++;return read.call(this)};
            const fileDiff={path:'sample.ts',displayPath:'sample.ts',kind:'edit',
              diff:'--- a/sample.ts\\n+++ b/sample.ts\\n@@ -1,2 +1,2 @@\\n-const x = 1;\\n+const x = 2;\\n const y = 3;\\n'};
            const comments=[{id:'one',line:1,side:'new',comment:'Check this change'}];
            createRoot(document.getElementById('root')).render(<StrictMode>
              <Profiler id="emptyReview" onRender={id=>idleDiffCommits[id]++}><UnifiedDiff fileDiff={fileDiff} onAddComment={()=>{}}/></Profiler>
              <Profiler id="reviewed" onRender={id=>idleDiffCommits[id]++}><UnifiedDiff fileDiff={fileDiff} comments={comments}/></Profiler>
              <aside id="unrelated-sidebar" style={{position:'fixed',right:0,bottom:0,width:80,height:80,overflow:'auto'}}><div style={{height:1000}}/></aside>
            </StrictMode>);
          `
        },
        outfile: path.join(directory, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"' },
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' }
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const code = await new Promise((resolve, reject) =>
        require('node:child_process')
          .spawn(require('electron'), [__filename, directory, '--no-sandbox'], {
            env,
            stdio: 'inherit'
          })
          .once('error', reject)
          .once('exit', resolve)
      )
      process.exitCode = code ?? 1
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
    try {
      const win = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: { backgroundThrottling: false }
      })
      const errors = []
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      await run('document.fonts.ready')
      await new Promise((resolve) => setTimeout(resolve, 500))
      await run('window.idleDiffCommits={emptyReview:0,reviewed:0};window.idleDiffReads=0')
      await new Promise((resolve) => setTimeout(resolve, 500))
      const idle = await run('({commits:idleDiffCommits,reads:idleDiffReads})')
      console.log('Idle diff work:', JSON.stringify(idle))
      assert.deepEqual(
        idle,
        { commits: { emptyReview: 0, reviewed: 0 }, reads: 0 },
        'an unchanged diff must not schedule renders or measure DOM each frame'
      )
      await run(
        `(async()=>{const sidebar=document.getElementById('unrelated-sidebar');for(let i=0;i<8;i++){sidebar.scrollTop+=10;await new Promise(resolve=>requestAnimationFrame(resolve))}await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()`
      )
      assert.deepEqual(
        await run('({commits:idleDiffCommits,reads:idleDiffReads})'),
        idle,
        'scrolling an unrelated sidebar must not measure review markers or render the diff'
      )
      await run(`document.querySelectorAll('.unified-diff__review-host')[1].style.width='400px'`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.ok(
        await run('idleDiffReads > 0'),
        'resizing the reviewed diff still measures its markers'
      )
      assert.equal(await run('document.querySelectorAll(".unified-diff__review-marker").length'), 1)
      assert.deepEqual(errors, [])
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
