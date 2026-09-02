import type {
  ProviderChatDetail,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingStepPage,
  ProviderWorkingToolGroup,
  ProviderWorkingToolPage,
  ProviderWorkingTool
} from '../../shared/provider'

export const rendererWorkingItemPageSize = 50
export const rendererWorkingItemWindowSize = rendererWorkingItemPageSize * 2
export const rendererHistoricalWorkingItemLazyThreshold = 10
export const rendererWorkingToolPageSize = 50
export const rendererWorkingToolWindowSize = rendererWorkingToolPageSize * 2
export const rendererWorkingPagePayloadBudgetCharacters = 2_000_000
export const rendererWorkingItemPayloadPreviewCharacters = 256_000
export const rendererWorkingToolGroupLimit = 50
export const rendererToolDiffLimit = 200
export const rendererToolImageLimit = 50
const rendererRawCollectionEntryLimit = 200
const rendererRawValueDepthLimit = 8
const rendererPayloadCountEntryLimit = 10_000

const truncatedPayloadMarker = '\n… [truncated to keep the app responsive]'
const rendererToolSequenceIdPrefix = 'renderer-tool-sequence:'

const addCount = (current: number, value: number): number =>
  Math.min(Number.MAX_SAFE_INTEGER, current + value)

const countStringCharacters = (
  value: unknown,
  traversal: { remainingEntries: number },
  seen: WeakSet<object>,
  depth = 0
): number => {
  if (typeof value === 'string') return value.length
  if (!value || typeof value !== 'object' || seen.has(value)) return 0
  if (depth >= rendererRawValueDepthLimit) return Number.MAX_SAFE_INTEGER

  seen.add(value)
  let total = 0
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (traversal.remainingEntries <= 0) return Number.MAX_SAFE_INTEGER
      traversal.remainingEntries -= 1
      total = addCount(total, countStringCharacters(entry, traversal, seen, depth + 1))
    }
    return total
  }

  for (const key in value as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (traversal.remainingEntries <= 0) return Number.MAX_SAFE_INTEGER
    traversal.remainingEntries -= 1
    total = addCount(
      total,
      countStringCharacters((value as Record<string, unknown>)[key], traversal, seen, depth + 1)
    )
  }
  return total
}

const getToolPayloadCharacterCount = (tool: ProviderWorkingTool): number => {
  const traversal = { remainingEntries: rendererPayloadCountEntryLimit }
  const seen = new WeakSet<object>()
  return [
    tool.command,
    tool.cwd,
    tool.stdout,
    tool.diffs,
    tool.rawInput,
    tool.rawOutput,
    tool.images
  ].reduce<number>(
    (total, value) => addCount(total, countStringCharacters(value, traversal, seen)),
    0
  )
}

export const getWorkingItemPayloadCharacterCount = (item: ProviderWorkingItem): number => {
  if (item.type === 'message') return item.content.length
  if (item.type === 'toolGroup') {
    return item.tools.reduce(
      (total, tool) => addCount(total, getToolPayloadCharacterCount(tool)),
      0
    )
  }
  return getToolPayloadCharacterCount(item)
}

const unloadToolPayload = (tool: ProviderWorkingTool): ProviderWorkingTool => {
  return {
    ...tool,
    command: null,
    stdout: null,
    diffs: [],
    diffCount: Math.max(tool.diffCount ?? 0, tool.diffs.length),
    diffsStartIndex: tool.diffCount ?? (tool.diffsStartIndex ?? 0) + tool.diffs.length,
    rawInput: null,
    rawOutput: null,
    images: [],
    imageCount: Math.max(tool.imageCount ?? 0, tool.images.length),
    imagesStartIndex: tool.imageCount ?? (tool.imagesStartIndex ?? 0) + tool.images.length,
    payloadLoaded: false,
    payloadCharacterCount: tool.payloadCharacterCount ?? getToolPayloadCharacterCount(tool)
  }
}

