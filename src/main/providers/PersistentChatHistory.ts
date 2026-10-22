import type { AppContainerTarget } from '../../shared/app'
import type {
  ProviderAccountConfiguration,
  ProviderChat,
  ProviderChatDetail,
  ProviderId
} from '../../shared/provider'
import type { CachedChatHistory, ChatHistoryStore } from '../database/chatHistoryCache'
import { getContainerTargetKey } from '../containerTarget.ts'
import { getProviderChatTurnCount } from '../../shared/chatTurns.ts'

const sourceKey = (provider: ProviderId, container?: AppContainerTarget | null) =>
  JSON.stringify([provider, getContainerTargetKey(container)])
const chatKey = (chat: ProviderChat) =>
  JSON.stringify([sourceKey(chat.providerId, chat.container), chat.id])
const eligible = (chat: {
  status: ProviderChat['status']
  done: boolean
  purpose: ProviderChat['purpose']
}) => chat.status === null && !chat.done && chat.purpose === null
const fingerprint = (chat: ProviderChat) =>
  JSON.stringify([
    chat.createdAt,
    chat.updatedAt,
    chat.title,
    chat.preview,
    chat.cwd,
    chat.imported ?? null
  ])
type Observation = {
  chat: ProviderChat
  fingerprint: string
  invalidated: boolean
  epoch: number
  latestRevision?: number
}
export type HistoryRead = {
  observation: Observation
  key: string
  account: string
  epoch: number
  accountEpoch: number
}
export type ConversationViewScope = {
  key: string
  provider: ProviderId
  chatId: string
  containerKey: string
  current: () => boolean
}

/** A persisted page is a display-only preview until the authoritative provider read finishes. */
export class PersistentChatHistory {
  private observations = new Map<string, Observation>()
  private byChat = new Map<string, Set<Observation>>()
  private accounts = new Map<string, string>()
  private viewAccounts = new Map<string, string>()
  private accountEpochs = new Map<string, number>()
  private closed = false

  private store: ChatHistoryStore

  constructor(store: ChatHistoryStore) {
    this.store = store
  }

  dispose(): void {
    this.closed = true
    this.observations.clear()
    this.byChat.clear()
    this.accounts.clear()
    this.viewAccounts.clear()
  }

  accountEpoch(provider: ProviderId, container?: AppContainerTarget | null): number {
    return this.accountEpochs.get(sourceKey(provider, container)) ?? 0
  }

  setAccount(
    provider: ProviderId,
    container: AppContainerTarget | null | undefined,
    configuration: ProviderAccountConfiguration,
    epoch: number
  ): void {
    if (this.accountEpoch(provider, container) !== epoch) return
    const active = configuration.accounts
      .filter((account) => account.active)
      .map((account) => [account.id, account.login ?? null])
      .sort()
    const key = sourceKey(provider, container)
    this.viewAccounts.set(key, JSON.stringify(active))
    if (active.length) this.accounts.set(key, JSON.stringify(active))
    else this.accounts.delete(key)
  }

  forgetAccount(provider: ProviderId, container?: AppContainerTarget | null): void {
    const key = sourceKey(provider, container)
    this.accounts.delete(key)
    this.viewAccounts.delete(key)
    this.accountEpochs.set(key, this.accountEpoch(provider, container) + 1)
  }

  /** Stable identity for durable views. Native freshness and RAM budgets are unrelated. */
  viewScope(
    provider: ProviderId,
    id: string,
    container?: AppContainerTarget | null
  ): ConversationViewScope | null {
    const source = sourceKey(provider, container)
    const account = this.viewAccounts.get(source)
    if (!account || this.closed) return null
    const epoch = this.accountEpoch(provider, container)
    return {
      key: JSON.stringify([source, account, id]),
      provider,
      chatId: id,
      containerKey: getContainerTargetKey(container),
      current: () =>
        !this.closed &&
        this.viewAccounts.get(source) === account &&
        this.accountEpoch(provider, container) === epoch
    }
  }

  openingViewScope(
    provider: ProviderId,
    id: string,
    container?: AppContainerTarget | null
  ): ConversationViewScope | null {
    if (container) return this.viewScope(provider, id, container)
    const candidates = this.byChat.get(`${provider}:${id}`)
    if (candidates?.size === 1)
      return this.viewScope(provider, id, candidates.values().next().value!.chat.container)
    if (candidates && candidates.size > 1) return null
    return this.viewScope(provider, id, container)
  }

