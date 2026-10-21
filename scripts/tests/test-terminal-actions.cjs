const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-terminal-actions-'))
    try {
      const { build } = require('esbuild')
      await fs.symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir')
      await build({
        stdin: {
          contents: `export { registerTerminalIpc, disposeTerminalSessions } from './src/main/registerTerminalIpc'; export { stopPtys } from './src/main/pty'`,
          resolveDir: process.cwd(),
          loader: 'ts'
        },
        outfile: path.join(directory, 'terminal.cjs'),
        bundle: true,
        platform: 'node',
        external: ['electron', '@lydell/node-pty', 'better-sqlite3'],
        plugins: [
          {
            name: 'current-container-fixture',
            setup(build) {
              build.onLoad({ filter: /\/currentContainer\.ts$/ }, () => ({
                // Exercise the current-container launch branch without host/runtime probes.
                contents: `export const getCurrentContainerHostBridge = async () => null;
                  export const isCurrentContainerTarget = async () => true;`,
                loader: 'ts'
              }))
            }
          }
        ]
      })
      await build({
        entryPoints: ['src/preload/index.ts'],
        outfile: path.join(directory, 'preload.cjs'),
        bundle: true,
        platform: 'node',
        external: ['electron']
      })
      await build({
        stdin: {
          contents: `
            import React, {useState} from 'react'
            import {createRoot} from 'react-dom/client'
            import {Terminal} from '@xterm/xterm'
            import {TerminalPanel} from './src/renderer/src/components/TerminalPanel'
            import {ChatListItem} from './src/renderer/src/components/ChatListItem'
            import {chatTerminalActivity} from './src/renderer/src/chatTerminalActivity'
            window.taskSnapshot = key => chatTerminalActivity.getSnapshot(key)
            window.readTasks = key => chatTerminalActivity.markSeen(key)
            chatTerminalActivity.setIdle('codex:fixture', true)
            chatTerminalActivity.setIdle('claude:other', true)
            window.terminals = []
            const open = Terminal.prototype.open
            Terminal.prototype.open = function(...args) {
              window.terminals.push(this)
              return open.apply(this, args)
            }
            function Fixture() {
              const [request, setRequest] = useState(null)
              const [chatKey, selectChat] = useState('codex:fixture')
              window.selectChat = selectChat
              window.launch = (command, closeOnFinish) => setRequest({
                id: crypto.randomUUID(), chatKey, command, closeOnFinish, focus: true, label: 'Deploy',
                cwd: ${JSON.stringify(directory)}, projectCwd: ${JSON.stringify(directory)},
                workspaceKey: 'fixture', container: {kind: 'container', tool: 'toolbox', name: 'fixture'}
              })
              return <><ChatListItem chat={{id:'fixture', providerId:'codex', title:'Chat with terminal task', status:null,
                createdAt:1000, updatedAt:2000, seenUpdatedAt:2000, cwd:'/tmp', lastTurnOutcome:null}}
                selected={false} onClick={() => {}} onMarkDone={() => {}} onRename={async () => {}}
                onResolveApproval={() => {}} onTogglePinned={() => {}} />
              <TerminalPanel active chatKey={chatKey} container={{kind: 'container', tool: 'toolbox', name: 'fixture'}}
                cwd={${JSON.stringify(directory)}} projectCwd={${JSON.stringify(directory)}}
                workspaceKey="fixture" commandLaunchRequest={request} /></>
            }
            createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture /></React.StrictMode>)
          `,
          resolveDir: process.cwd(),
          loader: 'tsx'
        },
        outfile: path.join(directory, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        jsx: 'automatic'
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html><html data-color-scheme="dark"><head><meta charset="utf-8">
          <link rel="stylesheet" href="fixture.css"><style>
          html,body,#root {margin:0;width:100%;height:100%;background:#121212;color:#eee}
          #root {display:grid;grid-template-rows:auto minmax(0,1fr);font:14px system-ui}
          </style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      environment.XDG_CONFIG_HOME = path.join(directory, 'config')
      environment.XDG_CACHE_HOME = path.join(directory, 'cache')
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox', '--ozone-platform=x11'],
        { env: environment, encoding: 'utf8', timeout: 45000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error) {
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
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.setAppLogsPath(path.join(directory, 'logs'))
  app.disableHardwareAcceleration()
  // Keep shell startup deterministic and independent of the user's shell config.
  const userInfo = os.userInfo
  os.userInfo = () => ({
    ...userInfo(),
    shell: process.env.SELE_TERMINAL_FIXTURE_SHELL || '/bin/sh'
  })
  const terminal = require(path.join(directory, 'terminal.cjs'))
  terminal.registerTerminalIpc()
  app
    .whenReady()
    .then(async () => {
      const window = new BrowserWindow({
        show: false,
        width: 1000,
        height: 600,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          backgroundThrottling: false,
          offscreen: true
        }
      })
      window.webContents.on('console-message', (details) => {
        if (details.level === 'error') console.error('Renderer:', details.message)
      })
      let exitCode = 0
      try {
        await window.loadFile(path.join(directory, 'index.html'))
        const run = (source) =>
          window.webContents.executeJavaScript(source).catch((error) => {
            throw new Error(source, { cause: error })
          })
        const waitFor = async (source) => {
          const deadline = Date.now() + 8000
          while (!(await run(source))) {
            assert.ok(Date.now() < deadline, `Timed out: ${source}`)
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
        }
        await waitFor('window.terminals?.length > 0')
        await run(String.raw`window.text = terminal => Array.from({length: terminal.buffer.active.length},
        (_, index) => terminal.buffer.active.getLine(index).translateToString(true)).join('\n'); undefined`)

        // A function records SSH arguments without making any network connection.
        const command = process.env.SELE_TERMINAL_FIXTURE_SHELL?.endsWith('fish')
          ? `function ssh; printf 'OUTPUT:<%s>\\\\n' $argv; end; ssh -t user@fixture 'pm3 restart fixture'`
          : `ssh() { printf 'OUTPUT:<%s>\\\\n' "$@"; }; ssh -t user@fixture 'pm3 restart fixture'`
        await run(`window.launch(${JSON.stringify(command)}, false)`)
        await waitFor(
          `window.terminals.some(t => window.text(t).includes('OUTPUT:<pm3 restart fixture>'))`
        )
        const output = await run('window.text(window.terminals.at(-1))')
        assert.ok(output.includes(`$ ${command}`), 'The terminal displays the executed command')
        assert.ok(output.indexOf(`$ ${command}`) < output.indexOf('OUTPUT:<-t>'))
        assert.ok(output.includes('OUTPUT:<user@fixture>'), 'Quoted arguments reach the command')
        assert.equal(
          await run(`document.querySelectorAll('[aria-label="Deploy"][role="region"]').length`),
          1
        )
        await waitFor(
          `window.taskSnapshot('codex:fixture').unread === true && !window.taskSnapshot('codex:fixture').running`
        )
        assert.equal(
          await run(`document.querySelector('[aria-label="Finished since last viewed"]') !== null`),
          true
        )
        await run(`window.readTasks('codex:fixture')`)
        assert.ok(
          !output.includes('[process exited'),
          'Keep-open action leaves an interactive shell'
        )

        // The close-on-finish mode must execute once, then remove just its action tab.
        const marker = path.join(directory, 'completed')
        await run(`window.launch(${JSON.stringify(`printf 'ran\n' >> '${marker}'`)}, true)`)
        await waitFor(`document.querySelectorAll('[aria-label="Deploy"][role="region"]').length === 1
        && window.terminals.length >= 3`)
        assert.equal(await fs.readFile(marker, 'utf8'), 'ran\n', 'Action runs exactly once')
        assert.equal(
          await run(`document.querySelectorAll('[aria-label="Terminal 1"][role="region"]').length`),
          1
        )
        await run(`window.readTasks('codex:fixture')`)
        const once = path.join(directory, 'task-once')
        await run(`window.launch(${JSON.stringify(`sleep 0.6; printf done >> '${once}'`)}, false)`)
        await waitFor(`document.querySelector('[aria-label="Terminal task running"]') !== null`)
        if (process.env.SELE_TERMINAL_TASK_SCREENSHOT) {
          await fs.writeFile(
            process.env.SELE_TERMINAL_TASK_SCREENSHOT,
            (await window.webContents.capturePage()).toPNG()
          )
        }
        await run(`window.selectChat('claude:other')`)
        await waitFor(
          `window.taskSnapshot('codex:fixture').unread && !window.taskSnapshot('codex:fixture').running`
        )
        assert.equal(await run(`window.taskSnapshot('claude:other').unread`), false)
        assert.equal(
          await fs.readFile(once, 'utf8'),
          'done',
          'Switching chats must not restart the terminal command'
        )
        assert.equal(
          await run(`document.querySelector('[aria-label="Finished since last viewed"]') !== null`),
          true
        )
        if (process.env.SELE_TERMINAL_FIXTURE_SHELL?.endsWith('fish')) {
          await run(`window.readTasks('claude:other')`)
          await run(`window.terminals.at(-1).input('printf QUICK_TASK_DONE\\r', true)`)
          await waitFor(
            `window.taskSnapshot('claude:other').unread && !window.taskSnapshot('claude:other').running`
          )
          await waitFor(`window.text(window.terminals.at(-1)).includes('QUICK_TASK_DONE')`)
        }
        console.log(
          'Terminal action UI passed: real PTY output, keep-open/close-on-finish, terminal icon, idle completion unread, chat ownership, no restart, StrictMode.'
        )
      } catch (error) {
        console.error(error)
        exitCode = 1
      } finally {
        terminal.disposeTerminalSessions()
        await terminal.stopPtys()
        window.destroy()
        app.exit(exitCode)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
