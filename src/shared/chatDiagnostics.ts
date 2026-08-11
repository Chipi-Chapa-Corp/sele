import type { ProviderChatItem, ProviderWorkingItem, ProviderWorkingTool } from './provider'

export type ProviderChatPayloadCharacterCounts = {
  messageContent: number
  messageAttachments: number
  workingMessages: number
  toolCommands: number
  toolOutput: number
  toolDiffs: number
  rawToolValues: number
  toolImages: number
}

export type ProviderChatDiagnostics = {
  topLevelItemCount: number
  turnCount: number
  workingStepCount: number
  loadedWorkingStepCount: number
  retainedWorkingItemCount: number
  knownWorkingItemCount: number
  toolCount: number
  payloadCharacterCount: number
  payloadCharacters: ProviderChatPayloadCharacterCounts
  maxTurnTopLevelItemCount: number
  maxTurnRetainedWorkingItemCount: number
  maxTurnKnownWorkingItemCount: number
  maxTurnToolCount: number
  maxTurnPayloadCharacterCount: number
}

type MutableChatDiagnostics = Omit<
  ProviderChatDiagnostics,
  | 'topLevelItemCount'
  | 'turnCount'
  | 'payloadCharacterCount'
  | 'maxTurnTopLevelItemCount'
  | 'maxTurnRetainedWorkingItemCount'
  | 'maxTurnKnownWorkingItemCount'
  | 'maxTurnToolCount'
  | 'maxTurnPayloadCharacterCount'
> & {
  payloadCharacterCount: number
}

const createPayloadCharacterCounts = (): ProviderChatPayloadCharacterCounts => ({
  messageContent: 0,
  messageAttachments: 0,
  workingMessages: 0,
  toolCommands: 0,
  toolOutput: 0,
  toolDiffs: 0,
  rawToolValues: 0,
  toolImages: 0
})

const createMutableChatDiagnostics = (): MutableChatDiagnostics => ({
  workingStepCount: 0,
  loadedWorkingStepCount: 0,
  retainedWorkingItemCount: 0,
  knownWorkingItemCount: 0,
  toolCount: 0,
  payloadCharacterCount: 0,
  payloadCharacters: createPayloadCharacterCounts()
})

const addCount = (current: number, value: number): number =>
  Math.min(Number.MAX_SAFE_INTEGER, current + value)

const addPayloadCharacters = (
  diagnostics: MutableChatDiagnostics,
  category: keyof ProviderChatPayloadCharacterCounts,
  value: number
): void => {
  diagnostics.payloadCharacters[category] = addCount(diagnostics.payloadCharacters[category], value)
  diagnostics.payloadCharacterCount = addCount(diagnostics.payloadCharacterCount, value)
}

const countStringCharacters = (value: unknown, seen = new WeakSet<object>()): number => {
  if (typeof value === 'string') return value.length
  if (!value || typeof value !== 'object' || seen.has(value)) return 0

  seen.add(value)
  const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return values.reduce((total, entry) => addCount(total, countStringCharacters(entry, seen)), 0)
}

const addToolDiagnostics = (
  diagnostics: MutableChatDiagnostics,
  tool: ProviderWorkingTool
): void => {
  diagnostics.toolCount = addCount(diagnostics.toolCount, 1)
  addPayloadCharacters(
    diagnostics,
    'toolCommands',
    (tool.command?.length ?? 0) + (tool.cwd?.length ?? 0)
  )
  addPayloadCharacters(diagnostics, 'toolOutput', tool.stdout?.length ?? 0)
  addPayloadCharacters(
    diagnostics,
    'toolDiffs',
    tool.diffs.reduce((total, diff) => addCount(total, diff.path.length + diff.diff.length), 0)
  )
  addPayloadCharacters(
    diagnostics,
    'rawToolValues',
    addCount(countStringCharacters(tool.rawInput), countStringCharacters(tool.rawOutput))
  )
  addPayloadCharacters(
    diagnostics,
    'toolImages',
    tool.images.reduce(
      (total, image) =>
        addCount(
          total,
          (image.path?.length ?? 0) + (image.dataUrl?.length ?? 0) + (image.name?.length ?? 0)
        ),
      0
    )
  )
}

const addWorkingItemDiagnostics = (
  diagnostics: MutableChatDiagnostics,
  item: ProviderWorkingItem
): void => {
  if (item.type === 'message') {
    addPayloadCharacters(diagnostics, 'workingMessages', item.content.length)
    return
  }

  if (item.type === 'toolGroup') {
    item.tools.forEach((tool) => addToolDiagnostics(diagnostics, tool))
    return
  }

  addToolDiagnostics(diagnostics, item)
}

