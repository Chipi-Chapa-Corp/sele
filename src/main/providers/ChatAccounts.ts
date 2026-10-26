import type { AppContainerTarget } from '../../shared/app'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatMetadata,
  ProviderSourceOptions
} from '../../shared/provider'
import type { ProviderAdapter } from './ProviderAdapter'
import type { TokenUsageObservation } from './TokenUsageReporter'

// Every operation whose first argument identifies a conversation must use its saved account,
// including background retries, approvals, forks, subagents, and transcript navigation.
const chatMethods = [
  'releaseChat',
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
  'continueChat',
  'continueChatInFork',
  'forkChat',
  'sendActiveChatMessage',
  'enqueueLimitResetMessage',
  'deletePendingMessage',
  'beginPendingMessageEdit',
  'cancelPendingMessageEdit',
  'editPendingMessage',
  'steerPendingMessage',
  'interruptPendingMessage',
  'editMessage',
  'resolveApproval',
  'resolveUserInput',
  'compactChat',
  'summarizeChatInFork',
  'stopChat'
] as const satisfies readonly (keyof ProviderAdapter)[]
const forkCallbacks: Partial<Record<(typeof chatMethods)[number], number>> = {
  continueChatInFork: 3,
  forkChat: 2,
  summarizeChatInFork: 2
}

type Dependencies = {
  metadata: (id: string) => Promise<ProviderChatMetadata>
  save: (id: string, account: string, replace?: boolean) => Promise<string>
  bindListed?: (
    chats: Pick<ProviderChat, 'id' | 'container'>[],
    account: string
  ) => Promise<Map<string, ProviderChatMetadata>>
  selected: (container?: AppContainerTarget | null) => Promise<string>
  create: (account: string) => ProviderAdapter
}

/** Separate provider runtimes let chats on different accounts run concurrently. */
export class ChatAccounts {
  readonly adapter: ProviderAdapter
  private runtimes = new Map<string, ProviderAdapter>()
  private bindings = new Map<string, string>()
  private listeners = new Set<Parameters<ProviderAdapter['onChatUpdated']>[0]>()
  private usageListeners = new Set<(observation: TokenUsageObservation) => void>()
  private latest = new Map<
    string,
    Pick<ProviderChatDetail, 'id' | 'status' | 'pendingApproval' | 'lastTurnOutcome'>
  >()
  private revisions = new Map<
    string,
    { account: string; native: number; offset: number; latest: number }
  >()
  private changes = new Map<string, Promise<void>>()
  private operations = new Map<string, Set<Promise<unknown>>>()

  private dependencies: Dependencies

  constructor(base: ProviderAdapter, dependencies: Dependencies) {
    this.dependencies = dependencies
    const unsubscribeBaseUsage = base.onTokenUsage?.((observation) =>
      this.usageListeners.forEach((listener) => listener(observation))
    )
    const overrides: Partial<ProviderAdapter> = {
      onChatUpdated: (listener) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
      onTokenUsage: (listener) => {
        this.usageListeners.add(listener)
        return () => {
          this.usageListeners.delete(listener)
        }
      },
      startChat: async (message, options, created) => {
        const account = options?.accountId ?? (await dependencies.selected(options?.container))
        return this.present(
          account,
          await this.runtime(account).startChat(message, options, this.created(account, created))
        )
      },
      importHistory: base.importHistory
        ? async (id, messages, options, created) => {
            const account = id
              ? await this.account(id)
              : await dependencies.selected(options.container)
            return this.runtime(account).importHistory!(
              id,
              messages,
              options,
              this.created(account, created)
            )
          }
        : undefined,
      getHistoricalTokenUsage: base.getHistoricalTokenUsage
        ? async (id, options) => {
            const runtime = id ? this.runtime(await this.account(id)) : base
            return runtime.getHistoricalTokenUsage!(id, options)
          }
        : undefined,
      getChats: async (options) => {
        // Native history is shared between accounts. Discovery stays independent of runtime
        // ownership; overlay live state from the account that actually owns each conversation.
        const account = await dependencies.selected(options?.container)
        const page = await base.getChats(options)
        const listed = await dependencies.bindListed?.(page.chats, account)
        const chats = await Promise.all(
          page.chats.map(async (chat) => {
            const metadata = listed?.get(chat.id) ?? (await dependencies.metadata(chat.id))
            const bound = metadata.accountId ?? (await dependencies.save(chat.id, account))
            this.bindings.set(chat.id, bound)
            const detail = this.latest.get(chat.id)
            return detail
              ? {
                  ...chat,
                  accountId: bound,
                  status: detail.status,
                  pendingApproval: detail.pendingApproval,
                  lastTurnOutcome: detail.lastTurnOutcome
                }
              : { ...chat, accountId: bound }
          })
        )
        return { ...page, chats }
      },
      dispose: async () => {
        unsubscribeBaseUsage?.()
        await Promise.all([
          base.dispose(),
          ...[...this.runtimes.values()].map((runtime) => runtime.dispose())
        ])
        this.runtimes.clear()
        this.listeners.clear()
        this.usageListeners.clear()
        this.latest.clear()
        this.bindings.clear()
        this.revisions.clear()
        this.changes.clear()
        this.operations.clear()
      }
    }
    for (const method of chatMethods) {
      if (!base[method]) continue
      Object.assign(overrides, {
        [method]: (id: string, ...args: unknown[]) =>
          this.withChat(id, async (account) => {
            const runtime = this.runtime(account)
            const callback = forkCallbacks[method]
            if (callback !== undefined) {
              args[callback - 1] = this.created(
                account,
                args[callback - 1] as ((id: string) => Promise<void>) | undefined
              )
            }
            const run = runtime[method] as (id: string, ...args: unknown[]) => Promise<unknown>
            const result = await run(id, ...args)
            return result && typeof result === 'object' && 'revision' in result && 'items' in result
              ? this.present(account, result as ProviderChatDetail, method === 'getChat')
              : result
          })
      })
    }
    for (const method of [
      'getModels',
      'getUsage',
      'getApps',
      'resetRateLimits',
      'login'
    ] as const) {
      Object.assign(overrides, {
        [method]: async (options?: ProviderSourceOptions) => {
          const runtime = options?.chatId
            ? this.runtime(await this.account(options.chatId))
            : options?.accountId
              ? this.runtime(options.accountId)
              : base
          return runtime[method](options)
        }
      })
    }
    this.adapter = { ...base, ...overrides }
  }