  observe(chats: ProviderChat[]): void {
    if (this.closed) return
    for (const chat of chats) {
      const key = chatKey(chat)
      const old = this.observations.get(key)
      const stamp = fingerprint(chat)
      if (old?.fingerprint === stamp && eligible(chat)) old.chat = chat
      else {
        if (old) this.byChat.get(`${chat.providerId}:${chat.id}`)?.delete(old)
        const observation = { chat, fingerprint: stamp, invalidated: false, epoch: 0 }
        this.observations.set(key, observation)
        const group = this.byChat.get(`${chat.providerId}:${chat.id}`) ?? new Set<Observation>()
        group.add(observation)
        this.byChat.set(`${chat.providerId}:${chat.id}`, group)
      }
    }
    while (this.observations.size > 2_000) {
      const oldest = this.observations.keys().next().value!
      const observation = this.observations.get(oldest)!
      const id = `${observation.chat.providerId}:${observation.chat.id}`
      this.byChat.get(id)?.delete(observation)
      if (!this.byChat.get(id)?.size) this.byChat.delete(id)
      this.observations.delete(oldest)
    }
  }

  invalidate(provider: ProviderId, id: string): void {
    for (const observation of this.byChat.get(`${provider}:${id}`) ?? []) {
      observation.invalidated = true
      observation.epoch++
    }
  }

  begin(
    provider: ProviderId,
    id: string,
    container?: AppContainerTarget | null
  ): HistoryRead | null {
    if (this.closed) return null
    const source = sourceKey(provider, container)
    const account = this.accounts.get(source)
    const observation = this.observations.get(JSON.stringify([source, id]))
    if (!account || !observation || !eligible(observation.chat)) return null
    return {
      observation,
      account,
      key: JSON.stringify([source, account, id]),
      epoch: observation.epoch,
      accountEpoch: this.accountEpoch(provider, container)
    }
  }

  beginOpening(
    provider: ProviderId,
    id: string,
    container?: AppContainerTarget | null
  ): HistoryRead | null {
    const exact = this.begin(provider, id, container)
    if (exact || container) return exact
    const candidates = this.byChat.get(`${provider}:${id}`)
    if (candidates?.size !== 1) return null
    // Adapters remember discovered environments before metadata is persisted.
    // Only recording may use this fallback; preview lookups always use the
    // explicit requested environment, and save validates the returned source.
    return this.begin(provider, id, candidates.values().next().value!.chat.container)
  }

  private current(read: HistoryRead): boolean {
    return (
      !this.closed &&
      read.accountEpoch ===
        this.accountEpoch(read.observation.chat.providerId, read.observation.chat.container) &&
      read.epoch === read.observation.epoch &&
      this.accounts.get(
        sourceKey(read.observation.chat.providerId, read.observation.chat.container)
      ) === read.account &&
      this.observations.get(chatKey(read.observation.chat)) === read.observation
    )
  }

  async preview(
    provider: ProviderId,
    id: string,
    container?: AppContainerTarget | null
  ): Promise<ProviderChatDetail | null> {
    const read = this.begin(provider, id, container)
    if (!read || read.observation.invalidated) return null
    const history = await this.store.read(read.key, read.observation.fingerprint)
    if (!history || !this.current(read) || read.observation.invalidated) return null
    const { providerId: _, preview: __, updatedAt: ___, ...chat } = read.observation.chat
    return {
      ...chat,
      ...history,
      revision: -1,
      historyPreview: true,
      writeAccess: 'checking',
      capabilities: { editMessages: false, activeMessages: false },
      pendingApproval: null,
      pendingUserInput: null,
      contextUsage: null,
      subagents: []
    }
  }

  async save(read: HistoryRead | null, detail: ProviderChatDetail): Promise<void> {
    if (
      !read ||
      !this.current(read) ||
      detail.id !== read.observation.chat.id ||
      getContainerTargetKey(detail.container) !==
        getContainerTargetKey(read.observation.chat.container) ||
      !eligible(detail) ||
      detail.authenticationRequired ||
      detail.pendingApproval ||
      detail.pendingUserInput ||
      detail.historyPreview ||
      detail.turnPagination?.newerCursor ||
      (!detail.turnPagination &&
        detail.turnCount !== undefined &&
        (detail.itemsStartTurnIndex ?? 0) + getProviderChatTurnCount(detail.items) <
          detail.turnCount) ||
      detail.items.some(
        (item) =>
          item.type === 'pendingMessage' || (item.type === 'working' && item.status === 'working')
      )
    )
      return
    if (detail.revision < (read.observation.latestRevision ?? -1)) return
    read.observation.latestRevision = detail.revision
    // Snapshot observation identity as well as its invalidation state. A live
    // event during serialization/SQLite work must not resurrect the old page.
    const history: CachedChatHistory = {
      items: detail.items,
      itemsStartTurnIndex: detail.itemsStartTurnIndex,
      turnCount: detail.turnCount,
      turnPagination: detail.turnPagination
    }
    const saved = await this.store.save(
      read.key,
      read.observation.fingerprint,
      history,
      () => this.current(read) && read.observation.latestRevision === detail.revision
    )
    if (saved && this.current(read)) read.observation.invalidated = false
  }
}
