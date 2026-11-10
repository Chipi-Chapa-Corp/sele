import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors'
import type { BrowserAutomationScope } from '../../../shared/browser'
import type { BrowserAutomationService } from '../../browser/BrowserAutomation'
import { browserToolInstructions } from '../../browser/BrowserTools'
import {
  createProviderBrowserTools,
  providerBrowserToolInstructions
} from '../../browser/ProviderBrowserTools'

export const claudeBrowserServerName = 'Claude_Browser'

// Keep the basic browsing workflow usable without a tool-search round trip.
// The rest of the catalog (including attached Chrome) can still be deferred.
const alwaysLoadedBrowserTools = new Set(['navigate', 'read_page', 'computer'])

const claudeBrowserInstructions = `${providerBrowserToolInstructions}
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
} {
  const browser = createProviderBrowserTools(service, scope)
  const server = createSdkMcpServer({
    name: claudeBrowserServerName,
    version: '1.0.0',
    instructions: nativeChrome
      ? claudeBrowserInstructions.replace(
          providerBrowserToolInstructions,
          browserToolInstructions
        ) +
        '\nFor the user’s existing Chrome session, use the official claude-in-chrome MCP tools, discovering them with ToolSearch as needed. Sele’s Chrome extension pairing is not used by that integration. Report the official tool’s actual connection error if it is unavailable. The native_computer tool separately controls a user-connected desktop.'
      : claudeBrowserInstructions,
    tools: [
      ...browser.tools
        .filter((definition) => !nativeChrome || !definition.name.startsWith('chrome_'))
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
    close: () => {
      browser.close()
      void server.instance.close().catch((error: unknown) => {
        if (isExpectedClaudeQueryShutdownError(error)) return
        console.error('Unable to close Claude browser MCP server.', error)
      })
    }
  }
}
