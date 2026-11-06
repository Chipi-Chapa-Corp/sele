// Real Mermaid hydration in a disposable Electron profile; run on isolated-gui.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-mermaid-'))
    try {
      await require('esbuild').build({
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        stdin: {
          resolveDir: root,
          loader: 'tsx',
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {MarkdownContent} from './src/renderer/src/components/MarkdownContent'
            import {renderMarkdownCodeBlock} from './src/renderer/src/codeHighlighting'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            const root = createRoot(document.getElementById('root'))
            window.render = (source, scheme) => {
              document.documentElement.dataset.colorScheme = scheme
              flushSync(() => root.render(<MarkdownContent key={scheme} html={renderMarkdownCodeBlock(source, 'mermaid')} />))
            }
            window.diagramZoom = () => {
              const svg = document.querySelector('.markdown-mermaid__canvas > svg')
              return Math.round(svg.getBoundingClientRect().width / svg.viewBox.baseVal.width * 100)
            }
            window.unmount = () => flushSync(() => root.unmount())
          `
        },
        outfile: path.join(directory, 'fixture.js'),
        loader: { '.ttf': 'dataurl' }
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<html><link rel="stylesheet" href="fixture.css"><style>body{margin:20px}#root{max-width:850px}</style><div class="chat-detail__message-markdown" id="root"></div><script src="fixture.js"></script></html>'
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
        width: 950,
        height: 800,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') errors.push(event.message)
      })
      await win.loadFile(path.join(directory, 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const render = async (source, scheme) => {
        await run(`render(${JSON.stringify(source)}, ${JSON.stringify(scheme)})`)
        await run(`new Promise((resolve, reject) => {
          const end = performance.now() + 15000
          function check() {
            const state = document.querySelector('[data-mermaid-diagram]')?.dataset.mermaidHydration
            if (state === 'rendered') return requestAnimationFrame(() => requestAnimationFrame(resolve))
            if (state === 'error' || performance.now() > end) return reject(new Error('Mermaid hydration: ' + state))
            setTimeout(check, 20)
          }
          check()
        })`)
      }
      const source = `flowchart TD
        A[Session coordinator] -->|dispatch| B[Document worker]
        A --> C[Preview worker]
        subgraph Storage
          D[Document state]
          E[Preview state]
        end
        B <--> D
        C <--> E`
      for (const scheme of ['dark', 'light']) {
        await render(source, scheme)
        const labels =
          await run(`Array.from(document.querySelectorAll('svg foreignObject'), node => ({
          text: node.textContent.trim(),
          width: node.firstElementChild?.getBoundingClientRect().width ?? 0,
          height: node.firstElementChild?.getBoundingClientRect().height ?? 0,
          color: node.firstElementChild && getComputedStyle(node.firstElementChild).color
        }))`)
        for (const label of [
          'Session coordinator',
          'Document worker',
          'Preview worker',
          'Document state',
          'Preview state',
          'dispatch',
          'Storage'
        ]) {
          assert.ok(
            labels.some((node) => node.text === label && node.width > 0 && node.height > 0),
            `${scheme}: missing visible label ${label}: ${JSON.stringify(labels)}`
          )
        }
        assert.ok(labels.every((node) => node.color !== 'rgba(0, 0, 0, 0)'))
        assert.equal(
          await run(`document.querySelector('[data-mermaid-diagram]').hasAttribute('aria-busy')`),
          false
        )
        const screenshot = path.resolve(__dirname, `../../test-results/mermaid-${scheme}.png`)
        await fs.mkdir(path.dirname(screenshot), { recursive: true })
        await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG())
      }
      await render(
        'flowchart LR\nA["First line<br/>Second line"] --> B["<b>Bold label</b>"]',
        'dark'
      )
      assert.equal(await run(`document.querySelectorAll('svg foreignObject br').length`), 1)
      assert.equal(
        await run(`document.querySelector('svg foreignObject b')?.textContent`),
        'Bold label'
      )
      await render(
        'flowchart LR\nA["<img src=x onerror=window.mermaidInjected=true>"] --> B[Safe]',
        'dark'
      )
      assert.equal(await run('window.mermaidInjected === true'), false)
      assert.equal(
        await run(`document.querySelector('svg [onerror], svg script, svg iframe') !== null`),
        false
      )
      for (const scheme of ['dark', 'light']) {
        await render(
          `sequenceDiagram
          participant S as Session
          participant W as Worker
          S->>W: Render document
          Note over W: Prepare preview
          W-->>S: Preview ready`,
          scheme
        )
        const text = await run(
          `document.querySelector('.markdown-mermaid__canvas > svg').textContent`
        )
        for (const label of [
          'Session',
          'Worker',
          'Render document',
          'Prepare preview',
          'Preview ready'
        ]) {
          assert.ok(text.includes(label), `${scheme}: missing sequence label ${label}`)
        }
        const screenshot = path.resolve(
          __dirname,
          `../../test-results/mermaid-sequence-${scheme}.png`
        )
        await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG())
      }
      // A long horizontal diagram must keep readable labels rather than shrink
      // to the chat width. Exercise the actual hydrated controls and native modal.
      const wide = `flowchart LR\n${Array.from({ length: 14 }, (_, i) => `N${i}[Stage ${i}: keyboard animation]`).join(' --> ')}`
      const key = async (keyCode, modifiers = []) => {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        if (keyCode === 'Enter')
          win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
      }
      for (const scheme of ['dark', 'light']) {
        await render(wide, scheme)
        assert.ok(
          await run(`(() => {
          const viewport = document.querySelector('.markdown-mermaid__viewport')
          const svg = viewport.querySelector('.markdown-mermaid__canvas > svg')
          const label = svg.querySelector('.node foreignObject')
          window.originalDiagram = svg
          return viewport.scrollWidth > viewport.clientWidth * 2 &&
            svg.getBoundingClientRect().width >= svg.viewBox.baseVal.width &&
            label.getBoundingClientRect().height >= 12 &&
            document.documentElement.scrollWidth === document.documentElement.clientWidth
        })()`),
          `${scheme}: wide diagram should scroll without shrinking or widening the page`
        )
        await run(`document.querySelector('[aria-label="Expand diagram"]').focus()`)
        await key('Enter')
        assert.equal(await run(`document.querySelector('.resizable-lightbox').open`), true)
        assert.equal(
          await run(`document.querySelectorAll('.markdown-mermaid__canvas > svg').length`),
          1
        )
        assert.equal(
          await run(
            `document.querySelector('.resizable-lightbox .markdown-mermaid__canvas > svg') === window.originalDiagram`
          ),
          true
        )
        assert.equal(await run(`window.diagramZoom()`), 100)
        assert.equal(
          await run(`document.activeElement.getAttribute('aria-label')`),
          'Close expanded diagram'
        )
        await key('Tab')
        assert.equal(
          await run(
            `document.querySelector('.resizable-lightbox').contains(document.activeElement)`
          ),
          true
        )
        const originalWidth = await run(`window.originalDiagram.getBoundingClientRect().width`)
        await run(`document.querySelector('[aria-label="Zoom in"]').click()`)
        assert.ok(
          (await run(`window.originalDiagram.getBoundingClientRect().width`)) > originalWidth
        )
        await run(`document.querySelector('[aria-label="Fit diagram"]').click()`)
        assert.ok(
          await run(`(() => {
          const viewport = document.querySelector('.markdown-mermaid--expanded .markdown-mermaid__viewport')
          return viewport.scrollWidth <= viewport.clientWidth && viewport.scrollHeight <= viewport.clientHeight
        })()`),
          `${scheme}: Fit should show the entire diagram`
        )
        await run(`document.querySelector('[aria-label="Actual size"]').click()`)
        assert.equal(await run(`window.diagramZoom()`), 100)
        await run(`document.querySelector('[aria-label="Zoom out"]').click()`)
        assert.equal(await run(`window.diagramZoom()`), 80)
        await run(`document.querySelector('[aria-label="Actual size"]').click()`)
        assert.equal(await run(`window.diagramZoom()`), 100)
        await run(
          `document.querySelector('.markdown-mermaid--expanded .markdown-mermaid__viewport').scrollLeft = 500`
        )
        assert.ok(
          (await run(
            `document.querySelector('.markdown-mermaid--expanded .markdown-mermaid__viewport').scrollLeft`
          )) > 0
        )
        const screenshot = path.resolve(
          __dirname,
          `../../test-results/mermaid-expanded-${scheme}.png`
        )
        await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG())
        await key('Escape')
        assert.equal(await run(`document.querySelector('.resizable-lightbox').open`), false)
        assert.equal(
          await run(
            `document.querySelector('.markdown-mermaid__viewport svg') === window.originalDiagram`
          ),
          true
        )
        assert.equal(
          await run(
            `document.activeElement === document.querySelector('[aria-label="Expand diagram"]') || document.activeElement === document.querySelector('.markdown-mermaid__viewport')`
          ),
          true
        )
        await run(`document.querySelector('[aria-label="Expand diagram"]').focus()`)
        await key('Enter')
        await run(`document.querySelector('[aria-label="Close expanded diagram"]').click()`)
        await run('new Promise(resolve => requestAnimationFrame(resolve))')
        assert.equal(await run(`document.querySelector('.resizable-lightbox').open`), false)
        await run(`document.querySelector('[aria-label="Expand diagram"]').click()`)
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          x: 1,
          y: 1,
          button: 'left',
          clickCount: 1
        })
        win.webContents.sendInputEvent({
          type: 'mouseUp',
          x: 1,
          y: 1,
          button: 'left',
          clickCount: 1
        })
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        assert.equal(await run(`document.querySelector('.resizable-lightbox').open`), false)
      }
      win.setSize(400, 700)
      await render(wide, 'dark')
      await run(`document.querySelector('[aria-label="Expand diagram"]').click()`)
      await run(`document.querySelector('[aria-label="Fit diagram"]').click()`)
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      assert.equal(await run(`document.querySelector('.resizable-lightbox').open`), true)
      assert.ok(
        await run(`(() => {
        const dialog = document.querySelector('.resizable-lightbox')
        const controls = dialog.querySelector('.resizable-lightbox__actions')
        const rect = dialog.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth &&
          controls.scrollWidth <= controls.clientWidth && dialog.scrollHeight <= dialog.clientHeight
      })()`),
        'Preview and all controls should fit a narrow window'
      )
      await fs.writeFile(
        path.resolve(__dirname, '../../test-results/mermaid-expanded-mobile.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      await run(`window.unmount()`)
      assert.equal(await run(`document.querySelector('dialog[open]') !== null`), false)
      assert.deepEqual(errors, [])
      console.log(
        'Mermaid labels render safely in both themes; wide diagrams stay readable, expand, zoom, fit, scroll and close on desktop and narrow windows.'
      )
    } catch (error) {
      console.error(error, errors)
      code = 1
    }
    app.exit(code)
  })
}
