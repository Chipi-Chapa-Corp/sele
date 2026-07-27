import { isAbsolute } from 'node:path'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import type {
  ProviderApprovalDecision,
  ProviderActiveSendMode,
  ProviderChatDetail,
  ProviderChatDetailUpdate,
  ProviderChatItem,
  ProviderChatListOptions,
  ProviderChatPurpose,
  ProviderChatUpdatedEvent,
  ProviderCwdNote,
  ProviderId,
  ProviderOneShotOptions,
  ProviderWindowChatUpdatedEvent,
  ProviderTurnOptions,
  ProviderUsageOptions,
  ProviderWorkingItem,
  ProviderWorkingStepUpdate
} from '../../shared/provider'
import {
  isProviderApprovalPolicy,
  isProviderApprovalsReviewer,
  isProviderActiveSendMode,
  isProviderId,
  isProviderModelId,
  isProviderReasoningEffort,
  isProviderSandboxMode,
  providerIpcChannels
} from '../../shared/provider'
import { getChatUpdateSummary, providerApi } from './providerService'

type QueuedWindowChatUpdate = Omit<ProviderWindowChatUpdatedEvent, 'detail' | 'sequence'> & {
  detail: ProviderChatDetail | null
}

type InFlightChatUpdate = {
  sequence: number
  chatKey: string
  detail: ProviderChatDetail | null
}

type AcknowledgedChatDetail = {
  chatKey: string
  detail: ProviderChatDetail
}

type ChatUpdateDeliveryState = {
  ready: boolean
  viewedChatKey: string | null
  inFlightUpdate: InFlightChatUpdate | null
  acknowledgedDetail: AcknowledgedChatDetail | null
  pendingByChatKey: Map<string, QueuedWindowChatUpdate>
  latestUpdateAtByChatKey: Map<string, number>
}

const chatUpdateDeliveryByWebContentsId = new Map<number, ChatUpdateDeliveryState>()
let nextChatUpdateSequence = 1
let queuedChatUpdateCount = 0
let sentChatUpdateCount = 0
let acknowledgedChatUpdateCount = 0
let lastChatUpdateQueuedAt: number | null = null
let lastChatUpdateSentAt: number | null = null
let lastChatUpdateAcknowledgedAt: number | null = null

export const getProviderIpcDiagnostics = (): Record<string, unknown> => ({
  queuedChatUpdateCount,
  sentChatUpdateCount,
  acknowledgedChatUpdateCount,
  lastChatUpdateQueuedAt,
  lastChatUpdateSentAt,
  lastChatUpdateAcknowledgedAt,
  windows: Array.from(chatUpdateDeliveryByWebContentsId.entries()).map(
    ([webContentsId, state]) => ({
      webContentsId,
      ready: state.ready,
      hasViewedChat: state.viewedChatKey !== null,
      inFlightSequence: state.inFlightUpdate?.sequence ?? null,
      inFlightItemCount: state.inFlightUpdate?.detail?.items.length ?? null,
      acknowledgedItemCount: state.acknowledgedDetail?.detail.items.length ?? null,
      pendingChatCount: state.pendingByChatKey.size,
      trackedChatCount: state.latestUpdateAtByChatKey.size
    })
  )
})

const getProviderChatKey = (providerId: ProviderId, chatId: string): string =>
  `${providerId}:${chatId}`

const getChangedTailStartIndex = <TItem extends { id: string }>(
  previousItems: TItem[],
  nextItems: TItem[],
  isActive: (item: TItem) => boolean
): number => {
  if (nextItems.length === 0 || previousItems.length === 0) return 0

  const sharedLength = Math.min(previousItems.length, nextItems.length)
  const candidates = [nextItems.length - 1]
  let sharedIdCount = 0

  while (
    sharedIdCount < sharedLength &&
    previousItems[sharedIdCount].id === nextItems[sharedIdCount].id
  ) {
    sharedIdCount += 1
  }
  if (sharedIdCount < sharedLength) candidates.push(sharedIdCount)
  if (previousItems.length !== nextItems.length) {
    candidates.push(Math.max(0, sharedLength - 1))
  }

  const previousActiveIndex = previousItems.findIndex(isActive)
  const nextActiveIndex = nextItems.findIndex(isActive)
  if (previousActiveIndex >= 0) candidates.push(previousActiveIndex)
  if (nextActiveIndex >= 0) candidates.push(nextActiveIndex)

  return Math.max(0, Math.min(...candidates))
}

