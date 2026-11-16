import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CodexDynamicTools } from '../providers/codex/CodexDynamicTools.ts'
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export {CodexOperaMcp} from './src/main/providers/codex/CodexOperaMcp';export {registerCodexDesktopTools} from './src/main/providers/codex/CodexDesktopTools';export {registerCodexBrowserTools} from './src/main/providers/codex/CodexBrowserTools';export {createBrowserMcpServer} from './src/main/browser/BrowserMcpServer';export {createOpenCodeBrowserBridge} from './src/main/providers/opencode/OpenCodeBrowserBridge';export {createClaudeBrowserIntegration} from './src/main/providers/claude/ClaudeBrowserTools';export {chromeAutomation,operaAutomation,configureChromePairingStorage} from './src/main/desktop/ChromeAutomation';export {registerBrowserUseSession,removeBrowserUseSessions} from './src/main/providers/codex/CodexBrowserSessions'",
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
  plugins: [
    {
      name: 'desktop-fixture',
      setup(build) {
        build.onResolve(
          {
            filter:
              /^electron$|ComputerAutomation$|BrowserAutomation$|^@anthropic-ai\/claude-agent-sdk$/
          },
          (args) => ({ path: args.path, namespace: 'test' })
        )
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents:
            path === 'electron'
              ? 'export const nativeImage={};export const app={};export const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};'
              : path.endsWith('ComputerAutomation')
                ? 'export const computerAutomation={execute:async args=>args.action==="screenshot"?{width:16,height:16,data:"aW1hZ2U="}:{success:true,action:args.action}}'
                : path.endsWith('BrowserAutomation')
                  ? 'export const getBrowserAutomationService=()=>({createClient:()=>({close(){}})})'
                  : 'export const tool=(name,description,schema,execute,options)=>({name,description,schema,execute,...options});export const createSdkMcpServer=options=>({...options,instance:{close:async()=>{}}});'
        }))
      }
    }
  ]
})
const module = { exports: {} }
vm.runInThisContext(`(function(module, exports, require) { ${bundle.outputFiles[0].text}\n})`)(
  module,
  module.exports,
  require
)
const api = module.exports
const pairingDirectory = await mkdtemp(join(tmpdir(), 'sele-desktop-tools-'))
api.configureChromePairingStorage(pairingDirectory)
test.after(async () => {
  await api.chromeAutomation.close()
  await api.operaAutomation.close()
  await rm(pairingDirectory, { recursive: true, force: true })
})
const scope = { providerId: 'claude', sessionId: 'fixture', cwd: '', containerKey: 'host' }

test('Claude desktop tools expose optional Chrome capabilities after pairing starts', async (t) => {
  await api.chromeAutomation.pair()
  t.after(() => api.chromeAutomation.disconnect())
  const integration = api.createClaudeBrowserIntegration(
    { createClient: () => ({ close() {} }) },
    scope
  )
  const names = integration.server.tools.map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length)
  for (const name of [
    'computer',
    'native_computer',
    'chrome_computer',
    'chrome_tabs_context',
    'chrome_upload_files',
    'chrome_record_gif'
  ])
    assert.ok(names.includes(name), name)
  const result = await integration.server.tools
    .find((tool) => tool.name === 'native_computer')
    .execute({ action: 'scroll', dy: 5 })
  assert.equal(result.isError, undefined)
  assert.equal(integration.isCurrent(), true)
  await api.chromeAutomation.disconnect()
  assert.equal(integration.isCurrent(), false)
  integration.close()
})

test('Claude can discover and use the embedded browser before loading deferred tools', () => {
  const integration = api.createClaudeBrowserIntegration(
    { createClient: () => ({ close() {} }) },
    scope
  )
  try {
    const loaded = integration.server.tools
      .filter((tool) => tool.alwaysLoad)
      .map((tool) => tool.name)
    assert.deepEqual(loaded.sort(), ['computer', 'navigate', 'read_page', 'tabs_context'])
    assert.ok(!integration.server.tools.some((tool) => tool.name.startsWith('chrome_')))
    assert.match(integration.server.instructions, /macOS, Windows, and Linux/)
    assert.match(
      integration.server.instructions,
      /ToolSearch.*select:mcp__Claude_Browser__tabs_create/
    )
    assert.match(integration.server.instructions, /actual error/)
  } finally {
    integration.close()
  }
})

