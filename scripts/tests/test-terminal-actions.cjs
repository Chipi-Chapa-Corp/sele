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
            name: 'runtime-source',
            setup(builder) {
              builder.onResolve({ filter: /\?raw$/ }, (args) => ({
                path: path.join(args.resolveDir, args.path.slice(0, -4)),
                namespace: 'raw'
              }))
              builder.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
                contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))}`
              }))
            }
          },
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
        entryPoints: ['src/renderer/src/chatMarkdown.worker.ts'],
        outfile: path.join(directory, 'markdown-worker.js'),
        bundle: true,
        platform: 'browser'
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
            import {rememberAgentTerminalChats} from './src/renderer/src/agentTerminalChats'
            import {createChatTerminalPoller} from './src/renderer/src/chatTerminalPolling'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            window.taskSnapshot = key => chatTerminalActivity.getSnapshot(key)
            window.rememberAgentTerminalChats = rememberAgentTerminalChats
            window.discoverRunningTasks = async ids => {
              const poller = createChatTerminalPoller({
                getChats: () => [{id:'fixture', providerId:'codex', done:false, status:null}],
                readTasks: async () => ids, activity:chatTerminalActivity, onError:console.error
              })
              await poller.poll()
              poller.dispose()
            }
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
            window.renderFixture = () => root.render(<React.StrictMode><Fixture /></React.StrictMode>)
            window.renderFixture()
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
              builder.onLoad({ filter: /chatMarkdown\.worker\.ts$/ }, () => ({
                contents: `export default class extends Worker {constructor(){super('./markdown-worker.js')}}`,
                loader: 'js'
              }))
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
      if (environment.SELE_TERMINAL_FIXTURE_SHELL?.endsWith('fish')) {
        const shellDirectory = path.join(directory, 'shell')
        await fs.mkdir(shellDirectory)
        const fixtureShell = path.join(shellDirectory, 'fish')
        const fish = `'${environment.SELE_TERMINAL_FIXTURE_SHELL.replace(/'/g, `'\\''`)}'`
        await fs.writeFile(
          fixtureShell,
          `#!/bin/sh\nexec ${fish} --no-config --features=no-query-term "$@"\n`,
          {
            mode: 0o700
          }
        )
        environment.SELE_TERMINAL_FIXTURE_SHELL = fixtureShell
      }
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
        // Fish can briefly run prompt helpers during startup; wait for its idle prompt before reuse.
        await waitFor(`window.terminals[0].options.disableStdin === false &&
          /[>$#]\\s*$/.test(window.text(window.terminals[0]).trim())`)

        // Failed actions keep their tab and output, then accept input in a fresh shell.
        await run('window.selectChat(null)')
        const failedMarker = path.join(directory, 'failed-action-once')
        const failedCommand = `sh -c 'printf ACTION_FAILED; printf ran >> "${failedMarker}"; read -r line; exit 7'`
        await run(`window.launch(${JSON.stringify(failedCommand)}, true)`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('ACTION_FAILED') &&
          window.terminals.at(-1).options.disableStdin === false`)
        await run(`window.failedRegion = document.querySelector('[aria-label="Deploy"][role="region"]');
          document.getElementById('focus-target').focus(); window.terminals.at(-1).input('finish\\r', true)`)
        await waitFor(
          `window.text(window.terminals.at(-1)).includes('[process exited with code 7') &&
          window.terminals.at(-1).options.disableStdin === false`
        )
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        assert.equal(
          await run(`document.querySelectorAll('[aria-label="Deploy"][role="region"]').length`),
          1,
          'Failed actions keep their terminal tab even when close-on-finish is enabled'
        )
        assert.equal(await run('window.failedRegion.isConnected'), true)
        assert.equal(await run('document.activeElement.id'), 'focus-target')
        assert.equal(await fs.readFile(failedMarker, 'utf8'), 'ran', 'Failed action runs once')
        const failedOutput = await run('window.text(window.terminals.at(-1))')
        assert.equal(failedOutput.split('[process exited with code 7').length, 2)
        assert.equal(failedOutput.split("$ sh -c 'printf ACTION_FAILED").length, 2)
        await run(`window.terminals.at(-1).input('printf "FAILED_SHELL:%s\\\\n" "$PWD"\\r', true)`)
        await waitFor(
          `window.text(window.terminals.at(-1)).includes(${JSON.stringify(`FAILED_SHELL:${directory}`)})`
        )
        await run(
          `window.terminalCount = window.terminals.length; window.terminals.at(-1).input('exit 7\\r', true)`
        )
        await waitFor(`window.terminals.at(-1).options.disableStdin`)
        assert.equal(
          await run('window.terminals.length'),
          await run('window.terminalCount'),
          'Exiting the replacement shell does not start another shell'
        )
        await run(`document.querySelector('[aria-label="Close Deploy"]').click()`)
        await waitFor(`document.querySelectorAll('.terminal-panel__session').length === 1`)

        // Ctrl+C also leaves a usable shell after an auto-closing action exits.
        await run(`window.launch("sh -c 'printf INTERRUPT_%s ready; sleep 30'", true)`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('INTERRUPT_ready')`)
        await run(`window.interruptedRegion = document.querySelector('[aria-label="Deploy"][role="region"]');
          window.terminals.at(-1).input('\\u0003', true)`)
        await waitFor(`window.terminals.some(t => window.interruptedRegion.contains(t.textarea) &&
          window.text(t).includes('[process exited') && !t.options.disableStdin)`)
        await run(
          `window.terminals.at(-1).input('printf "AFTER_INTERRUPT_%s\\\\n" ready\\r', true)`
        )
        await waitFor(`window.text(window.terminals.at(-1)).includes('AFTER_INTERRUPT_ready')`)
        await run(`document.querySelector('[aria-label="Close Deploy"]').click()`)
        await waitFor(`document.querySelectorAll('.terminal-panel__session').length === 1`)

        // Auto-closing actions leave an existing empty tab available for the next action.
        const autoCloseMarker = path.join(directory, 'auto-close-empty')
        await run(`window.terminalCount = window.terminals.length;
          window.emptySession = document.querySelector('[aria-label="Terminal 1"][role="region"]');
          window.launch(${JSON.stringify(`printf done > '${autoCloseMarker}'`)}, true)`)
        await waitFor(
          `window.terminals.length > window.terminalCount && document.querySelectorAll('.terminal-panel__session').length === 1`
        )
        assert.equal(await fs.readFile(autoCloseMarker, 'utf8'), 'done')
        assert.equal(await run('window.emptySession.isConnected'), true)
        await run("window.selectChat('codex:fixture')")

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
        // Discovery can precede chat metadata. Its tab must follow the owning project
        // when that metadata arrives, without interrupting the original attachment.
        const commandDirectory = path.join(directory, 'command-subdirectory')
        await fs.mkdir(commandDirectory)
        let routedStops = 0
        const routed = sources.register('native-delayed-project', {
          providerId: 'codex',
          chatId: 'fixture',
          chatTitle: 'Routed task',
          cwd: commandDirectory,
          container: { kind: 'container', tool: 'toolbox', name: 'fixture' },
          command: 'npm run dev',
          stop: async () => {
            routedStops++
          }
        })
        routed.append('ROUTED_TASK_RUNNING\r\n')
        await run(`window.discoverRunningTasks([${JSON.stringify(routed.id)}])`)
        const routedTab = `document.querySelector('[aria-label="Routed task 1"][aria-pressed]')`
        const routedRegion = `document.querySelector('[aria-label="Routed task 1"][role="region"]')`
        await waitFor(
          `${routedRegion} !== null && window.terminals.some(t => window.text(t).includes('ROUTED_TASK_RUNNING'))`
        )
        assert.equal(await run(routedTab), null, 'The command directory initially owns the tab')
        assert.equal(await run(`window.taskSnapshot('codex:fixture').running`), true)
        await run(`window.routedRegion = ${routedRegion};
          window.routedTerminalCount = window.terminals.length;
          document.getElementById('focus-target').focus();
          window.rememberAgentTerminalChats([{
            id:'fixture', providerId:'codex', title:'Routed task',
            cwd:${JSON.stringify(directory)}, projectCwd:${JSON.stringify(directory)}
          }])`)
        await waitFor(`${routedTab} !== null`)
        assert.equal(await run(`${routedRegion} === window.routedRegion`), true)
        assert.equal(await run('window.terminals.length === window.routedTerminalCount'), true)
        assert.equal(await run('document.activeElement.id'), 'focus-target')
        assert.equal(sources.status(routed.id), 'running')
        assert.equal(routedStops, 0)
        routed.append('OUTPUT_AFTER_PROJECT_RESOLVED\r\n')
        await waitFor(
          `window.terminals.some(t => window.text(t).includes('OUTPUT_AFTER_PROJECT_RESOLVED'))`
        )
        // Later project changes must also be reconciled. Explicit workspace ownership
        // (such as a restored user shell) must stay where it was launched.
        const pinned = sources.register('native-explicit-project', {
          providerId: 'codex',
          chatId: 'fixture',
          chatTitle: 'Routed task',
          cwd: commandDirectory,
          container: { kind: 'container', tool: 'toolbox', name: 'fixture' },
          command: 'npm run dev',
          workspaceKey: `toolbox:fixture${String.fromCharCode(0)}${directory}`,
          workspaceLabel: 'Pinned terminal',
          stop: async () => {}
        })
        await waitFor(
          `document.querySelector('[aria-label="Pinned terminal"][aria-pressed]') !== null`
        )
        await run(`window.rememberAgentTerminalChats([{
          id:'fixture', providerId:'codex', title:'Routed task',
          cwd:${JSON.stringify(directory)}, projectCwd:${JSON.stringify(commandDirectory)}
        }])`)
        await waitFor(`${routedTab} === null`)
        assert.equal(await run(`${routedRegion} === window.routedRegion`), true)
        assert.equal(
          await run(
            `document.querySelector('[aria-label="Pinned terminal"][aria-pressed]') !== null`
          ),
          true
        )
        await routed.finish()
        await pinned.finish()
        await run('window.discoverRunningTasks([])')
        await waitFor(
          `${routedRegion} === null && document.querySelector('[aria-label="Pinned terminal"][role="region"]') === null`
        )
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

        const unopenedAction = sources.register('native-unopened-action', {
          ...sourceOptions,
          chatId: 'unopened-action',
          workspaceKey: `toolbox:fixture${String.fromCharCode(0)}${directory}`,
          workspaceLabel: 'Unopened action',
          closeOnCommandFinish: true
        })
        await waitFor(
          `document.querySelector('[aria-label="Unopened action"][aria-pressed]') !== null`
        )
        await unopenedAction.finish(7)
        await waitFor(
          `document.querySelector('[aria-label="Unopened action"][role="region"]') === null`
        )

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
        await waitFor(`window.text(window.terminals.at(-1)).includes('process exited') &&
          window.terminals.at(-1).options.disableStdin === false`)
        assert.match(await run('window.text(window.terminals.at(-1))'), /server ready/)
        assert.match(await run('window.text(window.terminals.at(-1))'), /\$ npm run dev/)
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.equal(
          await run(`${tab(2)} !== null`),
          true,
          'An opened tab remains after completion'
        )
        await run(`window.confirmations = []; window.confirm = message => {
          window.confirmations.push(message); return false
        }; document.querySelector('[aria-label="Close ${label(2)}"]').click()`)
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.deepEqual(
          await run('window.confirmations'),
          [],
          'Closing a completed native tab must not warn about a running process'
        )
        await waitFor(`${tab(2)} === null`)
        assert.equal(stopped, 0, 'Closing completed output must not cancel a native task')
        await run('window.confirm = () => true; undefined')

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
        const terminalQueries = '\x1b]11;?\x07\x1b[6n\x1b[c'
        interactive.append(terminalQueries + 'HISTORICAL_QUERIES\r\n')
        await waitFor(`${tab(4)} !== null`)
        await run(`${tab(4)}.click()`)
        await waitFor(`window.terminals.at(-1).options.disableStdin === false`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('HISTORICAL_QUERIES')`)
        assert.deepEqual(input, [], 'Replayed terminal queries must never reach process stdin')
        interactive.append(terminalQueries + 'LIVE_QUERIES\r\n')
        await waitFor(`window.text(window.terminals.at(-1)).includes('LIVE_QUERIES')`)
        await waitFor(`window.text(window.terminals.at(-1)).includes('echo:')`)
        assert.equal(input.length, 3, 'Live color, cursor and device queries still receive replies')
        assert.ok(input[0].startsWith('\x1b]11;rgb:'))
        assert.equal(input[1][0], '\x1b')
        assert.match(input[1].slice(1), /^\[\d+;\d+R$/)
        assert.equal(input[2], '\x1b[?1;2c')
        input.length = 0
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
        await fs.mkdir(otherDirectory, { recursive: true })
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

        // Tasks that finish before discovery were never opened. Dismiss them
        // without mounting a terminal, even in the currently visible project.
        for (const exitCode of [0, 7]) {
          const quick = sources.register(`quick-before-discovery-${exitCode}`, {
            ...sourceOptions,
            chatId: `quick-chat-${exitCode}`,
            chatTitle: `Quick shell ${exitCode}`,
            cwd: otherDirectory,
            command: 'printf QUICK_COMMAND_OUTPUT',
            background: false
          })
          quick.append('QUICK_COMMAND_OUTPUT\r\n')
          await quick.finish(exitCode)
          await waitFor(`(async () => !(await window.terminalApi.listAgentSessions())
            .some(session => session.id === ${JSON.stringify(quick.id)}))()`)
          assert.equal(
            await run(
              `document.querySelector('[aria-label="Quick shell ${exitCode} 1"][role="region"]')`
            ),
            null
          )
          assert.equal(
            await run(
              `window.terminals.some(t => window.text(t).includes('QUICK_COMMAND_OUTPUT'))`
            ),
            false,
            'Completed-before-discovery tasks must not attach or become persistent shells'
          )
        }

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
        await run('window.renderFixture(); undefined')
        await waitFor(`document.querySelector('.terminal-panel__tabs') !== null`)
        // Every provider's viewed output becomes a real shell without replaying its command.
        const handoffMarker = path.join(directory, 'agent-command-must-not-replay')
        const handoffShells = []
        for (const providerId of ['codex', 'claude', 'copilot', 'opencode-v2']) {
          const title = `Shell ${providerId}`
          const label = `${title} 1`
          handoffShells.push({ label, providerId })
          const source = sources.register(`handoff-${providerId}`, {
            ...sourceOptions,
            providerId,
            chatId: `handoff-${providerId}`,
            chatTitle: title,
            command: `printf AGENT_COMMAND_RERUN >> '${handoffMarker}'`
          })
          source.append(`AGENT_OUTPUT:${providerId}\r\n`)
          await waitFor(`document.querySelector('[aria-label="${label}"][aria-pressed]') !== null`)
          await run(`document.querySelector('[aria-label="${label}"][aria-pressed]').click()`)
          await waitFor(
            `window.text(window.terminals.at(-1)).includes('AGENT_OUTPUT:${providerId}')`
          )
          await run(`(async () => {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            window.handoffRegion = document.querySelector('[aria-label="${label}"][role="region"]')
            document.getElementById('focus-target').focus()
          })()`)
          await source.finish(7)
          await waitFor(`window.terminals.at(-1).options.disableStdin === false &&
            window.text(window.terminals.at(-1)).includes('[process exited with code 7')`)
          assert.equal(
            await run('document.activeElement.id'),
            'focus-target',
            'Handoff leaves focus alone'
          )
          assert.equal(
            await run('window.handoffRegion.isConnected'),
            true,
            'Handoff keeps the same tab'
          )
          const output = await run('window.text(window.terminals.at(-1))')
          assert.equal(
            output.split(`AGENT_OUTPUT:${providerId}`).length,
            2,
            'Agent output is kept once'
          )
          assert.match(output, /\$ printf AGENT_COMMAND_RERUN/)
          await run('window.currentShell = window.terminals.at(-1); undefined')
          if (providerId === 'codex') {
            await run(`window.launch("printf 'NEW_ACTION_%s\\\\n' ready", false)`)
            await waitFor(`window.text(window.terminals.at(-1)).includes('NEW_ACTION_ready')`)
            assert.equal(
              await run(`window.handoffRegion.getAttribute('aria-label')`),
              label,
              'An untouched shell with retained output is not reused as an empty tab'
            )
            await run(`document.querySelector('[aria-label="Close Deploy"]').click()`)
            await waitFor(`document.querySelector('[aria-label="Deploy"][aria-pressed]') === null`)
            await run(`document.querySelector('[aria-label="${label}"][aria-pressed]').click()`)
          }
          const command = `printf 'SHELL_REPLY:%s:%s\\n' '${providerId}' "$PWD"\r`
          await run(`window.currentShell.input(${JSON.stringify(command)}, true)`)
          await waitFor(
            `window.text(window.currentShell).includes(${JSON.stringify(`SHELL_REPLY:${providerId}:${directory}`)})`
          )
          if (providerId === 'codex') {
            const command = `printf 'SLEEP_%s\\n' ready; sleep 30\r`
            await run(`window.currentShell.input(${JSON.stringify(command)}, true)`)
            await waitFor(`window.text(window.currentShell).includes('SLEEP_ready')`)
            await run(`window.currentShell.textarea.dispatchEvent(new KeyboardEvent('keydown', {
              key:'c', code:'KeyC', keyCode:67, ctrlKey:true, bubbles:true, cancelable:true
            })); undefined`)
            const afterInterrupt = `printf 'INTERRUPTED_%s\\n' successfully\r`
            await run(`window.currentShell.input(${JSON.stringify(afterInterrupt)}, true)`)
            await waitFor(`window.text(window.currentShell).includes('INTERRUPTED_successfully')`)
          }
          await assert.rejects(fs.access(handoffMarker), { code: 'ENOENT' })
          assert.equal(stopped, 2, 'Using the shell does not cancel an agent task')
        }
        if (process.env.SELE_TERMINAL_HANDOFF_SCREENSHOT) {
          await fs.writeFile(
            process.env.SELE_TERMINAL_HANDOFF_SCREENSHOT,
            (await window.webContents.capturePage()).toPNG()
          )
        }

        // Recreate the renderer and its IPC attachments while the PTY owner stays alive.
        const restartId = require('node:crypto').randomUUID()
        const restartCommand = process.env.SELE_TERMINAL_FIXTURE_SHELL?.endsWith('fish')
          ? `printf 'RESTART_READY:%s\\n' $fish_pid; while read -l line; printf 'RESTART_REPLY:%s\\n' "$line"; end`
          : `printf 'RESTART_READY:%s\\n' "$$"; while IFS= read -r line; do printf 'RESTART_REPLY:%s\\n' "$line"; done`
        const restarted = await run(`window.terminalApi.createSession({
          sessionId: ${JSON.stringify(restartId)},
          workspaceKey: ${JSON.stringify(`toolbox:fixture${String.fromCharCode(0)}${directory}`)},
          chatKey: 'codex:fixture', label: 'Restored dev server',
          cwd: ${JSON.stringify(directory)}, cols: 80, rows: 24,
          initialCommand: ${JSON.stringify(restartCommand)}
        })`)
        const recoveredActionMarker = path.join(directory, 'recovered-action-once')
        await run(`window.terminalApi.createSession({
          sessionId: crypto.randomUUID(),
          workspaceKey: ${JSON.stringify(`toolbox:fixture${String.fromCharCode(0)}${directory}`)},
          chatKey: 'codex:fixture', label: 'Recovered action', closeOnCommandFinish: true,
          cwd: ${JSON.stringify(directory)}, cols: 80, rows: 24,
          initialCommand: ${JSON.stringify(`sh -c 'printf ran >> "${recoveredActionMarker}"; read -r line; exit 7'`)}
        })`)
        await terminal.disposeTerminalSessions({ preserve: true })
        await window.loadFile(path.join(directory, 'index.html'))
        await run(String.raw`window.text = terminal => Array.from({length: terminal.buffer.active.length},
          (_, index) => terminal.buffer.active.getLine(index).translateToString(true)).join('\n'); undefined`)
        await waitFor(
          `document.querySelector('[aria-label="Recovered action"][aria-pressed]') !== null`
        )
        await run(`document.querySelector('[aria-label="Recovered action"][aria-pressed]').click()`)
        await waitFor(`window.terminals.some(t =>
          document.querySelector('[aria-label="Recovered action"][role="region"]').contains(t.textarea) &&
          !t.options.disableStdin)`)
        await run(`window.recoveredRegion = document.querySelector('[aria-label="Recovered action"][role="region"]');
          window.terminals.find(t => window.recoveredRegion.contains(t.textarea)).input('finish\\r', true)`)
        await waitFor(`window.terminals.some(t => window.recoveredRegion.contains(t.textarea) &&
          window.text(t).includes('[process exited with code 7') && !t.options.disableStdin)`)
        await run(
          `window.terminals.find(t => window.recoveredRegion.contains(t.textarea)).input('printf "RECOVERED_SHELL:%s\\\\n" "$PWD"\\r', true)`
        )
        await waitFor(`window.terminals.some(t => window.recoveredRegion.contains(t.textarea) &&
          window.text(t).includes(${JSON.stringify(`RECOVERED_SHELL:${directory}`)}))`)
        assert.equal(await fs.readFile(recoveredActionMarker, 'utf8'), 'ran')
        await run(`document.querySelector('[aria-label="Close Recovered action"]').click()`)
        await waitFor(
          `document.querySelector('[aria-label="Recovered action"][aria-pressed]') === null`
        )
        for (const { label, providerId } of handoffShells) {
          await waitFor(`document.querySelector('[aria-label="${label}"][aria-pressed]') !== null`)
          await run(`document.querySelector('[aria-label="${label}"][aria-pressed]').click()`)
          await waitFor(
            `window.terminals.some(t => window.text(t).includes(${JSON.stringify(`SHELL_REPLY:${providerId}:${directory}`)}) && !t.options.disableStdin)`
          )
          const output = await run(
            `window.text(window.terminals.find(t => window.text(t).includes('AGENT_OUTPUT:${providerId}')))`
          )
          assert.equal(output.split(`AGENT_OUTPUT:${providerId}`).length, 2)
          assert.match(output, /\[process exited with code 7\]/)
          const command = `printf 'AFTER_RELOAD_%s\\n' '${providerId}'\r`
          await run(
            `window.terminals.find(t => window.text(t).includes('AGENT_OUTPUT:${providerId}')).input(${JSON.stringify(command)}, true); undefined`
          )
          await waitFor(
            `window.terminals.some(t => window.text(t).includes('AFTER_RELOAD_${providerId}'))`
          )
        }
        await assert.rejects(fs.access(handoffMarker), { code: 'ENOENT' })
        // Exiting a restored shell keeps its final output and must not launch another shell.
        await run(`window.completedShell = window.terminals.find(t => window.text(t).includes('AGENT_OUTPUT:opencode-v2'));
          window.terminalCount = window.terminals.length; window.completedShell.input('exit\\r', true)`)
        await waitFor(`window.text(window.completedShell).includes('[process exited with code 0]') &&
          window.completedShell.options.disableStdin`)
        assert.equal(await run('window.terminals.length'), await run('window.terminalCount'))
        assert.equal(stopped, 2)
        await waitFor(
          `document.querySelector('[aria-label="Restored dev server"][aria-pressed]') !== null`
        )
        await run(
          `document.querySelector('[aria-label="Restored dev server"][aria-pressed]').click()`
        )
        await waitFor(
          `window.terminals.some(t => window.text(t).includes('RESTART_READY:${restarted.pid}'))`
        )
        await run(
          `window.terminals.find(t => window.text(t).includes('RESTART_READY:${restarted.pid}')).input('still-running\\r', true); undefined`
        )
        await waitFor(
          `window.terminals.some(t => window.text(t).includes('RESTART_REPLY:still-running'))`
        )
        await run(
          `window.confirm = () => true; document.querySelector('[aria-label="Close Restored dev server"]').click()`
        )
        await waitFor(
          `document.querySelector('[aria-label="Restored dev server"][aria-pressed]') === null`
        )
        console.log(
          'Terminal action UI passed: real PTYs, native process attachments, renderer restart recovery with live input, no automatic focus, unviewed auto-close, viewed retention, per-chat indexes, project ownership and StrictMode.'
        )
      } catch (error) {
        console.error(error)
        exitCode = 1
      } finally {
        await terminal.disposeTerminalSessions()
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
