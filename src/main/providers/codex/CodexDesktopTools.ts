import { z } from 'zod'
import type { CodexDynamicTools } from './CodexDynamicTools'
import {
  computerToolSchema,
  computerToolDescription,
  executeComputerTool
} from '../../desktop/ComputerTools'
import { pairedBrowserAutomations } from '../../desktop/ChromeAutomation'
import { pairedBrowserNames, type PairedBrowserId } from '../../../shared/desktop'
import { browserSelectionInstructions } from '../../browser/BrowserTools'
import { registerCodexBrowserToolSet, toCodexToolResult } from './CodexBrowserTools'

export function registerCodexDesktopTools(registry: CodexDynamicTools): { close(): void } {
  registry.register(
    {
      type: 'function',
      name: 'computer',
      description: computerToolDescription,
      inputSchema: z.toJSONSchema(computerToolSchema)
    },
    async (args, context) => {
      if (context.signal.aborted) throw new Error('Tool canceled.')
      return toCodexToolResult(await executeComputerTool(args))
    },
    'sele'
  )
  const browsers = Object.entries(pairedBrowserAutomations).map(([browserId, automation]) => {
    const id = browserId as PairedBrowserId
    const name = pairedBrowserNames[id]
    return registerCodexBrowserToolSet(
      registry,
      automation,
      id,
      name,
      (description) =>
        `Optional Sele ${name} connection: ${description} ${browserSelectionInstructions} Only ${name} tabs shared using the Sele extension are available. Tab IDs belong to this browser only; use this namespace for every action on them. Use this connection when the user chooses Sele's shared-tab extension. An existing official Chrome connection uses the provider's browser tools and does not require Sele pairing.`
    )
  })
  return { close: () => browsers.forEach((browser) => browser.close()) }
}
