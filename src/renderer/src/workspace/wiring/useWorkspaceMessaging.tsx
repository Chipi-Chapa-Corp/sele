import type { AppProject } from '../../../../shared/app'
import { writeStoredChatMessageBoxSelections } from '../../messageBoxPreferences'
import { getProviderChatKey, isActiveChatStatus } from '../chatControllerUtils'
import { useWorkspaceChatErrors } from '../features/useWorkspaceChatErrors'
import { useWorkspaceChatProjection } from '../features/useWorkspaceChatProjection'
import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceEffectiveSelection } from '../features/useWorkspaceEffectiveSelection'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useChatMessagingController } from '../useChatMessagingController'
import { useWorkspaceProviderUpdates } from './useWorkspaceProviderUpdates'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceMessagingDependencies = {
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  session: ReturnType<typeof useWorkspaceSession>
  provider: ReturnType<typeof useWorkspaceProviderContext>
  projectRecordsByCwd: Map<string, AppProject>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerUpdates: ReturnType<typeof useWorkspaceProviderUpdates>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  chatProjection: ReturnType<typeof useWorkspaceChatProjection>
  gitState: ReturnType<typeof useWorkspaceGitState>
}

export function useWorkspaceMessaging({
  chatErrors,
  providerState,
  chatState,
  session,
  provider,
  projectRecordsByCwd,
  effectiveSelection,
  settings,
  sourceState,
  providerUpdates,
  subagentState,
  viewportState,
  chatRead,
  chatProjection,
  gitState
}: WorkspaceMessagingDependencies) {
  const {
    startingChat,
    getGitTurnOptions,
    limitResetTarget,
    handleQueueLimitReset,
    handleCancelEditMessage,
    handleCancelWorktreeCreation,
    handleContinueStoppedTurn,
    handleDeletePendingMessage,
    handleEditMessage,
    handleEditPendingMessage,
    handleInterruptPendingMessage,
    handleLoadWorkingItem,
    handleLoadWorkingStep,
    handleLoadWorkingToolPage,
    handleResolveApproval,
    handleResolveChatApproval,
    handleRetryStoppedTurn,
    handleSendMessage,
    handleStartGoalChat,
    handleSteerPendingMessage,
    handleCompactChat,
    handleStopChat,
    resolveSelectedUserInput
  } = useChatMessagingController({
    chatNavigationRequestRef: chatState.chatNavigationRequestRef,
    authenticationRequired: chatErrors.authenticationRequired,
    messageBoxSelection: {
      agentMode: providerState.agentMode,
      approvalMode: providerState.approvalMode,
      sandboxMode: providerState.sandboxMode,
      model: providerState.model,
      reasoningEffort: providerState.reasoningEffort,
      serviceTier: providerState.serviceTier
    },
    rememberStartedChatSelection: (providerId, chatId, selection) => {
      providerState.chatMessageBoxSelectionsRef.current[getProviderChatKey(providerId, chatId)] =
        selection
      writeStoredChatMessageBoxSelections(providerState.chatMessageBoxSelectionsRef.current)
    },
    chatDetail: chatState.chatDetail,
    sendInFlightRef: chatState.sendInFlightRef,
    setSendState: chatState.setSendState,
    setEditingMessage: chatState.setEditingMessage,
    selectedChatId: session.selectedChatId,
    models: provider.models,
    changesProjectCwd: session.changesProjectCwd,
    projectRecordsByCwd,
    agentMode: effectiveSelection.effectiveAgentMode,
    effectiveApprovalMode: effectiveSelection.effectiveApprovalMode,
    effectiveSandboxMode: effectiveSelection.effectiveSandboxMode,
    changesContainer: session.changesContainer,
    changesCwd: session.changesCwd,
    effectiveModel: effectiveSelection.effectiveModel,
    selectedEffectiveModel: effectiveSelection.selectedEffectiveModel,
    effectiveReasoningEffort: effectiveSelection.effectiveReasoningEffort,
    effectiveServiceTier: effectiveSelection.effectiveServiceTier,
    effectiveAppSettings: settings.effectiveAppSettings,
    configProviderId: provider.configProviderId,
    configProviderContainerKey: provider.configProviderContainerKey,
    worktreeCreationCanceledRef: sourceState.worktreeCreationCanceledRef,
    setWorktreeCreationState: sourceState.setWorktreeCreationState,
    worktreeBranchGenerationRef: sourceState.worktreeBranchGenerationRef,
    providerUpdateInProgress: providerUpdates.providerUpdateInProgress,
    activeSubagentChatView: session.activeSubagentChatView,
    setSubagentChatView: subagentState.setSubagentChatView,
    selectedChat: chatState.selectedChat,
    newSessionCwd: sourceState.newSessionCwd,
    newSessionNoProject: sourceState.newSessionNoProject,
    sendInFlightProjectKeyRef: chatState.sendInFlightProjectKeyRef,
    setSendInFlightProjectKey: chatState.setSendInFlightProjectKey,
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    setChatAtConversationBottom: chatState.setChatAtConversationBottom,
    scrollToLatestTurnAfterRenderRef: viewportState.scrollToLatestTurnAfterRenderRef,
    editingMessage: chatState.editingMessage,
    applyViewedChatDetail: chatRead.applyViewedChatDetail,
    handleSendFailure: chatErrors.handleSendFailure,
    newSessionProvider: sourceState.newSessionProvider,
    newSessionLocation: sourceState.newSessionLocation,
    chatHasActiveTurn: isActiveChatStatus(chatState.chatDetail?.status),
    applyChatSummary: chatProjection.applyChatSummary,
    markChatSeenAt: chatRead.markChatSeenAt,
    selectedChatKeyRef: chatState.selectedChatKeyRef,
    setContinuedStoppedWorkingStepsByChat: gitState.setContinuedStoppedWorkingStepsByChat,
    runPromptActionRef: chatState.runPromptActionRef,
    selectedChatRef: chatState.selectedChatRef,
    chatDetailRef: chatState.chatDetailRef,
    loadedWorkingStepIdsRef: chatState.loadedWorkingStepIdsRef,
    setChatDetail: chatState.setChatDetail,
    selectedProviderId: session.selectedProviderId,
    approvalResolution: chatState.approvalResolution,
    setApprovalResolution: chatState.setApprovalResolution,
    applyChatDetail: chatProjection.applyChatDetail,
    pendingApproval: session.pendingApproval,
    approvalDecisionInFlight: session.approvalDecisionInFlight,
    pendingUserInput: session.pendingUserInput,
    userInputResolving: session.userInputResolving,
    setUserInputResolution: chatState.setUserInputResolution,
    sendState: chatState.sendState
  })
  return {
    startingChat,
    getGitTurnOptions,
    limitResetTarget,
    handleQueueLimitReset,
    handleCancelEditMessage,
    handleCancelWorktreeCreation,
    handleContinueStoppedTurn,
    handleDeletePendingMessage,
    handleEditMessage,
    handleEditPendingMessage,
    handleInterruptPendingMessage,
    handleLoadWorkingItem,
    handleLoadWorkingStep,
    handleLoadWorkingToolPage,
    handleResolveApproval,
    handleResolveChatApproval,
    handleRetryStoppedTurn,
    handleSendMessage,
    handleStartGoalChat,
    handleSteerPendingMessage,
    handleCompactChat,
    handleStopChat,
    resolveSelectedUserInput
  }
}
