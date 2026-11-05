import { useWorkspaceChatErrors } from '../features/useWorkspaceChatErrors'
import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceEffectiveSelection } from '../features/useWorkspaceEffectiveSelection'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useConversationViewModel } from '../useConversationViewModel'
import { useWorkspaceInteractions } from './useWorkspaceInteractions'
import { useWorkspaceProviderUpdates } from './useWorkspaceProviderUpdates'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceConversationDependencies = {
  provider: ReturnType<typeof useWorkspaceProviderContext>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerUpdates: ReturnType<typeof useWorkspaceProviderUpdates>
  session: ReturnType<typeof useWorkspaceSession>
  interactions: ReturnType<typeof useWorkspaceInteractions>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  panes: ReturnType<typeof useWorkspacePanes>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  scroll: ReturnType<typeof useWorkspaceScroll>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  gitState: ReturnType<typeof useWorkspaceGitState>
}

export function useWorkspaceConversation({
  provider,
  effectiveSelection,
  chatErrors,
  chatState,
  sourceState,
  providerUpdates,
  session,
  interactions,
  settings,
  panes,
  viewportState,
  scroll,
  chatRead,
  gitState
}: WorkspaceConversationDependencies) {
  const {
    canEditOwnMessages,
    canRetryStoppedTurns,
    chatCommitMarkersByAfterItemId,
    chatCommitMarkersByBeforeItemId,
    chatItemIndexesById,
    continuedStoppedWorkingStepIds,
    displayedRecentChatReferences,
    effectiveChatTurnWindow,
    firstPendingChatItemId,
    followingWorkingStepsById,
    steeredWorkingStepDisclosureTargets,
    handleNativeChatContentScroll,
    handleNativeChatContentWheel,
    loadChatTurnPage,
    messageBoxContextUsage,
    messageBoxDisabled,
    messageBoxProviderAvailable,
    pinnedChatMessageIds,
    recentlyOpenedFiles,
    renderedChatTurns,
    stoppedTurnActionDisabled,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    subagentChatConversationModel,
    subagentChatItemIndexesById,
    subagentVisibleChatItems,
    trailingChatCommitMarkers,
    visibleChatItems,
    workingStepIdsWithNextWorkingStep
  } = useConversationViewModel({
    modelUnavailable:
      provider.configProviderId === 'opencode-v2' && !effectiveSelection.effectiveModel,
    authenticationRequired: chatErrors.authenticationRequired,
    selectedChat: chatState.selectedChat,
    newSessionProviderAvailable: sourceState.newSessionProviderAvailable,
    providerUpdateInProgress: providerUpdates.providerUpdateInProgress,
    chatLoadState: chatState.chatLoadState,
    activeSubagentChatView: session.activeSubagentChatView,
    chatHasActiveTurn: interactions.chatHasActiveTurn,
    chatDetail: chatState.chatDetail,
    sendState: chatState.sendState,
    editingMessage: chatState.editingMessage,
    selectedChatSubagents: session.selectedChatSubagents,
    effectiveAppSettings: settings.effectiveAppSettings,
    selectedChatId: session.selectedChatId,
    selectedChatKey: session.selectedChatKey,
    recentChatReferencePage: chatState.recentChatReferencePage,
    recentChatReferencesCache: chatState.recentChatReferencesCache,
    pinnedRecentChatReferences: chatState.pinnedRecentChatReferences,
    recentlyOpenedFilesByWorkspace: chatState.recentlyOpenedFilesByWorkspace,
    recentlyOpenedFilesWorkspaceKey: session.recentlyOpenedFilesWorkspaceKey,
    changesPaneView: panes.changesPaneView,
    selectedProviderId: session.selectedProviderId,
    setRecentChatReferencePage: chatState.setRecentChatReferencePage,
    setRecentChatReferencesCache: chatState.setRecentChatReferencesCache,
    chatTurnWindow: chatState.chatTurnWindow,
    chatAtConversationBottom: chatState.chatAtConversationBottom,
    pendingPinnedMessageNavigationRef: viewportState.pendingPinnedMessageNavigationRef,
    scrollPinnedChatMessageIntoView: scroll.scrollPinnedChatMessageIntoView,
    chatTurnPageLoadRequestRef: viewportState.chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef: viewportState.chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef: viewportState.chatTurnScrollDirectionRef,
    setChatTurnPageLoadDirection: chatState.setChatTurnPageLoadDirection,
    chatTurnWindowRef: chatState.chatTurnWindowRef,
    setChatTurnWindow: chatState.setChatTurnWindow,
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    scrollToLatestTurnAfterRenderRef: viewportState.scrollToLatestTurnAfterRenderRef,
    pendingChatScrollAnchorRef: viewportState.pendingChatScrollAnchorRef,
    contentRef: viewportState.contentRef,
    chatScrollAdjustmentTargetRef: viewportState.chatScrollAdjustmentTargetRef,
    chatViewportAnchorRef: viewportState.chatViewportAnchorRef,
    scrollChatContentToBottom: scroll.scrollChatContentToBottom,
    selectedChatRef: chatState.selectedChatRef,
    selectedChatKeyRef: chatState.selectedChatKeyRef,
    applyViewedChatDetail: chatRead.applyViewedChatDetail,
    chatAutoScrollTargetRef: viewportState.chatAutoScrollTargetRef,
    setChatDetail: chatState.setChatDetail,
    chatDetailRef: chatState.chatDetailRef,
    handleChatContentScroll: interactions.handleChatContentScroll,
    handleChatContentWheel: interactions.handleChatContentWheel,
    continuedStoppedWorkingStepsByChat: gitState.continuedStoppedWorkingStepsByChat,
    selectedChatCommitMarkers: session.selectedChatCommitMarkers
  })
  return {
    canEditOwnMessages,
    canRetryStoppedTurns,
    chatCommitMarkersByAfterItemId,
    chatCommitMarkersByBeforeItemId,
    chatItemIndexesById,
    continuedStoppedWorkingStepIds,
    displayedRecentChatReferences,
    effectiveChatTurnWindow,
    firstPendingChatItemId,
    followingWorkingStepsById,
    steeredWorkingStepDisclosureTargets,
    handleNativeChatContentScroll,
    handleNativeChatContentWheel,
    loadChatTurnPage,
    messageBoxContextUsage,
    messageBoxDisabled,
    messageBoxProviderAvailable,
    pinnedChatMessageIds,
    recentlyOpenedFiles,
    renderedChatTurns,
    stoppedTurnActionDisabled,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    subagentChatConversationModel,
    subagentChatItemIndexesById,
    subagentVisibleChatItems,
    trailingChatCommitMarkers,
    visibleChatItems,
    workingStepIdsWithNextWorkingStep
  }
}
