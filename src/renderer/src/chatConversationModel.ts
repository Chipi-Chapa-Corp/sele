import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderWorkingStep
} from '../../shared/provider'
import { startsProviderChatTurn, type ProviderChatTurn } from '../../shared/chatTurns.ts'
import {
  getSteeredWorkingStepDisclosureTargets,
  type WorkingStepDisclosureTarget
} from './workingStepDisclosure.ts'

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
  steeredWorkingStepDisclosureTargets: ReadonlyMap<string, WorkingStepDisclosureTarget>
}

type ChatConversationModelInternals = {
  sourceItems: readonly ProviderChatItem[]
  turnIndexByItemId: Map<string, number>
  workingStepIndexById: Map<string, number>
  workingSteps: ProviderWorkingStep[]
}

type ChatItemsChange = {
  previousItems: WeakRef<readonly ProviderChatItem[]> | null
  startIndex: number
}

const chatItemsChanges = new WeakMap<readonly ProviderChatItem[], ChatItemsChange>()
const modelsByItems = new WeakMap<readonly ProviderChatItem[], ChatConversationModel>()
const modelInternals = new WeakMap<ChatConversationModel, ChatConversationModelInternals>()

export const getConversationTailWorkingStep = (
  items: readonly ProviderChatItem[],
  awaitingResponse = false
): ProviderWorkingStep | null => {
  let lastItem: ProviderChatItem | undefined
  let pendingSteering: ProviderPendingMessage | undefined
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!lastItem && item.type === 'pendingMessage' && item.kind === 'steering')
      pendingSteering ??= item
    if (!lastItem && item.type !== 'pendingMessage') lastItem = item
    if (item.type === 'working' && item.status === 'working') return item
  }
  // Confirmation can replace the optimistic user + working pair before the
  // provider emits its first working step. Keep the activity row's space so
  // bottom-aligned messages do not move down and then back up during the send.
  // A steer can arrive while the previous activity block is already marked Worked.
  // Keep activity visible until its echo and the next working segment arrive. Queued
  // messages alone must not revive completed history or final-answer streaming.
  const awaitingMessage =
    pendingSteering ??
    (lastItem?.type === 'message' && lastItem.role === 'user' ? lastItem : undefined)
  if (awaitingResponse && awaitingMessage) {
    return {
      type: 'working',
      id: `awaiting-response:${awaitingMessage.id}`,
      status: 'working',
      startedAt: awaitingMessage.createdAt ?? undefined,
      items: []
    }
  }

  return null
}

export const markChatItemsChanged = (
  items: ProviderChatItem[],
  startIndex: number,
  previousItems: readonly ProviderChatItem[] | null = null
): void => {
  if (Number.isSafeInteger(startIndex) && startIndex >= 0 && startIndex <= items.length) {
    // Unrendered updates can accumulate while React batches work or a chat is hidden.
    // Strong ancestry here would keep every old streaming snapshot alive through
    // the newest array. An incremental-build hint must not own transcript history.
    chatItemsChanges.set(items, {
      previousItems: previousItems ? new WeakRef(previousItems) : null,
      startIndex
    })
  }
}

const emptyModel: ChatConversationModel = {
  firstPendingItemId: null,
  followingWorkingStepsById: new Map(),
  itemIndexesById: new Map(),
  itemIds: new Set(),
  lastNonPendingItem: null,
  stoppedTurnRetryMessages: new Map(),
  turns: [],
  workingStepIdsWithNextWorkingStep: new Set(),
  steeredWorkingStepDisclosureTargets: new Map()
}

const emptyModelInternals: ChatConversationModelInternals = {
  sourceItems: [],
  turnIndexByItemId: new Map(),
  workingStepIndexById: new Map(),
  workingSteps: []
}

type RebuildStart = { itemIndex: number; turnIndex: number }

const getIncrementalRebuildStart = (
  items: readonly ProviderChatItem[],
  previousModel: ChatConversationModel,
  internals: ChatConversationModelInternals,
  changedStartIndex: number
): RebuildStart | null => {
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

  const getTurnStart = (turnIndex: number | undefined): RebuildStart | null => {
    const firstTurnItem = turnIndex === undefined ? null : previousModel.turns[turnIndex]?.items[0]
    const itemIndex = firstTurnItem
      ? previousModel.itemIndexesById.get(firstTurnItem.id)
      : undefined
    return turnIndex === undefined || itemIndex === undefined ? null : { itemIndex, turnIndex }
  }

  const previousChangedItem = internals.sourceItems[changedStartIndex]
  if (previousChangedItem)
    return getTurnStart(internals.turnIndexByItemId.get(previousChangedItem.id))

  const firstNewItem = items[changedStartIndex]
  if (firstNewItem && !startsProviderChatTurn(firstNewItem) && previousModel.turns.length > 0) {
    return getTurnStart(previousModel.turns.length - 1)
  }

  return { itemIndex: changedStartIndex, turnIndex: previousModel.turns.length }
}

const rebuildChatConversationModel = (
  items: readonly ProviderChatItem[],
  previousModel: ChatConversationModel,
  internals: ChatConversationModelInternals,
  rebuildStart: RebuildStart
): ChatConversationModel => {
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
    if (startsProviderChatTurn(item)) {
      if (currentTurnItems.length > 0) finishTurn()
      currentTurnUserMessage = item.type === 'message' && item.role === 'user' ? item : null
    }
    currentTurnItems.push(item)
    const itemIndex = rebuildStart.itemIndex + suffixIndex
    itemIndexesById.set(item.id, itemIndex)
    itemIds.add(item.id)
    nextInternals.turnIndexByItemId.set(item.id, turns.length)
    if (
      item.type === 'working' &&
      (item.status === 'stopped' || item.status === 'failed') &&
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
    workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets: getSteeredWorkingStepDisclosureTargets(turns)
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
  const previousItems = change?.previousItems?.deref()
  const resolvedPreviousModel =
    previousModel ?? (previousItems ? modelsByItems.get(previousItems) : null)
  if (resolvedPreviousModel && change) {
    const internals = modelInternals.get(resolvedPreviousModel)
    const rebuildStart =
      internals &&
      getIncrementalRebuildStart(items, resolvedPreviousModel, internals, change.startIndex)
    if (internals && rebuildStart) {
      const model = rebuildChatConversationModel(
        items,
        resolvedPreviousModel,
        internals,
        rebuildStart
      )
      if (previousItems) modelsByItems.delete(previousItems)
      return model
    }
  }

  return rebuildChatConversationModel(items, emptyModel, emptyModelInternals, {
    itemIndex: 0,
    turnIndex: 0
  })
}