export const unloadWorkingItemPayload = (item: ProviderWorkingItem): ProviderWorkingItem => {
  if (item.type === 'message') {
    return {
      ...item,
      content: '',
      contentLoaded: false,
      contentCharacterCount:
        item.contentLoaded === false ? item.contentCharacterCount : item.content.length
    }
  }
  if (item.type === 'toolGroup') {
    const tools = item.tools.slice(-rendererWorkingToolGroupLimit).map(unloadToolPayload)
    const toolCount = Math.max(item.toolCount ?? 0, item.tools.length)
    const sourceStartIndex = item.toolsStartIndex ?? Math.max(0, toolCount - item.tools.length)
    return {
      ...item,
      tools,
      toolCount,
      toolsStartIndex: sourceStartIndex + Math.max(0, item.tools.length - tools.length)
    }
  }
  return unloadToolPayload(item)
}

const truncateText = (value: string | null, budget: { remaining: number }): string | null => {
  if (value == null || value.length <= budget.remaining) {
    if (value) budget.remaining -= value.length
    return value
  }
  if (budget.remaining <= truncatedPayloadMarker.length) {
    budget.remaining = 0
    return truncatedPayloadMarker.trimStart()
  }

  const retainedLength = budget.remaining - truncatedPayloadMarker.length
  budget.remaining = 0
  return `${value.slice(0, retainedLength)}${truncatedPayloadMarker}`
}

const truncateUnknown = (
  value: unknown,
  budget: { remaining: number },
  truncation: { occurred: boolean; remainingEntries: number },
  seen = new WeakSet<object>(),
  depth = 0
): unknown => {
  if (value == null) return value
  if (typeof value === 'string') return truncateText(value, budget)
  if (typeof value !== 'object') return value
  if (seen.has(value)) {
    truncation.occurred = true
    return '[Circular]'
  }
  if (depth >= rendererRawValueDepthLimit) {
    truncation.occurred = true
    return '[Nested value omitted]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    const retainedEntryCount = Math.min(
      value.length,
      rendererRawCollectionEntryLimit,
      truncation.remainingEntries
    )
    const entries: unknown[] = []
    for (let index = 0; index < retainedEntryCount; index += 1) {
      truncation.remainingEntries -= 1
      entries.push(truncateUnknown(value[index], budget, truncation, seen, depth + 1))
    }
    if (value.length > retainedEntryCount) {
      truncation.occurred = true
      entries.push(`[${value.length - retainedEntryCount} more items]`)
    }
    return entries
  }

  const bounded: Record<string, unknown> = {}
  let entryCount = 0
  for (const key in value as Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    if (entryCount >= rendererRawCollectionEntryLimit || truncation.remainingEntries <= 0) {
      truncation.occurred = true
      bounded.__truncated__ = 'Additional fields omitted'
      break
    }
    truncation.remainingEntries -= 1
    bounded[key] = truncateUnknown(
      (value as Record<string, unknown>)[key],
      budget,
      truncation,
      seen,
      depth + 1
    )
    entryCount += 1
  }
  return bounded
}

const limitToolPayload = (
  tool: ProviderWorkingTool,
  budget: { remaining: number }
): ProviderWorkingTool => {
  const payloadCharacterCount = Math.max(
    tool.payloadCharacterCount ?? 0,
    getToolPayloadCharacterCount(tool)
  )
  const before = budget.remaining
  const structuralTruncation = {
    occurred: false,
    remainingEntries: rendererRawCollectionEntryLimit
  }
  const command = truncateText(tool.command, budget)
  const stdout = truncateText(tool.stdout, budget)
  const sourceDiffs = tool.diffs.slice(-rendererToolDiffLimit)
  const diffs = sourceDiffs.map((diff) => ({
    ...diff,
    diff: truncateText(diff.diff, budget) ?? ''
  }))
  const rawInput = truncateUnknown(tool.rawInput, budget, structuralTruncation)
  const rawOutput = truncateUnknown(tool.rawOutput, budget, structuralTruncation)
  const sourceImages = tool.images.slice(-rendererToolImageLimit)
  const images = sourceImages.map((image) => ({
    ...image,
    dataUrl: truncateText(image.dataUrl ?? null, budget)
  }))

  return {
    ...tool,
    command,
    stdout,
    diffs,
    diffCount: Math.max(tool.diffCount ?? 0, tool.diffs.length),
    diffsStartIndex:
      (tool.diffsStartIndex ?? 0) + Math.max(0, tool.diffs.length - sourceDiffs.length),
    rawInput,
    rawOutput,
    images,
    imageCount: Math.max(tool.imageCount ?? 0, tool.images.length),
    imagesStartIndex:
      (tool.imagesStartIndex ?? 0) + Math.max(0, tool.images.length - sourceImages.length),
    payloadLoaded: true,
    payloadCharacterCount,
    payloadTruncated:
      payloadCharacterCount > before ||
      sourceDiffs.length < tool.diffs.length ||
      sourceImages.length < tool.images.length ||
      structuralTruncation.occurred
  }
}

