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
            import { ChatDetailItem, ChatWorkingPlaceholder } from './src/renderer/src/components/ChatDetailItem'
            import { getChatItems, CodexTranscriptProjection } from './src/main/providers/codex/CodexItemRenderers'
            import { getConversationTailWorkingStep } from './src/renderer/src/chatConversationModel'
            import './src/renderer/src/assets/styles/tokens.css'
            window.testNow = 1700003665000
            Date.now = () => window.testNow
            const root = createRoot(document.getElementById('root'))
            const projection = new CodexTranscriptProjection()
            const initial = { id: 'turn', status: 'inProgress', startedAt: 1700000000, items: [
              { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Do the task' }] },
              { id: 'early', type: 'agentMessage', phase: 'final_answer', text: 'Earlier provisional response' },
              { id: 'work', type: 'commandExecution', command: 'echo checking', status: 'completed', aggregatedOutput: 'checked' }
            ] }
            window.renderTurn = (stage, collapseProgressOnFinish = true) => {
              const turn = { ...initial, status: stage === 'complete' ? 'completed' : 'inProgress', items: [
                ...initial.items.map(item => item.id === 'work' && stage === 'early' ? {...item, status: 'inProgress'} : item), ...(stage === 'early' ? [] : [stage === 'commentary' ? { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'Still checking' } : { id: 'final', type: 'agentMessage', phase: 'final_answer', startedAtMs: 1700003666000, text: stage === 'start' ? '' : 'Actual final response' }])
              ] }
              const items = getChatItems([turn], null, {}, projection)
              const working = getConversationTailWorkingStep(items)
              flushSync(() => root.render(<React.Fragment key={String(collapseProgressOnFinish)}>
                {items.map(item => <ChatDetailItem key={item.id} item={item} progressSettings={{expandProgressOnStart: true, collapseProgressOnFinish}} onLoadWorkingStep={() => { throw new Error('Unexpected working section fetch') }} />)}
                {working && <ChatWorkingPlaceholder item={working} />}
              </React.Fragment>))
            }
            window.renderTurn('early')
          `,
          resolveDir: path.resolve(__dirname, '../..'),
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
        `<!doctype html><html><head><link rel="stylesheet" href="test.css"><style>body{font:14px system-ui;margin:20px}#root{display:flex;flex-direction:column;gap:12px}</style></head><body><div id="root"></div><script>window.appApi={};window.providerApi=new Proxy({}, {get(){throw new Error('Unexpected provider fetch')}})</script><script src="test.js"></script></body></html>`
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
          `({standalone: [...document.querySelectorAll('.chat-detail__message--assistant')].map(e=>e.textContent.trim()), working: [...document.querySelectorAll('details')].map(e=>e.textContent.trim()), open: document.querySelector('details')?.open, label: document.querySelector('.chat-detail__working-label')?.textContent, placeholder: document.querySelectorAll('.chat-detail__tool-placeholder').length, elapsed: document.querySelector('.chat-detail__working-elapsed')?.textContent})`
        )
      let state = await inspect()
      assert.deepEqual(state.standalone, [])
      assert.ok(state.working.some((text) => text.includes('Earlier provisional response')))
      assert.equal(state.placeholder, 1)
      assert.equal(state.elapsed, ' · 1h 1m 5s')
      await run('window.testNow += 1000')
      await run('new Promise(resolve => setTimeout(resolve, 1100))')
      state = await inspect()
      assert.equal(state.elapsed, ' · 1h 1m 6s', 'only the local label clock needs to tick')
      await run("window.renderTurn('commentary')")
      state = await inspect()
      assert.equal(state.placeholder, 1, 'commentary must not hide the placeholder')
      assert.equal(state.open, true)
      await run("window.renderTurn('start')")
      state = await inspect()
      assert.equal(state.placeholder, 0, 'hide the placeholder at item start, before text')
      assert.equal(state.label, 'Worked · 1h 1m 6s')
      assert.equal(state.open, false)
      await run('window.testNow += 5000')
      await run("window.renderTurn('streaming')")
      state = await inspect()
      assert.deepEqual(state.standalone, ['Actual final response'])
      assert.equal(state.label, 'Worked · 1h 1m 6s', 'final text does not extend working time')
      assert.equal(state.placeholder, 0)
      assert.equal(state.open, false)
      await run("window.renderTurn('early', false)")
      await run("window.renderTurn('start', false)")
      state = await inspect()
      assert.equal(state.open, true, 'respect disabled auto-collapse at final start')
      assert.equal(state.label, 'Worked · 1h 1m 6s')
      assert.equal(state.placeholder, 0)
      await run("window.renderTurn('streaming', false)")
      state = await inspect()
      assert.equal(state.open, true)
      assert.deepEqual(state.standalone, ['Actual final response'])
      await run("window.renderTurn('complete')")
      state = await inspect()
      assert.deepEqual(state.standalone, ['Actual final response'])
      await run("document.querySelector('details > summary').click()")
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
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
