import { agentTerminalSessions, type AgentTerminalHandle } from '../../agentTerminalSessions.ts'
import type { AppContainerTarget } from '../../../shared/app'

const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const contentText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map((block) => text(record(block)?.text)).join('\n')
      : ''

export const createClaudeTerminalSessions = (
  options: {
    chatId: string
    chatTitle: string
    cwd: string | null
    container: AppContainerTarget | null
    stop: (taskId: string) => Promise<void>
    interrupt: () => Promise<unknown>
    readOutputFile: (file: string) => () => Promise<{ data: string }>
  },
  registry = agentTerminalSessions
) => {
  const prefix = `claude:${crypto.randomUUID()}:`
  const calls = new Map<
    string,
    { handle: AgentTerminalHandle; taskId?: string; outputFile?: string }
  >()
  const tasks = new Map<string, string>()
  const ensure = (toolId: string, command: string, taskId?: string, background = false) => {
    let call = calls.get(toolId)
    if (!call) {
      const handle = registry.register(prefix + toolId, {
        chatId: options.chatId,
        chatTitle: options.chatTitle,
        cwd: options.cwd,
        container: options.container,
        providerId: 'claude',
        command,
        background,
        stopScope: taskId ? 'process' : 'turn',
        stop: async () => {
          const id = calls.get(toolId)?.taskId
          if (id) await options.stop(id)
          else await options.interrupt()
        }
      })
      call = { handle, taskId }
      calls.set(toolId, call)
    }
    if (taskId) {
      call.taskId = taskId
      tasks.set(taskId, toolId)
      call.handle.setStopScope('process')
    }
    if (background) call.handle.background()
    return call
  }
  const setFile = (call: NonNullable<ReturnType<typeof calls.get>>, path: string) => {
    if (!path || call.outputFile === path) return
    call.outputFile = path
    call.handle.setReader(options.readOutputFile(path))
  }
  return {
    consume: (value: unknown) => {
      const event = record(value)
      if (!event) return
      if (event.type === 'assistant') {
        const content = record(event.message)?.content
        if (!Array.isArray(content)) return
        for (const value of content) {
          const block = record(value)
          if (!block) continue
          if (
            block?.type === 'tool_use' &&
            block.name === 'Bash' &&
            typeof record(block.input)?.command === 'string'
          )
            ensure(text(block.id), text(record(block.input)?.command)).handle.setCommand(
              text(record(block.input)?.command)
            )
        }
      } else if (event.type === 'user') {
        const content = record(event.message)?.content
        if (!Array.isArray(content)) return
        for (const value of content) {
          const block = record(value)
          if (!block) continue
          if (block?.type !== 'tool_result') continue
          const call = calls.get(text(block.tool_use_id))
          if (!call) continue
          const result = record(event.tool_use_result)
          const output = contentText(block.content)
          const taskId =
            text(result?.backgroundTaskId) ||
            (!result
              ? output.match(/^Command running in background with ID:\s*([\w-]+)/)?.[1]
              : undefined)
          if (taskId) {
            call.taskId = taskId
            call.handle.setStopScope('process')
            tasks.set(taskId, text(block.tool_use_id))
            call.handle.background()
            const file = output.match(/Output is being written to:\s*([^\r\n]+)/i)?.[1]?.trim()
            // Only recognize the CLI's task-log path in a textual tool result. Ordinary
            // program output must not turn this viewer into an arbitrary file reader.
            const parts = file?.replace(/\\/g, '/').split('/')
            if (file && parts?.at(-2) === 'tasks' && parts.at(-1) === `${taskId}.output`)
              setFile(call, file)
          } else {
            const stdout =
              result && (typeof result.stdout === 'string' || typeof result.stderr === 'string')
                ? text(result.stdout) + text(result.stderr)
                : output
            call.handle.append(stdout.replace(/\r?\n/g, '\r\n'))
            void call.handle.finish(block.is_error === true || result?.interrupted ? 1 : 0)
          }
        }
      } else if (
        event.type === 'system' &&
        event.subtype === 'task_started' &&
        event.task_type === 'local_bash'
      ) {
        ensure(
          text(event.tool_use_id) || text(event.task_id),
          text(event.description),
          text(event.task_id),
          event.is_backgrounded === true
        )
      } else if (
        event.type === 'system' &&
        event.subtype === 'background_tasks_changed' &&
        Array.isArray(event.tasks)
      ) {
        for (const value of event.tasks) {
          const task = record(value)
          if (!task) continue
          if (task.task_type !== 'local_bash' || task.ambient) continue
          const toolId = tasks.get(text(task.task_id))
          if (toolId) calls.get(toolId)?.handle.background()
        }
      } else if (event.type === 'system' && event.subtype === 'task_notification') {
        const toolId = tasks.get(text(event.task_id)) ?? text(event.tool_use_id)
        const call = calls.get(toolId)
        if (!call) return
        if (event.output_file) setFile(call, text(event.output_file))
        void call.handle.finish(
          event.status === 'completed' ? 0 : event.status === 'stopped' ? 130 : 1
        )
      }
    },
    dispose: () => registry.finishMatching(prefix)
  }
}
