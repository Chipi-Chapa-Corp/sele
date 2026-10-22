/** Bounded, connection-scoped reads. Invalidated in-flight reads cannot repopulate the cache. */
export class DatabaseReadCache<Value> {
  private scope: object | null = null
  private entries = new Map<string, Promise<Value>>()

  private readonly limit: number

  constructor(limit = 256) {
    this.limit = limit
  }

  read(scope: object, key: string, load: () => Promise<Value>): Promise<Value> {
    if (this.scope !== scope) {
      this.scope = scope
      this.entries.clear()
    }
    const cached = this.entries.get(key)
    if (cached) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached
    }
    const request = load().catch((error) => {
      if (this.entries.get(key) === request) this.entries.delete(key)
      throw error
    })
    this.entries.set(key, request)
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
    return request
  }

  invalidate(key?: string): void {
    if (key === undefined) this.entries.clear()
    else this.entries.delete(key)
  }
}
