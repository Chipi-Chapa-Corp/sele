const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-final-ui-'))
    try {
      const { renderOpenCodeChatItems } = await import(
        '../../src/main/providers/opencode/OpenCodeItemRenderers.ts'
      )
      const openCodeThoughtItems = Object.fromEntries(
        ['thinking', 'answer', 'finished'].map((stage) => {
          const completed = stage === 'finished'
          const items = renderOpenCodeChatItems(
            [
              {
                info: {
                  id: 'opencode-reply',
                  role: 'assistant',
                  finish: completed ? 'stop' : undefined,
                  time: {
                    created: 1700000000000,
                    ...(completed ? { completed: 1700000009000 } : {})
                  }
                },
                parts: [
                  ...(stage === 'thinking'
                    ? []
                    : [
                        { type: 'text', id: 'opencode-answer', text: 'Done so far: final answer.' }
                      ]),
                  {
                    type: 'reasoning',
                    id: 'opencode-thought',
                    text: 'Internal reasoning',
                    time: { start: 1700000000000, ...(completed ? { end: 1700000009000 } : {}) }
                  }
                ]
              }
            ],
            { active: !completed, stopped: false }
          )
          return [stage, items]
        })
      )
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatDetailItem, ChatWorkingPlaceholder } from './src/renderer/src/components/ChatDetailItem'
            import { getChatItems, CodexTranscriptProjection } from './src/main/providers/codex/CodexItemRenderers'
            import { buildChatConversationModel, getConversationTailWorkingStep } from './src/renderer/src/chatConversationModel'
            import { getWorkingStepProgressPolicy } from './src/renderer/src/workingStepDisclosure'
            import { ConversationMessagesContent } from './src/renderer/src/workspace/components/ConversationMessagesContent'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/workspace/styles/conversation-messages.css'
            import './src/renderer/src/workspace/styles/conversation-messages-shell.css'
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
            window.renderOpenCodeThought = (stage = 'thinking') => {
              const items = ${JSON.stringify(openCodeThoughtItems)}[stage]
              flushSync(() => root.render(<React.Fragment key="opencode-thought-fixture">
                {items.map(item => <ChatDetailItem key={item.id} item={item}
                  progressSettings={{expandProgressOnStart:true, collapseProgressOnFinish:true}} />)}
              </React.Fragment>))
            }
            window.renderSteeredTurn = (status, settings, nextTurn = false, finalStage = 'none') => {
              const items = getChatItems([{ id: 'steered', status, items: [
                { type: 'userMessage', id: 'initial', content: [{ type: 'text', text: 'Start' }] },
                { type: 'agentMessage', id: 'before', phase: 'commentary', text: 'First work' },
                { type: 'userMessage', id: 'steer-1', content: [{ type: 'text', text: 'Steer once' }] },
                { type: 'agentMessage', id: 'middle', phase: 'commentary', text: 'Middle work' },
                { type: 'userMessage', id: 'steer-2', content: [{ type: 'text', text: 'Steer twice' }] },
                { type: 'agentMessage', id: 'last', phase: 'commentary', text: 'Final work' },
                ...(finalStage === 'none' ? [] : [{ type: 'agentMessage', id: 'answer', phase: 'final_answer', text: finalStage === 'start' ? '' : 'Actual final response' }])
              ] }, ...(nextTurn ? [{ id: 'next', status: 'inProgress', items: [
                { type: 'userMessage', id: 'next-user', content: [{ type: 'text', text: 'Next turn' }] },
                { type: 'agentMessage', id: 'next-work', phase: 'commentary', text: 'Next work' }
              ] }] : [])])
              const model = buildChatConversationModel(items)
              flushSync(() => root.render(<React.Fragment key="steering">
                {model.turns.map((turn, index) => <React.Fragment key={turn.id}>
                  {turn.items.map(item => <ChatDetailItem key={item.id} item={item}
                    progressSettings={settings}
                    progressPolicy={item.type === 'working' ? getWorkingStepProgressPolicy(item, turn.items, model.turns[index + 1]?.items[0]) : undefined}
                    progressDisclosureTarget={model.steeredWorkingStepDisclosureTargets.get(item.id)}
                    hasNextWorkingStep={model.workingStepIdsWithNextWorkingStep.has(item.id)} />)}
                </React.Fragment>)}
              </React.Fragment>))
            }
            const handoffRefs = {
              contentRef: {current:null}, subagentContentRef: {current:null},
              chatSearchContentRef: {current:null}, chatAutoScrollEnabledRef: {current:false}
            }
            window.renderSteeringHandoff = (stage = 'pending') => {
              const echoed = ['echo', 'working', 'finished'].includes(stage)
              const items = [
                {type:'message', id:'handoff-user', role:'user', content:'Use cleaned HTML'},
                {type:'working', id:'handoff-before', status:'worked', startedAt:1700000000000,
                  completedAt:1700000092000, items:[{type:'message', content:'Checking the preview path'}]},
                ...(echoed ? [
                  {type:'message', id:'handoff-echo', role:'user', kind:'steering', label:'Steered with',
                    content:'Should search change too?\\n\\nAnswer: Keep cached text', createdAt:1700000092000},
                  ...(stage === 'echo' ? [] : [{type:'working', id:'handoff-after',
                    status:stage === 'finished' ? 'worked' : 'working',
                    items:[{type:'message', content:'Continuing with cached text search'}]}])
                ] : [{type:'pendingMessage', id:'handoff-pending', kind:stage === 'queued' ? 'queued' : 'steering',
                  content:'Should search change too?\\n\\nAnswer: Keep cached text', createdAt:1700000092000,
                  editable:stage === 'local' || stage === 'paused' || stage === 'queued'}])
              ]
              const model = buildChatConversationModel(items)
              flushSync(() => root.render(<ConversationMessagesContent key="steering-handoff"
                {...handoffRefs} selectedChat={{id:'handoff',providerId:'codex'}} selectedChatKey="codex:handoff"
                chatHasActiveTurn={!['finished','paused'].includes(stage)} chatKnown={true} chatLoadState="ready"
                chatMediaStartIndex={0} chatMediaTotalCount={model.turns.length} visibleChatItems={items}
                subagentVisibleChatItems={[]} subagentChatConversationModel={{turns:[]}}
                selectedChatCommitMarkers={[]} selectedChatSubagents={[]} renderedChatTurns={model.turns}
                effectiveChatTurnWindow={{startIndex:0}} scrollChatContentToBottom={() => {}}
                renderChatTurn={(_, turn) => <div className="chat-detail__turn">{turn.items.map(item =>
                  <ChatDetailItem key={item.id} item={item} onEditPendingMessage={() => {}}
                    progressDisclosureTarget={model.steeredWorkingStepDisclosureTargets.get(item.id)}
                    progressSettings={{expandProgressOnStart:true,collapseProgressOnFinish:true}} />
                )}</div>} />))
            }
            window.renderThought = (stage = 'thinking', unloaded = false) => {
              const thought = {type:'message', id:'thought', kind:'reasoning', status:stage === 'thinking' ? 'inProgress' : 'completed',
                content:unloaded ? '' : ('A **careful** thought with enough text to scroll.\\n\\n').repeat(80), contentLoaded:!unloaded}
              const item = {type:'working', id:'thought-work', status:stage === 'stopped' ? 'stopped' : stage === 'finished' ? 'worked' : 'working', items:[
                {type:'message', id:'ordinary', content:'Ordinary progress message'},
                {type:'tool', id:'thought-command', activity:'command', status:'finished', label:'Ran command',
                  toolId:'exec_command', command:'echo checked', stdout:'checked', diffs:[], images:[]}, thought
              ]}
              flushSync(() => root.render(<ChatDetailItem key="thought-fixture" item={item}
                onLoadWorkingItem={async () => {window.thoughtLoads = (window.thoughtLoads || 0) + 1; window.renderThought('finished')}}
                progressSettings={{expandProgressOnStart:true, collapseProgressOnFinish:false}} />))
            }
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
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
      const steeringSettings = {
        expandProgressOnStart: true,
        collapseProgressOnFinish: true,
        collapseProgressOnNextTurn: true,
        collapseStoppedSteeredFailedProgressOnFinish: true,
        collapseStoppedSteeredFailedProgressOnNextTurn: true
      }
      const renderSteering = (
        status,
        settings = steeringSettings,
        nextTurn = false,
        finalStage = 'none'
      ) =>
        run(
          `window.renderSteeredTurn(${JSON.stringify(status)}, ${JSON.stringify(settings)}, ${nextTurn}, ${JSON.stringify(finalStage)})`
        )
      const steeringOpenStates = () =>
        run(`[...document.querySelectorAll('details')].map(element => element.open).slice(0, 3)`)
      await renderSteering('inProgress')
      assert.deepEqual(
        await steeringOpenStates(),
        [true, true, true],
        'internal steers do not collapse earlier progress'
      )
      assert.deepEqual(
        await run(
          `[...document.querySelectorAll('.chat-detail__working-label')].map(e => e.textContent.trim())`
        ),
        ['Work so far', 'Work so far', 'Working'],
        'completed steering segments do not imply that the active chain is finished'
      )
      await renderSteering('completed')
      assert.deepEqual(
        await steeringOpenStates(),
        [false, false, false],
        'all blocks collapse when final work finishes'
      )
      const keepSteeredOpen = {
        ...steeringSettings,
        collapseStoppedSteeredFailedProgressOnFinish: false,
        collapseStoppedSteeredFailedProgressOnNextTurn: false
      }
      await renderSteering('inProgress', keepSteeredOpen)
      assert.deepEqual(await steeringOpenStates(), [true, true, true])
      await renderSteering('inProgress', keepSteeredOpen, false, 'start')
      assert.deepEqual(
        await steeringOpenStates(),
        [false, false, false],
        'regular finish collapse applies to the whole chain as the final answer starts'
      )
      await renderSteering('inProgress', keepSteeredOpen, false, 'streaming')
      assert.deepEqual(await steeringOpenStates(), [false, false, false])
      state = await inspect()
      assert.deepEqual(state.standalone, ['Actual final response'])
      await renderSteering('completed', keepSteeredOpen, false, 'streaming')
      assert.deepEqual(await steeringOpenStates(), [false, false, false])
      const keepOnFinish = {
        ...steeringSettings,
        collapseProgressOnFinish: false
      }
      await renderSteering('completed', keepOnFinish)
      assert.deepEqual(
        await steeringOpenStates(),
        [true, true, true],
        'all blocks stay open when finish collapse is off'
      )
      await renderSteering('completed', keepOnFinish, true)
      assert.deepEqual(
        await steeringOpenStates(),
        [false, false, false],
        'the next ordinary turn collapses the whole steering chain'
      )
      await renderSteering(
        'completed',
        { ...keepOnFinish, collapseProgressOnNextTurn: false },
        true
      )
      assert.deepEqual(
        await steeringOpenStates(),
        [true, true, true],
        'both disabled collapse settings preserve the whole chain'
      )
      await run('window.renderSteeringHandoff()')
      await run('new Promise(resolve => setTimeout(resolve, 250))')
      const handoffState = () =>
        run(`({
        waiting:document.querySelector('.chat-detail__pending-message-label')?.textContent,
        activity:[...document.querySelectorAll('[aria-label="Agent working"]')].map(e => e.textContent.trim()),
        edit:!!document.querySelector('[aria-label="Edit steering message"]'),
        beforePending:!!document.querySelector('.chat-detail__tool-placeholder')?.nextElementSibling?.querySelector('.chat-detail__message-block--pending')
      })`)
      assert.deepEqual(
        await handoffState(),
        {
          waiting: 'Steering',
          activity: ['Working… · 59m 39s'],
          edit: false,
          beforePending: true
        },
        'a delayed echo leaves clear activity before the waiting answer'
      )
      if (process.env.SELE_STEERING_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_STEERING_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run("window.renderSteeringHandoff('local')")
      assert.equal((await handoffState()).waiting, 'Steering')
      assert.equal((await handoffState()).edit, true)
      await run("window.renderSteeringHandoff('paused')")
      assert.deepEqual((await handoffState()).activity, [], 'restored paused steering stays idle')
      await run("window.renderSteeringHandoff('queued')")
      assert.equal((await handoffState()).waiting, 'Queue')
      assert.deepEqual(
        (await handoffState()).activity,
        [],
        'queue alone does not revive finished work'
      )
      await run("window.renderSteeringHandoff('echo')")
      assert.equal((await handoffState()).waiting, 'Steered with')
      assert.equal(
        (await handoffState()).activity.length,
        1,
        'activity survives the echo before output'
      )
      await run("window.renderSteeringHandoff('working')")
      assert.equal((await handoffState()).activity.length, 1, 'real activity replaces the fallback')
      assert.equal(
        await run(`document.querySelector('.chat-detail__working-label').textContent.trim()`),
        'Work so far · 1m 32s'
      )
      await run("window.renderSteeringHandoff('finished')")
      assert.deepEqual((await handoffState()).activity, [])
      assert.equal(
        await run(`document.querySelector('.chat-detail__working-label').textContent.trim()`),
        'Worked · 1m 32s'
      )
      const settle = () => run('new Promise(resolve => setTimeout(resolve, 80))')
      const thoughtState = () =>
        run(`(() => {
        const thought = document.querySelector('.chat-detail__thought')
        const body = thought.querySelector('.chat-detail__thought-content')
        return {label:thought.querySelector('summary').textContent.trim(), open:thought.open,
          scrollable:body ? body.scrollHeight > body.clientHeight && getComputedStyle(body).overflowY === 'auto' : false,
          markdown:!!body?.querySelector('strong'), ordinary:document.querySelector('.chat-detail__working-message')?.textContent.trim(),
          outerOpen:document.querySelector('.chat-detail__working').open}
      })()`)
      await run('window.renderThought()')
      await settle()
      let thought = await thoughtState()
      assert.equal(thought.label, 'Thinking')
      assert.equal(thought.open, false)
      assert.equal(thought.ordinary, 'Ordinary progress message')
      assert.deepEqual(
        await run(`(() => {
          const thought = document.querySelector('.chat-detail__thought')
          const command = document.querySelector('.chat-detail__tool-group:not(.chat-detail__thought)')
          const summary = thought.querySelector('summary')
          const commandSummary = command.querySelector('summary')
          return {
            border: getComputedStyle(thought).borderWidth,
            padding: getComputedStyle(summary).padding,
            sameHeight: summary.getBoundingClientRect().height === commandSummary.getBoundingClientRect().height,
            sameLabelOffset: summary.querySelector('.chat-detail__tool-label').getBoundingClientRect().x === commandSummary.querySelector('.chat-detail__tool-label').getBoundingClientRect().x,
            compactSummary: summary.getBoundingClientRect().width < thought.getBoundingClientRect().width
          }
        })()`),
        {
          border: '0px',
          padding: '0px',
          sameHeight: true,
          sameLabelOffset: true,
          compactSummary: true
        },
        'thoughts use the same compact, borderless disclosure row as commands'
      )
      if (process.env.SELE_THOUGHT_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_THOUGHT_SCREENSHOT.replace(/\.png$/, '-collapsed.png'),
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run("document.querySelector('.chat-detail__thought > summary').click()")
      await settle()
      thought = await thoughtState()
      assert.equal(thought.open, true)
      assert.equal(thought.outerOpen, true, 'nested disclosure preserves the working section')
      assert.equal(thought.scrollable, true, 'long thoughts scroll inside the bounded body')
      assert.equal(thought.markdown, true)
      await run("document.querySelector('.chat-detail__thought-content').scrollTop = 100")
      assert.ok(await run("document.querySelector('.chat-detail__thought-content').scrollTop > 0"))
      await run("window.renderThought('thought')")
      await settle()
      thought = await thoughtState()
      assert.equal(thought.label, 'Thought', 'reasoning finishes while the turn remains active')
      assert.equal(thought.open, true, 'completion preserves the chosen expansion')
      if (process.env.SELE_THOUGHT_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_THOUGHT_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run("document.querySelector('.chat-detail__thought > summary').click()")
      await settle()
      assert.equal((await thoughtState()).open, false)
      await run("window.renderThought('stopped')")
      await settle()
      assert.equal((await thoughtState()).label, 'Thought')
      await run("window.renderThought('finished', true)")
      await settle()
      await run("document.querySelector('.chat-detail__thought > summary').click()")
      await settle()
      await run(
        "document.querySelector('.chat-detail__thought .chat-detail__working-load').click()"
      )
      await settle()
      assert.equal(await run('window.thoughtLoads'), 1)
      assert.equal(
        (await thoughtState()).markdown,
        true,
        'lazy reasoning loads inside the disclosure'
      )
      await run('window.renderOpenCodeThought()')
      await settle()
      assert.equal(
        await run(
          "document.querySelector('.chat-detail__thought').closest('.chat-detail__working').open"
        ),
        true
      )
      await run("window.renderOpenCodeThought('answer')")
      await settle()
      await run("window.renderOpenCodeThought('finished')")
      await settle()
      assert.deepEqual(
        await run(`({
        open:document.querySelector('.chat-detail__working').open,
        thoughtVisible:!!document.querySelector('.chat-detail__thought'),
        answer:document.querySelector('.chat-detail__message--assistant')?.textContent.trim(),
        answerInsideWorked:!!document.querySelector('.chat-detail__working .chat-detail__message--assistant')
      })`),
        {
          open: false,
          thoughtVisible: false,
          answer: 'Done so far: final answer.',
          answerInsideWorked: false
        },
        'OpenCode completion hides Thought under collapsed Worked and keeps the answer outside it'
      )
      await run("document.querySelector('.chat-detail__working > summary').click()")
      await settle()
      assert.equal(
        await run("!!document.querySelector('.chat-detail__working .chat-detail__thought')"),
        true,
        'expanding Worked reveals its nested Thought disclosure'
      )
      await run("document.querySelector('.chat-detail__working > summary').click()")
      await settle()
      assert.equal(
        await run("!!document.querySelector('.chat-detail__thought')"),
        false,
        'collapsing Worked removes Thought from the visible transcript'
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
