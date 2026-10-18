import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors'
import type { BrowserAutomationScope } from '../../../shared/browser'
import type { BrowserAutomationService } from '../../browser/BrowserAutomation'
import { browserToolInstructions, createBrowserTools } from '../../browser/BrowserTools'
import { chromeAutomation } from '../../desktop/ChromeAutomation'
import {
  computerToolDescription,
  computerToolSchema,
  executeComputerTool
} from '../../desktop/ComputerTools'

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
  const chrome = createBrowserTools(chromeAutomation, scope)
  const server = createSdkMcpServer({
    name: claudeBrowserServerName,
    version: '1.0.0',
    instructions: `${browserToolInstructions}\nThe native_computer tool controls a user-connected Linux desktop. chrome_* tools control only Chrome tabs shared using the Sele extension. Connections are managed in Sele Settings → Browser & desktop.`,
    tools: [
      ...browser.tools.map((definition) =>
        tool(
          definition.name,
          definition.description,
          definition.schema.shape,
          (args) => definition.execute(args),
          { alwaysLoad: definition.alwaysLoad }
        )
      ),
      ...chrome.tools.map((definition) =>
        tool(
          `chrome_${definition.name}`,
          `Attached Chrome: ${definition.description}`,
          definition.schema.shape,
          (args) => definition.execute(args)
        )
      ),
      tool('native_computer', computerToolDescription, computerToolSchema.shape, (args) =>
        executeComputerTool(args)
      )
    ]
  })
  return {
    server,
    close: () => {
      browser.close()
      chrome.close()
      void server.instance.close().catch((error: unknown) => {
        if (isExpectedClaudeQueryShutdownError(error)) return
        console.error('Unable to close Claude browser MCP server.', error)
      })
    }
  }
}
