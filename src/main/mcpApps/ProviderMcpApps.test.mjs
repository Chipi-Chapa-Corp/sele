import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { record } from '../../shared/elicitation.ts'
import { isAppVisibleTool } from './McpAppHost.ts'
function extract(provider) {
  const name = provider[0].toUpperCase() + provider.slice(1)
  const source = ts.createSourceFile(
    'adapter.ts',
    readFileSync(
      new URL(`../providers/${provider}/${name}ProviderAdapter.ts`, import.meta.url),
      'utf8'
    ),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === `${name}ProviderAdapter`
  )
  const member = declaration.members.find((node) => node.name?.getText(source) === 'getMcpApp')
  return vm.runInNewContext(
    ts.transpile(`class Harness { ${member.getText(source)} };new Harness()`, {
      target: ts.ScriptTarget.ES2022
    }),
    { mcpRecord: record, isAppVisibleTool, getContainerTargetKey: () => 'host' }
  )
}

test('Codex app bridge uses the originating call and thread for resources and runtime tool calls', async () => {
  const adapter = extract('codex')
  const calls = []
  const client = {
    connectionIdentity: {},
    ownsThread: () => true,
    dynamicTools: { isReadOnly: () => false },
    request: async (method, params) => {
      calls.push({ method, params })
      return method === 'mcpServerStatus/list'
        ? {
            data: [
              {
                name: 'source',
                tools: {
                  shown: { name: 'shown' },
                  hidden: { name: 'hidden', _meta: { ui: { visibility: ['model'] } } }
                }
              }
            ]
          }
        : { contents: [] }
    }
  }
  Object.assign(adapter, {
    clients: new Map([['host', client]]),
    getClient: () => client,
    getThreadContainer: () => null,
    externallyOwnedThreadIds: new Set(),
    threads: new Map([
      [
        'chat',
        {
          turns: [
            {
              items: [
                {
                  id: 'call',
                  type: 'mcpToolCall',
                  server: 'source',
                  tool: 'display',
                  arguments: {},
                  result: { content: [] },
                  mcpAppUi: { resourceUri: 'ui://source/widget' }
                }
              ]
            }
          ]
        }
      ]
    ])
  })
  const app = await adapter.getMcpApp('chat', 'call')
  assert.equal(app.canCall(), true)
  await app.readResource(app.resourceUri)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    method: 'mcpServer/resource/read',
    params: { threadId: 'chat', originCallId: 'call', server: 'source', uri: 'ui://source/widget' }
  })
  assert.deepEqual(JSON.parse(JSON.stringify(await app.listTools())), {
    tools: [{ name: 'shown' }]
  })
  await app.callTool('shown', {})
  assert.equal(calls.at(-1).params.server, 'source')
  client.dynamicTools.isReadOnly = () => true
  assert.equal(app.canCall(), false)
  adapter.clients.clear()
  assert.equal(app.isCurrent(), false)
})

test('Copilot app bridge uses captured resources and pins widget calls to their origin server', async () => {
  const adapter = extract('copilot')
  const calls = []
  const session = {
    capabilities: { ui: { mcpApps: true } },
    rpc: {
      mcp: {
        apps: {
          listTools: async (value) => {
            calls.push(value)
            return { tools: [] }
          },
          readResource: () => assert.fail('captured resource should be reused'),
          callTool: async (value) => {
            calls.push(value)
            return { content: [] }
          }
        }
      }
    }
  }
  const client = { rpc: {} }
  const state = {
    session,
    client,
    container: null,
    options: {},
    events: [
      {
        type: 'tool.execution_start',
        data: { toolCallId: 'call', mcpServerName: 'source', arguments: {} }
      },
      {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call',
          success: true,
          result: {
            contents: [],
            uiResource: {
              uri: 'ui://source/widget',
              mimeType: 'text/html;profile=mcp-app',
              text: '<p>Widget</p>'
            }
          }
        }
      }
    ]
  }
  adapter.states = new Map([['chat', state]])
  adapter.clientEntries = new Map([['host', { client }]])
  const app = await adapter.getMcpApp('chat', 'call')
  assert.equal((await app.readResource(app.resourceUri)).contents[0].text, '<p>Widget</p>')
  await app.callTool('run', { x: 1 })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    serverName: 'source',
    originServerName: 'source',
    toolName: 'run',
    arguments: { x: 1 }
  })
  state.options.sandboxMode = 'read-only'
  assert.equal(app.canCall(), false)
  state.session = null
  assert.equal(app.isCurrent(), false)
})
