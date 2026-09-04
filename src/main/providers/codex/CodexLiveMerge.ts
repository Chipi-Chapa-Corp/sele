import {
  assertUniqueProviderSnapshotIds,
  mergeProviderSnapshotsById
} from '../ProviderConversationEngine.ts'

export const mergeCodexStreamedText = (
  previous: string | undefined,
  next: string | undefined
): string | undefined => {
  if (next == null || previous == null) return next ?? previous

  // Agent message deltas are append-only. A queued turn can finish while an older turn or item
  // snapshot is still in flight, so do not let that shorter prefix crop the streamed response.
  if (previous.length > next.length && previous.startsWith(next)) return previous

  return next
}

type CodexTurnLifecycle = {
  status?: string | null
  completedAt?: number | null
}

type CodexIdentified = {
  id: string
}

type CodexOrderedTurn = CodexIdentified & {
  local?: boolean
}

type CodexAgentMessageItem = CodexIdentified & {
  type: string
  text?: string
  phase?: 'commentary' | 'final_answer' | null
  status?: string
}

export type CodexAgentResponseOverlay = {
  text: string
  phase?: 'commentary' | 'final_answer' | null
}

export const mergeCodexSnapshotsById = <Snapshot extends CodexIdentified>(
  snapshots: readonly Snapshot[],
  merge: (previous: Snapshot, next: Snapshot) => Snapshot
): Snapshot[] => mergeProviderSnapshotsById(snapshots, merge)

export const assertUniqueCodexSnapshotIds = <Snapshot extends CodexIdentified>(
  snapshots: readonly Snapshot[],
  label: string
): void => assertUniqueProviderSnapshotIds(snapshots, `Codex ${label}`)

const assertAuthoritativeCodexTailSuccessor = <Turn extends CodexOrderedTurn>(
  currentTurns: readonly Turn[],
  authoritativeTurns: readonly Turn[],
  overlayTurnIds: ReadonlySet<string>
): void => {
  const currentIds = currentTurns
    .filter((turn) => turn.local !== true && !overlayTurnIds.has(turn.id))
    .map((turn) => turn.id)
  if (currentIds.length === 0) return

  const authoritativeIds = authoritativeTurns.map((turn) => turn.id)
  if (authoritativeIds.length === 0) {
    throw new Error('Codex message history is unavailable. Please retry.')
  }

  const authoritativeIndexes = new Map(
    authoritativeIds.map((turnId, index) => [turnId, index] as const)
  )
  const sharedCurrentIndexes = currentIds
    .map((turnId, index) => (authoritativeIndexes.has(turnId) ? index : -1))
    .filter((index) => index >= 0)
  if (sharedCurrentIndexes.length === 0) {
    throw new Error('Codex message history changed without a consistent boundary. Please retry.')
  }

  const firstSharedCurrentIndex = sharedCurrentIndexes[0]
  const sharedCurrentIds = currentIds.slice(firstSharedCurrentIndex)
  if (sharedCurrentIds.some((turnId) => !authoritativeIndexes.has(turnId))) {
    throw new Error('Codex message history is unavailable. Please retry.')
  }
  const sharedAuthoritativeIndexes = sharedCurrentIds.map((turnId) =>
    authoritativeIndexes.get(turnId)!
  )
  if (
    sharedAuthoritativeIndexes.some(
      (index, offset) => offset > 0 && index !== sharedAuthoritativeIndexes[offset - 1] + 1
    )
  ) {
    throw new Error('Codex message history changed order. Please retry.')
  }
}

/**
 * Projects one backend-owned tail plus explicitly local/live overlays. Persisted order and
 * cardinality come exclusively from the backend page; no timestamp or ID-order inference exists.
 */
export const projectCodexTurnTail = <Turn extends CodexOrderedTurn>(
  authoritativeTurns: readonly Turn[],
  currentTurns: readonly Turn[],
  limit: number,
  overlayTurnIds: ReadonlySet<string>,
  merge: (previous: Turn, next: Turn) => Turn
): Turn[] => {
  assertUniqueCodexSnapshotIds(authoritativeTurns, 'history page')
  assertUniqueCodexSnapshotIds(currentTurns, 'cached tail')
  assertAuthoritativeCodexTailSuccessor(currentTurns, authoritativeTurns, overlayTurnIds)

  const currentById = new Map(currentTurns.map((turn) => [turn.id, turn]))
  const authoritativeIds = new Set(authoritativeTurns.map((turn) => turn.id))
  const projectedTurns = authoritativeTurns.map((turn) => {
    const currentTurn = currentById.get(turn.id)
    return currentTurn && overlayTurnIds.has(turn.id) ? merge(turn, currentTurn) : turn
  })
  projectedTurns.push(
    ...currentTurns.filter(
      (turn) =>
        !authoritativeIds.has(turn.id) && (turn.local === true || overlayTurnIds.has(turn.id))
    )
  )

  const boundedLimit = Math.max(1, Math.floor(limit))
  return projectedTurns.slice(-boundedLimit)
}

/**
 * Raw protocol responses have no stable item ID. Project them as an ephemeral view overlay only
 * until the authoritative agent item arrives; they never enter the stored turn item collection.
 */
export const projectCodexAgentResponseOverlay = <
  Item extends CodexAgentMessageItem,
  Turn extends { id: string; items: Item[] }
>(
  turn: Turn,
  overlay: CodexAgentResponseOverlay | null | undefined
): Turn => {
  if (!overlay || turn.items.some((item) => item.type === 'agentMessage')) return turn

  return {
    ...turn,
    items: [
      ...turn.items,
      {
        id: `${turn.id}:assistant-overlay`,
        type: 'agentMessage',
        text: overlay.text,
        phase: overlay.phase ?? 'final_answer'
      } as Item
    ]
  }
}

export const isCodexTurnTerminal = (turn: CodexTurnLifecycle): boolean =>
  turn.status == null
    ? typeof turn.completedAt === 'number'
    : turn.status !== 'inProgress' && turn.status !== 'queued'

export const mergeCodexTurnStatus = (
  previous: CodexTurnLifecycle,
  next: CodexTurnLifecycle
): string | null | undefined => {
  if (isCodexTurnTerminal(previous) && !isCodexTurnTerminal(next)) return previous.status
  if (isCodexTurnTerminal(next)) return next.status
  return next.status ?? previous.status
}

export const reconcileCodexTurnSnapshots = <Turn>(
  pending: Turn | null,
  started: Turn,
  existing: Turn | null,
  merge: (previous: Turn, next: Turn) => Turn
): Turn => {
  const turnWithPendingInput = pending ? merge(pending, started) : started
  return existing ? merge(turnWithPendingInput, existing) : turnWithPendingInput
}

export const isMatchingCodexPendingTurn = (
  currentPendingTurnId: string | undefined,
  expectedPendingTurnId: string | null
): boolean => Boolean(expectedPendingTurnId && currentPendingTurnId === expectedPendingTurnId)
