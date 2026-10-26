const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-chat-status-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {ChatListItem} from './src/renderer/src/components/ChatListItem'
            import {ChatDetailItem} from './src/renderer/src/components/ChatDetailItem'
            import {createConversationViews} from './src/renderer/src/conversationViews'
            import {createConversationView} from './src/shared/conversationView'
            import {useChatTerminalActivity} from './src/renderer/src/useChatTerminalActivity'
            import {chatTerminalActivity} from './src/renderer/src/chatTerminalActivity'
            window.setAgentTasks = (id, ids) => {
              window.agentTasks[id] = ids
              delete window.agentTaskErrors[id]
              const chat = chats.find(chat => chat.id === id)
              chatTerminalActivity.requestProbe(chat.providerId+':'+id)
            }
            window.failAgentTasks = id => { window.agentTaskErrors[id] = true }
            import './src/renderer/src/assets/styles/tokens.css'
            const root = createRoot(document.getElementById('root'))
            const chats = ['codex', 'claude', 'copilot', 'opencode'].flatMap(providerId => [
              {id:providerId+'-failed', providerId, title:providerId+' — failed latest turn', lastTurnOutcome:'failed'},
              {id:providerId+'-stopped', providerId, title:providerId+' — stopped latest turn', lastTurnOutcome:'stopped'},
              {id:providerId+'-unread', providerId, title:providerId+' — unread completed chat', lastTurnOutcome:null}
            ]).map(chat => ({...chat, status:null, cwd:'/repo', updatedAt:2000, createdAt:1000}))
            const views = createConversationViews()
            for (const chat of chats.filter(chat => chat.lastTurnOutcome)) {
              // Round-trip a viewport captured before shutdown; native sidebar
              // recovery has already observed the stopped/failed turn on restart.
              const key = 'saved-view:' + chat.id
              const saved = JSON.parse(localStorage.getItem(key) || 'null') || createConversationView({
                ...chat, revision:999, status:'active', lastTurnOutcome:null,
                capabilities:{editMessages:true,activeMessages:true},
                items:[{type:'message',id:chat.id+':user',role:'user',content:'Check banners'},
                  {type:'working',id:chat.id+':working',status:'working',items:[]}]
              })
              localStorage.setItem(key, JSON.stringify(saved))
              views.install(chat.providerId, [saved])
            }
            let selected = null
            window.closeChat = () => {selected = null; render()}
            window.completeChat = id => {chats.find(chat => chat.id === id).lastTurnOutcome = null; render()}
            function Fixture() {
              useChatTerminalActivity(chats, chats.find(chat => chat.id === selected) ?? null)
              return <>{chats.map(chat => <div key={chat.id} data-chat={chat.id}>
                <ChatListItem chat={{...chat, seenUpdatedAt:JSON.parse(localStorage.getItem(chat.id) || 'null')}}
                  selected={selected === chat.id}
                  onClick={() => {selected = chat.id; localStorage.setItem(chat.id, '2000'); render()}}
                  onMarkDone={() => {}} onRename={async () => {}} onResolveApproval={() => {}} onTogglePinned={() => {}} />
                {chat.lastTurnOutcome && <ChatDetailItem item={views.get(chat).items.at(-1)} />}
              </div>)}</>
            }
            function render() { flushSync(() => root.render(<Fixture />)) }
            render()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' },
        plugins: [
          {
            name: 'unused-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ],
        outfile: path.join(directory, 'status.js')
      })
      await fs.writeFile(
        path.join(directory, 'status.html'),
        `<!doctype html><html data-color-scheme="dark">
        <link rel="stylesheet" href="status.css"><style>
        body {font:14px system-ui; background:#181818; color:#eee; margin:30px; width:360px}
        #root {display:grid; gap:10px}
        </style><div id="root"></div><script>
          window.agentTasks={}; window.agentTaskErrors={};
          window.providerApi={getChatTerminalTasks:async (_provider,id)=>{
            if(window.agentTaskErrors[id]) throw new Error('Fixture provider disconnected');
            return window.agentTasks[id]||[];
          }};
          window.preferencesApi={getItem:key=>({ok:true,value:localStorage.getItem(key)}),setItem:(key,value)=>{localStorage.setItem(key,value);return{ok:true,value:null}}};
        </script><script src="status.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        {
          env,
          encoding: 'utf8',
          timeout: 30000
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('PASS chat status UI'))
        throw new Error(result.stderr || String(result.error || 'UI checks did not finish'))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.on('window-all-closed', () => {})
  app.whenReady().then(async () => {
    let win
    try {
      const open = async () => {
        win = new BrowserWindow({
          show: false,
          width: 450,
          height: 740,
          webPreferences: { offscreen: true, backgroundThrottling: false }
        })
        await win.loadFile(path.join(directory, 'status.html'))
        await win.webContents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
      }
      const run = (source) => win.webContents.executeJavaScript(source)
      const indicator = (id) =>
        run(`(() => {
        const dot = document.querySelector('[data-chat="${id}"] .chat-list-item__status');
        return dot ? {label:dot.getAttribute('aria-label'), color:getComputedStyle(dot).backgroundColor, width:dot.getBoundingClientRect().width} : null
      })()`)
      await open()
      for (let restart = 0; restart < 2; restart++) {
        for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
          assert.equal((await indicator(provider + '-failed')).label, 'Error')
          assert.equal((await indicator(provider + '-stopped')).label, 'Stopped')
          for (const [suffix, label] of [
            ['failed', 'Failed'],
            ['stopped', 'Stopped']
          ]) {
            const id = provider + '-' + suffix
            assert.equal(
              await run(
                `document.querySelector('[data-chat="${id}"] .chat-detail__working-label')?.textContent.trim()`
              ),
              label,
              'restored chat progress must agree with the sidebar before provider history arrives'
            )
            assert.equal(
              await run(
                `Boolean(document.querySelector('[data-chat="${id}"] .chat-detail__working-spinner'))`
              ),
              false,
              'stopped and failed snapshots cannot keep spinning after restart'
            )
          }
          assert.ok((await indicator(provider + '-failed')).width > 0)
          assert.notEqual(
            (await indicator(provider + '-failed')).color,
            (await indicator(provider + '-stopped')).color
          )
          assert.equal(
            (await indicator(provider + '-unread'))?.label ?? null,
            restart ? null : 'Finished since last viewed'
          )
          for (const suffix of ['failed', 'stopped', 'unread']) {
            const id = provider + '-' + suffix
            await run(
              `document.querySelector('[data-chat="${id}"] .chat-list-item__main').click(); window.closeChat()`
            )
          }
          assert.equal((await indicator(provider + '-failed')).label, 'Error')
          assert.equal((await indicator(provider + '-stopped')).label, 'Stopped')
        }
        if (!restart) {
          win.destroy()
          await open()
        }
      }
      if (process.env.SELE_CHAT_STATUS_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_CHAT_STATUS_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
        for (const suffix of ['failed', 'stopped']) {
          const id = provider + '-' + suffix
          await run(`window.completeChat('${id}')`)
          assert.equal(await indicator(id), null)
        }
      }
      const waitFor = async (source) => {
        const deadline = Date.now() + 8000
        while (!(await run(source))) {
          assert.ok(Date.now() < deadline, 'Timed out: ' + source)
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      }
      for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
        const id = provider + '-unread'
        await run(`window.setAgentTasks('${id}', ['task'])`)
        await waitFor(
          `document.querySelector('[data-chat="${id}"] [aria-label="Terminal task running"]') !== null`
        )
        await run(`window.failAgentTasks('${id}')`)
        await waitFor(
          `document.querySelector('[data-chat="${id}"] [aria-label="Terminal task running"]') === null`
        )
        assert.equal(await indicator(id), null, 'lost telemetry must not announce completion')
        await run(`window.setAgentTasks('${id}', ['task'])`)
        await waitFor(
          `document.querySelector('[data-chat="${id}"] [aria-label="Terminal task running"]') !== null`
        )
        await run(`window.setAgentTasks('${id}', [])`)
        await waitFor(
          `document.querySelector('[data-chat="${id}"] [aria-label="Finished since last viewed"]') !== null`
        )
      }
      win.destroy()
      await open()
      for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
        assert.equal((await indicator(provider + '-unread')).label, 'Finished since last viewed')
      }
      console.log(
        'PASS chat status UI: all four providers, restored progress agrees with terminal sidebar status across restart, unread startup, persistent red/gray dots after read, successful continuation, agent terminal polling, connection loss and recovery, and persisted unread'
      )
      win.destroy()
      app.exit(0)
    } catch (error) {
      console.error(error)
      win?.destroy()
      app.exit(1)
    }
  })
}
