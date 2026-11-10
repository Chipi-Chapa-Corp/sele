import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { CodexDynamicTools } from '../providers/codex/CodexDynamicTools.ts'
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export {registerCodexDesktopTools} from './src/main/providers/codex/CodexDesktopTools';export {registerCodexBrowserTools} from './src/main/providers/codex/CodexBrowserTools';export {createBrowserMcpServer} from './src/main/browser/BrowserMcpServer';export {createOpenCodeBrowserBridge} from './src/main/providers/opencode/OpenCodeBrowserBridge';export {createClaudeBrowserIntegration} from './src/main/providers/claude/ClaudeBrowserTools'",
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
              ? 'export const nativeImage={};export const app={};'
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
const scope = { providerId: 'claude', sessionId: 'fixture', cwd: '', containerKey: 'host' }

test('Claude desktop tools keep unique names and expose native and attached Chrome capabilities', async () => {
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
    assert.deepEqual(loaded.sort(), [
      'chrome_tabs_context',
      'computer',
      'navigate',
      'read_page',
      'tabs_context'
    ])
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

test('all four providers advertise the complete same catalog and preserve native screenshot images', async () => {
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
            : namespace.name === 'chrome'
              ? `chrome_${tool.name}`
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
  }
})
