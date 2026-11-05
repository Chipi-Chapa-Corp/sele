import type { ProviderChatUpdateSummary, ProviderId } from '../../../../shared/provider'
import { getAccountModelPreferenceKey } from '../../accountModelPreferences'
import { writeChatSidebarFilter, type ChatSidebarFilter } from '../../chatSidebarFilter'
import { normalizeContainerTarget } from '../../containerSelection'
import { filterOpenCodeModels } from '../../openCodeProviderPreferences'
import { getChatFromUpdateSummary, mergeChats } from '../chatControllerUtils'
import { useWorkspaceChatErrors } from '../features/useWorkspaceChatErrors'
import { useWorkspaceChrome } from '../features/useWorkspaceChrome'
import { useWorkspaceEffectiveSelection } from '../features/useWorkspaceEffectiveSelection'
import { useWorkspaceNavigation } from '../features/useWorkspaceNavigation'
import { useWorkspaceProviderAccounts } from '../features/useWorkspaceProviderAccounts'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceSidebarModel } from '../features/useWorkspaceSidebarModel'
import { useWorkspaceSidebarPresentation } from '../features/useWorkspaceSidebarPresentation'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceChatListActions } from '../wiring/useWorkspaceChatListActions'
import { useWorkspaceConversation } from '../wiring/useWorkspaceConversation'
import { useWorkspaceInteractions } from '../wiring/useWorkspaceInteractions'
import { useWorkspaceMessaging } from '../wiring/useWorkspaceMessaging'
import { useWorkspaceProviderUpdates } from '../wiring/useWorkspaceProviderUpdates'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'

type WorkspaceChatSidebarDependencies = {
  session: ReturnType<typeof useWorkspaceSession>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  provider: ReturnType<typeof useWorkspaceProviderContext>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
  conversation: ReturnType<typeof useWorkspaceConversation>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  providerUpdates: ReturnType<typeof useWorkspaceProviderUpdates>
  interactions: ReturnType<typeof useWorkspaceInteractions>
  messaging: ReturnType<typeof useWorkspaceMessaging>
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  accountActions: ReturnType<typeof useWorkspaceProviderAccounts>
  sidebarModel: ReturnType<typeof useWorkspaceSidebarModel>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  navigation: ReturnType<typeof useWorkspaceNavigation>
  chrome: ReturnType<typeof useWorkspaceChrome>
  listActions: ReturnType<typeof useWorkspaceChatListActions>
  sidebarPresentation: ReturnType<typeof useWorkspaceSidebarPresentation>
  searchState: ReturnType<typeof useWorkspaceSearchState>
}

