import type {
  ProviderChatDetail,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingStepPage,
  ProviderWorkingTool
} from '../../shared/provider'

export const rendererWorkingItemPageSize = 50
export const rendererWorkingItemWindowSize = rendererWorkingItemPageSize * 2
export const rendererWorkingPagePayloadBudgetCharacters = 2_000_000
export const rendererWorkingItemPayloadPreviewCharacters = 256_000
export const rendererWorkingToolGroupLimit = 50
export const rendererToolDiffLimit = 200
export const rendererToolImageLimit = 50
const rendererRawCollectionEntryLimit = 200
const rendererRawValueDepthLimit = 8
const rendererPayloadCountEntryLimit = 10_000

const truncatedPayloadMarker = '\n… [truncated to keep the app responsive]'

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

export const unloadWorkingStep = (step: ProviderWorkingStep): ProviderWorkingStep => ({
  ...step,
  items: [],
  itemsLoaded: false,
  itemCount:
    step.itemsLoaded === false ? step.itemCount : Math.max(step.itemCount ?? 0, step.items.length),
  itemsStartIndex: 0
})

export const prepareWorkingStepPage = (
  step: ProviderWorkingStep,
  startIndex: number,
  limit: number
): ProviderWorkingStepPage => {
  const totalCount =
    step.itemsLoaded === false
      ? (step.itemCount ?? 0)
      : Math.max(step.itemCount ?? 0, step.items.length)
  const boundedStartIndex = Math.max(0, Math.min(startIndex, totalCount))
  const boundedLimit = Math.max(1, Math.min(limit, rendererWorkingItemWindowSize))
  const sourceStartIndex = step.itemsLoaded === false ? 0 : (step.itemsStartIndex ?? 0)
  const relativeStartIndex = Math.max(0, boundedStartIndex - sourceStartIndex)
  const sourceItems = step.items.slice(relativeStartIndex, relativeStartIndex + boundedLimit)
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
    workingStepId: step.id,
    status: step.status,
    items,
    startIndex: boundedStartIndex,
    totalCount
  }
}

const prepareLatestWorkingStep = (step: ProviderWorkingStep): ProviderWorkingStep => {
  if (step.itemsLoaded === false) return step
  const totalCount = Math.max(step.itemCount ?? 0, step.items.length)
  const startIndex = Math.max(0, totalCount - rendererWorkingItemPageSize)
  const page = prepareWorkingStepPage(step, startIndex, rendererWorkingItemPageSize)
  return {
    ...step,
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

    const nextItem =
      index === latestWorkingStepIndex ? prepareLatestWorkingStep(item) : unloadWorkingStep(item)
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