test('official Claude Chrome keeps the embedded browser and avoids Sele pairing tools', () => {
  const integration = api.createClaudeBrowserIntegration(
    { createClient: () => ({ close() {} }) },
    scope,
    true
  )
  try {
    const names = integration.server.tools.map((tool) => tool.name)
    assert.ok(names.includes('tabs_context'))
    assert.ok(names.includes('native_computer'))
    assert.ok(!names.some((name) => name.startsWith('chrome_')))
    assert.match(integration.server.instructions, /official claude-in-chrome/)
  } finally {
    integration.close()
  }
})

test('opting into official Claude Chrome also keeps a paired Sele connection available', async (t) => {
  await api.chromeAutomation.pair()
  t.after(() => api.chromeAutomation.disconnect())
  const integration = api.createClaudeBrowserIntegration(
    { createClient: () => ({ close() {} }) },
    scope,
    true
  )
  try {
    const names = integration.server.tools.map((tool) => tool.name)
    for (const name of [
      'tabs_context',
      'native_computer',
      'chrome_tabs_context',
      'chrome_computer'
    ])
      assert.ok(names.includes(name), name)
    assert.equal(integration.isCurrent(), true)
    await api.chromeAutomation.disconnect()
    assert.equal(integration.isCurrent(), false)
  } finally {
    integration.close()
  }
})

test('Codex desktop tools advertise executable namespaced tools with valid schemas', async () => {
  const registry = new CodexDynamicTools()
  const integration = api.registerCodexDesktopTools(registry)
  registry.bind('fixture', registry.specs)
  const names = registry.specs.map((namespace) => [
    namespace.name,
    namespace.tools.map((tool) => tool.name)
  ])
  assert.ok(names.some(([name, tools]) => name === 'sele' && tools.includes('computer')))
  assert.ok(names.some(([name, tools]) => name === 'chrome' && tools.includes('tabs_context')))
  assert.ok(
    names.some(([name, tools]) => name === 'opera' && tools.includes('tabs_context')),
    'Opera must have a separate tool namespace without replacing Chrome'
  )
  const result = await registry.call({
    threadId: 'fixture',
    turnId: 'turn',
    callId: 'call',
    namespace: 'sele',
    tool: 'computer',
    arguments: { action: 'scroll', dy: 5 }
  })
  assert.equal(result.success, true)
  integration.close()
})

