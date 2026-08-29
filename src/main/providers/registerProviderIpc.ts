import { extname, isAbsolute } from 'node:path'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import type {
  ProviderApprovalDecision,
  ProviderActiveSendMode,
  ProviderAccountUsage,
  ProviderChatDetail,
  ProviderChatDetailUpdate,
  ProviderChatItem,
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatPurpose,
  ProviderChatUpdatedEvent,
  ProviderChatTurnPage,
  ProviderCwdNote,
  ProviderFileInput,
  ProviderId,
  ProviderImageInput,
  ProviderOneShotOptions,
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
  ProviderUserInputResponse,
  ProviderUsageOptions,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingStepPage,
  ProviderWorkingToolPage,
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
  isProviderServiceTier,
  providerIpcChannels
} from '../../shared/provider'
import { requireContainerTarget } from '../containerTarget'
import { getProviderChatTurnCount } from '../../shared/chatTurns'
import { getChatUpdateSummary, getProviderChatWindow, providerApi } from './providerService'
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
let providerIpcShuttingDown = false

export const beginProviderIpcShutdown = (): void => {
  providerIpcShuttingDown = true
  chatUpdateDeliveryByWebContentsId.clear()
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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
    if (isExpectedProviderBackgroundReadError(error)) return fallback(error)
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
  const changedTailStartIndex = matchingPreviousDetail
    ? getChangedTailStartIndex(
        matchingPreviousDetail.items,
        detail.items,
        (item) => item.type === 'working' && item.status === 'working'
      )
    : 0
  const firstPayloadStateChangeIndex = matchingPreviousDetail
    ? detail.items.findIndex((item, index) => {
        const previousItem = matchingPreviousDetail.items[index]
        if (!previousItem || previousItem.id !== item.id || previousItem.type !== item.type) {
          return false
        }
        if (item.type === 'message' || item.type === 'pendingMessage') {
          return (
            previousItem.type === item.type && previousItem.contentLoaded !== item.contentLoaded
          )
        }
        return (
          item.type === 'working' &&
          previousItem.type === 'working' &&
          previousItem.itemsLoaded !== item.itemsLoaded
        )
      })
    : -1
  const chatItemsStartIndex =
    firstPayloadStateChangeIndex >= 0
      ? Math.min(changedTailStartIndex, firstPayloadStateChangeIndex)
      : changedTailStartIndex
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

const getRendererChatDetail = async (
  read: () => Promise<ProviderChatDetail>
): Promise<ProviderChatDetail> => prepareChatDetailForRenderer(await read())

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
  const rendererDetail = update.detail ? prepareChatDetailForRenderer(update.detail) : null
  const detailUpdate = rendererDetail
    ? createChatDetailUpdate(rendererDetail, previousDetail)
    : null
  state.inFlightUpdate = {
    sequence,
    chatKey,
    detail: rendererDetail
  }
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

const requireUserInputResponse = (value: unknown): ProviderUserInputResponse => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid user input response')
  }

  const response = value as { kind?: unknown; answer?: unknown; wasFreeform?: unknown }
  if (response.kind === 'cancel') return { kind: 'cancel' }
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

const requireSourceOptions = (value: unknown): ProviderSourceOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid provider source options')
  }

  const options = value as { container?: unknown; forceRefresh?: unknown }
  const container =
    options.container === undefined ? undefined : requireContainerTarget(options.container)
  const forceRefresh =
    options.forceRefresh === undefined ? undefined : requireBoolean(options.forceRefresh)

  return {
    ...(container === undefined ? {} : { container }),
    ...(forceRefresh === undefined ? {} : { forceRefresh })
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

  const options = value as { container?: unknown; cursor?: unknown; limit?: unknown }
  const container =
    options.container === undefined ? undefined : requireContainerTarget(options.container)
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
    ...(container !== undefined ? { container } : {}),
    cursor: cursor ?? null,
    limit: limit ?? null
  }
}

const requireUsageOptions = (value: unknown): ProviderUsageOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid usage options')

  const options = value as { container?: unknown; includeStatistics?: unknown }
  const container =
    options.container === undefined ? undefined : requireContainerTarget(options.container)
  const includeStatistics = options.includeStatistics
  if (includeStatistics != null && typeof includeStatistics !== 'boolean') {
    throw new Error('Invalid usage statistics option')
  }

  return {
    ...(container !== undefined ? { container } : {}),
    includeStatistics: includeStatistics ?? false
  }
}

