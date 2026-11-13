import { z } from 'zod'
import { getBrowserAutomationService } from '../../browser/BrowserAutomation'
import { browserToolInstructions, createBrowserTools } from '../../browser/BrowserTools'
import type { CodexDynamicTools, CodexDynamicToolResult } from './CodexDynamicTools'
import { getBrowserUseSession, onBrowserUseSessionRemoved } from './CodexBrowserSessions'

type BrowserToolResult = Awaited<
  ReturnType<ReturnType<typeof createBrowserTools>['tools'][number]['execute']>
>

export const toCodexToolResult = (result: BrowserToolResult): CodexDynamicToolResult => ({
  success: !result.isError,
  contentItems: result.content.map((item) =>
    item.type === 'image'
      ? { type: 'inputImage', imageUrl: `data:${item.mimeType};base64,${item.data}` }
      : { type: 'inputText', text: item.text }
  )
})

export function registerCodexBrowserToolSet(
  registry: CodexDynamicTools,
  service: Parameters<typeof createBrowserTools>[0],
  namespace: string,
  sessionLabel: string,
  describe: (description: string) => string
): { close(): void } {
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
        description: describe(definition.description),
        inputSchema: z.toJSONSchema(definition.schema)
      },
      async (args, context) => {
        if (context.signal.aborted) throw new Error('Tool canceled.')
        const scope = getBrowserUseSession(context.threadId)
        if (!scope) throw new Error(`${sessionLabel} session is not owned by Sele.`)
        subscribe()
        let workspace = workspaces.get(context.threadId)
        if (!workspace) {
          workspace = createBrowserTools(service, scope)
          workspaces.set(context.threadId, workspace)
        }
        const tool = workspace.tools.find((tool) => tool.name === definition.name)!
        return toCodexToolResult(await tool.execute(args))
      },
      namespace
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

/** Advertise the embedded browser independently of Codex's optional Browser Use plugin. */
export function registerCodexBrowserTools(registry: CodexDynamicTools): { close(): void } | null {
  const service = getBrowserAutomationService()
  return service
    ? registerCodexBrowserToolSet(
        registry,
        service,
        'sele_browser',
        'Browser',
        (description) => `${description} ${browserToolInstructions}`
      )
    : null
}
