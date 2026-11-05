import { useCallback } from 'react'
import { type ProviderChatTurn } from '../../../../shared/chatTurns'
import { shouldDisableRateLimitReset } from '../../accountRateLimits'
import { providerApi } from '../../providerApi'
import {
  renderRootChatTurn,
  renderSubagentChatTurn as renderSubagentTurn,
  type RootChatTurnInputs,
  type SubagentChatTurnInputs
} from '../chatTurnRendering'
import { useLatestHandler, useStableProps } from '../stableProps'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceChatErrors } from './useWorkspaceChatErrors'
import { useWorkspaceEffectiveSelection } from './useWorkspaceEffectiveSelection'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'
import { useWorkspaceSubagentPresentation } from './useWorkspaceSubagentPresentation'

import type { useWorkspaceConversation } from '../wiring/useWorkspaceConversation'
import type { useWorkspaceFiles } from '../wiring/useWorkspaceFiles'
import type { useWorkspaceInteractions } from '../wiring/useWorkspaceInteractions'
import type { useWorkspaceMessaging } from '../wiring/useWorkspaceMessaging'
import type { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import type { useWorkspaceSubagents } from '../wiring/useWorkspaceSubagents'
type WorkspaceTurnRenderingDependencies = {
  subagentPresentation: ReturnType<typeof useWorkspaceSubagentPresentation>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  scroll: ReturnType<typeof useWorkspaceScroll>
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
  session: Pick<
    ReturnType<typeof useWorkspaceSession>,
    | 'accountUsage'
    | 'changesContainer'
    | 'changesCwd'
    | 'changesProjectCwd'
    | 'selectedChatKey'
    | 'refreshAccountUsage'
    | 'resetAccountRateLimits'
    | 'activeSubagentChatView'
  >
  messaging: Pick<
    ReturnType<typeof useWorkspaceMessaging>,
    | 'handleLoadWorkingStep'
    | 'handleLoadWorkingItem'
    | 'handleLoadWorkingToolPage'
    | 'handleDeletePendingMessage'
    | 'handleEditPendingMessage'
    | 'handleSteerPendingMessage'
    | 'handleInterruptPendingMessage'
    | 'handleContinueStoppedTurn'
    | 'handleEditMessage'
    | 'handleRetryStoppedTurn'
    | 'handleStartGoalChat'
  >
  interactions: Pick<
    ReturnType<typeof useWorkspaceInteractions>,
    'chatHasActiveTurn' | 'chatHasPendingSteeringMessage' | 'handleForkMessage'
  >
  conversation: Pick<
    ReturnType<typeof useWorkspaceConversation>,
    | 'chatItemIndexesById'
    | 'visibleChatItems'
    | 'followingWorkingStepsById'
    | 'workingStepIdsWithNextWorkingStep'
    | 'steeredWorkingStepDisclosureTargets'
    | 'renderedChatTurns'
    | 'effectiveChatTurnWindow'
    | 'firstPendingChatItemId'
    | 'chatCommitMarkersByBeforeItemId'
    | 'chatCommitMarkersByAfterItemId'
    | 'trailingChatCommitMarkers'
    | 'canEditOwnMessages'
    | 'stoppedTurnActionDisabled'
    | 'continuedStoppedWorkingStepIds'
    | 'pinnedChatMessageIds'
    | 'canRetryStoppedTurns'
    | 'stoppedTurnRetryMessages'
    | 'streamingChatItemId'
    | 'subagentChatItemIndexesById'
    | 'subagentVisibleChatItems'
    | 'subagentChatConversationModel'
  >
  files: Pick<
    ReturnType<typeof useWorkspaceFiles>,
    'handleOpenFileLink' | 'handleToggleChatMessagePinned'
  >
  subagents: Pick<
    ReturnType<typeof useWorkspaceSubagents>,
    | 'renderChatCommitMarker'
    | 'handleLoadSubagentWorkingStep'
    | 'handleLoadSubagentWorkingItem'
    | 'handleLoadSubagentWorkingToolPage'
  >
}

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
}: WorkspaceTurnRenderingDependencies) {
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
    accountUsage?.rateLimitResetCredits?.credits ?? null
  )

  // Handlers call the current controller, but changing their closures must not
  // invalidate every cached message during unrelated workspace updates.
  const rootChatTurnInputs = useStableProps<RootChatTurnInputs>({
    itemIndexesById: chatItemIndexesById,
    visibleChatItems,
    followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets,
    subagentCompletions: subagentPresentation.rootSubagentCompletions,
    renderSubagentCompletion: subagentPresentation.renderSubagentCompletion,
    container: changesContainer,
    cwd: changesCwd,
    projectCwd: changesProjectCwd,
    modelLabelsById: effectiveSelection.modelLabelsById,
    resolvedModelIdsById: effectiveSelection.resolvedModelIdsById,
    progressSettings: settings.effectiveAppSettings.chat,
    selectedModelId: providerState.model,
    onOpenFileLink: changesCwd ? handleOpenFileLink : undefined,
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

  // Stable while the inputs are, so the memoized message list skips workspace
  // renders that change nothing it shows.
  const renderChatTurn = useCallback(
    (turnIndex: number, turn: ProviderChatTurn): React.ReactElement =>
      renderRootChatTurn(rootChatTurnInputs, turnIndex, turn),
    [rootChatTurnInputs]
  )

  const loadSubagentWorkingStep = useLatestHandler(handleLoadSubagentWorkingStep)

  const loadSubagentWorkingItem = useLatestHandler(handleLoadSubagentWorkingItem)

  const loadSubagentWorkingToolPage = useLatestHandler(handleLoadSubagentWorkingToolPage)

  const subagentChatTurnInputs = useStableProps<SubagentChatTurnInputs>({
    itemIndexesById: subagentChatItemIndexesById,
    visibleChatItems: subagentVisibleChatItems,
    followingWorkingStepsById: subagentChatConversationModel.followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep:
      subagentChatConversationModel.workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets:
      subagentChatConversationModel.steeredWorkingStepDisclosureTargets,
    subagentCompletions: subagentPresentation.childSubagentCompletions,
    renderSubagentCompletion: subagentPresentation.renderSubagentCompletion,
    container: changesContainer,
    cwd: changesCwd,
    projectCwd: changesProjectCwd,
    modelLabelsById: effectiveSelection.modelLabelsById,
    resolvedModelIdsById: effectiveSelection.resolvedModelIdsById,
    progressSettings: settings.effectiveAppSettings.chat,
    selectedModelId: providerState.model,
    onOpenFileLink: changesCwd ? handleOpenFileLink : undefined,
    onLoadWorkingStep: loadSubagentWorkingStep,
    onLoadWorkingItem: loadSubagentWorkingItem,
    onLoadWorkingToolPage: loadSubagentWorkingToolPage
  })

  const renderSubagentChatTurn = useCallback(
    (turnIndex: number, turn: ProviderChatTurn): React.ReactElement =>
      renderSubagentTurn(subagentChatTurnInputs, turnIndex, turn),
    [subagentChatTurnInputs]
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
  return { renderChatTurn, renderSubagentChatTurn, showChatTurnDownButton, handleSaveGoalObjective }
}
