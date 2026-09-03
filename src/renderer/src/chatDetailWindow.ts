import type {
  ProviderChatDetail,
  ProviderChatItem,
  ProviderChatTurnPage,
  ProviderId,
  ProviderWorkingItem,
  ProviderWorkingItemSegment,
  ProviderWorkingStepPage,
  ProviderWorkingStep,
  ProviderWorkingToolGroup,
  ProviderWorkingToolPage
} from '../../shared/provider'
import { assertUniqueProviderChatItemIds, getProviderChatTurns } from '../../shared/chatTurns.ts'
import type { ChatTurnWindow } from './chatTurnWindow'

export const optimisticChatItemIdPrefix = 'optimistic:'

export const hasProviderUserMessage = (items: ProviderChatItem[]): boolean =>
  items.some((item) => item.type === 'message' && item.role === 'user')

export const shouldPreserveOptimisticTurnUntilUserMessage = (providerId: ProviderId): boolean =>
  providerId === 'codex' || providerId === 'copilot' || providerId === 'opencode'

export const hasProviderUserMessageAfterOptimisticTurn = (
  currentItems: ProviderChatItem[],
  incomingItems: ProviderChatItem[]
): boolean => {
  const optimisticTurnStartIndex = currentItems.findIndex((item) =>
    item.id.startsWith(optimisticChatItemIdPrefix)
  )
  if (optimisticTurnStartIndex < 0) return true

  const existingUserMessageIds = new Set(
    currentItems
      .slice(0, optimisticTurnStartIndex)
      .filter((item) => item.type === 'message' && item.role === 'user')
      .map((item) => item.id)
  )
  return incomingItems.some(
    (item) =>
      item.type === 'message' &&
      item.role === 'user' &&
      !item.id.startsWith(optimisticChatItemIdPrefix) &&
      !existingUserMessageIds.has(item.id)
  )
}

export const preserveOptimisticChatDetail = (
  currentDetail: ProviderChatDetail | null | undefined,
  incomingDetail: ProviderChatDetail
): ProviderChatDetail => {
  if (
    currentDetail?.id !== incomingDetail.id ||
    hasProviderUserMessageAfterOptimisticTurn(currentDetail?.items ?? [], incomingDetail.items)
  ) {
    return incomingDetail
  }

  return {
    ...incomingDetail,
    items: currentDetail.items,
    itemsStartTurnIndex: getChatDetailItemsStartTurnIndex(currentDetail),
    turnCount: Math.max(
      getChatDetailTurnCount(currentDetail),
      getChatDetailTurnCount(incomingDetail)
    )
  }
}

export const getChatDetailTurnCount = (detail: ProviderChatDetail | null | undefined): number =>
  Math.max(
    detail?.turnCount ?? 0,
    (detail?.itemsStartTurnIndex ?? 0) + getProviderChatTurns(detail?.items ?? []).length
  )

export const getChatDetailItemsStartTurnIndex = (
  detail: ProviderChatDetail | null | undefined
): number => detail?.itemsStartTurnIndex ?? 0

export const getLoadedChatDetailTurnEndIndex = (
  detail: ProviderChatDetail | null | undefined
): number =>
  getChatDetailItemsStartTurnIndex(detail) + getProviderChatTurns(detail?.items ?? []).length

export const mergeChatDetailTurnPage = (
  detail: ProviderChatDetail,
  page: ProviderChatTurnPage,
  retainedWindow: Pick<ChatTurnWindow, 'startIndex' | 'endIndex' | 'totalCount'>
): ProviderChatDetail => {
  const turnsByIndex = new Map<number, ProviderChatItem[]>()
  const currentStartIndex = getChatDetailItemsStartTurnIndex(detail)
  const currentTurns = getProviderChatTurns(detail.items)
  const pageTurns = getProviderChatTurns(page.items)
  const pageTurnIds = new Set(pageTurns.map((turn) => turn.id))

  // A page can be resolved before a concurrent insertion/revert changes the numeric window.
  // Stable turn identity is authoritative for overlap: never retain an older copy of a turn at
  // one index while installing the incoming copy at another index.
  currentTurns.forEach((turn, index) => {
    if (pageTurnIds.has(turn.id)) return
    turnsByIndex.set(currentStartIndex + index, turn.items)
  })
  pageTurns.forEach((turn, index) => {
    turnsByIndex.set(page.startIndex + index, turn.items)
  })

  const items: ProviderChatItem[] = []
  let itemsStartTurnIndex: number | null = null
  for (
    let turnIndex = retainedWindow.startIndex;
    turnIndex < retainedWindow.endIndex;
    turnIndex += 1
  ) {
    const turnItems = turnsByIndex.get(turnIndex)
    if (!turnItems) {
      // A target retention window can be wider than the pages currently materialized. Skip a
      // leading gap, but never flatten two disjoint ranges under one logical start index.
      if (itemsStartTurnIndex !== null) break
      continue
    }
    itemsStartTurnIndex ??= turnIndex
    items.push(...turnItems)
  }

  const mergedSubagents =
    page.subagents === undefined
      ? detail.subagents
      : [
          ...(detail.subagents ?? []).filter(
            (subagent) => !page.subagents?.some((candidate) => candidate.id === subagent.id)
          ),
          ...page.subagents
        ]
  const retainedSubagents = mergedSubagents?.filter(
    (subagent) =>
      !subagent.turnId || items.some((item) => item.id.startsWith(`${subagent.turnId}:`))
  )

  assertUniqueProviderChatItemIds(items)

  return {
    ...detail,
    items,
    ...(retainedSubagents === undefined ? {} : { subagents: retainedSubagents }),
    itemsStartTurnIndex: itemsStartTurnIndex ?? retainedWindow.startIndex,
    turnCount: Math.max(detail.turnCount ?? 0, page.totalCount, retainedWindow.totalCount),
    turnPagination: page.turnPagination
  }
}

