// Real provider startup and Chrome connection checks, without model inference.
// Never selects a browser or opens/reads a tab. Remote browsers are counted only.
// Run with Node 22 --experimental-strip-types; Linux requires isolated-gui.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCodexNativeChromeConfig } from '../../src/main/providers/codex/CodexNativeChrome.ts'

if (
  process.platform === 'linux' &&
  (!process.env.ISOLATED_GUI_SESSION ||
    !process.env.DISPLAY ||
    !process.env.DBUS_SESSION_BUS_ADDRESS ||
    process.env.WAYLAND_DISPLAY)
)
  throw new Error(
    'Run this diagnostic through isolated-gui on a private display and D-Bus session.'
  )

const directory = await mkdtemp(join(tmpdir(), 'sele-native-chrome-check-'))
const claudePath = process.env.SELE_CLAUDE_PATH || 'claude'
const codexPath = process.env.SELE_CODEX_PATH || 'codex'
const report = {
  checkedAt: new Date().toISOString(),
  browserInteractions: 'not tested',
  providers: {}
}

async function checkClaude() {
  let finishInput
  const prompt = {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise((resolve) => {
          finishInput = () => resolve({ done: true })
        })
    })
  }
  const abortController = new AbortController()
  const deadline = setTimeout(() => abortController.abort(), 25000)
  const control = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: claudePath,
      cwd: directory,
      persistSession: false,
      settingSources: [],
      extraArgs: { chrome: null },
      abortController,
      settings: { disableAllHooks: true, disableClaudeAiConnectors: true },
      canUseTool: async () => ({ behavior: 'deny', message: 'Connection diagnostic only' })
    }
  })
  try {
    await control.initializationResult()
    const status = (await control.mcpServerStatus()).find(
      (server) => server.name === 'claude-in-chrome'
    )
    if (status?.status !== 'connected')
      throw new Error(status?.error || `Official Chrome MCP status: ${status?.status ?? 'absent'}`)
  } finally {
    clearTimeout(deadline)
    finishInput?.()
    control.close()
  }
  const transport = new StdioClientTransport({
    command: claudePath,
    args: ['--claude-in-chrome-mcp'],
    env: { ...process.env },
    stderr: 'pipe'
  })
  // Drain diagnostics without recording credentials, connector configs or account details.
  transport.stderr?.on('data', () => {})
  const client = new Client({ name: 'sele-native-chrome-check', version: '1.0' })
  try {
    await client.connect(transport, { timeout: 20000 })
    const { tools } = await client.listTools()
    if (!tools.some((tool) => tool.name === 'list_connected_browsers'))
      throw new Error('Installed Claude Code does not expose browser connection discovery.')
    const result = await client.callTool(
      { name: 'list_connected_browsers', arguments: {} },
      undefined,
      { timeout: 20000 }
    )
    if (result.isError) throw new Error(result.content.find((item) => item.type === 'text')?.text)
    const text = result.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n')
    const browsers = JSON.parse(text)
    if (!Array.isArray(browsers))
      throw new Error('Unexpected browser connection discovery response.')
    const local = browsers.filter((browser) => browser.isLocal === true)
    return {
      sdkChromeServer: 'connected',
      nativeToolCount: tools.length,
      localBrowserCount: local.length,
      ignoredRemoteBrowserCount: browsers.length - local.length,
      readiness: local.length
        ? 'local connection available; browser interactions still untested'
        : 'blocked',
      ...(!local.length
        ? {
            reason:
              'No signed-in local Chrome extension connection. Remote browsers were not selected.'
          }
        : {})
    }
  } finally {
    await client.close()
    await transport.close()
  }
}

async function checkCodex() {
  const child = spawn(codexPath, ['app-server', '--listen', 'stdio://'], {
    cwd: directory,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.on('data', () => {})
  const pending = new Map()
  let nextId = 0
  const fail = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  }
  child.on('error', fail)
  child.on('exit', () => fail(new Error('Codex app-server exited.')))
  child.stdin.on('error', fail)
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    clearTimeout(item.timer)
    message.error
      ? item.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
      : item.resolve(message.result)
  })
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out: ${method}`))
      }, 20000)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
    })
  try {
    await rpc('initialize', {
      clientInfo: { name: 'sele-native-chrome-check', version: '1.0' },
      capabilities: { experimentalApi: true }
    })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    const installed = await rpc('plugin/installed', {}).catch((error) => {
      if (error.code === -32601) return { marketplaces: [] }
      throw error
    })
    const config = getCodexNativeChromeConfig(installed)
    return {
      appServer: 'initialized',
      readiness: 'plugin catalog inspected; native connection and browser interactions untested',
      enabledPluginKeys: Object.keys(config)
    }
  } finally {
    child.stdin.end()
    child.kill()
    lines.close()
  }
}

try {
  for (const [name, check] of [
    ['claude', checkClaude],
    ['codex', checkCodex]
  ]) {
    try {
      report.providers[name] = await check()
    } catch (error) {
      report.providers[name] = { readiness: 'blocked', reason: String(error) }
    }
  }
  const json = JSON.stringify(report, null, 2) + '\n'
  console.log(json)
  if (process.env.SELE_NATIVE_CHROME_REPORT)
    await writeFile(process.env.SELE_NATIVE_CHROME_REPORT, json)
  process.exitCode = Object.values(report.providers).some(
    (provider) => provider.readiness === 'blocked'
  )
    ? 2
    : 0
} finally {
  await rm(directory, { recursive: true, force: true })
}
