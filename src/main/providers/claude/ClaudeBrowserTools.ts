import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors'
import type { BrowserAutomationScope } from '../../../shared/browser'
import type { BrowserAutomationService } from '../../browser/BrowserAutomation'
import { browserToolInstructions, createBrowserTools } from '../../browser/BrowserTools'

export const claudeBrowserServerName = 'Claude_Browser'

/** The Agent SDK carries MCP over its control channel; operations remain provider-neutral. */
export function createClaudeBrowserIntegration(
  service: BrowserAutomationService,
  scope: BrowserAutomationScope
): {
  server: ReturnType<typeof createSdkMcpServer>
  close(): void
} {
  const browser = createBrowserTools(service, scope)
  const server = createSdkMcpServer({
    name: claudeBrowserServerName,
    version: '1.0.0',
    instructions: browserToolInstructions,
    tools: browser.tools.map((definition) =>
      tool(
        definition.name,
        definition.description,
        definition.schema.shape,
        (args) => definition.execute(args),
        { alwaysLoad: definition.alwaysLoad }
      )
    )
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
