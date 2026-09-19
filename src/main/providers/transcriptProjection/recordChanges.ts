/** Provenance for immutable native-record arrays. Unknown/reconciled snapshots rebuild safely. */
type Change = { previous: WeakRef<readonly unknown[]>; startIndex: number }
const changes = new WeakMap<readonly unknown[], Change>()

export const getTranscriptRecordChange = (
  records: readonly unknown[]
): {
  previous: readonly unknown[]
  startIndex: number
} | null => {
  const change = changes.get(records)
  const previous = change?.previous.deref()
  return change && previous ? { previous, startIndex: change.startIndex } : null
}

export const markTranscriptRecordsChanged = (
  previous: readonly unknown[],
  next: readonly unknown[],
  startIndex: number
): void => {
  if (previous === next) return
  changes.set(next, { previous: new WeakRef(previous), startIndex })
}

export const getUnchangedTranscriptPrefix = (
  previous: readonly unknown[],
  next: readonly unknown[]
): number => {
  let cursor = next
  let prefix = Math.min(previous.length, next.length)
  // A missing/collected ancestor or a long unpublished batch is a cold reconstruction, never a
  // guess about whether records match. Weak ancestry cannot retain old transcripts indefinitely.
  for (let depth = 0; depth < 128; depth += 1) {
    if (cursor === previous) return prefix
    const change = changes.get(cursor)
    const ancestor = change?.previous.deref()
    if (!change || !ancestor) return 0
    prefix = Math.min(prefix, change.startIndex)
    cursor = ancestor
  }
  return 0
}

const indexes = new WeakMap<readonly unknown[], Map<string, number>>()

/** Native records passed here are immutable; an authoritative replacement gets a new index. */
export const indexTranscriptRecords = <T extends { id: string }>(
  records: readonly T[]
): Map<string, number> => {
  const cached = indexes.get(records)
  if (cached) return cached
  const index = new Map<string, number>()
  records.forEach((record, position) => {
    if (index.has(record.id)) throw new Error(`Invalid transcript: duplicate ID ${record.id}`)
    index.set(record.id, position)
  })
  indexes.set(records, index)
  return index
}

export const updateIndexedTranscriptRecord = <T extends { id: string }>(
  records: T[],
  id: string,
  update: (previous: T | null) => T | null
): T[] => {
  const index = indexTranscriptRecords(records)
  const candidate = index.get(id)
  // The cached position must belong to this immutable source snapshot.
  const position =
    candidate != null && candidate < records.length && records[candidate].id === id
      ? candidate
      : records.length
  const previous = records[position] ?? null
  const next = update(previous)
  if (!next || next === previous) return records
  if (next.id !== id) throw new Error('A transcript update cannot change record identity')
  const result = records.slice()
  result[position] = next
  // Branching from an older source may reuse a position owned by a different descendant.
  // Only share the index for replacements; copying on append keeps all branches valid.
  const nextIndex = position === records.length ? new Map(index) : index
  nextIndex.set(id, position)
  indexes.set(result, nextIndex)
  markTranscriptRecordsChanged(records, result, position)
  return result
}
