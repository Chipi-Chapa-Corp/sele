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
            import { flushSync } from 'react-dom'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            import * as settings from './src/renderer/src/settings'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import { MessageSelectionQuoteButton } from './src/renderer/src/components/MessageSelectionQuoteButton'
            const noop = () => {}
            const containerRef = {current: document.getElementById('messages')}
            window.commits = 0
            window.settings = settings
            window.composerProps = {}
            const root = createRoot(document.getElementById('root'))
            window.renderFixture = (props = {}) => {
              Object.assign(window.composerProps, props)
              flushSync(() => root.render(<React.StrictMode>
              <MessageSelectionQuoteButton containerRef={containerRef} onQuote={noop}/>
              <Profiler id="composer" onRender={() => window.commits++}>
                {window.composerProps.fixtureVisible !== false && <MessageBox autoFocus draftScopeKey="test" providerId="codex"
                  cwd="/fixture" model="test" models={[]} agentMode="default" agentModes={[]}
                  approvalMode="on-request" approvalModes={[]} sandboxMode="workspace-write" sandboxModes={[]}
                  reasoningEffort="medium" serviceTier={null} accountUsage={null}
                  accountUsageError={null} accountUsageState="idle"
                  contextUsage={{source:'unavailable', usedTokens:null, maxTokens:null}}
                  displayUsage={{context:true,short:false,long:false}}
                  onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                  onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                  onSend={message => { window.sent = message; window.sendCount = (window.sendCount || 0) + 1; return true }} {...window.composerProps}/>}
              </Profiler>
            </React.StrictMode>))
            }
            window.renderFixture()
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
          const preferenceValues = new Map();
          window.preferencesApi = {
            getItem: key => ({ok:true,value:preferenceValues.get(key) ?? null}),
            setItem: (key,value) => {preferenceValues.set(key,value);return {ok:true}},
            removeItem: key => {preferenceValues.delete(key);return {ok:true}}
          };
          window.appApi = {getProjects: async () => [{name:'Fixture project',cwd:'/fixture/main',icon:'code',additionalCwds:['/fixture/extra']}, {name:'Image project',cwd:'/fixture/image',icon:'image'}, {name:'Default project',cwd:'/fixture/default',icon:null}, {name:'Missing project',cwd:'/fixture/missing',icon:'image'}], getProjectIcon: async ({cwd}) => cwd === '/fixture/missing' ? null : ({cwd,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=',updatedAt:0}), getFileTree: async () => ({files:[],repositoryRoot:'/fixture'})};
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
      // Native predictions are draft hints; accepting one must never send it.
      const ghost = () =>
        run('document.querySelector(".message-box__prompt-suggestion")?.textContent ?? null')
      const key = async (key, modifiers = 0) => {
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          modifiers
        })
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          modifiers
        })
        await settle()
      }
      await run(
        `renderFixture({promptSuggestion:{id:'one',text:'Add regression tests for this change'}}); input.focus()`
      )
      assert.ok(await ghost())
      assert.equal(await run('input.value'), '')
      assert.equal(await run('window.sent ?? null'), null)
      assert.equal(await run('input.getAttribute("aria-autocomplete")'), 'inline')
      assert.deepEqual(
        await run(
          `Array.from(document.querySelectorAll('.message-box__suggestion-key'), button => button.textContent)`
        ),
        ['Tab', 'Enter']
      )
      const layout = await run(`(() => {
        const ghost = document.querySelector('.message-box__prompt-suggestion').getBoundingClientRect();
        const box = input.getBoundingClientRect();
        return { aligned: Math.abs(ghost.x - box.x) < 1 && Math.abs(ghost.y - box.y) < 1,
          fits: ghost.height <= box.height + 1 };
      })()`)
      assert.deepEqual(layout, { aligned: true, fits: true })
      const hintLayout = await run(`(() => {
        const first = document.querySelector('[aria-label="Accept suggestion into draft (Tab)"]').getBoundingClientRect();
        const text = document.querySelector('.message-box__suggestion-text').getBoundingClientRect();
        const last = document.querySelector('[aria-label="Send suggestion immediately (Enter)"]').getBoundingClientRect();
        const mid = rect => rect.y + rect.height / 2;
        return {leading: first.right < text.left, trailing: last.left > text.right,
          aligned: Math.abs(mid(first) - mid(text)) < 1 && Math.abs(mid(last) - mid(text)) < 1};
      })()`)
      assert.deepEqual(hintLayout, { leading: true, trailing: true, aligned: true })
      const caret = await run(`(() => {
        const style = getComputedStyle(input);
        const text = document.querySelector('.message-box__suggestion-text').getBoundingClientRect();
        return {visible: style.caretColor === style.color && style.caretColor !== 'rgba(0, 0, 0, 0)',
          aligned: Math.abs(input.getBoundingClientRect().left + parseFloat(style.paddingLeft) - text.left) < 1};
      })()`)
      assert.deepEqual(
        caret,
        { visible: true, aligned: true },
        'suggestions keep a visible caret at the text start'
      )

      if (process.env.SELE_PROMPT_SUGGESTION_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_PROMPT_SUGGESTION_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await key('Tab')
      assert.equal(await run('input.value'), 'Add regression tests for this change')
      assert.equal(await run('window.sent ?? null'), null)
      assert.equal(await ghost(), null)
      await run(
        `setText(''); renderFixture({promptSuggestion:{id:'two',text:'Run the tests'}}); input.focus()`
      )
      await settle()
      assert.ok(await ghost())
      await key('Escape')
      assert.equal(await ghost(), null)
      assert.equal(await run('input.value'), '')
      await run(
        `renderFixture({promptSuggestion:{id:'three',text:'Inspect the changes'}}); input.focus(); setText('My prompt')`
      )
      await settle()
      assert.equal(await ghost(), null)
      await run(`setText('')`)
      await settle()
      assert.equal(
        await ghost(),
        null,
        'deleting your own draft must not revive a dismissed prediction'
      )
      for (const blocked of [
        { active: true },
        { pending: true },
        { disabled: true },
        { operationsDisabled: true },
        { editSession: { id: 'edit', content: 'Editing', attachments: [] } }
      ]) {
        await run(
          `renderFixture({promptSuggestion:{id:'blocked',text:'A suggestion'}, ...${JSON.stringify(blocked)}})`
        )
        await settle()
        assert.equal(await ghost(), null)
        await run(
          `renderFixture({active:false,pending:false,disabled:false,operationsDisabled:false,editSession:null}); setText('')`
        )
        await settle()
      }
      await run(
        `renderFixture({promptSuggestion:{id:'four',text:'Review the patch'}}); input.focus()`
      )
      assert.ok(await ghost())
      await key('Tab', 8) // Shift+Tab must keep normal keyboard navigation.
      assert.equal(await run('input.value'), '')
      await run(
        `input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', {key:'Tab',isComposing:true,bubbles:true}))`
      )
      await settle()
      assert.equal(await run('input.value'), '', 'Tab during IME composition must not accept')
      await run(
        `renderFixture({draftScopeKey:'another-chat',promptSuggestion:{id:'other',text:'Other chat'}}); input.focus()`
      )
      await key('Tab')
      assert.equal(await run('input.value'), 'Other chat')
      await run(`renderFixture({draftScopeKey:'test',promptSuggestion:null}); input.focus()`)
      assert.equal(await run('input.value'), '', 'accepted drafts stay scoped to their chat')
      const click = async (selector) => {
        const point =
          await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          return {x:r.x + r.width/2, y:r.y + r.height/2} })()`)
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          ...point
        })
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          ...point
        })
        await settle()
      }
      for (const activation of ['Enter', 'click-send', 'click-accept']) {
        await run(
          `setText(''); window.sent = undefined; renderFixture({promptSuggestion:{id:${JSON.stringify(activation)},text:'Send this suggestion'}}); input.focus()`
        )
        const count = await run('window.sendCount || 0')
        if (activation === 'Enter') await key('Enter')
        else
          await click(
            activation === 'click-send'
              ? '[aria-label="Send suggestion immediately (Enter)"]'
              : '[aria-label="Accept suggestion into draft (Tab)"]'
          )
        if (activation === 'click-accept') {
          assert.equal(await run('input.value'), 'Send this suggestion')
          assert.equal(await run('window.sendCount || 0'), count, 'Tab keycap only fills the draft')
        } else {
          assert.equal(await run('window.sent'), 'Send this suggestion')
          assert.equal(await run('input.value'), '')
          assert.equal(await run('window.sendCount'), count + 1, 'Enter sends exactly once')
        }
        assert.equal(await run('document.activeElement === input'), true)
      }
      await run(`setText(''); window.sent = undefined; renderFixture({promptSuggestion:null})`)
      assert.equal(
        await run(`(() => {
        const settings = window.settings.readStoredAppSettings();
        settings.chat.promptSuggestions = false;
        window.settings.writeStoredAppSettings(settings);
        return window.settings.readStoredAppSettings().chat.promptSuggestions;
      })()`),
        false,
        'the opt-out persists'
      )
      for (const marker of ['@', '$', '#']) {
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
      await run("setText('Use #fix')")
      await settle()
      assert.equal(
        await run("document.querySelector('[role=listbox]').getAttribute('aria-label')"),
        'Projects'
      )
      assert.equal(
        await run("document.querySelector('[role=option]').textContent.includes('/fixture/main')"),
        true
      )
      assert.equal(
        await run("!!document.querySelector('[role=option] .lucide-code-xml')"),
        true,
        'configured glyph appears'
      )
      for (const query of ['image', 'default', 'missing']) {
        await run(`setText('#${query}')`)
        await settle()
        assert.equal(
          await run("!!document.querySelector('[role=option] img')"),
          query !== 'missing',
          'custom and detected image icons appear'
        )
        if (query === 'missing')
          assert.equal(
            await run("!!document.querySelector('[role=option] .lucide-folder')"),
            true,
            'missing image falls back to folder'
          )
      }
      await run("setText('Use #fix')")
      await settle()
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      })
      await settle()
      assert.equal(await run('input.value'), 'Use /fixture/main ')
      assert.equal(await run('window.sent'), undefined, 'selecting a project must not send')
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13
      })
      await settle()
      assert.equal(await run('window.sent'), 'Use /fixture/main', 'send contains the main cwd')
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
      await run(`
        getSelection().removeAllRanges(); input.focus(); setText('focus draft');
        const controls = document.createElement('div'); controls.id = 'focus-controls';
        controls.style.cssText = 'position:fixed;right:10px;top:180px;width:230px;z-index:9999;background:white';
        controls.innerHTML = '<button id="copy-action">Copy</button><button id="pin-action">Pin</button>' +
          '<button id="fork-action">Fork</button><button id="close-chat">Close chat</button><button id="open-chat">Open chat</button>' +
          '<details><summary id="worked-action">Worked</summary><details><summary id="tool-action">Tool</summary>Tool details</details></details>' +
          '<input id="other-editor" aria-label="Search"><button id="dialog-action">Open dialog</button>' +
          '<button id="draggable-action" draggable="true">Drag chat</button>';
        document.body.append(controls);
        document.querySelector('#copy-action').onclick = () => {
          const temporary = document.createElement('textarea'); temporary.value = 'Copied text';
          document.body.append(temporary); temporary.focus(); temporary.select(); temporary.remove();
        };
        document.querySelector('#pin-action').onclick = event => event.currentTarget.setAttribute('aria-pressed','true');
        document.querySelector('#draggable-action').ondragstart = event => {window.dragStarted = true; event.preventDefault()};
        document.querySelector('#fork-action').onclick = () => setTimeout(() => renderFixture({draftScopeKey:'fork-focus'}),20);
        document.querySelector('#close-chat').onclick = () => renderFixture({fixtureVisible:false});
        document.querySelector('#open-chat').onclick = () => {
          renderFixture({fixtureVisible:true,draftScopeKey:'test'}); window.input = document.querySelector('#message-input');
        };
        document.querySelector('#dialog-action').onclick = () => {
          const dialog = document.createElement('dialog'); dialog.id = 'focus-dialog';
          dialog.innerHTML = '<input id="dialog-editor" autofocus><button id="dialog-close">Close</button>';
          document.body.append(dialog); dialog.showModal();
          dialog.querySelector('button').onclick = () => dialog.remove();
        };
        void 0;
      `)
      await settle()
      for (const action of [
        'copy-action',
        'pin-action',
        'fork-action',
        'worked-action',
        'tool-action'
      ]) {
        await click('#' + action)
        assert.equal(
          await run('document.activeElement === input'),
          true,
          action + ' keeps composer focus'
        )
      }
      await win.webContents.debugger.sendCommand('Input.insertText', {
        text: 'typing after actions'
      })
      await settle()
      assert.equal(await run('input.value'), 'typing after actions')
      await click('#close-chat')
      assert.equal(await run('document.querySelector("#message-input")'), null)
      await click('#open-chat')
      assert.equal(
        await run('document.activeElement === input'),
        true,
        'opening a chat focuses its composer'
      )
      assert.equal(await run('input.value'), 'focus draft', 'chat actions retain scoped drafts')
      await click('#other-editor')
      await win.webContents.debugger.sendCommand('Input.insertText', { text: 'search text' })
      await settle()
      assert.equal(
        await run('document.activeElement.id'),
        'other-editor',
        'other text fields stay usable'
      )
      assert.equal(await run('document.querySelector("#other-editor").value'), 'search text')
      await click('#pin-action')
      assert.equal(
        await run('document.activeElement === input'),
        true,
        'a completed action returns from search to the composer'
      )
      await click('#dialog-action')
      assert.equal(
        await run('document.activeElement.id'),
        'dialog-editor',
        'dialogs own their input focus'
      )
      await win.webContents.debugger.sendCommand('Input.insertText', { text: 'dialog text' })
      await click('#dialog-close')
      assert.equal(
        await run('document.activeElement === input'),
        true,
        'closing a dialog restores composer focus'
      )
      await run(`input.blur(); const selected = document.querySelector('#messages p').firstChild;
        getSelection().setBaseAndExtent(selected,0,selected,5)`)
      await settle()
      assert.equal(await run('getSelection().toString()'), 'Quote')
      assert.equal(
        await run('document.activeElement === input'),
        false,
        'transcript selection keeps focus away from the composer'
      )
      // Real selection gestures must be allowed to finish before focus is restored.
      await run(`getSelection().removeAllRanges(); input.focus()`)
      const drag =
        await run(`(() => {const r = document.querySelector('#messages p').getBoundingClientRect();
        return {x:r.x + 2, y:r.y + r.height/2, endX:r.x + 80}})()`)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        x: drag.x,
        y: drag.y
      })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        button: 'left',
        buttons: 1,
        x: drag.endX,
        y: drag.y
      })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        x: drag.endX,
        y: drag.y
      })
      await settle()
      assert.equal(
        await run('getSelection().isCollapsed'),
        false,
        'native text dragging retains its selection'
      )
      assert.equal(
        await run('document.activeElement === input'),
        false,
        'native selection does not bounce back to the prompt'
      )
      await run(`getSelection().removeAllRanges(); input.focus()`)
      const draggable =
        await run(`(() => {const r = document.querySelector('#draggable-action').getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...draggable
      })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        button: 'left',
        buttons: 1,
        x: draggable.x - 35,
        y: draggable.y
      })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        x: draggable.x - 35,
        y: draggable.y
      })
      await settle()
      assert.equal(
        await run('window.dragStarted'),
        true,
        'retaining composer focus must not disable chat dragging'
      )
      await click('#pin-action')
      assert.equal(
        await run('document.activeElement === input'),
        true,
        'a canceled drag must not strand focus'
      )
      // Keyboard focus can still move intentionally; activating the action returns to typing.
      await run(`getSelection().removeAllRanges(); input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true}));
        document.querySelector('#pin-action').focus(); void 0`)
      await settle()
      assert.equal(
        await run('document.activeElement.id'),
        'pin-action',
        'Tab navigation remains usable'
      )
      await key('Enter')
      assert.equal(
        await run('document.activeElement === input'),
        true,
        'keyboard actions also restore the prompt'
      )
      await run(`getSelection().removeAllRanges(); input.focus(); setText('after selection')`)
      await settle()
      await win.webContents.debugger.sendCommand('Input.insertText', { text: '!' })
      await settle()
      assert.equal(
        await run('input.value'),
        'after selection!',
        'restored focus retains a usable native caret'
      )
      assert.deepEqual(errors, [])
      console.log(
        'Composer input checks passed: prompt keycaps, Enter sending, persistent focus, text selection, mentions, selection without renders, large drafts, native replacement, and message quotes.'
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
