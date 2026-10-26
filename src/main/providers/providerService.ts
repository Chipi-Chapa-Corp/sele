import { createLimitResetDelivery } from './LimitResetDelivery'
import { LimitResetQueue } from './LimitResetQueue'
import { limitResetMessageBackend } from '../database/limitResetMessages'
import { isNoProjectChat } from '../../shared/noProject'
import { getLastTurnOutcome } from '../../shared/chatTurnOutcome'
import { getChatTurnOutcomes, setChatTurnOutcome } from '../database/chatTurnOutcome'
import { ChatAccounts } from './ChatAccounts'
import { ImportedConversations } from './ImportedConversations'
import { app } from 'electron'
import { prepareChatWorkspace } from './noProjectWorkspace'
import { join } from 'node:path'
import { AccountDisplayNameCache } from './AccountDisplayNameCache'
import { importedConversationStore } from '../database/importedConversations'
import { getDatabase } from '../database/sqlite'
import { SqliteChatHistoryCache } from '../database/chatHistoryCache'
import { PersistentChatHistory, type HistoryRead } from './PersistentChatHistory'
import { prepareChatDetailForRenderer } from './chatDetailLazy'
import { SqliteConversationViews } from '../database/conversationViews'
import {
  createConversationView,
  isConversationOpeningDetail,
  restoreConversationView
} from '../../shared/conversationView'
import type { ConversationViewScope } from './PersistentChatHistory'
import type { McpAppScope } from '../../shared/mcpApps'
import { applyTurnTokenUsage, emptyTokenUsage } from '../../shared/tokenUsage'
import { randomUUID } from 'node:crypto'
import {
  getAccountUsageCosts,
  getChatTokenUsage,
  getLiveChatTokenUsage,
  getTokenUsageSummary,
  recordTokenUsage
} from '../database/tokenUsage'
import { getContainerTargetKey } from '../containerTarget'
import type {
  ProviderApi,
  ProviderAccountConfiguration,
  ProviderChat,
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatActivitySummary,
  ProviderChatDetail,
  ProviderChatMetadata,
  ProviderChatUpdateSummary,
  ProviderChatUpdatedEvent,
  ProviderId,
  ProviderReview,
  ProviderSubagent,
  ProviderSubagentDetail,
  ProviderUpdateOptions,
  ProviderUserInputResponse,
  ProviderUsageOptions,
  ProviderWorkingItem,
  ProviderWorkingStep
} from '../../shared/provider'
import {
  getChatContainers,
  getChatMetadata,
  getChatMetadataByIds,
  setChatContainer,
  setChatAccount,
  bindChatAccounts,
  setChatDone,
  setChatNoProject,
  setChatOrder,
  setChatPinned,
  setChatPurpose,
  setChatSeen,
  setChatsDone
} from '../database/chat'
import { getCwdNotes, setCwdNotes } from '../database/cwdNotes'
import {
  deleteMessageReview,
  getMessageReviews,
  setMessageReview
} from '../database/messageReviews'
import {
  getProviderChatTurnCount,
  getProviderChatTurns,
  sliceProviderChatTurns
} from '../../shared/chatTurns'
import { withProviderNetworkRetries } from './ProviderNetworkRetry'
import { isLinkedChatContextCancelled, throwIfLinkedChatCancelled } from './linkedChatContext'
import { withLiveChatPermissions } from './ProviderLivePermissions'
import { CodexProviderAdapter } from './codex/CodexProviderAdapter'
import {
  cancelCodexAccountCreation as removePendingCodexAccount,
  createCodexAccount,
  deleteCodexAccount,
  finalizeCodexAccount,
  getCodexAccounts,
  getCodexAccountsWithDisplayNames,
  useCodexAccount as selectCodexAccount
} from './codex/CodexAccounts'
import { ClaudeProviderAdapter } from './claude/ClaudeProviderAdapter'
import { claudeAccounts } from './claude/ClaudeAccounts'
import { CopilotProviderAdapter } from './copilot/CopilotProviderAdapter'
import { OpenCodeProviderAdapter } from './opencode/OpenCodeProviderAdapter'
import { getCwdMetadata } from './cwdMetadata'
import { hasChatUpdateInterest } from './chatUpdateInterest'
import { flushPersistentPendingMessages } from './PersistentPendingMessages'
import type {
  ProviderAdapter,
  HistoricalTokenUsageSnapshot,
  ProviderChatTurnCursorWindow,
  ProviderChatTurnWindow,
  ProviderChatUpdateMetadata
} from './ProviderAdapter'
import {
  collectActiveProviderChats,
  getProviderUpdateImpact,
  stopActiveProviderChats
} from './providerUpdate'

const codexAdapter = new CodexProviderAdapter()
const accountDisplayNameCache = new AccountDisplayNameCache(() =>
  join(app.getPath('userData'), 'account-display-names.json')
)
const persistentChatHistory = new PersistentChatHistory(new SqliteChatHistoryCache(getDatabase))
const durableConversationViews = new SqliteConversationViews(getDatabase)
const conversationViewSequences = new Map<string, number>()
const conversationViewWrites = new Set<Promise<boolean>>()
const knownConversationScopes = new Set<string>()
const pendingConversationViews = new Map<
  string,
  {
    scope: ConversationViewScope
    detail: ProviderChatDetail
    timer: ReturnType<typeof setTimeout>
  }
>()

export const beginProviderConversationRead = async (
  providerId: ProviderId,
  chatId: string
): Promise<ConversationViewScope | null> => {
  const metadata = await getChatMetadata(chatId)
  const observed = persistentChatHistory.openingViewScope(providerId, chatId, metadata.container)
  if (observed) return observed
  const epoch = persistentChatHistory.accountEpoch(providerId, metadata.container)
  if (!persistentChatHistory.viewScope(providerId, chatId, metadata.container))
    await providerApi.getAccounts(providerId, { container: metadata.container })
  if (persistentChatHistory.accountEpoch(providerId, metadata.container) !== epoch) return null
  return persistentChatHistory.openingViewScope(providerId, chatId, metadata.container)
}

export const saveProviderConversationView = async (
  scope: ConversationViewScope | null,
  detail: ProviderChatDetail
): Promise<void> => {
  if (
    !scope?.current() ||
    !isConversationOpeningDetail(detail) ||
    detail.id !== scope.chatId ||
    getContainerTargetKey(detail.container) !== scope.containerKey ||
    detail.revision < (latestProviderChatUpdateRevision.get(`${scope.provider}:${detail.id}`) ?? -1)
  )
    return
  const sequence = (conversationViewSequences.get(scope.key) ?? 0) + 1
  conversationViewSequences.set(scope.key, sequence)
  const view = prepareChatDetailForRenderer(createConversationView(detail))
  const write = durableConversationViews.write(
    scope,
    view,
    () => scope.current() && conversationViewSequences.get(scope.key) === sequence
  )
  conversationViewWrites.add(write)
  try {
    if (await write) knownConversationScopes.add(scope.key)
  } finally {
    conversationViewWrites.delete(write)
  }
}

const queueConversationView = (
  provider: ProviderId,
  detail: ProviderChatDetail,
  complete: boolean
): void => {
  const scope = persistentChatHistory.viewScope(provider, detail.id, detail.container)
  if (!scope) return
  const previous = pendingConversationViews.get(scope.key)
  if (previous) {
    previous.detail = detail
    if (!complete) return
    clearTimeout(previous.timer)
  }
  const flush = (): void => {
    const pending = pendingConversationViews.get(scope.key)
    if (!pending) return
    pendingConversationViews.delete(scope.key)
    void saveProviderConversationView(pending.scope, pending.detail).catch((error: unknown) =>
      console.warn('Unable to update conversation view.', error)
    )
  }
  pendingConversationViews.set(scope.key, {
    scope,
    detail,
    timer: setTimeout(flush, complete ? 0 : 250)
  })
}

