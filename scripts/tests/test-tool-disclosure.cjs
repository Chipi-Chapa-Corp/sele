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
            import { getChatItems } from './src/main/providers/codex/CodexItemRenderers'
            const root = createRoot(document.getElementById('root'))
            window.renderStep = (items, status = 'working', extra = {}) => flushSync(() => root.render(
              <ChatDetailItem item={{type: 'working', id: 'step', status, items: groupWorkingItemsForRenderer(items), ...extra}} />
            ))
            window.renderItems = (items, props = {}) => flushSync(() => root.render(
              items.map(item => <ChatDetailItem key={item.id} item={item} {...props} />)
            ))
            window.renderCodexItems = turns => window.renderItems(getChatItems(turns))
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
      const thought = id => ({type: 'message', kind: 'reasoning', id, content: 'Reasoning ' + id})
      const rows = Array.from({length: 50}, (_, i) => thought('thought-' + i))
      rows[48] = tool('retained-tool', 'command', 'finished')
      renderStep(rows); await settle()
      const retainedThought = document.querySelectorAll('.chat-detail__thought')[20]
      const retainedTool = document.querySelector('[data-working-motion-id="retained-tool"] details')
      retainedThought.querySelector('summary').click()
      retainedTool.querySelector('summary').click(); await settle()
      renderStep([...rows, thought('appended')]); await settle()
      const tailRetained = {
        thought: retainedThought.isConnected && retainedThought.open,
        tool: retainedTool.isConnected && retainedTool.open
      }
      renderStep([tool('single-to-group', 'command', 'finished'), thought('separator')]); await settle()
      document.querySelector('[data-working-motion-id="single-to-group"] summary').click(); await settle()
      renderStep([tool('single-to-group', 'command', 'finished'), tool('group-new'), thought('separator')]); await settle()
      const promotedSequence = document.querySelector('.chat-detail__tool-sequence')
      const promotedToolOpen = promotedSequence.open && promotedSequence.querySelector('.chat-detail__tool-group').open
      const progress = document.querySelector('details.chat-detail__working')
      progress.querySelector('summary').click(); await settle()
      progress.querySelector('summary').click(); await settle()
      const restoredToolOpen = document.querySelector('.chat-detail__tool-sequence .chat-detail__tool-group').open
      document.querySelector('.chat-detail__tool-sequence .chat-detail__tool-group > summary').click(); await settle()
      renderStep([tool('single-to-group', 'command', 'finished'), tool('group-new'), thought('separator'), thought('later')]); await settle()
      const innerCloseKeptSequenceOpen = document.querySelector('.chat-detail__tool-sequence').open && !document.querySelector('.chat-detail__tool-sequence .chat-detail__tool-group').open

      let messageReads = 0
      const historyMessage = {type: 'message', id: 'history', role: 'assistant', content: 'Previous answer', get attachments() {messageReads++; return []}}
      const oldStep = {type: 'working', id: 'old-step', status: 'worked', items: [thought('old-thought')]}
      renderItems([historyMessage, oldStep]); await settle()
      const oldProgress = document.querySelector('details.chat-detail__working')
      oldProgress.querySelector('summary').click(); await settle()
      const oldThought = document.querySelector('.chat-detail__thought')
      oldThought.querySelector('summary').click(); await settle()
      renderItems([historyMessage, oldStep, {type: 'message', id: 'next-message', role: 'user', content: 'Next'}, {type: 'working', id: 'next-step', status: 'working', items: []}], {hasNextWorkingStep: true}); await settle()
      const nextTurnRetained = oldProgress.isConnected && oldProgress.open && oldThought.isConnected && oldThought.open
      // Repeat an append with identical historical props to exercise the row memo.
      const beforeAppendReads = messageReads
      renderItems([historyMessage, oldStep, {type: 'message', id: 'another-message', role: 'user', content: 'Another'}], {hasNextWorkingStep: true}); await settle()
      const historySkippedRender = messageReads === beforeAppendReads
      const appReadStates = []
      for (const status of ['inProgress', 'completed']) {
        renderCodexItems([{
          id: 'app-turn', status, items: [{
            id: 'github-read', type: 'mcpToolCall', server: 'codex_apps', tool: 'github.fetch_file', status,
            arguments: { repository_full_name: 'aunetx/blur-my-shell', path: 'src/styles/popup/base.css' },
            result: { structuredContent: { content: 'private-file-output' } }
          }]
        }]); await settle()
        const progress = document.querySelector('details.chat-detail__working')
        if (!progress.open) { progress.querySelector('summary').click(); await settle() }
        const row = document.querySelector('.chat-detail__tool-read')
        appReadStates.push({
          text: row?.textContent,
          fileIcon: !!row?.querySelector(status === 'inProgress' ? '.chat-detail__animated-icon svg' : '.lucide-file-text'),
          disclosures: document.querySelectorAll('.chat-detail__tool-group').length,
          body: document.body.textContent
        })
      }
      const appActionStates = []
      for (const [name, finished, active] of [
        ['github.create_issue', 'Created issue in GitHub', 'Creating issue in GitHub'],
        ['pets.select_pet', 'Selected pet in ChatGPT Pets', 'Selecting pet in ChatGPT Pets'],
        ['plugin_management.update_app_permissions', 'Updated app permissions in Plugin Management', 'Updating app permissions in Plugin Management']
      ]) {
        for (const status of ['inProgress', 'completed']) {
          renderCodexItems([{
            id: 'app-action-turn', status, items: [{
              id: name, type: 'mcpToolCall', server: 'codex_apps', tool: name, status,
              arguments: { title: 'private-app-input' }, result: 'private-app-output'
            }]
          }]); await settle()
          const progress = document.querySelector('details.chat-detail__working')
          if (!progress.open) { progress.querySelector('summary').click(); await settle() }
          const row = document.querySelector('.chat-detail__tool-read')
          appActionStates.push({
            text: row?.textContent, expected: status === 'inProgress' ? active : finished,
            appIcon: !!row?.querySelector(status === 'inProgress' ? '.chat-detail__animated-icon svg' : '.lucide-blocks'),
            disclosures: document.querySelectorAll('.chat-detail__tool-group').length,
            body: document.body.textContent
          })
        }
      }
      const timeIconStates = []
      for (const status of ['inProgress', 'completed']) {
        for (const call of [
          {type: 'sleep', durationMs: 1000},
          {type: 'collabAgentToolCall', tool: 'wait'}
        ]) {
          renderCodexItems([{id: 'time-turn', status, items: [{id: 'time-call', status, ...call}]}]); await settle()
          const progress = document.querySelector('details.chat-detail__working')
          if (!progress.open) { progress.querySelector('summary').click(); await settle() }
          const row = document.querySelector('.chat-detail__tool-read')
          timeIconStates.push({
            label: row?.textContent,
            expected: (status === 'inProgress' ? 'Waiting' : 'Waited') + (call.type === 'sleep' ? ' 1s' : ' for subagent'),
            clock: !!row?.querySelector(status === 'inProgress' ? '.chat-detail__animated-icon svg' : '.lucide-clock'),
            generic: !!row?.querySelector('.lucide-wrench, .lucide-bot')
          })
        }
      }
      renderCodexItems([{
        id: 'unknown-app-turn', status: 'completed', items: [{
          id: 'unknown-app-call', type: 'mcpToolCall', server: 'codex_apps', tool: 'github.frobnicate_widget',
          arguments: { title: 'unknown-app-input' }, result: 'unknown-app-output'
        }]
      }]); await settle()
      const fallbackProgress = document.querySelector('details.chat-detail__working')
      if (!fallbackProgress.open) { fallbackProgress.querySelector('summary').click(); await settle() }
      const fallbackDetails = document.querySelector('.chat-detail__tool-group')
      if (!fallbackDetails.open) { fallbackDetails.querySelector('summary').click(); await settle() }
      const appFallback = document.body.textContent
      const failureMessage = 'Error running remote compact task: Selected model is at capacity.'
      const emptyTerminalStates = []
      for (const status of ['failed', 'stopped', 'worked']) {
        for (const items of [[], [{type: 'message', id: 'blank', content: '  \\n '}]]) {
          renderStep(items, status, {failureMessage}); await settle()
          emptyTerminalStates.push({
            status,
            disclosure: !!document.querySelector('details.chat-detail__working'),
            chevron: !!document.querySelector('.chat-detail__working .chat-detail__summary-chevron')
          })
        }
      }
      renderCodexItems([{id: 'compact-failure', status: 'failed', error: {message: failureMessage}, items: [
        {type: 'userMessage', id: 'failed-prompt', content: [{type: 'text', text: 'Do the task'}]}
      ]}]); await settle()
      const failedWithoutActivity = {
        disclosure: !!document.querySelector('details.chat-detail__working'),
        chevron: !!document.querySelector('.chat-detail__working .chat-detail__summary-chevron'),
        error: document.querySelector('.chat-detail__failure-label')?.textContent
      }
      renderStep([tool('failed-command', 'command', 'finished')], 'failed', {failureMessage}); await settle()
      let failedProgress = document.querySelector('details.chat-detail__working')
      const failedInitiallyClosed = !failedProgress.open
      failedProgress.querySelector('summary').click(); await settle()
      const failedActivityOpened = failedProgress.open && !!failedProgress.querySelector('.chat-detail__tool-group')
      failedProgress.querySelector('summary').click(); await settle()
      const failedActivityClosed = !failedProgress.open
      const lazyFailure = {type: 'working', id: 'lazy-failure', status: 'failed', failureMessage, items: [], itemsLoaded: false, itemCount: 1}
      let failureLoads = 0
      renderItems([lazyFailure], {onLoadWorkingStep: async () => {
        failureLoads++
        renderItems([{...lazyFailure, itemsLoaded: true, items: [tool('loaded-command', 'command', 'finished')]}])
      }}); await settle()
      document.querySelector('.chat-detail__working-load').click(); await settle()
      failedProgress = document.querySelector('details.chat-detail__working')
      const lazyFailedActivityOpened = failureLoads === 1 && failedProgress?.open && !!failedProgress.querySelector('.chat-detail__tool-group')
      return { snapshots, latestOpen, manuallyClosed, stayedClosed, namedHeading, namedRows, searchDetails, editDetails, tailRetained, promotedToolOpen, restoredToolOpen, innerCloseKeptSequenceOpen, nextTurnRetained, historySkippedRender, appReadStates, appActionStates, timeIconStates, appFallback, emptyTerminalStates, failedWithoutActivity, failedInitiallyClosed, failedActivityOpened, failedActivityClosed, lazyFailedActivityOpened }
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
      for (const [index, state] of result.appReadStates.entries()) {
        assert.equal(state.text, index === 0 ? 'Reading file from GitHub' : 'Read file from GitHub')
        assert.equal(state.fileIcon, true)
        assert.equal(state.disclosures, 0)
        assert.doesNotMatch(
          state.body,
          /codex_apps|repository_full_name|private-file-output|base\.css/
        )
      }
      for (const state of result.appActionStates) {
        assert.equal(state.text, state.expected)
        assert.equal(state.appIcon, true)
        assert.equal(state.disclosures, 0)
        assert.doesNotMatch(state.body, /codex_apps|private-app-input|private-app-output/)
      }
      for (const state of result.timeIconStates) {
        assert.equal(state.label, state.expected)
        assert.equal(state.clock, true)
        assert.equal(state.generic, false)
      }
      assert.match(result.appFallback, /Used GitHub: frobnicate widget/)
      assert.match(result.appFallback, /unknown-app-input/)
      assert.match(result.appFallback, /unknown-app-output/)
      for (const state of result.emptyTerminalStates) {
        assert.equal(state.disclosure, false, state.status + ' with no content has no disclosure')
        assert.equal(state.chevron, false, state.status + ' with no content has no chevron')
      }
      assert.deepEqual(result.failedWithoutActivity, {
        disclosure: false,
        chevron: false,
        error: 'Error running remote compact task: Selected model is at capacity.'
      })
      assert.equal(result.failedInitiallyClosed, true)
      assert.equal(result.failedActivityOpened, true)
      assert.equal(result.failedActivityClosed, true)
      assert.equal(result.lazyFailedActivityOpened, true)
      assert.equal(result.namedHeading, 'Fetched web pages, Used mcp__example__run')
      assert.match(result.namedRows, /Fetched https:\/\/example.test/)
      assert.match(result.namedRows, /Used mcp__example__run/)
      assert.doesNotMatch(result.namedRows, /Used tools/)
      assert.match(result.searchDetails, /pattern/)
      assert.match(result.searchDetails, /quota/)
      assert.match(result.editDetails, /oldString/)
      assert.match(result.editDetails, /before/)
      assert.deepEqual(
        result.tailRetained,
        { thought: true, tool: true },
        'appending past the activity window must retain existing DOM and disclosures'
      )
      assert.equal(
        result.promotedToolOpen,
        true,
        'grouping a manually opened tool must preserve its disclosure'
      )
      assert.equal(
        result.restoredToolOpen,
        true,
        'closing and reopening progress preserves child disclosures'
      )
      assert.equal(
        result.innerCloseKeptSequenceOpen,
        true,
        'tool and sequence manual choices stay independent'
      )
      assert.equal(
        result.nextTurnRetained,
        true,
        'new turns preserve expanded history when collapse on next turn is disabled'
      )
      assert.equal(
        result.historySkippedRender,
        true,
        'appending a message skips unchanged historical item renders'
      )
      console.log('Tool disclosure transitions and named fallbacks passed in Electron.')
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
