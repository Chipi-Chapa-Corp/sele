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
import { useWorkspaceSelection } from '../useWorkspaceSelection'
import { useWorkspaceChangesModel } from './useWorkspaceChangesModel'
import { useWorkspaceChatModel } from './useWorkspaceChatModel'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspacePresentationDependencies = {
  state: ReturnType<typeof useWorkspaceState>
  session: ReturnType<typeof useWorkspaceSelection>
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
  const workspace = { ...state, ...runtime, ...chatModel, ...changesModel, session }
  const chatPanelOpen = Boolean(state.chatState.selectedChat) || state.sourceState.newChatOpen

  const subagentPresentation = useWorkspaceSubagentPresentation(workspace)

  const sidebarPresentation = useWorkspaceSidebarPresentation({
    ...workspace,
    subagentPresentation
  })

  const settingsPanel = getWorkspaceSettingsPanel(workspace)

  const turnRendering = useWorkspaceTurnRendering({ ...workspace, subagentPresentation })

  return {
    providerRuntimeLabels: state.sourceState.providerRuntimeLabels,
    className: `chat${chatPanelOpen ? ' chat--has-selection' : ' chat--no-selection'}`,
    openLinkedChat: chatModel.navigation.openLinkedChat,
    dialogs: getWorkspaceDialogs({ ...workspace, settingsPanel }),
    layout: {
      changesSidebarExpanded: runtime.panes.changesSidebarExpanded,
      panelsRef: runtime.panes.panelsRef,
      panelsStyle: runtime.panes.panelsStyle,
      resizeHandleRef: runtime.panes.resizeHandleRef,
      changesResizeHandleRef: runtime.panes.changesResizeHandleRef,
      handleStartChatResize: runtime.panes.handleStartChatResize
    },
    chatSidebar: getWorkspaceChatSidebar({ ...workspace, sidebarPresentation }),
    conversationHeader: getWorkspaceConversationHeader(workspace),
    conversationSearch: getWorkspaceConversationSearch(workspace),
    conversationMessages: getWorkspaceConversationMessages({ ...workspace, turnRendering }),
    conversationComposer: getWorkspaceConversationComposer({ ...workspace, turnRendering }),
    changesHeader: getWorkspaceChangesHeader(workspace),
    changesContent: getWorkspaceChangesContent(workspace),
    changesFooter: getWorkspaceChangesFooter(workspace),
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
