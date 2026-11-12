import { publishWorkspace } from '../workspaceEvents'
import type { ProviderConnectInput } from '../../shared/providerConnections'
import { normalizeNetworkRetrySettings, type NetworkRetrySettings } from '../../shared/networkRetry'
import { handleClientRequest, logDiagnostic } from '../logging'
import { onClientMessage, type RendererClient } from '../clientIpc'
import { setChatUpdateInterest } from './chatUpdateInterest'
import { onChatMetadataChanged } from './chatMetadataEvents'
import type { ProviderConfigValue } from '../../shared/provider'
import { isDeepStrictEqual } from 'node:util'
import { extname, isAbsolute } from 'node:path'
import type {
  ProviderApprovalDecision,
  ProviderActiveSendMode,
  ProviderAccountUsage,
  ProviderApi,
  ProviderChatDetail,
  ProviderChatMetadata,
  ProviderChatDetailUpdate,
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatPurpose,
  ProviderLinkedChatContextOptions,
  ProviderChatUpdatedEvent,
  ProviderChatTurnPage,
  ProviderCwdNote,
  ProviderFileInput,
  ProviderId,
  ProviderImageInput,
  ProviderOneShotOptions,
  ProviderPendingMessage,
  ProviderLimitResetTarget,
  ProviderPermissionOptions,
  ProviderApp,
  ProviderResourceUpdateOptions,
  ProviderReview,
  ProviderSourceOptions,
  ProviderSkill,
  ProviderSkillInput,
  ProviderSkillScope,
  ProviderSubagentDetail,
  ProviderWindowChatUpdatedEvent,
  ProviderTurnOptions,
  ProviderStartChatOptions,
  ProviderUpdateOptions,
  ProviderUserInputResponse,
  ProviderUsageOptions,
  ProviderRateLimitResetOptions,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingStepPage,
  ProviderWorkingToolPage
} from '../../shared/provider'
import {
  isProviderAgentMode,
  isProviderApprovalPolicy,
  isProviderApprovalsReviewer,
  isProviderActiveSendMode,
  isProviderId,
  isProviderModelId,
  isProviderReasoningEffort,
  isProviderSandboxMode,
  isProviderServiceTier,
  providerIpcChannels
} from '../../shared/provider'
import { providerSubagentTurnPageSize } from '../../shared/provider'
import { requireContainerTarget } from '../containerTarget'
import { getProviderChatTurnCount, sliceProviderChatTurns } from '../../shared/chatTurns'
import {
  getChatUpdateSummary,
  getProviderCachedChat,
  getProviderKnownChats,
  beginProviderConversationRead,
  saveProviderConversationView,
  beginProviderChatHistoryRead,
  saveProviderChatHistory,
  getProviderChatCursorWindow,
  getProviderChatItemWindow,
  getProviderSubagentItemWindow,
  getProviderChatWindow,
  providerApi,
  startLimitResetQueue
} from './providerService'
import {
  prepareChatDetailForRenderer,
  prepareChatItemsForRenderer,
  rendererChatTurnPageSize
} from './chatDetailLazy'
import {
  limitWorkingItemPayload,
  prepareWorkingToolPage,
  prepareWorkingStepPage,
  rendererWorkingItemWindowSize,
  unloadHistoricalWorkingSteps
} from './workingStepLazy'
import { getErrorMessage } from './providerValues'

type QueuedWindowChatUpdate = Omit<ProviderWindowChatUpdatedEvent, 'detail' | 'sequence'> & {
  detail: ProviderChatDetail | null
}

type InFlightChatUpdate = {
  sequence: number
  chatKey: string
  detail: ProviderChatDetail | null
  update: QueuedWindowChatUpdate
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
  acknowledgmentTimer: ReturnType<typeof setTimeout> | null
  pendingByChatKey: Map<string, QueuedWindowChatUpdate>
  latestRevisionByChatKey: Map<string, number>
}

const withWorkspaceUpdate = async <T>(operation: Promise<T>): Promise<T> => {
  const result = await operation
  publishWorkspace()
  return result
}

const chatUpdateDeliveryByClientId = new Map<number, ChatUpdateDeliveryState>()
const chatUpdateClients = new Map<number, RendererClient>()
let nextChatUpdateSequence = 1
let providerIpcShuttingDown = false

export const beginProviderIpcShutdown = (): void => {
  providerIpcShuttingDown = true
  chatUpdateDeliveryByClientId.forEach((_, id) => setChatUpdateInterest(id, null))
  chatUpdateDeliveryByClientId.forEach(clearChatAcknowledgmentTimer)
  chatUpdateDeliveryByClientId.clear()
  chatUpdateClients.clear()
}

const isExpectedProviderShutdownError = (error: unknown): boolean => {
  const message = getErrorMessage(error)
  if (!providerIpcShuttingDown) return false

  return (
    message === 'Codex app-server stopped' ||
    message === 'Codex app-server is not running' ||
    message.includes('Object has been destroyed')
  )
}

const isExpectedProviderBackgroundReadError = (error: unknown): boolean => {
  const message = getErrorMessage(error)
  return (
    isExpectedProviderShutdownError(error) ||
    message === 'Codex app-server request timed out: initialize'
  )
}

const runShutdownTolerantProviderRead = async <TValue>(
  read: () => Promise<TValue>,
  fallback: (error: unknown) => TValue
): Promise<TValue> => {
  try {
    return await read()
  } catch (error) {
    if (isExpectedProviderBackgroundReadError(error)) {
      console.error(
        '[registerProviderIpc:runShutdownTolerantProviderRead] Provider read failed',
        error
      )
      return fallback(error)
    }
    throw error
  }
}

const getEmptyProviderAccountUsage = (error: unknown): ProviderAccountUsage => ({
  updatedAt: Date.now(),
  statisticsLoaded: false,
  summary: null,
  dailyUsageBuckets: null,
  rateLimits: [],
  rateLimitResetCredits: null,
  errors: isExpectedProviderShutdownError(error) ? [] : [getErrorMessage(error)]
})

const getEmptyProviderChatPage = (): ProviderChatPage => ({
  chats: [],
  nextCursor: null
})

const getProviderChatKey = (providerId: ProviderId, chatId: string): string =>
  `${providerId}:${chatId}`

const createChatDetailUpdate = (
  detail: ProviderChatDetail,
  previousDetail: ProviderChatDetail | null
): ProviderChatDetailUpdate => {
  const previousItemsById = new Map(
    previousDetail?.id === detail.id
      ? previousDetail.items.map((item) => [item.id, item] as const)
      : []
  )
  const { items, ...metadata } = detail

  return {
    ...metadata,
    baseRevision: previousDetail?.id === detail.id ? previousDetail.revision : null,
    baseItemIds:
      previousDetail?.id === detail.id ? previousDetail.items.map((item) => item.id) : null,
    itemIds: items.map((item) => item.id),
    changedItems: items.filter((item) => {
      const previousItem = previousItemsById.get(item.id)
      return !previousItem || !isDeepStrictEqual(previousItem, item)
    })
  }
}

const getRendererChatDetail = async (
  read: () => Promise<ProviderChatDetail>
): Promise<ProviderChatDetail> => prepareChatDetailForRenderer(await read())

const readWorkingStep = async (
  providerId: unknown,
  chatId: unknown,
  workingStepId: unknown,
  rootChatId: unknown
): Promise<ProviderWorkingStep> => {
  const requiredProviderId = requireProviderId(providerId)
  const requiredChatId = requireChatId(chatId)
  const requiredWorkingStepId = requireMessageId(workingStepId)
  const detail: Pick<ProviderChatDetail, 'items'> =
    rootChatId === undefined
      ? await getProviderChatItemWindow(
          requiredProviderId,
          requiredChatId,
          requiredWorkingStepId,
          1
        )
      : await getProviderSubagentItemWindow(
          requiredProviderId,
          requireChatId(rootChatId),
          requiredChatId,
          requiredWorkingStepId
        )
  const workingStep = detail.items.find(
    (item): item is ProviderWorkingStep =>
      item.type === 'working' && item.id === requiredWorkingStepId
  )
  if (!workingStep) throw new Error('Working section not found')
  return workingStep
}

