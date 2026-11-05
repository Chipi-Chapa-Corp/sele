import { randomUUID } from 'node:crypto'
import type { AgentTerminalSession } from '../shared/terminal.ts'

type Options = Omit<
  AgentTerminalSession,
  'id' | 'index' | 'status' | 'interactive' | 'stopScope'
> & {
  stopScope?: 'process' | 'turn'
  background?: boolean
  stop: () => Promise<unknown>
  write?: (data: string) => Promise<unknown> | void
  read?: () => Promise<{ data: string; exitCode?: number }>
  resize?: (cols: number, rows: number) => void
}
type Listener = { data: (data: string) => void; exit: (code: number) => void }
const maximumOutput = 512 * 1024
export const longTerminalCommandMs = 2000

/** Observes the provider's original process. Attaching never launches another command. */
export const createAgentTerminalSessions = (now = Date.now) => {
  const entries = new Map<
    string,
    {
      key: string
      info: AgentTerminalSession
      options: Options
      startedAt: number
      endedAt?: number
      background: boolean
      output: string
      exitCode?: number
      dismissed: boolean
      listeners: Set<Listener>
      readPromise?: Promise<boolean>
      finishing: boolean
      reportedExitCode?: number
      retryAt?: number
      readFailed?: boolean
    }
  >()
  const keys = new Map<string, string>()
  // Release provider callbacks after completion without discarding the text of retained tabs.
  const completedOutput = new Map<string, { output: string; exitCode: number }>()
  const indexes = new Map<string, number>()
  const append = (id: string, data: string) => {
    const entry = entries.get(id)
    if (!entry || !data) return
    entry.output = (entry.output + data).slice(-maximumOutput)
    for (const listener of entry.listeners) listener.data(data)
  }
  const poll = (id: string): Promise<boolean> => {
    const entry = entries.get(id)
    if (entry?.readPromise) return entry.readPromise
    if (!entry?.options.read || entry.info.status !== 'running' || (entry.retryAt ?? 0) > now())
      return Promise.resolve(false)
    const read = entry.options.read
    const pending = (async () => {
      try {
        const result = await read()
        if (entries.get(id) !== entry) return false
        entry.retryAt = undefined
        entry.readFailed = false
        append(id, result.data)
        if (result.exitCode !== undefined) {
          entry.reportedExitCode = result.exitCode
          if (!entry.finishing) void finish(id, result.exitCode, false)
        }
        return result.data.length > 0
      } catch (error) {
        // Losing the output source does not mean the underlying process finished.
        if (!entry.readFailed) console.error('Unable to read agent terminal output.', error)
        entry.readFailed = true
        entry.retryAt = now() + 5000
        return false
      }
    })()
    entry.readPromise = pending
    void pending.finally(() => {
      if (entry.readPromise === pending) entry.readPromise = undefined
    })
    return pending
  }
  const finish = async (id: string, code = 0, readFinal = true) => {
    const entry = entries.get(id)
    if (!entry || entry.info.status === 'exited' || entry.finishing) return
    entry.finishing = true
    if (readFinal) {
      for (let batch = 0; batch < 8; batch++) {
        if (!(await poll(id))) break
      }
    }
    entry.info = { ...entry.info, status: 'exited' }
    entry.exitCode = entry.reportedExitCode ?? code
    entry.endedAt = now()
    for (const listener of entry.listeners) listener.exit(entry.exitCode)
  }
  return {
    register: (key: string, options: Options) => {
      let id = keys.get(key)
      const existing = id ? entries.get(id) : undefined
      if (existing) {
        existing.options = options
        existing.background ||= options.background === true
      } else {
        id = randomUUID()
        entries.set(id, {
          key,
          options,
          info: {
            id,
            index: 0,
            status: 'running',
            interactive: !!options.write,
            stopScope: options.stopScope ?? 'process',
            providerId: options.providerId,
            chatId: options.chatId,
            chatTitle: options.chatTitle,
            cwd: options.cwd,
            container: options.container,
            command: options.command,
            workspaceKey: options.workspaceKey,
            workspaceLabel: options.workspaceLabel,
            closeOnCommandFinish: options.closeOnCommandFinish
          },
          startedAt: now(),
          background: !!options.background,
          output: '',
          dismissed: false,
          listeners: new Set(),
          finishing: false
        })
        keys.set(key, id)
      }
      const sessionId = id!
      return {
        id: sessionId,
        append: (data: string) => append(sessionId, data),
        finish: (code = 0) => finish(sessionId, code),
        background: () => {
          const entry = entries.get(sessionId)
          if (entry) entry.background = true
        },
        setCommand: (command: string) => {
          const entry = entries.get(sessionId)
          if (entry) entry.info = { ...entry.info, command }
        },
        setStopScope: (stopScope: AgentTerminalSession['stopScope']) => {
          const entry = entries.get(sessionId)
          if (entry) entry.info = { ...entry.info, stopScope }
        },
        setReader: (read: Options['read']) => {
          const entry = entries.get(sessionId)
          if (entry) entry.options = { ...entry.options, read }
        }
      }
    },
    list: (): AgentTerminalSession[] => {
      const result: AgentTerminalSession[] = []
      for (const [id, entry] of entries) {
        if (entry.endedAt != null && !entry.listeners.size && now() - entry.endedAt > 120_000) {
          if (entry.info.index && !entry.dismissed) {
            completedOutput.set(id, { output: entry.output, exitCode: entry.exitCode ?? 0 })
            if (completedOutput.size > 64)
              completedOutput.delete(completedOutput.keys().next().value!)
          }
          entries.delete(id)
          keys.delete(entry.key)
          continue
        }
        const elapsed = (entry.endedAt ?? now()) - entry.startedAt
        if (!entry.dismissed && (entry.background || elapsed >= longTerminalCommandMs)) {
          if (!entry.info.index) {
            const chatKey = `${entry.info.providerId}:${entry.info.chatId}`
            const index = (indexes.get(chatKey) ?? 0) + 1
            indexes.set(chatKey, index)
            entry.info = { ...entry.info, index }
          }
          result.push(entry.info)
        }
      }
      return result
    },
    completed: (id: string) => completedOutput.get(id),
    available: (id: string) => entries.has(id),
    attach: (id: string, listener: Listener) => {
      const entry = entries.get(id)
      if (!entry) throw new Error('This agent process is no longer available.')
      entry.listeners.add(listener)
      if (entry.output) listener.data(entry.output)
      if (entry.info.status === 'exited') listener.exit(entry.exitCode ?? 0)
      const timer = setInterval(() => void poll(id), 500)
      void poll(id)
      return () => {
        if (timer) clearInterval(timer)
        entry.listeners.delete(listener)
      }
    },
    stop: async (id: string) => {
      const entry = entries.get(id)
      if (!entry || entry.info.status === 'exited') return
      await entry.options.stop()
      await finish(id, 130)
    },
    write: async (id: string, data: string) => {
      const entry = entries.get(id)
      if (!entry || entry.info.status === 'exited') return
      if (data === '\x03' && !entry.info.workspaceKey) {
        await entry.options.stop()
        await finish(id, 130)
      } else if (entry.options.write) await entry.options.write(data)
    },
    status: (id: string) => entries.get(id)?.info.status ?? 'exited',
    resize: (id: string, cols: number, rows: number) =>
      entries.get(id)?.options.resize?.(cols, rows),
    dismiss: (id: string) => {
      completedOutput.delete(id)
      const entry = entries.get(id)
      if (entry) entry.dismissed = true
    },
    finishMatching: (prefix: string) => {
      for (const [id, entry] of entries)
        if (entry.key.startsWith(prefix)) void finish(id, 130, false)
    }
  }
}

export const agentTerminalSessions = createAgentTerminalSessions()
export type AgentTerminalHandle = ReturnType<typeof agentTerminalSessions.register>
