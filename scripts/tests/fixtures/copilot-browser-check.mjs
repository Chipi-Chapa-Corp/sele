import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk'

// Use the installed CLI's native MCP/tool pipeline. This sends no model prompt.
export async function checkInstalledCopilotBrowser({
  createBrowserMcpServer,
  browserService,
  runtimePath,
  directory,
  url
}) {
  const bridge = await createBrowserMcpServer(browserService, {
    providerId: 'copilot',
    sessionId: 'copilot-runtime-browser-test',
    cwd: directory,
    containerKey: 'host'
  })
  const client = new CopilotClient({
    mode: 'copilot-cli',
    baseDirectory: join(directory, 'copilot-data'),
    workingDirectory: directory,
    connection: RuntimeConnection.forStdio(runtimePath === 'bundled' ? {} : { path: runtimePath }),
    logLevel: 'error'
  })
  let session
  let approvals = 0
  try {
    await client.start()
    session = await client.createSession({
      sessionId: 'copilot-runtime-browser-test',
      workingDirectory: directory,
      enableConfigDiscovery: false,
      enableSkills: false,
      mcpServers: {
        Sele_Browser: {
          type: 'http',
          url: bridge.url,
          headers: { Authorization: `Bearer ${bridge.token}` },
          tools: ['*']
        }
      },
      // Only the explicit fixture calls below run; no model chooses tools.
      onPermissionRequest: () => {
        approvals++
        return { kind: 'approve-once' }
      }
    })
    await session.rpc.tools.initializeAndValidate()
    const { tools } = await session.rpc.mcp.listTools({ serverName: 'Sele_Browser' })
    for (const name of ['tabs_context', 'navigate', 'upload_files', 'save_screenshot'])
      assert.ok(
        tools.some((tool) => tool.name === name),
        name
      )
    const { tools: metadata } = await session.rpc.tools.getCurrentMetadata()
    const context = metadata.find(
      (tool) => tool.name.includes('Sele_Browser') && tool.name.endsWith('tabs_context')
    )
    assert.ok(context, 'native runtime advertises the Sele MCP tools')
    const result = await session.rpc.tools.execute({ name: context.name, arguments: {} })
    assert.ok(
      JSON.stringify(result).includes('tabs'),
      `read-only tab listing executes through CLI: ${JSON.stringify(result)}`
    )
    assert.ok(approvals > 0, 'native tool invocation reaches the SDK permission callback')
    const execute = (name, args) => {
      const tool = metadata.find(
        (tool) => tool.name.includes('Sele_Browser') && tool.name.endsWith(name)
      )
      assert.ok(tool, name)
      return session.rpc.tools.execute({ name: tool.name, arguments: args })
    }
    const navigated = await execute('navigate', { url })
    assert.equal(navigated.resultType, 'success')
    const screenshot = await execute('computer', { action: 'screenshot' })
    assert.equal(screenshot.resultType, 'success')
    assert.ok(
      screenshot.binaryResultsForLlm?.length ||
        screenshot.contents?.some((part) => part.type === 'image'),
      'native runtime retains screenshot image content'
    )
    console.log(
      'PASS: installed Copilot CLI discovers and executes Sele browser MCP tools without model inference'
    )
  } finally {
    await Promise.allSettled([session?.disconnect(), client.stop(), bridge.close()])
  }
}
