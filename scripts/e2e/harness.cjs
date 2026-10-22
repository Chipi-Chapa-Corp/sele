// Launches the real built Sele app against real provider CLIs and a scripted model server.
// Every provider home, Sele profile and database lives in a temporary directory.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn, execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '../..')
const providers = ['codex', 'claude', 'copilot', 'opencode']

function which(command) {
  try {
    return execFileSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Build the renderer/main/preload bundle into a private output directory. */
function buildApp(outDir, { force = false } = {}) {
  const marker = path.join(outDir, 'main', 'index.js')
  if (!force && fs.existsSync(marker) && process.env.SELE_E2E_SKIP_BUILD) return
  try {
    execFileSync(
      process.execPath,
      [
        '--max-old-space-size=4096',
        'node_modules/electron-vite/bin/electron-vite.js',
        'build',
        '--outDir',
        outDir
      ],
      { cwd: root, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }
    )
  } catch (error) {
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''))
    throw new Error('Building Sele failed')
  }
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    JSON.stringify({ name: 'sele', productName: 'Sele', main: './main/index.js' })
  )
}

/** Create isolated homes and configs that route every provider to the model server. */
function prepareEnvironment(directory, modelPort) {
  const dirs = {
    home: path.join(directory, 'home'),
    bin: path.join(directory, 'bin'),
    config: path.join(directory, 'xdg-config'),
    data: path.join(directory, 'xdg-data'),
    cache: path.join(directory, 'xdg-cache'),
    state: path.join(directory, 'xdg-state'),
    codex: path.join(directory, 'codex-home'),
    claude: path.join(directory, 'claude-home'),
    copilot: path.join(directory, 'copilot-home'),
    work: path.join(directory, 'workspace'),
    logs: path.join(directory, 'logs')
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  const base = `http://127.0.0.1:${modelPort}`

  // Inside a toolbox Sele would forward provider commands to the host and drop this environment.
  fs.writeFileSync(path.join(dirs.bin, 'distrobox-host-exec'), '#!/bin/sh\nexit 1\n', {
    mode: 0o755
  })
  const executables = {}
  for (const provider of providers) {
    // Every installed provider stays available, as for a real user.
    const found = which(provider)
    if (found) executables[provider] = found
  }

  fs.writeFileSync(
    path.join(dirs.codex, 'config.toml'),
    [
      'model = "mock-model"',
      'model_provider = "mock"',
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      'check_for_update_on_startup = false',
      '',
      '[model_providers.mock]',
      'name = "Mock"',
      `base_url = "${base}/v1"`,
      'wire_api = "responses"',
      'env_key = "MOCK_API_KEY"',
      'request_max_retries = 0',
      'stream_max_retries = 0',
      '',
      '[analytics]',
      'enabled = false',
      ''
    ].join('\n')
  )
  fs.writeFileSync(
    path.join(dirs.claude, 'settings.json'),
    JSON.stringify({
      permissions: { defaultMode: 'bypassPermissions' },
      skipDangerousModePermissionPrompt: true
    })
  )
  const opencodeConfig = path.join(directory, 'opencode.json')
  fs.writeFileSync(
    opencodeConfig,
    JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      model: 'mock/mock-model',
      small_model: 'mock/mock-model',
      autoupdate: false,
      share: 'disabled',
      permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
      enabled_providers: ['mock'],
      provider: {
        mock: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Mock',
          options: { baseURL: `${base}/v1`, apiKey: 'mock' },
          models: {
            'mock-model': {
              name: 'Mock model',
              tool_call: true,
              limit: { context: 200000, output: 8000 }
            }
          }
        }
      }
    })
  )
  execFileSync('git', ['init', '-q'], { cwd: dirs.work })
  fs.writeFileSync(path.join(dirs.work, 'README.md'), '# e2e workspace\n')

  const nodeDir = path.dirname(process.execPath)
  const env = {
    PATH: [
      dirs.bin,
      nodeDir,
      ...String(process.env.PATH)
        .split(':')
        .filter((part) => !part.includes('distrobox'))
    ].join(':'),
    HOME: dirs.home,
    USER: process.env.USER,
    LANG: 'en_US.UTF-8',
    DISPLAY: process.env.DISPLAY,
    XAUTHORITY: process.env.XAUTHORITY,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    SELE_DATABASE_PATH: path.join(directory, 'sele.sqlite'),
    SELE_DISABLE_CODEX_RESOURCE_ISOLATION: '1',
    ...(executables.codex ? { SELE_CODEX_PATH: executables.codex } : {}),
    ...(executables.claude ? { SELE_CLAUDE_PATH: executables.claude } : {}),
    ...(executables.opencode ? { SELE_OPENCODE_PATH: executables.opencode } : {}),
    CODEX_HOME: dirs.codex,
    MOCK_API_KEY: 'mock',
    CLAUDE_CONFIG_DIR: dirs.claude,
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_API_KEY: 'sk-ant-mock',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    COPILOT_HOME: dirs.copilot,
    COPILOT_OFFLINE: 'true',
    COPILOT_PROVIDER_BASE_URL: `${base}/v1`,
    COPILOT_PROVIDER_API_KEY: 'mock',
    COPILOT_MODEL: 'mock-model',
    COPILOT_ALLOW_ALL: 'true',
    COPILOT_AUTO_UPDATE: 'false',
    OPENCODE_CONFIG: opencodeConfig,
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    NO_AT_BRIDGE: '1'
  }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  return { dirs, env, executables }
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    this.scripts = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Debugger.scriptParsed')
        this.scripts.set(message.params.scriptId, message.params.url)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method) for (const listener of this.listeners) listener(message)
    })
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP connection closed'))
      this.pending.clear()
    })
  }

  static async connect(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs
    let target
    while (!target) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        target = list.find(
          (entry) => entry.type === 'page' && /renderer\/index\.html/.test(entry.url)
        )
      } catch {}
      if (!target) {
        if (Date.now() > deadline) throw new Error('Sele window did not appear')
        await sleep(200)
      }
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new Cdp(socket)
  }

  /** Every command times out: a frozen renderer must fail the check, not hang the suite. */
  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms (renderer unresponsive?)`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error))
      })
    })
  }

  /** True when the page's main thread answers within `timeoutMs`. */
  async responsive(timeoutMs = 3000) {
    try {
      await this.send('Runtime.evaluate', { expression: '1', returnByValue: true }, timeoutMs)
      return true
    } catch {
      return false
    }
  }

  /**
   * Interrupt running JavaScript and return its stack. This works on a frozen main thread
   * because the debugger was enabled at launch, before anything could block it.
   */
  async captureStack(timeoutMs = 5000) {
    const paused = new Promise((resolve) => {
      const stop = this.on((message) => {
        if (message.method !== 'Debugger.paused') return
        stop()
        resolve(message.params.callFrames)
      })
      setTimeout(() => (stop(), resolve(null)), timeoutMs)
    })
    this.send('Debugger.pause', {}, timeoutMs).catch(() => {})
    const frames = await paused
    if (!frames) return null
    this.send('Debugger.resume', {}, timeoutMs).catch(() => {})
    return frames.slice(0, 25).map((frame) => {
      const url = (this.scripts.get(frame.location.scriptId) ?? '').split('/').pop()
      return `${frame.functionName || '(anonymous)'} ${url}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`
    })
  }

  on(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async evaluate(expression, { timeoutMs = 30000 } = {}) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs
    )
    if (result.exceptionDetails)
      throw new Error(
        (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text) +
          '\n  in: ' +
          expression.slice(0, 300)
      )
    return result.result.value
  }

  close() {
    this.socket.close()
  }
}

/**
 * SIGKILL anything still running with this suite's temporary home. Provider CLIs spawned by an
 * earlier app instance can otherwise survive a relaunch and keep holding a chat's write lease.
 */
function killStrayProcesses(home, logFile) {
  const killed = []
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue
    let environ
    try {
      environ = fs.readFileSync(`/proc/${entry}/environ`, 'utf8')
    } catch {
      continue
    }
    if (!environ.split('\0').includes(`HOME=${home}`)) continue
    try {
      const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ').trim()
      process.kill(Number(entry), 'SIGKILL')
      killed.push(`${entry} ${cmdline.slice(0, 160)}`)
    } catch {}
  }
  if (killed.length)
    fs.appendFileSync(logFile, `Killed stray processes after app close:\n${killed.join('\n')}\n`)
  return killed
}

/** Launch Electron with the private profile and connect over the DevTools protocol. */
async function launchApp({ outDir, env, logFile }) {
  const port = await freePort()
  const log = fs.openSync(logFile, 'a')
  const child = spawn(
    require('electron'),
    [outDir, `--remote-debugging-port=${port}`, '--no-sandbox'],
    {
      cwd: env.HOME,
      env,
      stdio: ['ignore', log, log],
      detached: true
    }
  )
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const cdp = await Promise.race([
    Cdp.connect(port, 60000),
    exited.then((code) => {
      throw new Error(`Sele exited early with ${code}; see ${logFile}`)
    })
  ])
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  // Enabled up front so a later main-thread freeze can still be paused and diagnosed.
  await cdp.send('Debugger.enable')
  return {
    child,
    cdp,
    port,
    async close() {
      // Ask Electron to quit like a user would, so providers release thread writers and
      // journals cleanly instead of dying with the process group.
      try {
        await Promise.race([cdp.send('Browser.close'), sleep(3000)])
      } catch {}
      try {
        cdp.close()
      } catch {}
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {}
        await Promise.race([exited, sleep(5000)])
        if (child.exitCode === null)
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {}
      }
      await sleep(300)
      killStrayProcesses(env.HOME, logFile)
      fs.closeSync(log)
    }
  }
}

module.exports = {
  root,
  providers,
  buildApp,
  prepareEnvironment,
  launchApp,
  freePort,
  sleep,
  Cdp,
  which
}
