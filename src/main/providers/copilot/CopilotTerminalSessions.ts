import type { CopilotSession } from '@github/copilot-sdk'
import type { AppContainerTarget } from '../../../shared/app'
import { agentTerminalSessions, type AgentTerminalHandle } from '../../agentTerminalSessions.ts'

type Tasks = Awaited<ReturnType<CopilotSession['rpc']['tasks']['list']>>['tasks']
export const createCopilotTerminalSessions = (
  options: {
    session: CopilotSession
    chatId: string
    chatTitle: string
    cwd: string | null
    container: AppContainerTarget | null
  },
  registry = agentTerminalSessions
) => {
  const prefix = `copilot:${crypto.randomUUID()}:`
  const tracked = new Map<
    string,
    { handle: AgentTerminalHandle; attachmentMode: 'attached' | 'detached' }
  >()
  return {
    sync: (tasks: Tasks) => {
      for (const task of tasks) {
        if (task.type !== 'shell') continue
        const running = task.status === 'running' || task.status === 'idle'
        const previousTask = tracked.get(task.id)
        let handle = previousTask?.handle
        if (previousTask) previousTask.attachmentMode = task.attachmentMode
        if (!handle && running) {
          let cursor: string | undefined
          let previous = ''
          handle = registry.register(prefix + task.id, {
            providerId: 'copilot',
            chatId: options.chatId,
            chatTitle: options.chatTitle,
            cwd: options.cwd,
            container: options.container,
            command: task.command,
            background: task.executionMode === 'background',
            stop: async () => {
              const result = await options.session.rpc.tasks.cancel({ id: task.id })
              if (!result.cancelled) throw new Error('Copilot could not cancel this shell task.')
            },
            read: async () => {
              if ((tracked.get(task.id)?.attachmentMode ?? task.attachmentMode) === 'detached') {
                const result = await options.session.rpc.tasks.readOutput({
                  id: task.id,
                  cursor,
                  waitMs: 0
                })
                cursor = result.cursor
                return {
                  data: result.text.replace(/\r?\n/g, '\r\n'),
                  ...(result.exit
                    ? {
                        exitCode:
                          result.exit.exitCode ?? (result.exit.status === 'completed' ? 0 : 1)
                      }
                    : {})
                }
              }
              const result = await options.session.rpc.tasks.getProgress({ id: task.id })
              const output = result.progress?.type === 'shell' ? result.progress.recentOutput : ''
              const data = output.startsWith(previous) ? output.slice(previous.length) : output
              previous = output
              return { data: data.replace(/\r?\n/g, '\r\n') }
            }
          })
          tracked.set(task.id, { handle, attachmentMode: task.attachmentMode })
        }
        if (task.executionMode === 'background') handle?.background()
        if (handle && !running) void handle.finish(task.status === 'completed' ? 0 : 1)
      }
      const live = new Set(tasks.filter((task) => task.type === 'shell').map((task) => task.id))
      for (const [id, entry] of tracked) if (!live.has(id)) void entry.handle.finish()
    },
    dispose: () => registry.finishMatching(prefix)
  }
}
