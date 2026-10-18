import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { CodexDynamicTools } from '../providers/codex/CodexDynamicTools.ts'
const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export {registerCodexDesktopTools} from './src/main/providers/codex/CodexDesktopTools';export {createClaudeBrowserIntegration} from './src/main/providers/claude/ClaudeBrowserTools'",
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'desktop-fixture',
      setup(build) {
        build.onResolve(
          { filter: /^electron$|ComputerAutomation$|^@anthropic-ai\/claude-agent-sdk$/ },
          (args) => ({ path: args.path, namespace: 'test' })
        )
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents:
            path === 'electron'
              ? 'export const nativeImage={};export const app={};'
              : path.endsWith('ComputerAutomation')
                ? 'export const computerAutomation={execute:async args=>({success:true,action:args.action})}'
                : 'export const tool=(name,description,schema,execute)=>({name,description,schema,execute});export const createSdkMcpServer=options=>({...options,instance:{close:async()=>{}}});'
        }))
      }
    }
  ]
})
const module = { exports: {} }
vm.runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  require,
  console,
  Buffer,
  setTimeout,
  clearTimeout,
  URL,
  process,
  AbortController,
  structuredClone
})
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
