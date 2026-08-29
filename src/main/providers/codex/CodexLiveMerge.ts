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

export const reconcileCodexTurnStatusWithThread = (
  turnStatus: string | null | undefined,
  threadStatus: string
): string | null | undefined => {
  if (turnStatus !== 'inProgress') return turnStatus
  if (threadStatus === 'idle') return 'interrupted'
  if (threadStatus === 'systemError') return 'failed'
  return turnStatus
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

export const shouldPreferCodexRolloutItems = (counts: {
  structuredToolCount: number
  rolloutToolCount: number
  structuredTextCount: number
  rolloutTextCount: number
}): boolean => {
  if (counts.rolloutToolCount < counts.structuredToolCount) return false
  return (
    (counts.rolloutToolCount > counts.structuredToolCount &&
      counts.rolloutTextCount >= counts.structuredTextCount) ||
    counts.rolloutTextCount > counts.structuredTextCount
  )
}
