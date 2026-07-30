import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type {
  ProviderModel,
  ProviderMessageAttachment,
  ProviderReasoningEffortOption,
  ProviderServiceTierOption,
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderChatStatus,
  ProviderCapabilities,
  ProviderLoginResult,
  ProviderActiveSendMode,
  ProviderAgentTerminalDataEvent,
  ProviderApprovalDecision,
  ProviderPendingApproval,
  ProviderPendingMessage,
  ProviderAccountRateLimit,
  ProviderAccountRateLimitResetCredits,
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderAccountUsageDailyBucket,
  ProviderAccountUsageSummary,
  ProviderUsageOptions,
  ProviderChatContextUsage,
  ProviderTokenUsageBreakdown,
  ProviderUpdateAvailability,
  ProviderApprovalModeOption,
  ProviderSandboxModeOption,
  ProviderApp,
  ProviderSkill,
  ProviderTurnOptions,
  ProviderOneShotOptions
} from '../../../shared/provider'
import {
  fallbackProviderApprovalModes,
  fallbackProviderModels,
  fallbackProviderSandboxModes,
  providerOneShotGenerationCanceledMessage
} from '../../../shared/provider'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from '../ProviderAdapter'
import { CodexAppServerClient, type RpcNotification, type RpcRequest } from './CodexAppServerClient'
import {
  createCodexFileAttachmentInput,
  getChatItems,
  hasCodexUserInputAttachments,
  type CodexThreadItem,
  type CodexTurn,
  type CodexUserInput
} from './CodexItemRenderers'
import { getCodexUpdateAvailability, updateCodexProvider } from './CodexProviderUpdate'
import { loadRolloutContextUsage, loadRolloutCwd, loadRolloutHistory } from './CodexRolloutHistory'
import { loadSessionThreadName, loadSessionThreadNames } from './CodexSessionIndex'
import { getNestedToolCalls, isPatchToolCall } from './CodexToolCalls'

type CodexAccount =
  { type: 'apiKey' } | { type: 'chatgpt'; email: string } | { type: 'amazonBedrock' }

type AccountReadResponse = {
  account: CodexAccount | null
  requiresOpenaiAuth: boolean
}

type LoginResponse =
  | { type: 'chatgpt'; loginId: string; authUrl: string }
  | { type: 'apiKey' }
  | { type: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }
  | { type: 'chatgptAuthTokens' }

type CodexThreadStatus =
  | { type: 'notLoaded' | 'idle' | 'systemError' }
  | {
      type: 'active'
      activeFlags: ('waitingOnApproval' | 'waitingOnUserInput')[]
    }

type CodexThread = {
  id: string
  name?: string | null
  preview: string
  createdAt: number
  updatedAt: number
  cwd?: string | null
  status: CodexThreadStatus
  path: string | null
  turns: CodexTurn[]
}

type ThreadListResponse = {
  data: CodexThread[]
  nextCursor: string | null
}

type CodexReasoningEffortOption = {
  reasoningEffort: string
  description?: string | null
}

type CodexServiceTierOption = {
  id: string
  name?: string
  description?: string
}

type CodexModel = {
  id: string
  model?: string
  displayName?: string
  description?: string
  hidden?: boolean
  supportedReasoningEfforts?: CodexReasoningEffortOption[]
  defaultReasoningEffort?: string
  additionalSpeedTiers?: string[]
  serviceTiers?: CodexServiceTierOption[]
  defaultServiceTier?: string | null
  isDefault?: boolean
}

type ModelListResponse = {
  data: CodexModel[]
  nextCursor: string | null
}

type CodexSkillMetadata = {
  name: string
  description?: string
  shortDescription?: string
  interface?: {
    displayName?: string
    shortDescription?: string
  }
  path?: string | null
  scope?: ProviderSkill['scope']
  enabled?: boolean
}

type SkillsListResponse = {
  data: Array<{
    cwd: string
    skills: CodexSkillMetadata[]
  }>
}

type AppsInstalledResponse = {
  apps: Array<{
    id: string
    runtimeName?: string | null
    enabled: boolean
    callable: boolean
  }>
}

type AccountUsageResponse = {
  summary?: unknown
  dailyUsageBuckets?: unknown
}

type AccountRateLimitsResponse = {
  rateLimits?: unknown
  rateLimitsByLimitId?: unknown
  rateLimitResetCredits?: unknown
}

type AccountRateLimitResetResponse = {
  outcome: unknown
}

type ThreadReadResponse = {
  thread: CodexThread
}

type ThreadStartResponse = {
  thread: CodexThread
}

type ThreadResumeResponse = {
  thread: CodexThread
}

type ThreadForkResponse = {
  thread: CodexThread
}

type TurnStartResponse = {
  turn: CodexTurn
}

type TurnSteerResponse = {
  turnId?: string
}

type ThreadNameGenerationResult = {
  title: string
}

type ThreadRollbackResponse = {
  thread: CodexThread
}

type CodexThreadAccessOptions = {
  approvalPolicy: 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
}

type CodexThreadModelOptions = {
  model: ProviderTurnOptions['model']
  serviceTier: ProviderTurnOptions['serviceTier']
}

type CodexTurnAccessOptions = {
  approvalPolicy: 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
  sandboxPolicy:
    | { type: 'readOnly'; networkAccess: boolean }
    | { type: 'workspaceWrite'; networkAccess: boolean }
    | { type: 'dangerFullAccess' }
}

type CodexTurnModelOptions = {
  model: ProviderTurnOptions['model']
  reasoningEffort: ProviderTurnOptions['reasoningEffort']
  serviceTier: ProviderTurnOptions['serviceTier']
}

type ThreadNotificationParams = {
  threadId?: unknown
  status?: unknown
  threadName?: unknown
  thread_name?: unknown
  name?: unknown
}

type TurnNotificationParams = {
  threadId?: unknown
  turn?: unknown
}

type ItemNotificationParams = {
  threadId?: unknown
  turnId?: unknown
  item?: unknown
}

type AgentMessageDeltaParams = {
  threadId?: unknown
  turnId?: unknown
  itemId?: unknown
  delta?: unknown
}

type ReasoningSummaryDeltaParams = AgentMessageDeltaParams & {
  summaryIndex?: unknown
}

type FileChangePatchParams = {
  threadId?: unknown
  turnId?: unknown
  itemId?: unknown
  changes?: unknown
}

type TerminalInteractionParams = AgentMessageDeltaParams & {
  processId?: unknown
  stdin?: unknown
}

type RawResponseItemParams = {
  threadId?: unknown
  turnId?: unknown
  item?: unknown
}

type ServerRequestResolvedParams = {
  threadId?: unknown
  requestId?: unknown
}

type CodexPendingApprovalProtocol = 'commandExecution' | 'fileChange' | 'execCommand' | 'applyPatch'

type CodexPendingApproval = {
  requestId: number
  protocol: CodexPendingApprovalProtocol
  type: ProviderPendingApproval['type']
  threadId: string
  turnId: string | null
  itemId: string | null
  command: string | null
  cwd: string | null
  reason: string | null
  startedAt: number
}

type QueuedTurn = {
  id: string
  text: string
  createdAt: number
  options?: ProviderTurnOptions
}
type OneShotGeneration = {
  threadId: string | null
  turnId: string | null
  canceled: boolean
}

type SteeringMessage = {
  id: string
  itemId: string
  turnId: string
  text: string
  createdAt: number
  status: 'waiting' | 'pending' | 'sent'
  options?: ProviderTurnOptions
}

const getAccountLabel = (account: CodexAccount): string => {
  if (account.type === 'chatgpt') return account.email
  if (account.type === 'apiKey') return 'OpenAI API key'
  return 'Amazon Bedrock'
}

const getStringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getRecordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const getOptionalStringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

const getOptionalNumberValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const getOptionalTokenStringValue = (value: unknown): string | null => {
  if (typeof value === 'bigint') return value >= BigInt(0) ? value.toString() : null
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value).toString()
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim()

  return null
}

const getOptionalCountValue = (value: unknown): number | null => {
  const count = getOptionalTokenStringValue(value)
  if (count == null) return null

  const numericCount = Number(count)
  return Number.isSafeInteger(numericCount) ? numericCount : null
}

const getRequiredUsageNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

const normalizeTokenUsageBreakdown = (value: unknown): ProviderTokenUsageBreakdown | null => {
  const breakdown = getRecordValue(value)
  if (!breakdown) return null

  const totalTokens = getRequiredUsageNumber(breakdown.totalTokens)
  const inputTokens = getRequiredUsageNumber(breakdown.inputTokens)
  const cachedInputTokens = getRequiredUsageNumber(breakdown.cachedInputTokens)
  const outputTokens = getRequiredUsageNumber(breakdown.outputTokens)
  const reasoningOutputTokens = getRequiredUsageNumber(breakdown.reasoningOutputTokens)

  if (
    totalTokens == null ||
    inputTokens == null ||
    cachedInputTokens == null ||
    outputTokens == null ||
    reasoningOutputTokens == null
  ) {
    return null
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens
  }
}

const hasDetailedTokenUsage = (usage: ProviderTokenUsageBreakdown): boolean =>
  usage.inputTokens > 0 ||
  usage.cachedInputTokens > 0 ||
  usage.outputTokens > 0 ||
  usage.reasoningOutputTokens > 0

const getTokenCountContextTokens = (last: ProviderTokenUsageBreakdown): number =>
  last.inputTokens > 0 ? last.inputTokens : last.totalTokens

const normalizeChatContextUsage = (value: unknown): ProviderChatContextUsage | null => {
  const usage = getRecordValue(value)
  if (!usage) return null

  const total = normalizeTokenUsageBreakdown(usage.total)
  const last = normalizeTokenUsageBreakdown(usage.last)
  if (!total || !last) return null
  if (last.totalTokens > 0 && !hasDetailedTokenUsage(last)) return null

  const modelContextWindow = usage.modelContextWindow
  const reportedContextWindow =
    modelContextWindow == null ? null : getRequiredUsageNumber(modelContextWindow)
  if (modelContextWindow != null && reportedContextWindow == null) return null

  const usedTokens = getTokenCountContextTokens(last)
  const maxTokens =
    reportedContextWindow != null && reportedContextWindow > usedTokens
      ? reportedContextWindow
      : null

  return {
    usedTokens,
    maxTokens,
    total,
    last,
    updatedAt: Date.now()
  }
}

const normalizeAccountUsageSummary = (value: unknown): ProviderAccountUsageSummary | null => {
  const summary = getRecordValue(value)
  if (!summary) return null

  return {
    lifetimeTokens: getOptionalTokenStringValue(summary.lifetimeTokens),
    peakDailyTokens: getOptionalTokenStringValue(summary.peakDailyTokens),
    longestRunningTurnSec: getOptionalTokenStringValue(summary.longestRunningTurnSec),
    currentStreakDays: getOptionalTokenStringValue(summary.currentStreakDays),
    longestStreakDays: getOptionalTokenStringValue(summary.longestStreakDays)
  }
}

const normalizeAccountUsageDailyBuckets = (
  value: unknown
): ProviderAccountUsageDailyBucket[] | null => {
  if (value == null) return null
  if (!Array.isArray(value)) return null

  return value.flatMap((candidate): ProviderAccountUsageDailyBucket[] => {
    const bucket = getRecordValue(candidate)
    const startDate = getOptionalStringValue(bucket?.startDate)
    const tokens = getOptionalTokenStringValue(bucket?.tokens)

    return startDate && tokens ? [{ startDate, tokens }] : []
  })
}

const normalizeRateLimitWindow = (
  value: unknown
): Pick<ProviderAccountRateLimit, 'usedPercent' | 'windowMinutes' | 'resetsAt'> | null => {
  const window = getRecordValue(value)
  if (!window) return null

  const usedPercent = getOptionalNumberValue(window.usedPercent)
  const windowMinutes =
    window.windowDurationMins == null ? null : getOptionalNumberValue(window.windowDurationMins)
  const resetsAt = window.resetsAt == null ? null : getOptionalNumberValue(window.resetsAt)

  if (usedPercent == null) return null
  if (window.windowDurationMins != null && windowMinutes == null) return null
  if (window.resetsAt != null && resetsAt == null) return null

  return { usedPercent, windowMinutes, resetsAt }
}

const normalizeRateLimitSnapshot = (
  value: unknown,
  fallbackLabel: string | null
): ProviderAccountRateLimit[] => {
  const snapshot = getRecordValue(value)
  if (!snapshot) return []

  const id = getOptionalStringValue(snapshot.limitId)
  const limitName = getOptionalStringValue(snapshot.limitName)
  const fallbackLimitLabel = fallbackLabel ?? id ?? 'Account'
  const label =
    limitName ??
    (fallbackLimitLabel === 'codex'
      ? 'Codex'
      : fallbackLimitLabel
          .replace(/^codex_/, '')
          .replace(/[-_]+/g, ' ')
          .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase()))
  const limits: ProviderAccountRateLimit[] = []

  const primary = normalizeRateLimitWindow(snapshot.primary)
  if (primary) {
    limits.push({
      id,
      label,
      kind: 'primary',
      ...primary
    })
  }

  const secondary = normalizeRateLimitWindow(snapshot.secondary)
  if (secondary) {
    limits.push({
      id,
      label,
      kind: 'secondary',
      ...secondary
    })
  }

  return limits
}

const normalizeAccountRateLimits = (
  value: AccountRateLimitsResponse | null
): ProviderAccountRateLimit[] => {
  if (!value) return []

  const rateLimitsByLimitId = getRecordValue(value.rateLimitsByLimitId)
  const limits = rateLimitsByLimitId
    ? Object.entries(rateLimitsByLimitId).flatMap(([limitId, snapshot]) =>
        normalizeRateLimitSnapshot(snapshot, limitId)
      )
    : normalizeRateLimitSnapshot(value.rateLimits, null)

  return limits.sort((firstLimit, secondLimit) => {
    if (secondLimit.usedPercent !== firstLimit.usedPercent) {
      return secondLimit.usedPercent - firstLimit.usedPercent
    }

    return firstLimit.label.localeCompare(secondLimit.label)
  })
}

const normalizeRateLimitResetCredits = (
  value: unknown
): ProviderAccountRateLimitResetCredits | null => {
  const summary = getRecordValue(value)
  if (!summary) return null

  const availableCount = getOptionalCountValue(summary.availableCount)
  return availableCount == null ? null : { availableCount }
}

const normalizeRateLimitResetOutcome = (value: unknown): ProviderAccountRateLimitResetOutcome => {
  if (
    value === 'reset' ||
    value === 'nothingToReset' ||
    value === 'noCredit' ||
    value === 'alreadyRedeemed'
  ) {
    return value
  }

  throw new Error('Invalid rate-limit reset response')
}

const requireStringValue = (value: unknown, fieldName: string): string => {
  if (typeof value === 'string' && value) return value
  throw new Error(`Invalid approval request field: ${fieldName}`)
}