  account = async (id: string): Promise<string> => {
    await this.changes.get(id)
    return this.readAccount(id)
  }

  private readAccount = async (id: string): Promise<string> => {
    const metadata = await this.dependencies.metadata(id)
    const account =
      metadata.accountId ??
      (await this.dependencies.save(id, await this.dependencies.selected(metadata.container)))
    this.bindings.set(id, account)
    return account
  }

  select = (id: string, account: string): Promise<void> => {
    // Finish operations admitted before this switch so a late history open cannot
    // reclaim the old runtime's writer after releaseChat has handed it off.
    const operations = [...(this.operations.get(id) ?? [])]
    const pending = (this.changes.get(id) ?? Promise.resolve()).then(async () => {
      await Promise.allSettled(operations)
      const previous = await this.readAccount(id)
      if (previous === account) return
      const runtime = this.runtimes.get(previous)
      const metadata = await this.dependencies.metadata(id)
      if (runtime?.releaseChat) await runtime.releaseChat(id, { container: metadata.container })
      else if (runtime) await runtime.stopChat(id)
      await this.dependencies.save(id, account, true)
      this.bindings.set(id, account)
      this.latest.delete(id)
    })
    this.changes.set(id, pending)
    void pending
      .finally(() => {
        if (this.changes.get(id) === pending) this.changes.delete(id)
      })
      .catch(() => {})
    return pending
  }

  private withChat = <T>(id: string, run: (account: string) => Promise<T>): Promise<T> => {
    const pending = this.account(id).then(run)
    const operations = this.operations.get(id) ?? new Set<Promise<unknown>>()
    operations.add(pending)
    this.operations.set(id, operations)
    void pending
      .finally(() => {
        operations.delete(pending)
        if (operations.size === 0 && this.operations.get(id) === operations)
          this.operations.delete(id)
      })
      .catch(() => {})
    return pending
  }

  private present = (
    account: string,
    detail: ProviderChatDetail,
    rememberActivity = false
  ): ProviderChatDetail => {
    if (this.bindings.has(detail.id) && this.bindings.get(detail.id) !== account)
      throw new Error('This chat’s account changed while loading. Please try again.')
    const previous = this.revisions.get(detail.id)
    const offset =
      previous?.account === account
        ? previous.offset
        : previous
          ? previous.latest + 1 - detail.revision
          : 0
    const revision = detail.revision + offset
    if (!previous || previous.account !== account || detail.revision >= previous.native) {
      this.revisions.set(detail.id, { account, native: detail.revision, offset, latest: revision })
      // A direct open can recover a completion whose event was missed. Sidebar overlays must
      // advance with that read instead of restoring the old running status on the next list.
      if (rememberActivity)
        this.latest.set(detail.id, {
          id: detail.id,
          status:
            detail.pendingUserInput && detail.status !== 'waitingOnApproval'
              ? 'waitingOnUserInput'
              : detail.status,
          pendingApproval: detail.pendingApproval,
          lastTurnOutcome: detail.lastTurnOutcome
        })
    }
    return { ...detail, accountId: account, revision }
  }

  private created =
    (account: string, callback?: (id: string) => Promise<void>) => async (id: string) => {
      await this.dependencies.save(id, account, true)
      this.bindings.set(id, account)
      await callback?.(id)
    }

  private runtime = (account: string): ProviderAdapter => {
    const existing = this.runtimes.get(account)
    if (existing) return existing
    const runtime = this.dependencies.create(account)
    runtime.onChatUpdated((detail, metadata) => {
      if (this.bindings.get(detail.id) !== account) return
      const bound = this.present(account, detail, true)
      this.listeners.forEach((listener) => listener(bound, metadata))
    })
    runtime.onTokenUsage?.((observation) =>
      this.usageListeners.forEach((listener) => listener(observation))
    )
    this.runtimes.set(account, runtime)
    return runtime
  }
}
