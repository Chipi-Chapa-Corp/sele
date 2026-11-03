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
          contents: `export { registerTerminalIpc, disposeTerminalSessions } from './src/main/registerTerminalIpc'; export { stopPtys } from './src/main/pty'; export { agentTerminalSessions } from './src/main/agentTerminalSessions'; export { createClaudeTerminalSessions } from './src/main/providers/claude/ClaudeTerminalSessions'; export { createAgentTerminalOutputReader } from './src/main/agentTerminalOutput'`,
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
              build.onLoad({ filter: /\/database\/sshEnvironments\.ts$/ }, () => ({
                contents: 'export const getSshEnvironment = async () => null',
                loader: 'ts'
              }))
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
            import {TerminalPanel, TerminalSession} from './src/renderer/src/components/TerminalPanel'
            import {ChatListItem} from './src/renderer/src/components/ChatListItem'
            import {chatTerminalActivity} from './src/renderer/src/chatTerminalActivity'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            window.taskSnapshot = key => chatTerminalActivity.getSnapshot(key)
            window.terminals = []
            const open = Terminal.prototype.open
            Terminal.prototype.open = function(...args) {
              window.terminals.push(this)
              return open.apply(this, args)
            }
            function Fixture() {
              const [request, setRequest] = useState(null)
              const [active, setActive] = useState(true)
              window.setTerminalActive = setActive
              const [workspaceKey, setWorkspaceKey] = useState(${JSON.stringify(`toolbox:fixture${String.fromCharCode(0)}${directory}`)})
              window.selectWorkspace = setWorkspaceKey
              const [chatKey, selectChat] = useState('codex:fixture')
              window.selectChat = selectChat
              window.launch = (command, closeOnFinish) => setRequest({
                id: crypto.randomUUID(), chatKey, command, closeOnFinish, focus: true, label: 'Deploy',
                cwd: ${JSON.stringify(directory)}, projectCwd: ${JSON.stringify(directory)},
                workspaceKey, container: {kind: 'container', tool: 'toolbox', name: 'fixture'}
              })
              return <><input id="focus-target" style={{position:'fixed',right:0,top:0,width:100}} /><ChatListItem chat={{id:'fixture', providerId:'codex', title:'Chat with terminal task', status:null,
                createdAt:1000, updatedAt:2000, seenUpdatedAt:2000, cwd:'/tmp', lastTurnOutcome:null}}
                selected={false} onClick={() => {}} onMarkDone={() => {}} onRename={async () => {}}
                onResolveApproval={() => {}} onTogglePinned={() => {}} />
              <TerminalPanel active={active} chatKey={chatKey} container={{kind: 'container', tool: 'toolbox', name: 'fixture'}}
                cwd={${JSON.stringify(directory)}} projectCwd={${JSON.stringify(directory)}}
                workspaceKey={workspaceKey} commandLaunchRequest={request} /></>
            }
            const root = createRoot(document.getElementById('root'))
            root.render(<React.StrictMode><Fixture /></React.StrictMode>)
            const retainedOutput = {value: ''}
            const ignore = () => {}
            window.renderExpired = sourceId => root.render(<TerminalSession
              outputCache={retainedOutput} agentSessionId={sourceId} agentInteractive={false}
              chatKey={null} initialChatKey={null} closeOnCommandFinish container={null}
              cwd={${JSON.stringify(directory)}} initialCommand="/usr/bin/bash -lc 'PORT=43187 npm run dev'"
              label="Ended process" tabId="expired-fixture" visible focusOnShow={false}
              onInterrupt={ignore} onCommandFinish={ignore} onInput={ignore} onStateChange={ignore}
            />)
          `,
          resolveDir: process.cwd(),
          loader: 'tsx'
        },
        outfile: path.join(directory, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        plugins: [
          {
            name: 'memory-preferences',
            setup(builder) {
              builder.onLoad({ filter: /\/renderer\/src\/preferences\.ts$/ }, () => ({
                contents: `const values = new Map(); export const preferences = {
                getItem: key => values.get(key) ?? null,
                setItem: (key, value) => { values.set(key, value) },
                removeItem: key => { values.delete(key) }
              }; export const initializePreferences = async () => {};
              export const flushPreferences = async () => {};`,
                loader: 'ts'
              }))
            }
          }
        ]
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
        show: true,
        width: 1000,
        height: 600,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          backgroundThrottling: false,
          offscreen: false
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
            if (Date.now() >= deadline)
              console.error(
                await run(`({
              html: document.body.innerHTML.slice(0, 5000), emptyConnected: window.emptySession?.isConnected,
              sessions: [...document.querySelectorAll('.terminal-panel__session')].map(el => ({ label: el.getAttribute('aria-label'), hidden: el.hidden })),
              terminals: window.terminals.map(t => ({ disabled: t.options.disableStdin, output: window.text ? window.text(t) : '' }))
            })`)
              )
            assert.ok(Date.now() < deadline, `Timed out: ${source}`)
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
        }
        await waitFor('window.terminals?.length > 0')
        await run(String.raw`window.text = terminal => Array.from({length: terminal.buffer.active.length},
        (_, index) => terminal.buffer.active.getLine(index).translateToString(true)).join('\n'); undefined`)

        // Auto-closing actions leave an existing empty tab available for the next action.
        const autoCloseMarker = path.join(directory, 'auto-close-empty')
        await run(`window.emptySession = document.querySelector('[aria-label="Terminal 1"][role="region"]');
          window.launch(${JSON.stringify(`printf done > '${autoCloseMarker}'`)}, true)`)
        await waitFor(
          `window.terminals.length >= 2 && document.querySelectorAll('.terminal-panel__session').length === 1`
        )
        assert.equal(await fs.readFile(autoCloseMarker, 'utf8'), 'done')
        assert.equal(await run('window.emptySession.isConnected'), true)

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
        assert.equal(await run('window.emptySession.isConnected'), true, 'Reuses the empty tab')
        assert.equal(await run(`document.querySelectorAll('.terminal-panel__session').length`), 1)
        await waitFor(`!window.taskSnapshot('codex:fixture').running`)
        assert.equal(
          await run(`document.querySelector('[aria-label="Finished since last viewed"]') !== null`),
          false,
          'Terminal completion must not mark the chat unread'
        )
        assert.ok(
          !output.includes('[process exited'),
          'Keep-open action leaves an interactive shell'
        )

        // The close-on-finish mode must execute once, then remove just its action tab.
        const marker = path.join(directory, 'completed')
        await run(`window.terminalCount = window.terminals.length;
          window.launch(${JSON.stringify(`printf 'ran\n' >> '${marker}'`)}, true)`)
        await waitFor(`document.querySelectorAll('[aria-label="Deploy"][role="region"]').length === 1
        && window.terminals.length > window.terminalCount`)
        assert.equal(await fs.readFile(marker, 'utf8'), 'ran\n', 'Action runs exactly once')
        assert.equal(
          await run(`document.querySelectorAll('[aria-label="Terminal 1"][role="region"]').length`),
          0
        )
        const once = path.join(directory, 'task-once')
        // A shell with a draft is not empty. Find another blank tab even when it is inactive.
        await run(`window.terminalCount = window.terminals.length;
          document.querySelector('[aria-label="New terminal"]').click()`)
        await waitFor(`window.terminals.length > window.terminalCount &&
          window.terminals.at(-1).options.disableStdin === false`)
        await run(`window.terminals.at(-1).input('printf DRAFT', true)`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('printf DRAFT')`)
        await run(`window.draftTerminal = window.terminals.at(-1);
          window.launch('printf USED_TAB_PRESERVED', false)`)
        await waitFor(`document.querySelectorAll('.terminal-panel__session').length === 3`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('USED_TAB_PRESERVED')`)
        await run(`document.querySelector('[aria-label="New terminal"]').click()`)
        await waitFor(`document.querySelectorAll('.terminal-panel__session').length === 4`)
        await run(`document.querySelector('[aria-label="Terminal 2"][aria-pressed]').click()`)
        await run(`window.launch(${JSON.stringify(`sleep 0.6; printf done >> '${once}'`)}, false)`)
        await waitFor(`document.querySelector('[aria-label="Terminal task running"]') !== null`)
        if (process.env.SELE_TERMINAL_TASK_SCREENSHOT) {
          await fs.writeFile(
            process.env.SELE_TERMINAL_TASK_SCREENSHOT,
            (await window.webContents.capturePage()).toPNG()
          )
        }
        await run(`window.selectChat('claude:other')`)
        await waitFor(`!window.taskSnapshot('codex:fixture').running`)
        assert.equal(await run(`window.taskSnapshot('claude:other').running`), false)
        assert.equal(
          await fs.readFile(once, 'utf8'),
          'done',
          'Switching chats must not restart the terminal command'
        )
        assert.equal(await run(`document.querySelectorAll('.terminal-panel__session').length`), 4)
        assert.ok(await run(`window.text(window.draftTerminal).includes('printf DRAFT')`))
        assert.equal(
          await run(`document.querySelector('[aria-label="Finished since last viewed"]') !== null`),
          false,
          'Background terminal completion must not mark the chat unread'
        )
        if (process.env.SELE_TERMINAL_FIXTURE_SHELL?.endsWith('fish')) {
          await run(`window.terminals.at(-1).input('printf QUICK_TASK_DONE\\r', true)`)
          await waitFor(`window.text(window.terminals.at(-1)).includes('QUICK_TASK_DONE')`)
          await waitFor(`!window.taskSnapshot('claude:other').running`)
        }
        // Native jobs use the same tab strip and xterm, without rerunning their commands.
        const sources = terminal.agentTerminalSessions
        let stopped = 0
        const sourceOptions = {
          providerId: 'claude',
          chatId: 'agent-chat',
          chatTitle: 'Fix the background terminal visibility',
          cwd: directory,
          container: { kind: 'container', tool: 'toolbox', name: 'fixture' },
          command: 'npm run dev',
          background: true,
          stop: async () => {
            stopped++
          }
        }
        const label = (index) => `Fix the background … ${index}`
        const tab = (index) =>
          `document.querySelector('[aria-label="${label(index)}"][aria-pressed]')`
        const region = (index) =>
          `document.querySelector('[aria-label="${label(index)}"][role="region"]')`
        await run(`window.confirm = () => true;
          window.previousTab = document.querySelector('.terminal-panel__tabs [aria-pressed="true"]');
          document.getElementById('focus-target').focus()`)
        const unseen = sources.register('native-unseen', sourceOptions)
        unseen.append('server ready\r\n')
        await waitFor(`${tab(1)} !== null`)
        assert.equal(await run(`window.previousTab.getAttribute('aria-pressed')`), 'true')
        assert.equal(
          await run(`document.activeElement.id`),
          'focus-target',
          'Creation leaves keyboard focus alone'
        )
        assert.equal(await run(`${region(1)}.hidden`), true)
        await unseen.finish()
        await waitFor(`${tab(1)} === null`)

        const viewed = sources.register('native-viewed', sourceOptions)
        viewed.append('server ready\r\n')
        await waitFor(`${tab(2)} !== null`)
        await run(`${tab(2)}.click()`)
        await waitFor(`${region(2)}.hidden === false`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('server ready')`)
        assert.match(await run('window.text(window.terminals.at(-1))'), /\$ npm run dev/)
        assert.equal(await run('window.terminals.at(-1).options.disableStdin'), true)
        // Match a narrow sidebar with enough history to show and exercise xterm's scrollbar.
        window.setSize(460, 700)
        viewed.append(
          Array.from({ length: 200 }, (_, index) => `line ${index}: terminal output\r\n`).join('')
        )
        await waitFor(
          `window.terminals.at(-1).cols < 60 && window.terminals.at(-1).buffer.active.baseY > 100`
        )
        const geometry = await run(`(() => {
          const host = document.querySelector('.terminal-panel__session--active .terminal-panel__host')
          const screen = host.querySelector('.xterm-screen')
          const bar = host.querySelector('.xterm-scrollable-element > .scrollbar.vertical')
          const slider = bar.querySelector('.slider')
          return { host: host.getBoundingClientRect().width, screen: screen.getBoundingClientRect().width,
            bar: bar.getBoundingClientRect().width, slider: slider.getBoundingClientRect().width }
        })()`)
        assert.equal(geometry.bar, 14, JSON.stringify(geometry))
        assert.ok(geometry.slider <= geometry.bar, JSON.stringify(geometry))
        assert.ok(geometry.screen >= geometry.host - 32, 'Terminal text must use the sidebar width')
        // A terminal only draws whole rows; the remaining space must keep the panel's color.
        const assertTerminalBackground = async () => {
          const sample = await run(`(() => {
            const host = document.querySelector('.terminal-panel__session--active .terminal-panel__host')
            const viewport = host.querySelector('.xterm-viewport').getBoundingClientRect()
            const screen = host.querySelector('.xterm-screen').getBoundingClientRect()
            return {
              x: Math.floor(viewport.left + 32),
              y: Math.floor((screen.bottom + viewport.bottom) / 2),
              gap: viewport.bottom - screen.bottom,
              background: getComputedStyle(document.querySelector('.terminal-panel__workspace')).backgroundColor
            }
          })()`)
          assert.ok(sample.gap >= 2, `Fixture must leave space below the last row: ${sample.gap}`)
          const pixel = (
            await window.webContents.capturePage({
              x: sample.x,
              y: sample.y,
              width: 1,
              height: 1
            })
          ).toBitmap()
          const expected = sample.background.match(/\d+/g).slice(0, 3).map(Number)
          assert.deepEqual(
            [pixel[2], pixel[1], pixel[0]],
            expected,
            'Space below the last terminal row must match the terminal background'
          )
        }
        await assertTerminalBackground()
        await run(`document.documentElement.dataset.colorScheme = 'light'`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        await assertTerminalBackground()
        await run(`document.documentElement.dataset.colorScheme = 'dark'`)
        // Sample during the switch, when a whole-panel opacity animation would blink.
        for (const target of ['window.previousTab', tab(2)]) {
          const opacity = await run(`(async () => {
            ${target}.click()
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            return getComputedStyle(document.querySelector('.terminal-panel')).opacity
          })()`)
          assert.equal(Number(opacity), 1, 'Switching terminal tabs must keep the panel opaque')
        }
        if (process.env.SELE_TERMINAL_STYLE_SCREENSHOT) {
          await fs.writeFile(
            process.env.SELE_TERMINAL_STYLE_SCREENSHOT,
            (await window.webContents.capturePage()).toPNG()
          )
        }
        await run(`window.terminals.at(-1).scrollToTop()`)
        await waitFor(`window.terminals.at(-1).buffer.active.viewportY === 0`)
        await run(`window.terminals.at(-1).scrollLines(5)`)
        await waitFor(`window.terminals.at(-1).buffer.active.viewportY > 0`)
        assert.equal(await run(`document.querySelector('[aria-label="Restart terminal"]')`), null)
        window.setSize(1000, 600)
        await viewed.finish()
        await waitFor(`window.text(window.terminals.at(-1)).includes('process exited')`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          await run(`${tab(2)} !== null`),
          true,
          'An opened tab remains after completion'
        )

        sources.register('native-stopped', sourceOptions)
        await waitFor(`${tab(3)} !== null`)
        await run(`document.querySelector('[aria-label="Close ${label(3)}"]').click()`)
        await waitFor(`${tab(3)} === null`)
        assert.equal(stopped, 1, 'Closing cancels the original native task')

        // A previously opened native tab stays interactive when the source has a PTY.
        const input = []
        const interactive = sources.register('native-interactive', {
          ...sourceOptions,
          write: (data) => {
            input.push(data)
            interactive.append('echo:' + data)
          }
        })
        await waitFor(`${tab(4)} !== null`)
        await run(`${tab(4)}.click()`)
        await waitFor(`window.terminals.at(-1).options.disableStdin === false`)
        await run(`window.terminals.at(-1).input('status\\r', true)`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('echo:status')`)
        assert.deepEqual(input, ['status\r'])
        await interactive.finish()
        await waitFor(`window.text(window.terminals.at(-1)).includes('process exited')`)

        // A hidden terminal panel and a different project's tabs are not opened by new jobs.
        await run(
          `window.setTerminalActive(false); document.getElementById('focus-target').focus()`
        )
        const hidden = sources.register('native-hidden', sourceOptions)
        await waitFor(`${tab(5)} !== null`)
        assert.equal(await run(`${region(5)}.hidden`), true)
        assert.equal(await run(`document.activeElement.id`), 'focus-target')
        await hidden.finish()
        await waitFor(`${tab(5)} === null`)

        const otherDirectory = path.join(directory, 'another-project')
        const otherKey = `toolbox:fixture${String.fromCharCode(0)}${otherDirectory}`
        const firstVisible = sources.register('native-first-visible', {
          ...sourceOptions,
          chatId: 'first',
          chatTitle: 'First chat',
          cwd: otherDirectory
        })
        await waitFor(
          `document.querySelector('[aria-label="First chat 1"][role="region"]') !== null`
        )
        // This first job was created while hidden. Opening its project and the panel counts as viewing it.
        await run(
          `window.selectWorkspace(${JSON.stringify(otherKey)}); window.setTerminalActive(true)`
        )
        await waitFor(
          `document.querySelector('[aria-label="First chat 1"][role="region"]').hidden === false`
        )
        await firstVisible.finish()
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          await run(`document.querySelector('[aria-label="First chat 1"][aria-pressed]') !== null`),
          true
        )
        // Close the last tab, then create a first tab while the panel is already open.
        await run(
          `document.querySelector('[aria-label="Close First chat 1"]').click(); document.getElementById('focus-target').focus()`
        )
        await waitFor(
          `document.querySelectorAll('.terminal-panel__tabs [aria-pressed]').length === 0`
        )
        const firstInOpenPanel = sources.register('native-first-open', {
          ...sourceOptions,
          chatId: 'first',
          chatTitle: 'First chat',
          cwd: otherDirectory
        })
        await waitFor(
          `document.querySelector('[aria-label="First chat 2"][role="region"]')?.hidden === false`
        )
        assert.equal(await run(`document.activeElement.id`), 'focus-target')
        await firstInOpenPanel.finish()
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          await run(`document.querySelector('[aria-label="First chat 2"][aria-pressed]') !== null`),
          true,
          'The first tab in an already opened terminal panel remains after completion'
        )

        // Exercise Claude's real task-output-file reader through the same native tab.
        const logDirectory = path.join(directory, 'native logs', 'tasks')
        await fs.mkdir(logDirectory, { recursive: true })
        const outputFile = path.join(logDirectory, 'native-log.output')
        await fs.writeFile(outputFile, 'server ready λ🙂\n')
        const nativeStops = []
        const claude = terminal.createClaudeTerminalSessions({
          ...sourceOptions,
          chatId: 'log-chat',
          chatTitle: 'Native log chat',
          stop: async (id) => {
            nativeStops.push(id)
          },
          interrupt: async () => {},
          readOutputFile: (file) =>
            terminal.createAgentTerminalOutputReader(file, sourceOptions.container)
        })
        claude.consume({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'log-call', name: 'Bash', input: { command: 'npm run dev' } }
            ]
          }
        })
        claude.consume({
          type: 'system',
          subtype: 'task_started',
          task_id: 'native-log',
          tool_use_id: 'log-call',
          task_type: 'local_bash',
          is_backgrounded: true
        })
        claude.consume({
          type: 'user',
          tool_use_result: { backgroundTaskId: 'native-log' },
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'log-call',
                content: `Command running in background with ID: native-log. Output is being written to: ${outputFile}`
              }
            ]
          }
        })
        await waitFor(
          `document.querySelector('[aria-label="Native log chat 1"][role="region"]') !== null`
        )
        await run(
          `window.selectWorkspace(${JSON.stringify(`toolbox:fixture${String.fromCharCode(0)}${directory}`)})`
        )
        await waitFor(
          `document.querySelector('[aria-label="Native log chat 1"][aria-pressed]') !== null`
        )
        await run(
          `document.querySelector('[aria-label="Native log chat 1"][aria-pressed]').click()`
        )
        await waitFor(`window.text(window.terminals.at(-1)).includes('server ready λ🙂')`)
        await fs.appendFile(outputFile, 'handling requests\n')
        await waitFor(`window.text(window.terminals.at(-1)).includes('handling requests')`)
        await run(`document.querySelector('[aria-label="Close Native log chat 1"]').click()`)
        await waitFor(
          `document.querySelector('[aria-label="Native log chat 1"][aria-pressed]') === null`
        )
        assert.deepEqual(nativeStops, ['native-log'])
        claude.dispose()

        // A native read-only shell still accepts Ctrl+C as task cancellation.
        sources.register('native-ctrl-c', {
          ...sourceOptions,
          chatId: 'ctrl-c',
          chatTitle: 'Ctrl C'
        })
        await waitFor(`document.querySelector('[aria-label="Ctrl C 1"][aria-pressed]') !== null`)
        await run(`document.querySelector('[aria-label="Ctrl C 1"][aria-pressed]').click()`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('$ npm run dev')`)
        await run(
          `window.terminals.at(-1).textarea.dispatchEvent(new KeyboardEvent('keydown', {key:'c',code:'KeyC',keyCode:67,ctrlKey:true,bubbles:true,cancelable:true})); undefined`
        )
        await waitFor(`window.text(window.terminals.at(-1)).includes('process exited')`)
        assert.equal(stopped, 2)
        assert.equal(
          await run(`document.querySelector('[aria-label="Ctrl C 1"][aria-pressed]') !== null`),
          true
        )

        let stoppedTurns = 0
        sources.register('native-turn-scope', {
          ...sourceOptions,
          chatId: 'turn',
          chatTitle: 'Turn scoped',
          stopScope: 'turn',
          stop: async () => {
            stoppedTurns++
          }
        })
        await waitFor(
          `document.querySelector('[aria-label="Turn scoped 1"][aria-pressed]') !== null`
        )
        await run(`window.confirmations = []; window.confirm = message => { window.confirmations.push(message); return false };
          document.querySelector('[aria-label="Close Turn scoped 1"]').click()`)
        await waitFor(`window.confirmations.length > 0`)
        assert.match(await run('window.confirmations[0]'), /Stop that turn/)
        assert.equal(stoppedTurns, 0)
        await run(
          `window.confirm = () => true; document.querySelector('[aria-label="Close Turn scoped 1"]').click()`
        )
        await waitFor(
          `document.querySelector('[aria-label="Turn scoped 1"][aria-pressed]') === null`
        )
        assert.equal(stoppedTurns, 1)

        assert.equal(await run(`document.querySelector('[aria-label="Restart terminal"]')`), null)
        // A failed reattachment must keep the already displayed output and hide IPC internals.
        const cacheSource = sources.register('cached-output', {
          ...sourceOptions,
          chatId: 'cached',
          chatTitle: 'Cached output'
        })
        cacheSource.append('SERVER_OUTPUT_KEPT\r\n')
        await run(
          `window.oldTerminalCount = window.terminals.length; window.renderExpired(${JSON.stringify(cacheSource.id)})`
        )
        await waitFor(
          `window.terminals.length > window.oldTerminalCount && window.text(window.terminals.at(-1)).includes('SERVER_OUTPUT_KEPT')`
        )
        await run(
          `window.oldTerminalCount = window.terminals.length; window.renderExpired('expired-process')`
        )
        await waitFor(
          `window.terminals.length > window.oldTerminalCount && window.text(window.terminals.at(-1)).includes('Process is no longer connected')`
        )
        const expired = await run('window.text(window.terminals.at(-1))')
        assert.match(expired, /SERVER_OUTPUT_KEPT/)
        assert.equal(expired.split('SERVER_OUTPUT_KEPT').length, 2)
        assert.ok(
          expired.indexOf('SERVER_OUTPUT_KEPT') < expired.indexOf('Process is no longer connected')
        )
        assert.doesNotMatch(expired, /Error invoking remote method|terminal:attach-agent-session/)
        const available = sources.available
        sources.available = (id) => {
          if (id === 'legacy-expired') throw new Error('This agent process is no longer available.')
          return available(id)
        }
        await run(
          `window.oldTerminalCount = window.terminals.length; window.renderExpired('legacy-expired')`
        )
        await waitFor(
          `window.terminals.length > window.oldTerminalCount && window.text(window.terminals.at(-1)).includes('Process is no longer connected')`
        )
        const legacyExpired = await run('window.text(window.terminals.at(-1))')
        assert.match(legacyExpired, /SERVER_OUTPUT_KEPT/)
        assert.doesNotMatch(
          legacyExpired,
          /Error invoking remote method|terminal:attach-agent-session/
        )
        sources.available = available
        console.log(
          'Terminal action UI passed: real PTYs, native process attachments, no automatic focus, unviewed auto-close, viewed retention, per-chat indexes, project ownership and StrictMode.'
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
