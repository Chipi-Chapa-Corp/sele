import type { SessionStatus } from '@opencode-ai/sdk/v2'
import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers'

/** OpenCode shell tools belong to a foreground execution, not a durable background-task list. */
export const createOpenCodeTerminalTasks = (now = Date.now) => {
  const startedAt = now()
  const boundaries = new Map<string, { revision: number; endedAt: number }>()
  let disposed = false
  const invalidate = (sessionId: string) => {
    boundaries.set(sessionId, {
      revision: (boundaries.get(sessionId)?.revision ?? 0) + 1,
      endedAt: now()
    })
  }
  return {
    invalidate,
    advance: (sessionId: string) => {
      const previous = boundaries.get(sessionId)
      boundaries.set(sessionId, {
        revision: (previous?.revision ?? 0) + 1,
        endedAt: previous?.endedAt ?? startedAt
      })
    },
    dispose: () => {
      disposed = true
      boundaries.clear()
    },
    read: async (
      sessionId: string,
      readStatus: () => Promise<SessionStatus | undefined>,
      readMessages: () => Promise<OpenCodeMessageWithParts[]>
    ): Promise<string[]> => {
      const revision = boundaries.get(sessionId)?.revision ?? 0
      const current = () => {
        if (disposed) throw new Error('OpenCode terminal activity is unavailable.')
        return revision === (boundaries.get(sessionId)?.revision ?? 0)
      }
      current()
      const status = await readStatus()
      if (!current()) return []
      if (status?.type !== 'busy') {
        invalidate(sessionId)
        return []
      }
      const messages = await readMessages()
      if (!current()) return []
      // A new assistant step supersedes an abandoned tool record, even if the old
      // record was never finalized. Never pin old messages and poll them forever.
      const message = [...messages].reverse().find((message) => message.info.role === 'assistant')
      if (
        !message ||
        message.info.role !== 'assistant' ||
        message.info.summary ||
        message.info.error ||
        message.info.time.completed !== undefined
      )
        return []
      const notBefore = Math.max(startedAt, boundaries.get(sessionId)?.endedAt ?? startedAt)
      return message.parts.flatMap((part) => {
        if (part.type !== 'tool' || !/^(?:bash|shell|terminal|exec|command)$/.test(part.tool))
          return []
        if (part.state.status !== 'running' && part.state.status !== 'pending') return []
        const started =
          part.state.status === 'running' ? part.state.time.start : message.info.time.created
        return started >= notBefore ? [part.callID] : []
      })
    }
  }
}