const getChatUpdateDeliveryState = (client: RendererClient): ChatUpdateDeliveryState => {
  const existingState = chatUpdateDeliveryByClientId.get(client.id)
  if (existingState) return existingState

  const state: ChatUpdateDeliveryState = {
    ready: false,
    viewedChatKey: null,
    inFlightUpdate: null,
    acknowledgedDetail: null,
    acknowledgmentTimer: null,
    pendingByChatKey: new Map(),
    latestRevisionByChatKey: new Map()
  }
  chatUpdateDeliveryByClientId.set(client.id, state)
  chatUpdateClients.set(client.id, client)
  // A reload can fail before React installs (or cleans up) its subscription.
  // WebContents survives navigation, so its old ready flag is not a live consumer.
  client.on('render-process-gone', () => suspendChatUpdateDelivery(client, state))
  client.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) suspendChatUpdateDelivery(client, state)
  })
  client.once('destroyed', () => {
    clearChatAcknowledgmentTimer(state)
    setChatUpdateInterest(client.id, null)
    chatUpdateDeliveryByClientId.delete(client.id)
    chatUpdateClients.delete(client.id)
  })
  return state
}

const clearChatAcknowledgmentTimer = (state: ChatUpdateDeliveryState): void => {
  if (state.acknowledgmentTimer !== null) clearTimeout(state.acknowledgmentTimer)
  state.acknowledgmentTimer = null
}

const resetChatUpdateAcknowledgment = (state: ChatUpdateDeliveryState): void => {
  clearChatAcknowledgmentTimer(state)
  const inFlight = state.inFlightUpdate
  if (inFlight) {
    const latest = state.pendingByChatKey.get(inFlight.chatKey) ?? inFlight.update
    state.pendingByChatKey.set(inFlight.chatKey, {
      ...latest,
      detail: state.viewedChatKey === inFlight.chatKey ? latest.detail : null,
      turnCompleted: latest.turnCompleted || inFlight.update.turnCompleted
    })
  }
  state.inFlightUpdate = null
  state.acknowledgedDetail = null
}

const suspendChatUpdateDelivery = (
  client: RendererClient,
  state: ChatUpdateDeliveryState
): void => {
  state.ready = false
  setChatUpdateInterest(client.id, null)
  // Keep only the latest update per chat, including any completion being delivered.
  // A recovered consumer must not need another provider event to see that result.
  resetChatUpdateAcknowledgment(state)
}

const watchChatAcknowledgment = (client: RendererClient, state: ChatUpdateDeliveryState): void => {
  if (state.acknowledgmentTimer !== null || !state.inFlightUpdate) return
  const sequence = state.inFlightUpdate.sequence
  state.acknowledgmentTimer = setTimeout(() => {
    state.acknowledgmentTimer = null
    if (client.isDestroyed() || state.inFlightUpdate?.sequence !== sequence) return
    // Record delivery state only, never message/tool content. This distinguishes a renderer
    // acknowledgment stall from a provider that has stopped producing updates.
    logDiagnostic('warn', 'chat-update-delivery', {
      reason: 'renderer-acknowledgment-overdue',
      windowId: client.id,
      sequence,
      inFlightChatKey: state.inFlightUpdate.chatKey,
      inFlightRevision: state.inFlightUpdate.detail?.revision ?? null,
      viewedChatKey: state.viewedChatKey,
      pendingChatCount: state.pendingByChatKey.size,
      pending: [...state.pendingByChatKey.values()].slice(0, 10).map((update) => ({
        providerId: update.providerId,
        chatId: update.chatId,
        revision: update.detail?.revision ?? null,
        turnCompleted: update.turnCompleted
      }))
    })
    // A lost acknowledgment must not block every chat in this window indefinitely. Retry
    // the latest coalesced snapshot with a fresh sequence and no delta base. A late ack for
    // the superseded sequence is ignored by the normal acknowledgment handler.
    // Retry even the final packet: there may never be a queued successor to
    // restart delivery after a lost completion or a failed renderer commit.
    resetChatUpdateAcknowledgment(state)
    sendNextChatUpdate(client, state)
  }, 2_000)
  state.acknowledgmentTimer.unref?.()
}

// Metadata can change while an older SDK snapshot waits for renderer acknowledgement.
// Apply it at delivery time so a delayed snapshot cannot undo an idle-client update.
const latestMetadata = new Map<string, ProviderChatMetadata>()
const withLatestMetadata = (update: QueuedWindowChatUpdate): QueuedWindowChatUpdate => {
  const metadata = latestMetadata.get(update.chatId)
  if (!metadata) return update
  const merge = <
    T extends { accountId?: string | null; container?: ProviderChatMetadata['container'] }
  >(
    value: T
  ): T => ({
    ...value,
    ...metadata,
    accountId: metadata.accountId ?? value.accountId,
    container: metadata.container ?? value.container ?? null
  })
  return {
    ...update,
    summary: merge(update.summary),
    detail: update.detail ? merge(update.detail) : null
  }
}

const sendChatUpdate = (
  client: RendererClient,
  state: ChatUpdateDeliveryState,
  update: QueuedWindowChatUpdate
): void => {
  if (client.isDestroyed() || !state.ready || state.inFlightUpdate !== null) return

  update = withLatestMetadata(update)
  const sequence = nextChatUpdateSequence
  nextChatUpdateSequence =
    nextChatUpdateSequence >= Number.MAX_SAFE_INTEGER ? 1 : nextChatUpdateSequence + 1
  const chatKey = getProviderChatKey(update.providerId, update.chatId)
  const previousDetail =
    state.acknowledgedDetail?.chatKey === chatKey ? state.acknowledgedDetail.detail : null
  const rendererDetail = update.detail ? prepareChatDetailForRenderer(update.detail) : null
  const detailUpdate = rendererDetail
    ? createChatDetailUpdate(rendererDetail, previousDetail)
    : null
  state.inFlightUpdate = {
    sequence,
    chatKey,
    detail: rendererDetail,
    update: { ...update, detail: rendererDetail }
  }
  client.send(providerIpcChannels.chatUpdated, {
    ...update,
    detail: detailUpdate,
    sequence
  } satisfies ProviderWindowChatUpdatedEvent)
  watchChatAcknowledgment(client, state)
}

const sendNextChatUpdate = (client: RendererClient, state: ChatUpdateDeliveryState): void => {
  if (!state.ready || state.inFlightUpdate !== null || state.pendingByChatKey.size === 0) return

  const preferredChatKey =
    state.viewedChatKey && state.pendingByChatKey.has(state.viewedChatKey)
      ? state.viewedChatKey
      : state.pendingByChatKey.keys().next().value
  if (typeof preferredChatKey !== 'string') return

  const update = state.pendingByChatKey.get(preferredChatKey)
  state.pendingByChatKey.delete(preferredChatKey)
  if (update) sendChatUpdate(client, state, update)
}

const queueChatUpdateForWindow = (
  client: RendererClient,
  event: ProviderChatUpdatedEvent
): void => {
  if (client.isDestroyed()) return

  const state = getChatUpdateDeliveryState(client)
  const chatKey = getProviderChatKey(event.providerId, event.chatId)
  const latestRevision = state.latestRevisionByChatKey.get(chatKey)
  if (latestRevision !== undefined && event.detail.revision <= latestRevision) return
  state.latestRevisionByChatKey.set(chatKey, event.detail.revision)

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
    watchChatAcknowledgment(client, state)
    return
  }

  sendChatUpdate(client, state, update)
}

