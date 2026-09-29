const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const root = path.resolve(__dirname, '../..'),
  dir = path.join(root, 'test-results/chat-scroll-visual')
fs.mkdirSync(dir, { recursive: true })
process.chdir(root)
function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
}
function expression(file, name) {
  const src = parse(file)
  let value
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(src) === name)
      value = n.initializer.getText(src)
    ts.forEachChild(n, visit)
  }
  visit(src)
  return value
}
function effect() {
  const src = parse('src/renderer/src/workspace/useWorkspaceSelection.tsx')
  let value
  function visit(n) {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(src) === 'useEffect' &&
      n.arguments[0]?.getText(src).includes('const observer = new ResizeObserver')
    )
      value = n.arguments[0].getText(src)
    ts.forEachChild(n, visit)
  }
  visit(src)
  return value
}
if (!process.versions.electron) {
  ;(async () => {
    const generated = `import {useEffect} from 'react';window.makeInteraction=(dependencies)=>{const {contentRef,chatTurnWindowRef,chatScrollAdjustmentTargetRef,previousChatScrollTopRef,chatTurnScrollDirectionRef,setChatAtConversationBottom,chatViewportAnchorRef,chatAutoScrollEnabledRef,chatUserScrollIntentRef,chatAutoScrollTargetRef,scheduleChatAutoScroll,chatUserScrollIntentFrameRef,chatDetail}=dependencies;const handleChatContentScroll=${expression('src/renderer/src/workspace/useChatInteractionController.tsx', 'handleChatContentScroll')};const handleChatContentWheel=${expression('src/renderer/src/workspace/useChatInteractionController.tsx', 'handleChatContentWheel')};return {handleChatContentScroll,handleChatContentWheel}};window.useResize=(dependencies)=>{const {selectedChatKey,contentRef,chatAutoScrollEnabledRef,scrollChatContentToBottom,chatViewportAnchorRef,pendingChatScrollAnchorRef,chatScrollAdjustmentTargetRef}=dependencies;useEffect(${effect()},[selectedChatKey,scrollChatContentToBottom])};`
    fs.writeFileSync(path.join(dir, 'generated.ts'), generated)
    await require('esbuild').build({
      stdin: {
        contents: `import './test-results/chat-scroll-visual/generated';import './scripts/tests/fixtures/chat-scroll-visual'`,
        resolveDir: root,
        loader: 'tsx'
      },
      plugins: [
        {
          name: 'workers',
          setup(b) {
            b.onResolve({ filter: /\?worker$/ }, (a) => ({ path: a.path, namespace: 'worker' }))
            b.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
              contents: 'export default class {}'
            }))
          }
        }
      ],
      bundle: true,
      jsx: 'automatic',
      loader: { '.ttf': 'file' },
      outfile: path.join(dir, 'app.js')
    })
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      '<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="app.css"><style>body{margin:0;background:#181818;color:#ddd}#root{height:100vh}</style><div id="root"></div><script>window.appApi={};window.providerApi={}</script><script src="app.js"></script></html>'
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const p = require('node:child_process').spawnSync(
      require('electron'),
      [__filename, '--no-sandbox'],
      { env, encoding: 'utf8', timeout: 120000 }
    )
    process.stdout.write(p.stdout || '')
    if (p.status !== 0) {
      process.stderr.write(p.stderr || String(p.error))
      process.exitCode = 1
    }
  })().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        show: true,
        width: 1100,
        height: 850,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (d) => {
        if (d.level === 'error') console.error(d.message)
      })
      await win.loadFile(path.join(dir, 'index.html'))
      fs.writeFileSync(path.join(dir, 'progress.log'), 'loaded\n')
      const run = (s) => win.webContents.executeJavaScript(s)
      const wait = async () =>
        run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      win.webContents.debugger.attach('1.3')
      const wheel = async (deltaY) => {
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 550,
          y: 400,
          deltaX: 0,
          deltaY
        })
        await wait()
      }
      const capture = async (name) => {
        fs.writeFileSync(
          path.join(dir, name + '.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        return run('inspect()')
      }
      const results = {}
      const assert = require('node:assert/strict')
      const sameViewport = (before, after, label) => {
        const ids = new Set(before.visible.map((x) => x.id))
        assert.deepEqual(
          after.visible.filter((x) => ids.has(x.id)).map((x) => x.id),
          before.visible.map((x) => x.id),
          label + ' preserved message order'
        )
        before.visible.forEach((item) =>
          assert.ok(
            Math.abs(item.top - after.visible.find((x) => x.id === item.id).top) <= 1,
            label + ' position ' + item.id
          )
        )
      }
      for (const provider of ['claude', 'codex']) {
        await run(`openProvider('${provider}')`)
        await wait()
        results[provider] = { pages: [] }
        for (const direction of ['older', 'older', 'older', 'newer', 'newer']) {
          let iterations = 0
          while (!(await run('!!window.pendingPage')) && iterations++ < 65)
            await wheel(direction === 'older' ? -400 : 400)
          assert.ok(
            await run('!!window.pendingPage'),
            provider + ' reaches ' + direction + ' boundary'
          )
          const name = provider + '-' + results[provider].pages.length + '-' + direction
          const before = await capture(name + '-before')
          await run('startFrames()')
          await run('release()')
          await wait()
          const after = await capture(name + '-after')
          await run('new Promise(r=>setTimeout(r,200))')
          const frames = await run('stopFrames()')
          sameViewport(before, after, name)
          for (const frame of frames) sameViewport(before, frame, name + ' frame')
          assert.equal(after.requests, before.requests, name + ' no unsolicited page load')
          results[provider].pages.push({ name, before, after, frames })
          if (direction === 'older') {
            await run('applyLive()')
            await wait()
            const live = await capture(name + '-live')
            sameViewport(after, live, name + ' live update')
            results[provider].pages.at(-1).live = live
          }
        }
        // Reverse scrolling while a response is in flight, then release that response.
        await run(`openProvider('${provider}')`)
        await wait()
        while (!(await run('!!window.pendingPage'))) await wheel(-400)
        await wheel(800)
        const before = await capture(provider + '-delayed-before')
        await run('release()')
        await wait()
        const after = await capture(provider + '-delayed-after')
        sameViewport(before, after, provider + ' delayed response')
        results[provider].delayed = { before, after }
        // Real Markdown blocks and the production ResizeObserver.
        await run(`openProvider('${provider}')`)
        await wait()
        await run('prepareResize()')
        let offset = await run('targetOffset()')
        for (let attempt = 0; Math.abs(offset) > 1 && attempt < 10; attempt++) {
          await wheel(offset)
          offset = await run('targetOffset()')
        }
        const resizeBefore = await capture(provider + '-resize-before')
        const targetBefore = await run('targetOffset()')
        await run('growContent()')
        await wait()
        const resizeAfter = await capture(provider + '-resize-after')
        const targetAfter = await run('targetOffset()')
        assert.ok(
          Math.abs(targetBefore - targetAfter) <= 1,
          provider + ' keeps visible paragraph stable'
        )
        results[provider].resize = {
          before: resizeBefore,
          after: resizeAfter,
          targetBefore,
          targetAfter
        }
      }
      fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2))
      console.log(
        'Visual scrolling checks passed: 10 page transitions with every-frame position checks, delayed response reversals, and Markdown resizing. Screenshots: ' +
          dir
      )
      app.exit(0)
    } catch (e) {
      console.error(e)
      app.exit(1)
    }
  })
}
