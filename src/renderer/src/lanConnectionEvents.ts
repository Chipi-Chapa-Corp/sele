const listeners = new Set<() => void>()
export const onLanReconnected = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const publishLanReconnected = (): void => {
  listeners.forEach((listener) => listener())
}
