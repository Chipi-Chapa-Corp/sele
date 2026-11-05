import { useCallback } from 'react'
import { getChatWriteAccessPresentation } from '../../chatWriteAccess'
import { normalizeContainerTarget } from '../../containerSelection'
import { chatOpenElsewhereMessage } from '../../requestError'
import { useOpenCodeConnectionHealth } from '../../useOpenCodeConnectionHealth'
import { getErrorMessage } from '../chatControllerUtils'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceEffectiveSelection } from './useWorkspaceEffectiveSelection'
import { useWorkspaceProviderContext } from './useWorkspaceProviderContext'

import type { useWorkspaceSession } from '../wiring/useWorkspaceSession'
type WorkspaceChatErrorsDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  preferences: ReturnType<typeof useWorkspacePreferenceState>
  provider: ReturnType<typeof useWorkspaceProviderContext>
  session: Pick<
    ReturnType<typeof useWorkspaceSession>,
    'changesContainer' | 'selectedChatKey' | 'usageAuthenticationRequired'
  >
}

export function useWorkspaceChatErrors({
  chatState,
  sourceState,
  effectiveSelection,
  providerState,
  preferences,
  provider,
  session
}: WorkspaceChatErrorsDependencies) {
  const { changesContainer, selectedChatKey, usageAuthenticationRequired } = session

  const chatWriteAccess = getChatWriteAccessPresentation(chatState.chatDetail)

  const openCodeConnectionFailure = useOpenCodeConnectionHealth({
    providerId: chatState.selectedChat?.providerId ?? sourceState.newSessionProvider,
    container: normalizeContainerTarget(changesContainer),
    available: Boolean(chatState.selectedChat) || sourceState.newSessionProviderAvailable,
    model: effectiveSelection.effectiveModel,
    revision: providerState.providerModelsRevision,
    chatKey: selectedChatKey
  })

  const authenticationRequired =
    Boolean(openCodeConnectionFailure) ||
    usageAuthenticationRequired ||
    (Boolean(chatState.selectedChat) && chatState.chatDetail?.authenticationRequired === true)

  const chatOpenedElsewhere = chatWriteAccess.openedElsewhere

  const chatLegacyHistoryReadOnly = chatWriteAccess.legacyHistory

  const chatLoadFailed =
    chatState.chatLoadState === 'error' && chatState.chatLoadError?.chatKey === selectedChatKey

  const requestErrorVisible =
    chatLoadFailed ||
    chatState.chatDetail?.writeAccess === 'readOnly' ||
    chatState.sendState === 'error'

  const requestErrorSummary = chatLoadFailed
    ? (chatState.chatLoadError?.message ?? 'Unable to load chat.')
    : chatLegacyHistoryReadOnly
      ? 'This legacy Codex chat is available read-only.'
      : chatOpenedElsewhere
        ? chatOpenElsewhereMessage
        : chatState.sendState === 'error' && chatState.sendError
          ? chatState.sendError
          : 'Unable to complete request.'

  const handleSendFailure = useCallback((error: unknown, fallback: string): void => {
    chatState.setSendError(getErrorMessage(error, fallback))
    chatState.setSendState('error')
  }, [])

  const handleDismissSendError = (): void => {
    chatState.setSendState('idle')
    chatState.setSendError(null)
  }

  const handleManageChatAccounts = useCallback((): void => {
    sourceState.setNewSessionProvider(
      chatState.selectedChat?.providerId ?? sourceState.newSessionProvider
    )
    sourceState.setNewSessionContainer(normalizeContainerTarget(changesContainer))
    preferences.setSettingsScope('global')
    preferences.setSettingsTab('providers')
    preferences.setSettingsOpen(true)
  }, [chatState.selectedChat, changesContainer, sourceState.newSessionProvider])

  const handleManageOpenCodeProviders = useCallback((): void => {
    providerState.setOpenCodeProviderManagerSource(provider.configProviderContainerKey)
  }, [provider.configProviderContainerKey])

  const handleOpenChatReauthentication = useCallback((): void => {
    const providerId = chatState.selectedChat?.providerId ?? sourceState.newSessionProvider
    if (providerId !== 'claude' && providerId !== 'codex') return
    const container = normalizeContainerTarget(changesContainer)
    providerState.setReauthenticationTarget({
      providerId,
      container: container.kind === 'container' ? container : null,
      chatId: chatState.selectedChat?.id
    })
  }, [chatState.selectedChat, changesContainer, sourceState.newSessionProvider])

  const handleRetryChatLoad = (): void => {
    if (!chatState.selectedChat) return
    chatState.setChatLoadState('loading')
    chatState.setChatLoadRequest((currentRequest) => currentRequest + 1)
  }
  return {
    openCodeConnectionFailure,
    authenticationRequired,
    chatOpenedElsewhere,
    chatLegacyHistoryReadOnly,
    chatLoadFailed,
    requestErrorVisible,
    requestErrorSummary,
    handleSendFailure,
    handleDismissSendError,
    handleManageChatAccounts,
    handleManageOpenCodeProviders,
    handleOpenChatReauthentication,
    handleRetryChatLoad
  }
}
