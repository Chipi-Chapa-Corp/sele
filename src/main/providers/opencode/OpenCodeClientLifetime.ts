/** Discovery/metadata requests share a server briefly, without owning it for the app lifetime. */
export class OpenCodeClientLifetime {
  private readers = 0
  private retained = false
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly isBusy: () => boolean
  private readonly close: () => Promise<void>
  private readonly idleMs: number

  constructor(isBusy: () => boolean, close: () => Promise<void>, idleMs = 5_000) {
    this.isBusy = isBusy
    this.close = close
    this.idleMs = idleMs
  }

  /** Chat and interactive account operations keep the existing long-lived runtime. */
  retain = (): void => {
    this.retained = true
    this.clearTimer()
  }

  use = async <T>(read: () => Promise<T>): Promise<T> => {
    this.clearTimer()
    this.readers += 1
    try {
      return await read()
    } finally {
      this.readers -= 1
      this.schedule()
    }
  }

  dispose = (): void => {
    this.disposed = true
    this.clearTimer()
  }

  private clearTimer = (): void => {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule = (): void => {
    if (this.disposed || this.retained || this.readers || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      // History discovery can encounter a running turn; do not stop its server.
      if (this.isBusy()) {
        this.schedule()
        return
      }
      this.disposed = true
      void this.close().catch((error: unknown) => {
        console.error('Unable to close idle OpenCode discovery server.', error)
      })
    }, this.idleMs)
    this.timer.unref()
  }
}
