import { z } from 'zod'
import type { CodexDynamicTools, CodexDynamicToolResult } from './CodexDynamicTools'
import {
  computerToolSchema,
  computerToolDescription,
  executeComputerTool
} from '../../desktop/ComputerTools'
import { pairedBrowserAutomations } from '../../desktop/ChromeAutomation'
import { pairedBrowserNames, type PairedBrowserId } from '../../../shared/desktop'
import { createBrowserTools } from '../../browser/BrowserTools'
import { getBrowserUseSession, onBrowserUseSessionRemoved } from './CodexBrowserSessions'

export function registerCodexDesktopTools(registry: CodexDynamicTools): { close(): void } {
  const browsers = new Map<PairedBrowserId, Map<string, ReturnType<typeof createBrowserTools>>>()
  const revoke = (sessionId: string): void => {
    for (const workspaces of browsers.values()) {
      workspaces.get(sessionId)?.close()
      workspaces.delete(sessionId)
    }
  }
  let unsubscribe: (() => void) | undefined
  const subscribe = (): void => {
    unsubscribe ??= onBrowserUseSessionRemoved(revoke)
  }
  subscribe()
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
  for (const [browserId, automation] of Object.entries(pairedBrowserAutomations)) {
    const id = browserId as PairedBrowserId
    const workspaces = new Map<string, ReturnType<typeof createBrowserTools>>()
    browsers.set(id, workspaces)
    const definitions = createBrowserTools(automation, {
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
          description: `Optional Sele ${pairedBrowserNames[id]} connection: ${definition.description} Only ${pairedBrowserNames[id]} tabs shared using the Sele extension are available. Tab IDs belong to this browser only; use this namespace for every action on them. Use this connection when the user chooses Sele's shared-tab extension. An existing official Chrome connection uses the provider's browser tools and does not require Sele pairing.`,
          inputSchema: z.toJSONSchema(definition.schema)
        },
        async (args, context) => {
          if (context.signal.aborted) throw new Error('Tool canceled.')
          const scope = getBrowserUseSession(context.threadId)
          if (!scope) throw new Error(`${pairedBrowserNames[id]} session is not owned by Sele.`)
          subscribe()
          let workspace = workspaces.get(context.threadId)
          if (!workspace) {
            workspace = createBrowserTools(automation, scope)
            workspaces.set(context.threadId, workspace)
          }
          const tool = workspace.tools.find((tool) => tool.name === definition.name)!
          return convert(await tool.execute(args))
        },
        id
      )
    definitions.close()
  }
  return {
    close: () => {
      for (const workspaces of browsers.values())
        for (const workspace of workspaces.values()) workspace.close()
      browsers.clear()
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
}