const requireMessage = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Invalid message')
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

  const review = value as { id?: unknown; prompt?: unknown; comments?: unknown }
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

    return {
      id,
      path,
      comment: comment.trim(),
      line,
      endLine: typeof endLine === 'number' ? endLine : undefined,
      side: side === 'old' ? 'old' : 'new'
    }
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
    additionalDirectories?: unknown
    approvalPolicy?: unknown
    approvalsReviewer?: unknown
    container?: unknown
    cwd?: unknown
    files?: unknown
    images?: unknown
    model?: unknown
    reasoningEffort?: unknown
    serviceTier?: unknown
    review?: unknown
    sandboxMode?: unknown
    skills?: unknown
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
    additionalDirectories,
    approvalPolicy,
    approvalsReviewer,
    container: requireContainerTarget(options.container, { optional: true }),
    cwd: cwd ?? undefined,
    files,
    images,
    model,
    ...(reasoningEffort == null ? {} : { reasoningEffort }),
    serviceTier: serviceTier ?? null,
    review: requireReview(options.review),
    sandboxMode,
    skills: requireSkillInputs(options.skills)
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

  ipcMain.handle(providerIpcChannels.login, (_, providerId: unknown, options: unknown) =>
    providerApi.login(requireProviderId(providerId), requireSourceOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getAccounts, (_, providerId: unknown, options: unknown) =>
    providerApi.getAccounts(requireProviderId(providerId), requireSourceOptions(options))
  )

  ipcMain.handle(
    providerIpcChannels.createAccount,
    (_, providerId: unknown, name: unknown, options: unknown) =>
      providerApi.createAccount(
        requireProviderId(providerId),
        requireProviderResourceString(name, 'account name', 80),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.completeAccountCreation,
    (_, providerId: unknown, accountId: unknown, loginId: unknown, options: unknown) =>
      providerApi.completeAccountCreation(
        requireProviderId(providerId),
        requireProviderResourceString(accountId, 'account ID', 128),
        requireOptionalProviderResourceString(loginId, 'login ID', 128),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.cancelAccountCreation,
    (_, providerId: unknown, accountId: unknown, loginId: unknown, options: unknown) =>
      providerApi.cancelAccountCreation(
        requireProviderId(providerId),
        requireProviderResourceString(accountId, 'account ID', 128),
        requireOptionalProviderResourceString(loginId, 'login ID', 128),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.useAccount,
    (_, providerId: unknown, accountId: unknown, options: unknown) =>
      providerApi.useAccount(
        requireProviderId(providerId),
        requireProviderResourceString(accountId, 'account ID', 128),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.deleteAccount,
    (_, providerId: unknown, accountId: unknown, options: unknown) =>
      providerApi.deleteAccount(
        requireProviderId(providerId),
        requireProviderResourceString(accountId, 'account ID', 128),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.getUpdateAvailability,
    (_, providerId: unknown, options: unknown) =>
      providerApi.getUpdateAvailability(
        requireProviderId(providerId),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(providerIpcChannels.updateProvider, (_, providerId: unknown, options: unknown) =>
    providerApi.updateProvider(requireProviderId(providerId), requireSourceOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getApprovalModes, (_, providerId: unknown) =>
    providerApi.getApprovalModes(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getSandboxModes, (_, providerId: unknown) =>
    providerApi.getSandboxModes(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getModels, (_, providerId: unknown, options: unknown) =>
    providerApi.getModels(requireProviderId(providerId), requireSourceOptions(options))
  )

  ipcMain.handle(
    providerIpcChannels.getSkills,
    (_, providerId: unknown, cwd: unknown, options: unknown) =>
      providerApi.getSkills(
        requireProviderId(providerId),
        requireOptionalCwd(cwd),
        requireSourceOptions(options)
      )
  )

  ipcMain.handle(providerIpcChannels.getApps, (_, providerId: unknown, options: unknown) =>
    providerApi.getApps(requireProviderId(providerId), requireSourceOptions(options))
  )

  ipcMain.handle(
    providerIpcChannels.setSkillEnabled,
    (_, providerId: unknown, path: unknown, enabled: unknown, cwd: unknown, options: unknown) =>
      providerApi.setSkillEnabled(
        requireProviderId(providerId),
        requireProviderSkillPath(path),
        requireBoolean(enabled),
        requireOptionalCwd(cwd),
        requireProviderResourceUpdateOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.setSkillsEnabled,
    (_, providerId: unknown, paths: unknown, enabled: unknown, cwd: unknown, options: unknown) =>
      providerApi.setSkillsEnabled(
        requireProviderId(providerId),
        requireProviderSkillPaths(paths),
        requireBoolean(enabled),
        requireOptionalCwd(cwd),
        requireProviderResourceUpdateOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.setAppEnabled,
    (_, providerId: unknown, appId: unknown, enabled: unknown, options: unknown) =>
      providerApi.setAppEnabled(
        requireProviderId(providerId),
        requireProviderAppId(appId),
        requireBoolean(enabled),
        requireProviderResourceUpdateOptions(options)
      )
  )

  ipcMain.handle(providerIpcChannels.getUsage, (_, providerId: unknown, options: unknown) => {
    const requiredProviderId = requireProviderId(providerId)
    const requiredOptions = requireUsageOptions(options)
    return runShutdownTolerantProviderRead(
      () => providerApi.getUsage(requiredProviderId, requiredOptions),
      getEmptyProviderAccountUsage
    )
  })

  ipcMain.handle(providerIpcChannels.resetRateLimits, (_, providerId: unknown, options: unknown) =>
    providerApi.resetRateLimits(requireProviderId(providerId), requireSourceOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getChats, (_, providerId: unknown, options: unknown) => {
    const requiredProviderId = requireProviderId(providerId)
    const requiredOptions = requireChatListOptions(options)
    return runShutdownTolerantProviderRead(
      () => providerApi.getChats(requiredProviderId, requiredOptions),
      getEmptyProviderChatPage
    )
  })

  ipcMain.handle(providerIpcChannels.getChat, (_, providerId: unknown, chatId: unknown) => {
    const requiredProviderId = requireProviderId(providerId)
    const requiredChatId = requireChatId(chatId)
    return getRendererChatDetail(() =>
      getProviderChatWindow(requiredProviderId, requiredChatId, {
        startIndex: null,
        limit: rendererChatTurnPageSize
      })
    )
  })

  ipcMain.handle(providerIpcChannels.getSubagents, (_, providerId: unknown, chatId: unknown) =>
    providerApi.getSubagents(requireProviderId(providerId), requireChatId(chatId))
  )

  ipcMain.handle(
    providerIpcChannels.getSubagent,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      subagentId: unknown
    ): Promise<ProviderSubagentDetail> => {
      const detail = await providerApi.getSubagent(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireChatId(subagentId)
      )
      return {
        ...detail,
        items: prepareChatItemsForRenderer(detail.items)
      }
    }
  )

  ipcMain.handle(
    providerIpcChannels.cancelSubagent,
    (_, providerId: unknown, chatId: unknown, subagentId: unknown) =>
      providerApi.cancelSubagent(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireChatId(subagentId)
      )
  )

  ipcMain.handle(
    providerIpcChannels.getChatWorkingStepPage,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      workingStepId: unknown,
      startIndex: unknown,
      limit: unknown
    ): Promise<ProviderWorkingStepPage> => {
      const detail = await providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
      const requiredWorkingStepId = requireMessageId(workingStepId)
      const workingStep = detail.items.find(
        (item): item is ProviderWorkingStep =>
          item.type === 'working' && item.id === requiredWorkingStepId
      )
      if (!workingStep) throw new Error('Working section not found')
      return prepareWorkingStepPage(
        workingStep,
        requireChatTurnStartIndex(startIndex),
        requireWorkingItemLimit(limit)
      )
    }
  )

  ipcMain.handle(
    providerIpcChannels.getChatWorkingItem,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      workingStepId: unknown,
      workingItemId: unknown
    ): Promise<ProviderWorkingItem> => {
      const detail = await providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
      const requiredWorkingStepId = requireMessageId(workingStepId)
      const requiredWorkingItemId = requireMessageId(workingItemId)
      const workingStep = detail.items.find(
        (item): item is ProviderWorkingStep =>
          item.type === 'working' && item.id === requiredWorkingStepId
      )
      if (!workingStep) throw new Error('Working section not found')
      const workingItem =
        workingStep.items.find((item) => item.id === requiredWorkingItemId) ??
        workingStep.items
          .flatMap((item) => (item.type === 'toolGroup' ? item.tools : []))
          .find((tool) => tool.id === requiredWorkingItemId)
      if (!workingItem) throw new Error('Working item not found')
      return limitWorkingItemPayload(workingItem)
    }
  )

  ipcMain.handle(
    providerIpcChannels.getChatWorkingToolPage,
    async (
      _,
      providerId: unknown,
      chatId: unknown,
      workingStepId: unknown,
      workingItemId: unknown,
      startIndex: unknown,
      limit: unknown
    ): Promise<ProviderWorkingToolPage> => {
      const detail = await providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
      const requiredWorkingStepId = requireMessageId(workingStepId)
      const workingStep = detail.items.find(
        (item): item is ProviderWorkingStep =>
          item.type === 'working' && item.id === requiredWorkingStepId
      )
      if (!workingStep) throw new Error('Working section not found')
      return prepareWorkingToolPage(
        workingStep,
        requireMessageId(workingItemId),
        requireChatTurnStartIndex(startIndex),
        requireWorkingItemLimit(limit)
      )
    }
  )

  ipcMain.handle(
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
      const pageDetail = unloadHistoricalWorkingSteps({
        ...detail,
        items: detail.items
      })

      const items = prepareChatItemsForRenderer(
        pageDetail.items.map((item) =>
          item.type === 'message' || item.type === 'pendingMessage'
            ? { ...item, contentLoaded: true }
            : item
        )
      )

      return {
        items,
        startIndex: requiredStartIndex,
        totalCount
      }
    }
  )

  ipcMain.handle(
    providerIpcChannels.setChatTitle,
    (_, providerId: unknown, chatId: unknown, title: unknown) =>
      getRendererChatDetail(() =>
        providerApi.setChatTitle(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireChatTitle(title)
        )
      )
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
      getRendererChatDetail(() =>
        providerApi.startChat(
          requireProviderId(providerId),
          requireMessage(message),
          requireTurnOptions(options),
          requireOptionalChatPurpose(purpose)
        )
      )
  )

  ipcMain.handle(
    providerIpcChannels.continueChat,
    (_, providerId: unknown, chatId: unknown, message: unknown, options: unknown) =>
      getRendererChatDetail(() =>
        providerApi.continueChat(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessage(message),
          requireTurnOptions(options)
        )
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
      getRendererChatDetail(() =>
        providerApi.continueChatInFork(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessage(message),
          requireChatPurpose(purpose),
          requireTurnOptions(options)
        )
      )
  )

  ipcMain.handle(
    providerIpcChannels.forkChat,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      getRendererChatDetail(() =>
        providerApi.forkChat(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId)
        )
      )
  )

  ipcMain.handle(
    providerIpcChannels.sendActiveChatMessage,
    (_, providerId: unknown, chatId: unknown, message: unknown, mode: unknown, options: unknown) =>
      getRendererChatDetail(() =>
        providerApi.sendActiveChatMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessage(message),
          requireActiveSendMode(mode),
          requireTurnOptions(options)
        )
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
      getRendererChatDetail(() =>
        providerApi.deletePendingMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId)
        )
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
      getRendererChatDetail(() =>
        providerApi.editPendingMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId),
          requireMessage(message),
          requireTurnOptions(options)
        )
      )
  )

  ipcMain.handle(
    providerIpcChannels.steerPendingMessage,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      getRendererChatDetail(() =>
        providerApi.steerPendingMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId)
        )
      )
  )

  ipcMain.handle(
    providerIpcChannels.interruptPendingMessage,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      getRendererChatDetail(() =>
        providerApi.interruptPendingMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId)
        )
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
      getRendererChatDetail(() =>
        providerApi.editMessage(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(messageId),
          requireMessage(message),
          requireTurnOptions(options)
        )
      )
  )

  ipcMain.handle(providerIpcChannels.stopChat, (_, providerId: unknown, chatId: unknown) =>
    getRendererChatDetail(() =>
      providerApi.stopChat(requireProviderId(providerId), requireChatId(chatId))
    )
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
      getRendererChatDetail(() =>
        providerApi.resolveApproval(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireApprovalDecision(decision)
        )
      )
  )

  ipcMain.handle(
    providerIpcChannels.resolveUserInput,
    (_, providerId: unknown, chatId: unknown, requestId: unknown, response: unknown) =>
      getRendererChatDetail(() =>
        providerApi.resolveUserInput(
          requireProviderId(providerId),
          requireChatId(chatId),
          requireMessageId(requestId),
          requireUserInputResponse(response)
        )
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

  ipcMain.handle(providerIpcChannels.setChatOrder, (_, chatIds: unknown) =>
    providerApi.setChatOrder(requireChatIds(chatIds))
  )
}
