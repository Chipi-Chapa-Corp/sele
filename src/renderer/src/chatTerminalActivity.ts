import { createKeyedSubscriptions } from './keyedSubscriptions.ts'

export type ChatTerminalSnapshot = { running: boolean }
const empty: ChatTerminalSnapshot = { running: false }

/** Both panel PTYs and provider terminals publish into this provider-neutral store. */
export const createChatTerminalActivity = () => {
  const sources = new Map<string, Map<string, Set<string>>>()
  const snapshots = new Map<string, ChatTerminalSnapshot>()
  const subscriptions = createKeyedSubscriptions<string>()
  const probes = new Set<string>()
  const update = (key: string) => {
    const running = [...(sources.get(key)?.values() ?? [])].some((ids) => ids.size > 0)
    const previous = snapshots.get(key) ?? empty
    if (running === previous.running) return
    if (!running) snapshots.delete(key)
    else snapshots.set(key, { running })
    subscriptions.notify(key)
  }
  return {
    getSnapshot: (key: string): ChatTerminalSnapshot => snapshots.get(key) ?? empty,
    subscribe: subscriptions.subscribe,
    subscribeKey: subscriptions.subscribeKey,
    report: (key: string, source: string, taskIds: readonly string[]) => {
      let bySource = sources.get(key)
      if (!bySource) sources.set(key, (bySource = new Map()))
      const next = new Set(taskIds)
      if (next.size) bySource.set(source, next)
      else bySource.delete(source)
      if (!bySource.size) sources.delete(key)
      update(key)
    },
    requestProbe: (key: string) => {
      probes.add(key)
    },
    takeProbes: () => {
      const keys = [...probes]
      probes.clear()
      return keys
    }
  }
}

export const chatTerminalActivity = createChatTerminalActivity()
