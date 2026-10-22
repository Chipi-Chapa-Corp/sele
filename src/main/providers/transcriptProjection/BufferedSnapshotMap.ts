/** Queued mutations are reduced before any snapshot read or replacement. Published values
 * remain immutable; readers never observe a partially applied batch. */
export class BufferedSnapshotMap<Key, Value, Update> extends Map<Key, Value> {
  private pending = new Map<Key, Update[]>()
  private readonly reduce: (value: Value, updates: Update[]) => Value

  constructor(reduce: (value: Value, updates: Update[]) => Value) {
    super()
    this.reduce = reduce
  }

  peek(key: Key): Value | undefined {
    return super.get(key)
  }

  enqueue(key: Key, update: Update): void {
    const batch = this.pending.get(key)
    if (batch) batch.push(update)
    else this.pending.set(key, [update])
    if ((this.pending.get(key)?.length ?? 0) >= 1024) this.flush(key)
  }

  private flush(key: Key): void {
    const batch = this.pending.get(key)
    if (!batch) return
    this.pending.delete(key)
    const value = super.get(key)
    if (value !== undefined) super.set(key, this.reduce(value, batch))
  }

  private flushAll(): void {
    for (const key of this.pending.keys()) this.flush(key)
  }

  override get(key: Key): Value | undefined {
    this.flush(key)
    return super.get(key)
  }

  override set(key: Key, value: Value): this {
    this.flush(key)
    return super.set(key, value)
  }

  override delete(key: Key): boolean {
    this.pending.delete(key)
    return super.delete(key)
  }

  override clear(): void {
    this.pending.clear()
    super.clear()
  }

  override values(): MapIterator<Value> {
    this.flushAll()
    return super.values()
  }

  override entries(): MapIterator<[Key, Value]> {
    this.flushAll()
    return super.entries()
  }

  override [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.entries()
  }

  override forEach(
    callback: (value: Value, key: Key, map: Map<Key, Value>) => void,
    thisArg?: unknown
  ): void {
    this.flushAll()
    super.forEach(callback, thisArg)
  }
}
