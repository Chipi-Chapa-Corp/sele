import type { DropdownOption } from '../../components/Dropdown'
import { type NewSessionLocation } from '../controllerTypes'
import { useWorkspaceTurnRendering } from '../features/useWorkspaceTurnRendering'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceConversationComposer({
  chatPreset,
  chatErrors,
  session,
  providerState,
  preferences,
  interactions,
  sourceControls,
  projectState,
  chatState,
  settings,
  effectiveSelection,
  settingsActions,
  messaging,
  sidebarActions,
  providerUpdates,
  files,
  conversation,
  projectResources,
  sourceState,
  turnRendering,
  provider,
  newSessionLocationOptions,
  projectCatalog,
  dialogState
}: WorkspaceChanges & {
  turnRendering: ReturnType<typeof useWorkspaceTurnRendering>
  newSessionLocationOptions: DropdownOption<NewSessionLocation>[]
}) {
  return {
    handleChatPresetChange: chatPreset.handleChatPresetChange,
    openCodeConnectionFailure: chatErrors.openCodeConnectionFailure,
    handleManageOpenCodeProviders: chatErrors.handleManageOpenCodeProviders,
    authenticationRequired: chatErrors.authenticationRequired,
    handleOpenChatReauthentication: chatErrors.handleOpenChatReauthentication,
    handleManageChatAccounts: chatErrors.handleManageChatAccounts,
    accountUsage: session.accountUsage,
    accountUsageError: session.accountUsageError,
    accountUsageState: session.accountUsageState,
    activeSubagentChatView: session.activeSubagentChatView
      ? {
          summary: {
            id: session.activeSubagentChatView.summary.id,
            canMessage: session.activeSubagentChatView.summary.canMessage
          }
        }
      : null,
    agentModes: providerState.agentModes,
    agentModesLoading: providerState.agentModesLoading,
    appSettings: preferences.appSettings,
    approvalDecisionInFlight: session.approvalDecisionInFlight,
    approvalError: session.approvalError,
    approvalModes: providerState.approvalModes,
    changesContainer: session.changesContainer,
    changesCwd: session.changesCwd,
    changesProjectCwd: session.changesProjectCwd,
    chatHasActiveTurn: interactions.chatHasActiveTurn,
    chatHasPendingSteeringMessage: interactions.chatHasPendingSteeringMessage,
    containerOptions: sourceControls.containerOptions,
    cwdNotesByGroup: projectState.cwdNotesByGroup,
    editingMessage: chatState.editingMessage,
    effectiveAppSettings: settings.effectiveAppSettings,
    agentMode: providerState.agentMode,
    effectiveApprovalMode: effectiveSelection.effectiveApprovalMode,
    effectiveModel: effectiveSelection.effectiveModel,
    effectiveReasoningEffort: effectiveSelection.effectiveReasoningEffort,
    effectiveSandboxMode: effectiveSelection.effectiveSandboxMode,
    effectiveServiceTier: effectiveSelection.effectiveServiceTier,
    handleActionsChange: settingsActions.handleActionsChange,
    handleApprovalModeChange: settingsActions.handleApprovalModeChange,
    handleCancelEditMessage: messaging.handleCancelEditMessage,
    handleCancelWorktreeCreation: messaging.handleCancelWorktreeCreation,
    handleCwdNotesChange: sidebarActions.handleCwdNotesChange,
    handleDismissSendError: chatErrors.handleDismissSendError,
    handleLastActionChange: settingsActions.handleLastActionChange,
    handleModelChange: settingsActions.handleModelChange,
    handleNeverSuggestProviderUpdate: providerUpdates.handleNeverSuggestProviderUpdate,
    handleNeverSuggestProviderUpdateVersion:
      providerUpdates.handleNeverSuggestProviderUpdateVersion,
    handleNewSessionContainerChange: sourceControls.handleNewSessionContainerChange,
    handleNewSessionRemoteRuntimeChange: sourceControls.handleNewSessionRemoteRuntimeChange,
    handleOpenAttachment: files.handleOpenAttachment,
    handleOpenFileLink: files.handleOpenFileLink,
    handleReasoningEffortChange: settingsActions.handleReasoningEffortChange,
    handleRetryChatLoad: chatErrors.handleRetryChatLoad,
    chatLoadFailed: chatErrors.chatLoadFailed,
    handleResolveApproval: messaging.handleResolveApproval,
    handleRunAction: session.handleRunAction,
    handleSandboxModeChange: settingsActions.handleSandboxModeChange,
    handleSelectedReviewChange: files.handleSelectedReviewChange,
    handleSendMessage: messaging.handleSendMessage,
    handleQueueLimitReset: messaging.handleQueueLimitReset,
    limitResetTarget: messaging.limitResetTarget,
    handleSkipProviderUpdate: providerUpdates.handleSkipProviderUpdate,
    handleCompactChat: messaging.handleCompactChat,
    handleStopChat: messaging.handleStopChat,
    handleUpdateProvider: providerUpdates.handleUpdateProvider,
    hasForcedChatDropdown: effectiveSelection.hasForcedChatDropdown,
    messageBoxContextUsage: conversation.messageBoxContextUsage,
    messageBoxDisabled: conversation.messageBoxDisabled,
    messageBoxNotesGroup: projectResources.messageBoxNotesGroup,
    messageBoxProviderAvailable: conversation.messageBoxProviderAvailable,
    promptSuggestion:
      chatState.selectedChat &&
      chatState.chatDetail?.id === chatState.selectedChat.id &&
      !chatState.chatDetail.historyPreview
        ? chatState.chatDetail.promptSuggestion
        : null,
    goalObjective:
      chatState.selectedChat && chatState.chatDetail?.id === chatState.selectedChat.id
        ? (chatState.chatDetail.goal?.objective ?? null)
        : null,
    onSetGoal:
      !session.activeSubagentChatView &&
      (chatState.selectedChat
        ? chatState.chatDetail?.id === chatState.selectedChat.id &&
          chatState.chatDetail.capabilities.setGoal &&
          !chatState.chatDetail.historyPreview
        : sourceState.newChatOpen &&
          sourceState.newSessionProviderAvailable &&
          sourceState.newSessionProvider !== 'opencode-v2')
        ? turnRendering.handleSaveGoalObjective
        : undefined,
    messageBoxQuoteRequest: chatState.messageBoxQuoteRequest,
    handleQuoteRequestHandled: chatState.handleQuoteRequestHandled,
    models: provider.models,
    modelsError: providerState.modelsError,
    modelsLoading: providerState.modelsLoading,
    newChatOpen: sourceState.newChatOpen,
    newSessionContainerValue: sourceControls.newSessionContainerValue,
    newSessionCwd: sourceState.newSessionCwd,
    newSessionNoProject: sourceState.newSessionNoProject,
    newSessionLocation: sourceState.newSessionLocation,
    newSessionLocationOptions,
    newSessionProjectValue: projectCatalog.newSessionProjectValue,
    newSessionProvider: sourceState.newSessionProvider,
    newSessionProviderOptions: sourceControls.newSessionProviderOptions,
    newSessionProviderValueContent: sourceControls.newSessionProviderValueContent,
    newSessionRemoteRuntime: sourceControls.newSessionRemoteRuntime,
    newSessionSshEnvironmentId: sourceState.newSessionSshEnvironmentId,
    pendingApproval: session.pendingApproval,
    pendingUserInput: session.pendingUserInput,
    projectOptions: projectCatalog.projectOptions,
    providerResourcesRevision: providerState.providerResourcesRevision,
    providerUpdateErrors: providerUpdates.providerUpdateErrors,
    anyProviderUpdateInProgress: providerUpdates.anyProviderUpdateInProgress,
    providerUpdateInProgress: providerUpdates.providerUpdateInProgress,
    updatingProviderUpdateKey: providerUpdates.updatingProviderUpdateKey,
    providerUpdateSuggestions: providerUpdates.providerUpdateSuggestions,
    refreshAccountUsage: session.refreshAccountUsage,
    remoteContainerSuggestionsError: sourceState.remoteContainerSuggestionsError,
    remoteContainerSuggestionsLoading: sourceState.remoteContainerSuggestionsLoading,
    remoteRuntimeOptions: sourceControls.remoteRuntimeOptions,
    requestErrorSummary: chatErrors.requestErrorSummary,
    requestErrorVisible: chatErrors.requestErrorVisible,
    chatOpenedElsewhere: chatErrors.chatOpenedElsewhere,
    chatLegacyHistoryReadOnly: chatErrors.chatLegacyHistoryReadOnly,
    resetAccountRateLimits: session.resetAccountRateLimits,
    resolveSelectedUserInput: messaging.resolveSelectedUserInput,
    sandboxModes: providerState.sandboxModes,
    selectedChat: chatState.selectedChat
      ? { id: chatState.selectedChat.id, providerId: chatState.selectedChat.providerId }
      : null,
    selectedChatKey: session.selectedChatKey,
    selectedReview: dialogState.selectedReview,
    sendState: chatState.sendState,
    setEditingSshEnvironment: sourceState.setEditingSshEnvironment,
    setAgentMode: providerState.setAgentMode,
    setNewSessionCwd: sourceState.setNewSessionCwd,
    setNewSessionLocation: sourceState.setNewSessionLocation,
    setNewSessionProvider: sourceState.setNewSessionProvider,
    setProjectDialogOpen: projectState.setProjectDialogOpen,
    setRemoteContainerSuggestionsError: sourceState.setRemoteContainerSuggestionsError,
    setServiceTier: providerState.setServiceTier,
    setSshEnvironmentDialogOpen: sourceState.setSshEnvironmentDialogOpen,
    setSshEnvironmentError: sourceState.setSshEnvironmentError,
    sshEnvironmentError: sourceState.sshEnvironmentError,
    terminalWorkspaceKey: session.terminalWorkspaceKey,
    userInputError: session.userInputError,
    userInputResolving: session.userInputResolving,
    worktreeCreationState: sourceState.worktreeCreationState
  }
}