const isRunningWorkingItem = (item: ProviderWorkingItem): boolean => {
  if (item.type === 'message') return false
  if (item.type === 'tool') return item.status === 'running'
  return item.tools.some((tool) => tool.status === 'running')
}

const createWorkingStepUpdate = (
  item: Extract<ProviderChatItem, { type: 'working' }>,
  previousItem: ProviderChatItem | undefined
): ProviderWorkingStepUpdate => {
  const previousWorkingItem =
    previousItem?.type === 'working' && previousItem.id === item.id ? previousItem : null
  const workingItemsStartIndex = previousWorkingItem
    ? getChangedTailStartIndex(previousWorkingItem.items, item.items, isRunningWorkingItem)
    : 0
  const { items, ...workingStep } = item

  return {
    ...workingStep,
    items: items.slice(workingItemsStartIndex),
    workingItemsStartIndex,
    workingItemsPrefixLastId:
      workingItemsStartIndex > 0 ? (items[workingItemsStartIndex - 1]?.id ?? null) : null
  }
}

const createChatDetailUpdate = (
  detail: ProviderChatDetail,
  previousDetail: ProviderChatDetail | null
): ProviderChatDetailUpdate => {
  const matchingPreviousDetail = previousDetail?.id === detail.id ? previousDetail : null
  const chatItemsStartIndex = matchingPreviousDetail
    ? getChangedTailStartIndex(
        matchingPreviousDetail.items,
        detail.items,
        (item) => item.type === 'working' && item.status === 'working'
      )
    : 0
  const { items, ...chatDetail } = detail

  return {
    ...chatDetail,
    items: items
      .slice(chatItemsStartIndex)
      .map((item, index) =>
        item.type === 'working'
          ? createWorkingStepUpdate(
              item,
              matchingPreviousDetail?.items[chatItemsStartIndex + index]
            )
          : item
      ),
    chatItemsStartIndex,
    chatItemsPrefixLastId:
      chatItemsStartIndex > 0 ? (items[chatItemsStartIndex - 1]?.id ?? null) : null
  }
}

const getChatUpdateDeliveryState = (webContents: WebContents): ChatUpdateDeliveryState => {
  const existingState = chatUpdateDeliveryByWebContentsId.get(webContents.id)
  if (existingState) return existingState

  const state: ChatUpdateDeliveryState = {
    ready: false,
    viewedChatKey: null,
    inFlightUpdate: null,
    acknowledgedDetail: null,
    pendingByChatKey: new Map(),
    latestUpdateAtByChatKey: new Map()
  }
  chatUpdateDeliveryByWebContentsId.set(webContents.id, state)
  webContents.once('destroyed', () => {
    chatUpdateDeliveryByWebContentsId.delete(webContents.id)
  })
  return state
}

const sendChatUpdate = (
  webContents: WebContents,
  state: ChatUpdateDeliveryState,
  update: QueuedWindowChatUpdate
): void => {
  if (webContents.isDestroyed() || !state.ready || state.inFlightUpdate !== null) return

  const sequence = nextChatUpdateSequence
  nextChatUpdateSequence =
    nextChatUpdateSequence >= Number.MAX_SAFE_INTEGER ? 1 : nextChatUpdateSequence + 1
  const chatKey = getProviderChatKey(update.providerId, update.chatId)
  const previousDetail =
    state.acknowledgedDetail?.chatKey === chatKey ? state.acknowledgedDetail.detail : null
  const detailUpdate = update.detail ? createChatDetailUpdate(update.detail, previousDetail) : null
  state.inFlightUpdate = {
    sequence,
    chatKey,
    detail: update.detail
  }
  sentChatUpdateCount += 1
  lastChatUpdateSentAt = Date.now()
  webContents.send(providerIpcChannels.chatUpdated, {
    ...update,
    detail: detailUpdate,
    sequence
  } satisfies ProviderWindowChatUpdatedEvent)
}

