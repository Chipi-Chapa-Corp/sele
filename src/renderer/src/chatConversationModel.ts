import type { ProviderChatItem, ProviderMessage, ProviderWorkingStep } from '../../shared/provider'
import type { ProviderChatTurn } from '../../shared/chatTurns'

export type FollowingWorkingStep = {
  hasNextWorkingStep: boolean
  status: ProviderWorkingStep['status']
}

export type ChatConversationModel = {
  firstPendingItemId: string | null
  followingWorkingStepsById: ReadonlyMap<string, FollowingWorkingStep>
  itemIndexesById: ReadonlyMap<string, number>
  itemIds: ReadonlySet<string>
  lastNonPendingItem: ProviderChatItem | null
  stoppedTurnRetryMessages: ReadonlyMap<string, ProviderMessage>
  turns: ProviderChatTurn[]
  workingStepIdsWithNextWorkingStep: ReadonlySet<string>
}

type ChatConversationModelInternals = {
  sourceItems: readonly ProviderChatItem[]
  turnIndexByItemId: Map<string, number>
  workingStepIndexById: Map<string, number>
  workingSteps: ProviderWorkingStep[]
}

type ChatItemsChange = {
  previousItems: readonly ProviderChatItem[] | null
  startIndex: number
}

const chatItemsChanges = new WeakMap<readonly ProviderChatItem[], ChatItemsChange>()
const modelsByItems = new WeakMap<readonly ProviderChatItem[], ChatConversationModel>()
const modelInternals = new WeakMap<ChatConversationModel, ChatConversationModelInternals>()

const startsChatTurn = (item: ProviderChatItem): boolean =>
  item.type === 'pendingMessage' || (item.type === 'message' && item.role === 'user')

export const getConversationTailWorkingStep = (
  items: readonly ProviderChatItem[]
): ProviderWorkingStep | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.type === 'working' && item.status === 'working') return item
  }

  return null
}

export const markChatItemsChanged = (
  items: ProviderChatItem[],
  startIndex: number,
  previousItems: readonly ProviderChatItem[] | null = null
): void => {
  if (Number.isSafeInteger(startIndex) && startIndex >= 0 && startIndex <= items.length) {
    chatItemsChanges.set(items, { previousItems, startIndex })
  }
}

const buildFullChatConversationModel = (
  items: readonly ProviderChatItem[]
): ChatConversationModel => {
  const turns: ProviderChatTurn[] = []
  const itemIndexesById = new Map<string, number>()
  const itemIds = new Set<string>()
  const stoppedTurnRetryMessages = new Map<string, ProviderMessage>()
  const workingStepIdsWithNextWorkingStep = new Set<string>()
  const followingWorkingStepsById = new Map<string, FollowingWorkingStep>()
  const turnIndexByItemId = new Map<string, number>()
  const workingStepIndexById = new Map<string, number>()
  const workingSteps: ProviderWorkingStep[] = []
  let firstPendingItemId: string | null = null
  let lastNonPendingItem: ProviderChatItem | null = null
  let currentTurnItems: ProviderChatItem[] = []
  let currentTurnUserMessage: ProviderMessage | null = null

  const finishTurn = (): void => {
    const firstItem = currentTurnItems[0]
    if (!firstItem) return
    turns.push({ id: firstItem.id, items: currentTurnItems })
    currentTurnItems = []
  }

  items.forEach((item, itemIndex) => {
    if (startsChatTurn(item)) {
      if (currentTurnItems.length > 0) finishTurn()
      currentTurnUserMessage = item.type === 'message' ? item : null
    }
    currentTurnItems.push(item)
    itemIndexesById.set(item.id, itemIndex)
    itemIds.add(item.id)
    turnIndexByItemId.set(item.id, turns.length)

    if (item.type === 'pendingMessage') {
      firstPendingItemId ??= item.id
    } else {
      lastNonPendingItem = item
    }

    if (item.type !== 'working') return

    const workingStepIndex = workingSteps.length
    const previousWorkingStep = workingSteps[workingStepIndex - 1]
    const previousPreviousWorkingStep = workingSteps[workingStepIndex - 2]
    workingSteps.push(item)
    workingStepIndexById.set(item.id, workingStepIndex)

    if (previousWorkingStep) {
      workingStepIdsWithNextWorkingStep.add(previousWorkingStep.id)
      followingWorkingStepsById.set(previousWorkingStep.id, {
        hasNextWorkingStep: false,
        status: item.status
      })
    }
    if (previousPreviousWorkingStep) {
      followingWorkingStepsById.set(previousPreviousWorkingStep.id, {
        hasNextWorkingStep: true,
        status: previousWorkingStep.status
      })
    }

    if (
      (item.status === 'stopped' ||
        (item.status === 'failed' && item.failureReason === 'rateLimit')) &&
      currentTurnUserMessage
    ) {
      stoppedTurnRetryMessages.set(item.id, currentTurnUserMessage)
    }
  })
  finishTurn()

  const model: ChatConversationModel = {
    firstPendingItemId,
    followingWorkingStepsById,
    itemIndexesById,
    itemIds,
    lastNonPendingItem,
    stoppedTurnRetryMessages,
    turns,
    workingStepIdsWithNextWorkingStep
  }
  modelInternals.set(model, {
    sourceItems: items,
    turnIndexByItemId,
    workingStepIndexById,
    workingSteps
  })
  modelsByItems.set(items, model)
  return model
}

