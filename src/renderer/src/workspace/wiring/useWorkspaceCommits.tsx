import { useWorkspaceChatProjection } from '../features/useWorkspaceChatProjection'
import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceNavigation } from '../features/useWorkspaceNavigation'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useCommitController } from '../useCommitController'
import { useWorkspaceChanges } from './useWorkspaceChanges'
import { useWorkspaceGitPresentation } from './useWorkspaceGitPresentation'
import { useWorkspaceGitSync } from './useWorkspaceGitSync'
import { useWorkspaceMessaging } from './useWorkspaceMessaging'
import { useWorkspaceProviderUpdates } from './useWorkspaceProviderUpdates'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceCommitsDependencies = {
  gitState: ReturnType<typeof useWorkspaceGitState>
  providerUpdates: ReturnType<typeof useWorkspaceProviderUpdates>
  chatState: ReturnType<typeof useWorkspaceChatState>
  session: ReturnType<typeof useWorkspaceSession>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  gitPresentation: ReturnType<typeof useWorkspaceGitPresentation>
  messaging: ReturnType<typeof useWorkspaceMessaging>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  chatProjection: ReturnType<typeof useWorkspaceChatProjection>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  changes: ReturnType<typeof useWorkspaceChanges>
  gitSync: ReturnType<typeof useWorkspaceGitSync>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  navigation: ReturnType<typeof useWorkspaceNavigation>
}

export function useWorkspaceCommits({
  gitState,
  providerUpdates,
  chatState,
  session,
  sourceState,
  gitPresentation,
  messaging,
  viewportState,
  chatProjection,
  settings,
  changes,
  gitSync,
  chatRead,
  searchState,
  subagentState,
  navigation
}: WorkspaceCommitsDependencies) {
  const {
    handleAiCommitChangedFiles,
    handleCancelAiCommit,
    handleGenerateCommitMessage,
    handleManualCommitChangedFiles,
    handleOpenAiCommitChat,
    handleQuickCommitChangedFiles,
    handleReturnFromAiCommitChat
  } = useCommitController({
    startingScopedCommitActivitiesRef: gitState.startingScopedCommitActivitiesRef,
    scopedCommitActivitiesRef: gitState.scopedCommitActivitiesRef,
    providerUpdateInProgress: providerUpdates.providerUpdateInProgress,
    selectedChat: chatState.selectedChat,
    chatDetail: chatState.chatDetail,
    changesCwd: session.changesCwd,
    newSessionProvider: sourceState.newSessionProvider,
    changesProjectCwd: session.changesProjectCwd,
    projectCommitInProgress: gitPresentation.projectCommitInProgress,
    commitInFlightProjectKeysRef: gitState.commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef: gitState.commitMessageGenerationProjectKeysRef,
    branchActionProjectKeysRef: gitState.branchActionProjectKeysRef,
    syncProjectKeysRef: gitState.syncProjectKeysRef,
    sendInFlightRef: chatState.sendInFlightRef,
    sendInFlightProjectKeyRef: chatState.sendInFlightProjectKeyRef,
    getGitTurnOptions: messaging.getGitTurnOptions,
    setStartingScopedCommitActivities: gitState.setStartingScopedCommitActivities,
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    setCommitErrorsByProjectKey: gitState.setCommitErrorsByProjectKey,
    setChatCommitMarkers: gitState.setChatCommitMarkers,
    applyChatDetail: chatProjection.applyChatDetail,
    changesCwdRef: gitState.changesCwdRef,
    setCommitInput: gitState.setCommitInput,
    setScopedCommitActivities: gitState.setScopedCommitActivities,
    commitMessageGenerationDisabled: gitPresentation.commitMessageGenerationDisabled,
    setCommitMessageGenerationProjectKeys: gitState.setCommitMessageGenerationProjectKeys,
    changesContainer: session.changesContainer,
    effectiveAppSettings: settings.effectiveAppSettings,
    aiCommitInstructions: gitPresentation.aiCommitInstructions,
    commitInputValue: gitPresentation.commitInputValue,
    getCommitActionDisabled: gitPresentation.getCommitActionDisabled,
    setDirectCommitActivities: gitState.setDirectCommitActivities,
    patchChangeSourceSelected: changes.patchChangeSourceSelected,
    changedFiles: changes.changedFiles,
    setGitChangeLoadRequest: gitState.setGitChangeLoadRequest,
    pushAfterCommit: gitPresentation.pushAfterCommit,
    runSyncChanges: gitSync.runSyncChanges,
    getAiCommitActionDisabled: gitPresentation.getAiCommitActionDisabled,
    cancelingAiCommitKeys: gitState.cancelingAiCommitKeys,
    setCancelingAiCommitKeys: gitState.setCancelingAiCommitKeys,
    openingAiCommitChatIds: gitState.openingAiCommitChatIds,
    chatsRef: chatState.chatsRef,
    setOpeningAiCommitChatIds: gitState.setOpeningAiCommitChatIds,
    markSelectedChatSeen: chatRead.markSelectedChatSeen,
    setSendState: chatState.setSendState,
    setEditingMessage: chatState.setEditingMessage,
    setSearchOpen: searchState.setSearchOpen,
    setSearchQuery: searchState.setSearchQuery,
    subagentChatLoadRequestRef: subagentState.subagentChatLoadRequestRef,
    setSubagentChatView: subagentState.setSubagentChatView,
    setCommitChatReturnTarget: gitState.setCommitChatReturnTarget,
    applyViewedChatDetail: chatRead.applyViewedChatDetail,
    commitChatReturnTarget: gitState.commitChatReturnTarget,
    handleSelectChat: navigation.handleSelectChat,
    hasAiCommitInProgressForProject: gitSync.hasAiCommitInProgressForProject
  })
  return {
    handleAiCommitChangedFiles,
    handleCancelAiCommit,
    handleGenerateCommitMessage,
    handleManualCommitChangedFiles,
    handleOpenAiCommitChat,
    handleQuickCommitChangedFiles,
    handleReturnFromAiCommitChat
  }
}
