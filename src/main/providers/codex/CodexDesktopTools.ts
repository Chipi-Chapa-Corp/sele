import { z } from 'zod'
import type { CodexDynamicTools } from './CodexDynamicTools'
import {
  computerToolSchema,
  computerToolDescription,
  executeComputerTool
} from '../../desktop/ComputerTools'
import { chromeAutomation } from '../../desktop/ChromeAutomation'
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
  return registerCodexBrowserToolSet(
    registry,
    chromeAutomation,
    'chrome',
    'Chrome',
    (description) =>
      `Optional Sele Chrome connection: ${description} Only tabs shared using the Sele Chrome extension are available. Use this connection when the user chooses Sele's shared-tab extension. An existing official Chrome connection uses the provider's browser tools and does not require Sele pairing.`
  )
}