const getIncrementalRebuildStart = (
  items: readonly ProviderChatItem[],
  previousModel: ChatConversationModel,
  internals: ChatConversationModelInternals,
  changedStartIndex: number
): { itemIndex: number; turnIndex: number } | null => {
  if (
    changedStartIndex < 0 ||
    changedStartIndex > items.length ||
    changedStartIndex > internals.sourceItems.length
  ) {
    return null
  }
  if (
    changedStartIndex > 0 &&
    internals.sourceItems[changedStartIndex - 1]?.id !== items[changedStartIndex - 1]?.id
  ) {
    return null
  }

  const previousChangedItem = internals.sourceItems[changedStartIndex]
  if (previousChangedItem) {
    const turnIndex = internals.turnIndexByItemId.get(previousChangedItem.id)
    const firstTurnItem = turnIndex === undefined ? null : previousModel.turns[turnIndex]?.items[0]
    const itemIndex = firstTurnItem
      ? previousModel.itemIndexesById.get(firstTurnItem.id)
      : undefined
    return turnIndex === undefined || itemIndex === undefined ? null : { itemIndex, turnIndex }
  }

  const firstNewItem = items[changedStartIndex]
  if (firstNewItem && !startsChatTurn(firstNewItem) && previousModel.turns.length > 0) {
    const turnIndex = previousModel.turns.length - 1
    const firstTurnItem = previousModel.turns[turnIndex].items[0]
    const itemIndex = firstTurnItem
      ? previousModel.itemIndexesById.get(firstTurnItem.id)
      : undefined
    return itemIndex === undefined ? null : { itemIndex, turnIndex }
  }

  return { itemIndex: changedStartIndex, turnIndex: previousModel.turns.length }
}

