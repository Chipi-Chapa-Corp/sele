import type { ProviderChatDetail } from '../../shared/provider'
import { reconcileChatItemRenderKeys } from './chatItemIdentity.ts'

// IPC copies every object, including unchanged history. Recover identity before
// publishing a refresh so memoized history does not render as if it were edited.
// Strings compare directly; never serialize or parse tool payloads here.
const sameValue = (first: unknown, second: unknown, budget: { left: number }): boolean => {
  const pending: [unknown, unknown][] = [[first, second]]
  const visited = new WeakMap<object, object>()
  // Reserve a small allowance for each item. A large tool result can exhaust
  // the shared deep-comparison budget without invalidating every later message.
  let allowance = 64
  const remaining = (): number => allowance + budget.left
  while (pending.length) {
    if (allowance > 0) allowance--
    else if (budget.left > 0) budget.left--
    else return false
    const [a, b] = pending.pop()!
    if (Object.is(a, b)) continue
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    if (visited.get(a) === b) continue
    visited.set(a, b)
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.length > remaining()) return false
      for (let i = 0; i < a.length; i++) pending.push([a[i], b[i]])
    } else {
      const prototype = Object.getPrototypeOf(a)
      if (
        prototype !== Object.getPrototypeOf(b) ||
        (prototype !== Object.prototype && prototype !== null)
      )
        return false
      const keys = Object.keys(a)
      if (keys.length !== Object.keys(b).length || keys.length > remaining()) return false
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false
        pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]])
      }
    }
  }
  return true
}

export const reuseChatSnapshotItems = (
  current: ProviderChatDetail | null | undefined,
  snapshot: ProviderChatDetail
): ProviderChatDetail => {
  if (!current || current.id !== snapshot.id || current.items === snapshot.items) return snapshot
  const previous = new Map(current.items.map((item) => [item.id, item]))
  reconcileChatItemRenderKeys(current.items, snapshot.items, previous)
  // A pathological raw object must not move unbounded comparison work onto a switch.
  const budget = { left: 20_000 }
  let reused = false
  const items = snapshot.items.map((item) => {
    if (!item.id) return item
    const old = previous.get(item.id)
    if (old && sameValue(old, item, budget)) {
      reused = true
      return old
    }
    return item
  })
  if (!reused && snapshot.items.length > 0) return snapshot
  const unchanged =
    items.length === current.items.length && items.every((item, i) => item === current.items[i])
  return { ...snapshot, items: unchanged ? current.items : items }
}
