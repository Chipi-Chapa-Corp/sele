const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-chat-opening-'))
    const baseline = process.argv[2]
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import DOMPurify from 'dompurify'
            import { ChatList } from './src/renderer/src/components/ChatList'
            import { MarkdownMessage } from './src/renderer/src/components/ChatDetailItem'
            import { writeStoredChatMessageBoxSelections, readStoredChatMessageBoxSelections } from './src/renderer/src/messageBoxPreferences'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            window.rowRenders = []
            window.actions = []
            window.sanitizations = 0
            window.preferenceWrites = []
            const preferences = new Map()
            window.preferencesApi = {
              getItem: key => ({ok:true, value:preferences.get(key) ?? null}),
              setItem: (key, value) => { preferences.set(key, value); window.preferenceWrites.push([key,value]); return {ok:true,value:null} }
            }
            window.persistSelection = model => writeStoredChatMessageBoxSelections({'codex:a':{model}})
            window.readSelection = () => readStoredChatMessageBoxSelections()['codex:a'].model
            const sanitize = DOMPurify.sanitize.bind(DOMPurify)
            DOMPurify.sanitize = (...args) => { window.sanitizations++; return sanitize(...args) }
            const sidebar = createRoot(document.getElementById('sidebar'))
            const messages = createRoot(document.getElementById('messages'))
            const chats = Array.from({length:300}, (_, i) => ({
              id: String(i), providerId: 'codex', title: 'Conversation ' + i,
              cwd:'/project', createdAt:Date.now(), updatedAt:Date.now(), status:null,
              ...(i === 10 ? {pendingApproval:{id:'approval', title:'Approve'}} : {})
            }))
            window.renderSidebar = (selected, revision) => flushSync(() => sidebar.render(
              <ChatList chats={chats} selectedChatKey={'codex:' + selected} reorderable
                onSelect={chat => window.actions.push(['select', chat.id, revision])}
                onMarkDone={(chat, done) => window.actions.push(['done', chat.id, done, revision])}
                onRename={async (chat, title) => { window.actions.push(['rename', chat.id, title, revision]) }}
                onResolveApproval={(chat, decision) => window.actions.push(['approval', chat.id, decision, revision])}
                onTogglePinned={chat => window.actions.push(['pin', chat.id, revision])}
                onReorder={chats => window.actions.push(['reorder', chats.slice(0,3).map(chat => chat.id), revision])}
              />
            ))
            const onOpenFileLink = () => {}
            window.renderMessage = (content, key, {footnotes = false, interactive = true, preserveLineBreaks = false, streaming = false} = {}) =>
              flushSync(() => messages.render(<div key={key}>
                <MarkdownMessage className="fixture-message" content={content}
                  onOpenFileLink={interactive ? onOpenFileLink : undefined}
                  preserveLineBreaks={preserveLineBreaks} streaming={streaming}/>
                {footnotes && <MarkdownMessage className="fixture-message" content={content}/>}
              </div>))
            window.click = (selector) => flushSync(() => document.querySelector(selector).click())
            window.drag = async (source, target) => {
              const dataTransfer = new DataTransfer()
              const from = document.querySelector('[data-chat-id="' + source + '"]')
              flushSync(() => from.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer})))
              await new Promise(resolve => requestAnimationFrame(resolve))
              const started = from.className
              const to = document.querySelector('[data-chat-id="' + target + '"]')
              const bounds = to.getBoundingClientRect()
              flushSync(() => to.dispatchEvent(new DragEvent('dragover', {bubbles:true, cancelable:true, dataTransfer, clientY:bounds.bottom - 1})))
              await new Promise(resolve => requestAnimationFrame(resolve))
              const over = to.className
              flushSync(() => document.querySelector('.chat-list').dispatchEvent(new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer})))
              return {started, over, bounds:bounds.toJSON()}
            }
          `,
          loader: 'tsx',
          resolveDir: root
        },
        bundle: true,
        loader: { '.ttf': 'file' },
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'measure-real-components',
            setup(build) {
              // Markdown never opens an editor. Fail if this fixture starts one.
              build.onResolve({ filter: /\?worker$/ }, ({ path }) => ({
                path,
                namespace: 'unused-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents:
                  'export default class { constructor() { throw new Error("Editor worker outside chat-opening fixture") } }',
                loader: 'js'
              }))
              build.onLoad(
                { filter: /(?:ChatListItem|ChatList|ChatDetailItem)\.tsx$/ },
                async ({ path: sourcePath }) => {
                  const file = path.basename(sourcePath)
                  let contents = await fs.readFile(
                    baseline ? path.join(baseline, file) : sourcePath,
                    'utf8'
                  )
                  if (file === 'ChatListItem.tsx') {
                    assert.ok(contents.includes('  const chatTitle ='))
                    contents = contents.replace(
                      '  const chatTitle =',
                      '  window.rowRenders.push(chat.id);\n  const chatTitle ='
                    )
                  }
                  return { contents, loader: 'tsx', resolveDir: path.dirname(sourcePath) }
                }
              )
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css">
        <div style="display:flex;height:800px"><aside id="sidebar" style="width:300px;overflow:auto"></aside>
        <div id="messages" style="width:650px;overflow:auto"></div></div><script src="fixture.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox', ...(baseline ? ['--baseline'] : [])],
        { env, encoding: 'utf8', timeout: 40000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error))
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let exitCode = 0
    try {
      const win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 900,
        webPreferences: { backgroundThrottling: false }
      })
      const errors = []
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await run('renderSidebar(0, 0)')
      await settle()
      const initialRows = await run('rowRenders.length')
      assert.equal(await run('new Set(rowRenders).size'), 300)
      await run('rowRenders = []; renderSidebar(1, 1)')
      const changedRows = await run('[...rowRenders]')
      if (!process.argv.includes('--baseline')) assert.deepEqual(changedRows.sort(), ['0', '1'])
      assert.equal(await run('document.querySelectorAll(".chat-list-item--selected").length'), 1)
      assert.equal(
        await run('document.querySelector(".chat-list-item--selected").dataset.chatId'),
        '1'
      )
      await run(`click('[data-chat-id="10"] .chat-list-item__main');
        click('[data-chat-id="10"] [aria-label="Mark chat done"]');
        click('[data-chat-id="10"] [aria-label="Pin chat"]');
        click('[data-chat-id="10"] [aria-label="Approve approval for Conversation 10"]');
        click('[data-chat-id="10"] [aria-label="Edit chat name"]');`)
      await run(`(() => {
        const input = document.querySelector('[data-chat-id="10"] input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Updated name');
        input.dispatchEvent(new Event('input', {bubbles:true}));
      })()`)
      await run(`click('[data-chat-id="10"] [aria-label="Save chat name"]')`)
      await settle()
      const dragState = await run(`drag('0', '1')`)
      assert.deepEqual(
        await run('actions'),
        [
          ['select', '10', 1],
          ['done', '10', true, 1],
          ['pin', '10', 1],
          ['approval', '10', 'allow', 1],
          ['rename', '10', 'Updated name', 1],
          ['reorder', ['1', '0', '2'], 1]
        ],
        'memoized rows must still dispatch the latest handlers and preserve editing and drag/drop: ' +
          JSON.stringify(dragState)
      )
      const content =
        '# Answer\n\nA **formatted** response with [source](/project/file.ts:12).\n\n' +
        '```typescript\nconst value = "<safe>";\n```\n\n' +
        '| Column | Value |\n| --- | --- |\n| One | Two |\n\n<details><summary>More</summary>Details</details>'
      await run(`renderMessage(${JSON.stringify(content)}, 'first')`)
      const markup = await run('document.querySelector(".fixture-message").innerHTML')
      const beforeRemount = await run('sanitizations')
      await run(`renderMessage(${JSON.stringify(content)}, 'second')`)
      const remountSanitizations = await run(`sanitizations - ${beforeRemount}`)
      if (!process.argv.includes('--baseline')) assert.equal(remountSanitizations, 0)
      assert.equal(await run('document.querySelector(".fixture-message").innerHTML'), markup)
      assert.match(markup, /<strong>formatted<\/strong>/)
      assert.match(markup, /class="token/)
      assert.match(markup, /chat-detail__table/)
      assert.match(markup, /data-file-link-path="\/project\/file.ts"/)
      assert.match(markup, /<details>/)
      await run(`renderMessage(${JSON.stringify(content)}, 'plain-links', {interactive:false})`)
      assert.equal(await run('document.querySelectorAll(".chat-detail__file-link").length'), 0)
      await run(
        `renderMessage(${JSON.stringify('first line\nsecond line')}, 'line-breaks', {preserveLineBreaks:true})`
      )
      assert.ok(await run('!!document.querySelector(".fixture-message br")'))
      const footnotes = 'Footnote[^unique].\n\n[^unique]: Explanation.'
      await run(`renderMessage(${JSON.stringify(footnotes)}, 'footnotes', {footnotes:true})`)
      assert.equal(
        await run(`(() => {
        const ids = [...document.querySelectorAll('#messages [id]')].map(node => node.id);
        return ids.length > 0 && new Set(ids).size === ids.length &&
          [...document.querySelectorAll('#messages a[href^="#"]')].every(link => {
            const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
            return target && link.closest('.fixture-message').contains(target);
          });
      })()`),
        true,
        'identical footnotes in separate messages must link to their own unique IDs'
      )
      await run(`renderMessage('Streaming **start**', 'stream', {streaming:true})`)
      await run(`renderMessage('Streaming **finished**', 'stream', {streaming:true})`)
      await run('new Promise(resolve => setTimeout(resolve, 250))')
      assert.equal(
        await run('document.querySelector(".fixture-message strong").textContent'),
        'finished'
      )
      await run(`renderMessage('Streaming **finished**', 'stream', {streaming:false})`)
      assert.equal(
        await run('document.querySelector(".fixture-message strong").textContent'),
        'finished'
      )
      await run(
        `persistSelection('first'); persistSelection('second'); if (preferenceWrites.length) throw new Error('Synchronous navigation write')`
      )
      await settle()
      await run('new Promise(resolve => setTimeout(resolve, 10))')
      assert.equal(await run('preferenceWrites.length'), 1)
      assert.equal(await run('readSelection()'), 'second')
      await run(`persistSelection('close'); window.dispatchEvent(new Event('beforeunload'))`)
      assert.equal(await run('readSelection()'), 'close')
      assert.equal(await run('preferenceWrites.length'), 2)
      await run(`persistSelection('remount')`)
      assert.equal(await run('readSelection()'), 'remount')
      assert.equal(await run('preferenceWrites.length'), 3)
      assert.deepEqual(errors, [])
      console.log(
        'Chat opening checks passed:',
        JSON.stringify({
          initialRows,
          selectionRowRenders: changedRows.length,
          remountSanitizations,
          markupSha256: require('node:crypto').createHash('sha256').update(markup).digest('hex')
        })
      )
    } catch (error) {
      console.error(error)
      exitCode = 1
    }
    app.exit(exitCode)
  })
}