test('all four providers advertise the same connected catalog and preserve native screenshot images', async () => {
  await api.chromeAutomation.pair()
  await api.operaAutomation.pair()
  const service = { createClient: () => ({ close() {} }) }
  const registry = new CodexDynamicTools()
  const desktop = api.registerCodexDesktopTools(registry)
  const browser = api.registerCodexBrowserTools(registry)
  registry.bind('fixture', registry.specs)
  const claude = api.createClaudeBrowserIntegration(service, scope)
  const copilot = await api.createBrowserMcpServer(service, { ...scope, providerId: 'copilot' })
  const opencode = await api.createOpenCodeBrowserBridge(service)
  try {
    const names = registry.specs
      .flatMap((namespace) =>
        namespace.tools.map((tool) =>
          namespace.name === 'sele_browser'
            ? tool.name
            : namespace.name === 'chrome' || namespace.name === 'opera'
              ? `${namespace.name}_${tool.name}`
              : 'native_computer'
        )
      )
      .sort()
    assert.equal(new Set(names).size, names.length)
    assert.deepEqual(Array.from(claude.server.tools, (tool) => tool.name).sort(), names)
    const rpc = async (method, params) => {
      const response = await fetch(copilot.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${copilot.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
      })
      assert.equal(response.status, 200)
      return (await response.json()).result
    }
    assert.deepEqual((await rpc('tools/list')).tools.map((tool) => tool.name).sort(), names)
    const definitions = new Map()
    const plugin = (await import(pathToFileURL(join(opencode.pluginUrl, 'index.ts')).href)).default
    await plugin.setup({
      tool: {
        transform: async (edit) => edit({ add: (tool) => definitions.set(tool.name, tool) })
      },
      permission: { assert: async () => {} },
      session: { get: async () => ({ location: { directory: '/project' } }) }
    })
    assert.deepEqual(
      [...definitions.keys()].map((name) => name.replace(/^sele_browser_/, '')).sort(),
      names
    )
    await opencode.register({ ...scope, providerId: 'opencode-v2', cwd: '/project' })
    const args = { action: 'screenshot' }
    const codexShot = await registry.call({
      threadId: 'fixture',
      turnId: 'turn',
      callId: 'shot',
      namespace: 'sele',
      tool: 'computer',
      arguments: args
    })
    assert.equal(codexShot.success, true)
    assert.ok(codexShot.contentItems.some((item) => item.type === 'inputImage'))
    const claudeShot = await claude.server.tools
      .find((tool) => tool.name === 'native_computer')
      .execute(args)
    assert.ok(claudeShot.content.some((item) => item.type === 'image'))
    const copilotShot = await rpc('tools/call', { name: 'native_computer', arguments: args })
    assert.ok(copilotShot.content.some((item) => item.type === 'image'))
    const opencodeShot = await definitions.get('sele_browser_native_computer').execute(args, {
      sessionID: 'fixture',
      signal: new AbortController().signal,
      agent: 'build',
      messageID: 'message',
      id: 'shot'
    })
    assert.ok(
      opencodeShot.content.some(
        (item) => item.type === 'file' && item.uri.startsWith('data:image/png;base64,')
      )
    )
  } finally {
    desktop.close()
    browser.close()
    claude.close()
    await copilot.close()
    await opencode.close()
    await api.chromeAutomation.disconnect()
    await api.operaAutomation.disconnect()
  }
})

