import { protocol } from 'electron'
import { handleLoggedIpc } from '../logging'
import { isProviderId } from '../../shared/provider'
import { mcpAppsChannels, type McpAppConnection, type McpAppScope } from '../../shared/mcpApps'
import { record } from '../../shared/elicitation'
import { McpAppHost } from './McpAppHost'

const proxy = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;overflow:hidden}</style></head><body><script>
let frame;const parentWindow=window.parent;window.addEventListener('message',event=>{
if(event.source===parentWindow){if(event.data?.method==='ui/notifications/sandbox-resource-ready'){
if(frame)return;frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.src=new URL('/content',location.href).href;document.body.append(frame);
}else if(frame)frame.contentWindow.postMessage(event.data,'*');
}else if(frame&&event.source===frame.contentWindow&&event.data?.jsonrpc==='2.0'&&!String(event.data.method||'').startsWith('ui/notifications/sandbox-'))parentWindow.postMessage(event.data,'*');});
parentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},'*');
</script></body></html>`
export function registerMcpApps(
  resolve: (scope: McpAppScope, callId: string) => Promise<McpAppConnection | null>
): void {
  const host = new McpAppHost()
  const owners = new Set<number>()
  handleLoggedIpc(mcpAppsChannels.open, async (event, scopeValue: unknown, callId: unknown) => {
    const scope = record(scopeValue)
    if (
      !scope ||
      !isProviderId(scope.providerId) ||
      typeof scope.chatId !== 'string' ||
      typeof callId !== 'string'
    )
      throw new Error('Invalid MCP App request.')
    const connection = await resolve({ providerId: scope.providerId, chatId: scope.chatId }, callId)
    if (!connection) throw new Error('This provider runtime does not expose this app resource.')
    const owner = event.sender.id
    if (!owners.has(owner)) {
      owners.add(owner)
      event.sender.once('destroyed', () => {
        host.close(owner)
        owners.delete(owner)
      })
      event.sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
        if (mainFrame) host.close(owner)
      })
    }
    return host.open(owner, connection)
  })
  handleLoggedIpc(
    mcpAppsChannels.request,
    (event, id: unknown, method: unknown, params: unknown) => {
      if (typeof id !== 'string' || typeof method !== 'string' || !record(params))
        throw new Error('Invalid MCP App request.')
      return host.request(event.sender.id, id, method, record(params)!)
    }
  )
  handleLoggedIpc(mcpAppsChannels.close, (event, id: unknown) => {
    if (typeof id === 'string') host.close(event.sender.id, id)
  })
  protocol.handle('sele-mcp-app', (request) => {
    const url = new URL(request.url)
    const document = host.document(url.hostname)
    if (!document) return new Response('App session expired.', { status: 410 })
    const sandbox = url.pathname === '/sandbox'
    if (!sandbox && url.pathname !== '/content') return new Response('Not found', { status: 404 })
    return new Response(sandbox ? proxy : document.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-write=()',
        'Content-Security-Policy': sandbox
          ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src sele-mcp-app:; base-uri 'none'; form-action 'none'"
          : document.csp
      }
    })
  })
}