/** Native discovery lists identities. Processed opening views come from our local read model. */
export const getProviderKnownChats = async (
  provider: ProviderId,
  options: ProviderChatListOptions = {}
): Promise<ProviderChatPage> => {
  const epoch = persistentChatHistory.accountEpoch(provider, options.container)
  if (!persistentChatHistory.viewScope(provider, '', options.container))
    await providerApi.getAccounts(provider, { container: options.container })
  if (persistentChatHistory.accountEpoch(provider, options.container) !== epoch)
    return { chats: [], nextCursor: null, conversationViews: [] }
  const scope = persistentChatHistory.viewScope(provider, '', options.container)
  if (!scope) return { chats: [], nextCursor: null, conversationViews: [] }
  const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
  const page = await durableConversationViews.list(
    scope,
    offset,
    Math.max(1, Math.min(options.limit ?? 100, 100))
  )
  page.views.forEach((view) => {
    const viewScope = persistentChatHistory.viewScope(provider, view.id, view.container)
    if (viewScope?.current()) knownConversationScopes.add(viewScope.key)
  })
  const chats = await applyMetadataToChats(
    page.views.map((view) => ({
      ...getChatUpdateSummary(view, view.updatedAt ?? view.createdAt),
      providerId: provider
    }))
  )
  if (!scope.current()) return { chats: [], nextCursor: null, conversationViews: [] }
  return {
    chats: chats.filter((chat) => !chat.purpose),
    nextCursor: page.nextCursor,
    conversationViews: scope.current() ? page.views : []
  }
}

export const getProviderConversationViews = async (
  provider: ProviderId,
  chats: ProviderChat[]
): Promise<ProviderChatDetail[]> => {
  const sources = new Map(
    chats.map((chat) => [getContainerTargetKey(chat.container), chat.container])
  )
  await Promise.all(
    [...sources.values()].map(async (container) => {
      if (!persistentChatHistory.viewScope(provider, '', container))
        await providerApi.getAccounts(provider, { container })
    })
  )
  const scopes = chats.map((chat) =>
    persistentChatHistory.viewScope(provider, chat.id, chat.container)
  )
  const stored = await durableConversationViews.read(
    scopes.filter((scope): scope is ConversationViewScope => scope !== null)
  )
  for (const key of stored.keys()) knownConversationScopes.add(key)
  const views: ProviderChatDetail[] = []
  for (const [index, chat] of chats.entries()) {
    const scope = scopes[index]
    if (!scope?.current()) continue
    let view = stored.get(scope.key)
    // One-time adoption of still-valid pages from the old disposable cache.
    if (!view) {
      const legacy = await persistentChatHistory.preview(provider, chat.id, chat.container)
      if (legacy) {
        view = createConversationView(legacy)
        if (await durableConversationViews.write(scope, view))
          knownConversationScopes.add(scope.key)
      }
    }
    if (view && scope.current())
      views.push(restoreConversationView(view, chat))
  }
  return views
}

export const getProviderCachedChat = async (
  providerId: ProviderId,
  chatId: string,
  options?: { container?: import('../../shared/app').AppContainerTarget | null }
): Promise<ProviderChatDetail | null> => {
  const metadata = await getChatMetadata(chatId)
  if (metadata.done || metadata.purpose) return null
  return persistentChatHistory.preview(
    providerId,
    chatId,
    options?.container !== undefined ? options.container : metadata.container
  )
}

export const beginProviderChatHistoryRead = async (
  providerId: ProviderId,
  chatId: string
): Promise<HistoryRead | null> => {
  try {
    const metadata = await getChatMetadata(chatId)
    return persistentChatHistory.beginOpening(providerId, chatId, metadata.container)
  } catch (error) {
    console.warn('Unable to prepare saved chat history.', error)
    return null
  }
}

export const saveProviderChatHistory = (
  read: HistoryRead | null,
  detail: ProviderChatDetail,
  prepare = false
): void => {
  if (!read) return
  // Persist after replying to the opening IPC. Never write streaming chunks.
  setImmediate(() => {
    void Promise.resolve()
      .then(() =>
        persistentChatHistory.save(read, prepare ? prepareChatDetailForRenderer(detail) : detail)
      )
      .catch((error: unknown) => {
        console.warn('Unable to save prepared chat history.', error)
      })
  })
}
const claudeAdapter = new ClaudeProviderAdapter()
claudeAccounts.setUsageCacheFile(join(app.getPath('userData'), 'claude-usage-cache.json'))
const openCodeAdapter = new OpenCodeProviderAdapter()
const connectionAdapter = (providerId: ProviderId): OpenCodeProviderAdapter => {
  if (providerId !== 'opencode') throw new Error('Connections are not available for this provider.')
  return openCodeAdapter
}

const codexAccountAdapters = new Map<string, CodexProviderAdapter>()
const claudeAccountAdapters = new Map<string, ClaudeProviderAdapter>()
const codexAccountAdapter = (account: string): CodexProviderAdapter => {
  let adapter = codexAccountAdapters.get(account)
  if (!adapter) {
    adapter = new CodexProviderAdapter(account)
    codexAccountAdapters.set(account, adapter)
  }
  return adapter
}
const claudeAccountAdapter = (account: string): ClaudeProviderAdapter => {
  let adapter = claudeAccountAdapters.get(account)
  if (!adapter) {
    adapter = new ClaudeProviderAdapter(account)
    claudeAccountAdapters.set(account, adapter)
  }
  return adapter
}

const accountRuntimes = {
  codex: new ChatAccounts(codexAdapter, {
    metadata: getChatMetadata,
    save: setChatAccount,
    bindListed: bindChatAccounts,
    selected: async (container) =>
      (await getCodexAccounts(container)).accounts.find((account) => account.active)?.id ??
      'default',
    create: (account) =>
      withLiveChatPermissions(withProviderNetworkRetries(codexAccountAdapter(account)))
  }),
  claude: new ChatAccounts(claudeAdapter, {
    metadata: getChatMetadata,
    save: setChatAccount,
    bindListed: bindChatAccounts,
    selected: (container) => claudeAccounts.getSelectedId(container),
    create: (account) =>
      withLiveChatPermissions(withProviderNetworkRetries(claudeAccountAdapter(account)))
  })
}

const nativeAdapters: Record<ProviderId, ProviderAdapter> = {
  codex: accountRuntimes.codex.adapter,
  claude: accountRuntimes.claude.adapter,
  copilot: withLiveChatPermissions(withProviderNetworkRetries(new CopilotProviderAdapter())),
  opencode: withLiveChatPermissions(withProviderNetworkRetries(openCodeAdapter))
}

export const importedConversations = new ImportedConversations(
  nativeAdapters,
  importedConversationStore
)
const adapters = Object.fromEntries(
  Object.keys(nativeAdapters).map((id) => [id, importedConversations.wrap(id as ProviderId)])
) as Record<ProviderId, ProviderAdapter>

const linkedChatOperations = new Map<string, AbortController>()

export const getProviderMcpApp = (scope: McpAppScope, callId: string) =>
  adapters[scope.providerId].getMcpApp?.(scope.chatId, callId) ?? Promise.resolve(null)

const providerLabels: Record<ProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  opencode: 'OpenCode'
}

const getUnavailableAccountConfiguration = (
  providerId: ProviderId
): ProviderAccountConfiguration => ({
  available: false,
  unavailableMessage: `Accounts configuration is not available for ${providerLabels[providerId]}`,
  accounts: []
})

