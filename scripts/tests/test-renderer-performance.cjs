// Real Chromium animations and Markdown worker, synthetic data, disposable profile.
// Run through isolated-gui; assertions count work rather than machine-dependent FPS.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-render-perf-'))
    try {
      const common = {
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        alias: {
          'decode-named-character-reference': path.join(
            root,
            'node_modules/decode-named-character-reference/index.js'
          )
        }
      }
      await require('esbuild').build({
        ...common,
        entryPoints: [path.join(root, 'src/renderer/src/chatMarkdown.worker.ts')],
        outfile: path.join(directory, 'markdown.js')
      })
      await require('esbuild').build({
        ...common,
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
          import React from 'react'
          import { createRoot } from 'react-dom/client'
          import { flushSync } from 'react-dom'
          import { marked } from 'marked'
          import { WorkingMark } from './src/renderer/src/components/WorkingMark'
          import { useRecentChatReferences } from './src/renderer/src/workspace/useRecentChatReferences'
          import { requestMarkdownPlan } from './src/renderer/src/chatMarkdownClient'
          import { useCompactLayout, compactLayoutQuery } from './src/renderer/src/useCompactLayout'
          window.mainParses = 0; window.referenceRenders = 0; window.pathWrites = 0;
          window.layoutQueries = 0; window.layoutListeners = 0;
          const matchMedia = window.matchMedia.bind(window);
          window.matchMedia = query => {
            const media = matchMedia(query);
            if(query === compactLayoutQuery) {
              window.layoutQueries++;
              const add = media.addEventListener.bind(media), remove = media.removeEventListener.bind(media);
              media.addEventListener = (...args) => { if(args[0] === 'change') window.layoutListeners++; return add(...args) };
              media.removeEventListener = (...args) => { if(args[0] === 'change') window.layoutListeners--; return remove(...args) };
            }
            return media;
          };
          window.postedJobs = []; window.heldJobs = []; window.holdWorker = false;
          const lexer = marked.lexer;
          marked.lexer = function(...args) { window.mainParses++; return lexer.apply(this, args) };
          const setAttribute = SVGElement.prototype.setAttribute;
          SVGElement.prototype.setAttribute = function(name, value) {
            if (name === 'd') window.pathWrites++;
            return setAttribute.call(this, name, value);
          };
          const root = createRoot(document.getElementById('root'));
          function References({ items, chatKey, limit }) {
            window.referenceRenders++;
            window.references = useRecentChatReferences(items, limit, chatKey);
            return <output>{JSON.stringify(window.references)}</output>;
          }
          const variants = ['swap', 'spin', 'depth'];
          function LayoutConsumer() {
            const compact = useCompactLayout();
            return <span data-layout={compact ? 'compact' : 'wide'}/>;
          }
          window.items = [{type:'message', id:'first', role:'assistant',
            content:Array.from({length:300}, (_,i) => '[Source '+i+'](/source-'+i+'.ts:12)').join('\\n\\n')}];
          window.options = { chatKey:'first-chat', limit:10, items:window.items, speed:1 };
          window.renderFixture = options => {
            Object.assign(window.options, options);
            flushSync(() => root.render(<React.StrictMode>
              <References {...window.options}/>
              <div>{Array.from({length:500}, (_,i) => <LayoutConsumer key={i}/>)}</div>
              <div>{Array.from({length:60}, (_,i) => <WorkingMark key={i} animation={variants[i%3]} speed={window.options.speed}/>)}</div>
            </React.StrictMode>));
          };
          window.renderFixture({});
          window.unmountFixture = () => root.unmount();
          window.markdownJob = () => requestMarkdownPlan({content:'**Shared worker**', interactiveFileLinks:true, footnotePrefix:'test'}).result;
        `
        },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'worker',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, () => ({
                path: 'markdown',
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: `
            export default class extends Worker {
              constructor(){ super(new URL('markdown.js', document.baseURI)) }
              postMessage(data){
                window.postedJobs.push(data.kind);
                if(data.kind === 'references') window.lastReferenceInput = data;
                if(window.holdWorker) window.heldJobs.push(() => super.postMessage(data));
                else super.postMessage(data);
              }
            }`
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html><meta charset="utf-8">
        <style>svg{width:24px;height:24px;color:#ddd}body{background:#222}</style>
        <div id="root"></div><script src="fixture.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const errors = []
      const win = new BrowserWindow({
        show: true,
        width: 1000,
        height: 700,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const waitFor = async (condition) => {
        for (let i = 0; i < 200; i++) {
          if (await run(condition)) return
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error('Timed out: ' + condition + '\n' + errors.join('\n'))
      }
      await waitFor('window.references?.length === 300 && document.getAnimations().length === 60')
      assert.deepEqual(
        await run('[window.layoutQueries, window.layoutListeners]'),
        [1, 1],
        '500 responsive consumers must share one media query and browser listener'
      )
      win.setSize(650, 700)
      await waitFor(`document.querySelectorAll('[data-layout="compact"]').length === 500`)
      win.setSize(1000, 700)
      await waitFor(`document.querySelectorAll('[data-layout="wide"]').length === 500`)
      assert.deepEqual(await run('[window.layoutQueries, window.layoutListeners]'), [1, 1])
      assert.equal(
        await run('window.mainParses'),
        0,
        'Recents must not parse Markdown on the UI thread'
      )
      const writes = await run('window.pathWrites')
      const animated = await run(`(() => {
        const animations = document.getAnimations();
        for (const animation of animations) animation.pause();
        const paths = [...document.querySelectorAll('path')].slice(0,3);
        const sample = progress => {
          for(const animation of animations) animation.currentTime = Number(animation.effect.getTiming().duration) * progress;
          return paths.map(path => getComputedStyle(path).d);
        };
        return { start:sample(0), moved:sample(.65), end:sample(1), rules:paths.map(path=>path.getAttribute('fill-rule')) };
      })()`)
      assert.ok(
        animated.start.every((value, index) => value !== animated.moved[index]),
        'all three marks visibly change shape'
      )
      assert.deepEqual(
        animated.start,
        animated.end,
        'animation loops preserve the original geometry'
      )
      assert.deepEqual(
        animated.rules,
        ['evenodd', 'evenodd', 'evenodd'],
        'overlaps remain transparent'
      )
      await run('document.getAnimations().forEach(animation=>animation.play())')
      await new Promise((resolve) => setTimeout(resolve, 500))
      assert.equal(
        await run('window.pathWrites'),
        writes,
        '60 animated marks must perform zero per-frame SVG writes'
      )
      await run(
        `window.fakeHidden = true; Object.defineProperty(document, 'hidden', {configurable:true,get:()=>window.fakeHidden}); document.dispatchEvent(new Event('visibilitychange'))`
      )
      assert.equal(
        await run(`document.getAnimations().every(animation=>animation.playState==='paused')`),
        true
      )
      await run(`window.fakeHidden = false; document.dispatchEvent(new Event('visibilitychange'))`)
      assert.equal(
        await run(`document.getAnimations().every(animation=>animation.playState==='running')`),
        true
      )
      await run('renderFixture({speed:2})')
      assert.equal(await run('document.getAnimations()[0].effect.getTiming().duration'), 450)
      // A stream with unchanged links must not publish a fresh references array.
      await run('window.referenceIdentity = window.references')
      const jobs = await run('window.postedJobs.length')
      await run(
        `renderFixture({items:[{...items[0], content:items[0].content+'\\n\\nMore streamed text'}]})`
      )
      await waitFor(`window.postedJobs.length > ${jobs}`)
      await new Promise((resolve) => setTimeout(resolve, 250))
      assert.equal(
        await run('window.references === window.referenceIdentity'),
        true,
        'unchanged references must retain their array identity'
      )
      // Block one real worker request, replace the chat repeatedly, then release it.
      // The queue must discard all superseded snapshots and never show the old chat.
      await run(
        `window.holdWorker = true; renderFixture({chatKey:'old',items:[{type:'message',id:'old',role:'user',content:'[Old](/old.ts)'}]})`
      )
      await waitFor('window.heldJobs.length === 1')
      const posted = await run('window.postedJobs.length')
      for (let i = 0; i < 8; i++)
        await run(
          `renderFixture({chatKey:'new',items:[{type:'message',id:'new',role:'user',content:'[New ${i}](/new-${i}.ts)'}]})`
        )
      assert.deepEqual(
        await run('window.references'),
        [],
        "new chats must not expose another chat's references"
      )
      await run('window.holdWorker = false; window.heldJobs.splice(0).forEach(send=>send())')
      await waitFor(`window.references[0]?.path === '/new-7.ts'`)
      assert.equal(
        await run('window.postedJobs.length'),
        posted + 1,
        'only the latest queued revision should reach the worker'
      )
      assert.equal(await run('window.references[0].messageId'), 'new')
      const cachedJobs = await run('window.postedJobs.length')
      await run(`window.holdWorker=true;renderFixture({chatKey:'first-chat',items:window.items})`)
      assert.equal(await run('window.references.length'),300,'a warm chat restores its links in the selection render')
      await run('new Promise(resolve=>setTimeout(resolve,50))')
      assert.equal(await run('window.postedJobs.length'),cachedJobs,'warm navigation does not post another parser job')
      await run('window.holdWorker=false')
      await run(`renderFixture({items:[{type:'message',id:'image',role:'user',content:'',attachments:[
        {kind:'image',name:'Screenshot',path:'/shot.png',dataUrl:'data:image/png;base64,'+'A'.repeat(100000)}
      ]}]})`)
      await waitFor(`window.references[0]?.path === '/shot.png'`)
      assert.equal(
        await run(`'dataUrl' in window.lastReferenceInput.items[0].attachments[0]`),
        false,
        'image bytes must not cross into the reference worker'
      )
      assert.ok(
        JSON.stringify(await run('window.markdownJob()')).includes('Shared worker'),
        'references and Markdown share one functioning worker'
      )
      await run('renderFixture({limit:0})')
      await waitFor('window.references.length === 0')
      await win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await waitFor('document.getAnimations().length === 0')
      assert.equal(await run('window.mainParses'), 0)
      assert.deepEqual(errors, [])
      await run('window.unmountFixture()')
      assert.equal(
        await run('window.layoutListeners'),
        0,
        'the final consumer releases the listener'
      )
      assert.equal(await run('document.getAnimations().length'), 0)
      console.log(
        'Renderer performance checks passed: 500 responsive consumers with one listener, 60 marks without frame writes, reduced motion, visibility pause, worker parsing, chat isolation, and bounded streaming jobs.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
