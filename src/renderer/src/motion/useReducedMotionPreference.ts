import { useSyncExternalStore } from 'react'

// Share one media listener across surfaces, and respond while the app is open.
// Motion's own hook currently snapshots the preference only at mount.
let media: MediaQueryList | undefined
const listeners = new Set<() => void>()
const getMedia = (): MediaQueryList =>
  (media ??= window.matchMedia('(prefers-reduced-motion: reduce)'))
const notify = (): void => {
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void): (() => void) => {
  if (listeners.size === 0) getMedia().addEventListener('change', notify)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) getMedia().removeEventListener('change', notify)
  }
}
const getSnapshot = (): boolean => getMedia().matches
export const useReducedMotionPreference = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => true)
