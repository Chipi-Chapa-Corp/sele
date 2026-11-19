import type {
  ProviderChatDetail,
  ProviderPermissionOptions,
  ProviderTurnOptions
} from '../../shared/provider'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from './ProviderAdapter'

const allowsWithoutApproval = (options: ProviderPermissionOptions): boolean =>
  options.sandboxMode !== 'read-only' &&
  (options.sandboxMode === 'danger-full-access' || options.approvalPolicy === 'never')

/** Keep live approval choices effective even when a provider snapshots them at turn start. */
export const withLiveChatPermissions = (adapter: ProviderAdapter): ProviderAdapter => {
  const policies = new Map<string, ProviderPermissionOptions | null>()
  const latest = new Map<string, ProviderChatDetail>()
  // Request IDs are local to a provider connection and can be reused after reconnect.
  const attempted = new Map<string, { id: string; startedAt: number }>()
  const alreadyAttempted = (
    chatId: string,
    request: { id: string; startedAt: number }
  ): boolean => {
    const previous = attempted.get(chatId)
    return previous?.id === request.id && previous.startedAt === request.startedAt
  }
  const draining = new Map<string, Promise<void>>()
  const nativeUpdates = new Map<string, Promise<void>>()
  const listeners = new Set<Parameters<ProviderAdapter['onChatUpdated']>[0]>()
  let disposed = false

  const remember = (detail: ProviderChatDetail): void => {
    if ((latest.get(detail.id)?.revision ?? -1) <= detail.revision) latest.set(detail.id, detail)
  }
  const publish = (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata): void => {
    remember(detail)
    listeners.forEach((listener) => listener(detail, metadata))
  }
  const drain = (id: string): Promise<void> => {
    const pending = draining.get(id)
    if (pending) return pending
    // Defer so synchronous events from resolveApproval cannot start a second drain.
    const task = Promise.resolve()
      .then(async () => {
        while (!disposed) {
          const policy = policies.get(id)
          const request = latest.get(id)?.pendingApproval
          if (!policy || !allowsWithoutApproval(policy) || !request) return
          if (alreadyAttempted(id, request)) return
          attempted.set(id, { id: request.id, startedAt: request.startedAt })
          try {
            const detail = await adapter.resolveApproval(id, 'allow')
            if (disposed) return
            publish(detail)
          } catch (error) {
            // Leave the request visible and manually actionable if the provider rejects the reply.
            console.error(
              `Unable to automatically approve ${adapter.id} request ${request.id}`,
              error
            )
            return
          }
        }
      })
      .finally(() => {
        draining.delete(id)
        const policy = policies.get(id)
        const request = latest.get(id)?.pendingApproval
        if (
          !disposed &&
          policy &&
          allowsWithoutApproval(policy) &&
          request &&
          !alreadyAttempted(id, request)
        ) {
          void drain(id)
        }
      })
    draining.set(id, task)
    return task
  }
  const setPolicy = (id: string, options: ProviderPermissionOptions): void => {
    policies.set(id, options)
    void drain(id)
  }
  const unsubscribe = adapter.onChatUpdated((detail, metadata) => {
    publish(detail, metadata)
    void drain(detail.id)
  })

  const run = async (
    id: string,
    options: ProviderTurnOptions | undefined,
    operation: () => Promise<ProviderChatDetail>
  ): Promise<ProviderChatDetail> => {
    if (options) setPolicy(id, options)
    const detail = await operation()
    remember(detail)
    void drain(id)
    return detail
  }
  const created =
    (options: ProviderTurnOptions | undefined, onCreated?: (id: string) => Promise<void>) =>
    async (id: string): Promise<void> => {
      if (options) setPolicy(id, options)
      await onCreated?.(id)
    }

  return {
    ...adapter,
    releaseChat: adapter.releaseChat
      ? async (id, options) => {
          policies.set(id, null)
          attempted.delete(id)
          latest.delete(id)
          await adapter.releaseChat!(id, options)
        }
      : undefined,
    onChatUpdated: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    updateChatPermissions: async (id, options) => {
      const command = options.restoreForCommand
      if (command) {
        if (policies.has(id) || options.sandboxMode !== 'danger-full-access') return
        // Recovery can deliver the selected chat snapshot before its first live event.
        remember(
          await adapter.getChatWindow(
            id,
            { startIndex: null, limit: 1 },
            { container: options.container }
          )
        )
        const detail = latest.get(id)
        const pending = detail?.pendingApproval
        if (
          disposed ||
          policies.has(id) ||
          (detail?.writeAccess !== undefined && detail.writeAccess !== 'writable') ||
          pending?.type !== 'command' ||
          pending.id !== command.id ||
          pending.startedAt !== command.startedAt
        )
          return
      }
      setPolicy(id, options)
      // Native updates are ordered, but host approval does not wait for them.
      const previous = nativeUpdates.get(id) ?? Promise.resolve()
      const update = previous.then(async () => {
        if (disposed) return
        try {
          await adapter.updateChatPermissions?.(id, options)
        } catch (error) {
          console.error(
            `Unable to update live ${adapter.id} permissions; using host approvals`,
            error
          )
        }
      })
      nativeUpdates.set(id, update)
      void update.finally(() => {
        if (nativeUpdates.get(id) === update) nativeUpdates.delete(id)
      })
      const approvePending = async (): Promise<void> => {
        if (allowsWithoutApproval(options) && !latest.get(id)?.pendingApproval) {
          remember(
            await adapter.getChatWindow(
              id,
              { startIndex: null, limit: 1 },
              { container: options.container }
            )
          )
        }
        await drain(id)
      }
      await Promise.all([approvePending(), update])
    },
    startChat: (message, options, onCreated) =>
      adapter.startChat(message, options, created(options, onCreated)),
    continueChat: (id, message, options) =>
      run(id, options, () => adapter.continueChat(id, message, options)),
    continueChatInFork: (id, message, options, onCreated) =>
      adapter.continueChatInFork(id, message, options, created(options, onCreated)),
    sendActiveChatMessage: (id, message, mode, options) =>
      run(id, options, () => adapter.sendActiveChatMessage(id, message, mode, options)),
    editMessage: (id, messageId, message, options) =>
      run(id, options, () => adapter.editMessage(id, messageId, message, options)),
    stopChat: (id) => {
      policies.set(id, null)
      attempted.delete(id)
      return adapter.stopChat(id)
    },
    dispose: () => {
      disposed = true
      unsubscribe()
      listeners.clear()
      policies.clear()
      latest.clear()
      attempted.clear()
      return adapter.dispose()
    }
  }
}