const getThreadName = (thread: CodexThread): string | null => {
  const threadFields = thread as CodexThread & {
    threadName?: unknown
    thread_name?: unknown
    title?: unknown
  }

  return (
    getStringValue(thread.name) ??
    getStringValue(threadFields.thread_name) ??
    getStringValue(threadFields.threadName) ??
    getStringValue(threadFields.title)
  )
}

const getThreadTitle = (thread: CodexThread): string => {
  const previewTitle = thread.preview.trim().split('\n')[0]
  return getThreadName(thread) ?? (previewTitle || 'Untitled chat')
}

const getThreadNotificationName = (params: ThreadNotificationParams): string | null =>
  getStringValue(params.threadName) ??
  getStringValue(params.thread_name) ??
  getStringValue(params.name)

const getThreadStatus = (thread: CodexThread): ProviderChatStatus | null => {
  if (thread.status.type === 'systemError') return 'error'
  if (thread.status.type !== 'active') return null
  if (thread.status.activeFlags.includes('waitingOnApproval')) return 'waitingOnApproval'
  if (thread.status.activeFlags.includes('waitingOnUserInput')) return 'waitingOnUserInput'
  return 'active'
}

const getThreadApiCwd = (thread: CodexThread): string | null => {
  const cwd = thread.cwd?.trim()
  return cwd || null
}

const getThreadTurns = (thread: CodexThread): CodexTurn[] =>
  Array.isArray(thread.turns) ? thread.turns : []

const historicalToolItemTypes = new Set([
  'commandExecution',
  'customToolCall',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'fileChange'
])

const textItemTypes = new Set(['userMessage', 'agentMessage'])

const isHistoricalToolItem = (item: CodexThreadItem): boolean =>
  historicalToolItemTypes.has(item.type) ||
  Boolean(
    item.command ||
    item.customToolName ||
    item.tool ||
    item.server ||
    item.namespace ||
    (item.changes?.length ?? 0) > 0
  )

const countItemsByType = (turn: CodexTurn, matches: (item: CodexThreadItem) => boolean): number =>
  turn.items.reduce((count, item) => (matches(item) ? count + 1 : count), 0)

const shouldUseRolloutTurnItems = (structuredTurn: CodexTurn, rolloutTurn: CodexTurn): boolean => {
  if (structuredTurn.status === 'inProgress' || structuredTurn.status === 'queued') return false

  const structuredToolCount = countItemsByType(structuredTurn, isHistoricalToolItem)
  const rolloutToolCount = countItemsByType(rolloutTurn, isHistoricalToolItem)
  if (rolloutToolCount <= structuredToolCount) return false

  const structuredTextCount = countItemsByType(structuredTurn, (item) =>
    textItemTypes.has(item.type)
  )
  const rolloutTextCount = countItemsByType(rolloutTurn, (item) => textItemTypes.has(item.type))

  return rolloutTextCount >= structuredTextCount
}

const restoreStructuredUserMessageAttachments = (
  structuredItems: CodexThreadItem[],
  rolloutItems: CodexThreadItem[]
): CodexThreadItem[] => {
  const rolloutUserMessages = rolloutItems.filter((item) => item.type === 'userMessage')
  let userMessageIndex = 0

  return structuredItems.map((item) => {
    if (item.type !== 'userMessage') return item

    const rolloutItem = rolloutUserMessages[userMessageIndex]
    userMessageIndex += 1
    if (
      !rolloutItem?.content ||
      hasCodexUserInputAttachments(item.content) ||
      !hasCodexUserInputAttachments(rolloutItem.content)
    ) {
      return item
    }

    return {
      ...item,
      content: rolloutItem.content
    }
  })
}

const mergeStructuredAndRolloutTurn = (
  structuredTurn: CodexTurn,
  rolloutTurn: CodexTurn
): CodexTurn => ({
  ...rolloutTurn,
  ...structuredTurn,
  model: structuredTurn.model ?? rolloutTurn.model,
  startedAt: structuredTurn.startedAt ?? rolloutTurn.startedAt,
  completedAt: structuredTurn.completedAt ?? rolloutTurn.completedAt,
  items: shouldUseRolloutTurnItems(structuredTurn, rolloutTurn)
    ? rolloutTurn.items
    : restoreStructuredUserMessageAttachments(structuredTurn.items, rolloutTurn.items)
})

const mergeStructuredAndRolloutTurns = (
  structuredTurns: CodexTurn[],
  rolloutTurns: CodexTurn[]
): CodexTurn[] => {
  if (structuredTurns.length === 0) return rolloutTurns
  if (rolloutTurns.length === 0) return structuredTurns

  // Rollout is append-only and can still contain turns removed by message edits. Use it
  // to enrich the current structured turns, but do not resurrect rollout-only turns.
  const rolloutTurnsById = new Map(rolloutTurns.map((turn) => [turn.id, turn]))

  return structuredTurns.map((structuredTurn) => {
    const rolloutTurn = rolloutTurnsById.get(structuredTurn.id)
    return rolloutTurn ? mergeStructuredAndRolloutTurn(structuredTurn, rolloutTurn) : structuredTurn
  })
}

const nowSeconds = (): number => Math.floor(Date.now() / 1_000)

const getThreadId = (params: { threadId?: unknown }): string | null =>
  typeof params.threadId === 'string' ? params.threadId : null

const getTurnId = (params: { turnId?: unknown }): string | null =>
  typeof params.turnId === 'string' ? params.turnId : null

const getItemId = (params: { itemId?: unknown }): string | null =>
  typeof params.itemId === 'string' ? params.itemId : null

const getDelta = (params: { delta?: unknown }): string | null =>
  typeof params.delta === 'string' ? params.delta : null

const getRawResponseMessage = (
  item: unknown
): { text: string; phase: CodexThreadItem['phase'] } | null => {
  if (!item || typeof item !== 'object') return null

  const message = item as {
    type?: unknown
    role?: unknown
    content?: unknown
    phase?: unknown
  }

  if (
    message.type !== 'message' ||
    message.role !== 'assistant' ||
    !Array.isArray(message.content)
  ) {
    return null
  }

  const text = message.content
    .map((contentItem) => {
      if (!contentItem || typeof contentItem !== 'object') return ''
      const candidate = contentItem as { type?: unknown; text?: unknown }
      return candidate.type === 'output_text' && typeof candidate.text === 'string'
        ? candidate.text
        : ''
    })
    .join('')
    .trim()

  if (!text) return null

  const phase =
    message.phase === 'commentary' || message.phase === 'final_answer' ? message.phase : null

  return { text, phase }
}

const isNoActiveTurnError = (error: unknown): boolean =>
  error instanceof Error && /no active turn/i.test(error.message)

const getFoundActiveTurnId = (error: unknown): string | null => {
  if (!(error instanceof Error)) return null

  const match = error.message.match(
    /expected active turn id\s+\S+\s+but found\s+([A-Za-z0-9:_-]+)/i
  )
  const foundTurnId = match?.[1]
  return foundTurnId && foundTurnId.toLocaleLowerCase() !== 'none' ? foundTurnId : null
}

const getSteerResponseTurnId = (response: TurnSteerResponse | string): string | null => {
  if (typeof response === 'string') return response.trim() || null
  return getStringValue(response.turnId)
}

const isLocalTurnStartUserMessage = (item: CodexThreadItem): boolean =>
  item.type === 'userMessage' && (item.id.startsWith('pending:') || item.id.startsWith('queued:'))

const isLocalSteeringUserMessage = (item: CodexThreadItem): boolean =>
  item.type === 'userMessage' && item.id.startsWith('steer:')

const getCodexUserMessageClientId = (item: CodexThreadItem): string | null =>
  item.type === 'userMessage' ? getOptionalStringValue(item.clientId) : null

const formatLegacyCommand = (command: unknown): string | null =>
  Array.isArray(command) && command.every((part) => typeof part === 'string')
    ? command.join(' ')
    : null

const hasUserMessage = (items: CodexThreadItem[]): boolean =>
  items.some((item) => item.type === 'userMessage')

const codexCapabilities = {
  editMessages: true,
  activeMessages: true
} satisfies ProviderCapabilities

const titleGenerationModel = 'gpt-5.4-mini'
const titleGenerationTimeoutMs = 30_000
const oneShotGenerationTimeoutMs = 120_000
const oneShotCancellationRetentionMs = 120_000
const titleGenerationPromptLimit = 2_000
// Full chat snapshots cross IPC and trigger renderer work. Keep enough time between snapshots for
// input and window events even when a long-running chat has a large history.
const chatUpdateDebounceMs = 250
let localTurnSequence = 0

const titleGenerationOutputSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 36
    }
  },
  required: ['title'],
  additionalProperties: false
}

const createUserTextInput = (
  text: string
): Array<{ type: 'text'; text: string; text_elements: [] }> => [
  { type: 'text', text, text_elements: [] }
]

const createUserInput = (
  text: string,
  images: ProviderTurnOptions['images'] = [],
  files: ProviderTurnOptions['files'] = [],
  skills: ProviderTurnOptions['skills'] = []
): CodexUserInput[] => {
  const fileAttachmentText = (files ?? [])
    .map((file) => createCodexFileAttachmentInput(file.path))
    .map((input) => (input.type === 'text' ? input.text : ''))
    .filter(Boolean)
    .join('\n')
  const combinedText = [text, fileAttachmentText].filter(Boolean).join('\n')

  return [
    ...(combinedText ? createUserTextInput(combinedText) : []),
    ...(images ?? []).map((image) => ({
      type: 'localImage' as const,
      path: image.path
    })),
    ...(skills ?? []).map((skill) => ({
      type: 'skill' as const,
      name: skill.name,
      path: skill.path
    }))
  ]
}

const hasAttachmentInput = (options?: ProviderTurnOptions): boolean =>
  Boolean(options?.images?.length || options?.files?.length || options?.skills?.length)

const getMessageAttachments = (
  options?: ProviderTurnOptions
): ProviderMessageAttachment[] | undefined => {
  const attachments: ProviderMessageAttachment[] = [
    ...(options?.images ?? []).map((image) => ({
      kind: 'image' as const,
      name: basename(image.path),
      path: image.path
    })),
    ...(options?.files ?? []).map((file) => ({
      kind: 'file' as const,
      name: basename(file.path),
      path: file.path
    }))
  ]

  return attachments.length > 0 ? attachments : undefined
}

const truncateTitle = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

