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
  failureReason?: ProviderWorkingStep['failureReason']
  showWorking?: boolean
  betweenWorkingAndFinal?: readonly ProviderChatItem[]
  workingItemWindow?: {
    itemCount: number
    itemsStartIndex: number
  }
}

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
  // A renderable assistant message is content, not a lifecycle boundary. Providers may stream
  // final-answer text before their terminal event, so only the explicit lifecycle controls status.
  const status = getProviderWorkingStatus(segment.lifecycle)
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

type MaybePromise<T> = T | Promise<T>

export type ProviderConversationCompletionPhase = 'reconcile' | 'publish'

export type ProviderConversationCompletionOperations = {
  /** Publishes the terminal snapshot from the live cache before any asynchronous recovery work. */
  publish: () => MaybePromise<void>
  /** Optionally refreshes persisted provider state after the terminal snapshot is visible. */
  reconcile?: () => MaybePromise<void>
  /** Optionally publishes the successfully reconciled snapshot as a non-terminal follow-up. */
  publishReconciled?: () => MaybePromise<void>
  /** Prevents obsolete recovery work from overwriting a newer turn. */
  isCurrent?: () => boolean
  onError?: (error: unknown, phase: ProviderConversationCompletionPhase) => void
}

/**
 * Owns the shared terminal-state contract for provider conversations:
 *
 *   native completion -> immediate terminal publication -> optional recovery reconciliation
 *
 * The live event stream is the foreground source of truth. Persisted history is allowed to repair
 * that snapshot afterward, but it must never suppress or delay the terminal publication. A newer
 * completion or an explicit cancellation makes in-flight recovery stale, so it cannot overwrite
 * a newer live turn.
 */
export class ProviderConversationCompletionCoordinator {
  private completions = new Map<string, symbol>()

  complete = (
    conversationId: string,
    operations: ProviderConversationCompletionOperations
  ): Promise<boolean> => {
    const completion = Symbol(conversationId)
    this.completions.set(conversationId, completion)

    const isCurrent = (): boolean =>
      this.completions.get(conversationId) === completion && (operations.isCurrent?.() ?? true)

    return (async (): Promise<boolean> => {
      if (!isCurrent()) return false

      // Calling publish before the first await is intentional: adapters invoke complete without
      // awaiting it, and the terminal live snapshot must reach listeners in the same event turn.
      try {
        await operations.publish()
      } catch (error) {
        operations.onError?.(error, 'publish')
        if (this.completions.get(conversationId) === completion) {
          this.completions.delete(conversationId)
        }
        return false
      }

      if (operations.reconcile && isCurrent()) {
        try {
          await operations.reconcile()
          if (isCurrent() && operations.publishReconciled) {
            await operations.publishReconciled()
          }
        } catch (error) {
          operations.onError?.(error, 'reconcile')
        }
      }

      if (this.completions.get(conversationId) === completion) {
        this.completions.delete(conversationId)
      }
      return true
    })()
  }

  cancel = (conversationId: string): void => {
    this.completions.delete(conversationId)
  }

  clear = (): void => {
    this.completions.clear()
  }
}
