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
  // Polling one chat must not scan every command ever executed by this client.
  const commands = new Map<string, Map<string, Command>>()
  const completed = new Set<string>()
  const commandKey = (chatId: string, itemId: string): string => JSON.stringify([chatId, itemId])
  const finish = (chatId: string, itemId: string, entry: Command, code = 0): void => {
    void entry.handle.finish(code).then(() => {
      const chat = commands.get(chatId)
      if (chat?.get(itemId) !== entry) return
      chat.delete(itemId)
      if (!chat.size) commands.delete(chatId)
      completed.add(commandKey(chatId, itemId))
      if (completed.size > 1024) completed.delete(completed.values().next().value!)
      // The registry retains bounded terminal output for existing tabs. The
      // adapter only needs its duplicate-output buffer while a command is live.
      entry.output = ''
    })
  }
  const ensure = (chatId: string, itemId: string, command: string, cwd: string | null) => {
    const key = commandKey(chatId, itemId)
    let chat = commands.get(chatId)
    let entry = chat?.get(itemId)
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
          const processId = commands.get(chatId)?.get(itemId)?.processId
          if (processId) await options.stop(chatId, processId)
          else {
            const turnId = commands.get(chatId)?.get(itemId)?.turnId
            if (!turnId) throw new Error('The owning Codex turn is no longer available.')
            await options.interrupt(chatId, turnId)
          }
        }
      })
      entry = { handle, output: '' }
      if (!chat) commands.set(chatId, (chat = new Map()))
      chat.set(itemId, entry)
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
        // Recovering a stream may replay completion. Retain only a bounded ID
        // marker, rather than the entire output, to avoid duplicating its text.
        if (completed.has(commandKey(params.threadId, item.id))) return
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
            finish(
              params.threadId,
              item.id,
              entry,
              item.exitCode ??
                (item.status === 'interrupted' ? 130 : item.status === 'failed' ? 1 : 0)
            )
        }
      } else if (
        notification.method === 'item/commandExecution/outputDelta' &&
        params.itemId &&
        typeof params.delta === 'string'
      ) {
        const entry = commands.get(params.threadId)?.get(params.itemId)
        if (entry) {
          entry.handle.append(params.delta)
          entry.output += params.delta
        }
      } else if (notification.method === 'turn/completed') {
        const turnId = params.turn?.id ?? params.turnId
        for (const [itemId, entry] of commands.get(params.threadId) ?? []) {
          if (entry.turnId === turnId && !entry.processId)
            finish(params.threadId, itemId, entry, params.turn?.status === 'completed' ? 0 : 130)
        }
      }
    },
    background: (
      chatId: string,
      tasks: { processId: string; itemId: string; command: string; cwd: string }[]
    ) => {
      const live = new Set(tasks.map((task) => task.processId))
      for (const task of tasks) {
        if (completed.has(commandKey(chatId, task.itemId))) continue
        const entry = ensure(chatId, task.itemId, task.command, task.cwd)
        entry.processId = task.processId
        entry.handle.setStopScope('process')
        entry.handle.background()
      }
      for (const [itemId, entry] of commands.get(chatId) ?? [])
        if (entry.processId && !live.has(entry.processId)) finish(chatId, itemId, entry)
    },
    dispose: () => {
      registry.finishMatching(prefix)
      commands.clear()
      completed.clear()
      prefix = `codex:${crypto.randomUUID()}:`
    }
  }
}
