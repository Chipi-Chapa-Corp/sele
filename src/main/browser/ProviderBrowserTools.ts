import type { BrowserAutomationScope } from '../../shared/browser'
import type { BrowserAutomationService } from './BrowserAutomation'
import {
  browserToolInstructions,
  browserSelectionInstructions,
  createBrowserTools,
  type BrowserTool
} from './BrowserTools'
import { pairedBrowserAutomations } from '../desktop/ChromeAutomation'
import { pairedBrowserNames, type PairedBrowserId } from '../../shared/desktop'
import {
  computerToolDescription,
  computerToolSchema,
  executeComputerTool
} from '../desktop/ComputerTools'

export const providerBrowserToolInstructions = `${browserToolInstructions}\n${browserSelectionInstructions}\nThe native_computer tool controls a user-connected desktop. chrome_* tools control Chrome tabs and opera_* tools control Opera tabs shared using the Sele extension. Each browser has its own pairing and tab ownership. Tab IDs are local to their browser: always keep the matching tool prefix, even if another browser reports the same numeric ID. Connections are managed in Sele Settings → Browser & desktop.`

/** One catalog for SDK MCP, HTTP MCP, and OpenCode's generated plugin. */
export function createProviderBrowserTools(
  service: BrowserAutomationService,
  scope: BrowserAutomationScope,
  pairedBrowsers?: readonly PairedBrowserId[]
): { tools: BrowserTool[]; close(): void } {
  const browser = pairedBrowsers ? null : createBrowserTools(service, scope)
  const attached = Object.entries(pairedBrowserAutomations)
    .filter(([id]) => !pairedBrowsers || pairedBrowsers.includes(id as PairedBrowserId))
    .map(([id, automation]) => ({
      id: id as PairedBrowserId,
      browser: createBrowserTools(automation, scope)
    }))
  return {
    tools: [
      ...(browser?.tools ?? []),
      ...attached.flatMap(({ id, browser }) =>
        browser.tools.map((tool) => ({
          ...tool,
          name: `${id}_${tool.name}`,
          description: `Attached ${pairedBrowserNames[id]}: ${tool.description} Only ${pairedBrowserNames[id]} tabs shared using the Sele extension are available. Tab IDs belong to this browser only.`
        }))
      ),
      ...(!pairedBrowsers
        ? [
            {
              name: 'native_computer',
              description: computerToolDescription,
              schema: computerToolSchema,
              execute: executeComputerTool
            }
          ]
        : [])
    ],
    close: () => {
      browser?.close()
      for (const { browser } of attached) browser.close()
    }
  }
}
