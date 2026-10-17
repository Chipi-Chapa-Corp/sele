import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { BrowserAutomationScope } from '../../../shared/browser'
import type { BrowserAutomationService } from '../../browser/BrowserAutomation'
import { createBrowserMcpServer, type BrowserMcpIntegration } from '../../browser/BrowserMcpServer'
import { browserToolInstructions, createBrowserTools } from '../../browser/BrowserTools'

export const openCodeBrowserToolPrefix = 'sele_browser_'

type Binding = { cwd: string; browser: BrowserMcpIntegration }

/** OpenCode's native MCP registration is directory-wide and older runtimes omit caller
 * metadata. A runtime plugin supplies ToolContext.sessionID, never a model argument.
 * Only this ephemeral plugin receives the routing secret; individual MCP secrets stay here.
 */
export async function createOpenCodeBrowserBridge(service: BrowserAutomationService): Promise<{
  pluginUrl: string
  register(scope: BrowserAutomationScope): Promise<BrowserMcpIntegration>
  close(): Promise<void>
}> {
  const discovery = createBrowserTools(service, {
    providerId: 'opencode',
    sessionId: 'discovery',
    cwd: '',
    containerKey: 'host'
  })
  const definitions = discovery.tools.map(({ name, description, schema }) => ({
    name,
    description,
    inputSchema: z.toJSONSchema(schema)
  }))
  discovery.close()
  const bindings = new Map<string, Binding>()
  const registrations = new Map<string, object>()
  const pending = new Set<Promise<BrowserMcpIntegration>>()
  const token = randomBytes(32).toString('base64url')
  const authorization = Buffer.from(`Bearer ${token}`)
  let host = ''
  let closed = false
  const http = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? '')
    if (
      closed ||
      request.headers.origin ||
      request.headers.host !== host ||
      supplied.length !== authorization.length ||
      !timingSafeEqual(supplied, authorization)
    ) {
      response.writeHead(403).end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/call') {
      response.writeHead(404).end()
      return
    }
    try {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 1_000_000) {
          response.writeHead(413).end()
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const call = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const binding = bindings.get(call.sessionID)
      const callerDirectory =
        typeof call.directory === 'string'
          ? await realpath(call.directory).catch(() => call.directory)
          : null
      if (!binding || binding.cwd !== callerDirectory)
        throw new Error('Browser session is unavailable')
      const upstream = await fetch(binding.browser.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${binding.browser.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: call.name,
            arguments: call.args,
            _meta: { 'ai.opencode/sessionID': call.sessionID }
          }
        })
      })
      if (!upstream.ok) throw new Error('Browser transport is unavailable')
      const rpc = await upstream.json()
      if (rpc.error) throw new Error(rpc.error.message ?? 'Browser tool failed')
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(rpc.result))
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Browser tool failed'
        })
      )
    }
  })
  http.requestTimeout = 30_000
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  const address = http.address()
  if (!address || typeof address === 'string') {
    http.close()
    throw new Error('Browser bridge has no local address')
  }
  host = `127.0.0.1:${address.port}`
  // A home cache path is visible to host-launched OpenCode in Flatpak too; /tmp is private there.
  const cache = join(homedir(), '.cache', 'sele')
  let directory: string | undefined
  try {
    await mkdir(cache, { recursive: true })
    directory = await mkdtemp(join(cache, 'opencode-browser-'))
    await writeFile(
      join(directory, 'plugin.mjs'),
      openCodeBrowserPluginSource(`http://${host}/call`, token, definitions),
      { mode: 0o600 }
    )
  } catch (error) {
    http.close()
    if (directory) await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    pluginUrl: pathToFileURL(join(directory, 'plugin.mjs')).href,
    register: async (scope) => {
      if (closed) throw new Error('OpenCode browser bridge closed')
      scope = { ...scope }
      const registration = {}
      registrations.set(scope.sessionId, registration)
      const previous = bindings.get(scope.sessionId)
      bindings.delete(scope.sessionId)
      await previous?.browser.close()
      const cwd = scope.cwd ?? ''
      const canonicalCwd = await realpath(cwd).catch(() => cwd)
      if (closed || registrations.get(scope.sessionId) !== registration) {
        throw new Error('OpenCode browser registration was canceled')
      }
      const creation = createBrowserMcpServer(service, scope, { requireSessionMetadata: true })
      pending.add(creation)
      let browser: BrowserMcpIntegration
      try {
        browser = await creation
      } finally {
        pending.delete(creation)
      }
      if (closed || registrations.get(scope.sessionId) !== registration) {
        await browser.close()
        throw new Error('OpenCode browser bridge closed')
      }
      const binding = { cwd: canonicalCwd, browser }
      bindings.set(scope.sessionId, binding)
      return {
        ...browser,
        close: async () => {
          if (bindings.get(scope.sessionId) === binding) bindings.delete(scope.sessionId)
          if (registrations.get(scope.sessionId) === registration)
            registrations.delete(scope.sessionId)
          await browser.close()
        }
      }
    },
    close: async () => {
      if (closed) return
      closed = true
      const finished = new Promise<void>((resolve) => http.close(() => resolve()))
      http.closeAllConnections()
      const browsers = [...bindings.values()].map(({ browser }) => browser)
      bindings.clear()
      registrations.clear()
      await Promise.allSettled(browsers.map((browser) => browser.close()))
      await Promise.allSettled(pending)
      await finished
      await rm(directory, { recursive: true, force: true })
    }
  }
}

type Definition = { name: string; description: string; inputSchema: object }

/** Dependency-free plugin: OpenCode 1.19 accepts JSON Schema args and the tool.definition
 * hook preserves optional properties. Validation remains in the shared MCP tool schemas.
 */
export const openCodeBrowserPluginSource = (
  url: string,
  token: string,
  definitions: Definition[]
): string => `
const definitions = ${JSON.stringify(definitions)};
export default async () => ({
  tool: Object.fromEntries(definitions.map(def => [${JSON.stringify(openCodeBrowserToolPrefix)} + def.name, {
    description: def.description + ${JSON.stringify(` ${browserToolInstructions}`)},
    args: def.inputSchema.properties || {},
    async execute(args, context) {
      context.abort.throwIfAborted();
      await context.ask({ permission: ${JSON.stringify(openCodeBrowserToolPrefix)} + def.name,
        patterns: [def.name], always: [def.name], metadata: { description: def.description, arguments: args } });
      context.abort.throwIfAborted();
      const response = await fetch(${JSON.stringify(url)}, {
        method: 'POST', signal: context.abort,
        headers: { Authorization: ${JSON.stringify(`Bearer ${token}`)}, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: context.sessionID, directory: context.directory, name: def.name, args })
      });
      const result = await response.json();
      if (!response.ok || result.isError) throw new Error(result.error || result.content?.filter(x => x.type === 'text').map(x => x.text).join('\\n') || 'Browser tool failed');
      return { title: 'Browser: ' + def.name,
        output: result.content.filter(x => x.type === 'text').map(x => x.text).join('\\n'),
        attachments: result.content.filter(x => x.type === 'image').map(x => ({ type: 'file', mime: x.mimeType, url: 'data:' + x.mimeType + ';base64,' + x.data })) };
    }
  }])),
  'tool.definition': async ({ toolID }, output) => {
    const def = definitions.find(def => ${JSON.stringify(openCodeBrowserToolPrefix)} + def.name === toolID);
    if (def) output.jsonSchema = def.inputSchema;
  }
});
`
