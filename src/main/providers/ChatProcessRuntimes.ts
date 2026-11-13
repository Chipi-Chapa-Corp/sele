import { getContainerTargetKey } from '../containerTarget.ts'
import type { ProviderChatDetail, ProviderChatMetadata } from '../../shared/provider'
import type { ProviderAdapter } from './ProviderAdapter'
import type { ProviderProcessScope, ProviderProcessStore } from '../ProviderProcessStore.ts'
import { providerProcessContext } from '../providerProcessContext.ts'

const executionMethods = new Set([
  'continueChat',
  'sendActiveChatMessage',
  'enqueueLimitResetMessage',
  'editMessage',
  'editPendingMessage',
  'resolveUserInput',
  'compactChat'
])
const forkMethods = new Map([
  ['continueChatInFork', 3],
  ['forkChat', 2],
  ['summarizeChatInFork', 2]
])
const chatMethods = new Set([
  ...executionMethods,
  ...forkMethods.keys(),
  'getChat',
  'getChatWindow',
  'getChatCursorWindow',
  'getChatWindowForItem',
  'getChatTerminalTasks',
  'getMcpApp',
  'getSubagents',
  'getSubagent',
  'getSubagentWindowForItem',
  'cancelSubagent',
  'sendSubagentMessage',
  'setChatGoal',
  'setChatTitle',
  'updateChatPermissions',
  'deletePendingMessage',
  'beginPendingMessageEdit',
  'cancelPendingMessageEdit',
  'steerPendingMessage',
  'interruptPendingMessage',
  'resolveApproval',
  'stopChat',
  'releaseChat'
])

type Dependencies = {
  store: ProviderProcessStore
  accountId?: string
  metadata: (chatId: string) => Promise<ProviderChatMetadata>
  create: () => ProviderAdapter
}