export const limitWorkingItemPayload = (
  item: ProviderWorkingItem,
  characterLimit = rendererWorkingItemPayloadPreviewCharacters
): ProviderWorkingItem => {
  const budget = { remaining: Math.max(0, characterLimit) }
  const payloadCharacterCount = getWorkingItemPayloadCharacterCount(item)

  if (item.type === 'message') {
    return {
      ...item,
      content: truncateText(item.content, budget) ?? '',
      contentLoaded: true,
      contentCharacterCount: payloadCharacterCount,
      contentTruncated: payloadCharacterCount > characterLimit
    }
  }
  if (item.type === 'toolGroup') {
    const sourceTools = item.tools.slice(-rendererWorkingToolGroupLimit)
    const toolCount = Math.max(item.toolCount ?? 0, item.tools.length)
    const sourceStartIndex = item.toolsStartIndex ?? Math.max(0, toolCount - item.tools.length)
    return {
      ...item,
      tools: sourceTools.map((tool) => limitToolPayload(tool, budget)),
      toolCount,
      toolsStartIndex: sourceStartIndex + Math.max(0, item.tools.length - sourceTools.length)
    }
  }
  return limitToolPayload(item, budget)
}

const getDominantToolActivity = (tools: ProviderWorkingTool[]): ProviderWorkingTool['activity'] => {
  const counts = new Map<ProviderWorkingTool['activity'], number>()
  tools.forEach((tool) => counts.set(tool.activity, (counts.get(tool.activity) ?? 0) + 1))
  const highestCount = Math.max(0, ...counts.values())
  return tools.find((tool) => counts.get(tool.activity) === highestCount)?.activity ?? 'other'
}

const createToolSequence = (
  items: Exclude<ProviderWorkingItem, { type: 'message' }>[]
): ProviderWorkingToolGroup => {
  const tools = items.flatMap((item) => (item.type === 'toolGroup' ? item.tools : [item]))
  const firstItem = items[0]
  const singleExistingGroup = items.length === 1 && firstItem?.type === 'toolGroup'
  const firstId = firstItem?.id ?? 'empty'
  const id = singleExistingGroup
    ? firstId
    : firstId.startsWith(rendererToolSequenceIdPrefix)
      ? firstId
      : `${rendererToolSequenceIdPrefix}${firstId}`
  const toolActivities = [
    ...new Set(
      items.flatMap((item) =>
        item.type === 'toolGroup' && item.toolActivities?.length
          ? item.toolActivities
          : item.type === 'toolGroup'
            ? item.tools.map((tool) => tool.activity)
            : [item.activity]
      )
    )
  ]
  const toolCount = items.reduce(
    (count, item) =>
      count + (item.type === 'toolGroup' ? Math.max(item.toolCount ?? 0, item.tools.length) : 1),
    0
  )

  return {
    type: 'toolGroup' as const,
    id,
    label: singleExistingGroup ? firstItem.label : '',
    tools,
    toolCount,
    toolsStartIndex: singleExistingGroup ? (firstItem.toolsStartIndex ?? 0) : 0,
    toolActivities,
    dominantActivity:
      singleExistingGroup && firstItem.dominantActivity
        ? firstItem.dominantActivity
        : getDominantToolActivity(tools)
  }
}

