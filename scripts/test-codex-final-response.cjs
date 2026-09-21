const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-final-ui-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import { getChatItems, CodexTranscriptProjection } from './src/main/providers/codex/CodexItemRenderers'
            import './src/renderer/src/assets/styles/tokens.css'
            const root = createRoot(document.getElementById('root'))
            const projection = new CodexTranscriptProjection()
            const initial = { id: 'turn', status: 'inProgress', items: [
              { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Do the task' }] },
              { id: 'early', type: 'agentMessage', phase: 'final_answer', text: 'Earlier provisional response' },
              { id: 'work', type: 'commandExecution', command: 'echo checking', status: 'completed', aggregatedOutput: 'checked' }
            ] }
            window.renderTurn = (stage) => {
              const turn = { ...initial, status: stage === 'complete' ? 'completed' : 'inProgress', items: [
                ...initial.items, ...(stage === 'early' ? [] : [{ id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Actual final response' }])
              ] }
              const items = getChatItems([turn], null, {}, projection)
              flushSync(() => root.render(<>{items.map(item => <ChatDetailItem key={item.id} item={item} />)}</>))
            }
            window.renderTurn('early')
          `,
          resolveDir: path.resolve(__dirname, '..'),
          loader: 'tsx'
        },
        plugins: [
          {
            name: 'unused-editor-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents:
                  'export default class { constructor() { throw new Error("Editor workers are outside this message-rendering test") } }',
                loader: 'js'
              }))
            }
          }
        ],
        bundle: true,
        loader: { '.ttf': 'file' },
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'test.js')
      })
      await fs.writeFile(
        path.join(directory, 'test.html'),
        `<!doctype html><html><head><link rel="stylesheet" href="test.css"><style>body{font:14px system-ui;margin:20px}#root{display:flex;flex-direction:column;gap:12px}</style></head><body><div id="root"></div><script>window.appApi={};window.providerApi={}</script><script src="test.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Final response UI checks passed'))
        throw new Error(result.stderr || String(result.error || 'UI check failed'))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      await win.loadFile(path.join(process.argv[2], 'test.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const inspect = () =>
        run(
          `({standalone: [...document.querySelectorAll('.chat-detail__message--assistant')].map(e=>e.textContent.trim()), working: [...document.querySelectorAll('details')].map(e=>e.textContent.trim())})`
        )
      let state = await inspect()
      assert.deepEqual(state.standalone, [])
      assert.ok(state.working.some((text) => text.includes('Earlier provisional response')))
      await run("window.renderTurn('streaming')")
      state = await inspect()
      assert.deepEqual(state.standalone, [])
      assert.ok(state.working.some((text) => text.includes('Actual final response')))
      await run("window.renderTurn('complete')")
      state = await inspect()
      assert.deepEqual(state.standalone, ['Actual final response'])
      await run("document.querySelector('details > summary').click()")
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      state = await inspect()
      assert.ok(state.working.some((text) => text.includes('Earlier provisional response')))
      assert.ok(state.working.every((text) => !text.includes('Actual final response')))
      assert.equal(
        await run(`(() => {
        document.querySelectorAll('details').forEach(e => e.open = false)
        const final = document.querySelector('.chat-detail__message--assistant')
        const work = document.querySelector('details')
        return !final.closest('details') && final.getBoundingClientRect().top >= work.getBoundingClientRect().bottom
      })()`),
        true
      )
      console.log('Final response UI checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
