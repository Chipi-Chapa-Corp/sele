const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-continue-reset-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx',
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {renderRootChatTurn} from './src/renderer/src/workspace/chatTurnRendering'
            const root = createRoot(document.getElementById('root'))
            const noop = () => {}
            window.calls = []
            const item = {type:'working', id:'failed', status:'failed', failureReason:'rateLimit',
              failureMessage:'OpenCode usage limit reached. Free usage exceeded, subscribe to Go', items:[]}
            const inputs = {
              itemIndexesById:new Map([['failed', 0]]), visibleChatItems:[item],
              followingWorkingStepsById:new Map(), workingStepIdsWithNextWorkingStep:new Set(),
              steeredWorkingStepDisclosureTargets:new Map(), subagentCompletions:{before:new Map(),after:new Map()},
              renderSubagentCompletion:noop, chatCommitMarkersByBeforeItemId:new Map(),
              chatCommitMarkersByAfterItemId:new Map(), trailingChatCommitMarkers:[], renderChatCommitMarker:noop,
              firstPendingChatItemId:null, scheduleChatAutoScroll:noop, continuedStoppedWorkingStepIds:new Set(),
              pinnedChatMessageIds:new Set(), stoppedTurnRetryMessages:new Map(), canRetryStoppedTurns:false,
              continuePrompt:'  Keep working.  ', availableRateLimitResets:0,
              onContinueStoppedTurn:async (id,prompt) => window.calls.push(['now',id,prompt]),
              onQueueLimitReset:async prompt => {
                window.calls.push(['queue',prompt])
                if(window.delay) await new Promise(resolve => window.finishQueue = resolve)
                if(window.fail) throw new Error('Queue unavailable')
              },
              limitResetsAt:Date.now() + 7200000
            }
            window.renderFixture = (changes={}, step={}) => {
              Object.assign(inputs,changes)
              inputs.visibleChatItems = [{...item,...step}]
              flushSync(() => root.render(<div key={inputs.motionChatKey}>{renderRootChatTurn(inputs,0,{id:'turn',items:inputs.visibleChatItems})}</div>))
            }
            window.renderFixture()
          `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'worker-fixture',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 30000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Continue on limit reset checks passed')) {
        throw new Error(result.stderr || String(result.error || 'Electron fixture failed'))
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { backgroundThrottling: false }
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) =>
        win.webContents.executeJavaScript(source).catch((error) => {
          throw new Error(source + ': ' + error.message)
        })
      const settle = () => run('new Promise(resolve => setTimeout(resolve,40))')
      const timedButton = `document.querySelector('[aria-label^="Continue in " ]')`
      const continueButton = `document.querySelector('[aria-label="Continue failed turn"]')`
      await settle()
      assert.equal(await run(`${timedButton}.textContent`), 'Continue in 2h')
      assert.equal(await run(`Boolean(${continueButton})`), true)

      // The timed action queues the configured continuation without sending it now.
      await run(`window.delay=true;${timedButton}.click();${timedButton}.click()`)
      await settle()
      assert.deepEqual(await run('window.calls'), [['queue', 'Keep working.']])
      assert.equal(await run(`${timedButton}.disabled`), true)
      await run('window.delay=false;window.finishQueue()')
      await settle()
      assert.match(
        await run('document.body.textContent'),
        /Continuation added to the On Limit Reset queue/
      )

      await run(`window.fail=true;${timedButton}.click()`)
      await settle()
      assert.match(await run('document.body.textContent'), /Queue unavailable/)
      assert.equal(await run(`${timedButton}.disabled`), false)

      // A new reset updates the memoized row. The button disappears at its deadline
      // without another chat update or waiting for the 30-second relative-date tick.
      await run('renderFixture({limitResetsAt:Date.now()+250})')
      assert.equal(await run(`Boolean(${timedButton})`), true)
      await run('new Promise(resolve => setTimeout(resolve,400))')
      assert.equal(await run(timedButton), null)
      assert.equal(await run(`Boolean(${continueButton})`), true)
      await run(`${continueButton}.click()`)
      await settle()
      assert.deepEqual(await run('window.calls.at(-1)'), ['now', 'failed', 'Keep working.'])

      // Fresh rows cover unknown reset times, unrelated failures, and disabled chats.
      await run('renderFixture({motionChatKey:"unknown",limitResetsAt:null})')
      assert.equal(await run(timedButton), null)
      await run(
        'renderFixture({motionChatKey:"ordinary",limitResetsAt:Date.now()+60000},{failureReason:undefined})'
      )
      assert.equal(await run(timedButton), null)
      await run('renderFixture({motionChatKey:"disabled",stoppedTurnActionDisabled:true})')
      assert.equal(await run(`${timedButton}.disabled`), true)
      await run(
        'renderFixture({motionChatKey:"blank",stoppedTurnActionDisabled:false,continuePrompt:"  "})'
      )
      assert.equal(await run(`${timedButton}.disabled`), true)
      console.log('Continue on limit reset checks passed.')
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
