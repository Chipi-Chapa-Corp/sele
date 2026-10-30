import { createKeyedSubscriptions } from './keyedSubscriptions.ts'

export type ChatTerminalSnapshot = { running: boolean; unread: boolean }
const empty: ChatTerminalSnapshot = { running: false, unread: false }

/** Both panel PTYs and provider terminals publish into this provider-neutral store. */
export const createChatTerminalActivity = () => {
  const sources = new Map<string, Map<string, Set<string>>>()
  const snapshots = new Map<string, ChatTerminalSnapshot>()
  const idle = new Map<string, boolean>()
  const subscriptions = createKeyedSubscriptions<string>()
  const probes = new Set<string>()
  let saveUnread: ((keys: string[]) => void) | undefined
  const update = (key: string, unread: boolean) => {
    const running = [...(sources.get(key)?.values() ?? [])].some((ids) => ids.size > 0)
    const previous = snapshots.get(key) ?? empty
    if (running === previous.running && unread === previous.unread) return
    if (!running && !unread) snapshots.delete(key)
    else snapshots.set(key, { running, unread })
    if (unread !== previous.unread)
      saveUnread?.([...snapshots].filter(([, value]) => value.unread).map(([key]) => key))
    subscriptions.notify(key)
  }
  return {
    getSnapshot: (key: string): ChatTerminalSnapshot => snapshots.get(key) ?? empty,
    subscribe: subscriptions.subscribe,
    subscribeKey: subscriptions.subscribeKey,
    setIdle: (key: string, value: boolean) => {
      idle.set(key, value)
    },
    report: (key: string, source: string, taskIds: readonly string[], notifyCompletion = true) => {
      let bySource = sources.get(key)
      if (!bySource) sources.set(key, (bySource = new Map()))
      const previous = bySource.get(source)
      const next = new Set(taskIds)
      const finished = previous && [...previous].some((id) => !next.has(id))
      if (next.size) bySource.set(source, next)
      else bySource.delete(source)
      if (!bySource.size) sources.delete(key)
      update(
        key,
        (snapshots.get(key)?.unread ?? false) ||
          Boolean(notifyCompletion && finished && idle.get(key))
      )
    },
    markSeen: (key: string) => update(key, false),
    requestProbe: (key: string) => {
      probes.add(key)
    },
    takeProbes: () => {
      const keys = [...probes]
      probes.clear()
      return keys
    },
    initialize: (keys: string[], save: (keys: string[]) => void) => {
      keys.forEach((key) => update(key, true))
      saveUnread = save
    }
  }
}

export const chatTerminalActivity = createChatTerminalActivity()
