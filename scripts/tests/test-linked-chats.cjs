const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Composer behavior for chats dragged in as linked context. Provider work is stubbed, so this
// never starts a model turn. On Linux, run it through the isolated-gui helper.
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-linked-chats-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import './src/renderer/src/assets/main.css'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import { LinkedChatOpenerContext } from './src/renderer/src/components/LinkedChatOpener'
            import { buildLinkedChatPrompt, linkedChatDragType, serializeLinkedChatDrag } from './src/renderer/src/linkedChats'
            import { fallbackProviderModels, fallbackProviderApprovalModes, fallbackProviderSandboxModes } from './src/shared/provider'
            const stored = new Map()
            window.preferencesApi = {
              getItem: key => ({ok: true, value: stored.get(key) ?? null}),
              setItem: (key, value) => { stored.set(key, value); return {ok: true, value: null} },
              removeItem: key => { stored.delete(key); return {ok: true, value: null} }
            }
            const root = createRoot(document.getElementById('root'))
            const noop = () => {}
            window.sends = []
            window.opened = []
            window.buildLinkedChatPrompt = buildLinkedChatPrompt
            window.renderComposer = (editSession = null) => flushSync(() => root.render(<React.StrictMode>
              <LinkedChatOpenerContext.Provider value={chat => window.opened.push(chat)}>
                <MessageBox draftScopeKey="codex:current" chatId="current" linkedChatSummaryPrompt="Summarize it"
                  editSession={editSession} onCancelEdit={() => window.renderComposer()}
                  providerId="codex" model={fallbackProviderModels[0].id} models={fallbackProviderModels}
                  agentMode="interactive" agentModes={[]} approvalMode="never" approvalModes={fallbackProviderApprovalModes}
                  reasoningEffort="medium" serviceTier={null} sandboxMode="danger-full-access" sandboxModes={fallbackProviderSandboxModes}
                  accountUsage={null} accountUsageError={null} accountUsageState="ready" displayUsage={{context:true,short:false,long:false}}
                  contextUsage={{source: 'unavailable', usedTokens: null, maxTokens: null}}
                  showActions={false} showNotesButton={false} showModelSelector={false} showAccessSelector={false}
                  showReviewSelector={false} showSpeedSelector={false} showReasoningSelector={false}
                  onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                  onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                  onSend={async (...args) => { window.sends.push(args); if (editSession) window.renderComposer(); return true }} />
              </LinkedChatOpenerContext.Provider>
            </React.StrictMode>))
            window.setText = value => {
              const textarea = document.querySelector('textarea')
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value)
              textarea.dispatchEvent(new Event('input', {bubbles: true}))
            }
            window.control = label => document.querySelector('[aria-label="' + label + '"]')
            window.click = label => {
              const button = window.control(label)
              if (!button || button.disabled) throw new Error('Unavailable control: ' + label)
              button.click()
            }
            window.dragChat = (type, chat) => {
              const data = new DataTransfer()
              data.setData(linkedChatDragType, serializeLinkedChatDrag(chat))
              document.querySelector('.message-box__input').dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: data}))
            }
            window.renderComposer()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
        outfile: path.join(directory, 'linked.js')
      })
      await fs.writeFile(
        path.join(directory, 'linked.html'),
        `<!doctype html><link rel="stylesheet" href="linked.css"><div id="root" style="padding: 24px; max-width: 760px"></div><script>
        window.appApi = {}
        window.preparations = []
        window.cancelled = []
        window.providerApi = {
          getSkills: async () => [],
          getApps: async () => [],
          prepareLinkedChatContext: (providerId, chatId, options) =>
            new Promise((resolve, reject) => window.preparations.push({providerId, chatId, options, resolve, reject})),
          cancelLinkedChatContext: async operationId => {
            window.cancelled.push(operationId)
            window.preparations.find(entry => entry.options.operationId === operationId)?.resolve(null)
          }
        }
      </script><script src="linked.js"></script>`
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, process.env.SELE_LINKED_CHATS_SCREENSHOT ?? '', '--no-sandbox'],
        { env: environment, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (
        result.status !== 0 ||
        result.error ||
        !result.stdout.includes('Linked chat composer checks passed')
      ) {
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
    const window = new BrowserWindow({
      show: false,
      width: 820,
      height: 420,
      webPreferences: { backgroundThrottling: false, offscreen: true }
    })
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'linked.html'))
      const screenshotPath = process.argv[3]
      const run = (source) => window.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const sendDisabled = () => run(`window.control('Send message').disabled`)
      const alpha = `{providerId: 'claude', chatId: 'alpha', name: 'Alpha chat'}`
      await settle()

      // Dragging a chat offers it like a file attachment.
      await run(`window.dragChat('dragenter', ${alpha})`)
      await settle()
      assert.equal(
        await run(`document.querySelector('.message-box__attachment-drop-target')?.textContent`),
        'Drop chat to attach'
      )

      // Dropping starts loading: the chip spins and sending waits for it.
      await run(`window.dragChat('drop', ${alpha}); window.setText('Use this')`)
      await settle()
      assert.equal(
        await run(`document.querySelector('.message-box__attachment-drop-target')`),
        null
      )
      assert.equal(await run('window.preparations.length'), 1)
      assert.deepEqual(
        await run(
          `({providerId: window.preparations[0].providerId, chatId: window.preparations[0].chatId, prompt: window.preparations[0].options.summaryPrompt})`
        ),
        { providerId: 'claude', chatId: 'alpha', prompt: 'Summarize it' }
      )
      assert.ok(
        await run(
          `Boolean(document.querySelector('.message-box__linked-chat .app-loading-spinner'))`
        )
      )
      assert.equal(await sendDisabled(), true)
      await run(
        `document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))`
      )
      await settle()
      assert.equal(await run('window.sends.length'), 0)
      if (screenshotPath) {
        const image = await window.webContents.capturePage()
        await fs.writeFile(screenshotPath.replace(/\.png$/, '-loading.png'), image.toPNG())
      }

      // The cross cancels loading and removes the chip.
      await run(`window.click('Cancel linking Alpha chat')`)
      await settle()
      assert.deepEqual(
        await run('window.cancelled'),
        await run('[window.preparations[0].options.operationId]')
      )
      assert.equal(await run(`document.querySelector('.message-box__linked-chat')`), null)
      assert.equal(await sendDisabled(), false)

      // A finished summary is injected ahead of the request; the chip opens the original chat.
      await run(`window.dragChat('drop', ${alpha})`)
      await settle()
      await run(`window.preparations[1].resolve({summary: '## Objective\\n- Ship it'})`)
      await settle()
      assert.equal(await sendDisabled(), false)
      await run(`window.click('Open linked chat Alpha chat')`)
      assert.deepEqual(await run('window.opened'), [
        { providerId: 'claude', chatId: 'alpha', name: 'Alpha chat' }
      ])
      // Dropping the same chat again does not duplicate it.
      await run(`window.dragChat('drop', ${alpha})`)
      await settle()
      assert.equal(await run('window.preparations.length'), 2)
      if (screenshotPath) {
        const image = await window.webContents.capturePage()
        await fs.writeFile(screenshotPath, image.toPNG())
      }
      await run(`window.click('Send message')`)
      await settle()
      assert.equal(
        await run('window.sends[0][0]'),
        [
          '# Linked chats',
          '<linked-chat-context name="Alpha chat" provider="claude" chat-id="alpha">',
          '## Objective',
          '- Ship it',
          '</linked-chat-context>',
          '# User request:',
          'Use this'
        ].join('\n')
      )
      assert.equal(await run(`document.querySelector('.message-box__linked-chat')`), null)

      // A failed summary blocks sending until it is dismissed.
      await run(
        `window.dragChat('drop', {providerId: 'opencode', chatId: 'beta', name: 'Beta'}); window.setText('Next')`
      )
      await settle()
      await run(
        `window.preparations[2].reject(new Error("Error invoking remote method 'provider:prepare-linked-chat-context': Error: Provider offline"))`
      )
      await settle()
      assert.equal(await sendDisabled(), true)
      assert.match(
        await run(`document.querySelector('.message-box__error')?.textContent ?? ''`),
        /Beta: Provider offline/
      )
      await run(`document.querySelector('.message-box__error button')?.click()`)
      await settle()
      assert.equal(await run(`document.querySelector('.message-box__linked-chat')`), null)
      assert.equal(await sendDisabled(), false)

      // The open chat cannot link itself.
      await run(`window.dragChat('drop', {providerId: 'codex', chatId: 'current', name: 'Me'})`)
      await settle()
      assert.equal(await run('window.preparations.length'), 3)
      assert.match(
        await run(`document.querySelector('.message-box__error')?.textContent ?? ''`),
        /cannot be linked to itself/
      )
      await run(`document.querySelector('.message-box__error button')?.click()`)
      await settle()

      // Editing a sent message shows its request as text and its linked chats as chips. The
      // composer's own draft and linked chats are set aside, then restored.
      const chipNames = () =>
        run(
          `Array.from(document.querySelectorAll('.message-box__linked-chat .attachment-chip__label')).map(label => label.textContent)`
        )
      await run(`window.dragChat('drop', {providerId: 'copilot', chatId: 'gamma', name: 'Gamma'})`)
      await settle()
      await run(
        `window.preparations[3].resolve({summary: 'Gamma summary'}); window.setText('draft text')`
      )
      await settle()
      const sentAlpha = `{providerId: 'claude', chatId: 'alpha', name: 'Alpha chat', summary: 'Quoted </linked-chat-context> tag'}`
      const editMessage = `{id: 'sent', type: 'message', attachments: [], content: window.buildLinkedChatPrompt([${sentAlpha}], 'Original request')}`
      await run(`window.renderComposer(${editMessage})`)
      await settle()
      assert.equal(await run(`document.querySelector('textarea').value`), 'Original request')
      assert.deepEqual(await chipNames(), ['Alpha chat'])
      await run(`window.setText('Edited request')`)
      await settle()
      await run(`window.click('Save edit')`)
      await settle()
      assert.equal(
        await run('window.sends.at(-1)[0]'),
        await run(`window.buildLinkedChatPrompt([${sentAlpha}], 'Edited request')`)
      )
      assert.equal(await run(`document.querySelector('textarea').value`), 'draft text')
      assert.deepEqual(await chipNames(), ['Gamma'])

      // Cancelling an edit stops chats linked during it and restores the draft's chats.
      await run(`window.renderComposer(${editMessage})`)
      await settle()
      await run(`window.click('Remove linked chat Alpha chat')`)
      await run(`window.dragChat('drop', {providerId: 'opencode', chatId: 'delta', name: 'Delta'})`)
      await settle()
      assert.deepEqual(await chipNames(), ['Delta'])
      await run(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Cancel').click()`
      )
      await settle()
      assert.equal(
        await run('window.cancelled.at(-1)'),
        await run('window.preparations[4].options.operationId')
      )
      assert.equal(await run(`document.querySelector('textarea').value`), 'draft text')
      assert.deepEqual(await chipNames(), ['Gamma'])
      console.log(
        'Linked chat composer checks passed: drop target, loading gate, cancellation, prompt injection, chip opening, failures, self-links and message editing.'
      )
    } catch (error) {
      console.error(error)
      exitCode = 1
    } finally {
      window.destroy()
      app.exit(exitCode)
    }
  })
}
