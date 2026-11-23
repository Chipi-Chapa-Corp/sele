import type { AppContainerTarget } from '../../../../shared/app'
import type { ProviderId } from '../../../../shared/provider'
import { appApi } from '../../appApi'
import type { AccountAuthorizationSession } from '../../components/AccountDialog'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerSelection'
import { providerApi } from '../../providerApi'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

import type { useWorkspaceSelection } from '../useWorkspaceSelection'
type WorkspaceProviderAccountsDependencies = {
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  session: Pick<
    ReturnType<typeof useWorkspaceSelection>,
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
    providerId: ProviderId,
    container: AppContainerTarget | null
  ): void => {
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
    try {
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
      } else applyProviderAccountConfiguration(providerId, container)
      providerState.setProviderAccountRevision((revision) => revision + 1)
    } finally {
      providerState.setProviderAccountUpdatingId(null)
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
      await providerApi.deleteAccount(providerId, accountId, { container })
      applyProviderAccountConfiguration(providerId, container)
      providerState.setProviderAccountRevision((revision) => revision + 1)
    } finally {
      providerState.setProviderAccountUpdatingId(null)
    }
  }

  const handleCreateProviderAccount = async (
    signal: AbortSignal,
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
    const source = { container, chatId }
    const attemptId = providerId === 'claude' ? crypto.randomUUID() : undefined
    const cancelStartup = (): void => {
      if (attemptId)
        void providerApi.cancelAccountLoginStart(attemptId).catch((error: unknown) => {
          console.error('Unable to cancel Claude sign-in startup.', error)
        })
    }
    const cancel = async (accountId: string, loginId: string | null): Promise<void> => {
      await providerApi.cancelAccountCreation(providerId, accountId, loginId, source)
      applyProviderAccountConfiguration(providerId, container)
      if (!reauthentication) providerState.setProviderAccountRevision((revision) => revision + 1)
    }
    let accountId: string | undefined
    let loginId: string | null = null
    let userCode: string | null = null
    let authUrl: string | null = null
    let acceptsCode = false
    try {
      signal.throwIfAborted()
      if (!reauthentication)
        accountId = (await providerApi.createAccount(providerId, source)).accountId
      signal.throwIfAborted()
      signal.addEventListener('abort', cancelStartup, { once: true })
      const loginOptions = { ...source, attemptId }
      const restart = reauthentication
        ? await providerApi.reauthenticateAccount(providerId, loginOptions)
        : null
      if (restart) accountId = restart.accountId
      const login = restart?.login ?? (await providerApi.login(providerId, loginOptions))
      if (login.status === 'pending') {
        loginId = login.loginId
        userCode = login.userCode ?? null
        authUrl = login.authUrl
        acceptsCode = login.acceptsCode === true
      }
      signal.throwIfAborted()
    } catch (error) {
      if (accountId)
        await cancel(accountId, loginId).catch((cleanupError: unknown) => {
          console.error('Unable to clean up an incomplete provider account.', cleanupError)
        })
      throw error
    } finally {
      signal.removeEventListener('abort', cancelStartup)
    }
    if (!accountId) throw new Error('Account sign-in did not return an account.')
    const authorizedAccountId = accountId

    const completion = (async (): Promise<void> => {
      try {
        const result = await providerApi.completeAccountCreation(
          providerId,
          authorizedAccountId,
          loginId,
          source
        )
        if (signal.aborted) return
        applyProviderAccountConfiguration(providerId, container)
        if (!result.success) {
          throw new Error(result.error || 'Account authorization was not completed.')
        }
        providerState.setProviderAccountRevision((revision) => revision + 1)
        if (reauthentication) {
          chatState.setSendState('idle')
          chatState.setSendError(null)
        }
      } catch (error) {
        if (signal.aborted) throw error
        const restoredConfiguration = await providerApi
          .getAccounts(providerId, { container, chatId })
          .catch((restoreError: unknown) => {
            console.error(
              'Unable to restore provider accounts after authorization failed.',
              restoreError
            )
            return null
          })
        if (restoredConfiguration) applyProviderAccountConfiguration(providerId, container)
        throw error
      }
    })()

    const pendingUrl = authUrl
    const pendingUserCode = userCode
    return {
      userCode,
      completion,
      ...(acceptsCode && loginId
        ? {
            submitCode: (code: string) =>
              providerApi.submitAccountLoginCode(providerId, loginId!, code, { container, chatId })
          }
        : {}),
      ...(pendingUserCode ? { copyCode: () => appApi.writeClipboardText(pendingUserCode) } : {}),
      // Both code-based flows can finish on another device, so expose the page link.
      ...((acceptsCode || pendingUserCode) && pendingUrl
        ? { copyLink: () => appApi.writeClipboardText(pendingUrl) }
        : {}),
      authorize: async () => {
        if (!pendingUrl) return
        await appApi.handleExternalLink({ url: pendingUrl, action: 'open' })
      },
      cancel: () => cancel(authorizedAccountId, loginId)
    }
  }
  return {
    handleProviderConnectionsChanged,
    switchProviderAccount,
    deleteProviderAccount,
    handleCreateProviderAccount
  }
}