const sendNextChatUpdate = (webContents: WebContents, state: ChatUpdateDeliveryState): void => {
  if (!state.ready || state.inFlightUpdate !== null || state.pendingByChatKey.size === 0) return

  const preferredChatKey =
    state.viewedChatKey && state.pendingByChatKey.has(state.viewedChatKey)
      ? state.viewedChatKey
      : state.pendingByChatKey.keys().next().value
  if (typeof preferredChatKey !== 'string') return

  const update = state.pendingByChatKey.get(preferredChatKey)
  state.pendingByChatKey.delete(preferredChatKey)
  if (update) sendChatUpdate(webContents, state, update)
}

const queueChatUpdateForWindow = (
  webContents: WebContents,
  event: ProviderChatUpdatedEvent
): void => {
  if (webContents.isDestroyed()) return

  queuedChatUpdateCount += 1
  lastChatUpdateQueuedAt = Date.now()
  const state = getChatUpdateDeliveryState(webContents)
  const chatKey = getProviderChatKey(event.providerId, event.chatId)
  const latestUpdateAt = state.latestUpdateAtByChatKey.get(chatKey)
  if (latestUpdateAt !== undefined && event.summary.updatedAt < latestUpdateAt) return
  state.latestUpdateAtByChatKey.set(chatKey, event.summary.updatedAt)

  const pendingUpdate = state.pendingByChatKey.get(chatKey)
  const update = {
    providerId: event.providerId,
    chatId: event.chatId,
    detail: state.viewedChatKey === chatKey ? event.detail : null,
    summary: event.summary,
    turnCompleted: event.turnCompleted || pendingUpdate?.turnCompleted === true
  } satisfies QueuedWindowChatUpdate

  if (!state.ready || state.inFlightUpdate !== null) {
    state.pendingByChatKey.set(chatKey, update)
    return
  }

  sendChatUpdate(webContents, state, update)
}

const requireProviderId = (value: unknown): ProviderId => {
  if (!isProviderId(value)) throw new Error(`Unknown provider: ${String(value)}`)
  return value
}

const requireChatId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid chat ID')
  return value
}

const requireChatPurpose = (value: unknown): ProviderChatPurpose => {
  if (value !== 'commit') throw new Error('Invalid chat purpose')
  return value
}

const requireOptionalChatPurpose = (value: unknown): ProviderChatPurpose | undefined =>
  value == null ? undefined : requireChatPurpose(value)

const requireMessageId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid message ID')
  return value
}

const requireGenerationId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid generation ID')
  return value
}

const requireOptionalCwd = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Invalid cwd')
  return value
}

const requireBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value')
  return value
}

const requireTimestamp = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid timestamp')
  }

  return Math.floor(value)
}

const requireCwdNotes = (value: unknown): ProviderCwdNote[] => {
  if (!Array.isArray(value)) throw new Error('Invalid notes')
  if (value.length > 100) throw new Error('Too many notes')

  return value.map((note) => {
    if (!note || typeof note !== 'object') throw new Error('Invalid note')

    const candidate = note as Partial<ProviderCwdNote>
    if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 128) {
      throw new Error('Invalid note ID')
    }
    if (
      typeof candidate.text !== 'string' ||
      !candidate.text.trim() ||
      candidate.text.length > 1000
    ) {
      throw new Error('Invalid note text')
    }
    if (
      typeof candidate.createdAt !== 'number' ||
      !Number.isFinite(candidate.createdAt) ||
      candidate.createdAt < 0
    ) {
      throw new Error('Invalid note timestamp')
    }

    return {
      id: candidate.id.trim(),
      text: candidate.text.trim(),
      createdAt: Math.floor(candidate.createdAt)
    }
  })
}