const requireProviderId = (value: unknown): ProviderId => {
  if (!isProviderId(value)) throw new Error(`Unknown provider: ${String(value)}`)
  return value
}

const requireChatId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid chat ID')
  return value
}

const requireOptionalChatId = (value: unknown): string | null =>
  value == null ? null : requireChatId(value)

const requireChatIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid chat IDs')

  const chatIds = value.map(requireChatId)
  if (new Set(chatIds).size !== chatIds.length) throw new Error('Duplicate chat IDs')
  return chatIds
}

const requireChatPurpose = (value: unknown): ProviderChatPurpose => {
  if (value !== 'commit') throw new Error('Invalid chat purpose')
  return value
}

const requireOptionalChatPurpose = (value: unknown): ProviderChatPurpose | undefined =>
  value == null ? undefined : requireChatPurpose(value)

const maxLinkedChatSummaryPromptLength = 20_000

const requireLinkedChatOperationId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('Invalid linked chat operation ID')
  }
  return value
}

const requireLinkedChatContextOptions = (value: unknown): ProviderLinkedChatContextOptions => {
  if (!value || typeof value !== 'object') throw new Error('Invalid linked chat options')
  const { operationId, summaryPrompt } = value as Record<string, unknown>
  if (
    typeof summaryPrompt !== 'string' ||
    !summaryPrompt.trim() ||
    summaryPrompt.length > maxLinkedChatSummaryPromptLength
  ) {
    throw new Error('Invalid linked chat summary prompt')
  }
  return { operationId: requireLinkedChatOperationId(operationId), summaryPrompt }
}

const requireMessageId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid message ID')
  return value
}

const requireChatTurnStartIndex = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid chat turn start index')
  }
  return value
}

const requireChatTurnLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new Error('Invalid chat turn limit')
  }
  return value
}

const requireChatTurnCursorDirection = (value: unknown): 'older' | 'newer' => {
  if (value !== 'older' && value !== 'newer') {
    throw new Error('Invalid chat turn cursor direction')
  }
  return value
}

const requireChatTurnCursor = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value !== 'string' || !value) throw new Error('Invalid chat turn cursor')
  return value
}

const requireWorkingItemLimit = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > rendererWorkingItemWindowSize
  ) {
    throw new Error('Invalid working item limit')
  }
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

const requireProviderSkillPath = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !isAbsolute(value) ||
    value.length > 32_768 ||
    /[\0\r\n]/.test(value)
  ) {
    throw new Error('Invalid skill path')
  }
  return value
}

const requireProviderSkillPaths = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid skill paths')
  return Array.from(new Set(value.map(requireProviderSkillPath)))
}

const requireProviderResourceString = (
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = false
): string => {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.length > maximumLength ||
    /\0/.test(value)
  ) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

const requireOptionalProviderResourceString = (
  value: unknown,
  label: string,
  maximumLength: number
): string | null =>
  value == null ? null : requireProviderResourceString(value, label, maximumLength, true)

const requireAccountId = (value: unknown): string =>
  requireProviderResourceString(value, 'account ID', 128)

const requireLoginId = (value: unknown): string =>
  requireProviderResourceString(value, 'login ID', 128)

const requireOptionalLoginId = (value: unknown): string | null =>
  requireOptionalProviderResourceString(value, 'login ID', 128)

const requireAuthorizationCode = (value: unknown): string =>
  requireProviderResourceString(value, 'authorization code', 4096)

const providerSkillScopes = new Set<ProviderSkillScope>(['user', 'repo', 'system', 'admin'])

const requireProviderSkill = (value: unknown): ProviderSkill => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('Invalid provider skill')
  }

  const skill = value as Record<string, unknown>
  if (!providerSkillScopes.has(skill.scope as ProviderSkillScope)) {
    throw new Error('Invalid provider skill scope')
  }

  return {
    name: requireProviderResourceString(skill.name, 'provider skill name', 512),
    description: requireProviderResourceString(
      skill.description,
      'provider skill description',
      32_768,
      true
    ),
    shortDescription: requireOptionalProviderResourceString(
      skill.shortDescription,
      'provider skill short description',
      8_192
    ),
    displayName: requireOptionalProviderResourceString(
      skill.displayName,
      'provider skill display name',
      512
    ),
    path: requireProviderSkillPath(skill.path),
    scope: skill.scope as ProviderSkillScope,
    enabled: requireBoolean(skill.enabled)
  }
}

const requireProviderApp = (value: unknown): ProviderApp => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('Invalid provider app')
  }

  const app = value as Record<string, unknown>
  if (!Array.isArray(app.skillNames) || app.skillNames.length > 500) {
    throw new Error('Invalid provider app skill names')
  }

  return {
    id: requireProviderAppId(app.id),
    name: requireProviderResourceString(app.name, 'provider app name', 512),
    description: requireProviderResourceString(
      app.description,
      'provider app description',
      32_768,
      true
    ),
    enabled: requireBoolean(app.enabled),
    callable: requireBoolean(app.callable),
    skillNames: Array.from(
      new Set(
        app.skillNames.map((name) =>
          requireProviderResourceString(name, 'provider app skill name', 512)
        )
      )
    )
  }
}

const requireProviderAppId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\0\r\n]/.test(value)) {
    throw new Error('Invalid app ID')
  }
  return value.trim()
}

const requireBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value')
  return value
}

const requireConfigName =
  (message: string) =>
  (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(message)
    return value
  }

const requireConfigPath = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 12 || value.some((key) => typeof key !== 'string'))
    throw new Error('Invalid setting path')
  return value
}

const requireDone = (value: unknown): boolean => value == null || requireBoolean(value)

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
  if (value !== 'allow' && value !== 'allowSession' && value !== 'deny')
    throw new Error('Invalid approval decision')
  return value
}

const requireUserInputResponse = (value: unknown): ProviderUserInputResponse => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid user input response')
  }

  const response = value as {
    kind?: unknown
    answer?: unknown
    wasFreeform?: unknown
    action?: unknown
    content?: unknown
  }
  if (response.kind === 'cancel') return { kind: 'cancel' }
  if (response.kind === 'elicitation') {
    if (response.action !== 'accept' && response.action !== 'decline')
      throw new Error('Invalid elicitation action')
    if (
      response.content !== undefined &&
      (!response.content ||
        typeof response.content !== 'object' ||
        Array.isArray(response.content) ||
        JSON.stringify(response.content).length > 100_000)
    )
      throw new Error('Invalid elicitation content')
    return {
      kind: 'elicitation',
      action: response.action,
      ...(response.content === undefined
        ? {}
        : { content: response.content as Record<string, unknown> })
    }
  }
  if (
    response.kind !== 'answer' ||
    typeof response.answer !== 'string' ||
    !response.answer.trim() ||
    response.answer.length > 100_000 ||
    typeof response.wasFreeform !== 'boolean'
  ) {
    throw new Error('Invalid user input response')
  }

  return {
    kind: 'answer',
    answer: response.answer,
    wasFreeform: response.wasFreeform
  }
}

const requireActiveSendMode = (value: unknown): ProviderActiveSendMode => {
  if (!isProviderActiveSendMode(value)) throw new Error('Invalid active send mode')
  return value
}

const requireConnectionString = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid connection value')
  return value.trim()
}

