import { useWorkspaceSidebarPresentation } from '../features/useWorkspaceSidebarPresentation'
import { useWorkspaceSubagentPresentation } from '../features/useWorkspaceSubagentPresentation'
import { useWorkspaceTurnRendering } from '../features/useWorkspaceTurnRendering'
import { getWorkspaceChangesContent } from '../presentation/getWorkspaceChangesContent'
import { getWorkspaceChangesFooter } from '../presentation/getWorkspaceChangesFooter'
import { getWorkspaceChangesHeader } from '../presentation/getWorkspaceChangesHeader'
import { getWorkspaceChatSidebar } from '../presentation/getWorkspaceChatSidebar'
import { getWorkspaceConversationComposer } from '../presentation/getWorkspaceConversationComposer'
import { getWorkspaceConversationHeader } from '../presentation/getWorkspaceConversationHeader'
import { getWorkspaceConversationMessages } from '../presentation/getWorkspaceConversationMessages'
import { getWorkspaceConversationSearch } from '../presentation/getWorkspaceConversationSearch'
import { getWorkspaceDialogs } from '../presentation/getWorkspaceDialogs'
import { getWorkspaceSettingsPanel } from '../presentation/getWorkspaceSettingsPanel'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import { useWorkspaceChangesModel } from './useWorkspaceChangesModel'
import { useWorkspaceChatModel } from './useWorkspaceChatModel'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspacePresentationDependencies = {
  state: ReturnType<typeof useWorkspaceState>
  session: ReturnType<typeof useWorkspaceSession>
  chatModel: ReturnType<typeof useWorkspaceChatModel>
  changesModel: ReturnType<typeof useWorkspaceChangesModel>
  runtime: ReturnType<typeof useWorkspaceRuntime>
}

