import type { ProviderWorkingStep } from '../../shared/provider'
import type { AppChatThoughtSettings } from './settings'

export const getWorkingStepDefaultOpen = (
  status: ProviderWorkingStep['status'],
  thoughtSettings: AppChatThoughtSettings,
  hasNextWorkingStep: boolean
): boolean => {
  if (status === 'working') {
    return (
      thoughtSettings.expandThoughtsOnStart &&
      !(hasNextWorkingStep && thoughtSettings.collapseThoughtsOnNextTurn)
    )
  }

  if (status === 'stopped' || status === 'failed') {
    return (
      thoughtSettings.expandStoppedTurns &&
      !(hasNextWorkingStep && thoughtSettings.collapseStoppedOnNextTurn)
    )
  }

  if (status === 'worked') {
    return (
      !thoughtSettings.collapseThoughtsOnFinish &&
      !(hasNextWorkingStep && thoughtSettings.collapseThoughtsOnNextTurn)
    )
  }

  return false
}

export const getWorkingStepDisclosureKey = (
  status: ProviderWorkingStep['status'],
  thoughtSettings: AppChatThoughtSettings,
  hasNextWorkingStep: boolean
): string =>
  [
    status,
    hasNextWorkingStep ? 'next' : 'latest',
    thoughtSettings.expandThoughtsOnStart,
    thoughtSettings.collapseThoughtsOnFinish,
    thoughtSettings.collapseThoughtsOnNextTurn,
    thoughtSettings.expandStoppedTurns,
    thoughtSettings.collapseStoppedOnNextTurn
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