test('Opera pairing, overlapping tab IDs, reconnect and revocation leave Chrome untouched', async (t) => {
  const chrome = api.chromeAutomation
  const opera = api.operaAutomation
  const clients = []
  t.after(async () => {
    for (const client of clients) client.close()
    await Promise.all([chrome.disconnect(), opera.disconnect()])
  })
  const connect = async (service, name) => {
    const tab = { id: 7, url: `https://${name}.example`, title: name, active: false }
    const requests = []
    const socket = new WebSocket(
      `${service.status.pairingUrl}&epoch=00000000-0000-4000-8000-000000000001`,
      {
        origin: `chrome-extension://${'a'.repeat(32)}`
      }
    )
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw))
      requests.push(request)
      if (request.method === 'claimTab') tab.owner = request.params.owner
      socket.send(
        JSON.stringify({
          id: request.id,
          result: request.method === 'getTabs' ? [tab] : { browser: name }
        })
      )
    })
    await once(socket, 'open')
    return { socket, requests, tab }
  }
  await chrome.pair()
  const originalAddress = chrome.status.pairingUrl
  const chromeBinding = join(pairingDirectory, 'desktop-chrome', 'pairing.enc.json')
  const originalBinding = await readFile(chromeBinding)
  const c = await connect(chrome, 'chrome')
  await opera.pair()
  const operaAddress = opera.status.pairingUrl
  assert.notEqual(operaAddress, originalAddress)
  const o = await connect(opera, 'opera')
  const registry = new CodexDynamicTools()
  const tools = api.registerCodexDesktopTools(registry)
  const sessionOwner = {}
  api.registerBrowserUseSession(sessionOwner, 'dual-routing', '', null)
  registry.bind('dual-routing', registry.specs)
  t.after(() => {
    api.removeBrowserUseSessions(sessionOwner)
    tools.close()
  })
  for (const namespace of ['chrome', 'opera']) {
    const result = await registry.call({
      threadId: 'dual-routing',
      turnId: 'turn',
      callId: namespace,
      namespace,
      tool: 'tabs_context',
      arguments: {}
    })
    assert.equal(result.success, true)
    const visible = JSON.parse(result.contentItems[0].text).tabs
    assert.equal(visible.length, 1)
    assert.equal(visible[0].id, 7)
    assert.equal(visible[0].title, namespace, 'each tool namespace reaches only its own browser')
  }
  const chromeEvents = []
  const operaEvents = []
  const makeClient = (service, sessionId, events) => {
    const client = service.createClient({ ...scope, providerId: 'codex', sessionId }, (event) =>
      events.push(event)
    )
    clients.push(client)
    return client
  }
  const chromeClient = makeClient(chrome, 'chrome-owner', chromeEvents)
  const operaClient = makeClient(opera, 'opera-owner', operaEvents)
  assert.equal((await chromeClient.listTabs())[0].title, 'chrome')
  assert.equal((await operaClient.listTabs())[0].title, 'opera')
  await chromeClient.attach(7)
  await operaClient.attach(7)
  const chromeForeign = makeClient(chrome, 'opera-owner', [])
  const operaForeign = makeClient(opera, 'chrome-owner', [])
  await assert.rejects(chromeForeign.attach(7), /another conversation/)
  await assert.rejects(operaForeign.attach(7), /another conversation/)
  o.socket.send(
    JSON.stringify({
      event: { type: 'message', tabId: 7, method: 'Page.loadEventFired', params: {} }
    })
  )
  await operaClient.listTabs()
  assert.equal(operaEvents.length, 1)
  assert.equal(chromeEvents.length, 0)
  assert.equal((await chromeClient.executeCdp(7, 'Page.getFrameTree')).browser, 'chrome')
  assert.equal((await operaClient.executeCdp(7, 'Page.getFrameTree')).browser, 'opera')
  await opera.close()
  await opera.restore()
  assert.equal(opera.status.pairingUrl, operaAddress)
  const resumed = await connect(opera, 'opera')
  resumed.tab.owner = o.tab.owner
  assert.equal((await operaClient.listTabs())[0].title, 'opera')
  await assert.rejects(operaForeign.attach(7), /another conversation/)
  await opera.disconnect()
  await assert.rejects(operaClient.listTabs(), /Pair the Sele Opera/)
  assert.equal(chrome.status.connected, true)
  assert.equal(chrome.status.pairingUrl, originalAddress)
  assert.deepEqual(await readFile(chromeBinding), originalBinding)
  assert.equal((await chromeClient.executeCdp(7, 'Page.getFrameTree')).browser, 'chrome')
  await opera.pair()
  await connect(opera, 'opera')
  await chrome.disconnect()
  assert.equal(opera.status.connected, true, 'Chrome disconnect cannot revoke Opera')
  assert.equal((await operaClient.listTabs())[0].title, 'opera')
  assert.ok(c.requests.some((request) => request.method === 'executeCdp'))
})

test('Claude exposes Opera independently and refreshes its catalog when Opera pairing changes', async (t) => {
  const service = { createClient: () => ({ close() {} }) }
  const before = api.createClaudeBrowserIntegration(service, scope)
  t.after(() => before.close())
  await api.operaAutomation.pair()
  t.after(() => api.operaAutomation.disconnect())
  assert.equal(before.isCurrent(), false)
  const paired = api.createClaudeBrowserIntegration(service, scope)
  t.after(() => paired.close())
  const names = paired.server.tools.map((tool) => tool.name)
  assert.ok(names.includes('opera_tabs_context'))
  assert.ok(names.includes('opera_computer'))
  assert.ok(!names.includes('chrome_tabs_context'))
  const unavailable = await paired.server.tools
    .find((tool) => tool.name === 'opera_tabs_context')
    .execute({})
  assert.equal(unavailable.isError, true)
  assert.match(unavailable.content[0].text, /Pair the Sele Opera/)
  await api.operaAutomation.disconnect()
  assert.equal(paired.isCurrent(), false)
})

