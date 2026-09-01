import type { CodexTurn } from './CodexItemRenderers.ts'

type CodexHistoryRequest = (method: string, params: unknown) => Promise<unknown>

type ThreadTurnsListResponse = {
  data: CodexTurn[]
  nextCursor?: string | null
}

export type CodexEditHistoryPlan = {
  retainedCatalog: CodexTurn[]
  rolledBackTurnIds: Set<string>
  targetTurnIndex: number
}

export class CodexTurnWindowMismatchError extends Error {
  readonly missingTurnIds: readonly string[]

  constructor(missingTurnIds: readonly string[]) {
    super('Codex omitted a turn from the requested history window')
    this.name = 'CodexTurnWindowMismatchError'
    this.missingTurnIds = missingTurnIds
  }
}

const turnCatalogPageSize = 1_000
const turnCursorSeekPageSize = 1_000

const isPersistedTurn = (turn: CodexTurn): boolean =>
  turn.status !== 'queued' && !turn.id.startsWith('pending:') && !turn.id.startsWith('queued:')

/**
 * Resolves the edit boundary against a stable, pre-revert history snapshot. A just-started turn
 * may be visible in the live tail before Codex's paginated history projector has indexed it. That
 * case is safe only when the target is the newest loaded turn and starts exactly where the known
 * catalog ends. Refusing every other mismatch prevents a transient empty/stale page from being
 * mistaken for an empty conversation.
 */
export const planCodexHistoryEdit = (
  turnCatalog: readonly CodexTurn[],
  loadedTurns: readonly CodexTurn[],
  loadedTurnStartIndex: number,
  targetTurnId: string
): CodexEditHistoryPlan => {
  const persistedCatalog = turnCatalog.filter(isPersistedTurn)
  const persistedLoadedTurns = loadedTurns.filter(isPersistedTurn)
  const catalogTargetIndex = persistedCatalog.findIndex((turn) => turn.id === targetTurnId)
  const loadedTargetIndex = persistedLoadedTurns.findIndex((turn) => turn.id === targetTurnId)

  let targetTurnIndex = catalogTargetIndex
  if (targetTurnIndex < 0) {
    const inferredTargetIndex = Math.max(0, Math.floor(loadedTurnStartIndex)) + loadedTargetIndex
    const isUnprojectedNewestTurn =
      loadedTargetIndex >= 0 &&
      loadedTargetIndex === persistedLoadedTurns.length - 1 &&
      inferredTargetIndex === persistedCatalog.length

    if (!isUnprojectedNewestTurn) {
      throw new Error('Message cannot be edited safely because its history is still loading')
    }
    targetTurnIndex = inferredTargetIndex
  }

  const retainedCatalog = persistedCatalog.slice(0, targetTurnIndex)
  const rolledBackTurnIds = new Set(persistedCatalog.slice(targetTurnIndex).map((turn) => turn.id))
  rolledBackTurnIds.add(targetTurnId)
  persistedLoadedTurns.forEach((turn, index) => {
    if (Math.max(0, Math.floor(loadedTurnStartIndex)) + index >= targetTurnIndex) {
      rolledBackTurnIds.add(turn.id)
    }
  })

  return { retainedCatalog, rolledBackTurnIds, targetTurnIndex }
}

const getNextCursor = (
  response: { nextCursor?: string | null },
  seenCursors: Set<string>
): string | null => {
  const cursor = response.nextCursor ?? null
  if (!cursor || seenCursors.has(cursor)) return null
  seenCursors.add(cursor)
  return cursor
}

/**
 * Enumerates lightweight turn shells. `itemsView: notLoaded` is important: the app-server reads
 * only turn metadata and does not deserialize historical tool payloads into the response.
 */