const requireApprovalDecision = (value: unknown): ProviderApprovalDecision => {
  if (value !== 'allow' && value !== 'deny') throw new Error('Invalid approval decision')
  return value
}

const requireActiveSendMode = (value: unknown): ProviderActiveSendMode => {
  if (!isProviderActiveSendMode(value)) throw new Error('Invalid active send mode')
  return value
}

const requireChatListOptions = (value: unknown): ProviderChatListOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid chat list options')
  }

  const options = value as { cursor?: unknown; limit?: unknown }
  const cursor = options.cursor
  if (cursor != null && typeof cursor !== 'string') throw new Error('Invalid chat list cursor')

  const limit = options.limit
  if (
    limit != null &&
    (!Number.isInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > 100)
  ) {
    throw new Error('Invalid chat list limit')
  }

  return {
    cursor: cursor ?? null,
    limit: limit ?? null
  }
}

const requireUsageOptions = (value: unknown): ProviderUsageOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid usage options')

  const options = value as { includeStatistics?: unknown }
  const includeStatistics = options.includeStatistics
  if (includeStatistics != null && typeof includeStatistics !== 'boolean') {
    throw new Error('Invalid usage statistics option')
  }

  return {
    includeStatistics: includeStatistics ?? false
  }
}

const requireMessage = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid message')
  return value
}

const requireTurnOptions = (value: unknown): ProviderTurnOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid turn options')

  const options = value as {
    approvalPolicy?: unknown
    approvalsReviewer?: unknown
    cwd?: unknown
    model?: unknown
    reasoningEffort?: unknown
    sandboxMode?: unknown
  }
  const approvalPolicy = options.approvalPolicy
  if (!isProviderApprovalPolicy(approvalPolicy)) throw new Error('Invalid approval policy')

  const approvalsReviewer = options.approvalsReviewer ?? 'user'
  if (!isProviderApprovalsReviewer(approvalsReviewer)) {
    throw new Error('Invalid approvals reviewer')
  }

  const sandboxMode = options.sandboxMode
  if (!isProviderSandboxMode(sandboxMode)) throw new Error('Invalid sandbox mode')

  const cwd = options.cwd
  if (cwd != null && (typeof cwd !== 'string' || !isAbsolute(cwd))) {
    throw new Error('Invalid cwd')
  }

  const model = options.model ?? 'gpt-5.5'
  if (!isProviderModelId(model)) throw new Error('Invalid model')

  const reasoningEffort = options.reasoningEffort ?? 'xhigh'
  if (!isProviderReasoningEffort(reasoningEffort)) throw new Error('Invalid reasoning effort')

  return {
    approvalPolicy,
    approvalsReviewer,
    cwd: cwd ?? undefined,
    model,
    reasoningEffort,
    sandboxMode
  }
}

const requireOneShotOptions = (value: unknown): ProviderOneShotOptions | undefined => {
  const turnOptions = requireTurnOptions(value)
  if (value == null) return turnOptions
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid one-shot options')

  const generationId = (value as { generationId?: unknown }).generationId
  if (generationId != null) {
    return {
      ...turnOptions!,
      generationId: requireGenerationId(generationId)
    }
  }

  return turnOptions
}