test('resumed Codex MCP exposes both paired browsers and revokes execution with the chat scope', async (t) => {
  const owner = {}
  const bound = {
    providerId: 'codex',
    sessionId: 'old-codex-opera',
    cwd: '/project',
    containerKey: 'host'
  }
  api.registerBrowserUseSession(owner, bound.sessionId, bound.cwd, null)
  let readOnly = false
  const bridge = new api.CodexOperaMcp(() => readOnly)
  t.after(() => {
    bridge.close()
    api.removeBrowserUseSessions(owner)
  })
  const config = await bridge.config(bound)
  const endpoint = config['mcp_servers.sele_opera']
  assert.equal(
    endpoint.default_tools_approval_mode,
    'approve',
    'the authorized host browser must not request approval for every tool call'
  )
  assert.deepEqual(
    await bridge.config(bound),
    config,
    'reuse the chat endpoint without rotating access'
  )
  const rpc = async (method, params) => {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        ...endpoint.http_headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
    assert.equal(response.status, 200)
    return (await response.json()).result
  }
  const names = (await rpc('tools/list')).tools.map((tool) => tool.name)
  assert.ok(names.includes('opera_tabs_context'))
  assert.ok(names.includes('chrome_tabs_context'))
  assert.ok(names.every((name) => name.startsWith('chrome_') || name.startsWith('opera_')))
  const excluded = await rpc('tools/call', {
    name: 'native_computer',
    arguments: { action: 'screenshot' }
  })
  assert.equal(excluded.isError, true)
  readOnly = true
  const denied = await rpc('tools/call', { name: 'opera_tabs_context', arguments: {} })
  assert.equal(denied.isError, true)
  assert.match(denied.content[0].text, /read-only/)
  api.removeBrowserUseSessions(owner)
  await assert.rejects(fetch(endpoint.url, { method: 'POST' }))
})

test('Opera MCP restores the same private endpoint after a host restart', async (t) => {
  const owner = {},
    bound = {
      providerId: 'codex',
      sessionId: 'persistent-opera-chat',
      cwd: '/project',
      containerKey: 'host'
    }
  api.registerBrowserUseSession(owner, bound.sessionId, bound.cwd, null)
  let saved = null
  const store = {
    load: async () => saved,
    save: async (value) => {
      saved = structuredClone(value)
    },
    clear: async () => {
      saved = null
    }
  }
  const first = new api.CodexOperaMcp(
    () => false,
    () => store
  )
  const original = await first.config(bound)
  const endpointBefore = original['mcp_servers.sele_opera']
  const mcp = new Client({ name: 'retained-client-fixture', version: '1' })
  mcp.onerror = () => {}
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(endpointBefore.url), {
      requestInit: { headers: endpointBefore.http_headers }
    })
  )
  assert.ok((await mcp.listTools()).tools.some((tool) => tool.name === 'opera_upload_files'))
  t.after(() => mcp.close())
  const occupied = new api.CodexOperaMcp(
    () => false,
    () => store
  )
  await assert.rejects(occupied.restore(bound), /EADDRINUSE|already in use/)
  await occupied.close()
  assert.equal(
    saved.port,
    Number(new URL(endpointBefore.url).port),
    'port conflicts cannot rotate the retained binding'
  )
  assert.equal(saved.token, endpointBefore.http_headers.Authorization.slice('Bearer '.length))
  await first.close()
  // The retained runtime runs in another process; let its idle HTTP socket observe host exit.
  await new Promise((resolve) => setTimeout(resolve, 25))
  const restored = new api.CodexOperaMcp(
    () => false,
    () => store
  )
  t.after(async () => {
    await restored.close()
    api.removeBrowserUseSessions(owner)
  })
  assert.equal(await restored.restore(bound), true)
  const next = await restored.config(bound)
  assert.deepEqual(next, original, 'the live Codex MCP client must retain its URL and bearer token')
  assert.ok(
    (await mcp.listTools()).tools.some((tool) => tool.name === 'opera_upload_files'),
    'the existing client reconnects without reconfiguration'
  )
  const endpoint = original['mcp_servers.sele_opera']
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      ...endpoint.http_headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  })
  assert.equal(response.status, 200)
  assert.ok((await response.json()).result.tools.some((tool) => tool.name === 'opera_upload_files'))
})
