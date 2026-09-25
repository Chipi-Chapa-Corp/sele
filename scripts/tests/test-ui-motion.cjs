const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-motion-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { AnimatePresence, MotionConfig } from 'motion/react'
            import { ChatList } from './src/renderer/src/components/ChatList'
            import { Dropdown } from './src/renderer/src/components/Dropdown'
            import { SegmentedControl } from './src/renderer/src/components/SegmentedControl'
            import { CwdNotesButton } from './src/renderer/src/components/CwdNotesButton'
            import { ChatDetailItem, MarkdownMessage } from './src/renderer/src/components/ChatDetailItem'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import { ComposerPlaceholder } from './src/renderer/src/components/ComposerPlaceholder'
            import { MotionSurface } from './src/renderer/src/motion/MotionSurface'
            import { captureMessageFlight } from './src/renderer/src/motion/messageFlight'
            import './src/renderer/src/App.css'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/components/MessageBox.css'
            const noop = () => {}
            const root = createRoot(document.getElementById('root'))
            window.state = { ids: ['a', 'b', 'c'], tab: 'a', notes: [], modal: false,
              content: 'Existing text', streaming: true, empty: true, users: [], realComposer:false, working:null }
            const chats = ['a', 'b', 'c'].map(id => ({ id, providerId: 'codex', title: 'Conversation ' + id,
              createdAt: Date.now(), updatedAt: Date.now(), cwd: '/project', status: null }))
            window.tool = n => ({ type:'tool', id:'tool-'+n, toolId:'read', status:'finished', activity:'read',
              icon:null, label:'Read file '+n, command:null, cwd:null, stdout:null, diffs:[],
              backgroundSessionId:null, finishedBackgroundSessionId:null, rawInput:null, rawOutput:null, images:[] })
            window.workingPage = (count, start = count-50) => ({type:'working',id:'working',status:'working',
              itemCount:count,itemsStartIndex:start,items:Array.from({length:50},(_,i)=>window.tool(start+i))})
            window.groupPage = (count, start = count-50) => ({type:'working',id:'grouped',status:'working',
              itemCount:1,items:[{type:'toolGroup',id:'group',label:'Read files',toolCount:count,
                toolsStartIndex:start,tools:Array.from({length:50},(_,i)=>window.tool(start+i))}]})
            window.renderFixture = (patch = {}) => {
              Object.assign(window.state, patch)
              const s = window.state
              flushSync(() => root.render(<React.StrictMode><MotionConfig reducedMotion="user">
                <main style={{display:'grid',gridTemplateColumns:'260px 1fr',gap:24,padding:24,height:600}}>
                  <aside><ChatList chats={s.ids.map(id => chats.find(c => c.id === id))}
                    selectedChatKey={null} onMarkDone={c => window.renderFixture({ids:s.ids.filter(id=>id!==c.id)})}
                    onRename={noop} onResolveApproval={noop} onSelect={noop} onTogglePinned={noop}/></aside>
                  <div className="chat-panel">
                    <SegmentedControl aria-label="Test tabs" options={[{value:'a',label:'First'},{value:'b',label:'Second'}]}
                      value={s.tab} onChange={tab=>window.renderFixture({tab})}/>
                    <div style={{display:'flex',gap:12,margin:'20px 0'}}>
                      <Dropdown id="test-dropdown" aria-label="Test menu" value="a" options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]} onChange={noop}/>
                      <CwdNotesButton label="Project" notes={s.notes} onNotesChange={notes=>window.renderFixture({notes})}/>
                    </div>
                    <div className="chat-detail__messages" style={{height:320,flex:'none',overflow:'auto'}}>
                      <MarkdownMessage className="chat-detail__message" content={s.content} streaming={s.streaming}/>
                      {s.working && <ChatDetailItem key={s.working.id} item={s.working}/>}
                      {s.users.map(item=><ChatDetailItem key={item.id} item={item} motionChatKey="codex:chat"/>)}
                    </div>
                    {s.realComposer ? <MessageBox draftScopeKey="codex:chat" draftProjectKey="project"
                      providerId="codex" model="test" models={[{id:'test', label:'Test', description:'Test model', isDefault:true,
                        supportedReasoningEfforts:[{id:'low',label:'Low',description:'Low effort'},{id:'high',label:'High',description:'High effort'}],defaultReasoningEffort:'low'},
                        {id:'other',label:'Other',description:'Other model',supportedReasoningEfforts:[],defaultReasoningEffort:'low'}]}
                      agentMode="default" agentModes={[]} approvalMode="on-request" approvalModes={[]}
                      sandboxMode="workspace-write" sandboxModes={[]} reasoningEffort="low" serviceTier={null}
                      accountUsage={null} accountUsageError={null} accountUsageState="idle"
                      contextUsage={{source:'unavailable', usedTokens:null, maxTokens:null}} displayUsage="context"
                      onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                      onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                      onSend={content=>{ window.renderFixture({users:[{type:'message',id:'composer',role:'user',content,createdAt:Date.now()}]});return true }}/>
                    : <div className="message-box"><div className="message-box__textarea-wrap">
                      <ComposerPlaceholder scope="new-chat:test" empty={s.empty}/>
                      <textarea id="source" placeholder="Use @ for files and $ for skills" onChange={()=>window.renderFixture({empty:false})}/>
                    </div></div>}
                    <AnimatePresence>{s.modal && <MotionSurface motionKind="overlay" className="settings-overlay">
                      <section role="dialog" aria-label="Test modal" className="settings-dialog">Modal</section>
                    </MotionSurface>}</AnimatePresence>
                  </div>
                </main>
              </MotionConfig></React.StrictMode>))
            }
            window.sendFixture = (id, content, cancel = false, kind = null) => {
              const dispose = captureMessageFlight(document.getElementById('source'), content, 'codex:chat')
              if (cancel) dispose()
              const item = kind ? {id, type:'pendingMessage', kind, content, createdAt:Date.now()} :
                {id, type:'message', role:'user', content, createdAt:Date.now()}
              window.renderFixture({users:[...window.state.users, item]})
            }
            window.renderFixture()
          `,
          loader: 'tsx',
          resolveDir: path.resolve(__dirname, '../..')
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl' },
        define: { 'process.env.NODE_ENV': '"development"' },
        outfile: path.join(directory, 'fixture.js'),
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
                  'export default class { constructor() { throw new Error("Editor workers are outside this motion test") } }',
                loader: 'js'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Motion checks passed')) {
        process.stderr.write(result.stderr || String(result.error || 'Electron check failed'))
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
  app.whenReady().then(async () => {
    let code = 0
    try {
      const errors = []
      const win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 800,
        webPreferences: { offscreen: true, backgroundThrottling: false }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const wait = (ms) => run(`new Promise(resolve => setTimeout(resolve, ${ms}))`)
      const frames = () =>
        run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await wait(600)
      assert.equal(
        await run(`document.querySelector('.composer-placeholder').textContent`),
        'Use @ for files and $ for skills'
      )
      await run(`document.getElementById('source').focus()`)
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'char',
        text: 'x'
      })
      assert.equal(await run(`document.querySelector('.composer-placeholder') === null`), true)
      await run(`window.renderFixture({empty:true})`)
      assert.equal(
        await run(`document.querySelector('.composer-placeholder').textContent`),
        'Use @ for files and $ for skills',
        'clearing a draft must not replay the hint'
      )
      // Retain an exiting row, but immediately remove it from interaction.
      await run(`window.renderFixture({ids:['b','c']})`)
      assert.equal(
        await run(`document.querySelector('[data-chat-id="a"]').closest('[inert]') !== null`),
        true
      )
      await wait(300)
      assert.equal(await run(`document.querySelector('[data-chat-id="a"]')`), null)
      await run(`window.renderFixture({ids:['a','b','c'], tab:'b'})`)
      await wait(300)
      assert.equal(
        await run(`document.querySelectorAll('.ui-segmented-control__indicator').length`),
        1
      )
      // Portal exits survive the trigger's conditional; reopening must not retain duplicates.
      await run(`document.getElementById('test-dropdown').click()`)
      await wait(200)
      await run(`document.getElementById('test-dropdown').click()`)
      assert.equal(
        await run(`document.querySelector('[role="listbox"]').closest('[inert]') !== null`),
        true
      )
      await run(`document.getElementById('test-dropdown').click()`)
      await wait(250)
      assert.equal(await run(`document.querySelectorAll('[role="listbox"]').length`), 1)
      assert.equal(
        await run(`document.querySelector('[role="listbox"]').closest('[inert]') === null`),
        true
      )
      await run(`document.getElementById('test-dropdown').click()`)
      await wait(250)
      assert.equal(await run(`document.querySelector('[role="listbox"]')`), null)
      await run(`document.querySelector('[aria-label="Project notes"]').click()`)
      await frames()
      assert.equal(
        await run(`document.activeElement.getAttribute('aria-label')`),
        'Add note to Project'
      )
      await win.webContents.debugger.sendCommand('Input.insertText', { text: 'A note' })
      await run(`document.querySelector('[aria-label="Add note"]').click()`)
      assert.equal(await run(`window.state.notes.length`), 1)
      await run(`document.querySelector('[aria-label="Project notes"]').click()`)
      await wait(250)
      // The renderer adds a newline after a paragraph; appending within it must still reveal only the tail.
      await run(`window.renderFixture({content:'Existing text and **new words**.'})`)
      await wait(45)
      const revealed = await run(
        `Array.from(document.querySelectorAll('[data-stream-reveal]'), n=>n.textContent).join('')`
      )
      assert.ok(revealed.includes('new words'), 'new Markdown text fades in')
      assert.ok(!revealed.includes('Existing text'), 'existing Markdown text stays stable')
      const streamGeometry = () =>
        run(`(() => {
        const source=document.querySelector('.chat-detail__message-markdown');
        const clone=source.cloneNode(true);
        clone.style.cssText='position:absolute;visibility:hidden;width:'+source.getBoundingClientRect().width+'px';
        source.parentElement.append(clone);
        const animated=clone.getBoundingClientRect().height;
        clone.querySelectorAll('[data-stream-reveal]').forEach(span=>span.replaceWith(...span.childNodes));
        const plain=clone.getBoundingClientRect().height;
        clone.remove();
        return {animated,plain};
      })()`)
      const paragraphGeometry = await streamGeometry()
      assert.equal(
        paragraphGeometry.animated,
        paragraphGeometry.plain,
        'stream reveal must not change paragraph geometry'
      )
      await wait(500)
      assert.equal(await run(`document.querySelectorAll('[data-stream-reveal]').length`), 0)
      await run(`window.renderFixture({content:'Replacement text', streaming:false})`)
      assert.equal(
        await run(`document.querySelectorAll('[data-stream-reveal]').length`),
        0,
        'replacement text does not replay old content'
      )
      // Fast chunks must preserve the earlier reveal's age across innerHTML replacements.
      await run(`window.renderFixture({content:'Prefix.',streaming:true})`)
      await frames()
      await run(`window.renderFixture({content:'Prefix. Alpha.'})`)
      await wait(60)
      const alphaOpacity = () =>
        run(
          `Number(getComputedStyle(Array.from(document.querySelectorAll('[data-stream-reveal]')).find(n=>n.textContent.includes('Alpha'))).opacity)`
        )
      const initialAlpha = await alphaOpacity()
      await run(`window.renderFixture({content:'Prefix. Alpha. Beta.'})`)
      await wait(60)
      const continuedAlpha = await alphaOpacity()
      assert.ok(
        continuedAlpha > initialAlpha && continuedAlpha < 0.98,
        'the existing fade continues instead of restarting or becoming instantly opaque'
      )
      const betaOpacity = await run(
        `Number(getComputedStyle(Array.from(document.querySelectorAll('[data-stream-reveal]')).find(n=>n.textContent.includes('Beta'))).opacity)`
      )
      assert.ok(betaOpacity < continuedAlpha, 'the newest chunk has its own reveal time')
      // Finishing a response should let its remaining visual reveal finish naturally.
      await run(`window.renderFixture({streaming:false})`)
      await frames()
      assert.ok((await alphaOpacity()) < 1)
      await wait(450)
      assert.equal(await run(`document.querySelectorAll('[data-stream-reveal]').length`), 0)
      const markdownSamples = [
        ['Paragraph.', 'Paragraph. ' + 'Additional words across wrapped lines. '.repeat(25)],
        ['- First item', '- First item\n- Second item\n- Third item'],
        [
          '## Heading',
          '## Heading\n\nParagraph with **bold**, _italic_ and a [link](https://example.com).'
        ],
        ['> Quoted text', '> Quoted text\n> with another line.'],
        ['~~~js\nconst first = 1;\n', '~~~js\nconst first = 1;\nconst second = 2;\n~~~'],
        [
          '| A | B |\n|---|---|\n| one | two |',
          '| A | B |\n|---|---|\n| one | two |\n| three | four |'
        ]
      ]
      for (const [before, after] of markdownSamples) {
        await run(`window.renderFixture({content:${JSON.stringify(before)},streaming:true})`)
        await wait(100)
        await run(`window.renderFixture({content:${JSON.stringify(after)}})`)
        // The existing Markdown buffer may flush a partial block after 180ms.
        await wait(250)
        const during = await streamGeometry()
        assert.equal(
          during.animated,
          during.plain,
          'rich Markdown geometry is unchanged: ' + before
        )
        const viewportGeometry = () =>
          run(`(() => {
          const viewport=document.querySelector('.chat-detail__messages');
          return {height:document.querySelector('.chat-detail__message-markdown').getBoundingClientRect().height,
            scrollHeight:viewport.scrollHeight,scrollTop:viewport.scrollTop};
        })()`)
        await run(
          `(() => {const viewport=document.querySelector('.chat-detail__messages');viewport.scrollTop=viewport.scrollHeight})()`
        )
        const duringReveal = await viewportGeometry()
        await wait(450)
        assert.deepEqual(
          await viewportGeometry(),
          duringReveal,
          'finishing a reveal never changes message height or scroll position: ' + before
        )
      }
      await run(`window.renderFixture({content:'Replacement text',streaming:false})`)
      await frames()
      for (const [id, kind] of [
        ['send', null],
        ['queued', 'queued'],
        ['steering', 'steering']
      ]) {
        await run(
          `window.sendFixture(${JSON.stringify(id)}, ${JSON.stringify('Message ' + id)}, false, ${JSON.stringify(kind)})`
        )
        await frames()
        assert.equal(
          await run(`document.querySelectorAll('.message-flight').length`),
          1,
          id +
            ' gets a temporary visual copy: ' +
            (await run(
              `JSON.stringify({hidden:document.hidden, rect:document.querySelector('[data-motion-message-id]').getBoundingClientRect(), view:document.querySelector('.chat-detail__messages').getBoundingClientRect()})`
            ))
        )
        await wait(450)
        assert.equal(
          await run(`document.querySelectorAll('.message-flight').length`),
          0,
          'flight cleans up'
        )
      }
      await run(
        `window.renderFixture({users:[]}); window.sendFixture('optimistic','Persistent send'); window.flightNode=document.querySelector('.message-flight')`
      )
      await frames()
      await run(`window.flightNode=document.querySelector('.message-flight')`)
      await wait(65)
      const midflight = await run(
        `(() => { const g=document.querySelector('.message-flight');return {opacity:getComputedStyle(g).opacity, y:g.getBoundingClientRect().y, source:document.getElementById('source').getBoundingClientRect().y, target:document.querySelector('[data-motion-message-id] .chat-detail__message--user').getBoundingClientRect().y} })()`
      )
      assert.equal(Number(midflight.opacity), 1, 'the travelling message stays visible')
      assert.ok(
        midflight.y < midflight.source - 5 && midflight.y > midflight.target + 5,
        'the message visibly travels between input and destination'
      )
      if (process.env.SELE_MOTION_SCREENSHOT)
        await fs.writeFile(
          '/tmp/sele-motion-send.png',
          (await win.webContents.capturePage()).toPNG()
        )
      await run(
        `window.renderFixture({users:[{...window.state.users[0],id:'provider-confirmed'}]})`
      )
      await frames()
      assert.equal(
        await run(`document.querySelector('.message-flight')===window.flightNode`),
        true,
        'provider reconciliation preserves the moving copy'
      )
      assert.equal(
        await run(
          `getComputedStyle(document.querySelector('[data-motion-message-id="provider-confirmed"]')).opacity`
        ),
        '0',
        'confirmed row stays hidden until landing'
      )
      await wait(450)
      assert.equal(await run(`document.querySelector('.message-flight')`), null)
      assert.equal(
        await run(
          `getComputedStyle(document.querySelector('[data-motion-message-id="provider-confirmed"]')).opacity`
        ),
        '1'
      )
      await run(`window.renderFixture({users:[],realComposer:true})`)
      await frames()
      await run(`document.querySelector('textarea').focus()`)
      await win.webContents.debugger.sendCommand('Input.insertText', {
        text: 'From the real composer'
      })
      await run(`document.querySelector('[aria-label="Send message"]').click()`)
      await frames()
      assert.equal(
        await run(`document.querySelectorAll('.message-flight').length`),
        1,
        'the actual composer starts the flight'
      )
      await wait(450)
      await run(`document.querySelector('.message-box__chat-config-trigger').click()`)
      await wait(220)
      for (const section of ['Reasoning', 'Model']) {
        await run(
          `Array.from(document.querySelectorAll('.message-box__chat-config-section-button')).find(b=>b.textContent==='${section}').click()`
        )
        await frames()
        assert.equal(
          await run(`document.querySelector('[data-menu-page]').dataset.menuPage`),
          section.toLowerCase()
        )
        assert.ok(
          await run(
            `Number(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-menu-page]')).transform).m41)>0`
          ),
          'forward navigation slides in from the right'
        )
        if (section === 'Model') {
          assert.equal(
            await run(`document.activeElement.getAttribute('aria-label')`),
            'Search models'
          )
          await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Other' })
          assert.equal(
            await run(`document.activeElement.value`),
            'Other',
            'search is usable during the transition'
          )
        }
        await wait(240)
        assert.equal(
          await run(
            `document.querySelector('.menu-page-transition').offsetHeight === document.querySelector('[data-menu-page]').offsetHeight`
          ),
          true,
          'the settled menu returns to natural height after filtering'
        )
        if (section === 'Model' && process.env.SELE_MOTION_SCREENSHOT)
          await fs.writeFile(
            '/tmp/sele-motion-model.png',
            (await win.webContents.capturePage()).toPNG()
          )
        await run(`document.querySelector('.message-box__chat-config-back').click()`)
        await frames()
        assert.ok(
          await run(
            `Number(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-menu-page]')).transform).m41)<0`
          ),
          'Back slides in from the left'
        )
        await wait(240)
      }
      await run(
        `document.querySelector('.message-box__chat-config-trigger').click(); window.renderFixture({realComposer:false,users:[]})`
      )
      await wait(220)
      await run(`window.sendFixture('failed','Canceled flight',true)`)
      await frames()
      assert.equal(await run(`document.querySelectorAll('.message-flight').length`), 0)
      await run(`window.renderFixture({modal:true})`)
      await wait(200)
      await run(`window.renderFixture({modal:false})`)
      assert.equal(
        await run(
          `document.querySelector('[aria-label="Test modal"]').closest('[inert]') !== null`
        ),
        true
      )
      await wait(250)
      assert.equal(await run(`document.querySelector('[aria-label="Test modal"]')`), null)
      if (process.env.SELE_MOTION_SCREENSHOT)
        await fs.writeFile('/tmp/sele-motion.png', (await win.webContents.capturePage()).toPNG())
      // Work with a huge logical history while retaining only a 50-row DOM window.
      await run(`window.renderFixture({users:[],working:window.workingPage(100000)})`)
      await frames()
      const rowOpacity = (id) =>
        run(
          `Number(getComputedStyle(document.querySelector('[data-working-motion-id="${id}"]')).opacity)`
        )
      const allRowsOpaque = () =>
        run(
          `Array.from(document.querySelectorAll('[data-working-motion-id]')).every(n=>getComputedStyle(n).opacity==='1')`
        )
      const geometry = () =>
        run(
          `(() => {const content=document.querySelector('.chat-detail__step-content');return {height:content.offsetHeight,scrollHeight:document.querySelector('.chat-detail__messages').scrollHeight,rows:Array.from(content.querySelectorAll('[data-working-motion-id]'),n=>n.offsetHeight)}})()`
        )
      assert.equal(await allRowsOpaque(), true, 'initial Working history does not animate')
      await run(`window.renderFixture({working:window.workingPage(100001)})`)
      await frames()
      assert.ok((await rowOpacity('tool-100000')) < 1, 'new live tool fades in')
      assert.equal(await rowOpacity('tool-99999'), 1, 'retained tail rows do not replay on remount')
      assert.equal(await run(`document.querySelectorAll('[data-working-motion-id]').length`), 50)
      assert.equal(
        await run(`document.querySelector('[data-working-motion-id="tool-99950"]')`),
        null,
        'eviction is immediate'
      )
      const duringReveal = await geometry()
      await wait(220)
      assert.deepEqual(
        await geometry(),
        duringReveal,
        'row and scroll geometry remain fixed during reveal'
      )
      // Loading older/newer windows at the same canonical count is not an append.
      for (const start of [0, 99951]) {
        await run(`window.renderFixture({working:window.workingPage(100001,${start})})`)
        await frames()
        assert.equal(await allRowsOpaque(), true, 'page loads do not reveal historical tools')
      }
      await run(`document.querySelector('.chat-detail__working > summary').click()`)
      await frames()
      assert.equal(await run(`document.querySelector('.chat-detail__step-content')`), null)
      await run(
        `window.renderFixture({working:window.workingPage(100002)});document.querySelector('.chat-detail__working > summary').click()`
      )
      await frames()
      assert.equal(
        await allRowsOpaque(),
        true,
        'reopening does not replay tools received while collapsed'
      )
      await run(`window.renderFixture({working:window.groupPage(100000)})`)
      await frames()
      assert.equal(await allRowsOpaque(), true)
      await run(`window.renderFixture({working:window.groupPage(100001)})`)
      await frames()
      assert.ok(
        (await rowOpacity('tool-100000')) < 1,
        'appends within a tool group reveal the new child'
      )
      assert.equal(await rowOpacity('group'), 1, 'the whole group stays stable')
      assert.equal(await rowOpacity('tool-99999'), 1)
      assert.equal(
        await run(
          `document.querySelectorAll('.chat-detail__tool-sequence-content [data-working-motion-id]').length`
        ),
        50
      )
      const groupDuringReveal = await geometry()
      await wait(220)
      assert.deepEqual(await geometry(), groupDuringReveal)
      await run(`window.renderFixture({working:window.groupPage(100001,0)})`)
      await frames()
      assert.equal(await allRowsOpaque(), true, 'group history paging does not replay')
      await run(`window.renderFixture({working:window.groupPage(100020)})`)
      await frames()
      assert.equal(await allRowsOpaque(), true, 'large catch-up batches skip animation')
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await frames()
      await run(`window.renderFixture({modal:true, content:'Reduced text', streaming:true})`)
      await wait(220)
      await run(
        `window.renderFixture({modal:false, content:'Reduced text appended.'}); window.sendFixture('reduced','Reduced message')`
      )
      await frames()
      assert.equal(
        await run(
          `document.querySelectorAll('[data-stream-reveal], .message-flight, [aria-label="Test modal"]').length`
        ),
        0,
        'reduced motion is immediate'
      )
      await run(`window.renderFixture({working:window.groupPage(100021)})`)
      await frames()
      assert.equal(await allRowsOpaque(), true, 'new tools respect reduced motion')
      assert.deepEqual(errors, [], 'no React or renderer errors')
      console.log(
        'Motion checks passed: list exits, tabs, portal reopen, notes focus, streaming, send/queue/steer, provider handoff, nested selector navigation, bounded Working rows, cancellation, reduced motion'
      )
      win.destroy()
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      app.exit(code)
    }
  })
}
