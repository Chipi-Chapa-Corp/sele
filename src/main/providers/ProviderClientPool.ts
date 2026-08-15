export class ProviderClientPool<T> {
  private entries = new Map<string, T>()
  private entryPromises = new Map<string, Promise<T>>()
  private disposed = false
  private readonly closeEntry: (entry: T) => void

  constructor(closeEntry: (entry: T) => void) {
    this.closeEntry = closeEntry
  }

  get = (key: string, create: () => Promise<T>): Promise<T> => {
    if (this.disposed) return Promise.reject(new Error('Provider client pool is closed'))

    const existing = this.entries.get(key)
    if (existing) return Promise.resolve(existing)

    const pending = this.entryPromises.get(key)
    if (pending) return pending

    const promise = create()
      .then((entry) => {
        if (this.disposed) {
          this.closeEntry(entry)
          throw new Error('Provider client pool is closed')
        }
        this.entries.set(key, entry)
        return entry
      })
      .finally(() => this.entryPromises.delete(key))
    this.entryPromises.set(key, promise)
    return promise
  }

  invalidate = (key: string, entry: T): void => {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.closeEntry(entry)
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.entries.forEach(this.closeEntry)
    this.entries.clear()
    this.entryPromises.clear()
  }
}