const chatUpdatePreviewLimit = 500
const chatUpdateActivityLabelLimit = 240

const truncateChatUpdateText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

const chatUpdatedListeners = new Set<(event: ProviderChatUpdatedEvent) => void>()

type PendingProviderChatUpdate = {
  providerId: ProviderId
  detail: ProviderChatDetail
}

const pendingProviderChatUpdates = new Map<string, PendingProviderChatUpdate>()
const processingProviderChatUpdateKeys = new Set<string>()
const latestProviderChatUpdateRevision = new Map<string, number>()
const unreportedTurnCompletions = new Set<string>()

const normalizeCwd = (cwd: string | null | undefined): string | null => {
  const trimmedCwd = cwd?.trim()
  return trimmedCwd || null
}

const applyMetadataToChat = (
  chat: ProviderChat,
  metadata: ProviderChatMetadata | undefined
): ProviderChat => ({
  ...chat,
  noProject: metadata?.noProject || isNoProjectChat(chat),
  accountId: metadata?.accountId ?? chat.accountId,
  pinned: metadata?.pinned ?? false,
  sidebarOrder: metadata?.sidebarOrder ?? null,
  done: metadata?.done ?? false,
  doneAt: metadata?.doneAt ?? null,
  seenUpdatedAt: metadata?.seenUpdatedAt ?? null,
  purpose: metadata?.purpose ?? null,
  container: metadata?.container ?? chat.container ?? null
})

const applyMetadataToChats = async (chats: ProviderChat[]): Promise<ProviderChat[]> => {
  const [metadataById, outcomes] = await Promise.all([
    getChatMetadataByIds(chats.map((chat) => chat.id)),
    getChatTurnOutcomes(chats)
  ])
  return Promise.all(
    chats.map(async (chat) => {
      const enrichedChat = applyMetadataToChat(chat, metadataById.get(chat.id))
      const [cwdMetadata, reviews] = await Promise.all([
        getCwdMetadata(enrichedChat.noProject ? null : chat.cwd),
        getMessageReviews(chat.id)
      ])
      const previewReview = reviews.find(
        (review) =>
          Boolean(chat.preview) &&
          (review.serializedContent === chat.preview ||
            review.serializedContent.startsWith(chat.preview) ||
            chat.preview.startsWith(review.serializedContent))
      )

      return {
        ...enrichedChat,
        lastTurnOutcome:
          chat.lastTurnOutcome === undefined
            ? outcomes.get(`${chat.providerId}:${chat.id}`)
            : chat.lastTurnOutcome,
        preview: previewReview
          ? previewReview.prompt || `Review · ${previewReview.comments.length}`
          : chat.preview,
        cwdKind: cwdMetadata.kind,
        projectCwd: cwdMetadata.projectCwd,
        branchName: cwdMetadata.branchName,
        worktreeBaseBranchName: cwdMetadata.worktreeBaseBranchName
      }
    })
  )
}

const applyMetadataToDetail = async (
  detail: ProviderChatDetail,
  providerId: ProviderId,
  includeUsage = true,
  liveUsage = false
): Promise<ProviderChatDetail> => {
  const lastTurnOutcome = getLastTurnOutcome(detail)
  if (lastTurnOutcome !== undefined) {
    await setChatTurnOutcome(providerId, detail.id, lastTurnOutcome)
  }
  const metadata = await getChatMetadata(detail.id)
  const noProject = metadata.noProject || isNoProjectChat(detail)
  const [cwdMetadata, reviews] = await Promise.all([
    getCwdMetadata(noProject ? null : detail.cwd),
    getMessageReviews(detail.id)
  ])
  const usage = includeUsage
    ? await (liveUsage && detail.status === 'active' ? getLiveChatTokenUsage : getChatTokenUsage)(
        providerId,
        getContainerTargetKey(metadata.container ?? detail.container),
        detail.id
      )
    : null
  const reviewsByContent = new Map<string, typeof reviews>()

  reviews.forEach((review) => {
    const matchingReviews = reviewsByContent.get(review.serializedContent)
    if (matchingReviews) matchingReviews.push(review)
    else reviewsByContent.set(review.serializedContent, [review])
  })

  return {
    ...detail,
    noProject,
    accountId: metadata.accountId ?? detail.accountId,
    lastTurnOutcome,
    cwdKind: cwdMetadata.kind,
    projectCwd: cwdMetadata.projectCwd,
    branchName: cwdMetadata.branchName,
    worktreeBaseBranchName: cwdMetadata.worktreeBaseBranchName,
    pinned: metadata.pinned,
    sidebarOrder: metadata.sidebarOrder,
    done: metadata.done,
    doneAt: metadata.doneAt ?? null,
    seenUpdatedAt: metadata.seenUpdatedAt,
    purpose: metadata.purpose,
    container: metadata.container ?? detail.container ?? null,
    tokenUsage: usage ? usage.total : detail.tokenUsage,
    items: (usage ? applyTurnTokenUsage(detail.items, usage.byTurn) : detail.items).map((item) => {
      if (item.type !== 'message' && item.type !== 'pendingMessage') return item

      const review = reviewsByContent.get(item.content)?.shift()
      if (!review || review.comments.length === 0) return item

      return {
        ...item,
        content: review.prompt,
        attachments: [
          ...(item.attachments ?? []).filter((attachment) => attachment.kind !== 'review'),
          {
            kind: 'review' as const,
            id: review.id,
            comments: review.comments
          }
        ]
      }
    })
  }
}

const drainProviderChatUpdates = async (chatKey: string): Promise<void> => {
  if (processingProviderChatUpdateKeys.has(chatKey)) return
  processingProviderChatUpdateKeys.add(chatKey)

  try {
    for (;;) {
      const update = pendingProviderChatUpdates.get(chatKey)
      if (!update) return
      pendingProviderChatUpdates.delete(chatKey)

      try {
        // Sidebar delivery must not wait on ledger draining, repricing, or accounting scans.
        // Opening a chat reads complete usage through the ordinary detail API.
        const includeUsage = hasChatUpdateInterest(chatKey)
        const liveUsage = !unreportedTurnCompletions.has(chatKey)
        let enrichedDetail = await applyMetadataToDetail(
          update.detail,
          update.providerId,
          includeUsage,
          liveUsage
        )
        if (!includeUsage && hasChatUpdateInterest(chatKey))
          enrichedDetail = await applyMetadataToDetail(
            update.detail,
            update.providerId,
            true,
            liveUsage
          )
        // Metadata and review reads are asynchronous. If another adapter snapshot arrived while
        // they were running, discard this one before it can overwrite the newer transcript.
        if (latestProviderChatUpdateRevision.get(chatKey) !== update.detail.revision) continue

        const viewScope = persistentChatHistory.viewScope(
          update.providerId,
          enrichedDetail.id,
          enrichedDetail.container
        )
        if (viewScope && !knownConversationScopes.has(viewScope.key))
          await saveProviderConversationView(viewScope, enrichedDetail)
        if (latestProviderChatUpdateRevision.get(chatKey) !== update.detail.revision) continue
        const turnCompleted = unreportedTurnCompletions.delete(chatKey)
        queueConversationView(update.providerId, enrichedDetail, turnCompleted)
        const event = {
          providerId: update.providerId,
          chatId: enrichedDetail.id,
          detail: enrichedDetail,
          summary: getChatUpdateSummary(enrichedDetail, Date.now()),
          turnCompleted,
          conversationKnown: Boolean(viewScope && knownConversationScopes.has(viewScope.key))
        } satisfies ProviderChatUpdatedEvent

        chatUpdatedListeners.forEach((listener) => listener(event))
        // Ownership/metadata checks can finish during the opening read. Persist
        // their latest idle snapshot rather than letting that race prevent the
        // completed page from ever reaching disk. Streaming updates never enter.
        if (enrichedDetail.status === null) {
          saveProviderChatHistory(
            persistentChatHistory.beginOpening(
              update.providerId,
              enrichedDetail.id,
              enrichedDetail.container
            ),
            enrichedDetail,
            true
          )
        }
      } catch (error) {
        console.error('Unable to apply chat metadata to update', error)
      }
    }
  } finally {
    processingProviderChatUpdateKeys.delete(chatKey)
    if (pendingProviderChatUpdates.has(chatKey)) void drainProviderChatUpdates(chatKey)
  }
}

