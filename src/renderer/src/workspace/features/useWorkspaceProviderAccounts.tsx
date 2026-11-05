import type { AppContainerTarget } from '../../../../shared/app'
import type { ProviderAccountConfiguration, ProviderId } from '../../../../shared/provider'
import { appApi } from '../../appApi'
import type { AccountAuthorizationSession } from '../../components/AccountDialog'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { getErrorMessage } from '../chatControllerUtils'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

import type { useWorkspaceSession } from '../wiring/useWorkspaceSession'
type WorkspaceProviderAccountsDependencies = {
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  session: Pick<
    ReturnType<typeof useWorkspaceSession>,
    'setAccountUsage' | 'setAccountUsageState' | 'setAccountUsageError'
  >
}

export function useWorkspaceProviderAccounts({
  sourceState,
  providerState,
  chatState,
  session
}: WorkspaceProviderAccountsDependencies) {
  const { setAccountUsage, setAccountUsageState, setAccountUsageError } = session

  const applyProviderAccountConfiguration = (
    configuration: ProviderAccountConfiguration,
    providerId: ProviderId = sourceState.newSessionProvider,
    container: AppContainerTarget | null = sourceState.newSessionContainer
  ): void => {
    if (
      providerId === sourceState.newSessionProvider &&
      getContainerTargetKey(container) === getContainerTargetKey(sourceState.newSessionContainer)
    ) {
      providerState.setSettingsProviderAccounts(configuration)
      providerState.setProviderAccountsError(null)
      providerState.setProviderAccountsLoadState('ready')
    }
    providerState.providerModelCatalogCacheRef.current.delete(
      `${providerId}:${getContainerTargetKey(container)}`
    )
    providerState.setProviderModelsRevision((revision) => revision + 1)
    providerState.setProviderResourcesRefresh((refresh) => refresh + 1)
    setAccountUsage(null)
    setAccountUsageState('loading')
  }

  const handleProviderConnectionsChanged = (
    providerId: ProviderId,
    container: AppContainerTarget
  ): void => {
    // Keep OpenCode's current models visible until the refreshed catalog replaces them.
    if (providerId !== 'opencode-v2')
      providerState.providerModelCatalogCacheRef.current.delete(
        `${providerId}:${getContainerTargetKey(container)}`
      )
    providerState.setProviderModelsRevision((revision) => revision + 1)
    providerState.setProviderAccountsRefresh((revision) => revision + 1)
    providerState.setProviderResourcesRefresh((revision) => revision + 1)
  }

  const switchProviderAccount = async (
    accountId: string,
    providerId: ProviderId,
    sourceContainer: AppContainerTarget | null,
    chatId?: string
  ): Promise<void> => {
    if (providerState.providerAccountUpdatingId) return
    const container = normalizeContainerTarget(sourceContainer)
    providerState.setProviderAccountUpdatingId(accountId)
    providerState.setProviderAccountsError(null)
    try {
      const configuration =
        // biome-ignore lint/correctness/useHookAtTopLevel: Provider IPC method, not a React hook.
        await providerApi.useAccount(providerId, accountId, { container, chatId })
      setAccountUsage(null)
      setAccountUsageState('loading')
      setAccountUsageError(null)
      if (chatId) {
        chatState.setChats((current) =>
          current.map((chat) => (chat.id === chatId ? { ...chat, accountId } : chat))
        )
        chatState.setSelectedChat((current) =>
          current?.id === chatId ? { ...current, accountId } : current
        )
        chatState.setChatDetail((current) =>
          current?.id === chatId
            ? { ...current, accountId, authenticationRequired: false }
            : current
        )
        providerState.setProviderModelsRevision((revision) => revision + 1)
        chatState.setChatLoadRequest((request) => request + 1)
      } else applyProviderAccountConfiguration(configuration, providerId, container)
      providerState.setProviderAccountRevision((revision) => revision + 1)
    } finally {
      providerState.setProviderAccountUpdatingId(null)
    }
  }

  const handleUseProviderAccount = async (accountId: string): Promise<void> => {
    try {
      await switchProviderAccount(
        accountId,
        sourceState.newSessionProvider,
        sourceState.newSessionContainer
      )
    } catch (error) {
      console.error('Unable to switch provider accounts.', error)
      providerState.setProviderAccountsError(getErrorMessage(error, 'Unable to switch accounts.'))
    }
  }

  const deleteProviderAccount = async (
    accountId: string,
    providerId: ProviderId,
    sourceContainer: AppContainerTarget | null
  ): Promise<void> => {
    if (providerState.providerAccountUpdatingId) return
    const container = normalizeContainerTarget(sourceContainer)
    providerState.setProviderAccountUpdatingId(accountId)
    try {
      applyProviderAccountConfiguration(
        await providerApi.deleteAccount(providerId, accountId, { container }),
        providerId,
        container
      )
      providerState.setProviderAccountRevision((revision) => revision + 1)
    } finally {
      providerState.setProviderAccountUpdatingId(null)
    }
  }

  const handleDeleteProviderAccount = async (accountId: string): Promise<void> => {
    if (providerState.providerAccountUpdatingId) return
    const account = providerState.settingsProviderAccounts?.accounts.find(
      (candidate) => candidate.id === accountId
    )
    if (
      !account ||
      !window.confirm(`Delete the account “${account.displayName ?? account.login ?? 'account'}”?`)
    )
      return

    providerState.setProviderAccountsError(null)
    try {
      await deleteProviderAccount(
        accountId,
        sourceState.newSessionProvider,
        sourceState.newSessionContainer
      )
    } catch (error) {
      console.error('Unable to delete the provider account.', error)
      providerState.setProviderAccountsError(
        getErrorMessage(error, 'Unable to delete the account.')
      )
    } finally {
      providerState.setProviderAccountUpdatingId(null)
    }
  }

  const handleCreateProviderAccount = async (
    reauthentication?: {
      providerId: 'codex' | 'claude'
      container: AppContainerTarget | null
      chatId?: string
    },
    target?: { providerId: ProviderId; container: AppContainerTarget | null }
  ): Promise<AccountAuthorizationSession> => {
    const providerId =
      reauthentication?.providerId ?? target?.providerId ?? sourceState.newSessionProvider
    const container = normalizeContainerTarget(
      reauthentication
        ? reauthentication.container
        : target
          ? target.container
          : sourceState.newSessionContainer
    )
    const chatId = reauthentication?.chatId
    const restart = reauthentication
      ? await providerApi.reauthenticateAccount(providerId, { container, chatId })
      : null
    const creation = restart ?? (await providerApi.createAccount(providerId, { container, chatId }))
    let loginId: string | null = null
    let userCode: string | null = null
    let authUrl: string | null = null
    let acceptsCode = false
    try {
      const login = restart?.login ?? (await providerApi.login(providerId, { container, chatId }))
      if (login.status === 'pending') {
        loginId = login.loginId
        userCode = login.userCode ?? null
        authUrl = login.authUrl
        acceptsCode = login.acceptsCode === true
      }
    } catch (error) {
      try {
        const restoredConfiguration = await providerApi.cancelAccountCreation(
          providerId,
          creation.accountId,
          loginId,
          { container, chatId }
        )
        applyProviderAccountConfiguration(restoredConfiguration, providerId, container)
        if (!reauthentication) providerState.setProviderAccountRevision((revision) => revision + 1)
      } catch (cleanupError) {
        console.error('Unable to clean up an incomplete provider account.', cleanupError)
        // Keep the original login error when cleanup cannot be completed.
      }
      throw error
    }

    const completion = (async (): Promise<void> => {
      try {
        const result = await providerApi.completeAccountCreation(
          providerId,
          creation.accountId,
          loginId,
          { container, chatId }
        )
        applyProviderAccountConfiguration(result.configuration, providerId, container)
        if (!result.success) {
          throw new Error(result.error || 'Account authorization was not completed.')
        }
        providerState.setProviderAccountRevision((revision) => revision + 1)
        if (reauthentication) {
          chatState.setSendState('idle')
          chatState.setSendError(null)
        }
      } catch (error) {
        const restoredConfiguration = await providerApi
          .getAccounts(providerId, { container, chatId })
          .catch((restoreError: unknown) => {
            console.error(
              'Unable to restore provider accounts after authorization failed.',
              restoreError
            )
            return null
          })
        if (restoredConfiguration)
          applyProviderAccountConfiguration(restoredConfiguration, providerId, container)
        throw error
      }
    })()

    return {
      userCode,
      completion,
      ...(acceptsCode && loginId
        ? {
            submitCode: (code: string) =>
              providerApi.submitAccountLoginCode(providerId, loginId!, code, { container, chatId })
          }
        : {}),
      ...(acceptsCode && authUrl ? { copyLink: () => appApi.writeClipboardText(authUrl!) } : {}),
      authorize: async () => {
        if (!authUrl) return
        if (userCode) await appApi.writeClipboardText(userCode)
        await appApi.handleExternalLink({ url: authUrl, action: 'open' })
      },
      cancel: async () => {
        const configuration = await providerApi.cancelAccountCreation(
          providerId,
          creation.accountId,
          loginId,
          { container, chatId }
        )
        applyProviderAccountConfiguration(configuration, providerId, container)
        if (!reauthentication) providerState.setProviderAccountRevision((revision) => revision + 1)
      }
    }
  }
  return {
    handleProviderConnectionsChanged,
    switchProviderAccount,
    handleUseProviderAccount,
    deleteProviderAccount,
    handleDeleteProviderAccount,
    handleCreateProviderAccount
  }
}
