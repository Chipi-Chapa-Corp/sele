import type {
  ProviderChatDetail,
  ProviderTurnOptions,
  ProviderWorkingStep
} from '../../shared/provider'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from './ProviderAdapter'

import {
  normalizeNetworkRetrySettings,
  type NetworkRetrySettings
} from '../../shared/networkRetry.ts'
export const networkRetryPrompt =
  'The previous response was interrupted by a network failure. Continue from where you left off with the same task. Check the current state before repeating any tool actions that may already have completed.'

export const isTransientNetworkFailure = (message: string): boolean => {
  if (
    /\b(?:401|403|429)\b|rate[ _-]?limit|usage[ _-]?limit|quota|insufficient (?:balance|credits)|unauthori[sz]ed|authentication|invalid api key|permission denied|certificate|ENOTFOUND/i.test(
      message
    )
  )
    return false
  return /\b(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|408|502|503|504)\b|(?:network|connection)[ _-]?(?:error|failure)|fetch failed|failed to fetch|socket hang up|(?:connection|stream).*(?:reset|closed|disconnected|interrupted|lost)|(?:connect|connection|request) (?:timeout|timed out)|failed to connect|error sending request|disconnected before completing the turn/i.test(
    message
  )
}

type RetryState = {
  options?: ProviderTurnOptions
  attempt: number
  policy: NetworkRetrySettings
  failedStepId?: string
  failedDetail?: ProviderChatDetail
  lastPresentedRevision?: number
  timer?: ReturnType<typeof setTimeout>
}

const getFailedStep = (detail: ProviderChatDetail): ProviderWorkingStep | undefined => {
  if (
    (detail.status !== 'error' && detail.status !== null) ||
    (detail.writeAccess !== undefined && detail.writeAccess !== 'writable') ||
    detail.pendingApproval ||
    detail.pendingUserInput ||
    detail.items.some((item) => item.type === 'pendingMessage')
  )
    return undefined
  const lastTurnItem = detail.items.findLast(
    (item) => item.type === 'working' || (item.type === 'message' && item.role === 'user')
  )
  return lastTurnItem?.type === 'working' &&
    lastTurnItem.status === 'failed' &&
    lastTurnItem.failureReason !== 'rateLimit' &&
    isTransientNetworkFailure(lastTurnItem.failureMessage ?? '')
    ? lastTurnItem
    : undefined
}

