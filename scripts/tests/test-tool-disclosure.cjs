const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')

if (!process.versions.electron) {
  const { build } = require('esbuild')
  const { spawnSync } = require('node:child_process')
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-tools-test-'))
    try {
      await build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import { groupWorkingItemsForRenderer } from './src/main/providers/workingStepLazy'
            const root = createRoot(document.getElementById('root'))
            window.renderStep = (items, status = 'working') => flushSync(() => root.render(
              <ChatDetailItem item={{type: 'working', id: 'step', status, items: groupWorkingItemsForRenderer(items)}} />
            ))
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        outfile: path.join(directory, 'fixture.js'),
        jsx: 'automatic',
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' },
        plugins: [
          {
            name: 'unused-workers',
            setup(builder) {
              builder.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              builder.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(require('electron'), [__filename, directory, '--no-sandbox'], {
        env,
        encoding: 'utf8',
        timeout: 30000
      })
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
  app
    .whenReady()
    .then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      await window.loadFile(path.join(process.argv[2], 'index.html'))
      const result = await window.webContents.executeJavaScript(`(async () => {
      const settle = () => new Promise(resolve => setTimeout(resolve, 30))
      const tool = (id, activity = 'search', status = 'running') => ({
        type: 'tool', id, activity, status, label: activity === 'read' ? 'Read file' : 'Searched files',
        toolId: id, command: 'rg needle src', stdout: 'match', diffs: [], images: []
      })
      const state = () => ({
        wrapper: !!document.querySelector('details.chat-detail__working'),
        sequence: document.querySelector('.chat-detail__tool-sequence')?.open,
        tools: [...document.querySelectorAll('.chat-detail__tool-group')].map(el => el.open),
        text: document.body.textContent
      })
      const snapshots = []
      renderStep([]); await settle(); snapshots.push(state())
      renderStep([tool('one')]); await settle(); snapshots.push(state())
      renderStep([tool('one', 'read', 'finished'), tool('two')]); await settle(); snapshots.push(state())
      renderStep([tool('one', 'read', 'finished'), tool('two', 'search', 'finished')]); await settle(); snapshots.push(state())
      renderStep([tool('one'), tool('two'), {type: 'message', id: 'text', content: 'Next action'}]); await settle(); snapshots.push(state())
      renderStep([tool('one'), tool('two'), {type: 'message', id: 'text', content: 'Next action'}, tool('three'), tool('four')]); await settle(); snapshots.push(state())
      const last = [...document.querySelectorAll('.chat-detail__tool-sequence')].at(-1)
      const latestOpen = last.open && last.querySelectorAll('.chat-detail__tool-group')[1].open
      last.querySelector('summary').click(); await settle()
      const manuallyClosed = !last.open
      renderStep([tool('one'), tool('two'), {type: 'message', id: 'text', content: 'Next action'}, tool('three'), tool('four', 'search', 'finished')]); await settle()
      const stayedClosed = !last.open
      renderStep([]); await settle(); snapshots.push(state())
      renderStep([
        {...tool('fetch', 'other', 'finished'), label: 'Fetched https://example.test', summaryLabel: 'Fetched web pages'},
        {...tool('plugin', 'other', 'finished'), label: 'Used mcp__example__run'}
      ]); await settle()
      const namedHeading = document.querySelector('.chat-detail__tool-sequence > summary').textContent
      if (!document.querySelector('.chat-detail__tool-sequence').open) {
        document.querySelector('.chat-detail__tool-sequence > summary').click(); await settle()
      }
      const namedRows = document.body.textContent
      renderStep([{
        ...tool('grep', 'search', 'finished'), label: 'Searched for quota', command: null,
        rawInput: {pattern: 'quota', path: '/repo'}, rawOutput: 'match'
      }]); await settle()
      const searchDetails = document.body.textContent
      renderStep([{
        ...tool('edit', 'edit', 'finished'), label: 'Edited file.ts', command: null, diffs: [],
        rawInput: {filePath: '/repo/file.ts', oldString: 'before', newString: 'after'}, rawOutput: 'Edit applied'
      }]); await settle()
      const editDetails = document.body.textContent
      return { snapshots, latestOpen, manuallyClosed, stayedClosed, namedHeading, namedRows, searchDetails, editDetails }
    })()`)
      const [empty, single, grouped, waiting, following, , emptyAgain] = result.snapshots
      assert.equal(empty.wrapper, true)
      assert.deepEqual(single.tools, [true])
      assert.equal(grouped.sequence, true)
      assert.deepEqual(grouped.tools, [true])
      assert.match(grouped.text, /Reading files, Searching/)
      assert.equal(waiting.sequence, true)
      assert.deepEqual(waiting.tools, [true])
      assert.equal(following.sequence, false)
      assert.equal(result.latestOpen, true)
      assert.equal(result.manuallyClosed, true)
      assert.equal(result.stayedClosed, true)
      assert.equal(emptyAgain.wrapper, true)
      assert.equal(result.namedHeading, 'Fetched web pages, Used mcp__example__run')
      assert.match(result.namedRows, /Fetched https:\/\/example.test/)
      assert.match(result.namedRows, /Used mcp__example__run/)
      assert.doesNotMatch(result.namedRows, /Used tools/)
      assert.match(result.searchDetails, /pattern/)
      assert.match(result.searchDetails, /quota/)
      assert.match(result.editDetails, /oldString/)
      assert.match(result.editDetails, /before/)
      console.log('Tool disclosure transitions and named fallbacks passed in Electron.')
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