export const replaceChatDetailWithCursorPage = (
  detail: ProviderChatDetail,
  page: ProviderChatTurnPage
): ProviderChatDetail => ({
  ...detail,
  items: page.items,
  ...(page.subagents === undefined ? {} : { subagents: page.subagents }),
  itemsStartTurnIndex: 0,
  turnCount: getProviderChatTurns(page.items).length,
  turnPagination: page.turnPagination
})

export const retainLoadedChatDetailTurnWindow = (
  detail: ProviderChatDetail,
  retainedWindow: Pick<ChatTurnWindow, 'startIndex' | 'endIndex' | 'totalCount'>
): ProviderChatDetail =>
  mergeChatDetailTurnPage(
    detail,
    {
      items: [],
      startIndex: retainedWindow.startIndex,
      totalCount: retainedWindow.totalCount
    },
    retainedWindow
  )

const getWorkingItemSegmentEndIndex = (segment: ProviderWorkingItemSegment): number =>
  segment.startIndex + segment.items.length

const getWorkingItemsByIndex = (
  segments: ProviderWorkingItemSegment[],
  kind?: ProviderWorkingItemSegment['kind']
): Map<number, ProviderWorkingItem> => {
  const itemsByIndex = new Map<number, ProviderWorkingItem>()
  segments.forEach((segment) => {
    if (kind && segment.kind !== kind) return
    segment.items.forEach((item, index) => itemsByIndex.set(segment.startIndex + index, item))
  })
  return itemsByIndex
}

const getSegmentsFromIndexedItems = (
  itemsByIndex: ReadonlyMap<number, ProviderWorkingItem>,
  kind: ProviderWorkingItemSegment['kind']
): ProviderWorkingItemSegment[] => {
  const indexes = [...itemsByIndex.keys()].sort((first, second) => first - second)
  const segments: ProviderWorkingItemSegment[] = []

  indexes.forEach((index) => {
    const item = itemsByIndex.get(index)
    if (!item) return
    const previousSegment = segments.at(-1)
    if (previousSegment && getWorkingItemSegmentEndIndex(previousSegment) === index) {
      previousSegment.items.push(item)
      return
    }
    segments.push({ kind, startIndex: index, items: [item] })
  })
  return segments
}

export const getWorkingStepItemSegments = (
  step: ProviderWorkingStep,
  tailItemLimit: number
): ProviderWorkingItemSegment[] => {
  if (step.itemsLoaded === false || step.items.length === 0) return []
  if (step.itemSegments?.length) {
    return step.itemSegments
      .filter((segment) => segment.items.length > 0)
      .sort((first, second) => first.startIndex - second.startIndex)
  }

  const totalCount = Math.max(step.itemCount ?? 0, step.items.length)
  const sourceStartIndex = step.itemsStartIndex ?? Math.max(0, totalCount - step.items.length)
  const sourceEndIndex = sourceStartIndex + step.items.length
  const boundedTailItemLimit = Math.max(1, tailItemLimit)
  if (sourceEndIndex >= totalCount) {
    const items = step.items.slice(-boundedTailItemLimit)
    return [
      {
        kind: 'tail',
        startIndex: sourceEndIndex - items.length,
        items
      }
    ]
  }
  return [{ kind: 'history', startIndex: sourceStartIndex, items: step.items }]
}

