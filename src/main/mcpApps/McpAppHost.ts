import { randomUUID } from 'node:crypto'
import type { McpAppConnection, McpAppResource, McpAppView } from '../../shared/mcpApps'
import { record } from '../../shared/elicitation.ts'
import { validateElicitation } from '../providers/ElicitationValidation.ts'

const maxHtmlBytes = 2_000_000
const htmlMimeType = 'text/html;profile=mcp-app'
export function getMcpAppHtml(resource: McpAppResource): string {
  if (!resource.uri.startsWith('ui://') || resource.mimeType?.replace(/\s/g, '') !== htmlMimeType)
    throw new Error('This resource is not an MCP App document.')
  const html =
    typeof resource.text === 'string'
      ? resource.text
      : typeof resource.blob === 'string'
        ? Buffer.from(resource.blob, 'base64').toString('utf8')
        : null
  if (html === null || Buffer.byteLength(html) > maxHtmlBytes)
    throw new Error('MCP App document is missing or exceeds 2 MB.')
  return html
}
const origins = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .flatMap((item) => {
          if (typeof item !== 'string' || /[\s;'"<>]/.test(item)) return []
          try {
            const url = new URL(item.replace('*.', 'wildcard.'))
            if (
              !['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) ||
              url.username ||
              url.password ||
              url.pathname !== '/' ||
              url.search ||
              url.hash
            )
              return []
            return [url.origin.replace('wildcard.', item.includes('*.') ? '*.' : 'wildcard.')]
          } catch {
            return []
          }
        })
        .join(' ')
    : ''
export function getMcpAppCsp(resource: McpAppResource): string {
  const ui = record(record(resource._meta)?.ui)
  const csp = record(ui?.csp)
  const resources = origins(csp?.resourceDomains)
  const connects = origins(csp?.connectDomains) || "'none'"
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${resources}`,
    `style-src 'unsafe-inline' ${resources}`,
    `img-src data: blob: ${resources}`,
    `font-src data: ${resources}`,
    `media-src data: blob: ${resources}`,
    `connect-src ${connects}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/** Main-process capabilities are bound to one renderer and the originating live runtime. */
export class McpAppHost {
  private views = new Map<
    string,
    { owner: number; connection: McpAppConnection; resource: McpAppResource; html: string }
  >()
  async open(owner: number, connection: McpAppConnection): Promise<McpAppView> {
    if (!connection.isCurrent())
      throw new Error('The originating app session is no longer available.')
    const result = await connection.readResource(connection.resourceUri)
    if (!connection.isCurrent()) throw new Error('The originating app session was disconnected.')
    const resource = result.contents.find((resource) => resource.uri === connection.resourceUri)
    if (!resource) throw new Error('The MCP server did not return the requested app document.')
    const html = getMcpAppHtml(resource)
    // Bound retained HTML even if a renderer repeatedly opens widgets.
    const owned = [...this.views].filter(([, value]) => value.owner === owner)
    if (owned.length >= 20) this.views.delete(owned[0][0])
    const id = randomUUID()
    this.views.set(id, { owner, connection, resource, html })
    return {
      id,
      url: `sele-mcp-app://${id}/sandbox`,
      serverName: connection.serverName,
      input: connection.input,
      result: connection.result,
      canCall: connection.canCall()
    }
  }
  document(id: string): { html: string; csp: string } | null {
    const view = this.views.get(id)
    if (!view || !view.connection.isCurrent()) return null
    return { html: view.html, csp: getMcpAppCsp(view.resource) }
  }
  async request(
    owner: number,
    id: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const view = this.views.get(id)
    if (!view || view.owner !== owner || !view.connection.isCurrent())
      throw new Error('MCP App access was revoked.')
    const connection = view.connection
    const assertCurrent = (): void => {
      if (this.views.get(id) !== view || !connection.isCurrent())
        throw new Error('MCP App access was revoked.')
    }
    if (method === 'resources/read') {
      if (typeof params.uri !== 'string' || !params.uri.startsWith('ui://'))
        throw new Error('Only app resources from the originating server may be read.')
      const result = await connection.readResource(params.uri)
      assertCurrent()
      return result
    }
    if (method === 'tools/list') {
      const result = await connection.listTools()
      assertCurrent()
      return { ...result, tools: result.tools.filter(isAppVisibleTool) }
    }
    if (method !== 'tools/call' || !connection.canCall())
      throw new Error('App tool calls are unavailable for this conversation.')
    if (typeof params.name !== 'string' || !record(params.arguments ?? {}))
      throw new Error('Invalid app tool arguments.')
    const tools = await connection.listTools()
    assertCurrent()
    if (!connection.canCall()) throw new Error('MCP App access was revoked.')
    const tool = tools.tools.find((tool) => tool.name === params.name && isAppVisibleTool(tool))
    if (!tool) throw new Error('This tool is not callable by this app.')
    const error = validateElicitation(
      record(tool.inputSchema) ?? { type: 'object' },
      record(params.arguments) ?? {}
    )
    if (error) throw new Error(error)
    return connection.callTool(params.name, record(params.arguments) ?? {})
  }
  close(owner: number, id?: string): void {
    for (const [key, view] of this.views)
      if (view.owner === owner && (!id || id === key)) this.views.delete(key)
  }
}
export function isAppVisibleTool(tool: Record<string, unknown>): boolean {
  const visibility = record(record(tool._meta)?.ui)?.visibility
  return visibility === undefined || (Array.isArray(visibility) && visibility.includes('app'))
}