export function useWorkspacePresentation({
  state,
  session,
  chatModel,
  changesModel,
  runtime
}: WorkspacePresentationDependencies) {
  const chatPanelOpen = Boolean(state.chatState.selectedChat) || state.sourceState.newChatOpen

  const subagentPresentation = useWorkspaceSubagentPresentation({
    subagentState: state.subagentState,
    chatState: state.chatState,
    session,
    conversation: chatModel.conversation,
    subagents: changesModel.subagents
  })

  const sidebarPresentation = useWorkspaceSidebarPresentation({
    chatState: state.chatState,
    subagentState: state.subagentState,
    subagentPresentation: subagentPresentation,
    session,
    interactions: chatModel.interactions
  })

  const settingsPanel = getWorkspaceSettingsPanel({
    settings: runtime.settings,
    preferences: state.preferences,
    accountActions: chatModel.accountActions,
    session,
    sourceControls: chatModel.sourceControls,
    settingsOptions: chatModel.settingsOptions,
    settingsActions: chatModel.settingsActions,
    gitModels: chatModel.gitModels,
    provider: runtime.provider,
    projectState: state.projectState,
    chatState: state.chatState,
    resourceActions: chatModel.resourceActions,
    sourceState: state.sourceState,
    providerState: state.providerState,
    chrome: runtime.chrome
  })

  const turnRendering = useWorkspaceTurnRendering({
    subagentPresentation: subagentPresentation,
    effectiveSelection: chatModel.effectiveSelection,
    settings: runtime.settings,
    providerState: state.providerState,
    scroll: runtime.scroll,
    chatState: state.chatState,
    chatErrors: chatModel.chatErrors,
    session,
    messaging: chatModel.messaging,
    interactions: chatModel.interactions,
    conversation: chatModel.conversation,
    files: changesModel.files,
    subagents: changesModel.subagents
  })

  return {
    providerRuntimeLabels: state.sourceState.providerRuntimeLabels,
    className: `chat${chatPanelOpen ? ' chat--has-selection' : ' chat--no-selection'}`,
    openLinkedChat: chatModel.navigation.openLinkedChat,
    dialogs: getWorkspaceDialogs({
      preferences: state.preferences,
      settingsPanel,
      settings: runtime.settings,
      providerState: state.providerState,
      accountActions: chatModel.accountActions,
      projectState: state.projectState,
      sourceState: state.sourceState,
      settingsActions: chatModel.settingsActions,
      sourceControls: chatModel.sourceControls,
      dialogState: state.dialogState,
      changes: changesModel.changes,
      files: changesModel.files
    }),
    layout: {
      changesSidebarExpanded: runtime.panes.changesSidebarExpanded,
      panelsRef: runtime.panes.panelsRef,
      panelsStyle: runtime.panes.panelsStyle,
      resizeHandleRef: runtime.panes.resizeHandleRef,
      changesResizeHandleRef: runtime.panes.changesResizeHandleRef,
      handleStartChatResize: runtime.panes.handleStartChatResize
    },
    chatSidebar: getWorkspaceChatSidebar({
      session,
      sourceState: state.sourceState,
      chatState: state.chatState,
      provider: runtime.provider,
      effectiveSelection: chatModel.effectiveSelection,
      conversation: chatModel.conversation,
      settings: runtime.settings,
      providerUpdates: runtime.providerUpdates,
      interactions: chatModel.interactions,
      messaging: chatModel.messaging,
      chatErrors: chatModel.chatErrors,
      providerState: state.providerState,
      accountActions: chatModel.accountActions,
      sidebarModel: chatModel.sidebarModel,
      projectState: state.projectState,
      navigation: chatModel.navigation,
      chrome: runtime.chrome,
      listActions: chatModel.listActions,
      sidebarPresentation,
      searchState: state.searchState
    }),
    conversationHeader: getWorkspaceConversationHeader({
      chatState: state.chatState,
      sourceState: state.sourceState,
      navigation: chatModel.navigation
    }),
    conversationSearch: getWorkspaceConversationSearch({
      chatState: state.chatState,
      searchState: state.searchState,
      session,
      navigation: chatModel.navigation
    }),
    conversationMessages: getWorkspaceConversationMessages({
      chatState: state.chatState,
      chatCache: runtime.chatCache,
      viewportState: state.viewportState,
      scroll: runtime.scroll,
      session,
      interactions: chatModel.interactions,
      searchState: state.searchState,
      gitState: state.gitState,
      conversation: chatModel.conversation,
      commits: changesModel.commits,
      subagents: changesModel.subagents,
      turnRendering,
      subagentState: state.subagentState
    }),
    conversationComposer: getWorkspaceConversationComposer({
      chatPreset: chatModel.chatPreset,
      chatErrors: chatModel.chatErrors,
      session,
      providerState: state.providerState,
      preferences: state.preferences,
      interactions: chatModel.interactions,
      sourceControls: chatModel.sourceControls,
      projectState: state.projectState,
      chatState: state.chatState,
      settings: runtime.settings,
      effectiveSelection: chatModel.effectiveSelection,
      settingsActions: chatModel.settingsActions,
      messaging: chatModel.messaging,
      sidebarActions: chatModel.sidebarActions,
      providerUpdates: runtime.providerUpdates,
      files: changesModel.files,
      conversation: chatModel.conversation,
      projectResources: chatModel.projectResources,
      sourceState: state.sourceState,
      turnRendering,
      provider: runtime.provider,
      newSessionLocationOptions: changesModel.newSessionLocationOptions,
      projectCatalog: chatModel.projectCatalog,
      dialogState: state.dialogState
    }),
    changesHeader: getWorkspaceChangesHeader({
      gitHubPullRequests: chatModel.gitHubPullRequests,
      panes: runtime.panes,
      settings: runtime.settings,
      gitPresentation: changesModel.gitPresentation,
      changes: changesModel.changes,
      session,
      gitState: state.gitState,
      files: changesModel.files,
      gitSync: changesModel.gitSync,
      chrome: runtime.chrome
    }),
    changesContent: getWorkspaceChangesContent({
      gitHubPullRequests: chatModel.gitHubPullRequests,
      panes: runtime.panes,
      browser: runtime.browser,
      chatState: state.chatState,
      dialogState: state.dialogState,
      session,
      gitPresentation: changesModel.gitPresentation,
      changes: changesModel.changes,
      conversation: chatModel.conversation,
      settings: runtime.settings,
      gitState: state.gitState,
      gitSync: changesModel.gitSync,
      files: changesModel.files
    }),
    changesFooter: getWorkspaceChangesFooter({
      panes: runtime.panes,
      gitPresentation: changesModel.gitPresentation,
      gitState: state.gitState,
      session,
      commits: changesModel.commits,
      gitSync: changesModel.gitSync,
      changes: changesModel.changes
    }),
    conversationPanel: {
      selectedChat: state.chatState.selectedChat
        ? {
            id: state.chatState.selectedChat.id,
            providerId: state.chatState.selectedChat.providerId,
            title: state.chatState.selectedChat.title
          }
        : null,
      newChatOpen: state.sourceState.newChatOpen,
      activeSubagentChatView: session.activeSubagentChatView
        ? { summary: { title: session.activeSubagentChatView.summary.title } }
        : null
    },
    conversationQuote: {
      visible: Boolean(state.chatState.selectedChat && !session.activeSubagentChatView),
      contentRef: state.viewportState.contentRef,
      editingMessage: state.chatState.editingMessage,
      selectedChatKey: session.selectedChatKey,
      handleQuoteSelectedMessageText: chatModel.interactions.handleQuoteSelectedMessageText
    },
    conversationEmptyState: {
      visible: Boolean(!state.chatState.selectedChat && state.sourceState.newChatOpen)
    },
    conversationPlan: {
      visible: !session.activeSubagentChatView,
      selectedChatKey: session.selectedChatKey,
      messageBoxPlan: runtime.settings.effectiveAppSettings.chat.hidePlans
        ? null
        : session.messageBoxPlan,
      goal:
        state.chatState.selectedChat &&
        state.chatState.chatDetail?.id === state.chatState.selectedChat.id &&
        state.chatState.chatDetail.capabilities.setGoal
          ? (state.chatState.chatDetail.goal ?? null)
          : null,
      onSaveGoalObjective: turnRendering.handleSaveGoalObjective
    }
  }
}
