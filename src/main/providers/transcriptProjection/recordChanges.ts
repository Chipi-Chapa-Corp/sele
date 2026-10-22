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
): T[] => updateIndexedTranscriptRecords(records, [{ id, update }])

export type TranscriptRecordUpdate<T> = { id: string; update: (previous: T | null) => T | null }

/** Copy once per publication, preserving snapshots and branches even when a batch appends IDs. */
export const updateIndexedTranscriptRecords = <T extends { id: string }>(
  records: T[],
  updates: readonly TranscriptRecordUpdate<T>[]
): T[] => {
  let result = records
  let index = indexTranscriptRecords(records)
  let copiedIndex = false
  let changedFrom = records.length
  for (const { id, update } of updates) {
    const position = index.get(id) ?? result.length
    const previous = result[position] ?? null
    const next = update(previous)
    if (!next || next === previous) continue
    if (next.id !== id) throw new Error('A transcript update cannot change record identity')
    if (result === records) result = records.slice()
    if (position === result.length) {
      if (!copiedIndex) {
        index = new Map(index)
        copiedIndex = true
      }
      index.set(id, position)
    }
    result[position] = next
    changedFrom = Math.min(changedFrom, position)
  }
  if (result !== records) {
    indexes.set(result, index)
    markTranscriptRecordsChanged(records, result, changedFrom)
  }
  return result
}