/** Each execution adapter owns one chat; discovery never claims a chat's boundary. */
export const withChatProcessRuntimes = <T extends ProviderAdapter>(
  base: T,
  dependencies: Dependencies
): T => {
  const { store } = dependencies
  const accountId = dependencies.accountId ?? null
  const runtimes = new Map<string, ProviderAdapter>()
  const recoveries = new Map<string, Promise<void>>()
  const listeners = new Set<Parameters<ProviderAdapter['onChatUpdated']>[0]>()
  const usageListeners = new Set<Parameters<NonNullable<ProviderAdapter['onTokenUsage']>>[0]>()
  const latest = new Map<
    string,
    Pick<ProviderChatDetail, 'status' | 'pendingApproval' | 'lastTurnOutcome'>
  >()
  const owners = new Map<string, string>()
  const revisions = new Map<
    string,
    { owner: string; native: number; offset: number; latest: number }
  >()
  const present = (owner: string, detail: ProviderChatDetail) => {
    const previous = revisions.get(detail.id)
    const offset =
      previous?.owner === owner
        ? previous.offset
        : previous
          ? previous.latest + 1 - detail.revision
          : 0
    const revision = detail.revision + offset
    if (!previous || previous.owner !== owner || detail.revision >= previous.native)
      revisions.set(detail.id, { owner, native: detail.revision, offset, latest: revision })
    return { ...detail, revision }
  }
  const publish =
    (owner: string): Parameters<ProviderAdapter['onChatUpdated']>[0] =>
    (detail, metadata) => {
      if (disposed || (owners.has(detail.id) && owners.get(detail.id) !== owner)) return
      const bound = present(owner, detail)
      latest.set(detail.id, {
        status: bound.status,
        pendingApproval: bound.pendingApproval,
        lastTurnOutcome: bound.lastTurnOutcome
      })
      listeners.forEach((listener) => listener(bound, metadata))
    }
  let disposed = false
  const assertOpen = () => {
    if (disposed) throw new Error('Chat process runtimes are disposed.')
  }
  const unsubscribe = base.onChatUpdated(publish('base'))
  const unsubscribeUsage = base.onTokenUsage?.((event) =>
    usageListeners.forEach((listener) => listener(event))
  )
  const runtime = (scope: ProviderProcessScope): ProviderAdapter => {
    assertOpen()
    const previous = runtimes.get(scope.record.id)
    if (previous) return previous
    if (scope.record.chatId) owners.set(scope.record.chatId, scope.record.id)
    const adapter = providerProcessContext.run(scope, dependencies.create)
    // Explicitly restore context on every call, including approvals and retries
    // which arrive from a different renderer request or timer.
    const wrapped = Object.fromEntries(
      Object.entries(adapter).map(([name, value]) => [
        name,
        typeof value === 'function'
          ? (...args: unknown[]) =>
              providerProcessContext.run(scope, () =>
                (value as (...args: unknown[]) => unknown)(...args)
              )
          : value
      ])
    ) as ProviderAdapter
    wrapped.onChatUpdated(publish(scope.record.id))
    wrapped.onTokenUsage?.((event) => usageListeners.forEach((listener) => listener(event)))
    runtimes.set(scope.record.id, wrapped)
    return wrapped
  }
  const recover = (scope: ProviderProcessScope): Promise<void> => {
    let recovery = recoveries.get(scope.record.id)
    if (!recovery) {
      recovery = Promise.resolve(
        runtime(scope).recoverRuntime?.({ container: scope.record.container })
      )
      recoveries.set(scope.record.id, recovery)
      void recovery.catch(() => recoveries.delete(scope.record.id))
    }
    return recovery
  }
  const select = async (chatId: string, create: boolean) => {
    const { container } = await dependencies.metadata(chatId)
    const found = await store.find(base.id, accountId, chatId, container ?? null)
    assertOpen()
    if (found) {
      await recover(found)
      return found
    }
    if (!create) return undefined
    await base.releaseChat?.(chatId, { container })
    const scope = await store.create(base.id, accountId, container ?? null)
    await scope.bind(chatId)
    return scope
  }
  // Concurrent first sends must never manufacture two boundaries for one chat.
  const selecting = new Map<string, Promise<ProviderProcessScope | undefined>>()
  const selectChat = (id: string, create: boolean) => {
    const key = `${create}:${id}`
    let pending = selecting.get(key)
    if (!pending) {
      pending = select(id, create)
      selecting.set(key, pending)
      void pending.finally(() => selecting.delete(key)).catch(() => {})
    }
    return pending
  }
  const created =
    (scope: ProviderProcessScope, callback?: (id: string) => Promise<void>) =>
    async (id: string) => {
      assertOpen()
      await scope.bind(id)
      owners.set(id, scope.record.id)
      await callback?.(id)
    }
  const overrides: Partial<ProviderAdapter> = {
    getModels: async (options) => {
      assertOpen()
      if (!options?.chatId) return base.getModels(options)
      const { container } = await dependencies.metadata(options.chatId)
      assertOpen()
      return base.getModels({ ...options, container: container ?? null })
    },
    getChats: async (options) => {
      const page = await base.getChats(options)
      return {
        ...page,
        chats: page.chats.map((chat) => {
          const detail = latest.get(chat.id)
          return detail
            ? {
                ...chat,
                status: detail.status,
                pendingApproval: detail.pendingApproval,
                lastTurnOutcome: detail.lastTurnOutcome
              }
            : chat
        })
      }
    },
    onChatUpdated: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onTokenUsage: (listener) => {
      usageListeners.add(listener)
      return () => {
        usageListeners.delete(listener)
      }
    },
    startChat: async (message, options, callback) => {
      assertOpen()
      const scope = await store.create(base.id, accountId, options?.container ?? null)
      try {
        const detail = await runtime(scope).startChat(message, options, created(scope, callback))
        await scope.bind(detail.id)
        return present(scope.record.id, detail)
      } catch (error) {
        if (!scope.record.chatId && !scope.record.unavailable) await store.stop(scope.record.id)
        throw error
      }
    },
    importHistory: base.importHistory
      ? async (id, messages, options, callback) => {
          const scope = id
            ? await selectChat(id, true)
            : await store.create(base.id, accountId, options.container ?? null)
          const result = await runtime(scope!).importHistory!(
            id,
            messages,
            options,
            created(scope!, callback)
          )
          await scope!.bind(result)
          return result
        }
      : undefined,
    recoverRuntime: base.recoverRuntime
      ? async (options) => {
          await base.recoverRuntime?.(options)
          for (const scope of await store.all(base.id, accountId)) {
            if (
              scope.record.chatId &&
              !scope.record.stopped &&
              getContainerTargetKey(scope.record.container) ===
                getContainerTargetKey(options?.container)
            )
              await recover(scope)
          }
        }
      : undefined,
    stopChatProcesses: async (id, options) => {
      const scope = await selectChat(id, false)
      // Never create a replacement runtime merely to stop one after restart.
      const adapter = scope ? runtime(scope) : base
      return (await adapter.stopChatProcesses?.(id, options)) ?? []
    },
    dispose: async () => {
      disposed = true
      unsubscribe()
      unsubscribeUsage?.()
      await Promise.all([
        base.dispose(),
        ...[...runtimes.values()].map((adapter) => adapter.dispose())
      ])
      runtimes.clear()
      listeners.clear()
      usageListeners.clear()
      owners.clear()
      latest.clear()
      revisions.clear()
    }
  }
  for (const method of chatMethods) {
    if (typeof (base as unknown as Record<string, unknown>)[method] !== 'function') continue
    Object.assign(overrides, {
      [method]: async (id: string, ...args: unknown[]) => {
        assertOpen()
        const forkCallback = forkMethods.get(method)
        let scope: ProviderProcessScope | undefined
        if (forkCallback !== undefined) {
          const metadata = await dependencies.metadata(id)
          scope = await store.create(base.id, accountId, metadata.container ?? null)
          scope.sourceChatId = id
          args[forkCallback - 1] = created(
            scope,
            args[forkCallback - 1] as ((id: string) => Promise<void>) | undefined
          )
        } else scope = await selectChat(id, executionMethods.has(method))
        const adapter = scope ? runtime(scope) : base
        const call = (
          adapter as unknown as Record<string, (id: string, ...args: unknown[]) => Promise<unknown>>
        )[method]
        if (!scope) owners.set(id, 'base')
        const result = await call(id, ...args)
        return result && typeof result === 'object' && 'revision' in result && 'items' in result
          ? present(scope?.record.id ?? 'base', result as ProviderChatDetail)
          : result
      }
    })
  }
  const controls: Record<string, unknown> = {}
  const named = (adapter: ProviderAdapter) =>
    adapter as unknown as Record<string, (...args: unknown[]) => unknown>
  for (const method of ['clearAuthenticationFailure', 'resetClientsForContainer']) {
    if (typeof named(base)[method] !== 'function') continue
    controls[method] = (...args: unknown[]) => {
      named(base)[method](...args)
      for (const adapter of runtimes.values()) named(adapter)[method]?.(...args)
    }
  }
  if (typeof named(base).changeAccount === 'function')
    controls.changeAccount = (container: unknown, change: () => Promise<unknown>) => {
      let run = change
      for (const adapter of [base, ...runtimes.values()]) {
        const next = run
        run = () => named(adapter).changeAccount(container, next) as Promise<unknown>
      }
      return run()
    }
  return { ...base, ...overrides, ...controls } as T
}