/** Retry only confirmed terminal turns, never an ambiguous failed message submission. */
export const withProviderNetworkRetries = (adapter: ProviderAdapter): ProviderAdapter => {
  const states = new Map<string, RetryState>()
  const revisionOffsets = new Map<string, number>()
  const listeners = new Set<Parameters<ProviderAdapter['onChatUpdated']>[0]>()
  let disposed = false

  const cancel = (chatId: string): void => {
    const state = states.get(chatId)
    if (state?.timer) clearTimeout(state.timer)
    states.delete(chatId)
  }
  const begin = (chatId: string, options?: ProviderTurnOptions): void => {
    cancel(chatId)
    // Retain settings, but never send the original attachments or review again.
    const settings = options
      ? { ...options, files: undefined, images: undefined, skills: undefined, review: undefined }
      : undefined
    states.set(chatId, {
      attempt: 0,
      options: settings,
      policy: normalizeNetworkRetrySettings(options?.networkRetry)
    })
  }
  const present = (detail: ProviderChatDetail): ProviderChatDetail => {
    const state = states.get(detail.id)
    if (state)
      state.lastPresentedRevision = Math.max(state.lastPresentedRevision ?? 0, detail.revision)
    const revision = detail.revision + (revisionOffsets.get(detail.id) ?? 0)
    if (!state?.timer) return revision === detail.revision ? detail : { ...detail, revision }
    return {
      ...detail,
      revision,
      status: 'active',
      items: detail.items.map((item) =>
        item.type === 'working' && item.id === state.failedStepId
          ? {
              ...item,
              failureMessage: `Network interrupted. Retrying in ${state.policy.delaySeconds}s (${state.attempt}/${state.policy.count}). ${item.failureMessage ?? ''}`
            }
          : item
      )
    }
  }
  const publish = (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata): void => {
    const pending = Boolean(states.get(detail.id)?.timer)
    listeners.forEach((listener) =>
      listener(present(detail), pending ? { turnCompleted: false } : metadata)
    )
  }

  const retry = async (chatId: string, state: RetryState): Promise<void> => {
    try {
      const detail = adapter.getChatWindow
        ? await adapter.getChatWindow(
            chatId,
            { startIndex: null, limit: 1 },
            { container: state.options?.container }
          )
        : await adapter.getChat(chatId, { container: state.options?.container })
      if (disposed || states.get(chatId) !== state) return
      if (getFailedStep(detail)?.id !== state.failedStepId) {
        cancel(chatId)
        publish(detail)
        return
      }
      state.timer = undefined
      await adapter.continueChat(chatId, networkRetryPrompt, state.options)
    } catch (error) {
      console.error('[ProviderNetworkRetry] Unable to resume interrupted chat', error)
      if (disposed || states.get(chatId) !== state) return
      // A rejected submission may have reached the provider. Do not blindly resend it.
      let refreshed: ProviderChatDetail | undefined
      try {
        refreshed = await adapter.getChat(chatId, { container: state.options?.container })
      } catch (refreshError) {
        console.error(
          '[ProviderNetworkRetry] Unable to refresh chat after failed retry',
          refreshError
        )
      }
      if (disposed || states.get(chatId) !== state) return
      cancel(chatId)
      if (refreshed) publish(refreshed, { turnCompleted: true })
      else if (state.failedDetail) {
        // Publish the cached failure even if the provider has become unreachable. Offset future
        // native revisions as well, so this presentation update cannot hide the next live event.
        revisionOffsets.set(
          chatId,
          (revisionOffsets.get(chatId) ?? 0) +
            Math.max(
              1,
              (state.lastPresentedRevision ?? state.failedDetail.revision) -
                state.failedDetail.revision +
                1
            )
        )
        publish(state.failedDetail, { turnCompleted: true })
      }
    }
  }

  const unsubscribe = adapter.onChatUpdated((detail, metadata) => {
    const state = states.get(detail.id)
    if (state) {
      if (getFailedStep(detail)) state.failedDetail = detail
      if (state.timer && !getFailedStep(detail)) cancel(detail.id)
      else if (metadata?.turnCompleted) {
        const failed = getFailedStep(detail)
        if (!failed) cancel(detail.id)
        else if (failed.id !== state.failedStepId && state.attempt >= state.policy.count)
          cancel(detail.id)
        else if (failed.id !== state.failedStepId) {
          state.failedStepId = failed.id
          state.attempt += 1
          state.timer = setTimeout(() => {
            void retry(detail.id, state)
          }, state.policy.delaySeconds * 1000)
        }
      }
    }
    publish(detail, metadata)
  })

  const run = async (
    chatId: string,
    options: ProviderTurnOptions | undefined,
    operation: () => Promise<ProviderChatDetail>
  ): Promise<ProviderChatDetail> => {
    begin(chatId, options)
    try {
      return await operation()
    } catch (error) {
      cancel(chatId)
      throw error
    }
  }

  const runCreated = async (
    options: ProviderTurnOptions | undefined,
    onCreated: ((id: string) => Promise<void>) | undefined,
    operation: (created: (id: string) => Promise<void>) => Promise<ProviderChatDetail>
  ): Promise<ProviderChatDetail> => {
    let createdId: string | undefined
    try {
      return await operation(async (id) => {
        createdId = id
        begin(id, options)
        await onCreated?.(id)
      })
    } catch (error) {
      if (createdId) cancel(createdId)
      throw error
    }
  }

  const wrapped: ProviderAdapter = {
    ...adapter,
    onChatUpdated: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getChats: async (options) => {
      const page = await adapter.getChats(options)
      return {
        ...page,
        chats: page.chats.map((chat) =>
          states.get(chat.id)?.timer ? { ...chat, status: 'active' } : chat
        )
      }
    },
    startChat: (message, options, onCreated) =>
      runCreated(options, onCreated, (created) => adapter.startChat(message, options, created)),
    continueChat: (id, message, options) =>
      run(id, options, () => adapter.continueChat(id, message, options)),
    continueChatInFork: (id, message, options, onCreated) =>
      runCreated(options, onCreated, (created) =>
        adapter.continueChatInFork(id, message, options, created)
      ),
    sendActiveChatMessage: (id, message, mode, options) => {
      // During backoff the native turn is idle, even though the UI offers Stop.
      const pending = Boolean(states.get(id)?.timer)
      return run(id, options, () =>
        pending
          ? adapter.continueChat(id, message, options)
          : adapter.sendActiveChatMessage(id, message, mode, options)
      )
    },
    editMessage: (id, messageId, message, options) =>
      run(id, options, () => adapter.editMessage(id, messageId, message, options)),
    stopChat: (id) => {
      cancel(id)
      return adapter.stopChat(id)
    },
    compactChat: (id) => {
      cancel(id)
      return adapter.compactChat(id)
    },
    dispose: () => {
      disposed = true
      for (const id of states.keys()) cancel(id)
      unsubscribe()
      listeners.clear()
      revisionOffsets.clear()
      adapter.dispose()
    }
  }
  // Every detail returned to the service must use the same presentation revisions, including
  // reads and mutations that do not participate in retries.
  const detailMethods = [
    'getChat',
    'getChatWindow',
    'getChatCursorWindow',
    'getChatWindowForItem',
    'setChatTitle',
    'startChat',
    'continueChat',
    'continueChatInFork',
    'forkChat',
    'sendActiveChatMessage',
    'deletePendingMessage',
    'editPendingMessage',
    'steerPendingMessage',
    'interruptPendingMessage',
    'editMessage',
    'resolveApproval',
    'resolveUserInput',
    'compactChat',
    'stopChat'
  ] as const
  for (const name of detailMethods) {
    const operation = wrapped[name]
    if (!operation) continue
    const call = operation as (...args: unknown[]) => Promise<ProviderChatDetail>
    Object.assign(wrapped, { [name]: async (...args: unknown[]) => present(await call(...args)) })
  }
  return wrapped
}
