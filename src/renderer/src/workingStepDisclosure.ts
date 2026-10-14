import type { ProviderChatItem, ProviderWorkingStep } from '../../shared/provider'
import type { AppChatProgressSettings } from './settings'
import type { ProviderChatTurn } from '../../shared/chatTurns'

export type WorkingStepProgressPolicy = 'regular' | 'stoppedSteeredFailed'

export type WorkingStepDisclosureTarget = {
  status: ProviderWorkingStep['status']
  hasNextWorkingStep: boolean
}

const isSteeringMessage = (item: ProviderChatItem): boolean =>
  item.type === 'message' &&
  item.role === 'user' &&
  (item.kind === 'steering' || item.label === 'Steering with' || item.label === 'Steered with')

export const getSteeredWorkingStepDisclosureTargets = (
  turns: readonly ProviderChatTurn[]
): ReadonlyMap<string, WorkingStepDisclosureTarget> => {
  const targets = new Map<string, WorkingStepDisclosureTarget>()
  let target: WorkingStepDisclosureTarget | undefined
  let nextTurnIsSteering = false
  let hasLaterWorkingStep = false

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const isSteeredTurn = turn.items.some(isSteeringMessage)
    if (!nextTurnIsSteering) target = undefined

    // A chain of steering messages shares the last block's lifecycle. An internal
    // steering boundary is not a next turn for the collapse-on-next-turn rule.
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex]
      if (item.type !== 'working') continue
      target ??= { status: item.status, hasNextWorkingStep: hasLaterWorkingStep }
      if (isSteeredTurn || nextTurnIsSteering) targets.set(item.id, target)
      hasLaterWorkingStep = true
    }
    nextTurnIsSteering = isSteeredTurn
  }

  return targets
}

type ProgressDisclosurePolicy = {
  expandOnStart: boolean
  collapseOnFinish: boolean
  collapseOnNextTurn: boolean
}

const getProgressDisclosurePolicy = (
  status: ProviderWorkingStep['status'],
  progressPolicy: WorkingStepProgressPolicy,
  settings: AppChatProgressSettings
): ProgressDisclosurePolicy => {
  if (progressPolicy === 'stoppedSteeredFailed' || status === 'stopped' || status === 'failed') {
    return {
      expandOnStart: settings.expandProgressOnStart,
      collapseOnFinish: settings.collapseStoppedSteeredFailedProgressOnFinish,
      collapseOnNextTurn: settings.collapseStoppedSteeredFailedProgressOnNextTurn
    }
  }

  return {
    expandOnStart: settings.expandProgressOnStart,
    collapseOnFinish: settings.collapseProgressOnFinish,
    collapseOnNextTurn: settings.collapseProgressOnNextTurn
  }
}

export const getWorkingStepProgressPolicy = (
  step: ProviderWorkingStep,
  turnItems: readonly ProviderChatItem[],
  nextTurnStartItem?: ProviderChatItem
): WorkingStepProgressPolicy => {
  if (step.status === 'stopped' || step.status === 'failed') return 'stoppedSteeredFailed'

  // Steering starts a new displayed turn, but also finishes the progress before it.
  return turnItems.some(isSteeringMessage) ||
    (nextTurnStartItem != null && isSteeringMessage(nextTurnStartItem))
    ? 'stoppedSteeredFailed'
    : 'regular'
}

export const getWorkingStepDefaultOpen = (
  status: ProviderWorkingStep['status'],
  progressPolicy: WorkingStepProgressPolicy,
  settings: AppChatProgressSettings,
  hasNextWorkingStep: boolean
): boolean => {
  const policy = getProgressDisclosurePolicy(status, progressPolicy, settings)

  if (status === 'working') {
    return policy.expandOnStart && !(hasNextWorkingStep && policy.collapseOnNextTurn)
  }

  if (status === 'worked' || status === 'stopped' || status === 'failed') {
    return !policy.collapseOnFinish && !(hasNextWorkingStep && policy.collapseOnNextTurn)
  }

  return false
}

export const getWorkingStepDisclosureKey = (
  status: ProviderWorkingStep['status'],
  progressPolicy: WorkingStepProgressPolicy,
  settings: AppChatProgressSettings,
  hasNextWorkingStep: boolean
): string =>
  [
    status,
    progressPolicy,
    hasNextWorkingStep ? 'next' : 'latest',
    settings.expandProgressOnStart,
    settings.collapseProgressOnFinish,
    settings.collapseProgressOnNextTurn,
    settings.collapseStoppedSteeredFailedProgressOnFinish,
    settings.collapseStoppedSteeredFailedProgressOnNextTurn
  ].join(':')

export type WorkingStepDisclosureState = {
  key: string
  open: boolean
}

export const resolveWorkingStepOpen = (
  state: WorkingStepDisclosureState,
  disclosureKey: string,
  defaultOpen: boolean
): boolean => (state.key === disclosureKey ? state.open : defaultOpen)
