export class ProviderClientPool<T> {
  private entries = new Map<string, T>()
  private entryPromises = new Map<string, Promise<T>>()
  private generations = new Map<string, number>()
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

    const generation = this.generations.get(key) ?? 0
    const promise = create()
      .then((entry) => {
        if (this.disposed || (this.generations.get(key) ?? 0) !== generation) {
          this.closeEntry(entry)
          throw new Error(
            this.disposed ? 'Provider client pool is closed' : 'Provider client was invalidated'
          )
        }
        this.entries.set(key, entry)
        return entry
      })
      .finally(() => {
        if (this.entryPromises.get(key) === promise) this.entryPromises.delete(key)
      })
    this.entryPromises.set(key, promise)
    return promise
  }

  invalidate = (key: string, entry: T): void => {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.closeEntry(entry)
  }

  invalidateKey = (key: string): void => {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    const entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key)
      this.closeEntry(entry)
    }
    // A pending creation observes the generation change and closes its result. Removing it here
    // lets the next caller create a fresh client without waiting for the stale one to settle.
    this.entryPromises.delete(key)
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.entries.forEach(this.closeEntry)
    this.entries.clear()
    this.entryPromises.clear()
    this.generations.clear()
  }
}
