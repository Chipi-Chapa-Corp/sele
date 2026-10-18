import { z } from 'zod'
import type { CodexDynamicTools, CodexDynamicToolResult } from './CodexDynamicTools'
import {
  computerToolSchema,
  computerToolDescription,
  executeComputerTool
} from '../../desktop/ComputerTools'
import { chromeAutomation } from '../../desktop/ChromeAutomation'
import { createBrowserTools } from '../../browser/BrowserTools'

export function registerCodexDesktopTools(registry: CodexDynamicTools): { close(): void } {
  const chrome = new Map<string, ReturnType<typeof createBrowserTools>>()
  const convert = (
    result: Awaited<ReturnType<typeof executeComputerTool>>
  ): CodexDynamicToolResult => ({
    success: !result.isError,
    contentItems: result.content.map((item) =>
      item.type === 'image'
        ? { type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` }
        : { type: 'inputText', text: item.text }
    )
  })
  registry.register(
    {
      type: 'function',
      name: 'computer',
      description: computerToolDescription,
      inputSchema: z.toJSONSchema(computerToolSchema)
    },
    async (args, context) => {
      if (context.signal.aborted) throw new Error('Tool canceled.')
      return convert(await executeComputerTool(args))
    },
    'sele'
  )
  const definitions = createBrowserTools(chromeAutomation, {
    providerId: 'codex',
    sessionId: 'definitions',
    cwd: '',
    containerKey: 'host'
  })
  for (const definition of definitions.tools)
    registry.register(
      {
        type: 'function',
        name: definition.name,
        description: `Chrome attachment: ${definition.description} Only tabs shared using the Sele Chrome extension are available.`,
        inputSchema: z.toJSONSchema(definition.schema)
      },
      async (args, context) => {
        if (context.signal.aborted) throw new Error('Tool canceled.')
        let workspace = chrome.get(context.threadId)
        if (!workspace) {
          workspace = createBrowserTools(chromeAutomation, {
            providerId: 'codex',
            sessionId: context.threadId,
            cwd: '',
            containerKey: 'host'
          })
          chrome.set(context.threadId, workspace)
        }
        const tool = workspace.tools.find((tool) => tool.name === definition.name)!
        return convert(await tool.execute(args))
      },
      'chrome'
    )
  definitions.close()
  return {
    close: () => {
      for (const workspace of chrome.values()) workspace.close()
      chrome.clear()
    }
  }
}
