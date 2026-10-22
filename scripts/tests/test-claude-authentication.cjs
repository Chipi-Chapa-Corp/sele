const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Run through the isolated-gui helper. This fixture never starts Sele or Claude.
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-auth-ui-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import { AccountDialog } from './src/renderer/src/components/AccountDialog'
            import { ConversationComposer } from './src/renderer/src/workspace/components/ConversationComposer'
            import { defaultAppSettings } from './src/renderer/src/settings'
            import { fallbackProviderModels, fallbackProviderApprovalModes, fallbackProviderSandboxModes } from './src/shared/provider'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            import './src/renderer/src/workspace/styles/conversation-requests.css'
            import './src/renderer/src/workspace/styles/conversation-composer.css'
            const root = createRoot(document.getElementById('root'))
            const prompt = { type: 'message', role: 'user', id: 'request', content: 'build me a zip to publish using scripts' }
            const text = 'Failed to authenticate: OAuth session expired and could not be refreshed'
            window.managed = 0
            window.retried = []
            window.sends = []
            window.loginCalls = 0
            window.canceled = 0
            window.authorized = 0
            window.linksCopied = 0
            window.authenticationRequired = true
            window.dialogOpen = false
            window.newChatMode = false
            const openSignIn = () => { window.dialogOpen = true; window.renderFailure() }
            const closeSignIn = () => { window.dialogOpen = false; window.renderFailure() }
            const startSignIn = async () => {
              window.loginCalls++
              let finish
              const completion = new Promise(resolve => { finish = resolve })
              window.confirmSignIn = () => { window.authenticationRequired = false; finish(); window.renderFailure() }
              return { userCode: null, completion, authorize: async () => { window.authorized++ }, cancel: async () => { window.canceled++ }, submitCode: async () => {}, copyLink: async () => {window.linksCopied++;await new Promise(resolve => setTimeout(resolve,250))} }
            }
            const noop = () => {}
            const settings = { ...defaultAppSettings, chat: { ...defaultAppSettings.chat, enableActions: false, enableNotesButton: false, displayUsage: {context:true,short:false,long:false} } }
            window.renderFailure = (authentication = true, replacementCallback = false) => flushSync(() => root.render(<React.StrictMode>
              {!window.newChatMode && <>
              <ChatDetailItem item={prompt} />
              <ChatDetailItem
                authenticationRequired={window.authenticationRequired}
                item={{ type: 'working', id: 'request:working', status: 'failed', failureReason: authentication ? 'authentication' : undefined, failureMessage: text, items: [{type: 'message', id: 'auth', content: text}] }}
                retryMessage={prompt}
                retryStoppedTurnDisabled={window.authenticationRequired}
                onRetryStoppedTurn={message => window.retried.push(message)}
                onManageAccounts={replacementCallback ? () => window.managed += 10 : () => window.managed++}
                onReauthenticate={openSignIn}
                progressSettings={{ expandProgressOnStart: false, collapseProgressOnFinish: true }}
              />
              </>}
              <ConversationComposer
                authenticationRequired={window.authenticationRequired}
                handleOpenChatReauthentication={openSignIn}
                handleManageChatAccounts={() => window.managed++}
                selectedChat={window.newChatMode ? null : { providerId: 'claude', id: 'fixture' }}
                newChatOpen={window.newChatMode}
                worktreeCreationState="idle"
                newSessionProvider="claude" newSessionProviderOptions={[{value:'claude', label:'Claude'}]}
                projectOptions={[{value:'/fixture', label:'Fixture project'}]} newSessionProjectValue="/fixture"
                newSessionLocationOptions={[{value:'folder', label:'Folder'}]} newSessionLocation="folder"
                containerOptions={[{value:'dev', label:'dev'}]} newSessionContainerValue="dev"
                requestErrorVisible={window.newChatMode} requestErrorSummary="Claude authentication expired. Sign in again before sending messages."
                appSettings={settings} effectiveAppSettings={settings}
                messageBoxDisabled={window.authenticationRequired}
                messageBoxProviderAvailable
                effectiveModel={fallbackProviderModels[0].id} models={fallbackProviderModels}
                agentMode="interactive" agentModes={[]} effectiveApprovalMode="never" approvalModes={fallbackProviderApprovalModes}
                effectiveReasoningEffort="medium" effectiveServiceTier={null} effectiveSandboxMode="danger-full-access" sandboxModes={fallbackProviderSandboxModes}
                accountUsage={null} accountUsageError={null} accountUsageState="ready"
                terminalWorkspaceKey="auth-fixture" selectedChatKey="claude:fixture"
                messageBoxContextUsage={{source: 'exact', usedTokens: 1000, maxTokens: 100000}}
                handleActionsChange={noop} setAgentMode={noop} handleApprovalModeChange={noop} handleModelChange={noop}
                handleReasoningEffortChange={noop} setServiceTier={noop} handleSandboxModeChange={noop}
                handleSendMessage={async (...args) => { window.sends.push(args); return true }}
              />
              {window.dialogOpen && <AccountDialog reauthenticate providerLabel="Claude" onLogin={startSignIn} onClose={closeSignIn} />}
            </React.StrictMode>))
            window.setText = value => {
              const textarea = document.querySelector('textarea')
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value)
              textarea.dispatchEvent(new Event('input', {bubbles: true}))
            }
            window.renderFailure()
          `,
          resolveDir: process.cwd(),
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
                  'export default class { constructor() { throw new Error("Unexpected editor worker") } }',
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
        `<!doctype html><html><head>
        <link rel="stylesheet" href="test.css"><style>body{background:var(--background);color:var(--foreground);font:14px system-ui;margin:24px}#root{display:flex;flex-direction:column;gap:12px}</style>
        </head><body><div id="root"></div><script>
          const stored = new Map()
          window.preferencesApi = {
            getItem: key => ({ok:true,value:stored.get(key) ?? null}),
            setItem: (key,value) => {stored.set(key,value);return {ok:true,value:null}},
            removeItem: key => {stored.delete(key);return {ok:true,value:null}}
          }
          window.appApi={};window.providerApi={getSkills:async()=>[],getApps:async()=>[]}
        </script><script src="test.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        {
          env,
          encoding: 'utf8',
          timeout: 55000
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Claude authentication UI checks passed'))
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
      width: 750,
      height: 720,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error('Renderer:', event.message)
      })
      await win.loadFile(path.join(process.argv[2], 'test.html'))
      const run = async (source) => {
        try {
          return await win.webContents.executeJavaScript(source)
        } catch (error) {
          throw new Error(source + ': ' + error.message)
        }
      }
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const state = await run(`({
        assistantCount: document.querySelectorAll('.chat-detail__message--assistant').length,
        failure: document.querySelector('.chat-detail__failure-label')?.textContent,
        failureInsideDetails: !!document.querySelector('.chat-detail__failure-label')?.closest('details'),
        buttons: [...document.querySelectorAll('button')].map(button => button.textContent.trim())
      })`)
      assert.equal(state.assistantCount, 0)
      assert.match(state.failure, /OAuth session expired/)
      assert.match(state.failure, /Sign in again to continue/)
      assert.equal(
        state.failureInsideDetails,
        false,
        'recovery instructions stay visible with progress collapsed'
      )
      assert.ok(state.buttons.includes('Manage accounts'))
      assert.ok(state.buttons.includes('Sign in again'))
      assert.ok(state.buttons.includes('Retry'))
      assert.equal(
        await run('!!document.querySelector(\'[aria-label="Account sign-in required"]\')'),
        true
      )
      assert.equal(
        await run('document.querySelector(\'[aria-label="Send message"]\').disabled'),
        true
      )
      assert.equal(
        await run('document.querySelector(\'[aria-label="Retry failed turn"]\').disabled'),
        true
      )
      assert.deepEqual(
        await run(`({
          prompt: document.querySelector('#message-input').disabled || document.querySelector('#message-input').readOnly,
          attach: document.querySelector('[aria-label="Attach files"]').disabled,
          usage: document.querySelector('.message-box__usage-control > button').disabled
        })`),
        { prompt: false, attach: false, usage: false },
        'only sending is blocked; the prompt, attachments and usage stay usable'
      )
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Manage accounts').click()"
      )
      assert.equal(await run('window.managed'), 1)
      await run('window.setText("Keep this draft")')
      await run(
        'document.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true}))'
      )
      assert.deepEqual(await run('window.sends'), [], 'Enter cannot send while unauthenticated')
      await run('window.renderFailure(true, true)')
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Manage accounts').click()"
      )
      assert.equal(
        await run('window.managed'),
        11,
        'memoization must forward the latest account callback'
      )
      if (process.env.SELE_AUTH_SCREENSHOT) {
        await run('document.fonts.ready')
        await fs.writeFile(
          process.env.SELE_AUTH_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Sign in again').click()"
      )
      await run('new Promise(resolve => setTimeout(resolve, 80))')
      assert.equal(
        await run('window.loginCalls'),
        1,
        'StrictMode must start exactly one sign-in flow'
      )
      assert.equal(
        await run('!!document.querySelector("#account-dialog-name")'),
        false,
        'existing account reauthentication needs no new account name'
      )
      await run('new Promise(resolve => setTimeout(resolve, 200))')
      await run(`window.dialogBounds = () => {
        const dialog = document.querySelector('.account-dialog')
        const bounds = element => {
          const rect = element.getBoundingClientRect()
          return [rect.x, rect.y, rect.width, rect.height]
        }
        return [bounds(dialog), ...[...dialog.querySelectorAll('button,input')].map(bounds)]
      }; undefined`)
      const initialBounds = await run('window.dialogBounds()')
      await run('document.querySelector(\'[aria-label="Copy sign-in link"]\').click()')
      const copyFrames = await run(`new Promise(resolve => {
        const frames = []
        const sample = () => {
          frames.push({bounds:window.dialogBounds(),
            text: document.querySelector('.account-dialog__browser-actions').textContent,
            opacity: getComputedStyle(document.querySelector('[aria-label="Copy sign-in link"]')).opacity})
          if (frames.length < 25) requestAnimationFrame(sample)
          else resolve(frames)
        }
        requestAnimationFrame(sample)
      })`)
      for (const frame of copyFrames) {
        assert.deepEqual(
          frame.bounds,
          initialBounds,
          'copying must not resize or shift the dialog or its controls'
        )
        assert.match(frame.text, /Open page/, 'copying must not change the browser action')
        assert.doesNotMatch(frame.text, /Opening/)
        assert.equal(frame.opacity, '1', 'copying must not fade the button')
      }
      assert.equal(await run('window.linksCopied'), 1)
      assert.equal(
        await run('document.querySelector(\'[aria-label="Copy sign-in link"]\').textContent'),
        'Copied'
      )
      assert.match(
        await run('document.querySelector(".account-dialog__authorization").textContent'),
        /another device/
      )
      await run('document.querySelector(\'[aria-label="Open sign-in page"]\').click()')
      assert.equal(await run('window.authorized'), 1)
      await run('document.documentElement.dataset.colorScheme = "dark"')
      // The footer and fields must fit even in a narrow window with larger text.
      for (const [width, fontSize] of [
        [750, '16px'],
        [360, '16px'],
        [360, '20px']
      ]) {
        win.setSize(width, 720)
        await run(`document.documentElement.style.fontSize = ${JSON.stringify(fontSize)}`)
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        assert.equal(
          await run(`(() => {
          const dialog = document.querySelector('.account-dialog')
          const box = dialog.getBoundingClientRect()
          return dialog.scrollWidth <= dialog.clientWidth &&
            [...dialog.querySelectorAll('button,input')].every(element => {
              const rect = element.getBoundingClientRect()
              return rect.left >= box.left && rect.right <= box.right &&
                rect.top >= box.top && rect.bottom <= box.bottom
            })
        })()`),
          true,
          'all controls including Cancel stay inside the dialog'
        )
        if (process.env.SELE_AUTH_DIALOG_SCREENSHOT) {
          await fs.writeFile(
            `${process.env.SELE_AUTH_DIALOG_SCREENSHOT}-${width}-${fontSize}.png`,
            (await win.webContents.capturePage()).toPNG()
          )
        }
      }
      win.setSize(750, 720)
      await run('document.documentElement.style.fontSize = ""')
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click()"
      )
      await run('new Promise(resolve => setTimeout(resolve, 80))')
      assert.equal(await run('window.canceled'), 1)
      assert.equal(
        await run('document.querySelector(\'[aria-label="Send message"]\').disabled'),
        true,
        'cancel must keep sending blocked'
      )
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Sign in again').click()"
      )
      await run('new Promise(resolve => setTimeout(resolve, 80))')
      assert.equal(await run('window.loginCalls'), 2)
      await run('window.confirmSignIn()')
      await run('new Promise(resolve => setTimeout(resolve, 80))')
      assert.equal(
        await run('!!document.querySelector(\'[aria-label="Account sign-in required"]\')'),
        false
      )
      assert.equal(
        await run('document.querySelector("textarea").value'),
        'Keep this draft',
        'reauthentication preserves the composer draft'
      )
      assert.equal(
        await run('document.querySelector(\'[aria-label="Send message"]\').disabled'),
        false
      )
      await run('document.querySelector(\'[aria-label="Retry failed turn"]\').click()')
      assert.equal(
        await run(
          "[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign in again')"
        ),
        false,
        'completed sign-in removes recovery actions'
      )
      assert.deepEqual(await run('window.retried.map(message => message.content)'), [
        'build me a zip to publish using scripts'
      ])
      await run('window.renderFailure(false)')
      assert.equal(
        await run(
          "[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Manage accounts')"
        ),
        false
      )
      assert.doesNotMatch(await run('document.body.textContent'), /Sign in again to continue/)
      await run(
        'window.newChatMode = true; window.authenticationRequired = true; window.renderFailure()'
      )
      assert.equal(
        await run('document.querySelectorAll(\'[aria-label="Account sign-in required"]\').length'),
        1
      )
      assert.equal(
        await run('document.querySelectorAll(\'[aria-label="Request error"]\').length'),
        0,
        'use the sign-in banner instead of the generic request error'
      )
      assert.equal(
        await run('document.querySelectorAll(".chat-detail__message--user").length'),
        0,
        'no submitted message is needed'
      )
      assert.equal(
        await run('document.querySelector(\'[aria-label="Send message"]\').disabled'),
        true
      )
      if (process.env.SELE_AUTH_SCREENSHOT) {
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        await fs.writeFile(
          process.env.SELE_AUTH_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Sign in again').click()"
      )
      await run('new Promise(resolve => setTimeout(resolve, 80))')
      assert.equal(
        await run('window.loginCalls'),
        3,
        'new chats can reauthenticate before submitting a message'
      )
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click()"
      )
      console.log('Claude authentication UI checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
