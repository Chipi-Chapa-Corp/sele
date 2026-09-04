import type { ProviderChatItem, ProviderWorkingStep } from '../../shared/provider'
import type { AppChatProgressSettings } from './settings'

export type WorkingStepProgressPolicy = 'regular' | 'stoppedSteeredFailed'

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
  turnItems: readonly ProviderChatItem[]
): WorkingStepProgressPolicy => {
  if (step.status === 'stopped' || step.status === 'failed') return 'stoppedSteeredFailed'

  return turnItems.some(
    (item) =>
      item.type === 'message' &&
      item.role === 'user' &&
      (item.kind === 'steering' || item.label === 'Steering with')
  )
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