const requireConnectionInput = (value: unknown): ProviderConnectInput => {
  if (!value || typeof value !== 'object') throw new Error('Invalid connection input')
  const input = value as Record<string, unknown>
  const integrationId = requireConnectionString(input.integrationId)
  if (
    input.inputs !== undefined &&
    (!input.inputs ||
      typeof input.inputs !== 'object' ||
      Array.isArray(input.inputs) ||
      Object.values(input.inputs).some((value) => typeof value !== 'string'))
  )
    throw new Error('Invalid connection inputs')
  if (input.method === 'key') {
    return {
      integrationId,
      method: 'key',
      ...(input.methodId !== undefined
        ? { methodId: requireConnectionString(input.methodId) }
        : {}),
      key: requireConnectionString(input.key),
      ...(input.inputs ? { inputs: input.inputs as Record<string, string> } : {})
    }
  }
  if (input.method !== 'oauth') throw new Error('Invalid connection method')
  const methodId = requireConnectionString(input.methodId)
  return {
    integrationId,
    method: 'oauth',
    methodId,
    inputs: input.inputs as Record<string, string> | undefined
  }
}

const requireSourceOptions = (value: unknown): ProviderSourceOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid provider source options')
  }

  const options = value as { container?: unknown; forceRefresh?: unknown; chatId?: unknown }
  const container =
    options.container === undefined ? undefined : requireContainerTarget(options.container)
  const forceRefresh =
    options.forceRefresh === undefined ? undefined : requireBoolean(options.forceRefresh)

  return {
    ...(container === undefined ? {} : { container }),
    ...(forceRefresh === undefined ? {} : { forceRefresh }),
    ...(options.chatId == null
      ? {}
      : { chatId: requireProviderResourceString(options.chatId, 'chat ID', 512) })
  }
}

const requireRateLimitResetOptions = (
  value: unknown
): ProviderRateLimitResetOptions | undefined => {
  const options = requireSourceOptions(value)
  if (value == null) return options
  const creditId = (value as { creditId?: unknown }).creditId
  return {
    ...options,
    ...(creditId === undefined
      ? {}
      : {
          creditId: requireProviderResourceString(creditId, 'reset credit ID', 128)
        })
  }
}

const requireProviderUpdateOptions = (value: unknown): ProviderUpdateOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid provider update options')
  }

  const sourceOptions = requireSourceOptions(value) ?? {}
  const options = value as { stopActiveChats?: unknown }
  const stopActiveChats =
    options.stopActiveChats === undefined ? undefined : requireBoolean(options.stopActiveChats)

  return {
    ...sourceOptions,
    ...(stopActiveChats === undefined ? {} : { stopActiveChats })
  }
}

const requireProviderResourceUpdateOptions = (
  value: unknown
): ProviderResourceUpdateOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid provider resource update options')
  }

  const sourceOptions = requireSourceOptions(value) ?? {}
  const options = value as {
    deferRefresh?: unknown
    knownApp?: unknown
    knownSkills?: unknown
  }
  const deferRefresh =
    options.deferRefresh === undefined ? undefined : requireBoolean(options.deferRefresh)
  const knownApp = options.knownApp === undefined ? undefined : requireProviderApp(options.knownApp)
  if (
    options.knownSkills !== undefined &&
    (!Array.isArray(options.knownSkills) || options.knownSkills.length > 500)
  ) {
    throw new Error('Invalid known provider skills')
  }
  const knownSkills =
    options.knownSkills === undefined
      ? undefined
      : Array.from(
          new Map(
            options.knownSkills.map((skill) => {
              const requiredSkill = requireProviderSkill(skill)
              return [requiredSkill.path, requiredSkill]
            })
          ).values()
        )

  return {
    ...sourceOptions,
    ...(deferRefresh === undefined ? {} : { deferRefresh }),
    ...(knownApp === undefined ? {} : { knownApp }),
    ...(knownSkills === undefined ? {} : { knownSkills })
  }
}

const requireChatListOptions = (value: unknown): ProviderChatListOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid chat list options')
  }

  const options = value as {
    container?: unknown
    cursor?: unknown
    searchTerm?: unknown
    done?: unknown
    limit?: unknown
    projectCwd?: unknown
  }
  const container =
    options.container === undefined ? undefined : requireContainerTarget(options.container)
  const cursor = options.cursor
  if (cursor != null && typeof cursor !== 'string') throw new Error('Invalid chat list cursor')
  const searchTerm = options.searchTerm
  if (searchTerm !== undefined && (typeof searchTerm !== 'string' || !searchTerm.trim())) {
    throw new Error('Invalid chat search term')
  }

  const done = options.done
  if (done != null && typeof done !== 'boolean') throw new Error('Invalid chat done filter')

  const limit = options.limit
  if (
    limit != null &&
    (!Number.isInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > 100)
  ) {
    throw new Error('Invalid chat list limit')
  }

  const projectCwd = options.projectCwd
  if (projectCwd != null && (typeof projectCwd !== 'string' || !projectCwd.trim())) {
    throw new Error('Invalid chat project filter')
  }

  return {
    ...(container !== undefined ? { container } : {}),
    cursor: cursor ?? null,
    ...(typeof searchTerm === 'string' ? { searchTerm } : {}),
    ...(typeof done === 'boolean' ? { done } : {}),
    limit: limit ?? null,
    ...(typeof projectCwd === 'string' ? { projectCwd: projectCwd.trim() } : {})
  }
}

const requireUsageOptions = (value: unknown): ProviderUsageOptions | undefined => {
  if (value == null) return undefined
  const sourceOptions = requireSourceOptions(value)
  const options = value as { includeStatistics?: unknown }
  const includeStatistics = options.includeStatistics
  if (includeStatistics != null && typeof includeStatistics !== 'boolean') {
    throw new Error('Invalid usage statistics option')
  }

  return {
    ...sourceOptions,
    includeStatistics: includeStatistics ?? false
  }
}

const requireLimitResetTarget = (value: unknown): ProviderLimitResetTarget => {
  if (typeof value === 'string') return requireChatId(value)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid reset queue target')
  const { draftKey, worktree } = value as { draftKey?: unknown; worktree?: unknown }
  if (
    typeof draftKey !== 'string' ||
    !draftKey ||
    draftKey.length > 8192 ||
    draftKey.includes('\0')
  )
    throw new Error('Invalid reset draft key')
  return { draftKey, ...(worktree === undefined ? {} : { worktree: requireBoolean(worktree) }) }
}

const requireQueuedMessage = (value: unknown): string => {
  const prompt = requireMessage(value).trim()
  if (!prompt) throw new Error('Cannot queue an empty message')
  return prompt
}

const requireMessage = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Invalid message')
  return value
}

const requireGoalObjective = (value: unknown): string | null => {
  if (value !== null && typeof value !== 'string') throw new Error('Invalid goal objective')
  return value
}

const requireChatTitle = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Invalid chat title')
  const title = value.trim()
  if (!title || title.length > 100) throw new Error('Chat title must be 1–100 characters')
  return title
}

const providerImageExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const maxProviderAttachmentCount = 10
const maxProviderSkillCount = 20
const maxReviewCommentCount = 200
const maxReviewPathLength = 4_096
const maxReviewCommentLength = 20_000

const requireReview = (value: unknown): ProviderReview | undefined => {
  if (value == null) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid review')
  }

  const review = value as {
    id?: unknown
    prompt?: unknown
    comments?: unknown
  }
  if (
    typeof review.id !== 'string' ||
    !/^[A-Za-z0-9:_-]{1,200}$/.test(review.id) ||
    typeof review.prompt !== 'string' ||
    review.prompt.length > maxReviewCommentLength ||
    !Array.isArray(review.comments) ||
    review.comments.length === 0 ||
    review.comments.length > maxReviewCommentCount
  ) {
    throw new Error('Invalid review')
  }

  const comments: ProviderReview['comments'] = review.comments.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid review comment')
    }

    const { id, path, comment, line, endLine, side } = candidate as {
      id?: unknown
      path?: unknown
      comment?: unknown
      line?: unknown
      endLine?: unknown
      side?: unknown
    }
    if (
      typeof id !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(id) ||
      typeof path !== 'string' ||
      path.length === 0 ||
      path.length > maxReviewPathLength ||
      path.includes('\0') ||
      typeof comment !== 'string' ||
      comment.trim().length === 0 ||
      comment.length > maxReviewCommentLength ||
      typeof line !== 'number' ||
      !Number.isInteger(line) ||
      line < 1 ||
      line > 10_000_000 ||
      (endLine !== undefined &&
        (typeof endLine !== 'number' ||
          !Number.isInteger(endLine) ||
          endLine < line ||
          endLine > 10_000_000)) ||
      (side !== 'old' && side !== 'new')
    ) {
      throw new Error('Invalid review comment')
    }

    return { id, path, comment: comment.trim(), line, endLine, side }
  })

  return { id: review.id, prompt: review.prompt, comments }
}

