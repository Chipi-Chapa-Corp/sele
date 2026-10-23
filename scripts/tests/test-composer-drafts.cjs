const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-drafts-'))
    try {
      const esbuild = require('esbuild')
      await esbuild.build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { useComposerDrafts } from './src/renderer/src/useComposerDrafts'
            import { initializePreferences, flushPreferences } from './src/renderer/src/preferences'
            import { useChatListController } from './src/renderer/src/workspace/useChatListController'
            import { updateStoredComposerDrafts, moveComposerDraftScope } from './src/renderer/src/composerDraftStorage'
            import { updateComposerDraft, addPromptDraft, removePromptDraft } from './src/renderer/src/composerDraft'
            const root = createRoot(document.getElementById('root'))
            function Fixture({editing}) {
              window.drafts = useComposerDrafts(editing)
              return null
            }
            window.render = editing => flushSync(() => root.render(<React.StrictMode><Fixture editing={editing} /></React.StrictMode>))
            window.setMessage = (key, message) => flushSync(() => window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'message', message)))
            window.image = {kind: 'image', name: 'fixture.png', path: '/fixture.png', dataUrl: 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024)}
            window.setImages = (key, attachments) => flushSync(() => window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'attachments', attachments)))
            window.stash = (key, id, prompt) => flushSync(() => {
              window.drafts.setPromptDraftsByScope(drafts => addPromptDraft(drafts, key, {id, prompt}))
              window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'message', ''))
            })
            window.pop = (key, id, prompt) => flushSync(() => {
              window.drafts.setPromptDraftsByScope(drafts => removePromptDraft(drafts, key, id))
              window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'message', prompt))
            })
            window.snapshot = () => ({composerDrafts: [...window.drafts.composerDrafts], promptDraftsByScope: [...window.drafts.promptDraftsByScope]})
            window.move = (from, to) => flushSync(() => updateStoredComposerDrafts(state => moveComposerDraftScope(state, from, to)))
            const chatList = useChatListController({
              applyChatMetadata: () => {}, removeRecentChatCacheEntry: () => {}, selectedChat: null
            })
            window.complete = async keys => {
              const chats = keys.map(key => ({providerId: key.split(':')[0], id: key.slice(key.indexOf(':') + 1), cwd: '/a'}))
              if (chats.length === 1) await chatList.handleMarkChatDone(chats[0])
              else await chatList.handleMarkCwdChatsDone({kind: 'cwd', chats})
              flushSync(() => {})
            }
            window.flush = flushPreferences
            window.ready = initializePreferences().then(() => window.render(false))
          `,
          resolveDir: process.cwd(),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js')
      })
      await esbuild.build({
        stdin: {
          contents: `
            import { ipcRenderer } from 'electron'
            import { createPreferenceClient } from './src/preload/preferenceClient'
            window.preferencesApi = createPreferenceClient({
              initialize: () => ipcRenderer.invoke('drafts:load'),
              write: values => ipcRenderer.invoke('drafts:write', values),
              commit: values => ipcRenderer.sendSync('drafts:commit', values)
            })
          `,
          resolveDir: process.cwd()
        },
        bundle: true,
        platform: 'node',
        external: ['electron'],
        outfile: path.join(directory, 'preload.cjs')
      })
      await esbuild.build({
        entryPoints: ['src/main/database/preferences.ts'],
        bundle: true,
        platform: 'node',
        outfile: path.join(directory, 'storage.cjs')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<div id="root"></div><script>
          window.providerApi = {
            markChatDone: async (_providerId, id, done) => {
              if (window.rejectDone) throw new Error('Expected fixture failure')
              return {id, done}
            },
            markChatsDone: async ids => ids.map(id => ({id, done: true}))
          }
        </script><script src="fixture.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      for (const mode of ['save', 'restore', 'verify', 'released', 'empty']) {
        const result = spawnSync(
          require('electron'),
          [__filename, directory, mode, '--no-sandbox'],
          { env, encoding: 'utf8', timeout: 20000 }
        )
        assert.equal(result.status, 0, result.stderr || result.error?.message)
        assert.ok(result.stdout.includes(`Draft persistence passed: ${mode}`), result.stdout)
      }
      console.log(
        'Composer drafts stay per chat through creation, Done, Electron restarts and immediate close'
      )
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const [directory, mode] = process.argv.slice(2)
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    const db = new (require('better-sqlite3'))(path.join(directory, 'preferences.sqlite'))
    const store = require(path.join(directory, 'storage.cjs')).openPreferences(db)
    store.migrate({})
    ipcMain.handle('drafts:load', () => ({ ok: true, value: store.load() }))
    ipcMain.handle('drafts:write', (_event, values) => {
      store.setMany(values)
      return { ok: true, value: null }
    })
    ipcMain.on('drafts:commit', (event, values) => {
      store.setMany(values)
      event.returnValue = { ok: true, value: null }
    })
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(directory, 'preload.cjs'),
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    const run = (source) => window.webContents.executeJavaScript(source)
    try {
      await window.loadFile(path.join(directory, 'index.html'))
      await run('window.ready')
      const releasedScope = 'new-chat:host\0/a'
      await run(`window.releasedScope = ${JSON.stringify(releasedScope)}`)
      if (mode === 'save') {
        await run(`window.setImages('new-chat:cwd:/a', [window.image])`)
        await run(
          `window.setMessage('new-chat:cwd:/a', 'first draft'); window.stash('new-chat:cwd:/a', 'one', 'first draft'); window.setMessage('new-chat:cwd:/a', 'second draft'); window.stash('new-chat:cwd:/a', 'two', 'second draft'); window.setMessage('new-chat:cwd:/b', 'other project'); window.setMessage('codex:chat', 'chat draft'); window.move('new-chat:cwd:/a', 'codex:created'); window.flush()`
        )
        // Editing replaces the visible input but must not replace the saved normal draft.
        await run(
          `window.render(true); window.setMessage('codex:chat', 'temporary edit'); window.flush()`
        )
      } else if (mode === 'restore') {
        const state = await run('window.snapshot()')
        assert.deepEqual(state.promptDraftsByScope, [
          [
            'codex:created',
            [
              { id: 'one', prompt: 'first draft' },
              { id: 'two', prompt: 'second draft' }
            ]
          ]
        ])
        assert.equal(new Map(state.composerDrafts).get('new-chat:cwd:/b').message, 'other project')
        assert.equal(new Map(state.composerDrafts).get('codex:chat').message, 'chat draft')
        assert.equal(
          new Map(state.composerDrafts).get('codex:created').attachments[0].dataUrl.length,
          2 * 1024 * 1024 + 22
        )
        await run(`window.rejectDone = true; window.complete(['codex:chat'])`)
        assert.equal(
          new Map((await run('window.snapshot()')).composerDrafts).get('codex:chat').message,
          'chat draft'
        )
        await run(`window.rejectDone = false`)
        // Close in the same task as the mutation, before the deferred writer can run.
        await run(
          `window.pop('codex:created', 'two', 'second draft'); window.setMessage('codex:chat', 'last keystroke'); window.setImages('codex:chat', [window.image]); window.close()`
        )
      } else if (mode === 'verify') {
        const state = await run('window.snapshot()')
        assert.equal(new Map(state.composerDrafts).get('codex:chat').message, 'last keystroke')
        assert.equal(new Map(state.composerDrafts).get('codex:created').message, 'second draft')
        assert.equal(
          new Map(state.composerDrafts).get('codex:chat').attachments[0].dataUrl.length,
          2 * 1024 * 1024 + 22
        )
        assert.deepEqual(state.promptDraftsByScope, [
          ['codex:created', [{ id: 'one', prompt: 'first draft' }]]
        ])
        await run(
          `(async () => { window.setMessage('codex:created', 'unsent text'); window.stash('codex:chat', 'bulk', 'bulk saved'); window.setMessage('codex:chat', 'last keystroke'); window.stash('claude:bulk', 'third', 'third draft'); await window.complete(['codex:created']); await window.complete(['codex:chat', 'claude:bulk']); window.close() })()`
        )
      } else if (mode === 'released') {
        const state = await run('window.snapshot()')
        assert.equal(new Map(state.composerDrafts).has('codex:created'), false)
        assert.equal(new Map(state.composerDrafts).has('codex:chat'), false)
        assert.equal(new Map(state.composerDrafts).get('new-chat:cwd:/b').message, 'other project')
        assert.deepEqual(new Map(state.promptDraftsByScope).get(releasedScope), [
          { id: 'one', prompt: 'first draft', newChatsOnly: true },
          { id: 'bulk', prompt: 'bulk saved', newChatsOnly: true },
          { id: 'third', prompt: 'third draft', newChatsOnly: true }
        ])
        await run(`window.move(window.releasedScope, 'codex:next')`)
        const started = await run('window.snapshot()')
        assert.equal(new Map(started.promptDraftsByScope).has('codex:next'), false)
        assert.deepEqual(
          new Map(started.promptDraftsByScope).get(releasedScope),
          new Map(state.promptDraftsByScope).get(releasedScope)
        )
        await run(
          `window.pop(window.releasedScope, 'one', ''); window.pop(window.releasedScope, 'bulk', ''); window.pop(window.releasedScope, 'third', ''); window.setMessage('codex:next', ''); window.setImages('codex:next', []); window.setMessage('new-chat:cwd:/b', ''); window.close()`
        )
      } else {
        assert.deepEqual(await run('window.snapshot()'), {
          composerDrafts: [],
          promptDraftsByScope: []
        })
      }
      console.log(`Draft persistence passed: ${mode}`)
      if (!window.isDestroyed()) window.close()
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
