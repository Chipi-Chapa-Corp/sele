const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

if (!process.versions.electron) {
  ;(async () => {
    const ts = require('typescript')
    // Exercise production callbacks with real Chromium scroll events and ResizeObserver.
    const extract = (file, name, effectMarker) => {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(path.join(root, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      let expression
      const visit = (node) => {
        if (!effectMarker && ts.isVariableDeclaration(node) && node.name.getText(source) === name)
          expression = node.initializer.getText(source)
        if (
          effectMarker &&
          ts.isCallExpression(node) &&
          ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(source)) &&
          node.arguments[0]?.getText(source).includes(effectMarker)
        )
          expression = node.arguments[0].getText(source)
        ts.forEachChild(node, visit)
      }
      visit(source)
      assert.ok(expression, `Find production callback ${name}`)
      return ts.transpile(`window.${name} = ${expression}`, { target: ts.ScriptTarget.ES2022 })
    }
    const callbacks = [
      extract(
        'src/renderer/src/workspace/useChatInteractionController.tsx',
        'handleChatContentScroll'
      ),
      extract(
        'src/renderer/src/workspace/useConversationViewModel.tsx',
        'handleNativeChatContentScroll'
      ),
      extract('src/renderer/src/workspace/useConversationViewModel.tsx', 'loadChatTurnPage'),
      extract(
        'src/renderer/src/workspace/useConversationViewModel.tsx',
        'restorePageAnchor',
        'const anchor = pendingChatScrollAnchorRef.current'
      ),
      extract(
        'src/renderer/src/workspace/useWorkspaceSelection.tsx',
        'observeContentResize',
        'const observer = new ResizeObserver'
      )
    ].join('\n')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sele-chat-scroll-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import * as layout from './src/renderer/src/chatLayout'
            import * as detail from './src/renderer/src/chatDetailWindow'
            import * as turns from './src/renderer/src/chatTurnWindow'
            import {extendChatCursorWindow} from './src/renderer/src/chatCursorWindow'
            import {getChatDetailFromSnapshot} from './src/renderer/src/workspace/chatControllerUtils'
            Object.assign(window, layout, detail, turns, {getChatDetailFromSnapshot, extendChatCursorWindow})
            ${fs.readFileSync(path.join(__dirname, 'fixtures/chat-scroll.js'), 'utf8')}
            ${callbacks}
          `,
          resolveDir: root,
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        outfile: path.join(directory, 'fixture.js')
      })
      fs.writeFileSync(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <style>#chat {height:300px;width:600px;overflow:auto;overflow-anchor:none} .turn {height:100px}</style>
        <div id="chat"></div><script src="fixture.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 25000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error))
        process.exitCode = 1
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(async () => {
    try {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { backgroundThrottling: false }
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const result = await win.webContents.executeJavaScript('runScrollChecks()')
      assert.deepEqual(
        result.cursorRequests,
        ['older', 'older', 'newer'],
        'programmatic page positioning must not reverse paging'
      )
      assert.equal(result.cursorAutoFollow, false, 'historical page bottom is not the live tail')
      for (const paging of result.normalPaging) {
        assert.equal(paging.before, paging.after, `${paging.direction}: preserve the visible turn`)
      }
      for (const paging of result.delayedPaging) {
        assert.equal(
          paging.before,
          paging.after,
          `${paging.provider}/${paging.direction}: ignore a page after scrolling away`
        )
      }
      for (const update of result.liveUpdates) {
        assert.deepEqual(
          update.after,
          update.before,
          `${update.provider}: live updates preserve history`
        )
      }
      for (const resize of result.resizes) {
        assert.equal(
          resize.after,
          resize.before,
          `${resize.kind}: keep the visible block stationary`
        )
      }
      console.log(
        'Chat scrolling checks passed: cursor navigation, numeric paging, delayed responses, live updates, and content resizing.'
      )
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
}