export const groupWorkingItemsForRenderer = (
  items: ProviderWorkingItem[]
): ProviderWorkingItem[] => {
  const groupedItems: ProviderWorkingItem[] = []
  let pendingTools: Exclude<ProviderWorkingItem, { type: 'message' }>[] = []
  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    groupedItems.push(
      pendingTools.length === 1 && pendingTools[0]?.type === 'tool'
        ? pendingTools[0]
        : createToolSequence(pendingTools)
    )
    pendingTools = []
  }

  items.forEach((item) => {
    if (item.type === 'message') {
      flushTools()
      groupedItems.push(item)
    } else if (item.type === 'tool' && item.compact) {
      flushTools()
      groupedItems.push(item)
    } else {
      pendingTools.push(item)
    }
  })
  flushTools()
  return groupedItems
}

export const groupWorkingStepItems = (step: ProviderWorkingStep): ProviderWorkingStep => {
  if (
    step.itemsLoaded === false ||
    step.itemSegments?.length ||
    (step.itemsStartIndex ?? 0) > 0 ||
    (step.itemCount ?? step.items.length) > step.items.length
  ) {
    return step
  }

  const groupedItems = groupWorkingItemsForRenderer(step.items)

  const unchanged =
    groupedItems.length === step.items.length &&
    groupedItems.every((item, index) => item === step.items[index])
  if (unchanged && step.itemCount === groupedItems.length && step.itemsStartIndex === 0) return step

  const stepWithoutSegments = { ...step }
  delete stepWithoutSegments.itemSegments
  return {
    ...stepWithoutSegments,
    items: groupedItems,
    itemCount: groupedItems.length,
    itemsStartIndex: 0
  }
}

export const unloadWorkingStep = (step: ProviderWorkingStep): ProviderWorkingStep => {
  const stepWithoutSegments = { ...step }
  delete stepWithoutSegments.itemSegments
  return {
    ...stepWithoutSegments,
    items: [],
    itemsLoaded: false,
    itemCount:
      step.itemsLoaded === false
        ? step.itemCount
        : Math.max(step.itemCount ?? 0, step.items.length),
    itemsStartIndex: 0
  }
}

export const prepareWorkingStepPage = (
  step: ProviderWorkingStep,
  startIndex: number,
  limit: number
): ProviderWorkingStepPage => {
  const groupedStep = groupWorkingStepItems(step)
  const totalCount =
    groupedStep.itemsLoaded === false
      ? (groupedStep.itemCount ?? 0)
      : Math.max(groupedStep.itemCount ?? 0, groupedStep.items.length)
  const boundedLimit = Math.max(1, Math.min(limit, rendererWorkingItemWindowSize))
  const requestedStartIndex = Math.max(0, Math.min(startIndex, totalCount))
  // An unloaded renderer shell can briefly have a stale count while the provider rebuilds its
  // authoritative history. Treat a request at/past EOF as "latest" so opening the section cannot
  // resolve to an empty page when activity still exists.
  const boundedStartIndex =
    totalCount > 0 && requestedStartIndex >= totalCount
      ? Math.max(0, totalCount - boundedLimit)
      : requestedStartIndex
  const sourceStartIndex =
    groupedStep.itemsLoaded === false ? 0 : (groupedStep.itemsStartIndex ?? 0)
  const relativeStartIndex = Math.max(0, boundedStartIndex - sourceStartIndex)
  const sourceItems = groupedStep.items.slice(relativeStartIndex, relativeStartIndex + boundedLimit)
  let remainingPayloadCharacters = rendererWorkingPagePayloadBudgetCharacters
  const items = sourceItems.map((item) => {
    const payloadCharacterCount = getWorkingItemPayloadCharacterCount(item)
    if (payloadCharacterCount > remainingPayloadCharacters) return unloadWorkingItemPayload(item)
    if (item.type === 'message') {
      remainingPayloadCharacters -= payloadCharacterCount
      return item
    }
    const limitedItem = limitWorkingItemPayload(item, remainingPayloadCharacters)
    remainingPayloadCharacters = Math.max(
      0,
      remainingPayloadCharacters - getWorkingItemPayloadCharacterCount(limitedItem)
    )
    return limitedItem
  })

  return {
    workingStepId: groupedStep.id,
    status: groupedStep.status,
    items,
    startIndex: boundedStartIndex,
    totalCount
  }
}

