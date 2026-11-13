import type { ProviderChatUpdateSummary, ProviderId } from '../../../../shared/provider'
import { getAccountModelPreferenceKey } from '../../accountModelPreferences'
import { writeChatSidebarFilter, type ChatSidebarFilter } from '../../chatSidebarFilter'
import { normalizeContainerTarget } from '../../containerSelection'
import { filterOpenCodeModels } from '../../openCodeProviderPreferences'
import { getChatFromUpdateSummary, mergeChats } from '../chatControllerUtils'
import { useWorkspaceSidebarPresentation } from '../features/useWorkspaceSidebarPresentation'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

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
}: WorkspaceChanges & {
  sidebarPresentation: ReturnType<typeof useWorkspaceSidebarPresentation>
}) {
  const providerId = session.selectedProviderId ?? sourceState.newSessionProvider
  const effectiveModel = provider.models.find(
    (candidate) => candidate.id === effectiveSelection.effectiveModel
  )
  return {
    usageIndicator: {
      providerId,
      chatId: chatState.selectedChat?.id,
      container: session.changesContainer,
      modelUsageScope: effectiveModel?.usageScope,
      modelProviderId: effectiveModel?.modelProvider?.id,
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
          providerId,
          container: session.changesContainer
        }),
      onDelete: (accountId: string) =>
        accountActions.deleteProviderAccount(accountId, providerId, session.changesContainer),
      key: `${providerId}:${session.changesContainerKey}:${providerState.providerAccountRevision}:${providerState.providerAccountsRefresh}`,
      providerId,
      chatId: chatState.selectedChat?.id,
      container: session.changesContainer,
      available: Boolean(chatState.selectedChat) || sourceState.newSessionProviderAvailable,
      updating: Boolean(providerState.providerAccountUpdatingId),
      onSelect: (accountId: string) =>
        accountActions.switchProviderAccount(
          accountId,
          providerId,
          session.changesContainer,
          chatState.selectedChat?.id
        )
    },
    chatSidebarFilter: chatState.activeChatSidebarFilter,
    chatSidebarTabs: chatState.chatSidebarTabs,
    hasWorkingChats: sidebarPresentation.hasWorkingChats,
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
    chatCount: chatState.chats.length,
    chromeControlTheme: chrome.chromeControlTheme,
    sidebarGroups: sidebarModel.sidebarGroups,
    handleCloseSearch: navigation.handleCloseSearch,
    handleNewChat: navigation.handleNewChat,
    handleNewChatNoProject: navigation.handleNewChatNoProject,
    handleProjectDrop: listActions.handleProjectDrop,
    handleProjectStackDragOver: listActions.handleProjectStackDragOver,
    loadState: chatState.loadState,
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
