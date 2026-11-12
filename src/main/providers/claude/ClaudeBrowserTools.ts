import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors'
import type { BrowserAutomationScope } from '../../../shared/browser'
import type { BrowserAutomationService } from '../../browser/BrowserAutomation'
import { browserToolInstructions } from '../../browser/BrowserTools'
import { chromeAutomation, operaAutomation } from '../../desktop/ChromeAutomation'
import {
  createProviderBrowserTools,
  providerBrowserToolInstructions
} from '../../browser/ProviderBrowserTools'

export const claudeBrowserServerName = 'Claude_Browser'

// Keep the basic browsing workflow usable without a tool-search round trip.
// The rest of the catalog (including attached Chrome) can still be deferred.
const alwaysLoadedBrowserTools = new Set(['navigate', 'read_page', 'computer'])

const claudeBrowserInstructions = `${providerBrowserToolInstructions}
For the user's existing Chrome session, prefer the provider's configured Chrome tools, discovering them with ToolSearch as needed. Existing native or MCP connections do not require Sele extension pairing. Only use chrome_* tools when the user chooses Sele's separate shared-tab connection.
For the user's paired Opera session, use opera_* tools. Keep the same browser prefix for all operations on a tab; a Chrome tab ID must never be used with Opera tools or vice versa.
You have browser access through the Claude_Browser MCP server. Use tabs_context to inspect Sele's browser workspace, navigate to open a page (including when there are no tabs), read_page to inspect it, and computer to interact with it. These embedded-browser tools work on macOS, Windows, and Linux without a Chrome extension or a native desktop connection.
Additional browser actions may be deferred. Use ToolSearch to load them by their full name, for example select:mcp__Claude_Browser__tabs_create or select:mcp__Claude_Browser__form_input. Check the supplied tools before reporting that browser access is unavailable. If a tool fails, report its actual error and any setup it requests.`

/** The Agent SDK carries MCP over its control channel; operations remain provider-neutral. */
export function createClaudeBrowserIntegration(
  service: BrowserAutomationService,
  scope: BrowserAutomationScope,
  nativeChrome = false
): {
  server: ReturnType<typeof createSdkMcpServer>
  close(): void
  isCurrent(): boolean
} {
  const sharedChrome =
    chromeAutomation.status.connected || Boolean(chromeAutomation.status.pairingUrl)
  const sharedOpera = operaAutomation.status.connected || Boolean(operaAutomation.status.pairingUrl)
  const browser = createProviderBrowserTools(service, scope)
  const server = createSdkMcpServer({
    name: claudeBrowserServerName,
    version: '1.0.0',
    instructions:
      (sharedChrome || sharedOpera
        ? claudeBrowserInstructions
        : claudeBrowserInstructions.replace(
            providerBrowserToolInstructions,
            browserToolInstructions
          ) + '\nThe native_computer tool separately controls a user-connected desktop.') +
      (nativeChrome
        ? '\nThe official claude-in-chrome MCP tools are enabled as an additional Chrome connection. Discover them with ToolSearch as needed. This does not replace other configured browser tools or a paired Sele connection. Use the connection requested by the user and report its actual connection error if unavailable. Sele extension pairing is not required by the official integration.'
        : ''),
    tools: [
      ...browser.tools
        .filter((definition) =>
          definition.name.startsWith('chrome_')
            ? sharedChrome
            : !definition.name.startsWith('opera_') || sharedOpera
        )
        .map((definition) =>
          tool(
            definition.name,
            definition.description,
            definition.schema.shape,
            (args) => definition.execute(args),
            { alwaysLoad: definition.alwaysLoad || alwaysLoadedBrowserTools.has(definition.name) }
          )
        )
    ]
  })
  return {
    server,
    isCurrent: () =>
      sharedChrome ===
        (chromeAutomation.status.connected || Boolean(chromeAutomation.status.pairingUrl)) &&
      sharedOpera ===
        (operaAutomation.status.connected || Boolean(operaAutomation.status.pairingUrl)),
    close: () => {
      browser.close()
      void server.instance.close().catch((error: unknown) => {
        if (isExpectedClaudeQueryShutdownError(error)) return
        console.error('Unable to close Claude browser MCP server.', error)
      })
    }
  }
}