export function getWorkspaceChatSidebar({
  session,
  sourceState,
  chatState,
  provider,
  effectiveSelection,
  conversation,
  settings,
  providerUpdates,
  interactions,
  messaging,
  chatErrors,
  providerState,
  accountActions,
  sidebarModel,
  projectState,
  navigation,
  chrome,
  listActions,
  sidebarPresentation,
  searchState
}: WorkspaceChatSidebarDependencies) {
  return {
    usageIndicator: {
      providerId: session.selectedProviderId ?? sourceState.newSessionProvider,
      chatId: chatState.selectedChat?.id,
      container: session.changesContainer,
      modelUsageScope: provider.models.find(
        (candidate) => candidate.id === effectiveSelection.effectiveModel
      )?.usageScope,
      modelProviderId: provider.models.find(
        (candidate) => candidate.id === effectiveSelection.effectiveModel
      )?.modelProvider?.id,
      accountUsage: session.accountUsage,
      accountUsageError: session.accountUsageError,
      accountUsageState: session.accountUsageState,
      contextUsage: conversation.messageBoxContextUsage,
      displayUsage: settings.effectiveAppSettings.chat.displayUsage,
      compactDisabled:
        conversation.messageBoxDisabled ||
        providerUpdates.providerUpdateInProgress ||
        Boolean(session.activeSubagentChatView) ||
        !conversation.messageBoxProviderAvailable ||
        interactions.chatHasActiveTurn ||
        chatState.sendState === 'sending',
      onCompact:
        chatState.selectedChat && !session.activeSubagentChatView
          ? messaging.handleCompactChat
          : undefined,
      onUsageRefresh: session.refreshAccountUsage,
      onUsageReset: session.resetAccountRateLimits,
      onQueueLimitReset:
        (chatState.selectedChat || sourceState.newChatOpen) &&
        !session.activeSubagentChatView &&
        !chatErrors.chatOpenedElsewhere &&
        !chatErrors.chatLegacyHistoryReadOnly &&
        !providerUpdates.providerUpdateInProgress
          ? messaging.handleQueueLimitReset
          : undefined
    },
    providerAccount: {
      openCode: {
        sourceKey: provider.configProviderContainerKey,
        manageOpen:
          providerState.openCodeProviderManagerSource === provider.configProviderContainerKey,
        onManage: chatErrors.handleManageOpenCodeProviders,
        onClose: () => providerState.setOpenCodeProviderManagerSource(null),
        loading: provider.openCodeProviders.loading,
        providers: provider.openCodeProviders.providers,
        selectedId: provider.openCodeProviders.selectedId,
        error: provider.openCodeProviders.error,
        onSelect: (id: string) => {
          provider.openCodeProviders.select(id)
          providerState.modelManuallySelectedRef.current = true
          const providerModels = filterOpenCodeModels(providerState.allModels, id)
          const remembered =
            providerState.accountModelPreferencesRef.current[
              getAccountModelPreferenceKey(
                provider.configProviderId,
                provider.configProviderContainerKey,
                id
              )
            ]
          providerState.setModel(
            providerModels.find((model) => model.id === remembered)?.id ??
              providerModels.find((model) => model.isDefault)?.id ??
              providerModels[0]?.id ??
              ''
          )
        },
        onChanged: (connectedProviderId?: string) => {
          if (connectedProviderId) provider.openCodeProviders.select(connectedProviderId)
          accountActions.handleProviderConnectionsChanged(
            provider.configProviderId,
            normalizeContainerTarget(provider.configProviderContainer)
          )
        }
      },
      onCreate: () =>
        accountActions.handleCreateProviderAccount(undefined, {
          providerId: session.selectedProviderId ?? sourceState.newSessionProvider,
          container: session.changesContainer
        }),
      onDelete: (accountId: string) =>
        accountActions.deleteProviderAccount(
          accountId,
          session.selectedProviderId ?? sourceState.newSessionProvider,
          session.changesContainer
        ),
      key: `${session.selectedProviderId ?? sourceState.newSessionProvider}:${session.changesContainerKey}:${providerState.providerAccountRevision}:${providerState.providerAccountsRefresh}`,
      providerId: session.selectedProviderId ?? sourceState.newSessionProvider,
      chatId: chatState.selectedChat?.id,
      container: session.changesContainer,
      available: Boolean(chatState.selectedChat) || sourceState.newSessionProviderAvailable,
      updating: Boolean(providerState.providerAccountUpdatingId),
      onSelect: (accountId: string) =>
        accountActions.switchProviderAccount(
          accountId,
          session.selectedProviderId ?? sourceState.newSessionProvider,
          session.changesContainer,
          chatState.selectedChat?.id
        )
    },
    importedChatGroup: sidebarModel.importedChatGroup,
    chatSidebarFilter: chatState.activeChatSidebarFilter,
    chatSidebarTabs: chatState.chatSidebarTabs,
    chatReadState: sidebarModel.chatReadState,
    handleChatSidebarFilterChange: (filter: ChatSidebarFilter) => {
      chatState.setChatSidebarFilter(filter)
      writeChatSidebarFilter(filter)
    },
    handleImportedChat: (providerId: ProviderId, summary: ProviderChatUpdateSummary): void => {
      const chat = getChatFromUpdateSummary(providerId, summary, null, false)
      chatState.setChats((current) => mergeChats(current, [chat]))
      projectState.setCollapsedCwdGroups((current) => ({ ...current, imported: false }))
      navigation.handleSelectChat(chat)
    },
    chats: chatState.chats,
    chromeControlTheme: chrome.chromeControlTheme,
    displayedActiveChatGroups: sidebarModel.displayedActiveChatGroups,
    doneChatGroup: sidebarModel.doneChatGroup,
    filteredChats: sidebarModel.filteredChats,
    handleCloseSearch: navigation.handleCloseSearch,
    handleNewChat: navigation.handleNewChat,
    handleNewChatNoProject: navigation.handleNewChatNoProject,
    handleProjectDrop: listActions.handleProjectDrop,
    handleProjectStackDragOver: listActions.handleProjectStackDragOver,
    loadState: chatState.loadState,
    pinnedChatGroup: sidebarModel.pinnedChatGroup,
    renderChatGroup: sidebarPresentation.renderSidebarChatGroup,
    renderSettingsButton: chrome.renderSettingsButton,
    renderWindowControls: chrome.renderWindowControls,
    searchInputRef: searchState.searchInputRef,
    searchOpen: searchState.searchOpen,
    searchQuery: searchState.searchQuery,
    sidebarSearch: sidebarModel.sidebarSearch,
    setSearchOpen: searchState.setSearchOpen,
    setSearchQuery: searchState.setSearchQuery
  }
}
