const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-editor-comments-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React, { useCallback, useState } from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import * as monaco from 'monaco-editor'
            import { EditableUnifiedDiff, UnifiedDiff } from './src/renderer/src/components/UnifiedDiff'
            import { Button } from './src/renderer/src/components/Button'
            const fileDiff = { path: 'sample.txt', kind: 'modify', diff: '@@ -1,3 +1,3 @@\\n alpha\\n-beta\\n+bravo\\n gamma' }
            window.comments = []
            window.monaco = monaco
            const addComment = (comment, location) => window.comments.push({comment, ...location})
            function Harness({mode}) {
              const [contents, setContents] = useState('alpha\\nbravo\\ngamma')
              const [openComment, setOpenComment] = useState(null)
              const track = useCallback(action => setOpenComment(() => action), [])
              const props = {fileDiff, onAddComment: addComment, onCommentSelectionChange: track}
              return <>
                <Button id="comment" callback={() => openComment?.()} disabled={!openComment}
                  onMouseDown={event => event.preventDefault()} label="Comment" />
                {mode === 'editable' ? <EditableUnifiedDiff {...props} ariaLabel="Test editor"
                  baselineContents={'alpha\\nbeta\\ngamma'} contents={contents} onChange={setContents}
                  onSave={() => {}} onToggleWordWrap={() => {}} wordWrap={false} />
                  : <UnifiedDiff {...props} />}
              </>
            }
            const root = createRoot(document.getElementById('root'))
            window.renderMode = mode => flushSync(() => root.render(<Harness key={mode} mode={mode} />))
            window.renderMode('editable')
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        plugins: [
          {
            name: 'skip-workers',
            setup(build) {
              build.onLoad({ filter: /\/monacoEnvironment\.ts$/ }, () => ({
                contents: '',
                loader: 'js'
              }))
            }
          }
        ],
        loader: { '.ttf': 'file' },
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'test.js')
      })
      await fs.writeFile(
        path.join(directory, 'test.html'),
        `<!doctype html>
        <link rel="stylesheet" href="test.css">
        <style>:root { --control-height: 32px; --code-font-size: 14px; }
        .editable-unified-diff { height: 480px; width: 800px; }</style>
        <div id="root"></div><script src="test.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Editor comment checks passed')) {
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
    const window = new BrowserWindow({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: { offscreen: true }
    })
    const run = (source) => window.webContents.executeJavaScript(source)
    const settle = () => new Promise((resolve) => setTimeout(resolve, 350))
    const click = async (selector) => {
      const point = await run(`(() => {
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      })()`)
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        clickCount: 1,
        ...point
      })
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        clickCount: 1,
        ...point
      })
      await settle()
    }
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'test.html'))
      await settle()
      await run(
        `window.editor = window.monaco.editor.getEditors().find(e => !e.getOption(window.monaco.editor.EditorOption.readOnly)); window.editor.focus(); window.editor.setPosition({lineNumber: 1, column: 1})`
      )
      for (let i = 0; i < 5; i++) {
        window.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'Right',
          modifiers: ['shift']
        })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right', modifiers: ['shift'] })
      }
      await settle()
      assert.equal(
        await run('window.editor.getModel().getValueInRange(window.editor.getSelection())'),
        'alpha'
      )
      assert.equal(
        await run('window.editor.hasTextFocus()'),
        true,
        'selection retains editor focus'
      )
      assert.equal(await run('!!document.querySelector(".unified-diff__review-form")'), false)
      assert.equal(await run('document.querySelector("#comment").disabled'), false)
      window.webContents.sendInputEvent({ type: 'char', keyCode: 'X' })
      await settle()
      assert.equal(
        await run('window.editor.getValue()'),
        'X\nbravo\ngamma',
        'typing replaces selected text'
      )
      assert.equal(await run('document.querySelector("#comment").disabled'), true)
      const drag = await run(`(() => {
        const rect = window.editor.getDomNode().getBoundingClientRect()
        const point = column => {
          const position = window.editor.getScrolledVisiblePosition({lineNumber: 2, column})
          return {x: Math.round(rect.x + position.left), y: Math.round(rect.y + position.top + position.height / 2)}
        }
        return {start: point(1), end: point(6)}
      })()`)
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        button: 'left',
        clickCount: 1,
        ...drag.start
      })
      await settle()
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        button: 'left',
        modifiers: ['leftbuttondown'],
        ...drag.end
      })
      await settle()
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        button: 'left',
        clickCount: 1,
        ...drag.end
      })
      await settle()
      assert.equal(
        await run('window.editor.getModel().getValueInRange(window.editor.getSelection())'),
        'bravo'
      )
      assert.equal(
        await run('!!document.querySelector(".unified-diff__review-form")'),
        false,
        'mouse selection does not open input'
      )
      assert.equal(await run('window.editor.hasTextFocus()'), true)
      await click('#comment')
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await settle()
      assert.equal(
        await run('!!document.querySelector(".unified-diff__review-form")'),
        false,
        'Escape cancels an explicitly opened comment'
      )
      assert.equal(await run('window.editor.hasTextFocus()'), true)
      await run('window.editor.setSelection(new window.monaco.Selection(2, 1, 3, 4))')
      await settle()
      await click('#comment')
      assert.equal(
        await run('document.activeElement.getAttribute("aria-label")'),
        'Comment on sample.txt'
      )
      await window.webContents.insertText('Check this')
      await settle()
      await click('.unified-diff__review-form button')
      assert.deepEqual(await run('window.comments'), [
        { comment: 'Check this', line: 2, endLine: 3, side: 'new' }
      ])
      assert.equal(await run('!!document.querySelector(".unified-diff__review-form")'), false)
      await run(`window.renderMode('static')`)
      await settle()
      assert.equal(
        await run('document.querySelector("#comment").disabled'),
        true,
        'view change clears selection'
      )
      await run(`(() => {
        const cell = [...document.querySelectorAll('.diff-code')].find(el => el.textContent.includes('bravo'))
        const range = document.createRange(); range.selectNodeContents(cell)
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
        cell.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))
      })()`)
      await settle()
      assert.equal(
        await run('!!document.querySelector(".unified-diff__review-form")'),
        false,
        'diff selection does not open input'
      )
      assert.equal(await run('document.querySelector("#comment").disabled'), false)
      await click('#comment')
      assert.equal(
        await run('document.activeElement.getAttribute("aria-label")'),
        'Comment on sample.txt'
      )
      await window.webContents.insertText('Diff comment')
      await settle()
      await click('.unified-diff__review-form button')
      assert.deepEqual(await run('window.comments[1]'), {
        comment: 'Diff comment',
        line: 2,
        endLine: 2,
        side: 'new'
      })
      assert.equal(
        await run('document.querySelector("#comment").disabled'),
        true,
        'cleared diff selection disables comment'
      )
      console.log(
        'Editor comment checks passed: native replacement, explicit comments, ranges, diff selection, and clearing.'
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
