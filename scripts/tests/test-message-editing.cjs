const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-message-editing-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import { fallbackProviderModels, fallbackProviderApprovalModes, fallbackProviderSandboxModes } from './src/shared/provider'
            const root = createRoot(document.getElementById('root'))
            const noop = () => {}
            window.sends = []
            window.sendSucceeded = true
            window.image = name => ({ kind: 'image', name, path: '/' + name, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=' })
            window.renderComposer = (editSession = null) => flushSync(() => root.render(<React.StrictMode>
              <MessageBox draftScopeKey="chat" draftProjectKey="project" editSession={editSession}
                providerId="codex" model={fallbackProviderModels[0].id} models={fallbackProviderModels}
                agentMode="interactive" agentModes={[]} approvalMode="never" approvalModes={fallbackProviderApprovalModes}
                reasoningEffort="medium" serviceTier={null} sandboxMode="danger-full-access" sandboxModes={fallbackProviderSandboxModes}
                accountUsage={null} accountUsageError={null} accountUsageState="ready" displayUsage="chatContext"
                contextUsage={{source: 'unavailable', usedTokens: null, maxTokens: null}}
                showActions={false} showNotesButton={false} showModelSelector={false} showAccessSelector={false}
                showReviewSelector={false} showSpeedSelector={false} showReasoningSelector={false}
                onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                onCancelEdit={() => window.renderComposer()}
                onSend={async (...args) => {
                  window.sends.push(args)
                  if (window.sendSucceeded) window.renderComposer()
                  return window.sendSucceeded
                }} />
            </React.StrictMode>))
            window.setText = value => {
              const textarea = document.querySelector('textarea')
              Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value)
              textarea.dispatchEvent(new Event('input', {bubbles: true}))
            }
            window.click = label => {
              const button = document.querySelector('[aria-label="' + label + '"]')
              if (!button || button.disabled) throw new Error('Unavailable control: ' + label)
              button.click()
            }
            window.previewNames = () => Array.from(document.querySelectorAll('.message-box__attachment-open')).map(button => button.getAttribute('aria-label'))
            window.renderComposer()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'editing.js')
      })
      await fs.writeFile(
        path.join(directory, 'editing.html'),
        `<!doctype html><link rel="stylesheet" href="editing.css"><div id="root"></div><script>
        window.appApi = {
          selectMessageAttachments: async () => window.nextAttachments || [],
          getClipboardImage: async () => window.nextPastedImage,
          getDroppedMessageAttachments: async () => window.nextAttachments || []
        }
        window.providerApi = { getSkills: async () => [], getApps: async () => [] }
      </script><script src="editing.js"></script>`
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env: environment, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (
        result.status !== 0 ||
        result.error ||
        !result.stdout.includes('Message editing UI checks passed')
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
      webPreferences: { backgroundThrottling: false, offscreen: true }
    })
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'editing.html'))
      const run = (source) => window.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await settle()
      // Original composer draft survives both cancellation and successful editing.
      await run(
        `window.setText('original draft'); window.nextAttachments = [window.image('draft.png')]; window.click('Attach files')`
      )
      await settle()
      await run(
        `window.renderComposer({id: 'message', type: 'message', content: 'caption', attachments: [window.image('one.png'), window.image('two.png')]})`
      )
      await settle()
      assert.deepEqual(await run('window.previewNames()'), ['Open one.png', 'Open two.png'])
      assert.equal(
        await run(`document.querySelector('[aria-label="Attach files"]').disabled`),
        false
      )
      await run(
        `window.click('Remove one.png'); window.nextAttachments = [window.image('three.png')]; window.click('Attach files')`
      )
      await settle()
      assert.deepEqual(await run('window.previewNames()'), ['Open two.png', 'Open three.png'])
      await run(`window.setText('revised caption')`)
      await settle()
      await run(`window.click('Save edit')`)
      await settle()
      assert.deepEqual(await run('window.sends[0][2].map(image => image.path)'), [
        '/two.png',
        '/three.png'
      ])
      assert.equal(await run('window.sends[0][0]'), 'revised caption')
      assert.equal(await run(`document.querySelector('textarea').value`), 'original draft')
      assert.deepEqual(await run('window.previewNames()'), ['Open draft.png'])
      // Image-only edits are valid and failed saves retain all edited attachments.
      await run(
        `window.renderComposer({id: 'image-only', type: 'pending', content: '', attachments: [window.image('only.png')]}); window.sendSucceeded = false`
      )
      await settle()
      await run(`window.click('Save edit')`)
      await settle()
      assert.equal(await run('window.sends[1][0]'), '')
      assert.deepEqual(await run('window.sends[1][2].map(image => image.path)'), ['/only.png'])
      assert.deepEqual(await run('window.previewNames()'), ['Open only.png'])
      // Real clipboard/drop events remain enabled in the edit composer.
      await run(`(() => {
        window.nextPastedImage = window.image('pasted.png')
        const data = new DataTransfer(); data.items.add(new File(['image'], 'pasted.png', {type: 'image/png'}))
        document.querySelector('textarea').dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}))
      })()`)
      await settle()
      assert.deepEqual(await run('window.previewNames()'), ['Open only.png', 'Open pasted.png'])
      await run(`(() => {
        window.nextAttachments = [window.image('dropped.png')]
        const data = new DataTransfer(); data.items.add(new File(['image'], 'dropped.png', {type: 'image/png'}))
        document.querySelector('.message-box__input').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: data}))
      })()`)
      await settle()
      assert.deepEqual(await run('window.previewNames()'), [
        'Open only.png',
        'Open pasted.png',
        'Open dropped.png'
      ])
      await run(
        `Array.from(document.querySelectorAll('[aria-label^="Remove "]')).forEach(button => button.click())`
      )
      await settle()
      await run(`window.setText('text only')`)
      await settle()
      await run(`window.click('Save edit')`)
      await settle()
      assert.deepEqual(await run('window.sends[2][2]'), [])
      // Switching the edit target must not overwrite the saved normal draft.
      await run(
        `window.renderComposer({id: 'other', type: 'message', content: 'other', attachments: [window.image('other.png')]})`
      )
      await settle()
      await run(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Cancel').click()`
      )
      await settle()
      assert.equal(await run(`document.querySelector('textarea').value`), 'original draft')
      assert.deepEqual(await run('window.previewNames()'), ['Open draft.png'])
      // An attachment picker finishing after cancellation cannot alter the restored draft.
      await run(
        `window.renderComposer({id: 'loading', type: 'message', content: 'caption', attachments: [window.image('loading.png')]}); window.appApi.selectMessageAttachments = () => new Promise(resolve => {window.finishSelection = resolve}); void 0`
      )
      await settle()
      await run(`window.click('Attach files')`)
      await settle()
      assert.equal(await run(`document.querySelector('[aria-label="Save edit"]').disabled`), true)
      await run(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === 'Cancel').click()`
      )
      await settle()
      await run(`window.finishSelection([window.image('late.png')])`)
      await settle()
      assert.equal(await run(`document.querySelector('textarea').value`), 'original draft')
      assert.deepEqual(await run('window.previewNames()'), ['Open draft.png'])
      console.log(
        'Message editing UI checks passed: preserve/add/remove screenshots, image-only saves, failed-save retention, paste/drop, and draft restoration.'
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
