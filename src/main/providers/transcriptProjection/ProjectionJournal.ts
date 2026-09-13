/** Temporary stream overlays must never mutate the committed projection. */
export class ProjectionJournal {
  private undo: Array<() => void> | null = null

  set<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
    const previous = target[key]
    this.undo?.push(() => {
      target[key] = previous
    })
    target[key] = value
  }

  mapSet<K, V>(target: Map<K, V>, key: K, value: V): void {
    const present = target.has(key)
    const previous = target.get(key)
    this.undo?.push(() => {
      if (present) target.set(key, previous!)
      else target.delete(key)
    })
    target.set(key, value)
  }

  push<T>(target: T[], value: T): void {
    const length = target.length
    this.undo?.push(() => {
      target.length = length
    })
    target.push(value)
  }

  overlay<T>(read: () => T): T {
    if (this.undo) throw new Error('Nested projection overlay')
    this.undo = []
    try {
      return read()
    } finally {
      for (let index = this.undo.length - 1; index >= 0; index -= 1) this.undo[index]()
      this.undo = null
    }
  }
}
