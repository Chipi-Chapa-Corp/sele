import { useSyncExternalStore } from 'react'

export const compactLayoutQuery = '(max-width: 50rem), (pointer: coarse) and (max-width: 65rem)'

// Hundreds of rows consume the same breakpoint. One browser listener owns it;
// React subscriptions read the current value without per-row effect updates.
let query: MediaQueryList | undefined
const listeners = new Set<() => void>()
const getQuery = (): MediaQueryList => (query ??= window.matchMedia(compactLayoutQuery))
const notify = (): void => {
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void): (() => void) => {
  if (listeners.size === 0) getQuery().addEventListener('change', notify)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) getQuery().removeEventListener('change', notify)
  }
}
const getSnapshot = (): boolean => getQuery().matches
export const useCompactLayout = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false)
