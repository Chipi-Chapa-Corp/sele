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
            import { updateComposerDraft, addPromptDraft, removePromptDraft } from './src/renderer/src/composerDraft'
            const root = createRoot(document.getElementById('root'))
            function Fixture({editing}) {
              window.drafts = useComposerDrafts(editing)
              return null
            }
            window.render = editing => flushSync(() => root.render(<React.StrictMode><Fixture editing={editing} /></React.StrictMode>))
            window.setMessage = (key, message) => flushSync(() => window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'message', message)))
            window.stash = (key, id, prompt) => flushSync(() => {
              window.drafts.setPromptDraftsByProject(drafts => addPromptDraft(drafts, key, {id, prompt}))
              window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'message', ''))
            })
            window.pop = (key, id, prompt) => flushSync(() => {
              window.drafts.setPromptDraftsByProject(drafts => removePromptDraft(drafts, key, id))
              window.drafts.setComposerDrafts(drafts => updateComposerDraft(drafts, key, 'message', prompt))
            })
            window.snapshot = () => ({composerDrafts: [...window.drafts.composerDrafts], promptDraftsByProject: [...window.drafts.promptDraftsByProject]})
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
        '<div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      for (const mode of ['save', 'restore', 'verify', 'empty']) {
        const result = spawnSync(
          require('electron'),
          [__filename, directory, mode, '--no-sandbox'],
          { env, encoding: 'utf8', timeout: 20000 }
        )
        assert.equal(result.status, 0, result.stderr || result.error?.message)
        assert.ok(result.stdout.includes(`Draft persistence passed: ${mode}`), result.stdout)
      }
      console.log('Composer drafts survive Electron restarts and immediate close')
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
      if (mode === 'save') {
        await run(
          `window.setMessage('new-chat:cwd:/a', 'first draft'); window.stash('new-chat:cwd:/a', 'one', 'first draft'); window.setMessage('new-chat:cwd:/a', 'second draft'); window.stash('new-chat:cwd:/a', 'two', 'second draft'); window.setMessage('new-chat:cwd:/b', 'other project'); window.setMessage('codex:chat', 'chat draft'); window.flush()`
        )
        // Editing replaces the visible input but must not replace the saved normal draft.
        await run(
          `window.render(true); window.setMessage('codex:chat', 'temporary edit'); window.flush()`
        )
      } else if (mode === 'restore') {
        const state = await run('window.snapshot()')
        assert.deepEqual(state.promptDraftsByProject, [
          [
            'new-chat:cwd:/a',
            [
              { id: 'one', prompt: 'first draft' },
              { id: 'two', prompt: 'second draft' }
            ]
          ]
        ])
        assert.equal(new Map(state.composerDrafts).get('new-chat:cwd:/b').message, 'other project')
        assert.equal(new Map(state.composerDrafts).get('codex:chat').message, 'chat draft')
        // Close in the same task as the mutation, before the deferred writer can run.
        await run(
          `window.pop('new-chat:cwd:/a', 'two', 'second draft'); window.setMessage('codex:chat', 'last keystroke'); window.close()`
        )
      } else if (mode === 'verify') {
        const state = await run('window.snapshot()')
        assert.equal(new Map(state.composerDrafts).get('codex:chat').message, 'last keystroke')
        assert.equal(new Map(state.composerDrafts).get('new-chat:cwd:/a').message, 'second draft')
        assert.deepEqual(state.promptDraftsByProject, [
          ['new-chat:cwd:/a', [{ id: 'one', prompt: 'first draft' }]]
        ])
        await run(
          `window.pop('new-chat:cwd:/a', 'one', ''); window.setMessage('codex:chat', ''); window.setMessage('new-chat:cwd:/b', ''); window.close()`
        )
      } else {
        assert.deepEqual(await run('window.snapshot()'), {
          composerDrafts: [],
          promptDraftsByProject: []
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