const addItemDiagnostics = (diagnostics: MutableChatDiagnostics, item: ProviderChatItem): void => {
  if (item.type === 'message' || item.type === 'pendingMessage') {
    addPayloadCharacters(diagnostics, 'messageContent', item.content.length)
    addPayloadCharacters(diagnostics, 'messageAttachments', countStringCharacters(item.attachments))
    return
  }
  if (item.type !== 'working') return

  diagnostics.workingStepCount = addCount(diagnostics.workingStepCount, 1)
  const retainedItemCount = item.items.length
  const knownItemCount =
    item.itemsLoaded === false
      ? Math.max(retainedItemCount, item.itemCount ?? 0)
      : retainedItemCount
  diagnostics.retainedWorkingItemCount = addCount(
    diagnostics.retainedWorkingItemCount,
    retainedItemCount
  )
  diagnostics.knownWorkingItemCount = addCount(diagnostics.knownWorkingItemCount, knownItemCount)
  if (item.itemsLoaded !== false) {
    diagnostics.loadedWorkingStepCount = addCount(diagnostics.loadedWorkingStepCount, 1)
  }
  item.items.forEach((workingItem) => addWorkingItemDiagnostics(diagnostics, workingItem))
}

const mergeDiagnostics = (target: MutableChatDiagnostics, source: MutableChatDiagnostics): void => {
  target.workingStepCount = addCount(target.workingStepCount, source.workingStepCount)
  target.loadedWorkingStepCount = addCount(
    target.loadedWorkingStepCount,
    source.loadedWorkingStepCount
  )
  target.retainedWorkingItemCount = addCount(
    target.retainedWorkingItemCount,
    source.retainedWorkingItemCount
  )
  target.knownWorkingItemCount = addCount(
    target.knownWorkingItemCount,
    source.knownWorkingItemCount
  )
  target.toolCount = addCount(target.toolCount, source.toolCount)
  target.payloadCharacterCount = addCount(
    target.payloadCharacterCount,
    source.payloadCharacterCount
  )
  for (const category of Object.keys(target.payloadCharacters) as Array<
    keyof ProviderChatPayloadCharacterCounts
  >) {
    target.payloadCharacters[category] = addCount(
      target.payloadCharacters[category],
      source.payloadCharacters[category]
    )
  }
}

export const getProviderChatDiagnostics = (items: ProviderChatItem[]): ProviderChatDiagnostics => {
  const totals = createMutableChatDiagnostics()
  let turnCount = 0
  let maxTurnTopLevelItemCount = 0
  let maxTurnRetainedWorkingItemCount = 0
  let maxTurnKnownWorkingItemCount = 0
  let maxTurnToolCount = 0
  let maxTurnPayloadCharacterCount = 0
  let turnTopLevelItemCount = 0
  let turnDiagnostics = createMutableChatDiagnostics()

  const finishTurn = (): void => {
    if (turnTopLevelItemCount === 0) return
    turnCount += 1
    mergeDiagnostics(totals, turnDiagnostics)
    maxTurnTopLevelItemCount = Math.max(maxTurnTopLevelItemCount, turnTopLevelItemCount)
    maxTurnRetainedWorkingItemCount = Math.max(
      maxTurnRetainedWorkingItemCount,
      turnDiagnostics.retainedWorkingItemCount
    )
    maxTurnKnownWorkingItemCount = Math.max(
      maxTurnKnownWorkingItemCount,
      turnDiagnostics.knownWorkingItemCount
    )
    maxTurnToolCount = Math.max(maxTurnToolCount, turnDiagnostics.toolCount)
    maxTurnPayloadCharacterCount = Math.max(
      maxTurnPayloadCharacterCount,
      turnDiagnostics.payloadCharacterCount
    )
    turnTopLevelItemCount = 0
    turnDiagnostics = createMutableChatDiagnostics()
  }

  for (const item of items) {
    const startsTurn =
      item.type === 'pendingMessage' || (item.type === 'message' && item.role === 'user')
    if (startsTurn && turnTopLevelItemCount > 0) finishTurn()
    turnTopLevelItemCount += 1
    addItemDiagnostics(turnDiagnostics, item)
  }
  finishTurn()

  return {
    topLevelItemCount: items.length,
    turnCount,
    ...totals,
    maxTurnTopLevelItemCount,
    maxTurnRetainedWorkingItemCount,
    maxTurnKnownWorkingItemCount,
    maxTurnToolCount,
    maxTurnPayloadCharacterCount
  }
}