export const registerProviderIpc = (): void => {
  providerApi.onChatUpdated((event) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      queueChatUpdateForWindow(window.webContents, event)
    })
  })

  ipcMain.on(providerIpcChannels.chatUpdatesReady, (event) => {
    const state = getChatUpdateDeliveryState(event.sender)
    state.ready = true
    sendNextChatUpdate(event.sender, state)
  })

  ipcMain.on(providerIpcChannels.chatUpdatesStopped, (event) => {
    const state = getChatUpdateDeliveryState(event.sender)
    state.ready = false
    state.inFlightUpdate = null
    state.acknowledgedDetail = null
    state.pendingByChatKey.clear()
  })

  ipcMain.on(
    providerIpcChannels.viewedChatChanged,
    (event, providerIdValue: unknown, chatIdValue: unknown) => {
      const state = getChatUpdateDeliveryState(event.sender)
      const clearingViewedChat = providerIdValue == null && chatIdValue == null
      if (!clearingViewedChat && (providerIdValue == null || chatIdValue == null)) {
        return
      }

      try {
        const nextViewedChatKey = clearingViewedChat
          ? null
          : getProviderChatKey(requireProviderId(providerIdValue), requireChatId(chatIdValue))
        if (state.viewedChatKey !== nextViewedChatKey) state.acknowledgedDetail = null
        state.viewedChatKey = nextViewedChatKey
      } catch {
        return
      }

      for (const [chatKey, update] of state.pendingByChatKey) {
        if (chatKey === state.viewedChatKey || update.detail === null) continue
        state.pendingByChatKey.set(chatKey, {
          ...update,
          detail: null
        })
      }
      sendNextChatUpdate(event.sender, state)
    }
  )

  ipcMain.on(
    providerIpcChannels.chatUpdateAcknowledged,
    (event, sequenceValue: unknown, detailAppliedValue: unknown) => {
      if (
        typeof sequenceValue !== 'number' ||
        !Number.isSafeInteger(sequenceValue) ||
        sequenceValue < 1 ||
        typeof detailAppliedValue !== 'boolean'
      ) {
        return
      }

      const state = getChatUpdateDeliveryState(event.sender)
      const inFlightUpdate = state.inFlightUpdate
      if (!inFlightUpdate || inFlightUpdate.sequence !== sequenceValue) return
      acknowledgedChatUpdateCount += 1
      lastChatUpdateAcknowledgedAt = Date.now()

      if (
        detailAppliedValue &&
        inFlightUpdate.detail &&
        state.viewedChatKey === inFlightUpdate.chatKey
      ) {
        state.acknowledgedDetail = {
          chatKey: inFlightUpdate.chatKey,
          detail: inFlightUpdate.detail
        }
      } else if (
        inFlightUpdate.detail &&
        state.acknowledgedDetail?.chatKey === inFlightUpdate.chatKey
      ) {
        state.acknowledgedDetail = null
      }

      state.inFlightUpdate = null
      sendNextChatUpdate(event.sender, state)
    }
  )

  ipcMain.handle(providerIpcChannels.login, (_, providerId: unknown) =>
    providerApi.login(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getUpdateAvailability, (_, providerId: unknown) =>
    providerApi.getUpdateAvailability(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.updateProvider, (_, providerId: unknown) =>
    providerApi.updateProvider(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getApprovalModes, (_, providerId: unknown) =>
    providerApi.getApprovalModes(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getSandboxModes, (_, providerId: unknown) =>
    providerApi.getSandboxModes(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getModels, (_, providerId: unknown) =>
    providerApi.getModels(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getUsage, (_, providerId: unknown, options: unknown) =>
    providerApi.getUsage(requireProviderId(providerId), requireUsageOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getChats, (_, providerId: unknown, options: unknown) =>
    providerApi.getChats(requireProviderId(providerId), requireChatListOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getChat, (_, providerId: unknown, chatId: unknown) =>
    providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
  )

  ipcMain.handle(
    providerIpcChannels.generateOneShot,
    (_, providerId: unknown, message: unknown, options: unknown) =>
      providerApi.generateOneShot(
        requireProviderId(providerId),
        requireMessage(message),
        requireOneShotOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.cancelOneShot,
    (_, providerId: unknown, generationId: unknown) =>
      providerApi.cancelOneShot(requireProviderId(providerId), requireGenerationId(generationId))
  )

  ipcMain.handle(
    providerIpcChannels.startChat,
    (_, providerId: unknown, message: unknown, options: unknown, purpose: unknown) =>
      providerApi.startChat(
        requireProviderId(providerId),
        requireMessage(message),
        requireTurnOptions(options),
        requireOptionalChatPurpose(purpose)
      )
  )

  ipcMain.handle(
    providerIpcChannels.continueChat,
    (_, providerId: unknown, chatId: unknown, message: unknown, options: unknown) =>
      providerApi.continueChat(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.continueChatSummary,
    async (_, providerId: unknown, chatId: unknown, message: unknown, options: unknown) => {
      const detail = await providerApi.continueChat(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireTurnOptions(options)
      )
      return getChatUpdateSummary(detail, Date.now())
    }
  )

  ipcMain.handle(
    providerIpcChannels.continueChatInFork,
    (
      _,
      providerId: unknown,
      chatId: unknown,
      message: unknown,
      purpose: unknown,
      options: unknown
    ) =>
      providerApi.continueChatInFork(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireChatPurpose(purpose),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.sendActiveChatMessage,
    (_, providerId: unknown, chatId: unknown, message: unknown, mode: unknown, options: unknown) =>
      providerApi.sendActiveChatMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireActiveSendMode(mode),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.sendActiveChatMessageSummary,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      message: unknown,
      mode: unknown,
      options: unknown
    ) => {
      const detail = await providerApi.sendActiveChatMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireActiveSendMode(mode),
        requireTurnOptions(options)
      )
      return getChatUpdateSummary(detail, Date.now())
    }
  )

  ipcMain.handle(
    providerIpcChannels.deletePendingMessage,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      providerApi.deletePendingMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId)
      )
  )

  ipcMain.handle(
    providerIpcChannels.editPendingMessage,
    (
      _,
      providerId: unknown,
      chatId: unknown,
      messageId: unknown,
      message: unknown,
      options: unknown
    ) =>
      providerApi.editPendingMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.interruptPendingMessage,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      providerApi.interruptPendingMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId)
      )
  )

  ipcMain.handle(
    providerIpcChannels.editMessage,
    (
      _,
      providerId: unknown,
      chatId: unknown,
      messageId: unknown,
      message: unknown,
      options: unknown
    ) =>
      providerApi.editMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(providerIpcChannels.stopChat, (_, providerId: unknown, chatId: unknown) =>
    providerApi.stopChat(requireProviderId(providerId), requireChatId(chatId))
  )

  ipcMain.handle(
    providerIpcChannels.stopChatSummary,
    async (_, providerId: unknown, chatId: unknown) => {
      const detail = await providerApi.stopChat(
        requireProviderId(providerId),
        requireChatId(chatId)
      )
      return getChatUpdateSummary(detail, Date.now())
    }
  )

  ipcMain.handle(
    providerIpcChannels.resolveApproval,
    (_, providerId: unknown, chatId: unknown, decision: unknown) =>
      providerApi.resolveApproval(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireApprovalDecision(decision)
      )
  )

  ipcMain.handle(
    providerIpcChannels.markChatDone,
    (_, providerId: unknown, chatId: unknown, done: unknown) =>
      providerApi.markChatDone(
        requireProviderId(providerId),
        requireChatId(chatId),
        done == null ? true : requireBoolean(done)
      )
  )

  ipcMain.handle(providerIpcChannels.markCwdChatsDone, (_, providerId: unknown, cwd: unknown) =>
    providerApi.markCwdChatsDone(requireProviderId(providerId), requireOptionalCwd(cwd))
  )

  ipcMain.handle(providerIpcChannels.getCwdNotes, (_, providerId: unknown, cwd: unknown) =>
    providerApi.getCwdNotes(requireProviderId(providerId), requireOptionalCwd(cwd))
  )

  ipcMain.handle(
    providerIpcChannels.setCwdNotes,
    (_, providerId: unknown, cwd: unknown, notes: unknown) =>
      providerApi.setCwdNotes(
        requireProviderId(providerId),
        requireOptionalCwd(cwd),
        requireCwdNotes(notes)
      )
  )

  ipcMain.handle(
    providerIpcChannels.markChatSeen,
    (_, providerId: unknown, chatId: unknown, seenUpdatedAt: unknown) =>
      providerApi.markChatSeen(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireTimestamp(seenUpdatedAt)
      )
  )

  ipcMain.handle(
    providerIpcChannels.setChatPinned,
    (_, providerId: unknown, chatId: unknown, pinned: unknown) =>
      providerApi.setChatPinned(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireBoolean(pinned)
      )
  )
}
