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
        stdin: {
          resolveDir: root,
          contents: `
            import {hydrateMermaidDiagrams} from './src/renderer/src/mermaidRendering'
            import {renderMarkdownCodeBlock} from './src/renderer/src/codeHighlighting'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            window.render = (source, scheme) => {
              document.documentElement.dataset.colorScheme = scheme
              document.getElementById('root').innerHTML = renderMarkdownCodeBlock(source, 'mermaid')
              hydrateMermaidDiagrams(document.getElementById('root'))
            }
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
        const text = await run(`document.querySelector('svg').textContent`)
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
      assert.deepEqual(errors, [])
      console.log(
        'Mermaid node, edge, subgraph and formatted labels render in both themes; unsafe content is removed.'
      )
    } catch (error) {
      console.error(error, errors)
      code = 1
    }
    app.exit(code)
  })
}
