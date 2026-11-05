import type { AppProject } from '../../../../shared/app'
import { useWorkspaceChatErrors } from '../features/useWorkspaceChatErrors'
import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceNavigation } from '../features/useWorkspaceNavigation'
import { useWorkspaceProjectCatalog } from '../features/useWorkspaceProjectCatalog'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceSidebarActions } from '../features/useWorkspaceSidebarActions'
import { useWorkspaceSidebarModel } from '../features/useWorkspaceSidebarModel'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useChatInteractionController } from '../useChatInteractionController'
import { useWorkspaceChatListActions } from './useWorkspaceChatListActions'
import { useWorkspaceMessaging } from './useWorkspaceMessaging'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceInteractionsDependencies = {
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  scroll: ReturnType<typeof useWorkspaceScroll>
  sidebarModel: ReturnType<typeof useWorkspaceSidebarModel>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  projectRecordsByCwd: Map<string, AppProject>
  projectCatalog: ReturnType<typeof useWorkspaceProjectCatalog>
  session: ReturnType<typeof useWorkspaceSession>
  sidebarActions: ReturnType<typeof useWorkspaceSidebarActions>
  listActions: ReturnType<typeof useWorkspaceChatListActions>
  navigation: ReturnType<typeof useWorkspaceNavigation>
  messaging: ReturnType<typeof useWorkspaceMessaging>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
}

export function useWorkspaceInteractions({
  viewportState,
  chatState,
  scroll,
  sidebarModel,
  projectState,
  settings,
  projectRecordsByCwd,
  projectCatalog,
  session,
  sidebarActions,
  listActions,
  navigation,
  messaging,
  chatRead,
  chatErrors
}: WorkspaceInteractionsDependencies) {
  const {
    chatHasActiveTurn,
    chatHasPendingSteeringMessage,
    chatIsBusy,
    handleChatContentScroll,
    handleChatContentWheel,
    handleForkMessage,
    handleQuoteSelectedMessageText,
    renderChatGroup
  } = useChatInteractionController({
    contentRef: viewportState.contentRef,
    chatTurnWindowRef: chatState.chatTurnWindowRef,
    chatScrollAdjustmentTargetRef: viewportState.chatScrollAdjustmentTargetRef,
    previousChatScrollTopRef: viewportState.previousChatScrollTopRef,
    chatTurnScrollDirectionRef: viewportState.chatTurnScrollDirectionRef,
    setChatAtConversationBottom: chatState.setChatAtConversationBottom,
    chatViewportAnchorRef: viewportState.chatViewportAnchorRef,
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    chatUserScrollIntentRef: viewportState.chatUserScrollIntentRef,
    chatAutoScrollTargetRef: viewportState.chatAutoScrollTargetRef,
    scheduleChatAutoScroll: scroll.scheduleChatAutoScroll,
    chatUserScrollIntentFrameRef: viewportState.chatUserScrollIntentFrameRef,
    searchTerms: sidebarModel.searchTerms,
    collapsedCwdGroups: projectState.collapsedCwdGroups,
    effectiveAppSettings: settings.effectiveAppSettings,
    visibleChatPageCountsByGroup: projectState.visibleChatPageCountsByGroup,
    projectRecordsByCwd,
    projectIconsByGroup: projectState.projectIconsByGroup,
    activeChatGroups: sidebarModel.activeChatGroups,
    chatGroupingPreference: projectState.chatGroupingPreference,
    doneProjectFilterValue: projectState.doneProjectFilterValue,
    projectOptions: projectCatalog.projectOptions,
    projectDropInsertionIndex: projectState.projectDropInsertionIndex,
    selectedChat: chatState.selectedChat,
    committingChatKeys: session.committingChatKeys,
    latestCommitFinishedAtByChatKey: session.latestCommitFinishedAtByChatKey,
    draggedProjectGroupKey: projectState.draggedProjectGroupKey,
    projectNamesByCwd: sidebarModel.projectNamesByCwd,
    handleDoneProjectFilterChange: sidebarActions.handleDoneProjectFilterChange,
    handleLoadMoreChatsInGroup: sidebarActions.handleLoadMoreChatsInGroup,
    handleShowLessChatsInGroup: sidebarActions.handleShowLessChatsInGroup,
    handleMarkChatDone: listActions.handleMarkChatDone,
    restoreExpandedProjectsAfterDrag: listActions.restoreExpandedProjectsAfterDrag,
    handleProjectDragStart: listActions.handleProjectDragStart,
    handleMarkCwdChatsDone: listActions.handleMarkCwdChatsDone,
    handleNewChatInCwd: navigation.handleNewChatInCwd,
    handleRenameChat: listActions.handleRenameChat,
    handleSelectProjectIcon: sidebarActions.handleSelectProjectIcon,
    handleResolveChatApproval: messaging.handleResolveChatApproval,
    handleReorderChats: listActions.handleReorderChats,
    handleSelectChat: navigation.handleSelectChat,
    handleToggleCwdGroup: sidebarActions.handleToggleCwdGroup,
    handleToggleChatPinned: listActions.handleToggleChatPinned,
    handleUnpinPinnedChats: listActions.handleUnpinPinnedChats,
    resolvingApprovalId: session.resolvingApprovalId,
    chatDetail: chatState.chatDetail,
    sendState: chatState.sendState,
    forkInFlightRef: chatState.forkInFlightRef,
    setSendState: chatState.setSendState,
    setSendError: chatState.setSendError,
    setForkingMessageId: chatState.setForkingMessageId,
    applyViewedChatDetail: chatRead.applyViewedChatDetail,
    handleSendFailure: chatErrors.handleSendFailure,
    setMessageBoxQuoteRequest: chatState.setMessageBoxQuoteRequest,
    runPromptActionRef: chatState.runPromptActionRef,
    handleSendMessage: messaging.handleSendMessage
  })
  return {
    chatHasActiveTurn,
    chatHasPendingSteeringMessage,
    chatIsBusy,
    handleChatContentScroll,
    handleChatContentWheel,
    handleForkMessage,
    handleQuoteSelectedMessageText,
    renderChatGroup
  }
}