const requireImageInputs = (value: unknown): ProviderImageInput[] | undefined => {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > maxProviderAttachmentCount) {
    throw new Error('Invalid image inputs')
  }

  const paths = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid image input')
    }

    const path = (candidate as { path?: unknown }).path
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      path.includes('\0') ||
      !providerImageExtensions.has(extname(path).toLocaleLowerCase())
    ) {
      throw new Error('Invalid image input')
    }
    paths.add(path)
  }

  return Array.from(paths, (path) => ({ path }))
}

const requireFileInputs = (value: unknown): ProviderFileInput[] | undefined => {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > maxProviderAttachmentCount) {
    throw new Error('Invalid file inputs')
  }

  const paths = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid file input')
    }

    const path = (candidate as { path?: unknown }).path
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
      throw new Error('Invalid file input')
    }
    paths.add(path)
  }

  return Array.from(paths, (path) => ({ path }))
}

const requireSkillInputs = (value: unknown): ProviderSkillInput[] | undefined => {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > maxProviderSkillCount) {
    throw new Error('Invalid skill inputs')
  }

  const skills = new Map<string, ProviderSkillInput>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Invalid skill input')
    }

    const { name, path } = candidate as { name?: unknown; path?: unknown }
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 256 ||
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      path.includes('\0')
    ) {
      throw new Error('Invalid skill input')
    }
    skills.set(path, { name: name.trim(), path })
  }

  return Array.from(skills.values())
}

const requireTurnOptions = (value: unknown): ProviderTurnOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid turn options')

  const options = value as {
    promptSuggestions?: unknown
    additionalDirectories?: unknown
    networkRetry?: unknown
    usageResetContinuation?: unknown
    agentMode?: unknown
    approvalPolicy?: unknown
    approvalsReviewer?: unknown
    container?: unknown
    cwd?: unknown
    noProject?: unknown
    files?: unknown
    images?: unknown
    model?: unknown
    reasoningEffort?: unknown
    serviceTier?: unknown
    review?: unknown
    sandboxMode?: unknown
    showRecommendedPlugins?: unknown
    skills?: unknown
  }
  let networkRetry: NetworkRetrySettings | undefined
  if (options.networkRetry !== undefined) {
    const value = options.networkRetry
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid network retry settings')
    const candidate = value as Partial<NetworkRetrySettings>
    networkRetry = normalizeNetworkRetrySettings(candidate)
    if (
      candidate.count !== networkRetry.count ||
      candidate.delaySeconds !== networkRetry.delaySeconds
    ) {
      throw new Error('Invalid network retry settings')
    }
  }
  let usageResetContinuation: ProviderTurnOptions['usageResetContinuation']
  if (options.usageResetContinuation !== undefined) {
    const value = options.usageResetContinuation
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('prompt' in value) ||
      typeof value.prompt !== 'string' ||
      !value.prompt.trim()
    )
      throw new Error('Invalid usage reset continuation')
    usageResetContinuation = { prompt: value.prompt.trim() }
  }
  const agentMode = options.agentMode
  if (agentMode != null && !isProviderAgentMode(agentMode)) {
    throw new Error('Invalid agent mode')
  }

  const approvalPolicy = options.approvalPolicy
  if (!isProviderApprovalPolicy(approvalPolicy)) throw new Error('Invalid approval policy')

  const approvalsReviewer = options.approvalsReviewer ?? 'user'
  if (!isProviderApprovalsReviewer(approvalsReviewer)) {
    throw new Error('Invalid approvals reviewer')
  }

  const sandboxMode = options.sandboxMode
  if (!isProviderSandboxMode(sandboxMode)) throw new Error('Invalid sandbox mode')

  const showRecommendedPlugins = options.showRecommendedPlugins
  if (showRecommendedPlugins != null && typeof showRecommendedPlugins !== 'boolean') {
    throw new Error('Invalid recommended plugins setting')
  }

  const cwd = options.cwd
  if (cwd != null && (typeof cwd !== 'string' || !isAbsolute(cwd))) {
    throw new Error('Invalid cwd')
  }

  let additionalDirectories: string[] | undefined
  if (options.additionalDirectories !== undefined) {
    if (
      !Array.isArray(options.additionalDirectories) ||
      options.additionalDirectories.length > 32
    ) {
      throw new Error('Invalid additional directories')
    }

    const uniqueDirectories = new Set<string>()
    for (const directory of options.additionalDirectories) {
      if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) {
        throw new Error('Invalid additional directory')
      }
      if (directory !== cwd) uniqueDirectories.add(directory)
    }
    additionalDirectories = Array.from(uniqueDirectories)
  }

  const model = options.model ?? 'gpt-5.5'
  if (!isProviderModelId(model)) throw new Error('Invalid model')

  const reasoningEffort = options.reasoningEffort
  if (reasoningEffort != null && !isProviderReasoningEffort(reasoningEffort)) {
    throw new Error('Invalid reasoning effort')
  }

  const serviceTier = options.serviceTier
  if (serviceTier != null && !isProviderServiceTier(serviceTier)) {
    throw new Error('Invalid service tier')
  }

  const files = requireFileInputs(options.files)
  const images = requireImageInputs(options.images)
  if ((files?.length ?? 0) + (images?.length ?? 0) > maxProviderAttachmentCount) {
    throw new Error('Invalid attachment inputs')
  }

  return {
    ...(options.promptSuggestions === undefined
      ? {}
      : { promptSuggestions: requireBoolean(options.promptSuggestions) }),
    additionalDirectories,
    ...(networkRetry ? { networkRetry } : {}),
    ...(usageResetContinuation ? { usageResetContinuation } : {}),
    ...(agentMode == null ? {} : { agentMode }),
    approvalPolicy,
    approvalsReviewer,
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: cwd ?? undefined,
    ...(options.noProject === undefined ? {} : { noProject: requireBoolean(options.noProject) }),
    files,
    images,
    model,
    ...(reasoningEffort == null ? {} : { reasoningEffort }),
    serviceTier: serviceTier ?? null,
    review: requireReview(options.review),
    sandboxMode,
    showRecommendedPlugins: showRecommendedPlugins === true,
    skills: requireSkillInputs(options.skills)
  }
}

const requireStartChatOptions = (value: unknown): ProviderStartChatOptions | undefined => {
  const options = requireTurnOptions(value)
  if (!options) return options
  const initialGoal = (value as { initialGoal?: unknown }).initialGoal
  if (initialGoal === undefined) return options
  if (typeof initialGoal !== 'string' || !initialGoal.trim())
    throw new Error('Invalid initial goal objective')
  return { ...options, initialGoal: initialGoal.trim() }
}

const requireOneShotOptions = (value: unknown): ProviderOneShotOptions | undefined => {
  const options = requireTurnOptions(value)
  if (!options) return options
  const generationId = (value as { generationId?: unknown }).generationId
  return generationId == null
    ? options
    : { ...options, generationId: requireGenerationId(generationId) }
}

const requireQueuedTurnOptions = (value: unknown): ProviderStartChatOptions => {
  const options = requireStartChatOptions(value)
  if (!options) throw new Error('Message options are required')
  return options
}