const buildIncrementalChatConversationModel = (
  items: readonly ProviderChatItem[],
  previousModel: ChatConversationModel,
  internals: ChatConversationModelInternals,
  changedStartIndex: number
): ChatConversationModel | null => {
  const rebuildStart = getIncrementalRebuildStart(
    items,
    previousModel,
    internals,
    changedStartIndex
  )
  if (!rebuildStart) return null

  // React may abandon a concurrent render. Mutating the previous memoized model here used to
  // corrupt the still-visible conversation even though the new render never committed.
  const itemIndexesById = new Map(previousModel.itemIndexesById)
  const itemIds = new Set(previousModel.itemIds)
  const stoppedTurnRetryMessages = new Map(previousModel.stoppedTurnRetryMessages)
  const workingStepIdsWithNextWorkingStep = new Set(previousModel.workingStepIdsWithNextWorkingStep)
  const followingWorkingStepsById = new Map(previousModel.followingWorkingStepsById)
  const turns = [...previousModel.turns]
  const nextInternals: ChatConversationModelInternals = {
    sourceItems: internals.sourceItems,
    turnIndexByItemId: new Map(internals.turnIndexByItemId),
    workingStepIndexById: new Map(internals.workingStepIndexById),
    workingSteps: [...internals.workingSteps]
  }
  const oldSuffix = nextInternals.sourceItems.slice(rebuildStart.itemIndex)
  const newSuffix = items.slice(rebuildStart.itemIndex)

  let firstAffectedWorkingStepIndex = nextInternals.workingSteps.length
  for (const item of oldSuffix) {
    itemIndexesById.delete(item.id)
    itemIds.delete(item.id)
    nextInternals.turnIndexByItemId.delete(item.id)
    if (item.type === 'working') {
      stoppedTurnRetryMessages.delete(item.id)
      firstAffectedWorkingStepIndex = Math.min(
        firstAffectedWorkingStepIndex,
        nextInternals.workingStepIndexById.get(item.id) ?? firstAffectedWorkingStepIndex
      )
      nextInternals.workingStepIndexById.delete(item.id)
    }
  }

  const oldWorkingSteps = nextInternals.workingSteps.slice(firstAffectedWorkingStepIndex)
  nextInternals.workingSteps.splice(firstAffectedWorkingStepIndex)
  for (const item of newSuffix) {
    if (item.type !== 'working') continue
    nextInternals.workingStepIndexById.set(item.id, nextInternals.workingSteps.length)
    nextInternals.workingSteps.push(item)
  }

  const workingRelationshipStartIndex = Math.max(0, firstAffectedWorkingStepIndex - 2)
  for (const step of oldWorkingSteps) {
    workingStepIdsWithNextWorkingStep.delete(step.id)
    followingWorkingStepsById.delete(step.id)
  }
  for (
    let index = workingRelationshipStartIndex;
    index < nextInternals.workingSteps.length;
    index += 1
  ) {
    const step = nextInternals.workingSteps[index]
    workingStepIdsWithNextWorkingStep.delete(step.id)
    followingWorkingStepsById.delete(step.id)
    const nextStep = nextInternals.workingSteps[index + 1]
    if (!nextStep) continue
    workingStepIdsWithNextWorkingStep.add(step.id)
    followingWorkingStepsById.set(step.id, {
      hasNextWorkingStep: index + 2 < nextInternals.workingSteps.length,
      status: nextStep.status
    })
  }

  turns.splice(rebuildStart.turnIndex)
  let currentTurnItems: ProviderChatItem[] = []
  let currentTurnUserMessage: ProviderMessage | null = null
  const finishTurn = (): void => {
    const firstItem = currentTurnItems[0]
    if (!firstItem) return
    turns.push({ id: firstItem.id, items: currentTurnItems })
    currentTurnItems = []
  }

  newSuffix.forEach((item, suffixIndex) => {
    if (startsChatTurn(item)) {
      if (currentTurnItems.length > 0) finishTurn()
      currentTurnUserMessage = item.type === 'message' ? item : null
    }
    currentTurnItems.push(item)
    const itemIndex = rebuildStart.itemIndex + suffixIndex
    itemIndexesById.set(item.id, itemIndex)
    itemIds.add(item.id)
    nextInternals.turnIndexByItemId.set(item.id, turns.length)
    if (
      item.type === 'working' &&
      (item.status === 'stopped' ||
        (item.status === 'failed' && item.failureReason === 'rateLimit')) &&
      currentTurnUserMessage
    ) {
      stoppedTurnRetryMessages.set(item.id, currentTurnUserMessage)
    }
  })
  finishTurn()

  const previousFirstPendingIndex = previousModel.firstPendingItemId
    ? previousModel.itemIndexesById.get(previousModel.firstPendingItemId)
    : undefined
  const firstPendingItemId =
    previousFirstPendingIndex !== undefined && previousFirstPendingIndex < rebuildStart.itemIndex
      ? previousModel.firstPendingItemId
      : (newSuffix.find((item) => item.type === 'pendingMessage')?.id ?? null)
  let lastNonPendingItem: ProviderChatItem | null = null
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].type === 'pendingMessage') continue
    lastNonPendingItem = items[index]
    break
  }

  const model: ChatConversationModel = {
    firstPendingItemId,
    followingWorkingStepsById,
    itemIndexesById,
    itemIds,
    lastNonPendingItem,
    stoppedTurnRetryMessages,
    turns,
    workingStepIdsWithNextWorkingStep
  }
  nextInternals.sourceItems = items
  modelInternals.set(model, nextInternals)
  modelsByItems.set(items, model)
  return model
}

export const buildChatConversationModel = (
  items: readonly ProviderChatItem[],
  previousModel?: ChatConversationModel | null
): ChatConversationModel => {
  const existingModel = modelsByItems.get(items)
  if (existingModel) return existingModel

  const change = chatItemsChanges.get(items)
  chatItemsChanges.delete(items)
  const resolvedPreviousModel =
    previousModel ?? (change?.previousItems ? modelsByItems.get(change.previousItems) : null)
  if (resolvedPreviousModel && change) {
    const internals = modelInternals.get(resolvedPreviousModel)
    if (internals) {
      const incrementalModel = buildIncrementalChatConversationModel(
        items,
        resolvedPreviousModel,
        internals,
        change.startIndex
      )
      if (incrementalModel) {
        if (change.previousItems) modelsByItems.delete(change.previousItems)
        return incrementalModel
      }
    }
  }

  return buildFullChatConversationModel(items)
}