export const loadCodexTurnCatalog = async (
  request: CodexHistoryRequest,
  threadId: string
): Promise<CodexTurn[]> => {
  const turns: CodexTurn[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  do {
    const response = (await request('thread/turns/list', {
      threadId,
      cursor,
      limit: turnCatalogPageSize,
      sortDirection: 'asc',
      itemsView: 'notLoaded'
    })) as ThreadTurnsListResponse
    if (!Array.isArray(response.data)) throw new Error('Invalid paginated Codex turn response')
    turns.push(...response.data.map((turn) => ({ ...turn, items: [] })))
    cursor = getNextCursor(response, seenCursors)
  } while (cursor)

  return turns
}

/**
 * Finds the descending cursor immediately before a requested turn window. Seeking uses
 * `notLoaded`, so crossing older history never materializes item payloads.
 */
const seekCodexTurnCursor = async (
  request: CodexHistoryRequest,
  threadId: string,
  turnOffsetFromNewest: number
): Promise<string | null> => {
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  let remaining = Math.max(0, turnOffsetFromNewest)

  while (remaining > 0) {
    const limit = Math.min(remaining, turnCursorSeekPageSize)
    const response = (await request('thread/turns/list', {
      threadId,
      cursor,
      limit,
      sortDirection: 'desc',
      itemsView: 'notLoaded'
    })) as ThreadTurnsListResponse
    if (!Array.isArray(response.data) || response.data.length === 0) {
      throw new Error('Unable to seek paginated Codex turn history')
    }

    remaining -= response.data.length
    const nextCursor = getNextCursor(response, seenCursors)
    if (remaining > 0 && !nextCursor) {
      throw new Error('Codex turn history ended before the requested window')
    }
    cursor = nextCursor
  }

  return cursor
}

/**
 * Hydrates only the selected raw turns. Current Codex releases expose `thread/items/list` in the
 * schema but reject it at runtime, so the supported full-turn view is used after a metadata-only
 * cursor seek.
 */
export const hydrateCodexTurnRange = async (
  request: CodexHistoryRequest,
  threadId: string,
  turnCatalog: readonly CodexTurn[],
  startIndex: number,
  endIndex: number
): Promise<CodexTurn[]> => {
  const boundedStartIndex = Math.max(0, Math.min(startIndex, turnCatalog.length))
  const boundedEndIndex = Math.max(boundedStartIndex, Math.min(endIndex, turnCatalog.length))
  const selectedTurns = turnCatalog.slice(boundedStartIndex, boundedEndIndex)
  if (selectedTurns.length === 0) return []

  const turnOffsetFromNewest = turnCatalog.length - boundedEndIndex
  const cursor = await seekCodexTurnCursor(request, threadId, turnOffsetFromNewest)
  const response = (await request('thread/turns/list', {
    threadId,
    cursor,
    limit: selectedTurns.length,
    sortDirection: 'desc',
    itemsView: 'full'
  })) as ThreadTurnsListResponse
  if (!Array.isArray(response.data)) throw new Error('Invalid paginated Codex turn response')

  const hydratedById = new Map(response.data.map((turn) => [turn.id, turn]))
  const missingTurnIds = selectedTurns
    .map((turn) => turn.id)
    .filter((turnId) => !hydratedById.has(turnId))
  if (missingTurnIds.length > 0) throw new CodexTurnWindowMismatchError(missingTurnIds)

  return selectedTurns.map((turn) => {
    // The missing-id check above guarantees every selected turn is present.
    return hydratedById.get(turn.id)!
  })
}

/**
 * Reconstructs a catalog window from one or more full-turn snapshots. Later snapshots take
 * precedence, allowing callers to use rollout data as a fallback while preferring the structured
 * app-server representation. Only catalogued IDs are returned, so append-only rollout files
 * cannot resurrect turns removed by an edit.
 */
export const selectCodexTurnRangeFromSnapshots = (
  turnCatalog: readonly CodexTurn[],
  startIndex: number,
  endIndex: number,
  ...snapshots: readonly (readonly CodexTurn[])[]
): CodexTurn[] => {
  const boundedStartIndex = Math.max(0, Math.min(startIndex, turnCatalog.length))
  const boundedEndIndex = Math.max(boundedStartIndex, Math.min(endIndex, turnCatalog.length))
  const selectedTurns = turnCatalog.slice(boundedStartIndex, boundedEndIndex)
  const turnsById = new Map<string, CodexTurn>()
  snapshots.forEach((turns) => turns.forEach((turn) => turnsById.set(turn.id, turn)))

  const missingTurnIds = selectedTurns
    .map((turn) => turn.id)
    .filter((turnId) => !turnsById.has(turnId))
  if (missingTurnIds.length > 0) throw new CodexTurnWindowMismatchError(missingTurnIds)

  return selectedTurns.map((turn) => turnsById.get(turn.id)!)
}

/**
 * Retries a window read once with a freshly enumerated catalog when the catalog and hydrated
 * transcript came from different snapshots. Codex's thread `updatedAt` value is not a reliable
 * cache invalidator for externally appended turns, so callers must recover from this race.
 */
export const retryCodexTurnWindowWithFreshCatalog = async <Result>(
  turnCatalog: CodexTurn[],
  refreshTurnCatalog: () => Promise<CodexTurn[]>,
  loadWindow: (catalog: CodexTurn[]) => Promise<Result>
): Promise<{ turnCatalog: CodexTurn[]; result: Result }> => {
  try {
    return { turnCatalog, result: await loadWindow(turnCatalog) }
  } catch (error) {
    if (!(error instanceof CodexTurnWindowMismatchError)) throw error
  }

  const refreshedTurnCatalog = await refreshTurnCatalog()
  return {
    turnCatalog: refreshedTurnCatalog,
    result: await loadWindow(refreshedTurnCatalog)
  }
}
