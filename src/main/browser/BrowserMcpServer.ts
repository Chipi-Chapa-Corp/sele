import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { BrowserAutomationScope } from '../../shared/browser'
import type { BrowserAutomationService } from './BrowserAutomation'
import { browserToolInstructions, createBrowserTools } from './BrowserTools'

export type BrowserMcpIntegration = {
  url: string
  token: string
  /** Revoke in-flight operations, queued work, refs, and debugger leases immediately. */
  suspend(): void
  /** Start a fresh capability at the same immutable workspace scope. */
  resume(): void
  close(): Promise<void>
}

export type BrowserMcpOptions = {
  /** OpenCode shares MCP configuration across sessions, so its caller metadata is mandatory. */
  requireSessionMetadata?: boolean
  authorizeTool?: (name: string, args: Record<string, unknown>) => void | Promise<void>
}

/** A local, authenticated MCP endpoint for runtimes with supported HTTP MCP configuration.
 * The bearer token is a per-session capability; it is never published in discovery or logs.
 * Remote/container sessions must not receive this host endpoint.
 */
export async function createBrowserMcpServer(
  service: BrowserAutomationService,
  scope: BrowserAutomationScope,
  options: BrowserMcpOptions = {}
): Promise<BrowserMcpIntegration> {
  // Snapshot the scope: a caller cannot widen an existing endpoint by mutating its input.
  const boundScope = { ...scope }
  let browser: ReturnType<typeof createBrowserTools> | null = createBrowserTools(
    service,
    boundScope
  )
  const definitions = browser.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema) as {
      type: 'object'
      properties?: Record<string, object>
      required?: string[]
    }
  }))
  const token = randomBytes(32).toString('base64url')
  const expectedAuthorization = Buffer.from(`Bearer ${token}`)
  const connections = new Set<Server>()
  let closed = false
  let host = ''
  const http = createServer(async (request, response) => {
    const authorization = Buffer.from(request.headers.authorization ?? '')
    // Reject browser origins and unexpected Hosts as well as unauthenticated callers.
    if (
      closed ||
      request.headers.origin ||
      request.headers.host !== host ||
      authorization.length !== expectedAuthorization.length ||
      !timingSafeEqual(authorization, expectedAuthorization)
    ) {
      response.writeHead(403).end()
      return
    }
    if (request.url !== '/mcp' || request.method !== 'POST') {
      response.writeHead(request.url === '/mcp' ? 405 : 404).end()
      return
    }
    const server = new Server(
      { name: 'Sele_Browser', version: '1.0.0' },
      { capabilities: { tools: {} }, instructions: browserToolInstructions }
    )
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    connections.add(server)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }))
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      if (
        options.requireSessionMetadata &&
        call.params._meta?.['ai.opencode/sessionID'] !== boundScope.sessionId
      ) {
        return {
          content: [{ type: 'text', text: 'Browser caller session mismatch' }],
          isError: true
        }
      }
      const current = browser
      const tool = current?.tools.find((tool) => tool.name === call.params.name)
      if (!current || !tool || closed) {
        return {
          content: [{ type: 'text', text: 'Browser session is unavailable' }],
          isError: true
        }
      }
      try {
        await options.authorizeTool?.(tool.name, call.params.arguments ?? {})
        // Approval can outlive stop/replacement; never execute through a revoked capability.
        if (browser !== current || closed) throw new Error('Browser session closed')
        return await tool.execute(call.params.arguments ?? {})
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true
        }
      }
    })
    response.once('close', () => {
      connections.delete(server)
      void server
        .close()
        .catch((error) => console.error('Unable to close browser MCP request.', error))
    })
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 1_000_000) {
          response.writeHead(413).end()
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      await server.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch (error) {
      console.error('Browser MCP request failed.', error)
      if (!response.headersSent) response.writeHead(400).end()
      else response.end()
    }
  })
  http.requestTimeout = 30_000
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', resolve)
    })
  } catch (error) {
    browser.close()
    throw error
  }
  const address = http.address()
  if (!address || typeof address === 'string') {
    browser.close()
    http.close()
    throw new Error('Browser MCP endpoint has no local address')
  }
  host = `127.0.0.1:${address.port}`
  const suspend = (): void => {
    browser?.close()
    browser = null
  }
  return {
    url: `http://${host}/mcp`,
    token,
    suspend,
    resume: () => {
      if (closed) throw new Error('Browser MCP endpoint closed')
      browser ??= createBrowserTools(service, boundScope)
    },
    close: async () => {
      if (closed) return
      closed = true
      suspend()
      const finished = new Promise<void>((resolve) => http.close(() => resolve()))
      http.closeAllConnections()
      await Promise.allSettled([...connections].map((server) => server.close()))
      await finished
    }
  }
}
