const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-files-ui-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChangesContent } from './src/renderer/src/workspace/components/ChangesContent'
            import { getRepositoryFiles, getDefaultFileTreeCollapsedFolders } from './src/renderer/src/changeTree'
            const root = createRoot(document.getElementById('root'))
            window.retries = 0
            window.renderFiles = (state, error = null) => flushSync(() => root.render(
              <ChangesContent changesPaneView="files" changesCwd="/project/nested"
                visibleFilesLoadState={state} fileTreeLoadError={error}
                repositoryFiles={[]} repositoryFileTree={[]} filesEmptyMessage="No files found."
                setFileTreeLoadRequest={update => { window.retries = update(window.retries) }} />
            ))
            window.filePaths = getRepositoryFiles({repositoryRoot: '/project/nested', files: [
              {path: 'src/main.ts'}, {path: 'docs/guide.md'}
            ]})
            window.collapsed = getDefaultFileTreeCollapsedFolders(window.filePaths)
            window.renderFiles('error', "EACCES: permission denied, scandir '/project/nested/private'")
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        plugins: [
          {
            name: 'unused-panels',
            setup(build) {
              build.onLoad(
                { filter: /\/(BrowserPanel|TerminalPanel|RecentReferencesList)\.tsx$/ },
                ({ path: filename }) => ({
                  contents: `export const ${path.basename(filename, '.tsx')} = () => null`,
                  loader: 'js'
                })
              )
            }
          }
        ],
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'files.js')
      })
      await fs.writeFile(
        path.join(directory, 'files.html'),
        '<!doctype html><div id="root"></div><script src="files.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('File tree UI checks passed')) {
        throw new Error(result.stderr || String(result.error || 'Electron check failed'))
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
    const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'files.html'))
      const run = (source) => window.webContents.executeJavaScript(source)
      const error = await run("document.querySelector('[role=alert]').textContent")
      assert.match(error, /Could not list files in \/project\/nested/)
      assert.match(error, /EACCES: permission denied/)
      assert.match(error, /\/project\/nested\/private/)
      await run("document.querySelector('[role=alert] button').click()")
      assert.equal(await run('window.retries'), 1)
      await run("window.renderFiles('loading')")
      assert.equal(await run("document.querySelector('[role=alert]') === null"), true)
      await run("window.renderFiles('ready')")
      assert.match(await run('document.body.textContent'), /No files found/)
      const files = await run('window.filePaths')
      assert.equal(
        files.find((file) => file.displayPath === 'src/main.ts').path,
        '/project/nested/src/main.ts'
      )
      assert.equal(await run('window.collapsed.docs'), true)
      console.log('File tree UI checks passed: error details, retry, recovery, nested paths.')
    } catch (error) {
      console.error(error)
      exitCode = 1
    } finally {
      window.destroy()
      app.exit(exitCode)
    }
  })
}
