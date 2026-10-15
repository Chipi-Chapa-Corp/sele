// Bound both entry count and retained text. In particular, streaming revisions and
// unusually large messages must not turn a rendering optimization into history storage.
export function createBoundedTextCache<T>(
  maxEntries: number,
  maxCharacters: number,
  valueCharacters: (value: T) => number
): { get: (key: string, compute: () => T) => T } {
  const entries = new Map<string, { value: T; characters: number }>()
  let characters = 0
  return {
    get(key, compute) {
      const cached = entries.get(key)
      if (cached) {
        entries.delete(key)
        entries.set(key, cached)
        return cached.value
      }
      const value = compute()
      const size = key.length + valueCharacters(value)
      if (size > maxCharacters || maxEntries <= 0) return value
      while (entries.size && (entries.size >= maxEntries || characters + size > maxCharacters)) {
        const oldest = entries.keys().next().value!
        characters -= entries.get(oldest)!.characters
        entries.delete(oldest)
      }
      entries.set(key, { value, characters: size })
      characters += size
      return value
    }
  }
}