const enqueueProviderChatUpdate = (
  providerId: ProviderId,
  detail: ProviderChatDetail,
  metadata?: ProviderChatUpdateMetadata
): void => {
  const chatKey = `${providerId}:${detail.id}`
  const latestRevision = latestProviderChatUpdateRevision.get(chatKey)
  if (latestRevision != null && detail.revision <= latestRevision) return
  persistentChatHistory.invalidate(providerId, detail.id)
  latestProviderChatUpdateRevision.set(chatKey, detail.revision)
  if (metadata?.turnCompleted) unreportedTurnCompletions.add(chatKey)
  pendingProviderChatUpdates.set(chatKey, {
    providerId,
    detail
  })
  void drainProviderChatUpdates(chatKey)
}

const sliceChatDetailToTurnWindow = (
  detail: ProviderChatDetail,
  window: ProviderChatTurnWindow
): ProviderChatDetail => {
  const turnCount = getProviderChatTurnCount(detail.items)
  const limit = Math.max(1, Math.floor(window.limit))
  const startIndex =
    window.startIndex == null
      ? Math.max(0, turnCount - limit)
      : Math.max(0, Math.min(Math.floor(window.startIndex), turnCount))
  return {
    ...detail,
    items: sliceProviderChatTurns(detail.items, startIndex, startIndex + limit),
    itemsStartTurnIndex: startIndex,
    turnCount
  }
}

/**
 * Renderer-only transcript read. The adapter owns the pagination boundary so capable providers do
 * not construct a complete ProviderChatDetail merely to have IPC discard most of it.
 */
export const getProviderChatWindow = async (
  providerId: ProviderId,
  chatId: string,
  window: ProviderChatTurnWindow
): Promise<ProviderChatDetail> => {
  const metadata = await getChatMetadata(chatId)
  const adapter = adapters[providerId]
  const detail = adapter.getChatWindow
    ? await adapter.getChatWindow(chatId, window, { container: metadata.container })
    : sliceChatDetailToTurnWindow(
        await adapter.getChat(chatId, { container: metadata.container }),
        window
      )
  return applyMetadataToDetail(detail, providerId)
}

export const getProviderChatCursorWindow = async (
  providerId: ProviderId,
  chatId: string,
  window: ProviderChatTurnCursorWindow
): Promise<ProviderChatDetail> => {
  const metadata = await getChatMetadata(chatId)
  const adapter = adapters[providerId]
  if (!adapter.getChatCursorWindow) {
    throw new Error(`${providerLabels[providerId]} does not support cursor-based chat history`)
  }
  return applyMetadataToDetail(
    await adapter.getChatCursorWindow(chatId, window, { container: metadata.container }),
    providerId
  )
}

export const getProviderChatItemWindow = async (
  providerId: ProviderId,
  chatId: string,
  itemId: string,
  limit: number
): Promise<ProviderChatDetail> => {
  const metadata = await getChatMetadata(chatId)
  const adapter = adapters[providerId]
  if (adapter.getChatWindowForItem) {
    return applyMetadataToDetail(
      await adapter.getChatWindowForItem(chatId, itemId, limit, {
        container: metadata.container
      }),
      providerId
    )
  }

  const detail = await adapter.getChat(chatId, { container: metadata.container })
  const turns = getProviderChatTurns(detail.items)
  const targetIndex = turns.findIndex((turn) => turn.items.some((item) => item.id === itemId))
  if (targetIndex < 0) throw new Error('Chat item not found')
  const startIndex = Math.min(
    Math.max(0, targetIndex - Math.floor(limit / 2)),
    Math.max(0, turns.length - limit)
  )
  return applyMetadataToDetail(
    sliceChatDetailToTurnWindow(detail, { startIndex, limit }),
    providerId
  )
}

export const getProviderSubagentItemWindow = async (
  providerId: ProviderId,
  rootChatId: string,
  subagentId: string,
  itemId: string
): Promise<ProviderSubagentDetail> => {
  const metadata = await getChatMetadata(rootChatId)
  const adapter = adapters[providerId]
  return adapter.getSubagentWindowForItem
    ? adapter.getSubagentWindowForItem(rootChatId, subagentId, itemId, {
        container: metadata.container
      })
    : adapter.getSubagent(rootChatId, subagentId, { container: metadata.container })
}

const runWithStoredReview = async (
  chatId: string,
  serializedContent: string,
  review: ProviderReview | undefined,
  run: () => Promise<ProviderChatDetail>
): Promise<ProviderChatDetail> => {
  if (!review) return run()

  await setMessageReview(chatId, serializedContent, review.prompt, review)
  try {
    return await run()
  } catch (error) {
    await deleteMessageReview(review.id).catch((error) => {
      console.error('[caught:providerService:runWithStoredReview]', error)
    })
    throw error
  }
}

const getChatUpdateActivity = (detail: ProviderChatDetail): ProviderChatActivitySummary | null => {
  const workingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working' && item.status === 'working'
  )
  if (!workingStep) return null

  const tools = workingStep.items.flatMap((item) =>
    item.type === 'message' ? [] : item.type === 'toolGroup' ? item.tools : [item]
  )
  const activeTool = tools.findLast((tool) => tool.status === 'running') ?? tools.at(-1)
  if (activeTool) {
    return {
      label: truncateChatUpdateText(activeTool.label, chatUpdateActivityLabelLimit),
      activity: activeTool.activity
    }
  }

  const workingMessage = workingStep.items.findLast(
    (item): item is Extract<ProviderWorkingItem, { type: 'message' }> =>
      item.type === 'message' && item.content.trim().length > 0
  )
  return workingMessage
    ? {
        label: truncateChatUpdateText(workingMessage.content.trim(), chatUpdateActivityLabelLimit),
        activity: 'other'
      }
    : null
}

export const getChatUpdateSummary = (
  detail: ProviderChatDetail,
  updatedAt: number
): ProviderChatUpdateSummary => {
  const preview = detail.items.findLast((item) => item.type === 'message')?.content.trim() ?? ''
  return {
    id: detail.id,
    accountId: detail.accountId,
    noProject: detail.noProject,
    imported: detail.imported,
    revision: detail.revision,
    createdAt: detail.createdAt,
    title: detail.title,
    preview: truncateChatUpdateText(preview, chatUpdatePreviewLimit),
    previewLength: preview.length,
    cwd: detail.cwd,
    cwdKind: detail.cwdKind,
    projectCwd: detail.projectCwd,
    branchName: detail.branchName,
    worktreeBaseBranchName: detail.worktreeBaseBranchName,
    updatedAt: detail.updatedAt ?? updatedAt,
    status:
      detail.pendingUserInput && detail.status !== 'waitingOnApproval'
        ? 'waitingOnUserInput'
        : detail.status,
    lastTurnOutcome:
      detail.lastTurnOutcome === undefined ? getLastTurnOutcome(detail) : detail.lastTurnOutcome,
    pendingApproval: detail.pendingApproval,
    pinned: detail.pinned,
    sidebarOrder: detail.sidebarOrder,
    done: detail.done,
    doneAt: detail.doneAt ?? null,
    seenUpdatedAt: detail.seenUpdatedAt,
    purpose: detail.purpose,
    container: detail.container,
    currentActivity: getChatUpdateActivity(detail)
  }
}

