import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderWorkingItem,
  ProviderWorkingStep
} from '../../shared/provider'

export type ProviderConversationEntry =
  { kind: 'working'; item: ProviderWorkingItem } | { kind: 'assistant'; message: ProviderMessage }

export type ProviderConversationLifecycle = {
  active?: boolean
  completed?: boolean
  failed?: boolean
  queued?: boolean
  stopped?: boolean
}

export type ProviderConversationSegment = {
  id: string
  entries: readonly ProviderConversationEntry[]
  finalMessageIndex?: number | null
  lifecycle: ProviderConversationLifecycle
  keepActiveAfterFinal?: boolean
  failureReason?: ProviderWorkingStep['failureReason']
  showWorking?: boolean
  betweenWorkingAndFinal?: readonly ProviderChatItem[]
  workingItemWindow?: {
    itemCount: number
    itemsStartIndex: number
  }
}

const exceptionalWorkingStatuses = new Set<ProviderWorkingStep['status']>([
  'failed',
  'queued',
  'stopped'
])

export const getProviderWorkingStatus = (
  lifecycle: ProviderConversationLifecycle
): ProviderWorkingStep['status'] => {
  if (lifecycle.queued) return 'queued'
  if (lifecycle.failed) return 'failed'
  if (lifecycle.stopped) return 'stopped'
  if (lifecycle.completed) return 'worked'
  return lifecycle.active ? 'working' : 'worked'
}

export const getProviderLifecycleForWorkingStatus = (
  status: ProviderWorkingStep['status']
): ProviderConversationLifecycle => ({
  active: status === 'working',
  completed: status === 'worked',
  failed: status === 'failed',
  queued: status === 'queued',
  stopped: status === 'stopped'
})

export const settleProviderWorkingStatus = (
  status: ProviderWorkingStep['status'],
  hasFinalMessage: boolean,
  keepActiveAfterFinal = false
): ProviderWorkingStep['status'] => {
  if (!hasFinalMessage || keepActiveAfterFinal || exceptionalWorkingStatuses.has(status)) {
    return status
  }
  return 'worked'
}

export const getTrailingAssistantEntryIndex = (
  entries: readonly ProviderConversationEntry[]
): number => (entries.length > 0 && entries.at(-1)?.kind === 'assistant' ? entries.length - 1 : -1)

const toWorkingItem = (entry: ProviderConversationEntry): ProviderWorkingItem =>
  entry.kind === 'working'
    ? entry.item
    : { type: 'message', id: entry.message.id, content: entry.message.content }

/**
 * Projects one provider-neutral turn segment into the renderer transcript. Providers decide how
 * native records map to entries; ordering, final-message placement, and lifecycle presentation
 * are shared here.
 */
export const appendProviderConversationSegment = (
  target: ProviderChatItem[],
  segment: ProviderConversationSegment
): void => {
  const selectedFinalMessageIndex =
    segment.finalMessageIndex ?? getTrailingAssistantEntryIndex(segment.entries)
  const finalEntry =
    selectedFinalMessageIndex >= 0 ? segment.entries[selectedFinalMessageIndex] : undefined
  const finalMessage = finalEntry?.kind === 'assistant' ? finalEntry.message : null
  const finalMessageIndex = finalMessage ? selectedFinalMessageIndex : -1
  const workingItems = segment.entries.flatMap((entry, index) =>
    index === finalMessageIndex ? [] : [toWorkingItem(entry)]
  )
  const baseStatus = getProviderWorkingStatus(segment.lifecycle)
  const status = settleProviderWorkingStatus(
    baseStatus,
    finalMessage !== null,
    segment.keepActiveAfterFinal
  )
  const showWorking =
    segment.showWorking ??
    (workingItems.length > 0 ||
      status === 'working' ||
      status === 'queued' ||
      status === 'stopped' ||
      status === 'failed')

  if (showWorking) {
    target.push({
      type: 'working',
      id: segment.id,
      status,
      ...(segment.failureReason ? { failureReason: segment.failureReason } : {}),
      items: workingItems,
      ...(segment.workingItemWindow
        ? {
            itemsLoaded: true,
            itemCount: segment.workingItemWindow.itemCount,
            itemsStartIndex: segment.workingItemWindow.itemsStartIndex
          }
        : {})
    })
  }

  target.push(...(segment.betweenWorkingAndFinal ?? []))
  if (finalMessage) target.push(finalMessage)
}

export const mergeProviderSnapshotsById = <Snapshot extends { id: string }>(
  snapshots: readonly Snapshot[],
  merge: (previous: Snapshot, next: Snapshot) => Snapshot
): Snapshot[] => {
  const uniqueSnapshots: Snapshot[] = []
  const indexesById = new Map<string, number>()

  for (const snapshot of snapshots) {
    const existingIndex = indexesById.get(snapshot.id)
    if (existingIndex == null) {
      indexesById.set(snapshot.id, uniqueSnapshots.length)
      uniqueSnapshots.push(snapshot)
    } else {
      uniqueSnapshots[existingIndex] = merge(uniqueSnapshots[existingIndex]!, snapshot)
    }
  }

  return uniqueSnapshots
}

export const assertUniqueProviderSnapshotIds = <Snapshot extends { id: string }>(
  snapshots: readonly Snapshot[],
  label: string
): void => {
  const ids = new Set<string>()
  for (const snapshot of snapshots) {
    if (ids.has(snapshot.id)) throw new Error(`Invalid ${label}: duplicate ID ${snapshot.id}`)
    ids.add(snapshot.id)
  }
}

/**
 * Merges a provider snapshot into an ordered collection. Authoritative records replace richer
 * live placeholders with the same identity, while unmatched ephemeral live records may be kept.
 */
export const reconcileProviderRecords = <RecordType>(
  current: readonly RecordType[],
  incoming: readonly RecordType[],
  options: {
    authoritative: boolean
    compare?: (first: RecordType, second: RecordType) => number
    getId: (record: RecordType) => string
    merge?: (previous: RecordType, next: RecordType) => RecordType
    retainCurrent?: (record: RecordType) => boolean
  }
): RecordType[] => {
  const merge = options.merge ?? ((_previous: RecordType, next: RecordType) => next)
  const incomingIds = new Set(incoming.map(options.getId))
  const records = options.authoritative
    ? [
        ...incoming,
        ...current.filter(
          (record) =>
            !incomingIds.has(options.getId(record)) && options.retainCurrent?.(record) === true
        )
      ]
    : [...current, ...incoming]
  const reconciled: RecordType[] = []
  const indexesById = new Map<string, number>()
  for (const record of records) {
    const id = options.getId(record)
    const existingIndex = indexesById.get(id)
    if (existingIndex == null) {
      indexesById.set(id, reconciled.length)
      reconciled.push(record)
    } else {
      reconciled[existingIndex] = merge(reconciled[existingIndex]!, record)
    }
  }
  if (options.compare) reconciled.sort(options.compare)
  return reconciled
}
