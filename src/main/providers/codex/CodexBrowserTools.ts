import { z } from 'zod'
import { getBrowserAutomationService } from '../../browser/BrowserAutomation'
import { browserToolInstructions, createBrowserTools } from '../../browser/BrowserTools'
import type { CodexDynamicTools, CodexDynamicToolResult } from './CodexDynamicTools'
import { getBrowserUseSession, onBrowserUseSessionRemoved } from './CodexBrowserSessions'

/** Advertise the embedded browser independently of Codex's optional Browser Use plugin. */
export function registerCodexBrowserTools(registry: CodexDynamicTools): { close(): void } | null {
  const service = getBrowserAutomationService()
  if (!service) return null
  const workspaces = new Map<string, ReturnType<typeof createBrowserTools>>()
  const revoke = (sessionId: string): void => {
    workspaces.get(sessionId)?.close()
    workspaces.delete(sessionId)
  }
  let unsubscribe: (() => void) | undefined
  const subscribe = (): void => {
    unsubscribe ??= onBrowserUseSessionRemoved(revoke)
  }
  subscribe()
  const definitions = createBrowserTools(service, {
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
        description: `${definition.description} ${browserToolInstructions}`,
        inputSchema: z.toJSONSchema(definition.schema)
      },
      async (args, context): Promise<CodexDynamicToolResult> => {
        if (context.signal.aborted) throw new Error('Tool canceled.')
        const scope = getBrowserUseSession(context.threadId)
        if (!scope) throw new Error('Browser session is not owned by Sele.')
        subscribe()
        let workspace = workspaces.get(context.threadId)
        if (!workspace) {
          workspace = createBrowserTools(service, scope)
          workspaces.set(context.threadId, workspace)
        }
        const tool = workspace.tools.find((tool) => tool.name === definition.name)!
        const result = await tool.execute(args)
        return {
          success: !result.isError,
          contentItems: result.content.map((item) =>
            item.type === 'image'
              ? { type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` }
              : { type: 'inputText', text: item.text }
          )
        }
      },
      'browser'
    )
  definitions.close()
  return {
    close: () => {
      for (const workspace of workspaces.values()) workspace.close()
      workspaces.clear()
      unsubscribe?.()
      unsubscribe = undefined
    }
  }
}
