import { useCallback } from 'react'
import { type ProviderChatTurn } from '../../../../shared/chatTurns'
import { shouldDisableRateLimitReset } from '../../accountRateLimits'
import { providerApi } from '../../providerApi'
import {
  renderConversationTurn,
  type ChatTurnInputs,
  type RootChatTurnInputs
} from '../chatTurnRendering'
import { useStableProps } from '../stableProps'
import { useWorkspaceSubagentPresentation } from './useWorkspaceSubagentPresentation'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function useWorkspaceTurnRendering({
  subagentPresentation,
  effectiveSelection,
  settings,
  providerState,
  scroll,
  chatState,
  chatErrors,
  session,
  messaging,
  interactions,
  conversation,
  files,
  subagents
}: WorkspaceChanges & {
  subagentPresentation: ReturnType<typeof useWorkspaceSubagentPresentation>
}) {
  const {
    accountUsage,
    changesContainer,
    changesCwd,
    changesProjectCwd,
    selectedChatKey,
    refreshAccountUsage,
    resetAccountRateLimits,
    activeSubagentChatView
  } = session
  const {
    handleLoadWorkingStep,
    handleLoadWorkingItem,
    handleLoadWorkingToolPage,
    handleDeletePendingMessage,
    handleEditPendingMessage,
    handleSteerPendingMessage,
    handleInterruptPendingMessage,
    handleContinueStoppedTurn,
    handleEditMessage,
    handleRetryStoppedTurn,
    handleStartGoalChat
  } = messaging
  const { chatHasActiveTurn, chatHasPendingSteeringMessage, handleForkMessage } = interactions
  const {
    chatItemIndexesById,
    visibleChatItems,
    followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets,
    renderedChatTurns,
    effectiveChatTurnWindow,
    firstPendingChatItemId,
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers,
    canEditOwnMessages,
    stoppedTurnActionDisabled,
    continuedStoppedWorkingStepIds,
    pinnedChatMessageIds,
    canRetryStoppedTurns,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    subagentChatItemIndexesById,
    subagentVisibleChatItems,
    subagentChatConversationModel
  } = conversation
  const { handleOpenFileLink, handleToggleChatMessagePinned } = files
  const {
    renderChatCommitMarker,
    handleLoadSubagentWorkingStep,
    handleLoadSubagentWorkingItem,
    handleLoadSubagentWorkingToolPage
  } = subagents

  const rateLimitResetDisabled = shouldDisableRateLimitReset(
    accountUsage?.rateLimits ?? [],
    accountUsage?.rateLimitResetCredits?.credits ?? null,
    Date.now(),
    accountUsage?.rateLimitResetCredits?.options !== undefined
  )

  const sharedTurnInputs = {
    renderSubagentCompletion: subagentPresentation.renderSubagentCompletion,
    container: changesContainer,
    cwd: changesCwd,
    projectCwd: changesProjectCwd,
    modelLabelsById: effectiveSelection.modelLabelsById,
    resolvedModelIdsById: effectiveSelection.resolvedModelIdsById,
    progressSettings: settings.effectiveAppSettings.chat,
    selectedModelId: providerState.model,
    onOpenFileLink: changesCwd ? handleOpenFileLink : undefined
  }
  // Handlers call the current controller, but changing their closures must not
  // invalidate every cached message during unrelated workspace updates.
  const rootChatTurnInputs = useStableProps<RootChatTurnInputs>({
    ...sharedTurnInputs,
    itemIndexesById: chatItemIndexesById,
    visibleChatItems,
    followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets,
    subagentCompletions: subagentPresentation.rootSubagentCompletions,
    onLoadWorkingStep: handleLoadWorkingStep,
    onLoadWorkingItem: handleLoadWorkingItem,
    onLoadWorkingToolPage: handleLoadWorkingToolPage,
    latestRenderedTurn: renderedChatTurns.at(-1),
    windowIncludesLatest: effectiveChatTurnWindow?.endIndex === effectiveChatTurnWindow?.totalCount,
    firstPendingChatItemId,
    scheduleChatAutoScroll: scroll.scheduleChatAutoScroll,
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers,
    renderChatCommitMarker,
    mcpAppScopeProviderId: chatState.selectedChat?.providerId ?? null,
    mcpAppScopeChatId: chatState.selectedChat?.id ?? null,
    motionChatKey: selectedChatKey,
    authenticationRequired: chatErrors.authenticationRequired,
    availableRateLimitResets: accountUsage?.rateLimitResetCredits?.availableCount ?? 0,
    rateLimitResetOptions: accountUsage?.rateLimitResetCredits?.options,
    canEditOwnMessages,
    continuePrompt: settings.effectiveAppSettings.chat.continuePrompt,
    stoppedTurnActionDisabled,
    continuedStoppedWorkingStepIds,
    pinnedChatMessageIds,
    rateLimitResetDisabled,
    canRetryStoppedTurns,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    onDeletePendingMessage: handleDeletePendingMessage,
    onEditPendingMessage: handleEditPendingMessage,
    onSteerPendingMessage:
      chatHasActiveTurn && !chatHasPendingSteeringMessage ? handleSteerPendingMessage : undefined,
    onInterruptPendingMessage: handleInterruptPendingMessage,
    onContinueStoppedTurn: handleContinueStoppedTurn,
    onEditMessage: handleEditMessage,
    onForkMessage:
      chatHasActiveTurn || chatState.forkingMessageId || chatState.chatDetail?.historyPreview
        ? undefined
        : handleForkMessage,
    onDisclosureToggle: scroll.handleChatDisclosureToggle,
    onToggleMessagePinned: handleToggleChatMessagePinned,
    onRetryStoppedTurn: handleRetryStoppedTurn,
    onManageAccounts: chatErrors.handleManageChatAccounts,
    onReauthenticate: chatErrors.handleOpenChatReauthentication,
    onUsageRefresh: refreshAccountUsage,
    onUsageReset: resetAccountRateLimits
  })

  const subagentChatTurnInputs = useStableProps<ChatTurnInputs>({
    ...sharedTurnInputs,
    itemIndexesById: subagentChatItemIndexesById,
    visibleChatItems: subagentVisibleChatItems,
    followingWorkingStepsById: subagentChatConversationModel.followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep:
      subagentChatConversationModel.workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets:
      subagentChatConversationModel.steeredWorkingStepDisclosureTargets,
    subagentCompletions: subagentPresentation.childSubagentCompletions,
    onLoadWorkingStep: handleLoadSubagentWorkingStep,
    onLoadWorkingItem: handleLoadSubagentWorkingItem,
    onLoadWorkingToolPage: handleLoadSubagentWorkingToolPage
  })

  const turnInputs = activeSubagentChatView ? subagentChatTurnInputs : rootChatTurnInputs
  const renderChatTurn = useCallback(
    (turnIndex: number, turn: ProviderChatTurn): React.ReactElement =>
      renderConversationTurn(turnInputs, turnIndex, turn),
    [turnInputs]
  )

  const showChatTurnDownButton = Boolean(
    !activeSubagentChatView &&
      effectiveChatTurnWindow &&
      (!chatState.chatAtConversationBottom ||
        effectiveChatTurnWindow.endIndex < effectiveChatTurnWindow.totalCount ||
        Boolean(chatState.chatDetail?.turnPagination?.newerCursor))
  )

  const handleSaveGoalObjective = async (objective: string | null): Promise<void> => {
    if (!chatState.selectedChat) {
      if (objective) await handleStartGoalChat(objective)
      return
    }
    if (chatState.chatDetailRef.current?.historyPreview) return
    await providerApi.setChatGoal(
      chatState.selectedChat.providerId,
      chatState.selectedChat.id,
      objective
    )
  }
  return { renderChatTurn, showChatTurnDownButton, handleSaveGoalObjective }
}
