import type { ProviderApi, ProviderChat } from '../../shared/provider'
import type { createChatTerminalActivity } from './chatTerminalActivity'

export const createChatTerminalPoller = (options: {
  getChats: () => ProviderChat[]
  readTasks: ProviderApi['getChatTerminalTasks']
  activity: ReturnType<typeof createChatTerminalActivity>
  onError: (error: unknown) => void
  timeoutMs?: number
}) => {
  let disposed = false
  let polling = false
  const discovered = new Set<string>()
  const running = new Set<string>()
  return {
    dispose: () => {
      disposed = true
    },
    poll: async () => {
      if (disposed || polling) return
      polling = true
      const requested = new Set(options.activity.takeProbes())
      const targets = options.getChats().filter((chat) => {
        const key = `${chat.providerId}:${chat.id}`
        return (
          !discovered.has(key) || running.has(key) || requested.has(key) || chat.status === 'active'
        )
      })
      try {
        for (let index = 0; index < targets.length && !disposed; index += 4) {
          await Promise.all(
            targets.slice(index, index + 4).map(async (chat) => {
              const key = `${chat.providerId}:${chat.id}`
              let timeout: ReturnType<typeof setTimeout> | undefined
              try {
                const ids = await Promise.race([
                  options.readTasks(chat.providerId, chat.id),
                  new Promise<string[]>((_, reject) => {
                    timeout = setTimeout(
                      () => reject(new Error('Timed out reading chat terminal activity.')),
                      options.timeoutMs ?? 5000
                    )
                  })
                ])
                if (disposed) return
                discovered.add(key)
                if (ids.length) running.add(key)
                else running.delete(key)
                options.activity.report(key, 'agent', ids)
              } catch (error) {
                if (disposed) return
                // Losing contact is unknown, not proof of continued execution or
                // successful completion. Clear the claim and retry even idle chats.
                discovered.delete(key)
                running.delete(key)
                options.activity.report(key, 'agent', [], false)
                options.onError(error)
              } finally {
                clearTimeout(timeout)
              }
            })
          )
        }
      } finally {
        polling = false
      }
    }
  }
}
