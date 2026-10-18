// Coalesce navigation bookkeeping without putting serialization or synchronous
// storage IPC in React's layout commit. Hidden windows still persist promptly.
const pendingWriters = new Set<() => void>()

export const flushAfterPaintWriters = (): void => {
  for (const flush of [...pendingWriters]) flush()
}

export function createAfterPaintWriter<T>(write: (value: T) => void) {
  let pending: { value: T } | null = null
  let frame: number | null = null
  let timer: number | null = null

  const flush = (): void => {
    if (!pending) return
    const { value } = pending
    pending = null
    pendingWriters.delete(flush)
    if (frame !== null) window.cancelAnimationFrame(frame)
    if (timer !== null) window.clearTimeout(timer)
    frame = timer = null
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('beforeunload', flush)
    document.removeEventListener('visibilitychange', handleVisibility)
    write(value)
  }
  const handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }

  return {
    schedule(value: T): void {
      const scheduled = pending !== null
      pending = { value }
      if (scheduled) return
      pendingWriters.add(flush)
      window.addEventListener('pagehide', flush)
      window.addEventListener('beforeunload', flush)
      document.addEventListener('visibilitychange', handleVisibility)
      // A timeout alone can run before paint; rAF alone can stall in a hidden tab.
      timer = window.setTimeout(flush, 100)
      frame = window.requestAnimationFrame(() => {
        frame = null
        if (timer !== null) window.clearTimeout(timer)
        timer = window.setTimeout(flush, 0)
      })
    },
    flush
  }
}