for (const adapter of Object.values(adapters)) {
  adapter.onTokenUsage?.((observation) => recordTokenUsage(adapter.id, observation))
  adapter.onChatUpdated((detail, updateMetadata) => {
    enqueueProviderChatUpdate(adapter.id, detail, updateMetadata)
  })
}

const codexReauthentications = new Map<
  string,
  { source: string; loginId: string | null; adapter: CodexProviderAdapter }
>()

const uncommittedResetHandoffs = new Set<string>()
const limitResetQueue = new LimitResetQueue(
  limitResetMessageBackend,
  createLimitResetDelivery({
    backend: limitResetMessageBackend,
    prepare: async (entry) => {
      let options = (await prepareChatWorkspace(app.getPath('userData'), entry.options))!
      if (entry.worktree && !options.noProject) {
        if (!options.cwd) throw new Error('Choose a folder before creating a worktree.')
        const { createChatGitWorktree } = await import('../registerAppIpc')
        const worktree = await createChatGitWorktree({
          container: options.container,
          cwd: options.cwd,
          name: `limit-reset-${entry.id.slice(0, 8)}`
        })
        options = { ...options, cwd: worktree.worktreePath }
      }
      return options
    },
    create: (entry, onCreated) =>
      adapters[entry.providerId].startChat(
        '',
        {
          ...entry.options,
          deferInitialMessage: true,
          accountId: entry.accountId
        },
        onCreated
      ),
    saveMetadata: async (entry) => {
      if (!entry.draftKey || !entry.chatId) return
      await Promise.all([
        entry.options.noProject ? setChatNoProject(entry.chatId) : Promise.resolve(),
        entry.options.container
          ? setChatContainer(entry.chatId, entry.options.container)
          : Promise.resolve()
      ])
    },
    enqueue: async (entry) => {
      const adapter = adapters[entry.providerId]
      if (!adapter.enqueueLimitResetMessage)
        throw new Error('This provider cannot queue reset prompts.')
      await adapter.enqueueLimitResetMessage(
        entry.chatId,
        entry.content,
        entry.id,
        entry.options,
        async () => {
          uncommittedResetHandoffs.add(entry.id)
          await flushPersistentPendingMessages()
          if ((await limitResetMessageBackend.list()).some((stored) => stored.id === entry.id)) {
            throw new Error(
              'Unable to persist the reset prompt in the chat queue. Retrying shortly.'
            )
          }
          uncommittedResetHandoffs.delete(entry.id)
        }
      )
    }
  })
)

export const startLimitResetQueue = (): void => limitResetQueue.start()

