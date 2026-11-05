import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk'

// Use the installed CLI's MCP/tool pipeline with a scripted local model; no paid inference.
export async function checkInstalledCopilotBrowser({
  createBrowserMcpServer,
  browserService,
  runtimePath,
  directory,
  url
}) {
  const modelRequests = []
  const model = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    modelRequests.push(body)
    const results = modelRequests.length - 1
    const name = results === 0 ? 'navigate' : 'computer'
    const tool = body.tools?.find(
      (tool) =>
        tool.function?.name.includes('Sele_Browser') &&
        !tool.function.name.includes('chrome_') &&
        !tool.function.name.includes('native_') &&
        tool.function.name.endsWith(name)
    )
    const message =
      results >= 2
        ? { role: 'assistant', content: 'Browser fixture complete.' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${results}`,
                type: 'function',
                function: {
                  name: tool?.function.name ?? 'MISSING_BROWSER_TOOL',
                  arguments: JSON.stringify(results === 0 ? { url } : { action: 'screenshot' })
                }
              }
            ]
          }
    if (body.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const [delta, finish] of [
        [message, null],
        [{}, results >= 2 ? 'stop' : 'tool_calls']
      ])
        response.write(
          `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
        )
      response.end('data: [DONE]\n\n')
    } else {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          id: 'fixture',
          object: 'chat.completion',
          created: 1,
          model: 'fixture-model',
          choices: [{ index: 0, message, finish_reason: results >= 2 ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        })
      )
    }
  })
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve))
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
  const events = []
  try {
    await client.start()
    session = await client.createSession({
      sessionId: 'copilot-runtime-browser-test',
      workingDirectory: directory,
      model: 'fixture-model',
      provider: {
        type: 'openai',
        baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
        apiKey: 'fixture',
        wireApi: 'completions'
      },
      toolSearch: { enabled: false },
      modelCapabilities: { supports: { vision: true } },
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
    await session.rpc.mcp.list()
    const { tools } = await session.rpc.mcp.listTools({ serverName: 'Sele_Browser' })
    for (const name of [
      'tabs_context',
      'navigate',
      'upload_files',
      'save_screenshot',
      'chrome_tabs_context',
      'native_computer'
    ])
      assert.ok(
        tools.some((tool) => tool.name === name),
        name
      )
    const { tools: metadata } = await session.rpc.tools.getCurrentMetadata()
    const context = metadata.find(
      (tool) => tool.name.includes('Sele_Browser') && tool.name.endsWith('tabs_context')
    )
    assert.ok(context, 'native runtime advertises the Sele MCP tools')
    const completed = []
    session.on((event) =>
      events.push({
        type: event.type,
        ...(event.type === 'session.error' ? { data: event.data } : {})
      })
    )
    session.on('tool.execution_complete', (event) => completed.push(event))
    let timeout
    const idle = new Promise((resolve, reject) => {
      session.on('session.idle', resolve)
      session.on('session.error', (event) => reject(new Error(JSON.stringify(event.data))))
      timeout = setTimeout(() => reject(new Error('Copilot browser fixture did not settle')), 20000)
    })
    try {
      await session.send({ prompt: 'Run the browser fixture.' })
      await idle
    } finally {
      clearTimeout(timeout)
    }
    assert.ok(approvals > 0, 'native tool invocation reaches the SDK permission callback')
    assert.ok(completed.length >= 2, JSON.stringify(completed))
    assert.ok(
      completed.every((event) => event.data.success),
      JSON.stringify(completed)
    )
    assert.ok(
      /data:image\/(?:png|jpeg|webp);base64,/.test(JSON.stringify(modelRequests)),
      'native runtime retains screenshot image content'
    )
    console.log(
      'PASS: installed Copilot CLI discovers all host tools and executes browser navigation and screenshots through a scripted local model'
    )
  } catch (error) {
    console.error(
      'Copilot fixture diagnostics:',
      JSON.stringify({
        requests: modelRequests.map((body) => ({
          keys: Object.keys(body),
          tools: body.tools?.map((tool) => tool.function?.name),
          roles: body.messages?.map((message) => message.role)
        })),
        events
      })
    )
    throw error
  } finally {
    await Promise.allSettled([session?.disconnect(), client.stop(), bridge.close()])
    await new Promise((resolve) => model.close(resolve))
  }
}
