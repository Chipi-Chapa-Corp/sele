import 'react-diff-view/style/index.css'
import type { ProviderChatItem } from '../../../shared/provider'
import { getMessageModelLabel } from '../messageModelLabel'
import { defaultAppChatProgressSettings, type AppChatProgressSettings } from '../settings'
import './ChatDetailItem.css'
import type { ChatDetailItemProps } from './ChatDetailItem.types'
import './UnifiedDiff.css'

export const getProgressSettings = (settings?: AppChatProgressSettings): AppChatProgressSettings =>
  settings ?? defaultAppChatProgressSettings

const areProgressSettingsEqual = (
  first?: AppChatProgressSettings,
  second?: AppChatProgressSettings
): boolean => {
  const normalizedFirst = getProgressSettings(first)
  const normalizedSecond = getProgressSettings(second)

  return (
    normalizedFirst.expandProgressOnStart === normalizedSecond.expandProgressOnStart &&
    normalizedFirst.collapseProgressOnFinish === normalizedSecond.collapseProgressOnFinish &&
    normalizedFirst.collapseProgressOnNextTurn === normalizedSecond.collapseProgressOnNextTurn &&
    normalizedFirst.collapseStoppedSteeredFailedProgressOnFinish ===
      normalizedSecond.collapseStoppedSteeredFailedProgressOnFinish &&
    normalizedFirst.collapseStoppedSteeredFailedProgressOnNextTurn ===
      normalizedSecond.collapseStoppedSteeredFailedProgressOnNextTurn
  )
}

export const isQueuedPendingMessage = (item: ProviderChatItem | null | undefined): boolean =>
  item?.type === 'pendingMessage' && item.kind === 'queued'

const hasSameMessageModelLabel = (
  first: ChatDetailItemProps,
  second: ChatDetailItemProps
): boolean => {
  if (first.item.type !== 'message' || second.item.type !== 'message') return true
  if (
    first.selectedModelId === second.selectedModelId &&
    first.modelLabelsById === second.modelLabelsById &&
    first.resolvedModelIdsById === second.resolvedModelIdsById
  )
    return true
  return (
    getMessageModelLabel(
      first.item,
      first.selectedModelId,
      first.modelLabelsById,
      first.resolvedModelIdsById
    ) ===
    getMessageModelLabel(
      second.item,
      second.selectedModelId,
      second.modelLabelsById,
      second.resolvedModelIdsById
    )
  )
}

export const areChatDetailItemPropsEqual = (
  first: ChatDetailItemProps,
  second: ChatDetailItemProps
): boolean =>
  first.mcpAppScope?.providerId === second.mcpAppScope?.providerId &&
  first.mcpAppScope?.chatId === second.mcpAppScope?.chatId &&
  first.motionChatKey === second.motionChatKey &&
  first.authenticationRequired === second.authenticationRequired &&
  first.canEditOwnMessages === second.canEditOwnMessages &&
  first.markdownBaseUrl === second.markdownBaseUrl &&
  first.messageBubble === second.messageBubble &&
  first.availableRateLimitResets === second.availableRateLimitResets &&
  first.rateLimitResetOptions === second.rateLimitResetOptions &&
  first.container === second.container &&
  first.continuePrompt === second.continuePrompt &&
  first.continueStoppedTurnDisabled === second.continueStoppedTurnDisabled &&
  first.continuedStoppedTurn === second.continuedStoppedTurn &&
  first.followingWorkingStepHasNext === second.followingWorkingStepHasNext &&
  first.followingWorkingStepStatus === second.followingWorkingStepStatus &&
  first.hasNextWorkingStep === second.hasNextWorkingStep &&
  first.messagePinned === second.messagePinned &&
  first.pendingMessageLabel === second.pendingMessageLabel &&
  first.pendingMessageDeleteDisabled === second.pendingMessageDeleteDisabled &&
  hasSameMessageModelLabel(first, second) &&
  first.onDeletePendingMessage === second.onDeletePendingMessage &&
  first.onEditPendingMessage === second.onEditPendingMessage &&
  first.onSteerPendingMessage === second.onSteerPendingMessage &&
  first.onInterruptPendingMessage === second.onInterruptPendingMessage &&
  first.onEditMessage === second.onEditMessage &&
  first.onForkMessage === second.onForkMessage &&
  first.onLoadWorkingStep === second.onLoadWorkingStep &&
  first.onLoadWorkingItem === second.onLoadWorkingItem &&
  first.onLoadWorkingToolPage === second.onLoadWorkingToolPage &&
  first.onDisclosureToggle === second.onDisclosureToggle &&
  first.onOpenFileLink === second.onOpenFileLink &&
  first.onToggleMessagePinned === second.onToggleMessagePinned &&
  first.onContinueStoppedTurn === second.onContinueStoppedTurn &&
  first.onRetryStoppedTurn === second.onRetryStoppedTurn &&
  first.onManageAccounts === second.onManageAccounts &&
  first.onReauthenticate === second.onReauthenticate &&
  first.onUsageRefresh === second.onUsageRefresh &&
  first.onUsageReset === second.onUsageReset &&
  isQueuedPendingMessage(first.previousItem) === isQueuedPendingMessage(second.previousItem) &&
  first.cwd === second.cwd &&
  first.projectCwd === second.projectCwd &&
  first.progressPolicy === second.progressPolicy &&
  first.progressDisclosureTarget?.status === second.progressDisclosureTarget?.status &&
  first.progressDisclosureTarget?.progressPolicy ===
    second.progressDisclosureTarget?.progressPolicy &&
  first.progressDisclosureTarget?.hasNextWorkingStep ===
    second.progressDisclosureTarget?.hasNextWorkingStep &&
  first.rateLimitResetDisabled === second.rateLimitResetDisabled &&
  first.retryMessage === second.retryMessage &&
  first.retryStoppedTurnDisabled === second.retryStoppedTurnDisabled &&
  first.streaming === second.streaming &&
  first.turnIndex === second.turnIndex &&
  areProgressSettingsEqual(first.progressSettings, second.progressSettings) &&
  first.item === second.item
