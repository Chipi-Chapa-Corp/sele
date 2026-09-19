import { getTranscriptRecordChange } from './recordChanges.ts'
import type { ProviderChatItem } from '../../../shared/provider'
import type { ProviderChatTurnWindow } from '../ProviderAdapter'

export type TranscriptRenderWindow = {
  turnWindow?: ProviderChatTurnWindow
}

type Boundary = 'start' | 'content' | 'ignore'
type Index = { length: number; starts: number[] }
const indexes = new WeakMap<object, Map<object, Index>>()

const getNativeTurnIndex = <T>(records: T[], classify: (record: T) => Boundary): Index => {
  let byClassifier = indexes.get(records)
  if (!byClassifier) indexes.set(records, (byClassifier = new Map()))
  let index = byClassifier.get(classify)
  if (!index || index.length !== records.length) {
    const change = getTranscriptRecordChange(records)
    const ancestor = change ? indexes.get(change.previous)?.get(classify) : undefined
    const resume = ancestor && change ? Math.min(change.startIndex, records.length) : 0
    const starts = ancestor ? ancestor.starts.filter((position) => position < resume) : []
    for (let position = resume; position < records.length; position += 1) {
      const record = records[position]
      const boundary = classify(record)
      if (boundary === 'start' || (boundary === 'content' && starts.length === 0)) {
        starts.push(position)
      }
    }
    index = { starts, length: records.length }
    byClassifier.set(classify, index)
  }
  return index
}

export const findNativeItemTurnWindow = <T>(
  records: T[],
  itemId: string,
  limit: number,
  classify: (record: T) => Boundary,
  getId: (record: T) => string
): ProviderChatTurnWindow | null => {
  const { starts } = getNativeTurnIndex(records, classify)
  const position = records.findIndex((record) => {
    const id = getId(record)
    return itemId === id || itemId.startsWith(`${id}:`)
  })
  if (position < 0) return null
  // Binary search the already-indexed native turn boundaries.
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (starts[middle] <= position) low = middle + 1
    else high = middle
  }
  if (!low) return null
  return { startIndex: Math.max(0, low - 1 - Math.floor(limit / 2)), limit }
}

/** Index metadata once per source snapshot, before converting any assistant/tool payloads. */
export const renderNativeTurnWindow = <
  T,
  O extends {
    active: boolean
    stopped: boolean
    failed?: boolean
    pendingItems?: ProviderChatItem[]
  }
>(
  records: T[],
  options: O,
  window: ProviderChatTurnWindow,
  classify: (record: T) => Boundary,
  render: (records: T[], options: O) => ProviderChatItem[]
): { items: ProviderChatItem[]; itemsStartTurnIndex: number; turnCount: number } => {
  const index = getNativeTurnIndex(records, classify)
  const { starts } = index
  const pending = options.pendingItems ?? []
  const turnCount = starts.length + pending.length
  const limit = Math.max(1, Math.floor(window.limit))
  const start =
    window.startIndex == null
      ? Math.max(0, turnCount - limit)
      : Math.max(0, Math.min(turnCount, Math.floor(window.startIndex)))
  const end = Math.min(turnCount, start + limit)
  const includesLatest = end >= starts.length
  const selected =
    start < starts.length
      ? records.slice(starts[start], starts[Math.min(end, starts.length)] ?? records.length)
      : []
  return {
    items: render(selected, {
      ...options,
      active: includesLatest && options.active,
      stopped: includesLatest && options.stopped,
      failed: includesLatest && options.failed,
      pendingItems: pending.slice(
        Math.max(0, start - starts.length),
        Math.max(0, end - starts.length)
      )
    }),
    itemsStartTurnIndex: start,
    turnCount
  }
}
