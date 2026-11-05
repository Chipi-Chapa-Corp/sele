import type { BrowserAutomationScope } from '../../shared/browser'
import type { BrowserAutomationService } from './BrowserAutomation'
import { browserToolInstructions, createBrowserTools, type BrowserTool } from './BrowserTools'
import { chromeAutomation } from '../desktop/ChromeAutomation'
import {
  computerToolDescription,
  computerToolSchema,
  executeComputerTool
} from '../desktop/ComputerTools'

export const providerBrowserToolInstructions = `${browserToolInstructions}\nThe native_computer tool controls a user-connected desktop. chrome_* tools control Chrome tabs shared using the Sele extension. Connections are managed in Sele Settings → Browser & desktop.`

/** One catalog for SDK MCP, HTTP MCP, and OpenCode's generated plugin. */
export function createProviderBrowserTools(
  service: BrowserAutomationService,
  scope: BrowserAutomationScope
): { tools: BrowserTool[]; close(): void } {
  const browser = createBrowserTools(service, scope)
  const chrome = createBrowserTools(chromeAutomation, scope)
  return {
    tools: [
      ...browser.tools,
      ...chrome.tools.map((tool) => ({
        ...tool,
        name: `chrome_${tool.name}`,
        description: `Attached Chrome: ${tool.description} Only tabs shared using the Sele Chrome extension are available.`
      })),
      {
        name: 'native_computer',
        description: computerToolDescription,
        schema: computerToolSchema,
        execute: executeComputerTool
      }
    ],
    close: () => {
      browser.close()
      chrome.close()
    }
  }
}