export const providerApi: ProviderApi = {
  reauthenticateAccount: async (providerId, options) => {
    persistentChatHistory.forgetAccount(providerId, options?.container)
    if (providerId === 'codex') {
      const source = getContainerTargetKey(options?.container)
      if (Array.from(codexReauthentications.values()).some((value) => value.source === source))
        throw new Error('Codex sign-in is already in progress for this environment.')
      const accountId = `reauth-${randomUUID()}`
      const adapter = options?.chatId
        ? codexAccountAdapter(await accountRuntimes.codex.account(options.chatId))
        : codexAdapter
      const pending = { source, loginId: null as string | null, adapter }
      codexReauthentications.set(accountId, pending)
      try {
        const login = await adapter.reauthenticate(options)
        pending.loginId = login.status === 'pending' ? login.loginId : null
        return { accountId, login }
      } catch (error) {
        codexReauthentications.delete(accountId)
        throw error
      }
    }
    if (providerId !== 'claude')
      throw new Error('Reauthentication is not available for this provider.')
    return claudeAccounts.reauthenticate(
      options?.chatId
        ? { ...options, accountId: await accountRuntimes.claude.account(options.chatId) }
        : options
    )
  },
  login: (providerId, options) => {
    persistentChatHistory.forgetAccount(providerId, options?.container)
    return adapters[providerId].login(options)
  },
  getAccounts: async (providerId, options) => {
    const accountEpoch = persistentChatHistory.accountEpoch(providerId, options?.container)
    const load = async (): Promise<ProviderAccountConfiguration> => {
      if (providerId === 'codex') return getCodexAccountsWithDisplayNames(options?.container)
      if (providerId === 'claude') return claudeAccounts.getWithDisplayNames(options)
      const configuration = getUnavailableAccountConfiguration(providerId)
      if (providerId === 'opencode')
        return {
          ...configuration,
          accounts: [{ id: 'default', displayName: 'Default Account', active: true }]
        }
      const login = await adapters[providerId].login(options)
      return {
        ...configuration,
        accounts: [
          {
            id: 'default',
            login: login.status === 'authenticated' ? login.account.label : null,
            displayName: login.status === 'authenticated' ? login.account.displayName : null,
            active: true
          }
        ]
      }
    }
    const configuration = await accountDisplayNameCache.merge(
      JSON.stringify([providerId, getContainerTargetKey(options?.container)]),
      await load()
    )
    if (options?.chatId && (providerId === 'codex' || providerId === 'claude')) {
      const accountId = await accountRuntimes[providerId].account(options.chatId)
      return {
        ...configuration,
        accounts: configuration.accounts.map((account) => ({
          ...account,
          active: account.id === accountId
        }))
      }
    }
    // These providers share history between credentials; changing the new-chat
    // default must not hide another account’s conversations or opening views.
    persistentChatHistory.setAccount(
      providerId,
      options?.container,
      providerId === 'codex' || providerId === 'claude'
        ? { ...configuration, accounts: [{ id: 'chat-accounts', active: true }] }
        : configuration,
      accountEpoch
    )
    return configuration
  },
  createAccount: async (providerId, options) => {
    persistentChatHistory.forgetAccount(providerId, options?.container)
    if (providerId === 'claude') return claudeAccounts.create(options)
    if (providerId !== 'codex') {
      throw new Error(getUnavailableAccountConfiguration(providerId).unavailableMessage ?? '')
    }
    const creation = await createCodexAccount(options?.container)
    codexAdapter.resetClientsForContainer(options?.container)
    return creation
  },
  completeAccountCreation: async (providerId, accountId, loginId, options) => {
    persistentChatHistory.forgetAccount(providerId, options?.container)
    if (providerId === 'codex' && accountId.startsWith('reauth-')) {
      const pending = codexReauthentications.get(accountId)
      if (
        !pending ||
        pending.source !== getContainerTargetKey(options?.container) ||
        pending.loginId !== loginId
      )
        throw new Error('This Codex sign-in is no longer pending.')
      try {
        const completion = loginId
          ? await pending.adapter.waitForLogin(loginId, options)
          : { success: true, error: null }
        if (codexReauthentications.get(accountId) !== pending)
          throw new Error('Codex sign-in was canceled.')
        if (completion.success) {
          pending.adapter.clearAuthenticationFailure(options?.container)
          codexAdapter.resetClientsForContainer(options?.container)
        }
        return { ...completion, configuration: await getCodexAccounts(options?.container) }
      } finally {
        codexReauthentications.delete(accountId)
      }
    }
    if (providerId === 'claude') {
      try {
        await claudeAccounts.waitForLogin(accountId, loginId, options)
        const configuration = await (
          claudeAccountAdapters.get(accountId) ?? claudeAdapter
        ).changeAccount(options?.container, () => claudeAccounts.complete(accountId, options))
        return { success: true, error: null, configuration }
      } catch (error) {
        console.error('Unable to complete Claude account sign-in.', error)
        const configuration = await claudeAccounts.cancel(accountId, options)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Claude sign-in failed.',
          configuration
        }
      }
    }
    if (providerId !== 'codex') {
      throw new Error(getUnavailableAccountConfiguration(providerId).unavailableMessage ?? '')
    }

    let completion = { success: true, error: null as string | null }
    if (loginId) {
      try {
        completion = await codexAdapter.waitForLogin(loginId, options)
      } catch (error) {
        await removePendingCodexAccount(accountId, options?.container).catch((error) => {
          console.error('[caught:providerService:completeAccountCreation]', error)
        })
        codexAdapter.resetClientsForContainer(options?.container)
        throw error
      }
    }

    if (!completion.success) {
      const configuration = await removePendingCodexAccount(accountId, options?.container)
      codexAdapter.resetClientsForContainer(options?.container)
      return { ...completion, configuration }
    }

    try {
      const configuration = await finalizeCodexAccount(accountId, options?.container)
      return { ...completion, configuration }
    } catch (error) {
      await removePendingCodexAccount(accountId, options?.container).catch((error) => {
        console.error('[caught:providerService:completeAccountCreation]', error)
      })
      codexAdapter.resetClientsForContainer(options?.container)
      throw error
    }
  },
  cancelAccountCreation: async (providerId, accountId, loginId, options) => {
    if (providerId === 'codex' && accountId.startsWith('reauth-')) {
      const pending = codexReauthentications.get(accountId)
      if (
        pending &&
        pending.source === getContainerTargetKey(options?.container) &&
        pending.loginId === loginId
      ) {
        codexReauthentications.delete(accountId)
        if (loginId) await pending.adapter.cancelLogin(loginId, options)
      }
      return getCodexAccounts(options?.container)
    }
    if (providerId === 'claude') return claudeAccounts.cancel(accountId, options)
    if (providerId !== 'codex') {
      throw new Error(getUnavailableAccountConfiguration(providerId).unavailableMessage ?? '')
    }
    if (loginId)
      await codexAdapter.cancelLogin(loginId, options).catch((error) => {
        console.error('[caught:providerService:cancelAccountCreation]', error)
      })
    const configuration = await removePendingCodexAccount(accountId, options?.container)
    codexAdapter.resetClientsForContainer(options?.container)
    return configuration
  },
  useAccount: async (providerId, accountId, options) => {
    if (options?.chatId && (providerId === 'codex' || providerId === 'claude')) {
      const configuration = await providerApi.getAccounts(providerId, options)
      if (!configuration.accounts.some((account) => account.id === accountId))
        throw new Error('Provider account was not found.')
      await accountRuntimes[providerId].select(options.chatId, accountId)
      return providerApi.getAccounts(providerId, options)
    }
    persistentChatHistory.forgetAccount(providerId, options?.container)
    if (providerId === 'claude') {
      const previous = await claudeAccounts.get(options)
      if (previous.accounts.some((account) => account.id === accountId && account.active))
        return previous
      return claudeAdapter.changeAccount(options?.container, () =>
        claudeAccounts.select(accountId, options)
      )
    }
    if (providerId !== 'codex') return getUnavailableAccountConfiguration(providerId)
    const configuration = await selectCodexAccount(accountId, options?.container)
    codexAdapter.clearAuthenticationFailure(options?.container)
    codexAdapter.resetClientsForContainer(options?.container)
    return configuration
  },
  deleteAccount: async (providerId, accountId, options) => {
    persistentChatHistory.forgetAccount(providerId, options?.container)
    if (providerId === 'claude') {
      const previous = await claudeAccounts.get(options)
      if (previous.accounts.some((account) => account.id === accountId && account.active)) {
        return claudeAdapter.changeAccount(options?.container, () =>
          claudeAccounts.remove(accountId, options)
        )
      }
      return claudeAccounts.remove(accountId, options)
    }
    if (providerId !== 'codex') return getUnavailableAccountConfiguration(providerId)
    const previous = await getCodexAccounts(options?.container)
    const deletedAccountWasActive = previous.accounts.some(
      (account) => account.id === accountId && account.active
    )
    const configuration = await deleteCodexAccount(accountId, options?.container)
    if (deletedAccountWasActive) {
      codexAdapter.clearAuthenticationFailure(options?.container)
      codexAdapter.resetClientsForContainer(options?.container)
    }
    return configuration
  },
  submitAccountLoginCode: async (providerId, loginId, code, options) => {
    if (providerId !== 'claude') throw new Error('This provider does not accept a sign-in code.')
    await claudeAccounts.submitCode(loginId, code, options)
  },
  getUpdateAvailability: (providerId, options) =>
    adapters[providerId].getUpdateAvailability(options),
  getProviderUpdateImpact: (providerId, options) =>
    getProviderUpdateImpact(adapters[providerId], options),
  updateProvider: async (providerId, options: ProviderUpdateOptions = {}) => {
    const adapter = adapters[providerId]
    const { stopActiveChats, ...sourceOptions } = options
    const activeChats = await collectActiveProviderChats(adapter, sourceOptions)

    if (activeChats.length > 0 && !stopActiveChats) {
      const chatLabel = activeChats.length === 1 ? 'chat is' : 'chats are'
      throw new Error(
        `${activeChats.length} active ${chatLabel} still running. Confirm stopping them before updating ${providerLabels[providerId]}.`
      )
    }

    if (activeChats.length > 0) await stopActiveProviderChats(adapter, activeChats)
    return adapter.updateProvider(sourceOptions)
  },
  getApprovalModes: (providerId) => adapters[providerId].getApprovalModes(),
  getSandboxModes: (providerId) => adapters[providerId].getSandboxModes(),
  getAgentModes: (providerId, options) =>
    adapters[providerId].getAgentModes?.(options) ?? Promise.resolve([]),
  getModels: (providerId, options) => adapters[providerId].getModels(options),
  getSkills: (providerId, cwd, options) => adapters[providerId].getSkills(cwd, options),
  getConnections: (providerId, options) => connectionAdapter(providerId).getConnections(options),
  connectProvider: (providerId, input, options) =>
    connectionAdapter(providerId).connectProvider(input, options),
  getConnectionAttempt: (providerId, attemptId, options) =>
    connectionAdapter(providerId).getConnectionAttempt(attemptId, options),
  completeConnection: (providerId, attemptId, code, options) =>
    connectionAdapter(providerId).completeConnection(attemptId, code, options),
  cancelConnection: (providerId, attemptId, options) =>
    connectionAdapter(providerId).cancelConnection(attemptId, options),
  deleteConnection: (providerId, credentialId, options) =>
    connectionAdapter(providerId).deleteConnection(credentialId, options),
  getConfig: (providerId, options) =>
    providerId === 'codex' ? codexAdapter.getConfig(options) : Promise.resolve(null),
  setConfigValue: (providerId, name, path, value, options) => {
    if (providerId !== 'codex') throw new Error('Configuration is not available for this provider')
    return codexAdapter.setConfigValue(name, path, value, options)
  },
  setConfigFeature: (providerId, name, enabled, options) => {
    if (providerId !== 'codex') throw new Error('Configuration is not available for this provider')
    return codexAdapter.setConfigFeature(name, enabled, options)
  },
  getApps: (providerId, options) => adapters[providerId].getApps(options),
  setSkillEnabled: (providerId, path, enabled, cwd, options) =>
    adapters[providerId].setSkillEnabled(path, enabled, cwd, options),
  setSkillsEnabled: (providerId, paths, enabled, cwd, options) =>
    adapters[providerId].setSkillsEnabled(paths, enabled, cwd, options),
  setAppEnabled: (providerId, appId, enabled, options) =>
    adapters[providerId].setAppEnabled(appId, enabled, options),
  getUsage: async (providerId, options?: ProviderUsageOptions) => {
    const usage = await adapters[providerId].getUsage(options)
    if (options?.chatId && !usage.authenticationRequired) {
      await limitResetQueue.observe(providerId, options.chatId, usage.rateLimits)
    }
    if (usage.authenticationRequired || !options?.includeStatistics || !usage.summary) return usage
    try {
      const costs = await getAccountUsageCosts(
        providerId,
        getContainerTargetKey(options.container),
        usage.summary,
        async () => {
          const models = await adapters[providerId].getModels({ container: options.container })
          const model = models.find((model) => model.isDefault) ?? models[0]
          if (!model) return null
          const modelId = model.resolvedModelId ?? model.id
          return {
            modelId,
            usage: emptyTokenUsage(),
            ...(providerId === 'codex' ? { pricingProvider: 'openai' as const } : {}),
            ...(providerId === 'claude' ? { pricingProvider: 'anthropic' as const } : {}),
            nativePricingKey: `${providerId}:${getContainerTargetKey(options.container)}:${modelId}`
          }
        }
      )
      return { ...usage, summary: { ...usage.summary, ...costs } }
    } catch (error) {
      console.error('Unable to estimate account statistics costs.', error)
      return usage
    }
  },
  getTokenUsage: async (providerId, chatId, options) => {
    const container =
      options?.container !== undefined
        ? options.container
        : chatId
          ? (await getChatMetadata(chatId)).container
          : null
    const sourceKey = getContainerTargetKey(container)
    const nativeSources = new Map<string, HistoricalTokenUsageSnapshot>()
    const readHistory = adapters[providerId].getHistoricalTokenUsage
    if (readHistory) {
      const sources = new Map(
        [null, ...(await getChatContainers()), container].map((target) => [
          getContainerTargetKey(target),
          target
        ])
      )
      // Bound remote work independently of the number of configured chat sources.
      const entries = [...sources.entries()]
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(2, entries.length) }, async () => {
          while (next < entries.length) {
            const [key, target] = entries[next++]
            try {
              const native = await readHistory(key === sourceKey ? (chatId ?? null) : null, {
                container: target
              })
              if (native) nativeSources.set(key, native)
            } catch (error) {
              if (key === sourceKey) throw error
              console.error('Unable to read historical token usage for another source.', error)
            }
          }
        })
      )
    }
    return getTokenUsageSummary(providerId, sourceKey, chatId ?? null, Date.now(), nativeSources)
  },
  resetRateLimits: (providerId, options) => adapters[providerId].resetRateLimits(options),
  getChatContainers,
  getChats: async (providerId, options) => {
    if (options?.searchTerm !== undefined && providerId !== 'codex') {
      throw new Error('Native conversation search is unavailable for this provider')
    }
    const page = await adapters[providerId].getChats(options)
    const chats = await applyMetadataToChats(page.chats)
    persistentChatHistory.observe(chats)
    const projectCwd = normalizeCwd(options?.projectCwd)
    return {
      ...page,
      chats: chats.filter(
        (chat) =>
          !chat.purpose &&
          (options?.done === undefined || chat.done === options.done) &&
          (projectCwd === null ||
            (!chat.noProject &&
              (normalizeCwd(chat.projectCwd) ?? normalizeCwd(chat.cwd)) === projectCwd))
      )
    }
  },
  getChatTerminalTasks: async (providerId, chatId) => {
    const metadata = await getChatMetadata(chatId)
    return (
      adapters[providerId].getChatTerminalTasks?.(chatId, { container: metadata.container }) ?? []
    )
  },
  getChat: async (providerId, chatId) => {
    const metadata = await getChatMetadata(chatId)
    return applyMetadataToDetail(
      await adapters[providerId].getChat(chatId, { container: metadata.container }),
      providerId
    )
  },
  getSubagents: async (providerId, chatId): Promise<ProviderSubagent[]> => {
    const metadata = await getChatMetadata(chatId)
    return adapters[providerId].getSubagents(chatId, { container: metadata.container })
  },
  getSubagent: async (
    providerId,
    chatId,
    subagentId,
    window?: ProviderChatTurnWindow
  ): Promise<ProviderSubagentDetail> => {
    const metadata = await getChatMetadata(chatId)
    return adapters[providerId].getSubagent(
      chatId,
      subagentId,
      {
        container: metadata.container
      },
      window
    )
  },
  cancelSubagent: async (providerId, chatId, subagentId): Promise<void> => {
    const metadata = await getChatMetadata(chatId)
    return adapters[providerId].cancelSubagent(chatId, subagentId, {
      container: metadata.container
    })
  },
  sendSubagentMessage: async (providerId, chatId, subagentId, message): Promise<void> => {
    const adapter = adapters[providerId]
    if (!adapter.sendSubagentMessage) {
      throw new Error('Messaging subagents is not supported by this provider')
    }
    const metadata = await getChatMetadata(chatId)
    return adapter.sendSubagentMessage(chatId, subagentId, message, {
      container: metadata.container
    })
  },
  setChatGoal: async (providerId, chatId, objective) => {
    const adapter = adapters[providerId]
    if (!adapter.setChatGoal) throw new Error('Goals are not supported by this provider')
    const metadata = await getChatMetadata(chatId)
    return adapter.setChatGoal(chatId, objective, { container: metadata.container })
  },
  setChatTitle: (providerId, chatId, title) =>
    adapters[providerId]
      .setChatTitle(chatId, title)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  generateOneShot: (providerId, message, options) =>
    adapters[providerId].generateOneShot(message, options),
  cancelOneShot: (providerId, generationId) => adapters[providerId].cancelOneShot(generationId),
  startChat: async (providerId, message, options, purpose) => {
    try {
      if (options?.initialGoal && !adapters[providerId].setChatGoal)
        throw new Error('This provider does not support goals.')
      options = await prepareChatWorkspace(app.getPath('userData'), options)
      const detail = await adapters[providerId].startChat(
        message,
        options,
        purpose || options?.review || options?.container || options?.noProject
          ? async (chatId) => {
              await Promise.all([
                options?.noProject ? setChatNoProject(chatId) : Promise.resolve(),
                purpose ? setChatPurpose(chatId, purpose) : Promise.resolve(),
                options?.container
                  ? setChatContainer(chatId, options.container)
                  : Promise.resolve(),
                options?.review
                  ? setMessageReview(chatId, message, options.review.prompt, options.review)
                  : Promise.resolve()
              ])
            }
          : undefined
      )
      return applyMetadataToDetail(detail, providerId)
    } catch (error) {
      if (options?.review)
        await deleteMessageReview(options.review.id).catch((error) => {
          console.error('[caught:providerService:startChat]', error)
        })
      throw error
    }
  },
  continueChat: (providerId, chatId, message, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].continueChat(chatId, message, options)
    ).then((detail) => applyMetadataToDetail(detail, providerId)),
  continueChatInFork: async (providerId, chatId, message, purpose, options) => {
    try {
      const sourceMetadata = await getChatMetadata(chatId)
      const detail = await adapters[providerId].continueChatInFork(
        chatId,
        message,
        options,
        async (forkedChatId) => {
          await Promise.all([
            setChatPurpose(forkedChatId, purpose),
            sourceMetadata.noProject || options?.noProject
              ? setChatNoProject(forkedChatId)
              : Promise.resolve(),
            options?.container
              ? setChatContainer(forkedChatId, options.container)
              : Promise.resolve(),
            options?.review
              ? setMessageReview(forkedChatId, message, options.review.prompt, options.review)
              : Promise.resolve()
          ])
        }
      )
      return applyMetadataToDetail(detail, providerId)
    } catch (error) {
      if (options?.review)
        await deleteMessageReview(options.review.id).catch((error) => {
          console.error('[caught:providerService:continueChatInFork]', error)
        })
      throw error
    }
  },
  forkChat: async (providerId, chatId, messageId) => {
    const sourceMetadata = await getChatMetadata(chatId)
    const detail = await adapters[providerId].forkChat(chatId, messageId, async (forkedChatId) => {
      if (sourceMetadata.noProject) await setChatNoProject(forkedChatId)
      if (sourceMetadata.container) {
        await setChatContainer(forkedChatId, sourceMetadata.container)
      }
    })
    return applyMetadataToDetail(detail, providerId)
  },
  sendActiveChatMessage: (providerId, chatId, message, mode, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].sendActiveChatMessage(chatId, message, mode, options)
    ).then((detail) => applyMetadataToDetail(detail, providerId)),
  getLimitResetMessages: (providerId, chatId) => limitResetQueue.list(providerId, chatId),
  addLimitResetMessage: async (providerId, target, message, options) => {
    const chatId = typeof target === 'string' ? target : undefined
    const detail = chatId ? await providerApi.getChat(providerId, chatId) : null
    if (detail?.writeAccess === 'readOnly') throw new Error('This chat is read-only.')
    const container = detail?.container ?? options.container
    const accountId = chatId
      ? (detail?.accountId ?? undefined)
      : (await providerApi.getAccounts(providerId, { container })).accounts.find(
          (account) => account.active
        )?.id
    const source = { chatId, container, accountId }
    const usage = await adapters[providerId].getUsage({ ...source, forceRefresh: true })
    const models = await adapters[providerId].getModels(source)
    await limitResetQueue.add(
      providerId,
      target,
      message,
      { ...options, container },
      usage.rateLimits,
      models.find((model) => model.id === options.model)?.usageScope,
      accountId
    )
  },
  deleteLimitResetMessage: (providerId, target, messageId) =>
    limitResetQueue.remove(providerId, target, messageId, async (entry) => {
      if (!entry.chatId || !uncommittedResetHandoffs.has(entry.id)) return
      await adapters[providerId].deletePendingMessage(entry.chatId, entry.id)
      await flushPersistentPendingMessages()
      uncommittedResetHandoffs.delete(entry.id)
    }),
  deletePendingMessage: (providerId, chatId, messageId) =>
    adapters[providerId]
      .deletePendingMessage(chatId, messageId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  beginPendingMessageEdit: (providerId, chatId, messageId, editId) =>
    adapters[providerId]
      .beginPendingMessageEdit(chatId, messageId, editId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  cancelPendingMessageEdit: (providerId, chatId, messageId, editId) =>
    adapters[providerId]
      .cancelPendingMessageEdit(chatId, messageId, editId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  editPendingMessage: (providerId, chatId, messageId, message, options, editId) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].editPendingMessage(chatId, messageId, message, options, editId)
    ).then((detail) => applyMetadataToDetail(detail, providerId)),
  steerPendingMessage: (providerId, chatId, messageId) =>
    adapters[providerId]
      .steerPendingMessage(chatId, messageId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  interruptPendingMessage: (providerId, chatId, messageId) =>
    adapters[providerId]
      .interruptPendingMessage(chatId, messageId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  editMessage: (providerId, chatId, messageId, message, options) =>
    runWithStoredReview(chatId, message, options?.review, () =>
      adapters[providerId].editMessage(chatId, messageId, message, options)
    ).then((detail) => applyMetadataToDetail(detail, providerId)),
  updateChatPermissions: async (providerId, chatId, options) => {
    const metadata = await getChatMetadata(chatId)
    await adapters[providerId].updateChatPermissions!(chatId, {
      ...options,
      container: metadata.container
    })
  },
  resolveApproval: (providerId, chatId, decision) =>
    adapters[providerId]
      .resolveApproval(chatId, decision)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  resolveUserInput: (providerId, chatId, requestId, response: ProviderUserInputResponse, options) =>
    adapters[providerId]
      .resolveUserInput(chatId, requestId, response, options)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  compactChat: (providerId, chatId) =>
    adapters[providerId]
      .compactChat(chatId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  prepareLinkedChatContext: async (providerId, chatId, options) => {
    if (linkedChatOperations.has(options.operationId)) {
      throw new Error('This linked chat is already loading.')
    }
    // Registered before the first await, so a cancellation sent right after the request wins.
    const controller = new AbortController()
    linkedChatOperations.set(options.operationId, controller)
    try {
      const sourceMetadata = await getChatMetadata(chatId)
      throwIfLinkedChatCancelled(controller.signal)
      const summary = await adapters[providerId].summarizeChatInFork(
        chatId,
        { summaryPrompt: options.summaryPrompt, signal: controller.signal },
        async (forkedChatId) => {
          await Promise.all([
            setChatPurpose(forkedChatId, 'linkedChat'),
            sourceMetadata.noProject ? setChatNoProject(forkedChatId) : Promise.resolve(),
            sourceMetadata.container
              ? setChatContainer(forkedChatId, sourceMetadata.container)
              : Promise.resolve()
          ])
        }
      )
      return controller.signal.aborted ? null : { summary }
    } catch (error) {
      if (controller.signal.aborted || isLinkedChatContextCancelled(error)) return null
      throw error
    } finally {
      linkedChatOperations.delete(options.operationId)
    }
  },
  cancelLinkedChatContext: async (operationId) => {
    linkedChatOperations.get(operationId)?.abort()
  },
  stopChat: (providerId, chatId) =>
    adapters[providerId]
      .stopChat(chatId)
      .then((detail) => applyMetadataToDetail(detail, providerId)),
  markChatDone: (_providerId, chatId, done = true) => setChatDone(chatId, done),
  markChatsDone: (chatIds) => setChatsDone(chatIds, true),
  getCwdNotes: (providerId, cwd) => getCwdNotes(providerId, cwd),
  setCwdNotes: (providerId, cwd, notes) => setCwdNotes(providerId, cwd, notes),
  markChatSeen: (_providerId, chatId, seenUpdatedAt) => setChatSeen(chatId, seenUpdatedAt),
  setChatPinned: (_providerId, chatId, pinned) => setChatPinned(chatId, pinned),
  setChatOrder: (chatIds) => setChatOrder(chatIds),
  onChatUpdated: (listener) => {
    chatUpdatedListeners.add(listener)
    return () => chatUpdatedListeners.delete(listener)
  }
}

export const disposeProviderAdapters = async (): Promise<void> => {
  await limitResetQueue.close()
  await Promise.allSettled(Object.values(adapters).map((adapter) => adapter.dispose()))
  await flushPersistentPendingMessages()
  for (const pending of pendingConversationViews.values()) clearTimeout(pending.timer)
  const finalViews = [...pendingConversationViews.values()]
  pendingConversationViews.clear()
  try {
    await Promise.all(
      finalViews.map((pending) => saveProviderConversationView(pending.scope, pending.detail))
    )
    await Promise.all(conversationViewWrites)
  } finally {
    persistentChatHistory.dispose()
  }
}