const createSegmentedWorkingStep = (
  step: Omit<ProviderWorkingStep, 'items'>,
  segments: ProviderWorkingItemSegment[],
  totalCount: number
): ProviderWorkingStep => {
  const boundedSegments = segments
    .filter((segment) => segment.items.length > 0)
    .sort((first, second) => first.startIndex - second.startIndex)
  return {
    ...step,
    items: boundedSegments.flatMap((segment) => segment.items),
    itemsLoaded: true,
    itemCount: totalCount,
    itemsStartIndex: boundedSegments[0]?.startIndex ?? 0,
    itemSegments: boundedSegments.length > 0 ? boundedSegments : undefined
  }
}

const retainBoundedHistoryItems = (
  itemsByIndex: Map<number, ProviderWorkingItem>,
  itemLimit: number,
  loadingOlder: boolean
): Map<number, ProviderWorkingItem> => {
  if (itemsByIndex.size <= itemLimit) return itemsByIndex
  const indexes = [...itemsByIndex.keys()].sort((first, second) => first - second)
  const retainedIndexes = loadingOlder ? indexes.slice(0, itemLimit) : indexes.slice(-itemLimit)
  return new Map(retainedIndexes.map((index) => [index, itemsByIndex.get(index)!]))
}

export const mergeWorkingStepPage = (
  currentStep: ProviderWorkingStep,
  page: ProviderWorkingStepPage,
  tailItemLimit: number,
  historyItemLimit: number
): ProviderWorkingStep => {
  const boundedTailItemLimit = Math.max(1, tailItemLimit)
  const boundedHistoryItemLimit = Math.max(1, historyItemLimit)
  const totalCount = page.totalCount
  const tailStartIndex = Math.max(0, totalCount - boundedTailItemLimit)
  const currentSegments = getWorkingStepItemSegments(currentStep, boundedTailItemLimit)
  const currentHistoryItems = getWorkingItemsByIndex(currentSegments, 'history')
  const currentHistoryStartIndex = Math.min(...currentHistoryItems.keys(), Number.POSITIVE_INFINITY)
  const incomingHistoryItems = new Map<number, ProviderWorkingItem>()
  const tailItems = getWorkingItemsByIndex(currentSegments, 'tail')

  page.items.forEach((item, index) => {
    const logicalIndex = page.startIndex + index
    if (logicalIndex < tailStartIndex) incomingHistoryItems.set(logicalIndex, item)
    else if (logicalIndex < totalCount) tailItems.set(logicalIndex, item)
  })
  currentHistoryItems.forEach((item, index) => {
    if (index >= tailStartIndex) tailItems.set(index, item)
  })

  const historyItems = new Map([...currentHistoryItems].filter(([index]) => index < tailStartIndex))
  incomingHistoryItems.forEach((item, index) => historyItems.set(index, item))
  const loadingOlder = page.startIndex < currentHistoryStartIndex
  const boundedHistoryItems = retainBoundedHistoryItems(
    historyItems,
    boundedHistoryItemLimit,
    loadingOlder
  )
  const boundedTailItems = new Map(
    [...tailItems].filter(([index]) => index >= tailStartIndex && index < totalCount)
  )

  return createSegmentedWorkingStep(
    { ...currentStep, status: page.status },
    [
      ...getSegmentsFromIndexedItems(boundedHistoryItems, 'history'),
      ...getSegmentsFromIndexedItems(boundedTailItems, 'tail')
    ],
    totalCount
  )
}

export const mergeWorkingToolPage = (
  currentGroup: ProviderWorkingToolGroup,
  page: ProviderWorkingToolPage,
  windowSize: number
): ProviderWorkingToolGroup => {
  const boundedWindowSize = Math.max(1, windowSize)
  const totalCount = Math.max(page.totalCount, currentGroup.toolCount ?? 0)
  const currentStartIndex =
    currentGroup.toolsStartIndex ?? Math.max(0, totalCount - currentGroup.tools.length)
  const toolsByIndex = new Map(
    currentGroup.tools.map((tool, index) => [currentStartIndex + index, tool] as const)
  )
  page.tools.forEach((tool, index) => toolsByIndex.set(page.startIndex + index, tool))

  const indexes = [...toolsByIndex.keys()].sort((first, second) => first - second)
  const loadingOlder = page.startIndex < currentStartIndex
  const retainedIndexes =
    indexes.length <= boundedWindowSize
      ? indexes
      : loadingOlder
        ? indexes.slice(0, boundedWindowSize)
        : indexes.slice(-boundedWindowSize)
  const retainedStartIndex = retainedIndexes[0] ?? page.startIndex

  return {
    ...currentGroup,
    tools: retainedIndexes.map((index) => toolsByIndex.get(index)!),
    toolCount: totalCount,
    toolsStartIndex: retainedStartIndex
  }
}
