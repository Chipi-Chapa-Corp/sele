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

  const itemIndexesById = previousModel.itemIndexesById as Map<string, number>
  const itemIds = previousModel.itemIds as Set<string>
  const stoppedTurnRetryMessages = previousModel.stoppedTurnRetryMessages as Map<
    string,
    ProviderMessage
  >
  const workingStepIdsWithNextWorkingStep =
    previousModel.workingStepIdsWithNextWorkingStep as Set<string>
  const followingWorkingStepsById = previousModel.followingWorkingStepsById as Map<
    string,
    FollowingWorkingStep
  >
  const turns = previousModel.turns
  const oldSuffix = internals.sourceItems.slice(rebuildStart.itemIndex)
  const newSuffix = items.slice(rebuildStart.itemIndex)

  let firstAffectedWorkingStepIndex = internals.workingSteps.length
  for (const item of oldSuffix) {
    itemIndexesById.delete(item.id)
    itemIds.delete(item.id)
    internals.turnIndexByItemId.delete(item.id)
    if (item.type === 'working') {
      stoppedTurnRetryMessages.delete(item.id)
      firstAffectedWorkingStepIndex = Math.min(
        firstAffectedWorkingStepIndex,
        internals.workingStepIndexById.get(item.id) ?? firstAffectedWorkingStepIndex
      )
      internals.workingStepIndexById.delete(item.id)
    }
  }

  const oldWorkingSteps = internals.workingSteps.slice(firstAffectedWorkingStepIndex)
  internals.workingSteps.splice(firstAffectedWorkingStepIndex)
  for (const item of newSuffix) {
    if (item.type !== 'working') continue
    internals.workingStepIndexById.set(item.id, internals.workingSteps.length)
    internals.workingSteps.push(item)
  }

  const workingRelationshipStartIndex = Math.max(0, firstAffectedWorkingStepIndex - 2)
  for (const step of oldWorkingSteps) {
    workingStepIdsWithNextWorkingStep.delete(step.id)
    followingWorkingStepsById.delete(step.id)
  }
  for (
    let index = workingRelationshipStartIndex;
    index < internals.workingSteps.length;
    index += 1
  ) {
    const step = internals.workingSteps[index]
    workingStepIdsWithNextWorkingStep.delete(step.id)
    followingWorkingStepsById.delete(step.id)
    const nextStep = internals.workingSteps[index + 1]
    if (!nextStep) continue
    workingStepIdsWithNextWorkingStep.add(step.id)
    followingWorkingStepsById.set(step.id, {
      hasNextWorkingStep: index + 2 < internals.workingSteps.length,
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
    internals.turnIndexByItemId.set(item.id, turns.length)
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
  internals.sourceItems = items
  modelInternals.set(model, internals)
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