const normalizeGeneratedTitle = (value: string, maxLength = 36): string | null => {
  const firstLine = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (!firstLine) return null

  const title = firstLine
    .replace(/^title[:\s]+/i, '')
    .replace(/^[`"']+|[`"']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/g, '')
    .trim()

  return title ? truncateTitle(title, maxLength) : null
}

const createThreadTitlePrompt = (prompt: string): string =>
  [
    'You are a helpful assistant. You will be presented with a user prompt, and your job is to provide a short title for a task that will be created from that prompt.',
    'The tasks typically have to do with coding-related tasks, for example requests for bug fixes or questions about a codebase. The title you generate will be shown in the UI to represent the prompt.',
    'Generate a concise UI title, up to 36 characters.',
    'Fill the structured title field with plain text.',
    'Do not include quotes, markdown, formatting characters, or trailing punctuation.',
    'If the task includes a ticket reference, include it verbatim.',
    'Use an imperative verb first for change requests, such as Add, Fix, Update, Refactor, Remove, Locate, or Find.',
    'If the user prompt is already a short clear title, reuse it verbatim.',
    'Do not answer the prompt or do any other work; only fill the title field.',
    '',
    'Examples:',
    'User: Can we add dark-mode support to the settings page? -> Add dark-mode support',
    'User: How do I fix our login bug? -> Troubleshoot login bug',
    'User: Where in the codebase is foo_bar created -> Locate foo_bar',
    '',
    'User prompt:',
    prompt.slice(0, titleGenerationPromptLimit)
  ].join('\n')

const isNonEmptyAgentMessage = (item: CodexThreadItem): boolean =>
  item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim().length > 0

const getAgentMessageText = (turn: CodexTurn): string | null => {
  const message = turn.items.findLast(isNonEmptyAgentMessage)
  return message?.text?.trim() || null
}

const getAgentMessageTextFromItem = (item: unknown): string | null => {
  const message = getRecordValue(item)
  if (message?.type !== 'agentMessage') return null

  return getStringValue(message.text)
}

const getJsonText = (text: string): string => {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced?.[1]?.trim() ?? trimmed
}

const parseThreadTitleGenerationResult = (text: string): ThreadNameGenerationResult | null => {
  let parsed: unknown

  try {
    parsed = JSON.parse(getJsonText(text))
  } catch {
    return null
  }

  const rawTitle = getStringValue(getRecordValue(parsed)?.title)
  const title = rawTitle ? normalizeGeneratedTitle(rawTitle) : null
  return title ? { title } : null
}

const getGeneratedThreadTitle = (text: string): string | null =>
  parseThreadTitleGenerationResult(text)?.title ?? normalizeGeneratedTitle(text)

const normalizeModelLabel = (model: CodexModel): string => {
  return model.displayName?.trim() || model.model?.trim() || model.id.trim()
}

const normalizeReasoningEffortLabel = (reasoningEffort: string): string =>
  reasoningEffort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || reasoningEffort

const mapCodexReasoningEffort = (
  option: CodexReasoningEffortOption,
  defaultReasoningEffort: string
): ProviderReasoningEffortOption | null => {
  const reasoningEffort = option.reasoningEffort.trim()
  if (!reasoningEffort) return null

  return {
    id: reasoningEffort,
    label: normalizeReasoningEffortLabel(reasoningEffort),
    description: option.description?.trim() ?? '',
    isDefault: reasoningEffort === defaultReasoningEffort
  }
}

const mapCodexServiceTier = (
  option: CodexServiceTierOption,
  defaultServiceTier: string | null
): ProviderServiceTierOption | null => {
  const id = option.id.trim()
  if (!id) return null

  return {
    id,
    label: option.name?.trim() || normalizeReasoningEffortLabel(id),
    description: option.description?.trim() ?? '',
    isDefault: id === defaultServiceTier
  }
}

const mapCodexModel = (model: CodexModel): ProviderModel | null => {
  const id = model.id.trim()
  if (!id || model.hidden) return null

  const defaultReasoningEffort = model.defaultReasoningEffort?.trim() || 'medium'
  const supportedReasoningEfforts =
    model.supportedReasoningEfforts
      ?.map((option) => mapCodexReasoningEffort(option, defaultReasoningEffort))
      .filter((option): option is ProviderReasoningEffortOption => Boolean(option)) ?? []
  const defaultServiceTier = model.defaultServiceTier?.trim() || null
  const catalogServiceTiers =
    model.serviceTiers ??
    model.additionalSpeedTiers?.map((id) => ({
      id,
      name: normalizeReasoningEffortLabel(id)
    })) ??
    []
  const supportedServiceTiers = catalogServiceTiers
    .map((option) => mapCodexServiceTier(option, defaultServiceTier))
    .filter((option): option is ProviderServiceTierOption => Boolean(option))

  return {
    id,
    label: normalizeModelLabel(model),
    description: model.description?.trim() ?? '',
    isDefault: Boolean(model.isDefault),
    supportedReasoningEfforts,
    defaultReasoningEffort,
    supportedServiceTiers,
    defaultServiceTier
  }
}

const getApprovalPolicy = (options?: ProviderTurnOptions): ProviderTurnOptions['approvalPolicy'] =>
  options?.approvalPolicy ?? 'on-request'

const getApprovalsReviewer = (
  options?: ProviderTurnOptions
): ProviderTurnOptions['approvalsReviewer'] => options?.approvalsReviewer ?? 'user'

const getSandboxMode = (options?: ProviderTurnOptions): ProviderTurnOptions['sandboxMode'] =>
  options?.sandboxMode ?? 'workspace-write'

const getThreadModelOptions = (options?: ProviderTurnOptions): CodexThreadModelOptions => ({
  model: options?.model ?? 'gpt-5.5',
  serviceTier: options?.serviceTier ?? null
})

const getTurnModelOptions = (options?: ProviderTurnOptions): CodexTurnModelOptions => ({
  model: options?.model ?? 'gpt-5.5',
  reasoningEffort: options?.reasoningEffort ?? 'xhigh',
  serviceTier: options?.serviceTier ?? null
})

const getThreadAccessOptions = (options?: ProviderTurnOptions): CodexThreadAccessOptions => {
  const approvalPolicy = getApprovalPolicy(options)
  const accessOptions: CodexThreadAccessOptions = {
    approvalPolicy,
    sandbox: getSandboxMode(options)
  }

  if (approvalPolicy !== 'never') accessOptions.approvalsReviewer = getApprovalsReviewer(options)

  return accessOptions
}

const getTurnAccessOptions = (options?: ProviderTurnOptions): CodexTurnAccessOptions => {
  const approvalPolicy = getApprovalPolicy(options)
  const sandboxMode = getSandboxMode(options)
  const accessOptions: CodexTurnAccessOptions = {
    approvalPolicy,
    sandboxPolicy:
      sandboxMode === 'danger-full-access'
        ? { type: 'dangerFullAccess' }
        : {
            type: sandboxMode === 'read-only' ? 'readOnly' : 'workspaceWrite',
            networkAccess: false
          }
  }

  if (approvalPolicy !== 'never') accessOptions.approvalsReviewer = getApprovalsReviewer(options)

  return accessOptions
}

export class CodexProviderAdapter implements ProviderAdapter {
  id = 'codex' as const

  private client = new CodexAppServerClient()
  private disposeNotificationListener: (() => void) | null = null
  private disposeServerRequestListener: (() => void) | null = null
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private agentTerminalDataListeners = new Set<(event: ProviderAgentTerminalDataEvent) => void>()
  private threads = new Map<string, CodexThread>()
  private pendingTurnIds = new Map<string, string>()
  private activeTurnIds = new Map<string, string>()
  private activeOneShotGenerations = new Map<string, OneShotGeneration>()
  private canceledOneShotGenerationIds = new Set<string>()
  private canceledOneShotGenerationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private steeringMessagesByThread = new Map<string, SteeringMessage[]>()
  private hiddenPendingMessageIdsByThread = new Map<string, Set<string>>()
  private queuedTurnsByThread = new Map<string, QueuedTurn[]>()
  private queuedTurnStartThreads = new Set<string>()
  private chatUpdatedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private rolledBackTurnIds = new Map<string, Set<string>>()
  private manuallyStoppedTurnIds = new Map<string, Set<string>>()
  private pendingApprovalsByThread = new Map<string, CodexPendingApproval[]>()
  private contextUsageByThread = new Map<string, ProviderChatContextUsage>()

  constructor() {
    this.disposeNotificationListener = this.client.onNotification(this.handleNotification)
    this.disposeServerRequestListener = this.client.onServerRequest(this.handleServerRequest)
  }

  login = async (): Promise<ProviderLoginResult> => {
    const account = await this.client.request<AccountReadResponse>('account/read', {
      refreshToken: false
    })

    if (account.account) {
      return {
        status: 'authenticated',
        account: { label: getAccountLabel(account.account) }
      }
    }

    if (!account.requiresOpenaiAuth) return { status: 'notRequired' }

    const login = await this.client.request<LoginResponse>('account/login/start', {
      type: 'chatgpt'
    })

    if (login.type !== 'chatgpt') {
      throw new Error(`Unsupported Codex login response: ${login.type}`)
    }

    return {
      status: 'pending',
      loginId: login.loginId,
      authUrl: login.authUrl
    }
  }

  getApprovalModes = async (): Promise<ProviderApprovalModeOption[]> =>
    fallbackProviderApprovalModes

  getSandboxModes = async (): Promise<ProviderSandboxModeOption[]> => fallbackProviderSandboxModes

  getUpdateAvailability = async (): Promise<ProviderUpdateAvailability | null> =>
    getCodexUpdateAvailability()

  updateProvider = async (): Promise<ProviderUpdateAvailability | null> => {
    this.client.dispose()
    return updateCodexProvider()
  }

  getModels = async (): Promise<ProviderModel[]> => {
    const models: ProviderModel[] = []
    let cursor: string | null = null

    try {
      do {
        const response = await this.client.request<ModelListResponse>('model/list', {
          cursor,
          limit: 100,
          includeHidden: false
        })

        response.data
          .map(mapCodexModel)
          .filter((model): model is ProviderModel => Boolean(model))
          .forEach((model) => models.push(model))

        cursor = response.nextCursor
      } while (cursor)
    } catch {
      return fallbackProviderModels
    }

    return models.length > 0 ? models : fallbackProviderModels
  }

  getSkills = async (cwd?: string | null): Promise<ProviderSkill[]> => {
    try {
      await this.client.request('plugin/list', {
        ...(cwd ? { cwds: [cwd] } : {}),
        forceRefetch: false
      })
    } catch {
      // Local and system skills remain available when plugin discovery is unavailable.
    }

    const response = await this.client.request<SkillsListResponse>('skills/list', {
      ...(cwd ? { cwds: [cwd] } : {}),
      forceReload: true
    })
    const entry = cwd
      ? (response.data.find((candidate) => candidate.cwd === cwd) ?? response.data[0])
      : response.data[0]

    return (entry?.skills ?? [])
      .flatMap((skill): ProviderSkill[] => {
        const name = skill.name.trim()
        const path = skill.path?.trim()
        if (!name || !path || skill.enabled === false) return []

        return [
          {
            name,
            description: skill.description?.trim() ?? '',
            shortDescription:
              skill.interface?.shortDescription?.trim() || skill.shortDescription?.trim() || null,
            displayName: skill.interface?.displayName?.trim() || null,
            path,
            scope: skill.scope ?? 'user',
            enabled: true
          }
        ]
      })
      .sort((firstSkill, secondSkill) => firstSkill.name.localeCompare(secondSkill.name))
  }

  getApps = async (): Promise<ProviderApp[]> => {
    const response = await this.client.request<AppsInstalledResponse>('app/installed', {
      forceRefresh: false
    })

    return response.apps
      .flatMap((app): ProviderApp[] => {
        const id = app.id.trim()
        const name = app.runtimeName?.trim()
        if (!id || !name || !app.enabled || !app.callable) return []

        return [
          {
            id,
            name,
            description: 'Connected app',
            enabled: true
          }
        ]
      })
      .sort((firstApp, secondApp) => firstApp.name.localeCompare(secondApp.name))
  }

  getUsage = async (options: ProviderUsageOptions = {}): Promise<ProviderAccountUsage> => {
    const includeStatistics = Boolean(options.includeStatistics)
    const [usageResult, rateLimitsResult] = await Promise.allSettled([
      includeStatistics
        ? this.client.request<AccountUsageResponse>('account/usage/read', undefined)
        : Promise.resolve<AccountUsageResponse | null>(null),
      this.client.request<AccountRateLimitsResponse>('account/rateLimits/read', undefined)
    ])

    const errors: string[] = []
    if (usageResult.status === 'rejected') {
      errors.push(
        usageResult.reason instanceof Error ? usageResult.reason.message : 'Usage unavailable'
      )
    }
    if (rateLimitsResult.status === 'rejected') {
      errors.push(
        rateLimitsResult.reason instanceof Error
          ? rateLimitsResult.reason.message
          : 'Rate limits unavailable'
      )
    }

    if (
      rateLimitsResult.status === 'rejected' &&
      (!includeStatistics || usageResult.status === 'rejected')
    ) {
      throw new Error(errors[0] ?? 'Usage unavailable')
    }

    const usage = usageResult.status === 'fulfilled' ? usageResult.value : null
    const rateLimits = rateLimitsResult.status === 'fulfilled' ? rateLimitsResult.value : null

    return {
      updatedAt: Date.now(),
      statisticsLoaded: includeStatistics && usageResult.status === 'fulfilled',
      summary: normalizeAccountUsageSummary(usage?.summary),
      dailyUsageBuckets: normalizeAccountUsageDailyBuckets(usage?.dailyUsageBuckets),
      rateLimits: normalizeAccountRateLimits(rateLimits),
      rateLimitResetCredits: normalizeRateLimitResetCredits(rateLimits?.rateLimitResetCredits),
      errors
    }
  }

  resetRateLimits = async (): Promise<ProviderAccountRateLimitResetOutcome> => {
    const response = await this.client.request<AccountRateLimitResetResponse>(
      'account/rateLimitResetCredit/consume',
      { idempotencyKey: randomUUID() }
    )

    return normalizeRateLimitResetOutcome(response.outcome)
  }

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const response = await this.client.request<ThreadListResponse>('thread/list', {
      cursor: options.cursor ?? null,
      limit: options.limit ?? 50,
      sortKey: 'created_at',
      sortDirection: 'desc',
      archived: false
    })

    const threadNames = await loadSessionThreadNames(response.data.map((thread) => thread.id))
    const chats = await Promise.all(
      response.data.map(async (thread) => {
        const namedThread = this.withResolvedThreadName(thread, threadNames.get(thread.id) ?? null)

        return {
          id: namedThread.id,
          providerId: this.id,
          title: getThreadTitle(namedThread),
          preview: namedThread.preview.trim(),
          cwd: await this.resolveThreadCwd(namedThread),
          cwdKind: 'directory' as const,
          projectCwd: null,
          branchName: null,
          createdAt: namedThread.createdAt * 1_000,
          updatedAt: namedThread.updatedAt * 1_000,
          status: getThreadStatus(namedThread),
          pendingApproval: this.getProviderPendingApproval(namedThread.id),
          pinned: false,
          done: false,
          seenUpdatedAt: null,
          purpose: null
        }
      })
    )

    return {
      chats,
      nextCursor: response.nextCursor ?? null
    }
  }

  getChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const cachedDetail = this.getCachedChatDetail(chatId)
    if (cachedDetail) return cachedDetail

    const response = await this.client.request<ThreadReadResponse>('thread/read', {
      threadId: chatId,
      includeTurns: true
    })

    const [cwd, name, turns, contextUsage] = await Promise.all([
      this.resolveThreadCwd(response.thread),
      this.resolveThreadName(response.thread),
      this.getTurnsForThread(response.thread),
      loadRolloutContextUsage(response.thread.path)
    ])
    const thread = {
      ...response.thread,
      name,
      cwd,
      turns: this.filterRolledBackTurns(response.thread.id, turns)
    }
    this.cacheThread(thread)
    if (contextUsage) this.contextUsageByThread.set(thread.id, contextUsage)

    return this.createChatDetail(thread)
  }

  generateOneShot = async (message: string, options?: ProviderOneShotOptions): Promise<string> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot generate from an empty message')

    const generationId = options?.generationId?.trim() || null
    const canceledBeforeStart = generationId
      ? this.takeCanceledOneShotGeneration(generationId)
      : false
    const generation: OneShotGeneration | null = generationId
      ? {
          threadId: null,
          turnId: null,
          canceled: canceledBeforeStart
        }
      : null

    if (generationId) {
      if (this.activeOneShotGenerations.has(generationId)) {
        throw new Error('Duplicate one-shot generation ID')
      }

      this.activeOneShotGenerations.set(generationId, generation!)
    }

    let threadId: string | null = null
    let generatedText: Promise<string | null> | null = null

    const throwIfCanceled = async (): Promise<void> => {
      if (!generation?.canceled) return

      await this.interruptOneShotGeneration(generation).catch(() => {})
      throw new Error(providerOneShotGenerationCanceledMessage)
    }

    try {
      await throwIfCanceled()

      const startedThread = await this.client.request<ThreadStartResponse>('thread/start', {
        cwd: options?.cwd,
        model: options?.model,
        serviceTier: options?.serviceTier ?? null,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config: {
          'features.enable_fanout': false,
          'features.hooks': false,
          'features.multi_agent': false,
          'features.multi_agent_v2': false,
          web_search: 'disabled'
        },
        ephemeral: true
      })
      threadId = startedThread.thread.id
      if (generation) generation.threadId = threadId

      await throwIfCanceled()

      generatedText = this.waitForOneShotText(
        threadId,
        oneShotGenerationTimeoutMs,
        'one-shot response',
        (turnId) => {
          if (!generation) return

          generation.turnId = turnId
          if (generation.canceled) void this.interruptOneShotGeneration(generation)
        }
      )

      const startedTurn = await this.client.request<TurnStartResponse>('turn/start', {
        threadId,
        cwd: options?.cwd,
        input: createUserTextInput(text),
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: options?.model,
        effort: options?.reasoningEffort,
        serviceTier: options?.serviceTier ?? null,
        summary: null
      })
      if (generation) generation.turnId = startedTurn.turn.id

      await throwIfCanceled()

      const generatedResponseText = (await generatedText)?.trim() ?? ''
      await throwIfCanceled()
      return generatedResponseText
    } catch (error) {
      generatedText?.catch(() => {})
      if (generation?.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      throw error
    } finally {
      if (generationId) this.activeOneShotGenerations.delete(generationId)
      if (threadId) await this.client.request('thread/unsubscribe', { threadId }).catch(() => {})
    }
  }

  cancelOneShot = async (generationId: string): Promise<void> => {
    const generation = this.activeOneShotGenerations.get(generationId)
    if (!generation) {
      this.rememberCanceledOneShotGeneration(generationId)
      return
    }

    generation.canceled = true
    await this.interruptOneShotGeneration(generation)
  }

  private rememberCanceledOneShotGeneration = (generationId: string): void => {
    this.canceledOneShotGenerationIds.add(generationId)

    const existingTimer = this.canceledOneShotGenerationTimers.get(generationId)
    if (existingTimer) clearTimeout(existingTimer)

    const timer = setTimeout(() => {
      this.canceledOneShotGenerationIds.delete(generationId)
      this.canceledOneShotGenerationTimers.delete(generationId)
    }, oneShotCancellationRetentionMs)

    this.canceledOneShotGenerationTimers.set(generationId, timer)
  }

  private takeCanceledOneShotGeneration = (generationId: string): boolean => {
    const canceled = this.canceledOneShotGenerationIds.delete(generationId)
    const timer = this.canceledOneShotGenerationTimers.get(generationId)

    if (timer) {
      clearTimeout(timer)
      this.canceledOneShotGenerationTimers.delete(generationId)
    }

    return canceled
  }

  private interruptOneShotGeneration = async (generation: OneShotGeneration): Promise<void> => {
    if (!generation.threadId || !generation.turnId) return

    await this.interruptTurn(generation.threadId, generation.turnId)
  }

  startChat = async (
    message: string,
    options?: ProviderTurnOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot start a chat with an empty message')
    }

    const startedThread = await this.client.request<ThreadStartResponse>('thread/start', {
      cwd: options?.cwd,
      ...getThreadAccessOptions(options),
      ...getThreadModelOptions(options)
    })
    await onChatCreated?.(startedThread.thread.id)

    const [cwd, name, turns] = await Promise.all([
      this.resolveThreadCwd(startedThread.thread, options?.cwd ?? null),
      this.resolveThreadName(startedThread.thread),
      this.getTurnsForThread(startedThread.thread)
    ])
    const thread = {
      ...startedThread.thread,
      name,
      cwd,
      status: { type: 'active', activeFlags: [] },
      turns
    } satisfies CodexThread
    this.cacheThread(thread)

    const pendingTurn = this.addPendingTurn(thread.id, text, options)
    if (pendingTurn) this.emitChatUpdated(thread.id)

    try {
      const startedTurn = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: thread.id,
        cwd: options?.cwd,
        input: createUserInput(text, options?.images, options?.files, options?.skills),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.activeTurnIds.set(thread.id, startedTurn.turn.id)
      this.replacePendingTurn(thread.id, pendingTurn?.id ?? null, startedTurn.turn)
      this.pendingTurnIds.delete(thread.id)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(thread.id, pendingTurn.id)
      throw error
    }

    this.startThreadTitleGeneration(thread.id, text || 'File attachment', cwd)

    const detail = this.getCachedChatDetail(thread.id)
    if (!detail) throw new Error('Unable to start chat')

    this.emitChatUpdated(thread.id)
    return detail
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot continue a chat with an empty message')
    }

    const pendingTurn = this.addPendingTurn(chatId, text, options)
    if (pendingTurn) this.emitChatUpdated(chatId)

    try {
      const existingCwd = this.threads.get(chatId)?.cwd ?? null
      await this.resumeThreadForMutation(chatId, options, existingCwd)

      const started = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: chatId,
        input: createUserInput(text, options?.images, options?.files, options?.skills),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.activeTurnIds.set(chatId, started.turn.id)
      this.replacePendingTurn(chatId, pendingTurn?.id ?? null, started.turn)
      this.pendingTurnIds.delete(chatId)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(chatId, pendingTurn.id)
      throw error
    }

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to continue chat')

    this.emitChatUpdated(chatId)
    return detail
  }

  continueChatInFork = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot continue a chat with an empty message')
    }

    if (!this.threads.has(chatId)) await this.getChat(chatId)
    const sourceThread = this.threads.get(chatId)
    if (this.getActiveTurnId(chatId)) {
      throw new Error('Cannot fork a chat with an active turn')
    }

    const fork = await this.client.request<ThreadForkResponse>('thread/fork', {
      threadId: chatId,
      ...getThreadAccessOptions(options),
      ...getThreadModelOptions(options)
    })
    await onForkCreated?.(fork.thread.id)

    const [cwd, name, turns] = await Promise.all([
      this.resolveThreadCwd(fork.thread, sourceThread?.cwd ?? null),
      this.resolveThreadName(fork.thread),
      this.getTurnsForThread(fork.thread)
    ])
    const forkedThread = {
      ...fork.thread,
      name,
      cwd,
      status: { type: 'active', activeFlags: [] },
      turns: this.filterRolledBackTurns(fork.thread.id, turns)
    } satisfies CodexThread
    this.cacheThread(forkedThread)

    const pendingTurn = this.addPendingTurn(forkedThread.id, text, options)
    if (pendingTurn) this.emitChatUpdated(forkedThread.id)

    try {
      const started = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: forkedThread.id,
        input: createUserInput(text, options?.images, options?.files, options?.skills),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.activeTurnIds.set(forkedThread.id, started.turn.id)
      this.replacePendingTurn(forkedThread.id, pendingTurn?.id ?? null, started.turn)
      this.pendingTurnIds.delete(forkedThread.id)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(forkedThread.id, pendingTurn.id)
      throw error
    }

    const detail = this.getCachedChatDetail(forkedThread.id)
    if (!detail) throw new Error('Unable to continue forked chat')

    this.emitChatUpdated(forkedThread.id)
    return detail
  }

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    if (mode === 'queue') return this.queueChatMessage(chatId, message, options)
    if (mode === 'interrupt') return this.interruptAndContinueChat(chatId, message, options)
    return this.steerActiveChat(chatId, message, options)
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    if (!this.threads.has(chatId)) await this.getChat(chatId)

    const removedSteering = this.removeSteeringMessage(chatId, messageId)
    const removedQueued = this.removeQueuedTurn(chatId, messageId)
    const hidPendingMessage =
      removedSteering || removedQueued ? false : this.hidePendingMessage(chatId, messageId)

    if (removedSteering || removedQueued || hidPendingMessage) this.emitChatUpdated(chatId)

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to delete pending message')

    return detail
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot edit a pending message to empty content')
    }
    if (!this.threads.has(chatId)) await this.getChat(chatId)

    const editedSteeringMessage = this.editSteeringMessage(chatId, messageId, text, options)
    const editedQueuedTurn = editedSteeringMessage
      ? false
      : this.editQueuedTurn(chatId, messageId, text, options)
    if (!editedSteeringMessage && !editedQueuedTurn) {
      throw new Error('Pending message cannot be edited')
    }

    this.emitChatUpdated(chatId)

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to edit pending message')

    return detail
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    if (!this.threads.has(chatId)) await this.getChat(chatId)

    const steeringMessage = this.takeSteeringMessage(chatId, messageId)
    if (steeringMessage) {
      this.emitChatUpdated(chatId)
      return this.interruptAndContinueChat(chatId, steeringMessage.text, steeringMessage.options)
    }

    const queuedTurn = this.takeQueuedTurn(chatId, messageId)
    if (queuedTurn) {
      this.emitChatUpdated(chatId)
      return this.interruptAndContinueChat(chatId, queuedTurn.text, queuedTurn.options)
    }

    throw new Error('Pending message cannot be interrupted')
  }

  editMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot edit a message to empty content')
    }

    if (!this.threads.has(chatId)) {
      await this.getChat(chatId)
    }

    let thread = this.threads.get(chatId)
    if (!thread) throw new Error('Unable to load chat for editing')

    await this.stopActiveTurn(chatId, { startQueuedTurn: false })
    thread = this.threads.get(chatId) ?? thread

    thread = await this.resumeThreadForMutation(chatId, options, thread.cwd ?? null)

    const targetTurnIndex = this.findUserMessageTurnIndex(thread, messageId)
    if (targetTurnIndex < 0) throw new Error('Message cannot be edited')

    const numTurns = thread.turns.length - targetTurnIndex
    if (numTurns < 1) throw new Error('Message cannot be edited')

    const rolledBackTurnIds = new Set(thread.turns.slice(targetTurnIndex).map((turn) => turn.id))
    const rollback = await this.client.request<ThreadRollbackResponse>('thread/rollback', {
      threadId: chatId,
      numTurns
    })
    const [cwd, name] = await Promise.all([
      this.resolveThreadCwd(rollback.thread, thread.cwd ?? null),
      this.resolveThreadName(rollback.thread)
    ])
    this.rememberRolledBackTurns(chatId, rolledBackTurnIds)
    this.cacheThread({
      ...rollback.thread,
      name,
      cwd,
      turns: thread.turns.slice(0, targetTurnIndex)
    })
    this.emitChatUpdated(chatId)

    const pendingTurn = this.addPendingTurn(chatId, text, options)
    if (pendingTurn) this.emitChatUpdated(chatId)

    try {
      const started = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: chatId,
        input: createUserInput(text, options?.images, options?.files, options?.skills),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.allowRolledBackTurn(chatId, started.turn.id)
      this.activeTurnIds.set(chatId, started.turn.id)
      this.replacePendingTurn(chatId, pendingTurn?.id ?? null, started.turn)
      this.pendingTurnIds.delete(chatId)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(chatId, pendingTurn.id)
      throw error
    }

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to edit message')

    this.emitChatUpdated(chatId)
    return detail
  }

  resolveApproval = async (
    chatId: string,
    decision: ProviderApprovalDecision
  ): Promise<ProviderChatDetail> => {
    const approval = this.pendingApprovalsByThread.get(chatId)?.[0]
    if (!approval) throw new Error('No pending approval to resolve')

    this.client.resolveServerRequest(
      approval.requestId,
      this.createApprovalResponse(approval, decision)
    )
    this.removePendingApproval(chatId, approval.requestId)
    this.emitChatUpdated(chatId)

    const detail = this.getCachedChatDetail(chatId)
    if (detail) return detail

    return this.getChat(chatId)
  }

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    await this.stopActiveTurn(chatId, { startQueuedTurn: false })

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to stop chat')

    return detail
  }

  writeAgentTerminalInput = async (
    chatId: string,
    processId: string,
    data: string
  ): Promise<void> => {
    void data

    if (!this.hasAgentTerminalProcess(chatId, processId)) {
      throw new Error('Agent terminal is no longer available')
    }

    throw new Error(
      'Codex app-server does not expose stdin control for agent commandExecution processes'
    )
  }

  resizeAgentTerminal = async (
    chatId: string,
    processId: string,
    cols: number,
    rows: number
  ): Promise<void> => {
    void cols
    void rows

    if (!this.hasAgentTerminalProcess(chatId, processId)) return
  }

  onChatUpdated = (
    listener: (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  ): (() => void) => {
    this.chatUpdatedListeners.add(listener)
    return () => this.chatUpdatedListeners.delete(listener)
  }

  onAgentTerminalData = (
    listener: (event: ProviderAgentTerminalDataEvent) => void
  ): (() => void) => {
    this.agentTerminalDataListeners.add(listener)
    return () => this.agentTerminalDataListeners.delete(listener)
  }

  dispose = (): void => {
    this.disposeNotificationListener?.()
    this.disposeNotificationListener = null
    this.disposeServerRequestListener?.()
    this.disposeServerRequestListener = null
    this.chatUpdatedTimers.forEach((timer) => clearTimeout(timer))
    this.chatUpdatedTimers.clear()
    this.activeOneShotGenerations.clear()
    this.canceledOneShotGenerationIds.clear()
    this.canceledOneShotGenerationTimers.forEach((timer) => clearTimeout(timer))
    this.canceledOneShotGenerationTimers.clear()
    this.agentTerminalDataListeners.clear()
    this.steeringMessagesByThread.clear()
    this.hiddenPendingMessageIdsByThread.clear()
    this.queuedTurnsByThread.clear()
    this.queuedTurnStartThreads.clear()
    this.manuallyStoppedTurnIds.clear()
    this.client.dispose()
  }

  private resolveThreadCwd = async (
    thread: CodexThread,
    fallbackCwd: string | null = null
  ): Promise<string | null> =>
    getThreadApiCwd(thread) ?? fallbackCwd ?? (await loadRolloutCwd(thread.path))

  private getTurnsForThread = async (thread: CodexThread): Promise<CodexTurn[]> => {
    const structuredTurns = getThreadTurns(thread)
    const rolloutTurns = await loadRolloutHistory(thread.path)

    return mergeStructuredAndRolloutTurns(structuredTurns, rolloutTurns)
  }

  private steerActiveChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot steer a chat with an empty message')
    }

    if (!this.threads.has(chatId)) await this.getChat(chatId)

    const turnId = this.getActiveTurnId(chatId)
    if (!turnId) return this.continueChat(chatId, text, options)

    if (this.hasPendingSteeringMessage(chatId)) {
      return this.queueChatMessage(chatId, text, options)
    }

    const steeringMessage = this.addWaitingSteeringMessage(chatId, turnId, text, options)
    if (!steeringMessage) throw new Error('Unable to steer chat')

    this.emitChatUpdated(chatId)

    void this.processWaitingSteeringMessage(chatId, steeringMessage.id).catch(() => {
      if (this.removeSteeringMessage(chatId, steeringMessage.id)) this.emitChatUpdated(chatId)
      if (!this.getActiveTurnId(chatId)) this.startNextQueuedTurn(chatId)
    })

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to steer chat')

    return detail
  }

  private processWaitingSteeringMessage = async (
    chatId: string,
    initialMessageId: string
  ): Promise<void> => {
    const initialSteeringMessage = this.getSteeringMessage(chatId, initialMessageId)
    if (!initialSteeringMessage || initialSteeringMessage.status !== 'waiting') return

    const currentSteeringMessage = this.getSteeringMessage(chatId, initialMessageId)
    if (!currentSteeringMessage || currentSteeringMessage.status !== 'waiting') return

    const activeTurnId = this.getActiveTurnId(chatId)
    if (!activeTurnId || activeTurnId !== currentSteeringMessage.turnId) {
      this.removeSteeringMessage(chatId, currentSteeringMessage.id)
      this.emitChatUpdated(chatId)
      await this.continueChat(chatId, currentSteeringMessage.text, currentSteeringMessage.options)
      return
    }

    const steeringMessage = this.markWaitingSteeringMessagePending(
      chatId,
      initialMessageId,
      activeTurnId
    )
    if (!steeringMessage) return

    let expectedTurnId = activeTurnId
    let steeringMessageId = steeringMessage.id
    let didRetryWithServerTurnId = false

    try {
      for (;;) {
        try {
          const response = await this.client.request<TurnSteerResponse | string>('turn/steer', {
            threadId: chatId,
            expectedTurnId,
            clientUserMessageId: steeringMessage.itemId,
            input: createUserInput(
              steeringMessage.text,
              steeringMessage.options?.images,
              steeringMessage.options?.files,
              steeringMessage.options?.skills
            )
          })
          const acceptedTurnId = getSteerResponseTurnId(response) ?? expectedTurnId
          if (acceptedTurnId !== expectedTurnId) {
            steeringMessageId =
              this.updateSteeringMessageTurn(chatId, steeringMessageId, acceptedTurnId) ??
              steeringMessageId
          }
          this.activeTurnIds.set(chatId, acceptedTurnId)
          break
        } catch (error) {
          const serverTurnId = didRetryWithServerTurnId ? null : getFoundActiveTurnId(error)
          if (!serverTurnId || serverTurnId === expectedTurnId) throw error

          steeringMessageId =
            this.updateSteeringMessageTurn(chatId, steeringMessageId, serverTurnId) ??
            steeringMessageId
          this.activeTurnIds.set(chatId, serverTurnId)
          expectedTurnId = serverTurnId
          didRetryWithServerTurnId = true
        }
      }
    } catch (error) {
      this.removeSteeringMessage(chatId, steeringMessageId)
      this.emitChatUpdated(chatId)

      if (isNoActiveTurnError(error)) {
        await this.continueChat(chatId, steeringMessage.text, steeringMessage.options)
        return
      }

      throw error
    }
  }

  private queueChatMessage = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) throw new Error('Cannot queue an empty message')

    if (!this.threads.has(chatId)) await this.getChat(chatId)
    if (!this.getActiveTurnId(chatId)) return this.continueChat(chatId, text, options)

    const queuedTurn = this.addQueuedTurn(chatId, text, options)
    if (!queuedTurn) throw new Error('Unable to queue chat message')

    this.emitChatUpdated(chatId)

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to queue chat message')

    return detail
  }

  private interruptAndContinueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasAttachmentInput(options)) {
      throw new Error('Cannot interrupt with an empty message')
    }

    if (!this.threads.has(chatId)) await this.getChat(chatId)
    if (this.getActiveTurnId(chatId)) {
      await this.stopActiveTurn(chatId, { startQueuedTurn: false })
    }

    return this.continueChat(chatId, text, options)
  }

  private startCodexTurn = async (
    chatId: string,
    text: string,
    options: ProviderTurnOptions | undefined,
    pendingTurnId: string | null
  ): Promise<CodexTurn> => {
    const existingCwd = this.threads.get(chatId)?.cwd ?? null
    await this.resumeThreadForMutation(chatId, options, existingCwd)

    const started = await this.client.request<TurnStartResponse>('turn/start', {
      threadId: chatId,
      input: createUserInput(text, options?.images, options?.files, options?.skills),
      ...getTurnModelOptions(options),
      ...getTurnAccessOptions(options)
    })

    this.activeTurnIds.set(chatId, started.turn.id)
    this.replacePendingTurn(chatId, pendingTurnId, started.turn)
    this.pendingTurnIds.delete(chatId)

    return started.turn
  }

  private interruptTurn = async (
    threadId: string,
    turnId: string
  ): Promise<{ turnId: string; interrupted: boolean }> => {
    try {
      await this.client.request('turn/interrupt', {
        threadId,
        turnId
      })
      return { turnId, interrupted: true }
    } catch (error) {
      const serverTurnId = getFoundActiveTurnId(error)
      if (!serverTurnId || serverTurnId === turnId) {
        if (isNoActiveTurnError(error)) return { turnId, interrupted: false }
        throw error
      }

      try {
        await this.client.request('turn/interrupt', {
          threadId,
          turnId: serverTurnId
        })
        return { turnId: serverTurnId, interrupted: true }
      } catch (retryError) {
        if (isNoActiveTurnError(retryError)) return { turnId: serverTurnId, interrupted: false }
        throw retryError
      }
    }
  }

  private stopActiveTurn = async (
    chatId: string,
    options: { startQueuedTurn: boolean }
  ): Promise<void> => {
    const turnId = this.getActiveTurnId(chatId)
    this.cancelPendingApprovals(chatId)

    if (!turnId) {
      if (!this.threads.has(chatId)) await this.getChat(chatId)
      this.removeSteeringMessageForThread(chatId)
      this.setThreadStatus(chatId, { type: 'idle' })
      this.emitChatUpdated(chatId)
      if (options.startQueuedTurn) this.startNextQueuedTurn(chatId)
      return
    }

    const interruptResult = await this.interruptTurn(chatId, turnId)
    const stoppedTurnId = interruptResult.turnId

    this.activeTurnIds.delete(chatId)
    this.rememberManuallyStoppedTurn(chatId, stoppedTurnId)
    this.markSteeringMessagesSentForTurn(chatId, stoppedTurnId)
    if (interruptResult.interrupted) this.markTurnInterrupted(chatId, stoppedTurnId)
    else this.markTurnCompleted(chatId, stoppedTurnId)
    if (stoppedTurnId !== turnId) this.markTurnCompleted(chatId, turnId)
    this.setThreadStatus(chatId, { type: 'idle' })
    this.emitChatUpdated(chatId)
    if (options.startQueuedTurn) this.startNextQueuedTurn(chatId)
  }

  private createChatDetail = (thread: CodexThread): ProviderChatDetail => ({
    id: thread.id,
    title: getThreadTitle(thread),
    cwd: getThreadApiCwd(thread),
    cwdKind: 'directory' as const,
    projectCwd: null,
    branchName: null,
    status: getThreadStatus(thread),
    pinned: false,
    done: false,
    seenUpdatedAt: null,
    purpose: null,
    capabilities: codexCapabilities,
    pendingApproval: this.getProviderPendingApproval(thread.id),
    contextUsage: this.contextUsageByThread.get(thread.id) ?? null,
    items: [
      ...getChatItems(this.getRenderableTurns(thread), thread.createdAt, {
        hiddenPendingMessageIds: this.hiddenPendingMessageIdsByThread.get(thread.id),
        pendingSteeringMessageIds: this.getPendingSteeringMessageIds(thread.id)
      }),
      ...this.getProviderPendingMessages(thread.id)
    ]
  })

  private cacheThread = (thread: CodexThread): void => {
    this.threads.set(thread.id, thread)
  }

  private getCachedChatDetail = (threadId: string): ProviderChatDetail | null => {
    const thread = this.threads.get(threadId)
    return thread ? this.createChatDetail(thread) : null
  }

  private rememberRolledBackTurns = (threadId: string, turnIds: Set<string>): void => {
    if (turnIds.size === 0) return

    const rolledBackTurnIds = this.rolledBackTurnIds.get(threadId) ?? new Set<string>()
    turnIds.forEach((turnId) => rolledBackTurnIds.add(turnId))
    this.rolledBackTurnIds.set(threadId, rolledBackTurnIds)

    const activeTurnId = this.activeTurnIds.get(threadId)
    if (activeTurnId && turnIds.has(activeTurnId)) this.activeTurnIds.delete(threadId)

    const pendingTurnId = this.pendingTurnIds.get(threadId)
    if (pendingTurnId && turnIds.has(pendingTurnId)) this.pendingTurnIds.delete(threadId)

    this.removeQueuedTurns(threadId, turnIds)
    this.removeSteeringMessagesForTurnIds(threadId, turnIds)
    this.removeHiddenPendingMessagesForTurnIds(threadId, turnIds)
  }

  private allowRolledBackTurn = (threadId: string, turnId: string): void => {
    const rolledBackTurnIds = this.rolledBackTurnIds.get(threadId)
    if (!rolledBackTurnIds) return

    rolledBackTurnIds.delete(turnId)
    if (rolledBackTurnIds.size === 0) this.rolledBackTurnIds.delete(threadId)
  }

  private isRolledBackTurn = (threadId: string, turnId: string): boolean =>
    this.rolledBackTurnIds.get(threadId)?.has(turnId) ?? false

  private rememberManuallyStoppedTurn = (threadId: string, turnId: string): void => {
    const turnIds = this.manuallyStoppedTurnIds.get(threadId) ?? new Set<string>()
    turnIds.add(turnId)
    this.manuallyStoppedTurnIds.set(threadId, turnIds)
  }

  private takeManuallyStoppedTurn = (threadId: string, turnId: string): boolean => {
    const turnIds = this.manuallyStoppedTurnIds.get(threadId)
    if (!turnIds?.has(turnId)) return false

    turnIds.delete(turnId)
    if (turnIds.size === 0) this.manuallyStoppedTurnIds.delete(threadId)
    return true
  }

  private filterRolledBackTurns = (threadId: string, turns: CodexTurn[]): CodexTurn[] => {
    const rolledBackTurnIds = this.rolledBackTurnIds.get(threadId)
    if (!rolledBackTurnIds || rolledBackTurnIds.size === 0) return turns

    return turns.filter((turn) => !rolledBackTurnIds.has(turn.id))
  }

  private findUserMessageTurnIndex = (thread: CodexThread, messageId: string): number =>
    thread.turns.findIndex((turn) =>
      turn.items.some(
        (item) => item.type === 'userMessage' && `${turn.id}:${item.id}` === messageId
      )
    )

  private withResolvedThreadName = (
    thread: CodexThread,
    fallbackName: string | null
  ): CodexThread => ({
    ...thread,
    name: fallbackName ?? getThreadName(thread)
  })

  private resolveThreadName = async (thread: CodexThread): Promise<string | null> =>
    (await loadSessionThreadName(thread.id)) ?? getThreadName(thread)

  private startThreadTitleGeneration = (
    threadId: string,
    prompt: string,
    cwd: string | null
  ): void => {
    void this.generateAndSetThreadTitle(threadId, prompt, cwd).catch(() => {})
  }

  private generateAndSetThreadTitle = async (
    threadId: string,
    prompt: string,
    cwd: string | null
  ): Promise<void> => {
    const currentThread = this.threads.get(threadId)
    if (currentThread && getThreadName(currentThread)) return

    const generatedTitle = await this.generateThreadTitle(prompt, cwd).catch(() => null)
    if (!generatedTitle) return

    await this.setThreadNameIfUntitled(threadId, generatedTitle)
  }

  private generateThreadTitle = async (
    prompt: string,
    cwd: string | null
  ): Promise<string | null> => {
    const startedThread = await this.client.request<ThreadStartResponse>('thread/start', {
      cwd,
      model: titleGenerationModel,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      config: {
        'features.enable_fanout': false,
        'features.hooks': false,
        'features.multi_agent': false,
        'features.multi_agent_v2': false,
        web_search: 'disabled'
      },
      ephemeral: true
    })
    const titleThreadId = startedThread.thread.id
    const generatedText = this.waitForTitleGenerationText(titleThreadId)

    try {
      await this.client.request<TurnStartResponse>('turn/start', {
        threadId: titleThreadId,
        input: createUserTextInput(createThreadTitlePrompt(prompt)),
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: titleGenerationModel,
        effort: 'low',
        summary: null,
        outputSchema: titleGenerationOutputSchema
      })

      const text = await generatedText
      if (!text) return null

      return getGeneratedThreadTitle(text)
    } catch (error) {
      generatedText.catch(() => {})
      throw error
    } finally {
      await this.client.request('thread/unsubscribe', { threadId: titleThreadId }).catch(() => {})
    }
  }

  private waitForTitleGenerationText = (threadId: string): Promise<string | null> =>
    this.waitForOneShotText(threadId, titleGenerationTimeoutMs, 'thread title generation')

  private waitForOneShotText = (
    threadId: string,
    timeoutMs: number,
    errorLabel: string,
    onTurnStarted?: (turnId: string) => void
  ): Promise<string | null> =>
    new Promise((resolve, reject) => {
      let turnId: string | null = null
      let agentMessageText = ''

      const cleanup = (): void => {
        clearTimeout(timeout)
        dispose()
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for ${errorLabel}`))
      }, timeoutMs)

      const dispose = this.client.onNotification((notification) => {
        const params = getRecordValue(notification.params)
        const notificationThreadId = getThreadId(params ?? {})
        if (notificationThreadId !== threadId) return

        if (notification.method === 'turn/started') {
          const turn = getRecordValue(params?.turn)
          const startedTurnId = getStringValue(turn?.id)
          if (startedTurnId) {
            turnId = startedTurnId
            onTurnStarted?.(startedTurnId)
          }
          return
        }

        if (
          notification.method === 'item/agentMessage/delta' ||
          notification.method === 'item/completed'
        ) {
          const notificationTurnId = getTurnId(params ?? {})
          if (turnId && notificationTurnId && notificationTurnId !== turnId) return
          if (!turnId && notificationTurnId) turnId = notificationTurnId

          if (notification.method === 'item/agentMessage/delta') {
            const delta = getDelta(params ?? {})
            if (delta) agentMessageText = `${agentMessageText}${delta}`
            return
          }

          const messageText = getAgentMessageTextFromItem(params?.item)
          if (messageText) agentMessageText = messageText
          return
        }

        if (notification.method !== 'turn/completed') return

        const completedTurn = getRecordValue(params?.turn) as CodexTurn | null
        if (!completedTurn || !Array.isArray(completedTurn.items)) return
        if (turnId && completedTurn.id !== turnId) return

        cleanup()

        if (completedTurn.status && completedTurn.status !== 'completed') {
          reject(new Error(`${errorLabel} ended with status ${completedTurn.status}`))
          return
        }

        resolve(agentMessageText.trim() || getAgentMessageText(completedTurn))
      })
    })

  private setThreadNameIfUntitled = async (threadId: string, title: string): Promise<void> => {
    const normalizedTitle = normalizeGeneratedTitle(title, 60)
    const currentThread = this.threads.get(threadId)
    if (!normalizedTitle || (currentThread && getThreadName(currentThread))) return

    await this.client.request('thread/name/set', {
      threadId,
      name: normalizedTitle
    })

    const updatedThread = this.threads.get(threadId)
    if (updatedThread && getThreadName(updatedThread)) return

    this.updateThread(threadId, (thread) => ({
      ...thread,
      name: normalizedTitle
    }))
    this.emitChatUpdated(threadId)
  }

  private resumeThreadForMutation = async (
    threadId: string,
    options: ProviderTurnOptions | undefined,
    fallbackCwd: string | null
  ): Promise<CodexThread> => {
    const existingThread = this.threads.get(threadId) ?? null
    const resume = await this.client.request<ThreadResumeResponse>('thread/resume', {
      threadId,
      ...getThreadAccessOptions(options)
    })
    const [cwd, name, resumedTurns] = await Promise.all([
      this.resolveThreadCwd(resume.thread, fallbackCwd),
      this.resolveThreadName(resume.thread),
      existingThread ? Promise.resolve<CodexTurn[]>([]) : this.getTurnsForThread(resume.thread)
    ])
    const thread = {
      ...resume.thread,
      name,
      cwd,
      status: existingThread?.status ?? resume.thread.status,
      turns: existingThread
        ? existingThread.turns
        : this.filterRolledBackTurns(threadId, resumedTurns)
    }

    this.cacheThread(thread)
    return thread
  }

  private emitChatUpdated = (threadId: string, metadata?: ProviderChatUpdateMetadata): void => {
    const detail = this.getCachedChatDetail(threadId)
    if (!detail) return

    this.chatUpdatedListeners.forEach((listener) => listener(detail, metadata))
  }

  private scheduleChatUpdated = (threadId: string): void => {
    if (this.chatUpdatedTimers.has(threadId)) return

    const timer = setTimeout(() => {
      this.chatUpdatedTimers.delete(threadId)
      this.emitChatUpdated(threadId)
    }, chatUpdateDebounceMs)

    this.chatUpdatedTimers.set(threadId, timer)
  }

  private updateThread = (
    threadId: string,
    update: (thread: CodexThread) => CodexThread
  ): CodexThread | null => {
    const thread = this.threads.get(threadId)
    if (!thread) return null

    const nextThread = update({
      ...thread,
      updatedAt: nowSeconds()
    })
    this.cacheThread(nextThread)
    return nextThread
  }

  private setThreadStatus = (threadId: string, status: CodexThreadStatus): void => {
    this.updateThread(threadId, (thread) => ({
      ...thread,
      status
    }))
  }

  private setThreadActiveFlag = (
    threadId: string,
    flag: 'waitingOnApproval' | 'waitingOnUserInput',
    enabled: boolean
  ): void => {
    this.updateThread(threadId, (thread) => {
      if (!enabled && thread.status.type !== 'active') return thread

      const activeFlags = thread.status.type === 'active' ? thread.status.activeFlags : []
      const nextFlags = enabled
        ? [...new Set([...activeFlags, flag])]
        : activeFlags.filter((activeFlag) => activeFlag !== flag)
      const status =
        nextFlags.length > 0 || this.getActiveTurnId(threadId)
          ? ({
              type: 'active',
              activeFlags: nextFlags
            } satisfies CodexThreadStatus)
          : ({ type: 'idle' } satisfies CodexThreadStatus)

      return {
        ...thread,
        status
      }
    })
  }

  private getProviderPendingApproval = (threadId: string): ProviderPendingApproval | null => {
    const approval = this.pendingApprovalsByThread.get(threadId)?.[0]
    if (!approval) return null

    return {
      id: String(approval.requestId),
      type: approval.type,
      command: approval.command,
      cwd: approval.cwd,
      reason: approval.reason,
      startedAt: approval.startedAt
    }
  }

  private addPendingApproval = (approval: CodexPendingApproval): void => {
    const pendingApprovals = this.pendingApprovalsByThread.get(approval.threadId) ?? []
    const nextApprovals = [
      ...pendingApprovals.filter(
        (pendingApproval) => pendingApproval.requestId !== approval.requestId
      ),
      approval
    ]

    this.pendingApprovalsByThread.set(approval.threadId, nextApprovals)
    if (approval.turnId) this.activeTurnIds.set(approval.threadId, approval.turnId)
    this.setThreadActiveFlag(approval.threadId, 'waitingOnApproval', true)
    this.emitChatUpdated(approval.threadId)
  }

  private removePendingApproval = (threadId: string, requestId: number): void => {
    const pendingApprovals = this.pendingApprovalsByThread.get(threadId)
    if (!pendingApprovals) return

    const nextApprovals = pendingApprovals.filter(
      (pendingApproval) => pendingApproval.requestId !== requestId
    )

    if (nextApprovals.length > 0) {
      this.pendingApprovalsByThread.set(threadId, nextApprovals)
      return
    }

    this.pendingApprovalsByThread.delete(threadId)
    this.setThreadActiveFlag(threadId, 'waitingOnApproval', false)
  }

  private removePendingApprovalByRequestId = (requestId: number): void => {
    for (const [threadId, pendingApprovals] of this.pendingApprovalsByThread) {
      if (!pendingApprovals.some((approval) => approval.requestId === requestId)) continue
      this.removePendingApproval(threadId, requestId)
      this.emitChatUpdated(threadId)
      return
    }
  }

  private createApprovalResponse = (
    approval: CodexPendingApproval,
    decision: ProviderApprovalDecision | 'cancel'
  ): unknown => {
    if (approval.protocol === 'commandExecution') {
      return {
        decision: decision === 'allow' ? 'accept' : decision === 'cancel' ? 'cancel' : 'decline'
      }
    }

    if (approval.protocol === 'fileChange') {
      return {
        decision: decision === 'allow' ? 'accept' : decision === 'cancel' ? 'cancel' : 'decline'
      }
    }

    return {
      decision: decision === 'allow' ? 'approved' : decision === 'cancel' ? 'abort' : 'denied'
    }
  }

  private cancelPendingApprovals = (threadId: string): void => {
    const pendingApprovals = this.pendingApprovalsByThread.get(threadId)
    if (!pendingApprovals) return

    for (const approval of pendingApprovals) {
      this.client.resolveServerRequest(
        approval.requestId,
        this.createApprovalResponse(approval, 'cancel')
      )
    }

    this.pendingApprovalsByThread.delete(threadId)
    this.setThreadActiveFlag(threadId, 'waitingOnApproval', false)
  }

  private createPendingTurn = (
    turnId: string,
    text: string,
    options?: ProviderTurnOptions
  ): CodexTurn => ({
    id: turnId,
    status: 'inProgress',
    model: getTurnModelOptions(options).model,
    startedAt: nowSeconds(),
    completedAt: null,
    items: [
      {
        type: 'userMessage',
        id: `${turnId}:user`,
        content: createUserInput(text, options?.images, options?.files, options?.skills)
      }
    ]
  })

  private addPendingTurn = (
    threadId: string,
    text: string,
    options?: ProviderTurnOptions
  ): CodexTurn | null => {
    return this.addPendingTurnWithId(threadId, `pending:${Date.now()}`, text, options)
  }

  private addPendingTurnWithId = (
    threadId: string,
    pendingTurnId: string,
    text: string,
    options?: ProviderTurnOptions
  ): CodexTurn | null => {
    const thread = this.threads.get(threadId)
    if (!thread) return null

    const previousPendingTurnId = this.pendingTurnIds.get(threadId)
    const pendingTurn = this.createPendingTurn(pendingTurnId, text, options)
    this.pendingTurnIds.set(threadId, pendingTurnId)

    this.cacheThread({
      ...thread,
      status: { type: 'active', activeFlags: [] },
      updatedAt: nowSeconds(),
      turns: this.insertTurnBeforeQueued(
        thread.turns.filter((turn) => turn.id !== previousPendingTurnId),
        pendingTurn
      )
    })

    return pendingTurn
  }

  private insertTurnBeforeQueued = (turns: CodexTurn[], turn: CodexTurn): CodexTurn[] => {
    const nextTurns = [...turns]
    const queuedTurnIndex = nextTurns.findIndex((candidate) => candidate.status === 'queued')

    if (queuedTurnIndex < 0) nextTurns.push(turn)
    else nextTurns.splice(queuedTurnIndex, 0, turn)

    return nextTurns
  }

  private addQueuedTurn = (
    threadId: string,
    text: string,
    options?: ProviderTurnOptions
  ): QueuedTurn | null => {
    if (!this.threads.has(threadId)) return null

    const createdAt = Date.now()
    const queuedTurnId = `queued:${createdAt}:${++localTurnSequence}`
    const queuedTurn = {
      id: queuedTurnId,
      text,
      createdAt,
      options: options ? { ...options } : undefined
    } satisfies QueuedTurn
    const queuedTurns = this.queuedTurnsByThread.get(threadId) ?? []
    this.queuedTurnsByThread.set(threadId, [...queuedTurns, queuedTurn])

    return queuedTurn
  }

  private removePendingTurn = (threadId: string, pendingTurnId: string): void => {
    this.pendingTurnIds.delete(threadId)
    this.updateThread(threadId, (thread) => ({
      ...thread,
      turns: thread.turns.filter((turn) => turn.id !== pendingTurnId)
    }))
    this.emitChatUpdated(threadId)
  }

  private hidePendingMessage = (threadId: string, messageId: string): boolean => {
    const hiddenMessageIds = this.hiddenPendingMessageIdsByThread.get(threadId) ?? new Set<string>()
    if (hiddenMessageIds.has(messageId)) return false

    hiddenMessageIds.add(messageId)
    this.hiddenPendingMessageIdsByThread.set(threadId, hiddenMessageIds)
    return true
  }

  private removeHiddenPendingMessagesForTurnIds = (
    threadId: string,
    turnIds: Set<string>
  ): void => {
    const hiddenMessageIds = this.hiddenPendingMessageIdsByThread.get(threadId)
    if (!hiddenMessageIds) return

    for (const messageId of hiddenMessageIds) {
      if (Array.from(turnIds).some((turnId) => messageId.startsWith(`${turnId}:`))) {
        hiddenMessageIds.delete(messageId)
      }
    }

    if (hiddenMessageIds.size === 0) this.hiddenPendingMessageIdsByThread.delete(threadId)
  }

  private removeQueuedTurns = (threadId: string, turnIds: Set<string>): void => {
    const queuedTurns = this.queuedTurnsByThread.get(threadId)
    if (!queuedTurns) return

    const nextQueuedTurns = queuedTurns.filter((turn) => !turnIds.has(turn.id))
    if (nextQueuedTurns.length > 0) this.queuedTurnsByThread.set(threadId, nextQueuedTurns)
    else this.queuedTurnsByThread.delete(threadId)
  }

  private takeQueuedTurn = (threadId: string, turnId: string): QueuedTurn | null => {
    const queuedTurns = this.queuedTurnsByThread.get(threadId)
    const queuedTurn = queuedTurns?.find((turn) => turn.id === turnId) ?? null
    if (!queuedTurns || !queuedTurn) return null

    const nextQueuedTurns = queuedTurns.filter((turn) => turn.id !== turnId)
    if (nextQueuedTurns.length > 0) this.queuedTurnsByThread.set(threadId, nextQueuedTurns)
    else this.queuedTurnsByThread.delete(threadId)

    this.removeSyntheticTurn(threadId, turnId)
    return queuedTurn
  }

  private removeSyntheticTurn = (threadId: string, turnId: string): boolean => {
    const thread = this.threads.get(threadId)
    if (!thread?.turns.some((turn) => turn.id === turnId)) return false

    this.updateThread(threadId, (currentThread) => ({
      ...currentThread,
      turns: currentThread.turns.filter((turn) => turn.id !== turnId)
    }))

    return true
  }

  private removeQueuedTurn = (threadId: string, turnId: string): boolean => {
    const queuedTurn = this.takeQueuedTurn(threadId, turnId)
    return Boolean(queuedTurn) || this.removeSyntheticTurn(threadId, turnId)
  }

  private editQueuedTurn = (
    threadId: string,
    turnId: string,
    text: string,
    options?: ProviderTurnOptions
  ): boolean => {
    const queuedTurns = this.queuedTurnsByThread.get(threadId)
    if (!queuedTurns?.some((turn) => turn.id === turnId)) return false

    this.queuedTurnsByThread.set(
      threadId,
      queuedTurns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              text,
              options: options
                ? {
                    ...options,
                    files: options.files ?? turn.options?.files,
                    images: options.images ?? turn.options?.images
                  }
                : turn.options
            }
          : turn
      )
    )

    return true
  }

  private removeTurnItem = (threadId: string, turnId: string, itemId: string): boolean => {
    const thread = this.threads.get(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!turn?.items.some((item) => item.id === itemId)) return false

    this.updateThread(threadId, (currentThread) => ({
      ...currentThread,
      turns: currentThread.turns.map((candidate) =>
        candidate.id === turnId
          ? {
              ...candidate,
              items: candidate.items.filter((item) => item.id !== itemId)
            }
          : candidate
      )
    }))

    return true
  }

  private addWaitingSteeringMessage = (
    threadId: string,
    turnId: string,
    text: string,
    options?: ProviderTurnOptions
  ): SteeringMessage | null => {
    if (!this.threads.has(threadId)) return null

    const createdAt = Date.now()
    const itemId = `steer:${createdAt}:${++localTurnSequence}`
    const steeringMessage = {
      id: `${turnId}:${itemId}`,
      itemId,
      turnId,
      text,
      createdAt,
      status: 'waiting',
      options: options ? { ...options } : undefined
    } satisfies SteeringMessage

    const steeringMessages = this.steeringMessagesByThread.get(threadId) ?? []
    this.steeringMessagesByThread.set(threadId, [...steeringMessages, steeringMessage])
    return steeringMessage
  }

  private markWaitingSteeringMessagePending = (
    threadId: string,
    messageId: string,
    turnId: string
  ): SteeringMessage | null => {
    const steeringMessage = this.getSteeringMessage(threadId, messageId)
    if (!steeringMessage || steeringMessage.status !== 'waiting') return null

    // Keep the message outside the turn until Codex echoes its client id. The server item
    // provides the authoritative position after all output from the previous continuation.
    const nextMessage = {
      ...steeringMessage,
      id: `${turnId}:${steeringMessage.itemId}`,
      turnId,
      status: 'pending'
    } satisfies SteeringMessage

    this.updateSteeringMessages(threadId, (messages) =>
      messages.map((message) => (message.id === messageId ? nextMessage : message))
    )

    return nextMessage
  }

  private getPendingSteeringMessageIds = (threadId: string): Set<string> => {
    const steeringMessages = this.steeringMessagesByThread.get(threadId) ?? []
    return new Set(
      steeringMessages
        .filter((steeringMessage) => steeringMessage.status === 'pending')
        .map((steeringMessage) => steeringMessage.id)
    )
  }

  private hasPendingSteeringMessage = (threadId: string): boolean =>
    (this.steeringMessagesByThread.get(threadId) ?? []).some(
      (steeringMessage) => steeringMessage.status !== 'sent'
    )

  private hasWaitingSteeringMessageForTurn = (threadId: string, turnId: string): boolean =>
    (this.steeringMessagesByThread.get(threadId) ?? []).some(
      (steeringMessage) => steeringMessage.turnId === turnId && steeringMessage.status === 'waiting'
    )

  private getSteeringMessage = (threadId: string, messageId: string): SteeringMessage | null =>
    this.steeringMessagesByThread.get(threadId)?.find((message) => message.id === messageId) ?? null

  private updateSteeringMessages = (
    threadId: string,
    update: (steeringMessages: SteeringMessage[]) => SteeringMessage[]
  ): void => {
    const steeringMessages = this.steeringMessagesByThread.get(threadId) ?? []
    const nextSteeringMessages = update(steeringMessages)
    if (nextSteeringMessages.length > 0) {
      this.steeringMessagesByThread.set(threadId, nextSteeringMessages)
    } else {
      this.steeringMessagesByThread.delete(threadId)
    }
  }

  private takeSteeringMessage = (threadId: string, messageId: string): SteeringMessage | null => {
    const steeringMessages = this.steeringMessagesByThread.get(threadId) ?? []
    const steeringMessage = steeringMessages.find((message) => message.id === messageId) ?? null
    if (!steeringMessage) return null

    this.updateSteeringMessages(threadId, (messages) =>
      messages.filter((message) => message.id !== messageId)
    )
    if (steeringMessage.status !== 'waiting') {
      this.removeTurnItem(threadId, steeringMessage.turnId, steeringMessage.itemId)
    }
    this.hidePendingMessage(threadId, messageId)
    return steeringMessage
  }

  private removeSteeringMessage = (threadId: string, messageId: string): boolean => {
    const steeringMessage = this.takeSteeringMessage(threadId, messageId)
    if (!steeringMessage) return false

    return true
  }

  private markSteeringMessagesSentForTurn = (threadId: string, turnId: string): void => {
    this.updateSteeringMessages(threadId, (messages) =>
      messages.map((message) =>
        message.turnId === turnId && message.status !== 'waiting'
          ? {
              ...message,
              status: 'sent'
            }
          : message
      )
    )
  }

  private editSteeringMessage = (
    threadId: string,
    messageId: string,
    text: string,
    options?: ProviderTurnOptions
  ): boolean => {
    const steeringMessage =
      this.steeringMessagesByThread
        .get(threadId)
        ?.find((message) => message.id === messageId && message.status !== 'sent') ?? null
    if (!steeringMessage) return false

    this.updateSteeringMessages(threadId, (messages) =>
      messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              text,
              options: options
                ? {
                    ...options,
                    files: options.files ?? message.options?.files,
                    images: options.images ?? message.options?.images
                  }
                : message.options
            }
          : message
      )
    )
    return true
  }

  private updateSteeringMessageTurn = (
    threadId: string,
    messageId: string,
    turnId: string
  ): string | null => {
    const steeringMessage =
      this.steeringMessagesByThread.get(threadId)?.find((message) => message.id === messageId) ??
      null
    if (!steeringMessage) return null

    const nextMessageId = `${turnId}:${steeringMessage.itemId}`
    this.updateSteeringMessages(threadId, (messages) =>
      messages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              id: nextMessageId,
              turnId
            }
          : message
      )
    )

    return nextMessageId
  }

  private removeSteeringMessageForThread = (threadId: string): boolean =>
    this.steeringMessagesByThread.delete(threadId)

  private removeSteeringMessageForTurn = (threadId: string, turnId: string): boolean => {
    const steeringMessages = this.steeringMessagesByThread.get(threadId)
    if (
      !steeringMessages?.some(
        (message) => message.turnId === turnId && message.status !== 'waiting'
      )
    ) {
      return false
    }

    this.updateSteeringMessages(threadId, (messages) =>
      messages.filter((message) => message.turnId !== turnId || message.status === 'waiting')
    )
    return true
  }

  private removeSteeringMessagesForTurnIds = (threadId: string, turnIds: Set<string>): void => {
    this.updateSteeringMessages(threadId, (messages) =>
      messages.filter((message) => !turnIds.has(message.turnId))
    )
  }

  private getProviderPendingMessages = (threadId: string): ProviderPendingMessage[] => {
    const queuedTurns = this.queuedTurnsByThread.get(threadId) ?? []
    const unanchoredSteeringMessages = (this.steeringMessagesByThread.get(threadId) ?? []).filter(
      (steeringMessage) => steeringMessage.status !== 'sent'
    )
    const hiddenMessageIds = this.hiddenPendingMessageIdsByThread.get(threadId)

    return [
      ...unanchoredSteeringMessages
        .filter((steeringMessage) => !hiddenMessageIds?.has(steeringMessage.id))
        .map((steeringMessage) => ({
          type: 'pendingMessage' as const,
          id: steeringMessage.id,
          kind: 'steering' as const,
          content: steeringMessage.text,
          attachments: getMessageAttachments(steeringMessage.options),
          createdAt: steeringMessage.createdAt
        })),
      ...queuedTurns
        .filter((queuedTurn) => !hiddenMessageIds?.has(queuedTurn.id))
        .map((queuedTurn) => ({
          type: 'pendingMessage' as const,
          id: queuedTurn.id,
          kind: 'queued' as const,
          content: queuedTurn.text,
          attachments: getMessageAttachments(queuedTurn.options),
          createdAt: queuedTurn.createdAt
        }))
    ]
  }

  private getRenderableTurns = (thread: CodexThread): CodexTurn[] =>
    thread.turns.filter((turn) => turn.status !== 'queued')

  private setTurnStatus = (threadId: string, turnId: string, status: string): void => {
    this.updateThread(threadId, (thread) => ({
      ...thread,
      turns: thread.turns.map((turn) => (turn.id === turnId ? { ...turn, status } : turn))
    }))
  }

  private startNextQueuedTurn = (threadId: string): void => {
    if (this.queuedTurnStartThreads.has(threadId) || this.getActiveTurnId(threadId)) return

    const queuedTurn = this.queuedTurnsByThread.get(threadId)?.[0]
    if (!queuedTurn) return

    this.queuedTurnStartThreads.add(threadId)
    void this.runQueuedTurn(threadId, queuedTurn).finally(() => {
      this.queuedTurnStartThreads.delete(threadId)
    })
  }

  private runQueuedTurn = async (threadId: string, queuedTurn: QueuedTurn): Promise<void> => {
    const queuedTurns = this.queuedTurnsByThread.get(threadId)
    if (!queuedTurns || queuedTurns[0]?.id !== queuedTurn.id || this.getActiveTurnId(threadId)) {
      return
    }

    const nextQueuedTurns = queuedTurns.slice(1)
    if (nextQueuedTurns.length > 0) this.queuedTurnsByThread.set(threadId, nextQueuedTurns)
    else this.queuedTurnsByThread.delete(threadId)

    const pendingTurn = this.addPendingTurnWithId(
      threadId,
      queuedTurn.id,
      queuedTurn.text,
      queuedTurn.options
    )
    this.setThreadStatus(threadId, { type: 'active', activeFlags: [] })
    this.emitChatUpdated(threadId)

    try {
      await this.startCodexTurn(threadId, queuedTurn.text, queuedTurn.options, queuedTurn.id)
      this.emitChatUpdated(threadId)
    } catch {
      this.pendingTurnIds.delete(threadId)
      if (pendingTurn) this.setTurnStatus(threadId, queuedTurn.id, 'failed')
      this.setThreadStatus(threadId, { type: 'idle' })
      this.emitChatUpdated(threadId)
    }
  }

  private getActiveTurnId = (threadId: string): string | null => {
    const thread = this.threads.get(threadId)
    const activeThreadTurnId = thread?.turns.findLast((turn) => turn.status === 'inProgress')?.id
    if (activeThreadTurnId) return activeThreadTurnId

    return this.activeTurnIds.get(threadId) ?? null
  }

  private getAgentTerminalItem = (
    threadId: string,
    turnId: string,
    itemId: string
  ): CodexThreadItem | null =>
    this.threads
      .get(threadId)
      ?.turns.find((turn) => turn.id === turnId)
      ?.items.find((item) => item.id === itemId) ?? null

  private hasAgentTerminalProcess = (threadId: string, processId: string): boolean =>
    Boolean(
      this.threads
        .get(threadId)
        ?.turns.some((turn) =>
          turn.items.some(
            (item) => item.type === 'commandExecution' && item.processId === processId
          )
        )
    )

  private emitAgentTerminalData = (
    event: Omit<ProviderAgentTerminalDataEvent, 'providerId'>
  ): void => {
    const providerEvent = {
      ...event,
      providerId: this.id
    }
    this.agentTerminalDataListeners.forEach((listener) => listener(providerEvent))
  }

  private markTurnInterrupted = (threadId: string, turnId: string): void => {
    this.updateThread(threadId, (thread) => ({
      ...thread,
      turns: thread.turns.map((turn) =>
        turn.id === turnId ? { ...turn, status: 'interrupted' } : turn
      )
    }))
  }

  private markTurnCompleted = (threadId: string, turnId: string): void => {
    this.updateThread(threadId, (thread) => ({
      ...thread,
      turns: thread.turns.map((turn) =>
        turn.id === turnId ? { ...turn, status: 'completed' } : turn
      )
    }))
  }

  private mergeItem = (previous: CodexThreadItem, next: CodexThreadItem): CodexThreadItem => ({
    ...previous,
    ...next,
    content:
      next.content && next.content.length > 0 ? next.content : (previous.content ?? next.content),
    text: next.text ?? previous.text,
    command: next.command ?? previous.command,
    processId: next.processId ?? previous.processId,
    server: next.server ?? previous.server,
    tool: next.tool ?? previous.tool,
    namespace: next.namespace ?? previous.namespace,
    query: next.query ?? previous.query,
    cwd: next.cwd ?? previous.cwd,
    aggregatedOutput: next.aggregatedOutput ?? previous.aggregatedOutput,
    result: next.result ?? previous.result,
    error: next.error ?? previous.error,
    customToolName: next.customToolName ?? previous.customToolName,
    customToolInput: next.customToolInput ?? previous.customToolInput,
    customToolOutput: next.customToolOutput ?? previous.customToolOutput,
    changes: next.changes && next.changes.length > 0 ? next.changes : previous.changes,
    summary: next.summary && next.summary.length > 0 ? next.summary : previous.summary,
    status: next.status ?? previous.status,
    rawToolData: next.rawToolData ?? previous.rawToolData
  })

  private createFileChangeItem = (item: CodexThreadItem): CodexThreadItem => ({
    ...item,
    type: 'fileChange',
    changes: item.changes ?? [],
    rawToolData: item.rawToolData ?? [item]
  })

  private createNestedCustomToolItem = (
    item: CodexThreadItem,
    call: { name: string; offset: number },
    index: number,
    callCount: number
  ): CodexThreadItem => ({
    ...item,
    type: 'customToolCall',
    id: callCount === 1 ? item.id : `${item.id}:${index}`,
    customToolName: call.name,
    customToolInput: item.command?.slice(call.offset) ?? null,
    customToolOutput: item.customToolOutput ?? item.aggregatedOutput,
    rawToolData: item.rawToolData ?? [item]
  })

  private normalizeLiveItem = (item: CodexThreadItem): CodexThreadItem[] => {
    if (item.type === 'fileChange') return [item]

    if (item.type === 'customToolCall') {
      if (item.customToolName === 'apply_patch') return [this.createFileChangeItem(item)]

      const input = item.customToolInput ?? ''
      if (input && isPatchToolCall(input)) return [this.createFileChangeItem(item)]
      return [item]
    }

    if (item.type !== 'commandExecution' || !item.command) return [item]

    const nestedCalls = getNestedToolCalls(item.command, { includeQuoted: true })
    if (isPatchToolCall(item.command, nestedCalls)) return [this.createFileChangeItem(item)]
    if (nestedCalls.length === 0) return [item]

    return nestedCalls.map((call, index) =>
      this.createNestedCustomToolItem(item, call, index, nestedCalls.length)
    )
  }

  private normalizeLiveTurn = (turn: CodexTurn): CodexTurn => ({
    ...turn,
    items: turn.items.flatMap((item) => this.normalizeLiveItem(item))
  })

  private applyLiveItemStatus = (
    item: CodexThreadItem,
    status: NonNullable<CodexThreadItem['status']>
  ): CodexThreadItem => ({
    ...item,
    status
  })

  private getCarriedItems = (
    threadId: string,
    turnId: string,
    previousItems: CodexThreadItem[],
    nextItems: CodexThreadItem[]
  ): CodexThreadItem[] => {
    const shouldDropLocalTurnStartMessage = hasUserMessage(nextItems)
    const turnSteeringMessages = (this.steeringMessagesByThread.get(threadId) ?? []).filter(
      (message) => message.turnId === turnId && message.status !== 'sent'
    )
    const unmatchedSteeringMessages = [...turnSteeringMessages]
    const replacedLocalSteeringItemIds = new Set<string>()
    const replacementSteeringMessages = new Map<string, SteeringMessage>()

    for (const item of nextItems) {
      if (item.type !== 'userMessage' || isLocalSteeringUserMessage(item)) {
        continue
      }

      const clientId = getCodexUserMessageClientId(item)
      const steeringMessageIndex = unmatchedSteeringMessages.findIndex(
        (message) => message.itemId === clientId
      )
      if (steeringMessageIndex < 0) continue

      const [steeringMessage] = unmatchedSteeringMessages.splice(steeringMessageIndex, 1)
      replacedLocalSteeringItemIds.add(steeringMessage.itemId)
      replacementSteeringMessages.set(steeringMessage.id, {
        ...steeringMessage,
        id: `${turnId}:${item.id}`,
        itemId: item.id,
        status: 'sent'
      })
    }

    if (replacementSteeringMessages.size > 0) {
      this.updateSteeringMessages(threadId, (messages) =>
        messages.map((message) => replacementSteeringMessages.get(message.id) ?? message)
      )
    }

    return previousItems.filter((item) => {
      if (isLocalTurnStartUserMessage(item)) return !shouldDropLocalTurnStartMessage
      if (isLocalSteeringUserMessage(item)) return !replacedLocalSteeringItemIds.has(item.id)
      return true
    })
  }

  private mergeTurn = (threadId: string, previous: CodexTurn, next: CodexTurn): CodexTurn => {
    const previousCarriedItems = this.getCarriedItems(
      threadId,
      previous.id,
      previous.items,
      next.items
    )
    const nextItems = new Map(next.items.map((item) => [item.id, item]))
    const previousItemIds = new Set(previousCarriedItems.map((item) => item.id))
    const mergedItems = [
      ...previousCarriedItems.map((item) => {
        const nextItem = nextItems.get(item.id)
        return nextItem ? this.mergeItem(item, nextItem) : item
      }),
      // Completion notifications can contain only the final item. Keep the streamed order so
      // that partial snapshots cannot move the final response ahead of the turn's user message.
      ...next.items.filter((item) => !previousItemIds.has(item.id))
    ]

    return {
      ...previous,
      ...next,
      model: next.model ?? previous.model,
      status: next.status ?? previous.status,
      items: mergedItems
    }
  }

  private replacePendingTurn = (
    threadId: string,
    pendingTurnId: string | null,
    nextTurn: CodexTurn
  ): void => {
    this.updateThread(threadId, (thread) => {
      const pendingTurnIndex = pendingTurnId
        ? thread.turns.findIndex((turn) => turn.id === pendingTurnId)
        : -1
      const existingTurnIndex = thread.turns.findIndex((turn) => turn.id === nextTurn.id)
      const pendingTurn = pendingTurnIndex >= 0 ? thread.turns[pendingTurnIndex] : null
      const existingTurn = existingTurnIndex >= 0 ? thread.turns[existingTurnIndex] : null
      const previousTurn = pendingTurn
        ? {
            ...pendingTurn,
            id: nextTurn.id
          }
        : existingTurn

      const mergedTurn = previousTurn ? this.mergeTurn(threadId, previousTurn, nextTurn) : nextTurn
      const removedIndexes = new Set(
        [pendingTurnIndex, existingTurnIndex].filter((index) => index >= 0)
      )
      const turns = thread.turns.filter((_, index) => !removedIndexes.has(index))
      const insertIndex =
        pendingTurnIndex >= 0
          ? pendingTurnIndex
          : existingTurnIndex >= 0
            ? existingTurnIndex
            : turns.length
      const boundedInsertIndex = Math.min(insertIndex, turns.length)

      turns.splice(boundedInsertIndex, 0, mergedTurn)

      return {
        ...thread,
        turns
      }
    })
  }

  private upsertTurn = (threadId: string, turn: CodexTurn): void => {
    this.updateThread(threadId, (thread) => {
      const turnIndex = thread.turns.findIndex((candidate) => candidate.id === turn.id)
      const turns = [...thread.turns]
      const previousTurn = turnIndex >= 0 ? turns[turnIndex] : null
      const nextTurn = previousTurn ? this.mergeTurn(threadId, previousTurn, turn) : turn

      if (turnIndex >= 0) turns[turnIndex] = nextTurn
      else turns.push(nextTurn)

      return {
        ...thread,
        turns
      }
    })
  }

  private upsertItems = (threadId: string, turnId: string, items: CodexThreadItem[]): void => {
    this.updateTurnItems(threadId, turnId, (currentItems) => {
      const nextItems = this.getCarriedItems(threadId, turnId, currentItems, items)

      for (const item of items) {
        const itemIndex = nextItems.findIndex((candidate) => candidate.id === item.id)
        if (itemIndex < 0) {
          nextItems.push(item)
          continue
        }

        nextItems[itemIndex] = this.mergeItem(nextItems[itemIndex], item)
      }

      return nextItems
    })
  }

  private updateItem = (
    threadId: string,
    turnId: string,
    itemId: string,
    update: (item: CodexThreadItem | null) => CodexThreadItem | null
  ): void => {
    this.updateTurnItems(threadId, turnId, (items) => {
      const itemIndex = items.findIndex((candidate) => candidate.id === itemId)
      const nextItem = update(itemIndex >= 0 ? items[itemIndex] : null)
      if (!nextItem) return items

      if (itemIndex < 0) return [...items, nextItem]

      const nextItems = [...items]
      nextItems[itemIndex] = nextItem
      return nextItems
    })
  }

  private updateTurnItems = (
    threadId: string,
    turnId: string,
    update: (items: CodexThreadItem[]) => CodexThreadItem[]
  ): CodexThread | null => {
    if (this.isRolledBackTurn(threadId, turnId)) return null

    return this.updateThread(threadId, (thread) => {
      const turnIndex = thread.turns.findIndex((candidate) => candidate.id === turnId)
      const turns = [...thread.turns]
      const turn =
        turnIndex >= 0
          ? turns[turnIndex]
          : {
              id: turnId,
              status: 'inProgress',
              items: []
            }

      turns[turnIndex >= 0 ? turnIndex : turns.length] = {
        ...turn,
        items: update(turn.items)
      }

      return {
        ...thread,
        turns
      }
    })
  }

  private handleTurnNotification = (
    notification: RpcNotification,
    params: TurnNotificationParams
  ): void => {
    const threadId = getThreadId(params)
    if (!threadId || !params.turn || typeof params.turn !== 'object') return
    const liveTurn = params.turn as CodexTurn
    const normalizedTurn = this.normalizeLiveTurn({
      ...liveTurn,
      status:
        notification.method === 'turn/completed'
          ? (liveTurn.status ?? 'completed')
          : liveTurn.status
    })
    let turn =
      notification.method === 'turn/completed'
        ? {
            ...normalizedTurn,
            items: normalizedTurn.items.map((item) => this.applyLiveItemStatus(item, 'finished'))
          }
        : normalizedTurn
    const wasManuallyStoppedTurn =
      notification.method === 'turn/completed' && this.takeManuallyStoppedTurn(threadId, turn.id)
    if (wasManuallyStoppedTurn && turn.status === 'completed') {
      turn = {
        ...turn,
        status: 'interrupted'
      }
    }

    if (this.isRolledBackTurn(threadId, turn.id)) {
      if (notification.method !== 'turn/started' || !this.pendingTurnIds.has(threadId)) return
      this.allowRolledBackTurn(threadId, turn.id)
    }

    if (notification.method === 'turn/started') {
      this.activeTurnIds.set(threadId, turn.id)
      this.setThreadStatus(threadId, { type: 'active', activeFlags: [] })
    }
    if (notification.method === 'turn/completed') {
      if (this.activeTurnIds.get(threadId) === turn.id) this.activeTurnIds.delete(threadId)
      this.pendingApprovalsByThread.delete(threadId)
      this.setThreadStatus(threadId, { type: 'idle' })
    }

    const pendingTurnId =
      notification.method === 'turn/started' ? (this.pendingTurnIds.get(threadId) ?? null) : null

    if (pendingTurnId) {
      this.replacePendingTurn(threadId, pendingTurnId, turn)
      this.pendingTurnIds.delete(threadId)
    } else {
      this.upsertTurn(threadId, turn)
    }

    if (notification.method === 'turn/completed') {
      this.emitChatUpdated(threadId, { turnCompleted: true })
    } else {
      this.scheduleChatUpdated(threadId)
    }

    if (notification.method === 'turn/completed') {
      this.removeSteeringMessageForTurn(threadId, turn.id)
      if (
        turn.status === 'completed' &&
        !wasManuallyStoppedTurn &&
        !this.hasWaitingSteeringMessageForTurn(threadId, turn.id)
      ) {
        this.startNextQueuedTurn(threadId)
      }
    }
  }

  private handleItemNotification = (
    notification: RpcNotification,
    params: ItemNotificationParams
  ): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    if (!threadId || !turnId || !params.item || typeof params.item !== 'object') return

    const status = notification.method === 'item/started' ? 'running' : 'finished'
    const items = this.normalizeLiveItem(params.item as CodexThreadItem).map((item) =>
      this.applyLiveItemStatus(item, status)
    )

    this.upsertItems(threadId, turnId, items)
    this.scheduleChatUpdated(threadId)
  }

  private handleAgentMessageDelta = (params: AgentMessageDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    if (!threadId || !turnId || !itemId || delta == null) return

    this.updateItem(threadId, turnId, itemId, (item) => ({
      ...(item?.type === 'agentMessage' ? item : { type: 'agentMessage', id: itemId }),
      text: `${item?.type === 'agentMessage' ? (item.text ?? '') : ''}${delta}`,
      phase: item?.type === 'agentMessage' ? (item.phase ?? null) : null
    }))
    this.scheduleChatUpdated(threadId)
  }

  private handlePlanDelta = (params: AgentMessageDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    if (!threadId || !turnId || !itemId || delta == null) return

    this.updateItem(threadId, turnId, itemId, (item) => ({
      ...(item?.type === 'plan' ? item : { type: 'plan', id: itemId }),
      text: `${item?.type === 'plan' ? (item.text ?? '') : ''}${delta}`
    }))
    this.scheduleChatUpdated(threadId)
  }

  private handleReasoningSummaryDelta = (params: ReasoningSummaryDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    const summaryIndex =
      typeof params.summaryIndex === 'number' && Number.isInteger(params.summaryIndex)
        ? params.summaryIndex
        : null
    if (!threadId || !turnId || !itemId || delta == null || summaryIndex == null) return

    this.updateItem(threadId, turnId, itemId, (item) => {
      const summary = item?.summary ? [...item.summary] : []
      summary[summaryIndex] = `${summary[summaryIndex] ?? ''}${delta}`

      return {
        ...(item?.type === 'reasoning' ? item : { type: 'reasoning', id: itemId }),
        summary
      }
    })
    this.scheduleChatUpdated(threadId)
  }

  private handleCommandOutputDelta = (params: AgentMessageDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    if (!threadId || !turnId || !itemId || delta == null) return

    this.updateItem(threadId, turnId, itemId, (item) => {
      if (!item) {
        return { type: 'commandExecution', id: itemId, status: 'running', aggregatedOutput: delta }
      }

      if (item.type === 'commandExecution') {
        return {
          ...item,
          status: item.status ?? 'running',
          aggregatedOutput: `${item.aggregatedOutput ?? ''}${delta}`
        }
      }

      if (item.type === 'customToolCall') {
        return {
          ...item,
          status: item.status ?? 'running',
          customToolOutput: `${
            typeof item.customToolOutput === 'string' ? item.customToolOutput : ''
          }${delta}`
        }
      }

      return item
    })
    const item = this.getAgentTerminalItem(threadId, turnId, itemId)
    this.emitAgentTerminalData({
      chatId: threadId,
      turnId,
      itemId,
      processId: item?.processId ?? null,
      source: 'output',
      data: delta
    })
    this.scheduleChatUpdated(threadId)
  }

  private handleTerminalInteraction = (params: TerminalInteractionParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const processId = getOptionalStringValue(params.processId)
    const stdin = typeof params.stdin === 'string' ? params.stdin : null
    if (!threadId || !turnId || !itemId || stdin == null) return

    this.emitAgentTerminalData({
      chatId: threadId,
      turnId,
      itemId,
      processId,
      source: 'input',
      data: stdin
    })
  }

  private handleFileChangePatchUpdated = (params: FileChangePatchParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    if (!threadId || !turnId || !itemId || !Array.isArray(params.changes)) return

    this.updateItem(threadId, turnId, itemId, (item) => ({
      ...(item ?? { id: itemId }),
      type: 'fileChange',
      changes: params.changes as CodexThreadItem['changes'],
      rawToolData: item?.rawToolData ?? (item ? [item] : undefined)
    }))
    this.scheduleChatUpdated(threadId)
  }

  private handleRawResponseItemCompleted = (params: RawResponseItemParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const message = getRawResponseMessage(params.item)
    if (!threadId || !turnId || !message) return

    this.updateTurnItems(threadId, turnId, (items) => {
      const finalMessageIndex = items.findLastIndex(
        (item) =>
          item.type === 'agentMessage' &&
          (item.phase === 'final_answer' || item.phase == null || item.text === message.text)
      )

      if (finalMessageIndex >= 0) {
        const nextItems = [...items]
        nextItems[finalMessageIndex] = {
          ...nextItems[finalMessageIndex],
          text: message.text,
          phase: message.phase ?? nextItems[finalMessageIndex].phase ?? 'final_answer'
        }
        return nextItems
      }

      return [
        ...items,
        {
          type: 'agentMessage',
          id: `${turnId}:raw-final`,
          text: message.text,
          phase: message.phase ?? 'final_answer'
        }
      ]
    })
    this.scheduleChatUpdated(threadId)
  }

  private handleThreadNotification = (
    notification: RpcNotification,
    params: ThreadNotificationParams
  ): void => {
    const threadId = getThreadId(params)
    if (!threadId) return

    if (notification.method === 'thread/status/changed' && params.status) {
      this.setThreadStatus(threadId, params.status as CodexThreadStatus)
    }

    if (notification.method === 'thread/name/updated') {
      const name = getThreadNotificationName(params)
      this.updateThread(threadId, (thread) => ({
        ...thread,
        name
      }))
    }

    this.scheduleChatUpdated(threadId)
  }

  private handleThreadTokenUsage = (params: Record<string, unknown>): void => {
    const threadId = getThreadId(params)
    if (!threadId) return

    const contextUsage = normalizeChatContextUsage(params.tokenUsage)
    if (!contextUsage) return

    this.contextUsageByThread.set(threadId, contextUsage)
    this.scheduleChatUpdated(threadId)
  }

  private handleCommandExecutionApprovalRequest = (request: RpcRequest): void => {
    const params = getRecordValue(request.params)
    if (!params) throw new Error('Invalid command approval request params')

    this.addPendingApproval({
      requestId: request.id,
      protocol: 'commandExecution',
      type: 'command',
      threadId: requireStringValue(params.threadId, 'threadId'),
      turnId: requireStringValue(params.turnId, 'turnId'),
      itemId: requireStringValue(params.itemId, 'itemId'),
      command: getOptionalStringValue(params.command),
      cwd: getOptionalStringValue(params.cwd),
      reason: getOptionalStringValue(params.reason),
      startedAt: getOptionalNumberValue(params.startedAtMs) ?? Date.now()
    })
  }

  private handleFileChangeApprovalRequest = (request: RpcRequest): void => {
    const params = getRecordValue(request.params)
    if (!params) throw new Error('Invalid file change approval request params')

    this.addPendingApproval({
      requestId: request.id,
      protocol: 'fileChange',
      type: 'fileChange',
      threadId: requireStringValue(params.threadId, 'threadId'),
      turnId: requireStringValue(params.turnId, 'turnId'),
      itemId: requireStringValue(params.itemId, 'itemId'),
      command: null,
      cwd: getOptionalStringValue(params.grantRoot),
      reason: getOptionalStringValue(params.reason),
      startedAt: getOptionalNumberValue(params.startedAtMs) ?? Date.now()
    })
  }

  private handleLegacyExecCommandApprovalRequest = (request: RpcRequest): void => {
    const params = getRecordValue(request.params)
    if (!params) throw new Error('Invalid legacy command approval request params')

    this.addPendingApproval({
      requestId: request.id,
      protocol: 'execCommand',
      type: 'command',
      threadId: requireStringValue(params.conversationId, 'conversationId'),
      turnId: null,
      itemId: getOptionalStringValue(params.callId),
      command: formatLegacyCommand(params.command),
      cwd: getOptionalStringValue(params.cwd),
      reason: getOptionalStringValue(params.reason),
      startedAt: Date.now()
    })
  }

  private handleLegacyApplyPatchApprovalRequest = (request: RpcRequest): void => {
    const params = getRecordValue(request.params)
    if (!params) throw new Error('Invalid legacy patch approval request params')

    this.addPendingApproval({
      requestId: request.id,
      protocol: 'applyPatch',
      type: 'fileChange',
      threadId: requireStringValue(params.conversationId, 'conversationId'),
      turnId: null,
      itemId: getOptionalStringValue(params.callId),
      command: null,
      cwd: getOptionalStringValue(params.grantRoot),
      reason: getOptionalStringValue(params.reason),
      startedAt: Date.now()
    })
  }

  private handleServerRequest = (request: RpcRequest): boolean => {
    if (request.method === 'item/commandExecution/requestApproval') {
      this.handleCommandExecutionApprovalRequest(request)
      return true
    }

    if (request.method === 'item/fileChange/requestApproval') {
      this.handleFileChangeApprovalRequest(request)
      return true
    }

    if (request.method === 'execCommandApproval') {
      this.handleLegacyExecCommandApprovalRequest(request)
      return true
    }

    if (request.method === 'applyPatchApproval') {
      this.handleLegacyApplyPatchApprovalRequest(request)
      return true
    }

    return false
  }

  private handleNotification = (notification: RpcNotification): void => {
    const params = notification.params
    if (!params || typeof params !== 'object') return

    if (notification.method === 'turn/started' || notification.method === 'turn/completed') {
      this.handleTurnNotification(notification, params as TurnNotificationParams)
      return
    }

    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      this.handleItemNotification(notification, params as ItemNotificationParams)
      return
    }

    if (notification.method === 'item/agentMessage/delta') {
      this.handleAgentMessageDelta(params as AgentMessageDeltaParams)
      return
    }

    if (notification.method === 'item/plan/delta') {
      this.handlePlanDelta(params as AgentMessageDeltaParams)
      return
    }

    if (notification.method === 'item/reasoning/summaryTextDelta') {
      this.handleReasoningSummaryDelta(params as ReasoningSummaryDeltaParams)
      return
    }

    if (notification.method === 'item/commandExecution/outputDelta') {
      this.handleCommandOutputDelta(params as AgentMessageDeltaParams)
      return
    }

    if (notification.method === 'item/commandExecution/terminalInteraction') {
      this.handleTerminalInteraction(params as TerminalInteractionParams)
      return
    }

    if (notification.method === 'item/fileChange/patchUpdated') {
      this.handleFileChangePatchUpdated(params as FileChangePatchParams)
      return
    }

    if (notification.method === 'rawResponseItem/completed') {
      this.handleRawResponseItemCompleted(params as RawResponseItemParams)
      return
    }

    if (notification.method === 'serverRequest/resolved') {
      const requestId = (params as ServerRequestResolvedParams).requestId
      if (typeof requestId === 'number') this.removePendingApprovalByRequestId(requestId)
      return
    }

    if (
      notification.method === 'thread/status/changed' ||
      notification.method === 'thread/name/updated'
    ) {
      this.handleThreadNotification(notification, params as ThreadNotificationParams)
      return
    }

    if (notification.method === 'thread/tokenUsage/updated') {
      this.handleThreadTokenUsage(params as Record<string, unknown>)
    }
  }
}
