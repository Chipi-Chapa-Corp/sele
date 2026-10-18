import type { ProviderId } from './provider'
export type McpAppScope = { providerId: ProviderId; chatId: string }
export type McpAppResource = {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  _meta?: unknown
}
export type McpAppConnection = {
  serverName: string
  resourceUri: string
  input: Record<string, unknown>
  result: Record<string, unknown>
  readResource(uri: string): Promise<{ contents: McpAppResource[] }>
  listTools(): Promise<{ tools: Array<Record<string, unknown>> }>
  callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>
  isCurrent(): boolean
  canCall(): boolean
}
export type McpAppView = {
  id: string
  url: string
  serverName: string
  input: Record<string, unknown>
  result: Record<string, unknown>
  canCall: boolean
}
export type McpAppsApi = {
  open(scope: McpAppScope, callId: string): Promise<McpAppView>
  request(
    id: string,
    method: 'tools/list' | 'tools/call' | 'resources/read',
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>>
  close(id: string): Promise<void>
}
export const mcpAppsChannels = {
  open: 'mcp-apps:open',
  request: 'mcp-apps:request',
  close: 'mcp-apps:close'
} as const
