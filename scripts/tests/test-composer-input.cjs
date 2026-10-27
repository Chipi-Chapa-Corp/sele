const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-composer-input-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React, { Profiler } from 'react'
            import { createRoot } from 'react-dom/client'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import { MessageSelectionQuoteButton } from './src/renderer/src/components/MessageSelectionQuoteButton'
            const noop = () => {}
            const containerRef = {current: document.getElementById('messages')}
            window.commits = 0
            createRoot(document.getElementById('root')).render(<React.StrictMode>
              <MessageSelectionQuoteButton containerRef={containerRef} onQuote={noop}/>
              <Profiler id="composer" onRender={() => window.commits++}>
                <MessageBox autoFocus draftScopeKey="test" providerId="codex"
                  cwd="/fixture" model="test" models={[]} agentMode="default" agentModes={[]}
                  approvalMode="on-request" approvalModes={[]} sandboxMode="workspace-write" sandboxModes={[]}
                  reasoningEffort="medium" serviceTier={null} accountUsage={null}
                  accountUsageError={null} accountUsageState="idle"
                  contextUsage={{source:'unavailable', usedTokens:null, maxTokens:null}}
                  displayUsage={{context:true,short:false,long:false}}
                  onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                  onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                  onSend={message => { window.sent = message; return true }}/>
              </Profiler>
            </React.StrictMode>)
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: process.argv.includes('--baseline')
          ? [
              {
                name: 'baseline',
                setup(build) {
                  build.onLoad(
                    { filter: /(?:MessageBox|MessageSelectionQuoteButton)\.tsx$/ },
                    (args) => ({
                      contents: require('node:child_process').execFileSync(
                        'git',
                        [
                          'show',
                          'HEAD:' + path.relative(path.resolve(__dirname, '../..'), args.path)
                        ],
                        { encoding: 'utf8' }
                      ),
                      loader: 'tsx'
                    })
                  )
                }
              }
            ]
          : []
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <link rel="stylesheet" href="fixture.css">
        <div id="messages"><div class="chat-detail__message--assistant">
          <div class="chat-detail__message-quote-host"></div><p>Quote these words</p>
        </div></div><div id="root"></div><script>
          window.preferencesApi = {getItem: () => ({ok:true,value:null}), setItem: () => ({ok:true}), removeItem: () => ({ok:true})};
          window.appApi = {getFileTree: async () => ({files:[],repositoryRoot:'/fixture'})};
          window.providerApi = {getSkills: async () => [], getApps: async () => []};
        </script><script src="fixture.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      assert.equal(result.status, 0, result.stderr || result.error?.message)
      assert.ok(result.stdout.includes('Composer input checks passed'))
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
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      const errors = []
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) =>
        win.webContents.executeJavaScript(source).catch((error) => {
          throw new Error(source + '\n' + errors.join('\n'), { cause: error })
        })
      const settle = () => run('new Promise(resolve => setTimeout(resolve, 80))')
      await win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      await settle()
      await run(`window.input = document.querySelector('textarea'); window.focus(); input.focus();
        window.setText = value => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
          input.setSelectionRange(value.length, value.length);
          input.dispatchEvent(new Event('input', {bubbles:true}));
          input.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:'ArrowRight'}));
        };
        window.select = (start, end) => {
          input.setSelectionRange(start, end);
          input.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:'ArrowRight'}));
        };
        window.serializeCount = 0;
        const original = Selection.prototype.toString;
        Selection.prototype.toString = function() { window.serializeCount++; return original.call(this) };
        void 0;
      `)
      for (const marker of ['@', '$']) {
        await run(`setText('prefix ${marker}query trailing')`)
        await settle()
        await run('select(9, 9)')
        await settle()
        assert.equal(
          await run('input.getAttribute("aria-expanded")'),
          'true',
          'caret opens autocomplete ' +
            JSON.stringify(
              await run(
                '({value:input.value,start:input.selectionStart,end:input.selectionEnd,focused:document.activeElement===input,commits:window.commits})'
              )
            )
        )
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'ArrowRight',
          code: 'ArrowRight',
          windowsVirtualKeyCode: 39,
          modifiers: 8
        })
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowRight',
          code: 'ArrowRight',
          windowsVirtualKeyCode: 39
        })
        await settle()
        assert.deepEqual(
          await run('[input.selectionStart, input.selectionEnd]'),
          [9, 10],
          'native Shift+Right extends the selection'
        )
        assert.equal(
          await run('input.getAttribute("aria-expanded")'),
          'false',
          'selection closes autocomplete'
        )
        // Let the menu's exit animation unmount before counting selection updates.
        await run('new Promise(resolve => setTimeout(resolve, 300))')
        await run('window.commits = 0; window.serializeCount = 0')
        for (let end = 11; end <= 18; end++) {
          await run(`select(9, ${end})`)
          await settle()
        }
        assert.equal(
          await run('window.commits'),
          0,
          'extending a selection must not rerender the composer'
        )
        assert.equal(
          await run('window.serializeCount'),
          0,
          'input selection must not be serialized for quoting'
        )
        await run('select(9, 9)')
        await settle()
        assert.equal(
          await run('input.getAttribute("aria-expanded")'),
          'true',
          'collapsing selection restores autocomplete'
        )
      }
      await run(`setText(${JSON.stringify('long draft line\n')}.repeat(6000) + 'ending')`)
      await settle()
      await run('window.commits = 0; window.serializeCount = 0')
      for (let offset = 0; offset < 10; offset++) {
        await run(`select(${offset}, input.value.length - ${offset})`)
        await settle()
      }
      assert.equal(
        await run('window.commits'),
        0,
        'large draft selection stays outside React rendering'
      )
      assert.equal(await run('window.serializeCount'), 0)
      const replaced = await run('input.value.slice(0, 9) + "X" + input.value.slice(-9)')
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'char',
        text: 'X'
      })
      await settle()
      assert.equal(await run('input.value'), replaced, 'native typing replaces selected text')
      // A real message selection must still offer the quote action.
      await run(`input.blur(); const text = document.querySelector('#messages p').firstChild;
        getSelection().setBaseAndExtent(text, 0, text, 5)`)
      await settle()
      assert.equal(
        await run(`!!document.querySelector('[aria-label="Quote selected text"]')`),
        true
      )
      assert.deepEqual(errors, [])
      console.log(
        'Composer input checks passed: mentions, selection without renders, large drafts, native replacement, and message quotes.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
