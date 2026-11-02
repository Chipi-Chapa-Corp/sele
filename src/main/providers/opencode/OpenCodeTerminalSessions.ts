import type { AppContainerTarget } from '../../../shared/app'
import { agentTerminalSessions, type AgentTerminalHandle } from '../../agentTerminalSessions.ts'

const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const createOpenCodeTerminalSessions = (
  options: {
    chatId: string
    chatTitle: string
    cwd: string | null
    container: AppContainerTarget | null
    abortTurn: () => Promise<unknown>
  },
  registry = agentTerminalSessions
) => {
  const prefix = `opencode:${crypto.randomUUID()}:`
  const commands = new Map<string, { handle: AgentTerminalHandle; output: string }>()
  return {
    consume: (type: string, properties: Record<string, unknown>) => {
      if (
        type === 'session.idle' ||
        type === 'session.error' ||
        type === 'session.deleted' ||
        (type === 'session.status' && record(properties.status)?.type === 'idle')
      ) {
        for (const entry of commands.values())
          void entry.handle.finish(type === 'session.error' ? 1 : 0)
        return
      }
      const part = record(properties.part)
      const state = record(part?.state)
      if (
        type !== 'message.part.updated' ||
        part?.type !== 'tool' ||
        !/^(bash|shell|terminal|exec|command)$/.test(String(part.tool)) ||
        !state
      )
        return
      const id = String(part.callID)
      let entry = commands.get(id)
      const input = record(state.input)
      if (!entry && state.status === 'running' && typeof input?.command === 'string') {
        const handle = registry.register(prefix + id, {
          providerId: 'opencode-v2',
          chatId: options.chatId,
          chatTitle: options.chatTitle,
          cwd: options.cwd,
          container: options.container,
          command: input.command,
          stopScope: 'turn',
          stop: options.abortTurn
        })
        entry = { handle, output: '' }
        commands.set(id, entry)
      }
      if (!entry) return
      const metadata = record(state.metadata)
      const output =
        typeof state.output === 'string'
          ? state.output
          : typeof metadata?.output === 'string'
            ? metadata.output
            : ''
      if (output.startsWith(entry.output)) {
        entry.handle.append(output.slice(entry.output.length).replace(/\r?\n/g, '\r\n'))
        entry.output = output
      }
      if (state.status === 'completed' || state.status === 'error')
        void entry.handle.finish(state.status === 'error' ? 1 : 0)
    },
    dispose: () => registry.finishMatching(prefix)
  }
}
