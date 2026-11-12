import { useWorkspaceChatCache } from '../features/useWorkspaceChatCache'
import { useWorkspaceChatProjection } from '../features/useWorkspaceChatProjection'
import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceSidebarModel } from '../features/useWorkspaceSidebarModel'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useChatListController } from '../useChatListController'

type WorkspaceChatListActionsDependencies = {
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatProjection: ReturnType<typeof useWorkspaceChatProjection>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  sidebarModel: ReturnType<typeof useWorkspaceSidebarModel>
}

export function useWorkspaceChatListActions({
  chatRead,
  chatCache,
  chatState,
  chatProjection,
  sourceState,
  projectState,
  sidebarModel
}: WorkspaceChatListActionsDependencies) {
  return useChatListController({
    applyChatMetadata: chatRead.applyChatMetadata,
    removeRecentChatCacheEntry: chatCache.removeRecentChatCacheEntry,
    selectedChat: chatState.selectedChat,
    selectedChatKeyRef: chatState.selectedChatKeyRef,
    chatDetail: chatState.chatDetail,
    showNewChatView: chatProjection.showNewChatView,
    newSessionContainer: sourceState.newSessionContainer,
    applyChatDetail: chatProjection.applyChatDetail,
    chatOrderMutationsRef: chatState.chatOrderMutationsRef,
    setChats: chatState.setChats,
    projectCollapseFrameRef: projectState.projectCollapseFrameRef,
    expandedProjectGroupsBeforeDragRef: projectState.expandedProjectGroupsBeforeDragRef,
    draggedProjectGroupKeyRef: projectState.draggedProjectGroupKeyRef,
    projectDropInsertionIndexRef: projectState.projectDropInsertionIndexRef,
    setDraggedProjectGroupKey: projectState.setDraggedProjectGroupKey,
    setProjectDropInsertionIndex: projectState.setProjectDropInsertionIndex,
    activeChatGroups: sidebarModel.activeChatGroups,
    setCollapsedCwdGroups: projectState.setCollapsedCwdGroups,
    projectOrderMutationRef: projectState.projectOrderMutationRef,
    projects: projectState.projects,
    setProjects: projectState.setProjects,
    chatGroupingPreference: projectState.chatGroupingPreference,
    searchTerms: sidebarModel.searchTerms,
    collapsedCwdGroups: projectState.collapsedCwdGroups
  })
}
