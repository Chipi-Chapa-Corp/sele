/** Global consumers see all changes; row consumers see only their own key. */
export const createKeyedSubscriptions = <Key>() => {
  const all = new Set<() => void>()
  const keyed = new Map<Key, Set<() => void>>()
  return {
    subscribe(listener: () => void): () => void {
      all.add(listener)
      return () => {
        all.delete(listener)
      }
    },
    subscribeKey(key: Key, listener: () => void): () => void {
      let listeners = keyed.get(key)
      if (!listeners) keyed.set(key, (listeners = new Set()))
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (!listeners.size && keyed.get(key) === listeners) keyed.delete(key)
      }
    },
    notify(key: Key): void {
      // Snapshot membership: reentrant subscriptions belong to the next update.
      for (const listener of new Set([...all, ...(keyed.get(key) ?? [])])) listener()
    }
  }
}
