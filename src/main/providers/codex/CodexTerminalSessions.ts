import { agentTerminalSessions, type AgentTerminalHandle } from '../../agentTerminalSessions.ts'
import type { AppContainerTarget } from '../../../shared/app'

type Command = { handle: AgentTerminalHandle; output: string; processId?: string; turnId?: string }
export const createCodexTerminalSessions = (
  options: {
    container: AppContainerTarget | null
    metadata: (chatId: string) => { title: string; cwd: string | null }
    stop: (chatId: string, processId: string) => Promise<unknown>
    interrupt: (chatId: string, turnId: string) => Promise<unknown>
  },
  registry = agentTerminalSessions
) => {
  let prefix = `codex:${crypto.randomUUID()}:`
  const commands = new Map<string, Command>()
  const ensure = (chatId: string, itemId: string, command: string, cwd: string | null) => {
    const key = `${chatId}:${itemId}`
    let entry = commands.get(key)
    if (!entry) {
      const metadata = options.metadata(chatId)
      const handle = registry.register(prefix + key, {
        providerId: 'codex',
        chatId,
        chatTitle: metadata.title,
        command,
        cwd: cwd ?? metadata.cwd,
        container: options.container,
        stopScope: 'turn',
        stop: async () => {
          const processId = commands.get(key)?.processId
          if (processId) await options.stop(chatId, processId)
          else {
            const turnId = commands.get(key)?.turnId
            if (!turnId) throw new Error('The owning Codex turn is no longer available.')
            await options.interrupt(chatId, turnId)
          }
        }
      })
      entry = { handle, output: '' }
      commands.set(key, entry)
    }
    return entry
  }
  return {
    consume: (notification: { method: string; params?: unknown }) => {
      const params = notification.params as {
        threadId?: string
        turnId?: string
        turn?: { id?: string; status?: string }
        itemId?: string
        item?: {
          id: string
          type: string
          command?: string
          cwd?: string
          processId?: string | null
          aggregatedOutput?: string
          exitCode?: number | null
          status?: string
        }
        delta?: string
      }
      if (!params?.threadId) return
      if (
        (notification.method === 'item/started' || notification.method === 'item/completed') &&
        params.item?.type === 'commandExecution'
      ) {
        const item = params.item
        const entry = ensure(params.threadId, item.id, item.command ?? '', item.cwd ?? null)
        entry.turnId = params.turnId ?? entry.turnId
        entry.processId = item.processId ?? entry.processId
        if (entry.processId) entry.handle.setStopScope('process')
        if (item.aggregatedOutput?.startsWith(entry.output)) {
          entry.handle.append(item.aggregatedOutput.slice(entry.output.length))
          entry.output = item.aggregatedOutput
        }
        if (notification.method === 'item/completed') {
          if (entry.processId && item.exitCode == null) entry.handle.background()
          else
            void entry.handle.finish(
              item.exitCode ??
                (item.status === 'interrupted' ? 130 : item.status === 'failed' ? 1 : 0)
            )
        }
      } else if (
        notification.method === 'item/commandExecution/outputDelta' &&
        params.itemId &&
        typeof params.delta === 'string'
      ) {
        const entry = commands.get(`${params.threadId}:${params.itemId}`)
        if (entry) {
          entry.handle.append(params.delta)
          entry.output += params.delta
        }
      } else if (notification.method === 'turn/completed') {
        const turnId = params.turn?.id ?? params.turnId
        for (const [key, entry] of commands) {
          if (key.startsWith(`${params.threadId}:`) && entry.turnId === turnId && !entry.processId)
            void entry.handle.finish(params.turn?.status === 'completed' ? 0 : 130)
        }
      }
    },
    background: (
      chatId: string,
      tasks: { processId: string; itemId: string; command: string; cwd: string }[]
    ) => {
      const live = new Set(tasks.map((task) => task.processId))
      for (const task of tasks) {
        const entry = ensure(chatId, task.itemId, task.command, task.cwd)
        entry.processId = task.processId
        entry.handle.setStopScope('process')
        entry.handle.background()
      }
      for (const [key, entry] of commands)
        if (key.startsWith(`${chatId}:`) && entry.processId && !live.has(entry.processId))
          void entry.handle.finish()
    },
    dispose: () => {
      registry.finishMatching(prefix)
      commands.clear()
      prefix = `codex:${crypto.randomUUID()}:`
    }
  }
}
