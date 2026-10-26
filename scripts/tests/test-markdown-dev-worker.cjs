// Exercise Vite's real development transforms; an esbuild or production bundle
// cannot catch React Refresh being injected into a worker's TSX dependencies.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-markdown-dev-'))
    let server
    try {
      const { loadConfigFromFile } = await import('electron-vite')
      const { createServer } = await import('vite')
      const { config } = await loadConfigFromFile(
        { command: 'serve', mode: 'development' },
        path.join(root, 'electron.vite.config.ts')
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<html><body><script type="module">
          import MarkdownWorker from '/@fs/${root}/src/renderer/src/chatMarkdown.worker.ts?worker'
          window.renderMarkdown = content => new Promise((resolve, reject) => {
            const worker = new MarkdownWorker()
            const timeout = setTimeout(() => finish(new Error('Markdown worker timed out')), 15000)
            function finish(error, plan) {
              clearTimeout(timeout)
              worker.terminate()
              if (error) reject(error)
              else resolve(plan)
            }
            worker.onerror = event => finish(new Error(event.message || 'Development worker failed to load'))
            worker.onmessage = ({data}) => finish(data.error ? new Error(data.error) : null, data.plan)
            worker.postMessage({id: 1, content, interactiveFileLinks: true, footnotePrefix: 'dev-'})
          })
        </script></body></html>`
      )
      server = await createServer({
        ...config.renderer,
        configFile: false,
        root: path.join(root, 'src/renderer'),
        cacheDir: path.join(directory, 'node_modules/.vite'),
        optimizeDeps: {
          entries: [path.join(directory, 'index.html')],
          include: [
            'marked',
            'marked-footnote',
            'react-dom/server',
            'lucide-react',
            '@react-symbols/icons/utils',
            'refractor',
            'refractor/jsx',
            'refractor/tsx'
          ]
        },
        server: { host: '127.0.0.1', port: 0, fs: { allow: [root, directory] } }
      })
      await server.listen()
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = require('node:child_process').spawn(
        require('electron'),
        [
          __filename,
          directory,
          server.resolvedUrls.local[0] + '@fs/' + directory + '/index.html',
          '--no-sandbox'
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      )
      child.stdout.pipe(process.stdout)
      child.stderr.pipe(process.stderr)
      const status = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
      assert.equal(status, 0, 'development Markdown worker check failed')
    } finally {
      await server?.close()
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
    let status = 0
    try {
      const win = new BrowserWindow({ show: false })
      await win.loadURL(process.argv[3])
      const content =
        '# Encounter behaviour\n\n' +
        '| Mob | Character |\n| --- | --- |\n' +
        Array.from(
          { length: 80 },
          (_, index) =>
            `| **Rat ${index}** | Searches remembered positions before returning home. |`
        ).join('\n') +
        '\n\n[Source](/fixture/enemies.ts:12)\n\n```ts\nconst ready = true\n```\n'
      assert.ok(content.length > 4096)
      const plan = await win.webContents.executeJavaScript(
        `window.renderMarkdown(${JSON.stringify(content)})`
      )
      const html = plan
        .map(function flatten(node) {
          return 'html' in node
            ? node.html
            : node.opening + node.children.map(flatten).join('') + '</' + node.tag + '>'
        })
        .join('')
      assert.match(html, /<h1>Encounter behaviour<\/h1>/)
      assert.equal((html.match(/<tr>/g) ?? []).length, 81)
      assert.match(html, /<strong>Rat 79<\/strong>/)
      assert.match(html, /data-file-link-path="\/fixture\/enemies.ts"/)
      assert.match(html, /class="token keyword"/)
      console.log(
        'Vite development worker renders tables, emphasis, file icons and highlighted code'
      )
    } catch (error) {
      console.error(error)
      status = 1
    }
    app.exit(status)
  })
}