const requirePermissionOptions = (value: unknown): ProviderPermissionOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid permission options')
  }
  const options = value as ProviderPermissionOptions
  if (!isProviderApprovalPolicy(options.approvalPolicy)) throw new Error('Invalid approval policy')
  if (!isProviderApprovalsReviewer(options.approvalsReviewer))
    throw new Error('Invalid approvals reviewer')
  if (!isProviderSandboxMode(options.sandboxMode)) throw new Error('Invalid sandbox mode')
  const directories = options.additionalDirectories
  if (
    directories !== undefined &&
    (!Array.isArray(directories) ||
      directories.length > 32 ||
      directories.some(
        (directory) =>
          typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')
      ))
  )
    throw new Error('Invalid additional directories')
  return {
    approvalPolicy: options.approvalPolicy,
    approvalsReviewer: options.approvalsReviewer,
    sandboxMode: options.sandboxMode,
    additionalDirectories: directories
  }
}

type ProviderOperation = keyof ProviderApi & keyof typeof providerIpcChannels

type ArgumentValidators<Arguments extends unknown[]> = {
  [Index in keyof Arguments]-?: (value: unknown) => Arguments[Index]
}

const forwardOperations = <Operation extends ProviderOperation>(
  operations: { [Name in Operation]: ArgumentValidators<Parameters<ProviderApi[Name]>> },
  respond: (call: () => ReturnType<ProviderApi[Operation]>) => unknown,
  channels: Record<Operation, string> = providerIpcChannels
): void => {
  for (const operation of Object.keys(operations) as Operation[]) {
    const validators: ((value: unknown) => unknown)[] = operations[operation]
    handleClientRequest(channels[operation], (_, ...values) =>
      respond(() =>
        (providerApi[operation] as (...args: unknown[]) => ReturnType<ProviderApi[Operation]>)(
          ...validators.map((validate, index) => validate(values[index]))
        )
      )
    )
  }
}

const prepareLoadedTurnItems = (detail: ProviderChatDetail) =>
  prepareChatItemsForRenderer(
    unloadHistoricalWorkingSteps(detail).items.map((item) =>
      item.type === 'message' || item.type === 'pendingMessage'
        ? { ...item, contentLoaded: true }
        : item
    )
  )

const summarizedOperations = {
  continueChat: [requireProviderId, requireChatId, requireMessage, requireTurnOptions],
  sendActiveChatMessage: [
    requireProviderId,
    requireChatId,
    requireMessage,
    requireActiveSendMode,
    requireTurnOptions
  ]
} satisfies {
  [Name in 'continueChat' | 'sendActiveChatMessage']: ArgumentValidators<
    Parameters<ProviderApi[Name]>
  >
}