export const prepareWorkingToolPage = (
  step: ProviderWorkingStep,
  workingItemId: string,
  startIndex: number,
  limit: number
): ProviderWorkingToolPage => {
  const groupedStep = groupWorkingStepItems(step)
  const workingItem = groupedStep.items.find(
    (item) => item.type === 'toolGroup' && item.id === workingItemId
  )
  if (!workingItem || workingItem.type !== 'toolGroup') {
    throw new Error('Working tool sequence not found')
  }

  const totalCount = Math.max(workingItem.toolCount ?? 0, workingItem.tools.length)
  const boundedLimit = Math.max(1, Math.min(limit, rendererWorkingToolWindowSize))
  const requestedStartIndex = Math.max(0, Math.min(startIndex, totalCount))
  const boundedStartIndex =
    totalCount > 0 && requestedStartIndex >= totalCount
      ? Math.max(0, totalCount - boundedLimit)
      : requestedStartIndex
  const sourceStartIndex = workingItem.toolsStartIndex ?? 0
  const relativeStartIndex = Math.max(0, boundedStartIndex - sourceStartIndex)
  const sourceTools = workingItem.tools.slice(relativeStartIndex, relativeStartIndex + boundedLimit)
  const limitedGroup = limitWorkingItemPayload(
    {
      ...workingItem,
      tools: sourceTools,
      toolCount: totalCount,
      toolsStartIndex: boundedStartIndex
    },
    rendererWorkingPagePayloadBudgetCharacters
  )

  return {
    workingStepId: groupedStep.id,
    workingItemId,
    tools: limitedGroup.type === 'toolGroup' ? limitedGroup.tools : [],
    startIndex: boundedStartIndex,
    totalCount
  }
}

const prepareLatestWorkingStep = (step: ProviderWorkingStep): ProviderWorkingStep => {
  const groupedStep = groupWorkingStepItems(step)
  if (groupedStep.itemsLoaded === false) return groupedStep
  const totalCount = Math.max(groupedStep.itemCount ?? 0, groupedStep.items.length)
  const startIndex = Math.max(0, totalCount - rendererWorkingItemPageSize)
  const page = prepareWorkingStepPage(groupedStep, startIndex, rendererWorkingItemPageSize)
  return {
    ...groupedStep,
    items: page.items,
    itemsLoaded: true,
    itemCount: page.totalCount,
    itemsStartIndex: page.startIndex
  }
}

export const unloadHistoricalWorkingSteps = (detail: ProviderChatDetail): ProviderChatDetail => {
  const latestWorkingStepIndex = detail.items.findLastIndex((item) => item.type === 'working')
  if (latestWorkingStepIndex < 0) return detail

  let changed = false
  const items = detail.items.map((item, index) => {
    if (item.type !== 'working') return item

    const groupedItem = groupWorkingStepItems(item)
    const itemCount = Math.max(groupedItem.itemCount ?? 0, groupedItem.items.length)
    const nextItem =
      index === latestWorkingStepIndex || itemCount <= rendererHistoricalWorkingItemLazyThreshold
        ? prepareLatestWorkingStep(groupedItem)
        : unloadWorkingStep(groupedItem)
    if (
      nextItem.items !== item.items ||
      nextItem.itemsLoaded !== item.itemsLoaded ||
      nextItem.itemsStartIndex !== item.itemsStartIndex
    ) {
      changed = true
    }
    return nextItem
  })

  return changed ? { ...detail, items } : detail
}
