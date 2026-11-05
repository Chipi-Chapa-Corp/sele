import { getChatKey } from '../chatControllerUtils'
import { useWorkspaceBrowser } from '../features/useWorkspaceBrowser'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceDialogState } from '../state/useWorkspaceDialogState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useGitHubPullRequests } from '../useGitHubPullRequests'
import { useWorkspaceChanges } from '../wiring/useWorkspaceChanges'
import { useWorkspaceConversation } from '../wiring/useWorkspaceConversation'
import { useWorkspaceFiles } from '../wiring/useWorkspaceFiles'
import { useWorkspaceGitPresentation } from '../wiring/useWorkspaceGitPresentation'
import { useWorkspaceGitSync } from '../wiring/useWorkspaceGitSync'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'

type WorkspaceChangesContentDependencies = {
  gitHubPullRequests: ReturnType<typeof useGitHubPullRequests>
  panes: ReturnType<typeof useWorkspacePanes>
  browser: ReturnType<typeof useWorkspaceBrowser>
  chatState: ReturnType<typeof useWorkspaceChatState>
  dialogState: ReturnType<typeof useWorkspaceDialogState>
  session: ReturnType<typeof useWorkspaceSession>
  gitPresentation: ReturnType<typeof useWorkspaceGitPresentation>
  changes: ReturnType<typeof useWorkspaceChanges>
  conversation: ReturnType<typeof useWorkspaceConversation>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  gitState: ReturnType<typeof useWorkspaceGitState>
  gitSync: ReturnType<typeof useWorkspaceGitSync>
  files: ReturnType<typeof useWorkspaceFiles>
}

export function getWorkspaceChangesContent({
  gitHubPullRequests,
  panes,
  browser,
  chatState,
  dialogState,
  session,
  gitPresentation,
  changes,
  conversation,
  settings,
  gitState,
  gitSync,
  files
}: WorkspaceChangesContentDependencies) {
  return {
    gitHubPullRequests,
    gitPaneView: panes.gitPaneView,
    handleOpenBrowserRequest: browser.handleOpenBrowserRequest,
    terminalChatKey: chatState.selectedChat ? getChatKey(chatState.selectedChat) : null,
    browserOpenRequest: dialogState.browserOpenRequest,
    browserOpened: dialogState.browserOpened,
    browserWorkspaceKey: session.browserWorkspaceKey,
    changeTree: gitPresentation.changeTree,
    changedFiles: changes.changedFiles,
    changesContainer: session.changesContainer,
    changesCwd: session.changesCwd,
    changesEmptyMessage: gitPresentation.changesEmptyMessage,
    changesPaneView: panes.changesPaneView,
    changesProjectCwd: session.changesProjectCwd,
    displayedGitChangeLoadError: changes.displayedGitChangeLoadError,
    displayedRecentChatReferences: conversation.displayedRecentChatReferences,
    effectiveAppSettings: settings.effectiveAppSettings,
    filesEmptyMessage: gitPresentation.filesEmptyMessage,
    fileTreeLoadError: gitState.fileTreeLoadError,
    setFileTreeLoadRequest: gitState.setFileTreeLoadRequest,
    handleDismissGitChangeLoadError: gitSync.handleDismissGitChangeLoadError,
    handleGitChangeLoadErrorAiResolution: gitSync.handleGitChangeLoadErrorAiResolution,
    handleGoToPinnedText: files.handleGoToPinnedText,
    handleOpenFileLink: files.handleOpenFileLink,
    handleReorderPinnedRecentReferences: files.handleReorderPinnedRecentReferences,
    handleSolveUntrackedFiles: gitSync.handleSolveUntrackedFiles,
    handleToggleRecentReferencePinned: files.handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences: files.handleUnpinAllRecentReferences,
    recentlyOpenedFiles: conversation.recentlyOpenedFiles,
    renderChangeTreeNode: files.renderChangeTreeNode,
    renderGitAiResolutionButton: gitSync.renderGitAiResolutionButton,
    renderRepositoryFileTreeNode: files.renderRepositoryFileTreeNode,
    repositoryFileCount: changes.repositoryFileCount,
    repositoryFileTree: gitPresentation.repositoryFileTree,
    setGitChangeLoadRequest: gitState.setGitChangeLoadRequest,
    terminalCommandLaunchRequest: dialogState.terminalCommandLaunchRequest,
    terminalOpened: dialogState.terminalOpened,
    terminalWorkspaceKey: session.terminalWorkspaceKey,
    untrackedFilesAiDisabled: gitPresentation.untrackedFilesAiDisabled,
    untrackedFilesHiddenForPerformance: changes.untrackedFilesHiddenForPerformance,
    visibleChangesLoadState: changes.visibleChangesLoadState,
    visibleFilesLoadState: changes.visibleFilesLoadState,
    visibleGitChangeLoadError: changes.visibleGitChangeLoadError
  }
}
