import { ImportedHistoryView } from './ImportedHistoryView.ts'
import type { AppContainerTarget } from '../../shared/app'
import { getContainerTargetKey } from '../containerTarget.ts'
import type { SeleChatArchive } from '../../shared/chatArchive.ts'
import type {
  ProviderChatDetail,
  ProviderChatItem,
  ProviderWorkingItem,
  ProviderId,
  ProviderTurnOptions
} from '../../shared/provider.ts'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../shared/chatTurns.ts'
import { transcriptMessages, migrationNote } from './ChatTranscript.ts'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from './ProviderAdapter.ts'

export type ImportedConversation = {
  providerId: ProviderId
  container?: AppContainerTarget | null
  chatId: string
  state: 'loading' | 'ready' | 'cancelled'
  title: string
  createdAt: number
  original: { providerId: ProviderId; chatId: string }
  archive: SeleChatArchive
  baseline: string[]
}
export type ImportStore = {
  list: () => Promise<ImportedConversation[]>
  get: (id: string) => Promise<ImportedConversation>
  save: (record: ImportedConversation) => Promise<void>
}
type Listener = (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
const key = (providerId: ProviderId, id: string): string => `${providerId}:${id}`
const fullWindow = { startIndex: 0, limit: Number.MAX_SAFE_INTEGER }

const archivedItems = (items: ProviderChatItem[], namespace = ''): ProviderChatItem[] =>
  items.map((item): ProviderChatItem => {
    const id = `${namespace}${item.id}`
    if (item.type === 'message') return { ...item, id, editTargetId: null }
    if (item.type === 'pendingMessage')
      return {
        ...item,
        id,
        type: 'message',
        role: 'user',
        kind: undefined,
        label: 'Unsent message from archive',
        editTargetId: null
      }
    if (item.type === 'working') {
      const readonlyActivity = (activity: ProviderWorkingItem): ProviderWorkingItem => {
        if (activity.type === 'tool')
          return activity.status === 'finished' && !activity.mcpApp
            ? activity
            : { ...activity, mcpApp: undefined, status: 'finished' }
        if (activity.type === 'toolGroup')
          return {
            ...activity,
            tools: activity.tools.map((tool) => ({
              ...tool,
              ...(tool.mcpApp ? { mcpApp: undefined } : {}),
              status: 'finished'
            }))
          }
        return activity
      }
      return {
        ...item,
        id,
        status: item.status === 'working' || item.status === 'queued' ? 'stopped' : item.status,
        items: item.items.map(readonlyActivity),
        itemSegments: undefined
      }
    }
    return { ...item, id }
  })

/** The archive is immutable history; all future commands and events use the chosen native session. */
export class ImportedConversations {
  private records = new Map<string, ImportedConversation>()
  private hydrated = new WeakSet<ImportedConversation>()
  private loads = new Map<string, Promise<ImportedConversation>>()
  private listeners = new Map<ProviderId, Set<Listener>>()
  private creating = new Map<ProviderId, Set<Promise<void>>>()
  private projections = new Map<string, { revision: number; detail: ProviderChatDetail }>()
  private ready: Promise<void> | null = null
  private native: Record<ProviderId, ProviderAdapter>
  private store: ImportStore
  private views = new WeakMap<ImportedConversation, ImportedHistoryView>()
  private prefixes = new WeakMap<ImportedConversation, ProviderChatItem[]>()
  constructor(native: Record<ProviderId, ProviderAdapter>, store: ImportStore) {
    this.native = native
    this.store = store
    for (const adapter of Object.values(native)) {
      this.listeners.set(adapter.id, new Set())
      adapter.onChatUpdated((detail, metadata) => {
        void this.receive(adapter.id, detail, metadata).catch((error) =>
          console.error('Unable to load imported chat update', error)
        )
      })
    }
  }
  private initialize(): Promise<void> {
    return (this.ready ??= this.store.list().then((records) => {
      for (const record of records) this.records.set(key(record.providerId, record.chatId), record)
    }))
  }
  private async record(
    providerId: ProviderId,
    id: string
  ): Promise<ImportedConversation | undefined> {
    await this.initialize()
    const idKey = key(providerId, id)
    const record = this.records.get(idKey)
    if (!record || this.hydrated.has(record)) return record
    let loading = this.loads.get(idKey)
    if (!loading) {
      loading = this.store
        .get(idKey)
        .then((full) => {
          Object.assign(record, full)
          this.hydrated.add(record)
          return record
        })
        .finally(() => this.loads.delete(idKey))
      this.loads.set(idKey, loading)
    }
    return loading
  }
  private async receive(
    providerId: ProviderId,
    detail: ProviderChatDetail,
    metadata?: ProviderChatUpdateMetadata
  ): Promise<void> {
    await this.initialize()
    if (!this.records.has(key(providerId, detail.id)))
      await Promise.all([...(this.creating.get(providerId) ?? [])])
    const indexed = this.records.get(key(providerId, detail.id))
    if (indexed && indexed.state !== 'ready') return
    const record = await this.record(providerId, detail.id)
    if (record && record.state !== 'ready') return
    const projected = record ? this.view(record).fromNative(detail) : detail
    this.listeners.get(providerId)!.forEach((listener) => listener(projected, metadata))
  }
  async full(
    providerId: ProviderId,
    id: string,
    container?: ProviderChatDetail['container']
  ): Promise<ProviderChatDetail> {
    const record = await this.record(providerId, id)
    container ??= record?.container
    const adapter = this.native[providerId]
    const native = await (adapter.getChatWindow?.(id, fullWindow, { container }) ??
      adapter.getChat(id, { container }))
    return record ? this.project(record, native, true) : native
  }
  private view(record: ImportedConversation): ImportedHistoryView {
    let view = this.views.get(record)
    if (!view) {
      view = new ImportedHistoryView(
        record,
        this.native[record.providerId],
        (items) => archivedItems(items, 'archive:'),
        (detail, items) => ({
          ...detail,
          items,
          imported: record.original,
          container: record.container ?? detail.container,
          title: record.title,
          createdAt: record.createdAt,
          capabilities: { ...detail.capabilities, editMessages: false },
          subagents: this.subagents(record, detail.subagents)
        })
      )
      this.views.set(record, view)
    }
    return view
  }
  private subagents(
    record: ImportedConversation,
    native: ProviderChatDetail['subagents'] = []
  ): NonNullable<ProviderChatDetail['subagents']> {
    return [
      ...(record.archive.chat.subagents ?? []).map((agent) => ({
        ...agent,
        id: `archive:${agent.id}`,
        parentId: record.chatId,
        beforeItemId: agent.beforeItemId ? `archive:${agent.beforeItemId}` : agent.beforeItemId,
        afterItemId: agent.afterItemId ? `archive:${agent.afterItemId}` : agent.afterItemId,
        turnId: agent.turnId ? `archive:${agent.turnId}` : agent.turnId,
        canMessage: false,
        status: 'completed' as const
      })),
      ...native
    ]
  }
  private project(
    record: ImportedConversation,
    detail: ProviderChatDetail,
    replace = false
  ): ProviderChatDetail {
    const idKey = key(record.providerId, record.chatId)
    const cached = this.projections.get(idKey)
    if (cached && cached.revision > detail.revision) return cached.detail
    const baseline = new Set(record.baseline)
    const next = detail.items
      .filter((item) => !baseline.has(item.id))
      .map((item) =>
        item.type === 'message' &&
        item.role === 'user' &&
        item.content.startsWith(`${migrationNote}\n`)
          ? { ...item, content: item.content.slice(migrationNote.length + 1) }
          : item
      )
    const old = cached?.detail.items.filter((item) => !item.id.startsWith('archive:')) ?? []
    const first = next.length ? old.findIndex((item) => item.id === next[0]!.id) : -1
    const tail = replace
      ? next
      : next.length
        ? [
            ...old
              .slice(0, first < 0 ? old.length : first)
              .filter((item) => item.type !== 'pendingMessage'),
            ...next
          ]
        : old
    let prefix = this.prefixes.get(record)
    if (!prefix) {
      prefix = archivedItems(record.archive.chat.items, 'archive:')
      this.prefixes.set(record, prefix)
    }
    const projected: ProviderChatDetail = {
      ...detail,
      imported: record.original,
      container: record.container ?? detail.container,
      title: record.title,
      createdAt: record.createdAt,
      revision: Math.max(detail.revision, cached?.detail.revision ?? 0) + 1,
      capabilities: { ...detail.capabilities, editMessages: false },
      items: [...prefix, ...tail],
      subagents: [
        ...(record.archive.chat.subagents ?? []).map((agent) => ({
          ...agent,
          id: `archive:${agent.id}`,
          parentId:
            agent.parentId === record.archive.chat.id
              ? record.chatId
              : agent.parentId
                ? `archive:${agent.parentId}`
                : record.chatId,
          turnId: agent.turnId ? `archive:${agent.turnId}` : agent.turnId,
          beforeItemId: agent.beforeItemId ? `archive:${agent.beforeItemId}` : agent.beforeItemId,
          afterItemId: agent.afterItemId ? `archive:${agent.afterItemId}` : agent.afterItemId,
          canMessage: false,
          status: 'completed' as const
        })),
        ...(detail.subagents ?? [])
      ],
      itemsStartTurnIndex: 0,
      turnCount: undefined,
      turnPagination: undefined
    }
    this.projections.set(idKey, { revision: detail.revision, detail: projected })
    return projected
  }
  async importArchive(
    archive: SeleChatArchive,
    providerId: ProviderId,
    options: ProviderTurnOptions,
    cancelled: () => boolean
  ): Promise<ProviderChatDetail | null> {
    await this.initialize()
    const adapter = this.native[providerId]
    if (!adapter.importHistory) throw new Error('This provider does not support chat import.')
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const gates = this.creating.get(providerId) ?? new Set<Promise<void>>()
    this.creating.set(providerId, gates)
    gates.add(gate)
    const unlock = (): void => {
      gates.delete(gate)
      release()
    }
    let record: ImportedConversation | undefined
    try {
      if (cancelled()) return null
      const id = await adapter.importHistory(
        null,
        transcriptMessages(archive.chat.items),
        options,
        async (chatId) => {
          record = {
            providerId,
            container: options.container ?? null,
            chatId,
            state: 'loading',
            title: archive.chat.title,
            createdAt: archive.chat.createdAt,
            original: { providerId: archive.providerId, chatId: archive.chat.id },
            archive,
            baseline: []
          }
          this.records.set(key(providerId, chatId), record)
          this.hydrated.add(record)
          await this.store.save(record)
          unlock()
          if (cancelled()) throw new Error('Chat import cancelled.')
        }
      )
      if (!record) throw new Error('Provider did not register the imported session.')
      if (cancelled()) return null
      const detail = await (adapter.getChatWindow?.(id, fullWindow, {
        container: options.container
      }) ?? adapter.getChat(id, { container: options.container }))
      record.baseline = detail.items.map((item) => item.id)
      if (cancelled()) return null
      await this.store.save({ ...record, state: 'ready' })
      record.state = 'ready'
      if (cancelled()) {
        record.state = 'cancelled'
        return null
      }
      return this.view(record).fromNative(detail)
    } finally {
      unlock()
      if (record && record.state !== 'ready') {
        record.state = 'cancelled'
        record.archive = {
          ...record.archive,
          chat: { ...record.archive.chat, items: [], subagents: [] },
          subagents: [],
          assets: []
        }
        record.baseline = []
        await this.store.save(record)
      }
    }
  }
  async archive(
    providerId: ProviderId,
    id: string,
    container?: ProviderChatDetail['container']
  ): Promise<SeleChatArchive> {
    const chat = await this.full(providerId, id, container)
    chat.subagents = await this.wrap(providerId).getSubagents(id, { container })
    const subagents = await Promise.all(
      (chat.subagents ?? []).map((agent) =>
        this.wrap(providerId).getSubagent(id, agent.id, { container }, fullWindow)
      )
    )
    return {
      format: 'sele-chat',
      version: 1,
      exportedAt: Date.now(),
      providerId,
      chat,
      subagents,
      assets: []
    }
  }
  wrap(providerId: ProviderId): ProviderAdapter {
    const adapter = this.native[providerId]
    return new Proxy(adapter, {
      get: (target, property) => {
        if (property === 'onChatUpdated')
          return (listener: Listener) => {
            this.listeners.get(providerId)!.add(listener)
            return () => this.listeners.get(providerId)!.delete(listener)
          }
        if (property === 'getChats')
          return async (...args: Parameters<ProviderAdapter['getChats']>) => {
            await this.initialize()
            await Promise.all([...(this.creating.get(providerId) ?? [])])
            const page = await adapter.getChats(...args)
            const chats = page.chats.flatMap((chat) => {
              const record = this.records.get(key(providerId, chat.id))
              return record
                ? record.state === 'ready'
                  ? [{ ...chat, imported: record.original, title: record.title }]
                  : []
                : [chat]
            })
            const options = args[0]
            if (!options?.cursor && !options?.done)
              for (const record of this.records.values()) {
                if (
                  record.providerId !== providerId ||
                  record.state !== 'ready' ||
                  getContainerTargetKey(record.container) !==
                    getContainerTargetKey(options?.container) ||
                  chats.some((chat) => chat.id === record.chatId)
                )
                  continue
                if (
                  options?.searchTerm &&
                  !record.title.toLowerCase().includes(options.searchTerm.toLowerCase())
                )
                  continue
                if (options?.projectCwd) continue
                chats.push({
                  id: record.chatId,
                  providerId,
                  imported: record.original,
                  title: record.title,
                  preview: '',
                  createdAt: record.createdAt,
                  updatedAt: record.createdAt,
                  cwd: null,
                  cwdKind: 'directory',
                  projectCwd: null,
                  branchName: null,
                  worktreeBaseBranchName: null,
                  status: null,
                  lastTurnOutcome: undefined,
                  pendingApproval: null,
                  pinned: false,
                  sidebarOrder: null,
                  done: false,
                  seenUpdatedAt: null,
                  purpose: null,
                  container: record.container ?? null
                })
              }
            return { ...page, chats }
          }
        const method =
          Reflect.get(target, property) ??
          (property === 'getChatCursorWindow'
            ? () => {
                throw new Error('Cursor history is unavailable for this provider.')
              }
            : undefined)
        if (
          typeof method !== 'function' ||
          typeof property !== 'string' ||
          ![
            'getChat',
            'getChatWindow',
            'getChatCursorWindow',
            'getChatWindowForItem',
            'getSubagents',
            'getSubagent',
            'getSubagentWindowForItem',
            'cancelSubagent',
            'sendSubagentMessage',
            'setChatTitle',
            'continueChat',
            'sendActiveChatMessage',
            'stopChat',
            'compactChat',
            'resolveApproval',
            'resolveUserInput',
            'beginPendingMessageEdit',
            'cancelPendingMessageEdit',
            'editPendingMessage',
            'deletePendingMessage',
            'steerPendingMessage',
            'interruptPendingMessage',
            'forkChat',
            'continueChatInFork',
            'editMessage',
            'setChatGoal'
          ].includes(property)
        )
          return method
        return async (id: string, ...args: unknown[]) => {
          const record = await this.record(providerId, id)
          if (!record) return method(id, ...args)
          if (record.state !== 'ready') throw new Error('This chat import is not available.')
          if (['forkChat', 'continueChatInFork', 'editMessage'].includes(property))
            throw new Error('Editing and forking imported history is not supported.')
          if (property.startsWith('getChat')) {
            const view = this.view(record)
            if (property === 'getChat') return view.latest()
            if (property === 'getChatCursorWindow')
              return view.cursor(args[0] as Parameters<ImportedHistoryView['cursor']>[0])
            if (property === 'getChatWindowForItem')
              return view.item(String(args[0]), Number(args[1] ?? 20))
            const window = args[0] as { startIndex: number | null; limit: number }
            if (window.limit === Number.MAX_SAFE_INTEGER) return this.full(providerId, id)
            return view.window(window.startIndex, window.limit)
          }
          if (property === 'getSubagents')
            return this.subagents(
              record,
              await adapter.getSubagents(id, { container: record.container })
            )
          if (
            [
              'getSubagent',
              'getSubagentWindowForItem',
              'cancelSubagent',
              'sendSubagentMessage'
            ].includes(property) &&
            String(args[0]).startsWith('archive:')
          ) {
            if (!property.startsWith('get')) throw new Error('Archived subagents are read-only.')
            const sourceId = String(args[0]).slice('archive:'.length)
            const detail = record.archive.subagents.find((agent) => agent.id === sourceId)
            if (!detail) throw new Error('Archived subagent not found.')
            const items = archivedItems(detail.items)
            const turns = getProviderChatTurns(items)
            const window = args[2] as { startIndex?: number | null; limit?: number } | undefined
            const limit = property === 'getSubagent' ? (window?.limit ?? 10) : 10
            const itemIndex =
              property === 'getSubagentWindowForItem'
                ? turns.findIndex((turn) => turn.items.some((item) => item.id === args[1]))
                : -1
            const startIndex = Math.max(
              0,
              itemIndex >= 0
                ? itemIndex - Math.floor(limit / 2)
                : (window?.startIndex ?? turns.length - limit)
            )
            return {
              ...detail,
              id: args[0],
              parentId: record.chatId,
              status: 'completed',
              canMessage: false,
              items: sliceProviderChatTurns(items, startIndex, startIndex + limit),
              itemsStartTurnIndex: startIndex,
              turnCount: turns.length
            }
          }
          const result = await method(id, ...args)
          if (property === 'setChatTitle' && result?.title) {
            record.title = result.title
            await this.store.save(record)
          }
          return result &&
            typeof result === 'object' &&
            'items' in result &&
            'capabilities' in result
            ? this.view(record).fromNative(result)
            : result
        }
      }
    })
  }
}
