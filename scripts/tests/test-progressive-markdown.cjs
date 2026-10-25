// Real Markdown components and worker, synthetic histories, disposable Electron profile.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-large-markdown-')
    )
    try {
      const esbuild = require('esbuild')
      const options = {
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        loader: { '.ttf': 'dataurl' }
      }
      if (process.argv.includes('--built-worker')) {
        const assets = path.join(root, 'out/renderer/assets')
        const worker = (await fs.readdir(assets)).find((name) =>
          /^chatMarkdown\.worker-.*\.js$/.test(name)
        )
        assert.ok(worker, 'build the production worker before running --built-worker')
        await fs.copyFile(path.join(assets, worker), path.join(directory, 'markdown-worker.js'))
      } else {
        await esbuild.build({
          ...options,
          alias: {
            'decode-named-character-reference': path.join(
              root,
              'node_modules/decode-named-character-reference/index.js'
            )
          },
          entryPoints: [path.join(root, 'src/renderer/src/chatMarkdown.worker.ts')],
          outfile: path.join(directory, 'markdown-worker.js')
        })
      }
      await esbuild.build({
        ...options,
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
          import React,{Activity,useState} from 'react'
          import {createRoot} from 'react-dom/client'
          import {flushSync} from 'react-dom'
          import {MarkdownMessage} from './src/renderer/src/components/ChatDetailItem'
          import './src/renderer/src/assets/main.css'
          import './src/renderer/src/App.css'
          const root=createRoot(document.getElementById('root'))
          const noop=()=>{}
          window.render=(content,key='large',streaming=false,visible=true)=>flushSync(()=>root.render(
            <Activity mode={visible?'visible':'hidden'}><MarkdownMessage key={key} className="chat-detail__message chat-detail__message--assistant"
              content={content} streaming={streaming} onOpenFileLink={(...args)=>window.links.push(args)}/></Activity>))
          window.planRequests=0;
          window.links=[];window.errors=[];window.gaps=[];window.tasks=[];window.counts=[]
          new MutationObserver(()=>window.counts.push(document.querySelectorAll('p').length))
            .observe(document.getElementById('root'),{childList:true,subtree:true})
          new PerformanceObserver(list=>window.tasks.push(...list.getEntries().map(e=>e.duration)))
            .observe({type:'longtask',buffered:true})
          let before=performance.now();requestAnimationFrame(function sample(now){window.gaps.push(now-before);before=now;requestAnimationFrame(sample)})
        `
        },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'fixture-workers',
            setup(build) {
              build.onLoad({ filter: /ProgressiveMarkdownContent\.tsx$/ }, async (args) => ({
                contents: (await fs.readFile(args.path, 'utf8')).replace(
                  'const onCommit = useCallback(() => setRevision((value) => value + 1), [])',
                  'const onCommit = useCallback(() => {window.leafCommits=(window.leafCommits??0)+1;setRevision((value) => value + 1)}, [])'
                ),
                loader: 'tsx',
                resolveDir: path.dirname(args.path)
              }))
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, ({ path: worker }) => ({
                contents: worker.includes('chatMarkdown.worker')
                  ? `export default class extends Worker { constructor(){super('./markdown-worker.js')} postMessage(...args){window.planRequests++;return super.postMessage(...args)} }`
                  : 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><style>body{margin:20px}.chat-detail__message{width:900px}</style><div id="root"></div><script>window.appApi={};</script><script src="fixture.js"></script></html>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 60000 }
      )
      process.stdout.write(child.stdout || '')
      if (child.status !== 0 || child.error) {
        process.stderr.write(child.stderr || String(child.error))
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
  const { app, BrowserWindow } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    const errors = []
    try {
      const win = new BrowserWindow({
        show: true,
        width: 1200,
        height: 900,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const waitFor = (expression) =>
        run(
          `new Promise((resolve,reject)=>{const end=performance.now()+15000;function check(){if(${expression})return requestAnimationFrame(()=>requestAnimationFrame(resolve));if(performance.now()>end)return reject(new Error('Timed out: '+${JSON.stringify(expression)}));setTimeout(check,20)}check()})`
        )
      const paragraph = (index) =>
        `### Finding ${index}\n\nParagraph ${index} with **strong text** and [source](/fixture/source.ts:10).\n\n\x60\x60\x60ts\nconst result${index} = {value: "large", ready: true};\n\x60\x60\x60\n\n`
      const content =
        Array.from({ length: 350 }, (_, i) => paragraph(i)).join('') + '\nFINAL-MARKER\n'
      const firstViewport = await run(
        `window.gaps=[];window.tasks=[];window.counts=[];window.render(${JSON.stringify(content)},'rich',true);
        ({text:document.getElementById('root').textContent,loader:document.body.textContent.includes('Rendering message')})`
      )
      assert.match(
        firstViewport.text,
        /FINAL-MARKER/,
        'available message text appears in its first commit'
      )
      assert.equal(firstViewport.loader, false)
      assert.ok(firstViewport.text.length <= 8_194, 'the initial text viewport stays bounded')
      await waitFor(
        `document.querySelectorAll('h3').length===350 && document.body.textContent.includes('FINAL-MARKER')`
      )
      const measured = await run(
        `({maxFrameGap:Math.max(...window.gaps),longTasks:window.tasks,counts:[...new Set(window.counts)],nodes:document.querySelectorAll('*').length})`
      )
      assert.ok(measured.counts.length > 5, 'one huge turn must mount in bounded sections')
      assert.ok(
        measured.maxFrameGap < 150,
        'large-turn rendering blocked frames: ' + JSON.stringify(measured)
      )
      assert.equal(
        await run(`document.querySelectorAll('code .token').length>0`),
        true,
        'worker preserves syntax highlighting'
      )
      await run(`document.querySelector('.chat-detail__file-link').click()`)
      assert.deepEqual(await run('window.links[0]'), [
        '/fixture/source.ts',
        '/fixture/source.ts',
        10
      ])
      // An unchanged prefix must retain text nodes and selection across an appended stream update.
      await run(
        `window.selected=document.querySelector('p').firstChild;const range=document.createRange();range.setStart(window.selected,0);range.setEnd(window.selected,9);getSelection().removeAllRanges();getSelection().addRange(range);window.selectedText=getSelection().toString();window.firstHeading=document.querySelector('h3');window.render(${JSON.stringify(content + '\nAPPENDED-MARKER\n')},'rich',true)`
      )
      await waitFor(`document.body.textContent.includes('APPENDED-MARKER')`)
      assert.equal(await run('window.firstHeading===document.querySelector("h3")'), true)
      assert.equal(
        await run('getSelection().toString()===window.selectedText && window.selected.isConnected'),
        true,
        'streaming preserves the selected prefix'
      )
      await run(`window.render(${JSON.stringify(content + '\nAPPENDED-MARKER\n')},'rich',false)`)
      await waitFor(`document.body.textContent.includes('APPENDED-MARKER')`)
      assert.equal(
        await run('getSelection().toString()===window.selectedText'),
        true,
        'completion preserves selection'
      )
      const requestsBeforeReveal = await run('window.planRequests')
      const commitsBeforeReveal = await run('window.leafCommits')
      const completedContent = content + '\nAPPENDED-MARKER\n'
      await run(`window.render(${JSON.stringify(completedContent)},'rich',false,false)`)
      await run(`window.render(${JSON.stringify(completedContent)},'rich',false,true)`)
      await run('new Promise(resolve=>setTimeout(resolve,300))')
      assert.equal(
        await run('window.planRequests'),
        requestsBeforeReveal,
        'revealing unchanged Markdown must reuse its completed worker plan'
      )
      assert.equal(
        await run('window.firstHeading===document.querySelector("h3")'),
        true,
        'revealing a message reuses its rendered blocks'
      )
      assert.equal(
        await run('window.leafCommits'),
        commitsBeforeReveal,
        'revealing unchanged blocks must not replay DOM commit notifications'
      )
      await run(
        `window.render(${JSON.stringify(completedContent + '\nHIDDEN-UPDATE\n')},'rich',true,false)`
      )
      await run(
        `window.render(${JSON.stringify(completedContent + '\nHIDDEN-UPDATE\n')},'rich',true,true)`
      )
      await waitFor(`document.body.textContent.includes('HIDDEN-UPDATE')`)
      assert.equal(
        await run('window.planRequests > ' + requestsBeforeReveal),
        true,
        'source changed while hidden still requests a fresh plan'
      )
      const table =
        '<details open><summary>Results</summary>\n\n| Name | Value |\n| --- | --- |\n' +
        Array.from({ length: 600 }, (_, i) => `| row ${i} | **value ${i}** |`).join('\n') +
        '\n\n</details>\n'
      await run(`window.render(${JSON.stringify(table)},'table')`)
      await waitFor(
        `document.querySelectorAll('tbody tr').length===600 && document.querySelectorAll('thead th').length===2`
      )
      assert.equal(
        await run('document.querySelectorAll("table").length'),
        1,
        'table shells preserve one table'
      )
      assert.equal(await run('document.querySelector("details").open'), true)
      assert.equal(await run('document.querySelectorAll("thead th").length'), 2)
      const linked =
        'Reference [source][target] and a note[^one].\n\n' +
        content +
        '\n[target]: /fixture/reference.ts:42\n\n[^one]: Footnote text\n'
      await run(`window.render(${JSON.stringify(linked)},'references')`)
      await waitFor(
        `document.querySelector('[data-file-link-path="/fixture/reference.ts"]') && document.body.textContent.includes('Footnote text') && document.querySelectorAll('h3').length===350`
      )
      assert.equal(
        await run('document.querySelectorAll(".footnotes").length'),
        1,
        'cross-block footnotes retain a single shared scope'
      )
      const codeText = 'const value = "🐈 <tag> & text";\n'.repeat(5000)
      await run(
        `window.render(${JSON.stringify('\x60\x60\x60ts\n' + codeText + '\x60\x60\x60\n')},'long-code')`
      )
      await waitFor(`document.querySelector('pre code')?.textContent.length >= ${codeText.length}`)
      assert.equal(
        await run('document.querySelector("pre code").textContent.trimEnd()'),
        codeText.trimEnd(),
        'split code retains exact characters and entities'
      )
      // Worker results and queued mounts from the previous chat cannot return after unmount.
      await run(
        `window.render(${JSON.stringify(content)},'cancelled');window.render('Empty chat','empty')`
      )
      await run('new Promise(resolve=>setTimeout(resolve,400))')
      assert.equal(await run('document.querySelectorAll("h3").length'), 0)
      assert.equal(await run('document.body.textContent.includes("Empty chat")'), true)
      // Ordinary rich replies used to stay on the synchronous path until 12 KB,
      // blocking navigation with parsing, highlighting and sanitizing together.
      const medium = Array.from({ length: 40 }, (_, i) => paragraph(i)).join('')
      assert.ok(medium.length < 12_000)
      const mediumRequests = await run('window.planRequests')
      await run(`window.render(${JSON.stringify(medium)},'medium',true)`)
      await waitFor(`document.querySelectorAll('h3').length===40`)
      assert.ok(
        (await run('window.planRequests')) > mediumRequests,
        'ordinary rich replies must parse in the worker'
      )
      assert.equal(await run(`document.querySelectorAll('code .token').length>0`), true)
      assert.deepEqual(errors, [])
      console.log(
        JSON.stringify({
          messageCharacters: content.length,
          maxFrameGap: measured.maxFrameGap,
          longTasks: measured.longTasks,
          mountStages: measured.counts.length,
          nodes: measured.nodes,
          tableRows: 600,
          longCodeCharacters: codeText.length
        })
      )
    } catch (error) {
      console.error(error, errors)
      code = 1
    }
    app.exit(code)
  })
}