export const registerProviderIpc = (): void => {
  onChatMetadataChanged((metadata) => {
    metadata.forEach((value) => latestMetadata.set(value.id, value))
    chatUpdateClients.forEach((client) => {
      if (!client.isDestroyed() && chatUpdateDeliveryByClientId.get(client.id)?.ready)
        client.send(providerIpcChannels.chatMetadataUpdated, metadata)
    })
  })
  startLimitResetQueue()
  providerApi.onChatUpdated((event) => {
    chatUpdateClients.forEach((client) => {
      queueChatUpdateForWindow(client, event)
    })
  })

  onClientMessage(providerIpcChannels.chatUpdatesReady, (event) => {
    const state = getChatUpdateDeliveryState(event.sender)
    // React/HMR can replace a listener without a successful teardown. Never let
    // the new consumer inherit an old in-flight sequence or transcript delta base.
    resetChatUpdateAcknowledgment(state)
    state.ready = true
    setChatUpdateInterest(event.sender.id, state.viewedChatKey)
    sendNextChatUpdate(event.sender, state)
  })

  onClientMessage(providerIpcChannels.chatUpdatesStopped, (event) => {
    const state = getChatUpdateDeliveryState(event.sender)
    suspendChatUpdateDelivery(event.sender, state)
  })

  onClientMessage(
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
        setChatUpdateInterest(event.sender.id, state.ready ? nextViewedChatKey : null)
      } catch (error) {
        console.error('[caught:registerProviderIpc:registerProviderIpc]', error)
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

  onClientMessage(
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

      if (
        detailAppliedValue &&
        inFlightUpdate.detail &&
        state.viewedChatKey === inFlightUpdate.chatKey
      ) {
        state.acknowledgedDetail = {
          chatKey: inFlightUpdate.chatKey,
          detail: inFlightUpdate.detail
        }
      } else if (state.acknowledgedDetail?.chatKey === inFlightUpdate.chatKey) {
        state.acknowledgedDetail = null
      }

      clearChatAcknowledgmentTimer(state)
      state.inFlightUpdate = null
      sendNextChatUpdate(event.sender, state)
    }
  )

  forwardOperations(
    {
      login: [requireProviderId, requireSourceOptions],
      getAccounts: [requireProviderId, requireSourceOptions],
      cancelAccountCreation: [
        requireProviderId,
        requireAccountId,
        requireOptionalLoginId,
        requireSourceOptions
      ],
      submitAccountLoginCode: [
        requireProviderId,
        requireLoginId,
        requireAuthorizationCode,
        requireSourceOptions
      ],
      getUpdateAvailability: [requireProviderId, requireSourceOptions],
      getProviderUpdateImpact: [requireProviderId, requireSourceOptions],
      updateProvider: [requireProviderId, requireProviderUpdateOptions],
      getApprovalModes: [requireProviderId],
      getSandboxModes: [requireProviderId],
      getAgentModes: [requireProviderId, requireSourceOptions],
      getModels: [requireProviderId, requireSourceOptions],
      getSkills: [requireProviderId, requireOptionalCwd, requireSourceOptions],
      getConnections: [requireProviderId, requireSourceOptions],
      connectProvider: [requireProviderId, requireConnectionInput, requireSourceOptions],
      getConnectionAttempt: [requireProviderId, requireConnectionString, requireSourceOptions],
      cancelConnection: [requireProviderId, requireConnectionString, requireSourceOptions],
      getConfig: [requireProviderId, requireSourceOptions],
      getApps: [requireProviderId, requireSourceOptions],
      getTokenUsage: [requireProviderId, requireOptionalChatId, requireSourceOptions],
      resetRateLimits: [requireProviderId, requireRateLimitResetOptions],
      getChatContainers: [],
      getChatTerminalTasks: [requireProviderId, requireChatId],
      getSubagents: [requireProviderId, requireChatId],
      cancelSubagent: [requireProviderId, requireChatId, requireChatId],
      sendSubagentMessage: [requireProviderId, requireChatId, requireChatId, requireMessage],
      setChatGoal: [requireProviderId, requireChatId, requireGoalObjective],
      generateOneShot: [requireProviderId, requireMessage, requireOneShotOptions],
      cancelOneShot: [requireProviderId, requireGenerationId],
      getLimitResetMessages: [requireProviderId, requireLimitResetTarget],
      deleteLimitResetMessage: [requireProviderId, requireLimitResetTarget, requireMessageId],
      prepareLinkedChatContext: [requireProviderId, requireChatId, requireLinkedChatContextOptions],
      cancelLinkedChatContext: [requireLinkedChatOperationId],
      markChatDone: [requireProviderId, requireChatId, requireDone],
      markChatsDone: [requireChatIds],
      getCwdNotes: [requireProviderId, requireOptionalCwd],
      markChatSeen: [requireProviderId, requireChatId, requireTimestamp],
      setChatPinned: [requireProviderId, requireChatId, requireBoolean],
      setChatOrder: [requireChatIds],
      addLimitResetMessage: [
        requireProviderId,
        requireLimitResetTarget,
        requireQueuedMessage,
        requireQueuedTurnOptions
      ],
      updateChatPermissions: [requireProviderId, requireChatId, requirePermissionOptions]
    },
    (call) => call()
  )

  forwardOperations(
    {
      reauthenticateAccount: [requireProviderId, requireSourceOptions],
      createAccount: [requireProviderId, requireSourceOptions],
      completeAccountCreation: [
        requireProviderId,
        requireAccountId,
        requireOptionalLoginId,
        requireSourceOptions
      ],
      useAccount: [requireProviderId, requireAccountId, requireSourceOptions],
      deleteAccount: [requireProviderId, requireAccountId, requireSourceOptions],
      completeConnection: [
        requireProviderId,
        requireConnectionString,
        requireConnectionString,
        requireSourceOptions
      ],
      deleteConnection: [requireProviderId, requireConnectionString, requireSourceOptions],
      setSkillEnabled: [
        requireProviderId,
        requireProviderSkillPath,
        requireBoolean,
        requireOptionalCwd,
        requireProviderResourceUpdateOptions
      ],
      setSkillsEnabled: [
        requireProviderId,
        requireProviderSkillPaths,
        requireBoolean,
        requireOptionalCwd,
        requireProviderResourceUpdateOptions
      ],
      setAppEnabled: [
        requireProviderId,
        requireProviderAppId,
        requireBoolean,
        requireProviderResourceUpdateOptions
      ],
      setCwdNotes: [requireProviderId, requireOptionalCwd, requireCwdNotes],
      setConfigValue: [
        requireProviderId,
        requireConfigName('Invalid setting path'),
        requireConfigPath,
        // The adapter validates values against the schema before writing.
        (value) => value as ProviderConfigValue,
        requireSourceOptions
      ],
      setConfigFeature: [
        requireProviderId,
        requireConfigName('Invalid feature name'),
        requireBoolean,
        requireSourceOptions
      ]
    },
    (call) => withWorkspaceUpdate<unknown>(call())
  )

  forwardOperations(
    {
      setChatTitle: [requireProviderId, requireChatId, requireChatTitle],
      startChat: [
        requireProviderId,
        requireMessage,
        requireStartChatOptions,
        requireOptionalChatPurpose
      ],
      ...summarizedOperations,
      continueChatInFork: [
        requireProviderId,
        requireChatId,
        requireMessage,
        requireChatPurpose,
        requireTurnOptions
      ],
      forkChat: [requireProviderId, requireChatId, requireMessageId],
      deletePendingMessage: [requireProviderId, requireChatId, requireMessageId],
      steerPendingMessage: [requireProviderId, requireChatId, requireMessageId],
      interruptPendingMessage: [requireProviderId, requireChatId, requireMessageId],
      editMessage: [
        requireProviderId,
        requireChatId,
        requireMessageId,
        requireMessage,
        requireTurnOptions
      ],
      compactChat: [requireProviderId, requireChatId],
      stopChat: [requireProviderId, requireChatId],
      resolveApproval: [requireProviderId, requireChatId, requireApprovalDecision],
      resolveUserInput: [
        requireProviderId,
        requireChatId,
        requireMessageId,
        requireUserInputResponse,
        requireTurnOptions
      ]
    },
    getRendererChatDetail
  )

  handleClientRequest(providerIpcChannels.getUsage, (_, providerId: unknown, options: unknown) => {
    const requiredProviderId = requireProviderId(providerId)
    const requiredOptions = requireUsageOptions(options)
    return runShutdownTolerantProviderRead(
      () => providerApi.getUsage(requiredProviderId, requiredOptions),
      getEmptyProviderAccountUsage
    )
  })

  handleClientRequest(
    providerIpcChannels.getKnownChats,
    (_, providerId: unknown, options: unknown) =>
      getProviderKnownChats(requireProviderId(providerId), requireChatListOptions(options))
  )

  handleClientRequest(providerIpcChannels.getChats, (_, providerId: unknown, options: unknown) => {
    const requiredProviderId = requireProviderId(providerId)
    const requiredOptions = requireChatListOptions(options)
    return runShutdownTolerantProviderRead(
      () => providerApi.getChats(requiredProviderId, requiredOptions),
      getEmptyProviderChatPage
    )
  })

  handleClientRequest(
    providerIpcChannels.getCachedChat,
    (_, providerId: unknown, chatId: unknown, options: unknown) =>
      getProviderCachedChat(
        requireProviderId(providerId),
        requireChatId(chatId),
        options && typeof options === 'object' && 'opening' in options
          ? {
              ...requireSourceOptions(options),
              opening: requireBoolean(options.opening)
            }
          : requireSourceOptions(options)
      ).catch((error: unknown) => {
        console.warn('Unable to read prepared chat history.', error)
        return null
      })
  )

  handleClientRequest(
    providerIpcChannels.getChat,
    async (_, providerId: unknown, chatId: unknown) => {
      const requiredProviderId = requireProviderId(providerId)
      const requiredChatId = requireChatId(chatId)
      const historyRead = await beginProviderChatHistoryRead(requiredProviderId, requiredChatId)
      const viewScope = await beginProviderConversationRead(requiredProviderId, requiredChatId)
      const detail = await getRendererChatDetail(() =>
        // Codex getChat includes the opening-time writer check and already reads a bounded
        // cursor page. History-only reads deliberately do not acquire/probe writer access.
        requiredProviderId === 'codex'
          ? providerApi.getChat(requiredProviderId, requiredChatId)
          : getProviderChatWindow(requiredProviderId, requiredChatId, {
              startIndex: null,
              limit: rendererChatTurnPageSize
            })
      )
      saveProviderChatHistory(historyRead, detail)
      await saveProviderConversationView(viewScope, detail)
      return detail
    }
  )

  handleClientRequest(
    providerIpcChannels.getSubagent,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      subagentId: unknown,
      requestedWindow?: unknown
    ): Promise<ProviderSubagentDetail> => {
      const requested =
        requestedWindow && typeof requestedWindow === 'object'
          ? (requestedWindow as Record<string, unknown>)
          : {}
      const window = {
        startIndex:
          requested.startIndex === undefined || requested.startIndex === null
            ? null
            : requireChatTurnStartIndex(requested.startIndex),
        limit:
          requested.limit === undefined
            ? providerSubagentTurnPageSize
            : requireChatTurnLimit(requested.limit)
      }
      const cursor = requested.cursor
      if (cursor !== undefined && (typeof cursor !== 'string' || !cursor))
        throw new Error('Invalid subagent history cursor')
      if (cursor !== undefined)
        Object.assign(window, {
          cursor,
          direction: requested.direction === 'newer' ? 'newer' : 'older'
        })
      const detail = await providerApi.getSubagent(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireChatId(subagentId),
        window
      )
      const windowed = detail.turnCount !== undefined && detail.itemsStartTurnIndex !== undefined
      if (!windowed) {
        const totalCount = getProviderChatTurnCount(detail.items)
        const boundedStart =
          window.startIndex === null
            ? Math.max(0, totalCount - window.limit)
            : Math.min(window.startIndex, totalCount)
        const page = prepareChatDetailForRenderer({
          ...detail,
          items: sliceProviderChatTurns(detail.items, boundedStart, boundedStart + window.limit),
          itemsStartTurnIndex: boundedStart,
          turnCount: totalCount
        })
        return {
          ...detail,
          items: page.items,
          itemsStartTurnIndex: boundedStart,
          turnCount: totalCount
        }
      }
      const prepared = prepareChatDetailForRenderer(detail)
      return {
        ...detail,
        items: prepared.items,
        itemsStartTurnIndex: prepared.itemsStartTurnIndex,
        turnCount: prepared.turnCount
      }
    }
  )

  handleClientRequest(
    providerIpcChannels.getChatWorkingStepPage,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      workingStepId: unknown,
      startIndex: unknown,
      limit: unknown,
      rootChatId?: unknown
    ): Promise<ProviderWorkingStepPage> =>
      prepareWorkingStepPage(
        await readWorkingStep(providerId, chatId, workingStepId, rootChatId),
        requireChatTurnStartIndex(startIndex),
        requireWorkingItemLimit(limit)
      )
  )

  handleClientRequest(
    providerIpcChannels.getChatWorkingItem,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      workingStepId: unknown,
      workingItemId: unknown,
      rootChatId?: unknown
    ): Promise<ProviderWorkingItem> => {
      const requiredWorkingItemId = requireMessageId(workingItemId)
      const workingStep = await readWorkingStep(providerId, chatId, workingStepId, rootChatId)
      const workingItem =
        workingStep.items.find((item) => item.id === requiredWorkingItemId) ??
        workingStep.items
          .flatMap((item) => (item.type === 'toolGroup' ? item.tools : []))
          .find((tool) => tool.id === requiredWorkingItemId)
      if (!workingItem) throw new Error('Working item not found')
      return limitWorkingItemPayload(workingItem)
    }
  )

  handleClientRequest(
    providerIpcChannels.getChatWorkingToolPage,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      workingStepId: unknown,
      workingItemId: unknown,
      startIndex: unknown,
      limit: unknown,
      rootChatId?: unknown
    ): Promise<ProviderWorkingToolPage> =>
      prepareWorkingToolPage(
        await readWorkingStep(providerId, chatId, workingStepId, rootChatId),
        requireMessageId(workingItemId),
        requireChatTurnStartIndex(startIndex),
        requireWorkingItemLimit(limit)
      )
  )

  handleClientRequest(
    providerIpcChannels.getChatTurnPage,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      startIndex: unknown,
      limit: unknown
    ): Promise<ProviderChatTurnPage> => {
      const requiredProviderId = requireProviderId(providerId)
      const requiredChatId = requireChatId(chatId)
      const requestedStartIndex = requireChatTurnStartIndex(startIndex)
      const requiredLimit = requireChatTurnLimit(limit)
      const detail = await getProviderChatWindow(requiredProviderId, requiredChatId, {
        startIndex: requestedStartIndex,
        limit: requiredLimit
      })
      const totalCount = detail.turnCount ?? getProviderChatTurnCount(detail.items)
      const requiredStartIndex =
        detail.itemsStartTurnIndex ?? Math.min(requestedStartIndex, totalCount)

      return {
        items: prepareLoadedTurnItems(detail),
        subagents: detail.subagents,
        startIndex: requiredStartIndex,
        totalCount
      }
    }
  )

  handleClientRequest(
    providerIpcChannels.getChatTurnCursorPage,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      direction: unknown,
      cursor: unknown,
      limit: unknown
    ): Promise<ProviderChatTurnPage> => {
      const detail = await getProviderChatCursorWindow(
        requireProviderId(providerId),
        requireChatId(chatId),
        {
          direction: requireChatTurnCursorDirection(direction),
          cursor: requireChatTurnCursor(cursor),
          limit: requireChatTurnLimit(limit)
        }
      )
      const items = prepareLoadedTurnItems(detail)

      return {
        items,
        subagents: detail.subagents,
        startIndex: 0,
        totalCount: getProviderChatTurnCount(items),
        turnPagination: detail.turnPagination
      }
    }
  )

  handleClientRequest(
    providerIpcChannels.getChatTurnPageForItem,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      itemId: unknown,
      limit: unknown
    ): Promise<ProviderChatTurnPage> => {
      const detail = await getProviderChatItemWindow(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(itemId),
        requireChatTurnLimit(limit)
      )
      const totalCount = detail.turnCount ?? getProviderChatTurnCount(detail.items)
      const pageDetail = unloadHistoricalWorkingSteps(detail)
      return {
        items: prepareChatItemsForRenderer(pageDetail.items),
        subagents: detail.subagents,
        startIndex: detail.itemsStartTurnIndex ?? 0,
        totalCount,
        turnPagination: detail.turnPagination
      }
    }
  )

  forwardOperations(
    summarizedOperations,
    async (call) => getChatUpdateSummary(await call(), Date.now()),
    {
      continueChat: providerIpcChannels.continueChatSummary,
      sendActiveChatMessage: providerIpcChannels.sendActiveChatMessageSummary
    }
  )

  // Renderer ownership makes abandoned edits resumable after a window closes or crashes.
  const pendingEdits = new Map<
    number,
    Map<
      string,
      {
        providerId: ProviderId
        chatId: string
        messageId: string
        ready: Promise<ProviderChatDetail>
      }
    >
  >()
  const editOwners = new Set<number>()
  const forgetPendingEdit = (ownerId: number, editId: string): void => {
    pendingEdits.get(ownerId)?.delete(editId)
  }
  handleClientRequest(
    providerIpcChannels.beginPendingMessageEdit,
    async (event, provider: unknown, chat: unknown, message: unknown, token: unknown) => {
      const providerId = requireProviderId(provider)
      const chatId = requireChatId(chat)
      const messageId = requireMessageId(message)
      const editId = requireMessageId(token)
      const ownerId = event.sender.id
      if (!editOwners.has(ownerId)) {
        editOwners.add(ownerId)
        const release = (): void => {
          const edits = pendingEdits.get(ownerId)
          pendingEdits.delete(ownerId)
          for (const [id, edit] of edits ?? []) {
            void edit.ready
              .then(() =>
                providerApi.cancelPendingMessageEdit(
                  edit.providerId,
                  edit.chatId,
                  edit.messageId,
                  id
                )
              )
              .catch((error) => console.error('Unable to release abandoned message edit.', error))
          }
        }
        event.sender.on('render-process-gone', release)
        event.sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
          if (isMainFrame && !isInPlace) release()
        })
        event.sender.once('destroyed', () => {
          release()
          editOwners.delete(ownerId)
        })
      }
      const edits = pendingEdits.get(ownerId) ?? new Map()
      pendingEdits.set(ownerId, edits)
      const ready = providerApi.beginPendingMessageEdit(providerId, chatId, messageId, editId)
      edits.set(editId, { providerId, chatId, messageId, ready })
      try {
        return await getRendererChatDetail(() => ready)
      } catch (error) {
        forgetPendingEdit(ownerId, editId)
        void providerApi
          .cancelPendingMessageEdit(providerId, chatId, messageId, editId)
          .catch((releaseError) =>
            console.error('Unable to release failed pending edit.', releaseError)
          )
        // A queued or steering message can start delivery while its editor is still opening.
        // The message is now an ordinary pending message, so report the chat instead of failing.
        const settled = await getRendererChatDetail(() =>
          providerApi.getChat(providerId, chatId)
        ).catch(() => null)
        const pending = settled?.items.find(
          (item): item is ProviderPendingMessage =>
            item.type === 'pendingMessage' && item.id === messageId
        )
        if (settled && (!pending || pending.editable === false)) return settled
        throw error
      }
    }
  )
  handleClientRequest(
    providerIpcChannels.cancelPendingMessageEdit,
    async (event, provider: unknown, chat: unknown, message: unknown, token: unknown) => {
      const editId = requireMessageId(token)
      const detail = await getRendererChatDetail(() =>
        providerApi.cancelPendingMessageEdit(
          requireProviderId(provider),
          requireChatId(chat),
          requireMessageId(message),
          editId
        )
      )
      forgetPendingEdit(event.sender.id, editId)
      return detail
    }
  )

  handleClientRequest(
    providerIpcChannels.editPendingMessage,
    (
      event,
      providerId: unknown,
      chatId: unknown,
      messageId: unknown,
      message: unknown,
      options: unknown,
      token: unknown
    ) => {
      const editId = token === undefined ? undefined : requireMessageId(token)
      return getRendererChatDetail(() =>
        providerApi.editPendingMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId),
          requireMessage(message),
          requireTurnOptions(options),
          editId
        )
      ).then((detail) => {
        if (editId) forgetPendingEdit(event.sender.id, editId)
        return detail
      })
    }
  )
}
