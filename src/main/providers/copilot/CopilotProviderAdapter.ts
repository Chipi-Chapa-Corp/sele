import { PendingMessageEdits } from '../PendingMessageEdits'
import {
  PersistentPendingMessages,
  type PersistedPendingMessage
} from '../PersistentPendingMessages'
import { sqlitePendingMessageBackend } from '../../database/pendingMessages'
import {
  raceLinkedChatCancellation,
  requireLinkedChatSummary,
  throwIfLinkedChatCancelled
} from '../linkedChatContext'
import type { McpAppConnection } from '../../../shared/mcpApps'
import { copilotAccountDisplayName } from '../AccountDisplayName'
import { encodeCopilotHistory } from '../NativeHistoryImport'
import { nativeHistoryFile } from '../NativeHistoryFile'
import { record as mcpRecord } from '../../../shared/elicitation'
import { createProviderElicitation, getProviderElicitationResult } from '../ProviderElicitation'
import { TokenUsageReporter } from '../TokenUsageReporter.ts'
import { normalizeTokenUsage } from '../../../shared/tokenUsage.ts'
import { copilotPriceRates, setNativeModelPricing } from '../modelPricing/TokenPricing'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { randomUUID } from 'node:crypto'
import { getBrowserAutomationService } from '../../browser/BrowserAutomation'
import { createBrowserMcpServer, type BrowserMcpIntegration } from '../../browser/BrowserMcpServer'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import {
  CopilotClient,
  RuntimeConnection,
  type CopilotSession,
  type ModelInfo,
  type PermissionRequest,
  type PermissionRequestResult,
  type SessionConfig,
  type SessionEvent,
  type SessionMetadata
} from '@github/copilot-sdk'
import type {
  ProviderAccountUsage,
  ProviderActiveSendMode,
  ProviderAgentMode,
  ProviderAgentModeOption,
  ProviderApprovalDecision,
  ProviderApprovalModeOption,
  ProviderApp,
  ProviderChat,
  ProviderChatContextUsage,
  ProviderChatDetail,
  ProviderChatGoal,
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderLoginResult,
  ProviderModel,
  ProviderOneShotOptions,
  ProviderPendingApproval,
  ProviderPendingUserInput,
  ProviderPendingMessage,
  ProviderReasoningEffort,
  ProviderResourceUpdateOptions,
  ProviderSandboxModeOption,
  ProviderSkill,
  ProviderSourceOptions,
  ProviderSubagent,
  ProviderSubagentDetail,
  ProviderTokenUsageBreakdown,
  ProviderTurnOptions,
  ProviderStartChatOptions,
  ProviderUserInputResponse,
  ProviderUsageOptions,
  ProviderUpdateAvailability
} from '../../../shared/provider'
import type { AppContainerTarget } from '../../../shared/app'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget'
import { getCurrentContainerHostBridge } from '../../currentContainer'
import { getHostCommand, getHostExecutableCommand, isRunningInFlatpak } from '../../hostProcess'
import { providerOneShotGenerationCanceledMessage } from '../../../shared/provider'
import type {
  ProviderAdapter,
  ProviderChatUpdateMetadata,
  ProviderChatTurnWindow
} from '../ProviderAdapter'
import {
  ProviderConversationCompletionCoordinator,
  reconcileProviderRecords
} from '../ProviderConversationEngine.ts'
import {
  disableProviderSkill,
  listDisabledProviderSkills,
  mergeProviderSkills,
  restoreProviderSkill
} from '../providerResources'
import { getCopilotExecutable } from './CopilotExecutable'
import {
  isCopilotSystemContextMessage,
  getCopilotTurnOutcome,
  renderCopilotChatItems,
  renderCopilotChatWindow,
  findCopilotItemTurnWindow,
  type CopilotRenderedPlan
} from './CopilotItemRenderers'
import {
  canMessageCopilotTask,
  createCopilotSubagentSummaries,
  createCopilotSubagentTranscriptItems,
  mergeCopilotSubagentFollowUps,
  renderCopilotSubagentWindow,
  type CopilotSubagentFollowUp
} from './CopilotSubagents'
import { selectCopilotTitleModel } from './CopilotTitleModel'
import {
  getCopilotCustomProvider,
  getCopilotCustomProviderModels,
  getCopilotCustomProviderSessionOptions
} from './CopilotCustomProvider'
import { CopilotEventStore } from './CopilotEventStore.ts'
import { getCopilotGoalInput, mapCopilotGoal, runCopilotGoal } from './CopilotGoals.ts'
import { SqliteUsageReader } from '../SqliteUsageReader'
import {
  bindCopilotUsageQuery,
  copilotUsageColumns,
  copilotUsageReadScript,
  historicalUsageFromRows,
  type HistoricalUsageRow
} from './CopilotHistoricalUsage'

type PendingPermission = {
  id: string
  request: PermissionRequest
  startedAt: number
  resolve: (result: PermissionRequestResult) => void
}

type CopilotUserInputHandler = NonNullable<SessionConfig['onUserInputRequest']>
type CopilotUserInputRequest = Parameters<CopilotUserInputHandler>[0]
type CopilotUserInputResponse = Awaited<ReturnType<CopilotUserInputHandler>>

type PendingUserInput = {
  id: string
  request: CopilotUserInputRequest
  startedAt: number
  elicitation?: ProviderPendingUserInput
  nativeRequestId?: string
  resolve: (response: ProviderUserInputResponse) => void
}

type CopilotSessionMetadata = SessionMetadata & {
  name?: string
}

type CopilotPendingMessage = ProviderPendingMessage & {
  options?: ProviderTurnOptions
  delivery: 'local' | 'submitting' | 'provider'
}

type CopilotSessionState = {
  id: string
  revision: number
  createdAt: number
  client: CopilotClient | null
  container: AppContainerTarget | null
  session: CopilotSession | null
  browser: BrowserMcpIntegration | null
  browserCwd: string | null
  metadata: CopilotSessionMetadata | null
  events: SessionEvent[]
  title: string | null
  active: boolean
  stopped: boolean
  failed: boolean
  options: ProviderTurnOptions | undefined
  pendingMessages: CopilotPendingMessage[]
  queuePaused: boolean
  queueDrainInProgress: boolean
  pendingRefreshSequence: number
  pendingPermissions: PendingPermission[]
  pendingUserInputs: PendingUserInput[]
  plan: CopilotRenderedPlan | null
  planRefreshSequence: number
  turnGeneration: number
  goal: ProviderChatGoal | null
  goalNativeId?: number
  goalCommand: string | null
  goalSupportSession?: CopilotSession
  goalRefreshSequence: number
  goalMutation?: boolean
  goalMutationCanceled?: boolean
}

const copilotTurnActivityEventTypes: ReadonlySet<SessionEvent['type']> = new Set([
  'user.message',
  'assistant.turn_start',
  'assistant.intent',
  'assistant.reasoning',
  'assistant.reasoning_delta',
  'assistant.tool_call_delta',
  'assistant.streaming_delta',
  'assistant.message_start',
  'assistant.message_delta',
  'assistant.message',
  'tool.execution_start',
  'tool.execution_partial_result',
  'tool.execution_progress',
  'tool.execution_complete'
])

const isCopilotTurnActivityEvent = (event: SessionEvent): boolean =>
  copilotTurnActivityEventTypes.has(event.type)

type CopilotOneShotGeneration = {
  session: CopilotSession | null
  state: CopilotSessionState | null
  canceled: boolean
}

type CopilotAskUserArguments = {
  question?: unknown
  choices?: unknown
  allow_freeform?: unknown
  allowFreeform?: unknown
}

type CopilotUserInputPresentation = {
  choices: ProviderPendingUserInput['choices']
  allowFreeform: boolean
}

const asAskUserArguments = (value: unknown): CopilotAskUserArguments | null =>
  typeof value === 'object' && value !== null ? (value as CopilotAskUserArguments) : null

const getAskUserArguments = (
  state: CopilotSessionState,
  question: string
): CopilotAskUserArguments | null => {
  for (let eventIndex = state.events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = state.events[eventIndex]

    if (event?.type === 'assistant.message') {
      const toolRequests = event.data.toolRequests ?? []
      for (let toolIndex = toolRequests.length - 1; toolIndex >= 0; toolIndex -= 1) {
        const toolRequest = toolRequests[toolIndex]
        if (toolRequest?.name !== 'ask_user') continue
        const argumentsValue = asAskUserArguments(toolRequest.arguments)
        if (argumentsValue?.question === question) return argumentsValue
      }
    }

    if (event?.type === 'tool.execution_start' && event.data.toolName === 'ask_user') {
      const argumentsValue = asAskUserArguments(event.data.arguments)
      if (argumentsValue?.question === question) return argumentsValue
    }
  }

  return null
}

const getUserInputPresentation = (
  state: CopilotSessionState,
  request: CopilotUserInputRequest
): CopilotUserInputPresentation => {
  const argumentsValue = getAskUserArguments(state, request.question) ?? asAskUserArguments(request)
  const choices = Array.isArray(argumentsValue?.choices)
    ? argumentsValue.choices.filter((choice): choice is string => typeof choice === 'string')
    : (request.choices ?? [])
  const allowFreeform = argumentsValue?.allow_freeform ?? argumentsValue?.allowFreeform

  return {
    choices: choices.map((label) => ({ label, description: null })),
    allowFreeform: typeof allowFreeform === 'boolean' ? allowFreeform : true
  }
}

type CopilotClientEntry = {
  client: CopilotClient
  container: AppContainerTarget | null
  startPromise: Promise<void> | null
}

const copilotApprovalModes: ProviderApprovalModeOption[] = [
  {
    id: 'ask-user',
    label: 'Ask me',
    description: 'Ask before Copilot runs permission-gated tools.',
    isDefault: true
  },
  {
    id: 'never',
    label: 'Never ask',
    description: 'Automatically approve Copilot tool requests.',
    isDefault: false
  }
]

const copilotSandboxModes: ProviderSandboxModeOption[] = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Allow inspection while rejecting writes and mutating commands.',
    isDefault: false
  },
  {
    id: 'workspace-write',
    label: 'Workspace write',
    description: 'Let Copilot request reads, writes, and commands in the project.',
    isDefault: true
  },
  {
    id: 'danger-full-access',
    label: 'Full access',
    description: 'Automatically approve all Copilot tool requests.',
    isDefault: false
  }
]

const copilotAgentModeByAutopilotChoice = {
  off: 'interactive',
  on: 'autopilot'
} satisfies Record<string, ProviderAgentMode>

const formatAgentModeLabel = (mode: ProviderAgentMode): string =>
  mode.charAt(0).toLocaleUpperCase() + mode.slice(1)

const emptyUsageSummary = {
  lifetimeTokens: null,
  peakDailyTokens: null,
  longestRunningTurnSec: null,
  currentStreakDays: null,
  longestStreakDays: null
}

const allowedReasoningEfforts = new Set(['low', 'medium', 'high', 'xhigh'])

const normalizeReasoningEffort = (
  value: ProviderReasoningEffort | undefined
): 'low' | 'medium' | 'high' | 'xhigh' | undefined =>
  value && allowedReasoningEfforts.has(value)
    ? (value as 'low' | 'medium' | 'high' | 'xhigh')
    : undefined

const mapModel = (model: ModelInfo, isDefault: boolean): ProviderModel => {
  const supportedReasoningEfforts = (model.supportedReasoningEfforts ?? []).map((effort) => ({
    id: effort,
    label: effort,
    description: `${effort[0]?.toLocaleUpperCase() ?? ''}${effort.slice(1)} reasoning effort`,
    isDefault: effort === model.defaultReasoningEffort
  }))
  const defaultReasoningEffort =
    model.defaultReasoningEffort ?? supportedReasoningEfforts[0]?.id ?? 'medium'
  const contextWindow = model.capabilities.limits.max_context_window_tokens
  const multiplier = model.billing?.multiplier
  const description = [
    contextWindow ? `${Math.round(contextWindow / 1_000)}K context window.` : '',
    multiplier != null ? `${multiplier}× premium request multiplier.` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: model.id,
    label: model.name || model.id,
    description,
    isDefault,
    supportedReasoningEfforts,
    defaultReasoningEffort
  }
}

const isUnsupportedCopilotMethodError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: unknown }).code === -32601 ||
    /\bunhandled method\b/i.test(String((error as { message?: unknown }).message ?? '')))

const getSessionModelKey = (
  model: string | undefined,
  reasoningEffort: string | undefined
): string => JSON.stringify([model ?? null, reasoningEffort ?? null])

/** A delivered message is recorded after Sele created it; allow for clock differences. */
const restoredMessageClockSkewMs = 5_000

const toMilliseconds = (value: Date | string | number | undefined): number => {
  if (value instanceof Date) return value.getTime()
  const timestamp = typeof value === 'number' ? value : value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

const chatTitlePromptLimit = 2_000
const chatTitleMaxLength = 36
const copilotOneShotClientName = 'Sele one-shot'
const oneShotCancellationRetentionMs = 120_000
const copilotUpdateDelayMs = 35

const normalizePlanStatus = (
  value: string | undefined
): CopilotRenderedPlan['items'][number]['status'] => {
  const status =
    value
      ?.trim()
      .toLocaleLowerCase()
      .replace(/[\s-]+/g, '_') ?? ''
  if (['completed', 'complete', 'done', 'cancelled', 'canceled', 'skipped'].includes(status)) {
    return 'completed'
  }
  if (['in_progress', 'active', 'doing', 'running', 'started'].includes(status)) {
    return 'in_progress'
  }
  return 'pending'
}

const parseMarkdownPlan = (content: string | null): CopilotRenderedPlan | null => {
  if (!content?.trim()) return null

  const items = content.split(/\r?\n/).flatMap((line): CopilotRenderedPlan['items'] => {
    const checklist = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/)
    if (checklist) {
      return [
        {
          step: checklist[2]!.trim(),
          status: checklist[1]!.toLocaleLowerCase() === 'x' ? 'completed' : 'pending'
        }
      ]
    }

    const listItem = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/)
    const step = listItem?.[1]?.trim()
    return step ? [{ step, status: 'pending' }] : []
  })

  return items.length > 0 ? { explanation: null, items } : null
}

const normalizeGeneratedChatTitle = (value: string): string | null => {
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
  if (!title) return null

  return title.length <= chatTitleMaxLength
    ? title
    : `${title.slice(0, chatTitleMaxLength - 3).trimEnd()}...`
}

const createChatTitlePrompt = (prompt: string): string =>
  [
    'Create a short UI title for the user prompt below.',
    `The title must be at most ${chatTitleMaxLength} characters.`,
    'Return only the plain-text title, with no quotes, markdown, prefix, or trailing punctuation.',
    'Use an imperative verb first for change requests, such as Add, Fix, Update, Refactor, Remove, Locate, or Find.',
    'Do not answer the prompt or perform the task.',
    '',
    'User prompt:',
    prompt.slice(0, chatTitlePromptLimit)
  ].join('\n')

const getEventCwd = (events: SessionEvent[]): string | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'session.context_changed') return event.data.cwd
    if (event?.type === 'session.start') return event.data.context?.cwd ?? null
    if (event?.type === 'session.resume') return event.data.context?.cwd ?? null
  }
  return null
}

const getContextUsage = (events: SessionEvent[]): ProviderChatContextUsage | null => {
  const usageEvents = events.filter(
    (event): event is Extract<SessionEvent, { type: 'assistant.usage' }> =>
      event.type === 'assistant.usage'
  )
  const contextEvent = events.findLast(
    (event): event is Extract<SessionEvent, { type: 'session.usage_info' }> =>
      event.type === 'session.usage_info'
  )
  if (usageEvents.length === 0 && !contextEvent) return null

  const toBreakdown = (
    usage: Extract<SessionEvent, { type: 'assistant.usage' }> | undefined
  ): ProviderTokenUsageBreakdown => {
    const inputTokens = usage?.data.inputTokens ?? 0
    const outputTokens = usage?.data.outputTokens ?? 0
    return {
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      cachedInputTokens: usage?.data.cacheReadTokens ?? 0,
      outputTokens,
      reasoningOutputTokens: usage?.data.reasoningTokens ?? 0
    }
  }

  const total = usageEvents.reduce<ProviderTokenUsageBreakdown>(
    (result, usage) => {
      const next = toBreakdown(usage)
      return {
        totalTokens: result.totalTokens + next.totalTokens,
        inputTokens: result.inputTokens + next.inputTokens,
        cachedInputTokens: result.cachedInputTokens + next.cachedInputTokens,
        outputTokens: result.outputTokens + next.outputTokens,
        reasoningOutputTokens: result.reasoningOutputTokens + next.reasoningOutputTokens
      }
    },
    {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0
    }
  )
  const lastUsage = usageEvents.at(-1)

  return {
    usedTokens: contextEvent?.data.currentTokens ?? total.totalTokens,
    maxTokens: contextEvent?.data.tokenLimit ?? null,
    total,
    last: toBreakdown(lastUsage),
    updatedAt: toMilliseconds(contextEvent?.timestamp ?? lastUsage?.timestamp)
  }
}

// Older external CLIs still emit factory requests; the bundled SDK now calls them workflows.
type CopilotDisplayPermissionRequest =
  | PermissionRequest
  | { kind: 'factory'; name: string; description?: string }

const getPermissionDescription = (request: CopilotDisplayPermissionRequest): string => {
  switch (request.kind) {
    case 'shell':
      return request.fullCommandText
    case 'write':
      return request.fileName
    case 'read':
      return request.path
    case 'url':
      return request.url
    case 'mcp':
      return request.toolTitle || request.toolName
    case 'memory':
      return request.fact
    case 'custom-tool':
      return request.toolName
    case 'hook':
      return request.toolName
    case 'extension-management':
      return `${request.operation} ${request.extensionName ?? 'extension'}`
    case 'factory':
    case 'workflow':
      return request.description || request.name
    case 'extension-env-access':
      return request.extensionName
    case 'extension-permission-access':
      return request.extensionName
  }
}

const getPermissionReason = (request: CopilotDisplayPermissionRequest): string | null => {
  switch (request.kind) {
    case 'shell':
    case 'write':
    case 'read':
    case 'url':
      return request.intention || request.requestSandboxBypassReason || null
    case 'mcp':
      return `Run ${request.serverName} tool ${request.toolName}`
    case 'memory':
      return request.reason ?? null
    case 'custom-tool':
      return request.toolDescription || null
    case 'hook':
      return request.hookMessage ?? null
    case 'extension-management':
      return `Manage Copilot extension ${request.extensionName ?? ''}`.trim()
    case 'factory':
      return `Run Copilot factory ${request.name}`
    case 'workflow':
      return `Run Copilot workflow ${request.name}`
    case 'extension-env-access':
      return `Access environment variables ${request.environmentVariables.join(', ')}`
    case 'extension-permission-access':
      return `Access ${request.capabilities.join(', ')}`
  }
}

const isReadOnlyPermission = (request: PermissionRequest): boolean => {
  switch (request.kind) {
    case 'read':
    case 'url':
      return true
    case 'shell':
      return (
        !request.hasWriteFileRedirection && request.commands.every((command) => command.readOnly)
      )
    case 'mcp':
      return request.readOnly
    default:
      return false
  }
}

const getSkillScope = (source: string): ProviderSkill['scope'] => {
  if (source === 'project' || source === 'inherited') return 'repo'
  if (source === 'builtin') return 'system'
  return 'user'
}

const getMessageOptions = (
  message: string,
  options: ProviderTurnOptions | ProviderOneShotOptions | undefined,
  mode?: 'enqueue' | 'immediate'
): {
  prompt: string
  displayPrompt: string
  mode?: 'enqueue' | 'immediate'
  agentMode?: 'interactive' | 'autopilot'
  attachments?: Array<{ type: 'file'; path: string; displayName: string }>
} => {
  let prompt = message
  const firstSkill = options?.skills?.[0]
  if (firstSkill) {
    const mention = `$${firstSkill.name}`
    if (prompt.startsWith(mention)) prompt = `/${firstSkill.name}${prompt.slice(mention.length)}`
  }

  const attachments = [...(options?.files ?? []), ...(options?.images ?? [])].map((file) => ({
    type: 'file' as const,
    path: file.path,
    displayName: basename(file.path)
  }))

  return {
    prompt,
    displayPrompt: message,
    mode,
    agentMode: options?.agentMode,
    attachments: attachments.length > 0 ? attachments : undefined
  }
}

const hasMessageAttachments = (
  options: ProviderTurnOptions | ProviderOneShotOptions | undefined
): boolean => Boolean(options?.files?.length || options?.images?.length)

const getRuntimeEnvironment = (env: NodeJS.ProcessEnv | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env ?? process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

export class CopilotProviderAdapter implements ProviderAdapter {
  id = 'copilot' as const
  private pendingMessageEdits = new PendingMessageEdits()
  private pendingMessageStore = new PersistentPendingMessages<CopilotPendingMessage>(
    'copilot',
    sqlitePendingMessageBackend
  )
  private historicalUsageReader = new SqliteUsageReader<HistoricalUsageRow>()
  private tokenUsageReporter = new TokenUsageReporter()
  onTokenUsage = this.tokenUsageReporter.subscribe

  getHistoricalTokenUsage: NonNullable<ProviderAdapter['getHistoricalTokenUsage']> = async (
    chatId,
    options
  ) => {
    const container = normalizeContainerTarget(options?.container)
    const sourceKey = getContainerTargetKey(container)
    const now = Date.now()
    const rows = await this.historicalUsageReader.read(
      JSON.stringify([sourceKey, chatId]),
      async () => {
        const query = bindCopilotUsageQuery(now, chatId)
        const queryWithoutDetails = bindCopilotUsageQuery(now, chatId, false)
        const schema = {
          table: 'assistant_usage_events',
          requiredColumns: copilotUsageColumns,
          query,
          queryWithoutDetails
        }
        if (
          container.kind === 'host' &&
          !isRunningInFlatpak() &&
          !(await getCurrentContainerHostBridge())
        ) {
          return {
            ...schema,
            path: join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'session-store.db')
          }
        }
        const command = await getHostCommand(
          'sh',
          [
            '-lc',
            copilotUsageReadScript,
            'sele-copilot-usage',
            query,
            queryWithoutDetails,
            JSON.stringify(copilotUsageColumns)
          ],
          { container, env: process.env }
        )
        return { ...schema, command }
      }
    )
    if (!rows) return null
    const anchor = rows[0]
    return {
      ...historicalUsageFromRows(rows, now),
      ...(anchor?.database_identity && anchor.source_anchor
        ? { sourceIdentity: `${anchor.database_identity}:${anchor.source_anchor}` }
        : {})
    }
  }

  private clientEntries = new Map<string, CopilotClientEntry>()
  private clientEntryPromises = new Map<string, Promise<CopilotClientEntry>>()
  private sessionContainers = new Map<string, AppContainerTarget | null>()
  private states = new Map<string, CopilotSessionState>()
  private eventStores = new WeakMap<CopilotSessionState, CopilotEventStore<SessionEvent>>()
  private subagentFollowUps = new WeakMap<
    CopilotSessionState,
    Map<string, CopilotSubagentFollowUp[]>
  >()
  private sessionLoads = new WeakMap<CopilotSessionState, Promise<CopilotSessionState>>()
  private metadataChecks = new WeakMap<CopilotSessionState, Promise<void>>()
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private completionCoordinator = new ProviderConversationCompletionCoordinator()
  private oneShotGenerations = new Map<string, CopilotOneShotGeneration>()
  private additionalDirectoriesBySession = new WeakMap<CopilotSession, Set<string>>()
  private sessionModels = new WeakMap<CopilotSession, string>()
  private clientsWithoutPersistedEvents = new WeakSet<CopilotClient>()
  private canceledOneShotGenerationIds = new Set<string>()
  private canceledOneShotGenerationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private hiddenSessionIds = new Set<string>()
  private browserGeneration = 0

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult> => {
    const customProvider = getCopilotCustomProvider()
    if (customProvider) {
      // A custom provider needs no GitHub account.
      const label = (() => {
        try {
          return new URL(customProvider.baseUrl).host
        } catch {
          return customProvider.baseUrl
        }
      })()
      return { status: 'authenticated', account: { label, displayName: null } }
    }
    const client = await this.ensureClient(options.container)
    const status = await client.getAuthStatus()
    if (!status.isAuthenticated) {
      throw new Error('GitHub Copilot is not authenticated. Run `copilot` and use `/login` first.')
    }

    const displayName = status.login
      ? await copilotAccountDisplayName(status.login, status.host)
      : null
    return {
      status: 'authenticated',
      account: {
        label: displayName || status.login || status.host || 'GitHub Copilot',
        displayName
      }
    }
  }

  getUpdateAvailability = async (): Promise<ProviderUpdateAvailability | null> => null

  updateProvider = async (): Promise<ProviderUpdateAvailability | null> => null

  getApprovalModes = async (): Promise<ProviderApprovalModeOption[]> => copilotApprovalModes

  getSandboxModes = async (): Promise<ProviderSandboxModeOption[]> => copilotSandboxModes

  getAgentModes = async (
    options: ProviderSourceOptions = {}
  ): Promise<ProviderAgentModeOption[]> => {
    const client = await this.ensureClient(options.container)
    const commandList = await client.rpc.commands.list()
    const autopilotCommand = commandList.commands.find(
      (command) => command.name === 'autopilot' || command.aliases?.includes('autopilot')
    )
    const choices = autopilotCommand?.input?.choices ?? []

    return choices
      .flatMap((choice): ProviderAgentModeOption[] => {
        const mode = copilotAgentModeByAutopilotChoice[choice.name]
        if (!mode) return []

        return [
          {
            id: mode,
            label: formatAgentModeLabel(mode),
            description: choice.description,
            isDefault: mode === 'interactive'
          }
        ]
      })
      .sort((first, second) => Number(second.isDefault) - Number(first.isDefault))
  }

  getModels = async (options: ProviderSourceOptions = {}): Promise<ProviderModel[]> => {
    const customProviderModels = getCopilotCustomProviderModels()
    if (customProviderModels.length > 0) return customProviderModels
    try {
      const client = await this.ensureClient(options.container)
      const models = await client.listModels()
      models.forEach((model) => {
        const rates = copilotPriceRates(model.billing?.tokenPrices)
        if (rates) {
          setNativeModelPricing(
            `copilot:${getContainerTargetKey(options.container)}:${model.id}`,
            rates
          )
        }
      })
      const enabledModels = models.filter((model) => model.policy?.state !== 'disabled')
      if (enabledModels.length === 0) {
        throw new Error('No Copilot models are enabled for this account.')
      }

      const defaultIndex = enabledModels.findIndex((model) => model.id === 'auto')
      return enabledModels.map((model, index) =>
        mapModel(model, index === (defaultIndex >= 0 ? defaultIndex : 0))
      )
    } catch (error) {
      console.error('[CopilotProviderAdapter:getModels] Unable to load models', error)
      throw error
    }
  }

  getSkills = async (
    cwd?: string | null,
    options: ProviderSourceOptions = {}
  ): Promise<ProviderSkill[]> => {
    const client = await this.ensureClient(options.container)
    const result = await client.rpc.skills.discover({
      ...(cwd ? { projectPaths: [cwd] } : {})
    })

    const discoveredSkills = result.skills.flatMap((skill): ProviderSkill[] => {
      if (!skill.enabled || !skill.userInvocable || !skill.path) return []
      return [
        {
          name: skill.name,
          description: skill.description,
          shortDescription: skill.description || null,
          displayName: null,
          path: skill.path,
          scope: getSkillScope(skill.source),
          enabled: true
        }
      ]
    })

    const disabledSkills = await listDisabledProviderSkills('copilot', options.container)
    return mergeProviderSkills(discoveredSkills, disabledSkills)
  }

  getMcpApp = async (chatId: string, callId: string): Promise<McpAppConnection | null> => {
    const state = this.states.get(chatId)
    const session = state?.session
    if (!state || !session || !session.capabilities.ui?.mcpApps) return null
    const start = state.events.find(
      (event) => event.type === 'tool.execution_start' && event.data.toolCallId === callId
    )
    const complete = state.events.find(
      (event) => event.type === 'tool.execution_complete' && event.data.toolCallId === callId
    )
    if (
      start?.type !== 'tool.execution_start' ||
      complete?.type !== 'tool.execution_complete' ||
      !start.data.mcpServerName
    )
      return null
    const serverName = start.data.mcpServerName
    const resourceUri =
      complete.data.result?.uiResource?.uri ||
      complete.data.toolDescription?._meta?.ui?.resourceUri ||
      start.data.toolDescription?._meta?.ui?.resourceUri
    if (!resourceUri?.startsWith('ui://')) return null
    const client = state.client
    const clientRpc = client?.rpc
    const isCurrent = () => {
      try {
        return (
          !!client &&
          this.clientEntries.get(getContainerTargetKey(state.container))?.client === client &&
          client.rpc === clientRpc &&
          this.states.get(chatId) === state &&
          state.session === session
        )
      } catch {
        return false
      }
    }
    const resource = complete.data.result?.uiResource
    return {
      serverName,
      resourceUri,
      input: mcpRecord(start.data.arguments) ?? {},
      result: {
        content: complete.data.result?.contents ?? [],
        structuredContent: complete.data.result?.structuredContent,
        isError: !complete.data.success
      },
      isCurrent,
      canCall: () => isCurrent() && state.options?.sandboxMode !== 'read-only',
      readResource: async (uri) =>
        resource && uri === resourceUri
          ? { contents: [resource] }
          : session.rpc.mcp.apps.readResource({ serverName, uri }),
      listTools: () => session.rpc.mcp.apps.listTools({ serverName, originServerName: serverName }),
      callTool: (toolName, args) =>
        session.rpc.mcp.apps.callTool({
          serverName,
          originServerName: serverName,
          toolName,
          arguments: args as Parameters<typeof session.rpc.mcp.apps.callTool>[0]['arguments']
        })
    }
  }

  getApps = async (): Promise<ProviderApp[]> => []

  setSkillEnabled = async (
    path: string,
    enabled: boolean,
    cwd?: string | null,
    options: ProviderResourceUpdateOptions = {}
  ): Promise<ProviderSkill[]> =>
    this.setSkillsEnabledInContext([path], enabled, cwd, options, false)

  setSkillsEnabled = async (
    paths: string[],
    enabled: boolean,
    cwd?: string | null,
    options: ProviderResourceUpdateOptions = {}
  ): Promise<ProviderSkill[]> => this.setSkillsEnabledInContext(paths, enabled, cwd, options, true)

  private setSkillsEnabledInContext = async (
    paths: string[],
    enabled: boolean,
    cwd: string | null | undefined,
    options: ProviderResourceUpdateOptions,
    toleratePartialFailure: boolean
  ): Promise<ProviderSkill[]> => {
    const requestedPaths = new Set(paths)
    const knownSkills = options.knownSkills?.filter((skill) => requestedPaths.has(skill.path))
    const useKnownSkills =
      options.deferRefresh && knownSkills?.length === requestedPaths.size ? knownSkills : null
    const skills = useKnownSkills ?? (await this.getSkills(cwd, options))
    const skillsByPath = new Map(skills.map((skill) => [skill.path, skill]))
    const requestedSkills = paths.map((path) => {
      const skill = skillsByPath.get(path)
      if (!skill) throw new Error('Skill is not available in this environment')
      return skill
    })
    const changedSkills = requestedSkills.filter((skill) => skill.enabled !== enabled)
    if (changedSkills.length === 0) return skills

    const updateSkill = async (skill: ProviderSkill): Promise<void> => {
      if (!enabled) {
        await disableProviderSkill('copilot', skill, options.container)
        return
      }

      const restored = await restoreProviderSkill(skill.path, options.container)
      if (!restored) throw new Error('Skill was not disabled by Sele')
    }
    const updateResults = await Promise.allSettled(changedSkills.map(updateSkill))
    updateResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `[CopilotProviderAdapter:setSkillsEnabledInContext] Initial update failed for skill ${changedSkills[index]?.path ?? 'unknown'}`,
          result.reason
        )
      }
    })
    const failedSkills = changedSkills.filter(
      (_, index) => updateResults[index]?.status === 'rejected'
    )
    const retryResults = await Promise.allSettled(failedSkills.map(updateSkill))
    retryResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `[CopilotProviderAdapter:setSkillsEnabledInContext] Retry failed for skill ${failedSkills[index]?.path ?? 'unknown'}`,
          result.reason
        )
      }
    })
    const failedAfterRetry = new Set(
      failedSkills
        .filter((_, index) => retryResults[index]?.status === 'rejected')
        .map((skill) => skill.path)
    )
    const failedRetry = retryResults.find((result) => result.status === 'rejected')
    if (!toleratePartialFailure && failedRetry?.status === 'rejected') throw failedRetry.reason

    if (options.deferRefresh) {
      return requestedSkills.map((skill) =>
        failedAfterRetry.has(skill.path) ? skill : { ...skill, enabled }
      )
    }
    return this.getSkills(cwd, options)
  }

  setAppEnabled = async (): Promise<ProviderApp[]> => {
    throw new Error('Copilot does not expose connected apps')
  }

  getUsage = async (options: ProviderUsageOptions = {}): Promise<ProviderAccountUsage> => {
    const client = await this.ensureClient(options.container)
    try {
      const result = await client.rpc.account.getQuota({})
      const rateLimits = Object.entries(result.quotaSnapshots)
        .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
        .map(([id, quota], index) => ({
          id,
          label: id
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (character) => character.toLocaleUpperCase()),
          kind: index === 0 ? ('primary' as const) : ('secondary' as const),
          usedPercent: Math.max(0, Math.min(100, 100 - quota.remainingPercentage)),
          windowMinutes: null,
          resetsAt: quota.resetDate ? toMilliseconds(quota.resetDate) : null
        }))

      return {
        updatedAt: Date.now(),
        statisticsLoaded: false,
        summary: emptyUsageSummary,
        dailyUsageBuckets: null,
        rateLimits,
        rateLimitResetCredits: null,
        errors: []
      }
    } catch (error) {
      console.error('[caught:CopilotProviderAdapter:getUsage]', error)
      return {
        updatedAt: Date.now(),
        statisticsLoaded: false,
        summary: emptyUsageSummary,
        dailyUsageBuckets: null,
        rateLimits: [],
        rateLimitResetCredits: null,
        errors: [error instanceof Error ? error.message : 'Copilot usage is unavailable.']
      }
    }
  }

  resetRateLimits = async (): Promise<'nothingToReset'> => 'nothingToReset'

  getChatTerminalTasks = async (chatId: string): Promise<string[]> => {
    const session = this.states.get(chatId)?.session
    if (!session) return []
    await session.rpc.tasks.refresh()
    return (await session.rpc.tasks.list()).tasks
      .filter(
        (task) => task.type === 'shell' && (task.status === 'running' || task.status === 'idle')
      )
      .map((task) => task.id)
  }

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const normalizedContainer = normalizeContainerTarget(options.container)
    const storedContainer = normalizedContainer.kind === 'container' ? normalizedContainer : null
    const client = await this.ensureClient(storedContainer)
    // CopilotClient.listSessions() currently omits the persisted `name` field. Use the
    // typed RPC response so generated names and /rename survive a list refresh/restart.
    const sessionList = await client.rpc.sessions.list({ source: 'local' })
    const sessions: CopilotSessionMetadata[] = sessionList.sessions
      .filter(
        (metadata) =>
          !this.hiddenSessionIds.has(metadata.sessionId) &&
          !('clientName' in metadata && metadata.clientName === copilotOneShotClientName)
      )
      .map((metadata) => ({
        sessionId: metadata.sessionId,
        startTime: new Date(metadata.startTime),
        modifiedTime: new Date(metadata.modifiedTime),
        summary: metadata.summary,
        name: metadata.name,
        isRemote: metadata.isRemote,
        context: metadata.context
          ? {
              workingDirectory: metadata.context.cwd,
              gitRoot: metadata.context.gitRoot,
              repository: metadata.context.repository,
              branch: metadata.context.branch
            }
          : undefined
      }))
      .sort(
        (first, second) => toMilliseconds(second.modifiedTime) - toMilliseconds(first.modifiedTime)
      )
    const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const page = sessions.slice(offset, offset + limit)
    const chats: ProviderChat[] = []
    for (let index = 0; index < page.length; index += 8) {
      chats.push(
        ...(await Promise.all(
          page.slice(index, index + 8).map(async (metadata) => {
            const chat = this.createChatFromMetadata(metadata, storedContainer)
            if (chat.status === 'active' || chat.pendingApproval) return chat
            const latest = await this.getSidebarTurnSummary(client, metadata.sessionId)
            return latest
              ? {
                  ...chat,
                  lastTurnOutcome: latest.outcome,
                  updatedAt: Math.max(chat.updatedAt, latest.updatedAt)
                }
              : chat
          })
        ))
      )
    }
    const nextOffset = offset + page.length

    return {
      chats,
      nextCursor: nextOffset < sessions.length ? String(nextOffset) : null
    }
  }

  private getSidebarTurnSummary = async (client: CopilotClient, sessionId: string) => {
    if (this.clientsWithoutPersistedEvents.has(client)) return undefined
    let cursor: string | undefined
    let updatedAt = 0
    const seenCursors = new Set<string>()
    try {
      while (true) {
        const page = await client.rpc.sessions.readPersistedEvents({
          sessionId,
          cursor,
          direction: 'backward',
          max: 64
        })
        updatedAt = Math.max(
          updatedAt,
          ...page.events.map((event) => toMilliseconds(event.timestamp))
        )
        const outcome = getCopilotTurnOutcome(page.events)
        if (outcome !== undefined || !page.hasMore) return { outcome: outcome ?? null, updatedAt }
        if (seenCursors.has(page.cursor)) throw new Error('Repeated Copilot journal cursor')
        seenCursors.add(page.cursor)
        cursor = page.cursor
      }
    } catch (error) {
      // Older Copilot CLIs (used through a host or container bridge) lack the journal API.
      // The sidebar then simply shows no last-turn outcome for their sessions.
      if (isUnsupportedCopilotMethodError(error)) {
        this.clientsWithoutPersistedEvents.add(client)
        return undefined
      }
      console.error('Unable to read latest Copilot sidebar turn.', error)
      return undefined
    }
  }

  getChat = async (
    chatId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    return this.createChatDetail(state)
  }

  getChatWindow = async (
    chatId: string,
    window: ProviderChatTurnWindow,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    return this.createChatDetail(state, window)
  }

  getChatWindowForItem = async (
    chatId: string,
    itemId: string,
    limit: number,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    this.eventStores.get(state)?.seal()
    const window = findCopilotItemTurnWindow(state.events, itemId, limit)
    if (window) return this.createChatDetail(state, window)
    // Some synthetic message IDs have no native record ID. Preserve that uncommon lookup.
    const detail = this.createChatDetail(state)
    const turns = getProviderChatTurns(detail.items)
    const target = turns.findIndex((turn) => turn.items.some((item) => item.id === itemId))
    if (target < 0) throw new Error('Chat item not found')
    const startIndex = Math.max(0, target - Math.floor(limit / 2))
    return {
      ...detail,
      items: sliceProviderChatTurns(detail.items, startIndex, startIndex + limit),
      itemsStartTurnIndex: startIndex,
      turnCount: turns.length
    }
  }

  getSubagents = async (
    chatId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderSubagent[]> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    const tasks = await state
      .session!.rpc.tasks.list()
      .then((result) => result.tasks.filter((task) => task.type === 'agent'))
      .catch((error) => {
        console.error('[caught:CopilotProviderAdapter:getSubagents]', error)
        return []
      })
    return createCopilotSubagentSummaries(state.events, tasks)
  }

  getSubagent = async (
    chatId: string,
    subagentId: string,
    options: { container?: AppContainerTarget | null } = {},
    window?: ProviderChatTurnWindow
  ): Promise<ProviderSubagentDetail> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    const tasks = await state
      .session!.rpc.tasks.list()
      .then((result) => result.tasks.filter((task) => task.type === 'agent'))
      .catch((error) => {
        console.error('[caught:CopilotProviderAdapter:getSubagent]', error)
        return []
      })
    const summary = createCopilotSubagentSummaries(state.events, tasks).find(
      (candidate) => candidate.id === subagentId
    )
    if (!summary) throw new Error('Copilot subagent was not found.')

    this.eventStores.get(state)?.seal()
    const events = mergeCopilotSubagentFollowUps(
      state.events,
      this.subagentFollowUps.get(state)?.get(subagentId) ?? []
    )
    if (window)
      return {
        ...summary,
        ...renderCopilotSubagentWindow(summary, events, window)
      }
    return {
      ...summary,
      items: createCopilotSubagentTranscriptItems(
        summary,
        renderCopilotChatItems(events, {
          agentId: subagentId,
          active: summary.status === 'pending' || summary.status === 'running',
          stopped: summary.status === 'stopped',
          failed: summary.status === 'failed'
        })
      )
    }
  }

  cancelSubagent = async (
    chatId: string,
    subagentId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<void> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    const tasks = await state.session!.rpc.tasks.list()
    if (!tasks.tasks.some((task) => task.type === 'agent' && task.id === subagentId)) {
      throw new Error('Copilot subagent was not found.')
    }
    const result = await state.session!.rpc.tasks.cancel({ id: subagentId })
    if (!result.cancelled) throw new Error('Copilot could not stop this subagent.')
    this.emitUpdate(state)
  }

  sendSubagentMessage = async (
    chatId: string,
    subagentId: string,
    message: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<void> => {
    const content = message.trim()
    if (!content) throw new Error('Cannot send an empty Copilot message.')
    const state = await this.ensureSession(chatId, undefined, options.container)
    const rpc = state.session!.rpc
    const task = (await rpc.tasks.list()).tasks.find(
      (candidate) => candidate.type === 'agent' && candidate.id === subagentId
    )
    if (!task || task.type !== 'agent') throw new Error('Copilot subagent was not found.')
    if (!canMessageCopilotTask(task)) {
      throw new Error('This Copilot subagent no longer accepts messages.')
    }
    if (task.executionMode !== 'background') {
      // Follow-ups are only accepted by background agents; move a synchronous one there first.
      const { promoted } = await rpc.tasks.promoteToBackground({
        id: subagentId
      })
      if (!promoted) throw new Error('Copilot could not move this subagent to the background.')
    }
    const result = await rpc.tasks.sendMessage({
      id: subagentId,
      message: content
    })
    if (!result.sent) {
      throw new Error(result.error?.trim() || 'Copilot did not deliver the message.')
    }

    const followUps = this.subagentFollowUps.get(state) ?? new Map()
    this.subagentFollowUps.set(state, followUps)
    followUps.set(subagentId, [
      ...(followUps.get(subagentId) ?? []),
      {
        id: `${subagentId}:follow-up:${randomUUID()}`,
        agentId: subagentId,
        content,
        timestamp: new Date().toISOString()
      }
    ])
    this.emitUpdate(state)
  }

  setChatTitle = async (chatId: string, title: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    await state.session!.rpc.name.set({ name: title })
    state.title = title
    if (state.metadata) {
      state.metadata = {
        ...state.metadata,
        name: title
      }
    }
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  generateOneShot = async (message: string, options?: ProviderOneShotOptions): Promise<string> => {
    const generationId = options?.generationId ?? randomUUID()
    if (this.oneShotGenerations.has(generationId)) {
      throw new Error('Duplicate one-shot generation ID')
    }

    const generation: CopilotOneShotGeneration = {
      session: null,
      state: null,
      canceled: this.takeCanceledOneShotGeneration(generationId)
    }
    this.oneShotGenerations.set(generationId, generation)

    const sessionId = randomUUID()
    this.hiddenSessionIds.add(sessionId)
    const state = this.createState(sessionId, options)
    generation.state = state

    const throwIfCanceled = async (): Promise<void> => {
      if (!generation.canceled) return
      await (generation.session ?? generation.state?.session)?.abort().catch((error) => {
        console.error('[caught:CopilotProviderAdapter:throwIfCanceled]', error)
      })
      throw new Error(providerOneShotGenerationCanceledMessage)
    }

    try {
      await throwIfCanceled()
      const session = await this.createSession(state, options, false, copilotOneShotClientName)
      generation.session = session
      await throwIfCanceled()

      const response = await session.sendAndWait(
        { ...getMessageOptions(message, options), agentMode: 'interactive' },
        10 * 60_000
      )
      await throwIfCanceled()
      if (response?.data.content.trim()) return response.data.content.trim()

      await this.loadEvents(state)
      await throwIfCanceled()
      const lastMessage = state.events.findLast(
        (event): event is Extract<SessionEvent, { type: 'assistant.message' }> =>
          event.type === 'assistant.message' && Boolean(event.data.content.trim())
      )
      return lastMessage?.data.content.trim() ?? ''
    } catch (error) {
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      throw error
    } finally {
      if (this.oneShotGenerations.get(generationId) === generation) {
        this.oneShotGenerations.delete(generationId)
      }
      const session = state.session
      if (session)
        await session.disconnect().catch((error) => {
          console.error('[caught:CopilotProviderAdapter:generateOneShot]', error)
        })
      await state.client?.deleteSession(sessionId).catch((error) => {
        console.error('[caught:CopilotProviderAdapter:generateOneShot]', error)
      })
      const timer = this.updateTimers.get(sessionId)
      if (timer) clearTimeout(timer)
      this.updateTimers.delete(sessionId)
      this.completionCoordinator.cancel(sessionId)
      this.states.delete(sessionId)
      this.sessionContainers.delete(sessionId)
      this.hiddenSessionIds.delete(sessionId)
    }
  }

  cancelOneShot = async (generationId: string): Promise<void> => {
    const generation = this.oneShotGenerations.get(generationId)
    if (!generation) {
      this.rememberCanceledOneShotGeneration(generationId)
      return
    }

    generation.canceled = true
    await (generation.session ?? generation.state?.session)?.abort().catch((error) => {
      console.error('[caught:CopilotProviderAdapter:cancelOneShot]', error)
    })
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

  importHistory: NonNullable<ProviderAdapter['importHistory']> = async (
    chatId,
    messages,
    options,
    onChatCreated
  ) => {
    const id = chatId ?? randomUUID()
    await onChatCreated?.(id)
    const state = chatId ? await this.ensureSession(id, options) : this.createState(id, options)
    if (state.active) throw new Error('Copilot is still working in this conversation.')
    const session = state.session ?? (await this.createSession(state, options))
    const native = await session.getEvents()
    await session.disconnect()
    state.session = null
    this.closeBrowserIntegration(state)
    const file = await nativeHistoryFile(
      'copilot',
      id,
      options.cwd ?? process.cwd(),
      options.container
    )
    let entries = await file.read()
    if (!entries.length) {
      await file.append(native)
      entries = native as unknown as Record<string, unknown>[]
    }
    const parent = entries.at(-1)?.id
    const nextTurn = entries.reduce((next, entry) => {
      const turn = Number((entry.data as { turnId?: unknown } | undefined)?.turnId)
      return Number.isSafeInteger(turn) ? Math.max(next, turn + 1) : next
    }, 0)
    const added = encodeCopilotHistory(
      messages,
      typeof parent === 'string' ? parent : null,
      new Set(entries.map((entry) => String(entry.id))),
      nextTurn
    )
    await file.append(added)
    if ((await file.read()).length < entries.length + added.length)
      throw new Error('Copilot did not persist the complete imported conversation.')

    return id
  }

  startChat = async (
    message: string,
    options?: ProviderStartChatOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    if (options?.initialGoal) getCopilotGoalInput(options.initialGoal)
    const sessionId = randomUUID()
    const state = this.createState(sessionId, options)
    this.pendingMessageStore.track(sessionId)
    const session = await this.createSession(state, options)
    await onChatCreated?.(sessionId)
    if (options?.initialGoal) {
      await this.setChatGoal(sessionId, options.initialGoal, { container: options.container })
    } else {
      state.active = true
      state.browser?.resume()
      await session.send(getMessageOptions(message, options))
    }
    this.startChatTitleGeneration(state, message || 'File attachment', options)
    return this.createChatDetail(state)
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, options)
    this.enqueueMessage(state, message, options)
    state.queuePaused = false
    await this.drainQueue(state)
    return this.createChatDetail(state)
  }

  setChatGoal = async (
    chatId: string,
    objective: string | null,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatGoal | null> => {
    const text = getCopilotGoalInput(objective)
    const state = await this.ensureSession(
      chatId,
      undefined,
      this.getSessionContainer(chatId, options)
    )
    if (state.goalMutation || state.queueDrainInProgress)
      throw new Error('Wait for the current Copilot update before changing the goal.')
    await this.refreshGoal(state)
    if (!state.goalCommand)
      throw new Error('This Copilot runtime does not support goal controls. Update Copilot.')
    if (state.goalMutation || state.queueDrainInProgress)
      throw new Error('Wait for the current Copilot update before changing the goal.')
    state.goalMutation = true
    state.goalMutationCanceled = false
    state.goalRefreshSequence += 1
    const session = state.session!
    try {
      this.completionCoordinator.cancel(state.id)
      if (
        state.active ||
        state.goal?.status === 'active' ||
        state.pendingPermissions.length ||
        state.pendingUserInputs.length
      ) {
        state.browser?.suspend()
        state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
        this.cancelPendingUserInputs(state)
        await session.abort()
        state.active = false
      }
      if (state.goalMutationCanceled || state.session !== session)
        throw new Error('The Copilot goal update was stopped.')
      await runCopilotGoal(session, state.goalCommand, text, () => {
        if (
          state.goalMutationCanceled ||
          state.session !== session ||
          this.states.get(state.id) !== state
        )
          throw new Error('The Copilot goal update was stopped.')
        state.active = true
        state.stopped = false
        state.failed = false
        state.browser?.resume()
      })
      await this.refreshGoal(state)
      return state.goal
    } catch (error) {
      if (state.active) await session.abort()
      state.active = false
      state.browser?.suspend()
      throw error
    } finally {
      await this.refreshGoal(state)
      state.goalMutation = false
      if (state.goalMutationCanceled) state.queuePaused = true
      this.emitUpdate(state)
      if (!state.queuePaused) this.scheduleQueueDrain(state)
    }
  }

  continueChatInFork = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const sourceState = await this.ensureSession(chatId, options)
    const fork = await sourceState.client!.rpc.sessions.fork({ sessionId: chatId })
    this.sessionContainers.set(fork.sessionId, sourceState.container)
    await onForkCreated?.(fork.sessionId)
    const state = await this.ensureSession(fork.sessionId, options, sourceState.container)
    await this.applyTurnOptions(state, options)
    state.active = true
    await state.session!.send(getMessageOptions(message, options))
    return this.createChatDetail(state)
  }

  forkChat = async (
    chatId: string,
    messageId: string,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const source = await this.ensureSession(chatId)
    if (source.active) throw new Error('Cannot fork a chat with an active response.')
    await this.loadEvents(source)

    const targetIndex = source.events.findIndex(
      (event) =>
        event.type === 'assistant.message' &&
        (event.id === messageId || event.data.messageId === messageId)
    )
    if (targetIndex < 0) throw new Error('Message cannot be forked.')

    const nextUserMessage = source.events
      .slice(targetIndex + 1)
      .find(
        (event) =>
          event.type === 'user.message' && !event.agentId && !isCopilotSystemContextMessage(event)
      )
    const fork = await source.client!.rpc.sessions.fork({
      sessionId: chatId,
      ...(nextUserMessage ? { toEventId: nextUserMessage.id } : {})
    })
    this.sessionContainers.set(fork.sessionId, source.container)
    await onForkCreated?.(fork.sessionId)
    const state = await this.ensureSession(fork.sessionId, source.options, source.container)
    return this.createChatDetail(state)
  }

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, options)
    const pending = this.enqueueMessage(
      state,
      message,
      options,
      mode === 'steer' ? 'steering' : 'queued'
    )
    state.queuePaused = false
    if (mode !== 'queue' && !this.pendingMessageEdits.has(chatId)) {
      await this.submitPendingMessage(state, pending, mode === 'interrupt')
    } else {
      await this.drainQueue(state)
    }
    return this.createChatDetail(state)
  }

  beginPendingMessageEdit = async (
    chatId: string,
    messageId: string,
    editId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    const existing = this.pendingMessageEdits.get(chatId)
    if (existing?.messageId === messageId && existing.editId === editId)
      return this.createChatDetail(state)
    this.pendingMessageEdits.begin(chatId, messageId, editId, state.pendingMessages)
    try {
      await this.refreshPendingMessages(state)
      const pending = state.pendingMessages.find((message) => message.id === messageId)
      if (!pending || pending.delivery === 'submitting')
        throw new Error('This message has already started delivery.')
      if (pending.delivery === 'provider') {
        await this.withdrawPendingMessage(state, pending)
        // Keep the same visible row and its attachments throughout the edit.
        pending.delivery = 'local'
        state.pendingRefreshSequence += 1
      }
      this.emitUpdate(state)
      return this.createChatDetail(state)
    } catch (error) {
      this.pendingMessageEdits.release(chatId, messageId, editId)
      this.scheduleQueueDrain(state)
      throw error
    }
  }

  cancelPendingMessageEdit = async (
    chatId: string,
    messageId: string,
    editId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    if (this.pendingMessageEdits.release(chatId, messageId, editId)) {
      await this.resumeEditedMessage(state, messageId)
    }
    return this.createChatDetail(state)
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const pending = state.pendingMessages.find((message) => message.id === messageId)
    if (!pending || pending.delivery === 'submitting')
      throw new Error('The queued message is no longer pending.')
    if (pending.delivery === 'provider') await this.withdrawPendingMessage(state, pending)
    state.pendingMessages = state.pendingMessages.filter((message) => message !== pending)
    state.pendingRefreshSequence += 1
    this.emitUpdate(state)
    this.scheduleQueueDrain(state)
    return this.createChatDetail(state)
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions,
    editId?: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, options)
    this.pendingMessageEdits.assert(chatId, messageId, editId)
    const pending = state.pendingMessages.find((item) => item.id === messageId)
    if (!pending || pending.delivery === 'submitting')
      throw new Error('The queued message is no longer pending.')
    if (!message.trim() && !hasMessageAttachments(options))
      throw new Error('Cannot edit a message to empty content')
    if (pending.delivery === 'provider') await this.withdrawPendingMessage(state, pending)
    const replacement = this.createPendingMessage(
      message,
      options ?? pending.options,
      pending.kind,
      messageId
    )
    state.pendingMessages = state.pendingMessages.map((item) =>
      item === pending ? replacement : item
    )
    state.pendingRefreshSequence += 1
    if (editId) this.pendingMessageEdits.release(chatId, messageId, editId)
    this.emitUpdate(state)
    try {
      await this.resumeEditedMessage(state, messageId)
    } catch (error) {
      // A failed steering resubmission must leave a cancellable edit of the original payload.
      if (editId && replacement.delivery === 'local') {
        pending.delivery = 'local'
        state.pendingMessages = state.pendingMessages.map((item) =>
          item === replacement ? pending : item
        )
        this.pendingMessageEdits.begin(chatId, messageId, editId, state.pendingMessages)
        this.emitUpdate(state)
      }
      throw error
    }
    return this.createChatDetail(state)
  }

  steerPendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const pending = state.pendingMessages.find((message) => message.id === messageId)
    if (!pending || pending.delivery !== 'local')
      throw new Error('The queued message is no longer pending.')
    pending.kind = 'steering'
    state.queuePaused = false
    await this.submitPendingMessage(state, pending)
    return this.createChatDetail(state)
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const pending = state.pendingMessages.find((message) => message.id === messageId)
    if (!pending || pending.delivery !== 'local')
      throw new Error('The queued message is no longer pending.')
    state.queuePaused = false
    await this.submitPendingMessage(state, pending, true)
    return this.createChatDetail(state)
  }

  private createPendingMessage = (
    message: string,
    options: ProviderTurnOptions | undefined,
    kind: ProviderPendingMessage['kind'] = 'queued',
    id: string = randomUUID()
  ): CopilotPendingMessage => {
    if (!message.trim() && !hasMessageAttachments(options))
      throw new Error('Cannot queue an empty message')
    return {
      type: 'pendingMessage',
      id,
      kind,
      content: message.trim(),
      options,
      delivery: 'local',
      createdAt: Date.now(),
      attachments: [
        ...(options?.files ?? []).map((file) => ({
          kind: 'file' as const,
          name: basename(file.path),
          path: file.path
        })),
        ...(options?.images ?? []).map((image) => ({
          kind: 'image' as const,
          name: basename(image.path),
          path: image.path
        }))
      ]
    }
  }

  private persistPendingMessages = (state: CopilotSessionState): void => {
    this.pendingMessageStore.save(
      state.id,
      state.pendingMessages.map((message) => ({
        id: message.id,
        kind: message.kind,
        submitted: message.delivery !== 'local',
        createdAt: message.createdAt ?? Date.now(),
        payload: message
      }))
    )
  }

  /**
   * The previous process ended with these messages undelivered; the SDK's own queue did not
   * survive it. They wait in a paused queue, as after Stop. Steering the session already
   * recorded as a user message is dropped.
   */
  private restorePendingMessages = (
    state: CopilotSessionState,
    stored: PersistedPendingMessage<CopilotPendingMessage>[]
  ): void => {
    if (!stored.length) return
    const userMessages = state.events.filter(
      (event): event is Extract<SessionEvent, { type: 'user.message' }> =>
        event.type === 'user.message' && !event.agentId
    )
    const restored = stored
      .filter(
        (message) =>
          !(
            message.submitted &&
            userMessages.some(
              (event) =>
                event.data.content.trim() === message.payload.content &&
                toMilliseconds(event.timestamp) >= message.createdAt - restoredMessageClockSkewMs
            )
          )
      )
      .map(
        (message): CopilotPendingMessage => ({
          ...message.payload,
          id: message.id,
          kind: message.kind,
          createdAt: message.createdAt,
          delivery: 'local'
        })
      )
    if (restored.length) {
      const restoredIds = new Set(restored.map((message) => message.id))
      state.pendingMessages = [
        ...restored,
        ...state.pendingMessages.filter((message) => !restoredIds.has(message.id))
      ]
      state.queuePaused = true
    }
    this.persistPendingMessages(state)
  }

  private enqueueMessage = (
    state: CopilotSessionState,
    message: string,
    options?: ProviderTurnOptions,
    kind: ProviderPendingMessage['kind'] = 'queued'
  ): CopilotPendingMessage => {
    const pending = this.createPendingMessage(message, options, kind)
    state.pendingMessages.push(pending)
    this.emitUpdate(state)
    return pending
  }

  private withdrawPendingMessage = async (
    state: CopilotSessionState,
    pending: CopilotPendingMessage
  ): Promise<void> => {
    let removed: boolean
    if (pending.kind === 'queued') {
      removed = (await state.session!.rpc.queue.removeAt({ id: pending.id })).removed
    } else {
      // The SDK only offers LIFO removal for steering. Never remove a different message.
      const snapshot = await state.session!.rpc.queue.pendingItems()
      const native = state.pendingMessages.filter(
        (message) => message.delivery === 'provider' && message.kind === 'steering'
      )
      if (
        snapshot.items.length ||
        native.at(-1)?.id !== pending.id ||
        snapshot.steeringMessages.at(-1) !== pending.content ||
        (snapshot.inFlightSteeringCount ?? 0) >= snapshot.steeringMessages.length
      ) {
        throw new Error('Only the most recent, unaccepted steering message can be withdrawn.')
      }
      removed = (await state.session!.rpc.queue.removeMostRecent()).removed
    }
    if (!removed) throw new Error('The steering message has already been accepted.')
  }

  private resumeEditedMessage = async (
    state: CopilotSessionState,
    messageId: string
  ): Promise<void> => {
    const pending = state.pendingMessages.find((message) => message.id === messageId)
    if (pending?.kind === 'steering' && !state.stopped) {
      state.queuePaused = false
      await this.submitPendingMessage(state, pending)
    } else {
      await this.drainQueue(state)
    }
  }

  private scheduleQueueDrain = (state: CopilotSessionState): void => {
    void this.drainQueue(state).catch((error) =>
      console.error('Unable to drain Copilot queue.', error)
    )
  }

  private drainQueue = async (state: CopilotSessionState): Promise<void> => {
    if (
      state.goalMutation ||
      state.queuePaused ||
      state.queueDrainInProgress ||
      state.pendingPermissions.length ||
      state.pendingUserInputs.length ||
      state.pendingMessages.some(
        (message) => message.kind === 'steering' && message.delivery === 'provider'
      )
    )
      return
    const pending =
      state.pendingMessages.find(
        (message) =>
          message.delivery === 'local' &&
          message.kind === 'steering' &&
          !this.pendingMessageEdits.blocks(state.id, message.id)
      ) ??
      state.pendingMessages.find(
        (message) =>
          message.delivery === 'local' && !this.pendingMessageEdits.blocks(state.id, message.id)
      )
    if (!pending || (state.active && pending.kind !== 'steering')) return
    await this.submitPendingMessage(state, pending)
  }

  private submitPendingMessage = async (
    state: CopilotSessionState,
    pending: CopilotPendingMessage,
    interrupt = false
  ): Promise<void> => {
    if (
      this.pendingMessageEdits.blocks(state.id, pending.id) ||
      state.queueDrainInProgress ||
      state.goalMutation ||
      pending.delivery !== 'local' ||
      (pending.kind === 'steering' &&
        state.pendingMessages.some(
          (message) =>
            message !== pending && message.kind === 'steering' && message.delivery === 'provider'
        ))
    )
      return
    state.queueDrainInProgress = true
    try {
      this.completionCoordinator.cancel(state.id)
      await this.applyTurnOptions(state, pending.options)
      if (
        state.goalMutation ||
        this.pendingMessageEdits.blocks(state.id, pending.id) ||
        state.queuePaused ||
        !state.pendingMessages.includes(pending)
      )
        return
      if (interrupt) {
        this.cancelPendingUserInputs(state)
        state.browser?.suspend()
        await state.session!.abort()
        if (
          this.pendingMessageEdits.blocks(state.id, pending.id) ||
          !state.pendingMessages.includes(pending)
        )
          return
      } else if (state.active && pending.kind !== 'steering') return
      // Claim and send in one synchronous section after all asynchronous preparation.
      pending.delivery = 'submitting'
      state.active = true
      state.stopped = false
      state.failed = false
      state.browser?.resume()
      await state.session!.send(
        getMessageOptions(
          pending.content,
          pending.options,
          pending.kind === 'steering' ? 'immediate' : 'enqueue'
        )
      )
      if (pending.kind === 'steering') pending.delivery = 'provider'
      else state.pendingMessages = state.pendingMessages.filter((message) => message !== pending)
      await this.refreshPendingMessages(state)
    } catch (error) {
      if (pending.delivery === 'submitting') pending.delivery = 'local'
      state.queuePaused = true
      throw error
    } finally {
      state.queueDrainInProgress = false
      this.emitUpdate(state)
      if (!state.queuePaused) this.scheduleQueueDrain(state)
    }
  }

  editMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !hasMessageAttachments(options)) {
      throw new Error('Cannot edit a message to empty content')
    }

    const state = await this.ensureSession(chatId, options)
    this.completionCoordinator.cancel(chatId)
    await this.loadEvents(state)

    const target = state.events.find(
      (event): event is Extract<SessionEvent, { type: 'user.message' }> =>
        event.type === 'user.message' && !event.agentId && event.id === messageId
    )
    if (!target) throw new Error('Message cannot be edited')

    state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
    this.cancelPendingUserInputs(state)
    if (state.active) {
      state.browser?.suspend()
      await state.session!.abort()
    }
    await state.session!.rpc.queue.clear()
    state.pendingMessages = []

    await this.applyTurnOptions(state, options)
    const result = await state.session!.rpc.history.truncate({ eventId: target.id })
    if (result.eventsRemoved < 1) throw new Error('Message cannot be edited')

    state.events = []
    state.title = null
    state.plan = null
    state.planRefreshSequence += 1
    state.active = true
    state.stopped = false
    state.failed = false
    state.metadata =
      (await state.client?.getSessionMetadata(chatId).catch((error) => {
        console.error('[caught:CopilotProviderAdapter:editMessage]', error)
        return undefined
      })) ?? state.metadata
    await this.loadSessionTitle(state)
    await this.loadEvents(state)
    await this.refreshPendingMessages(state)
    this.emitUpdate(state)

    state.browser?.resume()
    await state.session!.send(getMessageOptions(text, options))
    return this.createChatDetail(state)
  }

  resolveApproval = async (
    chatId: string,
    decision: ProviderApprovalDecision
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    const pending = state.pendingPermissions.shift()
    if (!pending) throw new Error('There is no pending Copilot approval.')
    pending.resolve(decision === 'allow' ? { kind: 'approve-once' } : { kind: 'reject' })
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  resolveUserInput = async (
    chatId: string,
    requestId: string,
    response: ProviderUserInputResponse
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    const pending = state.pendingUserInputs[0]
    if (!pending || pending.id !== requestId) {
      throw new Error('There is no matching pending Copilot question.')
    }

    if (pending.elicitation) {
      getProviderElicitationResult(pending.elicitation, response)
      state.pendingUserInputs.shift()
      pending.resolve(response)
    } else if (response.kind === 'elicitation')
      throw new Error('This request is not an MCP interaction.')
    else if (response.kind === 'answer') {
      const answer = response.wasFreeform ? response.answer.trim() : response.answer
      if (!answer.trim()) throw new Error('An answer is required.')
      const presentation = getUserInputPresentation(state, pending.request)

      if (response.wasFreeform && !presentation.allowFreeform) {
        throw new Error('This Copilot question requires one of the available choices.')
      }
      if (
        !response.wasFreeform &&
        !presentation.choices.some((choice) => choice.label === answer)
      ) {
        throw new Error('The selected Copilot answer is no longer available.')
      }

      state.pendingUserInputs.shift()
      pending.resolve({ kind: 'answer', answer, wasFreeform: response.wasFreeform })
    } else {
      state.pendingUserInputs.shift()
      pending.resolve({ kind: 'cancel' })
    }

    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  compactChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    if (state.active) {
      throw new Error('Wait for the current response before compacting context.')
    }
    const result = await state.session!.rpc.history.compact()
    if (!result.success) throw new Error('Copilot could not compact the chat context.')
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  summarizeChatInFork = async (
    chatId: string,
    { signal }: { summaryPrompt: string; signal: AbortSignal },
    onForkCreated: (chatId: string) => Promise<void>
  ): Promise<string> => {
    const sourceState = await this.ensureSession(chatId)
    if (sourceState.active)
      throw new Error('Wait for the current response before linking this chat.')
    throwIfLinkedChatCancelled(signal)
    const fork = await sourceState.client!.rpc.sessions.fork({ sessionId: chatId })
    this.sessionContainers.set(fork.sessionId, sourceState.container)
    await onForkCreated(fork.sessionId)
    throwIfLinkedChatCancelled(signal)
    const state = await this.ensureSession(
      fork.sessionId,
      sourceState.options,
      sourceState.container
    )
    const abort = (): void => {
      void state.session?.rpc.history.abortManualCompaction().catch((error: unknown) => {
        console.error('[caught:CopilotProviderAdapter:summarizeChatInFork:abort]', error)
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      throwIfLinkedChatCancelled(signal)
      // Native compaction returns its readable summary directly.
      const result = await raceLinkedChatCancellation(
        signal,
        state.session!.rpc.history.compact({ trigger: 'manual' })
      )
      if (!result.success) throw new Error('Copilot could not summarize the linked chat.')
      return requireLinkedChatSummary(result.summaryContent)
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    if (state.goalMutation) state.goalMutationCanceled = true
    state.queuePaused = true
    state.stopped = true
    state.active = false
    state.browser?.suspend()
    state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
    this.cancelPendingUserInputs(state)
    await state.session!.abort()
    await this.refreshPendingMessages(state)
    return this.createChatDetail(state)
  }

  onChatUpdated = (
    listener: (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  ): (() => void) => {
    this.chatUpdatedListeners.add(listener)
    return () => this.chatUpdatedListeners.delete(listener)
  }

  dispose = (): void => {
    // Record the final live lists; stopping the clients below ends the SDK queues.
    this.states.forEach((state) => this.persistPendingMessages(state))
    void this.pendingMessageStore.close()
    this.browserGeneration += 1
    this.historicalUsageReader.dispose()
    this.updateTimers.forEach((timer) => clearTimeout(timer))
    this.updateTimers.clear()
    this.completionCoordinator.clear()
    this.oneShotGenerations.forEach((generation) => {
      void (generation.session ?? generation.state?.session)?.abort().catch((error) => {
        console.error('[caught:CopilotProviderAdapter:dispose]', error)
      })
    })
    this.oneShotGenerations.clear()
    this.canceledOneShotGenerationIds.clear()
    this.canceledOneShotGenerationTimers.forEach((timer) => clearTimeout(timer))
    this.canceledOneShotGenerationTimers.clear()
    this.states.forEach((state) => {
      this.closeBrowserIntegration(state)
      state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
      this.cancelPendingUserInputs(state)
    })
    this.clientEntries.forEach((entry) => {
      void entry.client.stop()
    })
    this.clientEntries.clear()
    this.clientEntryPromises.clear()
    this.sessionContainers.clear()
    this.hiddenSessionIds.clear()
  }

  private getHostClientEntry = (): CopilotClientEntry => {
    const key = getContainerTargetKey(null)
    const existingEntry = this.clientEntries.get(key)
    if (existingEntry) return existingEntry

    const entry = {
      client: new CopilotClient({
        mode: 'copilot-cli',
        logLevel: 'error'
      }),
      container: null,
      startPromise: null
    } satisfies CopilotClientEntry
    this.clientEntries.set(key, entry)
    return entry
  }

  private createClientEntry = async (
    container: AppContainerTarget | null
  ): Promise<CopilotClientEntry> => {
    const normalizedContainer = normalizeContainerTarget(container)
    if (
      normalizedContainer.kind !== 'container' &&
      !isRunningInFlatpak() &&
      process.platform !== 'win32' &&
      !(await getCurrentContainerHostBridge())
    ) {
      return this.getHostClientEntry()
    }

    const hostCommand = await getHostExecutableCommand(
      normalizedContainer.kind === 'container' ? 'copilot' : getCopilotExecutable(),
      [],
      {
        container: normalizedContainer.kind === 'container' ? normalizedContainer : null,
        env: process.env
      }
    )
    return {
      client: new CopilotClient({
        mode: 'copilot-cli',
        logLevel: 'error',
        connection: RuntimeConnection.forStdio({
          path: hostCommand.file,
          args: hostCommand.args,
          env: getRuntimeEnvironment(hostCommand.env)
        })
      }),
      container: normalizedContainer.kind === 'container' ? normalizedContainer : null,
      startPromise: null
    }
  }

  private getClientEntry = (
    container: AppContainerTarget | null | undefined
  ): Promise<CopilotClientEntry> => {
    const normalizedContainer = normalizeContainerTarget(container)
    const storedContainer = normalizedContainer.kind === 'container' ? normalizedContainer : null
    const key = getContainerTargetKey(storedContainer)
    const existingEntry = this.clientEntries.get(key)
    if (existingEntry) return Promise.resolve(existingEntry)

    const existingPromise = this.clientEntryPromises.get(key)
    if (existingPromise) return existingPromise

    const promise = this.createClientEntry(storedContainer)
      .then((entry) => {
        this.clientEntries.set(key, entry)
        return entry
      })
      .finally(() => {
        this.clientEntryPromises.delete(key)
      })
    this.clientEntryPromises.set(key, promise)
    return promise
  }

  private ensureClient = async (container?: AppContainerTarget | null): Promise<CopilotClient> => {
    const entry = await this.getClientEntry(container)
    if (!entry.startPromise) {
      entry.startPromise = entry.client.start().catch((error: unknown) => {
        entry.startPromise = null
        throw error
      })
    }
    await entry.startPromise
    return entry.client
  }

  private createState = (
    sessionId: string,
    options?: ProviderTurnOptions | ProviderOneShotOptions,
    container?: AppContainerTarget | null
  ): CopilotSessionState => {
    const existing = this.states.get(sessionId)
    if (existing) {
      if (options) existing.options = options
      if (container !== undefined && !existing.session) {
        const normalizedContainer = normalizeContainerTarget(container)
        existing.container = normalizedContainer.kind === 'container' ? normalizedContainer : null
        this.sessionContainers.set(sessionId, existing.container)
      }
      return existing
    }

    const normalizedContainer = normalizeContainerTarget(container ?? options?.container)
    const storedContainer = normalizedContainer.kind === 'container' ? normalizedContainer : null
    const state: CopilotSessionState = {
      id: sessionId,
      revision: 0,
      createdAt: Date.now(),
      client: null,
      container: storedContainer,
      session: null,
      browser: null,
      browserCwd: null,
      metadata: null,
      events: [],
      title: null,
      active: false,
      stopped: false,
      failed: false,
      options,
      pendingMessages: [],
      queuePaused: false,
      queueDrainInProgress: false,
      pendingRefreshSequence: 0,
      pendingPermissions: [],
      pendingUserInputs: [],
      plan: null,
      planRefreshSequence: 0,
      turnGeneration: 0,
      goal: null,
      goalCommand: null,
      goalRefreshSequence: 0
    }
    this.sessionContainers.set(sessionId, storedContainer)
    this.states.set(sessionId, state)
    return state
  }

  private getSessionContainer = (
    sessionId: string,
    options?: { container?: AppContainerTarget | null }
  ): AppContainerTarget | null =>
    options?.container ??
    this.states.get(sessionId)?.container ??
    this.sessionContainers.get(sessionId) ??
    null

  private browserServerConfig = (browser: BrowserMcpIntegration) => ({
    type: 'http' as const,
    url: browser.url,
    headers: { Authorization: `Bearer ${browser.token}` },
    tools: ['*']
  })

  private browserAllowed = (state: CopilotSessionState): boolean =>
    !state.container &&
    normalizeContainerTarget(state.options?.container).kind !== 'container' &&
    state.options?.sandboxMode !== 'read-only' &&
    !this.hiddenSessionIds.has(state.id)

  private browserBindingMatches = (state: CopilotSessionState): boolean => {
    const enabled = this.browserAllowed(state) && Boolean(getBrowserAutomationService())
    return (
      Boolean(state.browser) === enabled &&
      (!state.browser || state.browserCwd === (state.options?.cwd ?? this.getCwd(state) ?? ''))
    )
  }

  private closeBrowserIntegration = (state: CopilotSessionState): void => {
    const browser = state.browser
    state.browser = null
    state.browserCwd = null
    if (browser) {
      // close revokes synchronously before awaiting socket shutdown.
      void browser
        .close()
        .catch((error) => console.error('Unable to close Copilot browser.', error))
    }
  }

  private createBrowserIntegration = async (
    state: CopilotSessionState,
    cwd: string,
    interactive = true
  ): Promise<BrowserMcpIntegration | null> => {
    this.closeBrowserIntegration(state)
    const service = getBrowserAutomationService()
    if (!interactive || !service || !this.browserAllowed(state)) return null
    const generation = this.browserGeneration
    const browser = await createBrowserMcpServer(
      service,
      {
        providerId: 'copilot',
        sessionId: state.id,
        cwd,
        containerKey: getContainerTargetKey(state.container)
      },
      {
        authorizeTool: () => {
          if (
            this.states.get(state.id) !== state ||
            !this.browserAllowed(state) ||
            (state.options?.cwd ?? this.getCwd(state) ?? '') !== cwd
          ) {
            throw new Error('Browser is unavailable for this Copilot session')
          }
        }
      }
    )
    if (generation !== this.browserGeneration || this.states.get(state.id) !== state) {
      await browser.close()
      throw new Error('Copilot browser startup was canceled')
    }
    state.browser = browser
    state.browserCwd = cwd
    return browser
  }

  private createSession = async (
    state: CopilotSessionState,
    options?: ProviderTurnOptions | ProviderOneShotOptions,
    enableUserInput = true,
    clientName = 'Sele'
  ): Promise<CopilotSession> => {
    const client = await this.ensureClient(state.container)
    state.client = client
    const reasoningEffort = normalizeReasoningEffort(options?.reasoningEffort)
    const workingDirectory = options?.cwd ?? process.cwd()
    const browser = await this.createBrowserIntegration(state, workingDirectory, enableUserInput)
    let session: CopilotSession
    try {
      session = await client.createSession({
        sessionId: state.id,
        clientName,
        workingDirectory,
        ...(browser ? { mcpServers: { Sele_Browser: this.browserServerConfig(browser) } } : {}),
        ...getCopilotCustomProviderSessionOptions(options?.model),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        streaming: false,
        enableConfigDiscovery: true,
        enableSkills: true,
        enableMcpApps: enableUserInput,
        onEvent: (event) => this.handleEvent(state.id, event),
        onPermissionRequest: (request) => this.handlePermission(state.id, request),
        ...(enableUserInput
          ? {
              onUserInputRequest: (request: CopilotUserInputRequest) =>
                this.handleUserInput(state.id, request),
              onElicitationRequest: this.createElicitationHandler(state.id)
            }
          : {})
      })
      this.sessionModels.set(session, getSessionModelKey(options?.model, reasoningEffort))
      await this.addAdditionalDirectories(session, options)
      state.session = session
      state.metadata =
        (await client.getSessionMetadata(state.id).catch((error) => {
          console.error('[caught:CopilotProviderAdapter:createSession]', error)
          return undefined
        })) ?? null
      await this.loadSessionTitle(state)
      await this.loadEvents(state)
      await this.refreshGoal(state)
      return session
    } catch (error) {
      this.closeBrowserIntegration(state)
      throw error
    }
  }

  private ensureSession = async (
    sessionId: string,
    options?: ProviderTurnOptions,
    container: AppContainerTarget | null = this.getSessionContainer(sessionId, options)
  ): Promise<CopilotSessionState> => {
    const state = this.createState(sessionId, options, container)
    const client = await this.ensureClient(state.container)
    if (options) state.options = options
    const pending = this.sessionLoads.get(state)
    if (pending) return pending
    if (state.session && state.client === client && this.browserBindingMatches(state)) {
      if (!state.active) await this.checkSessionMetadata(state)
      return state
    }

    const load = (async (): Promise<CopilotSessionState> => {
      const previous = state.session
      state.session = null
      this.closeBrowserIntegration(state)
      await previous?.disconnect()
      state.client = client
      state.metadata = (await client.getSessionMetadata(sessionId)) ?? null
      if (!state.metadata) throw new Error(`Copilot session was not found: ${sessionId}`)

      const reasoningEffort = normalizeReasoningEffort(options?.reasoningEffort)
      const browser = await this.createBrowserIntegration(
        state,
        options?.cwd ?? state.metadata.context?.workingDirectory ?? ''
      )
      const session = await client.resumeSession(sessionId, {
        clientName: 'Sele',
        ...(browser ? { mcpServers: { Sele_Browser: this.browserServerConfig(browser) } } : {}),
        workingDirectory: options?.cwd ?? state.metadata.context?.workingDirectory,
        ...getCopilotCustomProviderSessionOptions(options?.model),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        streaming: false,
        enableConfigDiscovery: true,
        enableSkills: true,
        enableMcpApps: true,
        suppressResumeEvent: true,
        onEvent: (event) => this.handleEvent(sessionId, event),
        onPermissionRequest: (request) => this.handlePermission(sessionId, request),
        onUserInputRequest: (request) => this.handleUserInput(sessionId, request),
        onElicitationRequest: this.createElicitationHandler(sessionId)
      })
      if (options?.model)
        this.sessionModels.set(session, getSessionModelKey(options.model, reasoningEffort))
      state.session = session
      await this.addAdditionalDirectories(session, options)
      await this.loadSessionTitle(state)
      await this.loadEvents(state)
      this.restorePendingMessages(state, await this.pendingMessageStore.restore(sessionId))
      await this.refreshPendingMessages(state)
      await this.refreshPlan(state)
      await this.refreshGoal(state)
      return state
    })()
    this.sessionLoads.set(state, load)
    try {
      return await load
    } catch (error) {
      state.session = null
      this.closeBrowserIntegration(state)
      throw error
    } finally {
      this.sessionLoads.delete(state)
    }
  }

  private checkSessionMetadata = async (state: CopilotSessionState): Promise<void> => {
    const pending = this.metadataChecks.get(state)
    if (pending) return pending
    const check = (async (): Promise<void> => {
      const metadata = (await state.client!.getSessionMetadata(state.id)) ?? null
      if (!metadata) {
        state.session = null
        this.closeBrowserIntegration(state)
        throw new Error(`Copilot session was not found: ${state.id}`)
      }
      if (
        toMilliseconds(metadata.modifiedTime) !== toMilliseconds(state.metadata?.modifiedTime ?? 0)
      ) {
        await this.loadEvents(state)
        state.metadata = metadata
        await Promise.all([
          this.loadSessionTitle(state),
          this.refreshPendingMessages(state),
          this.refreshPlan(state),
          this.refreshGoal(state)
        ])
      }
    })()
    this.metadataChecks.set(state, check)
    try {
      await check
    } finally {
      this.metadataChecks.delete(state)
    }
  }

  private applyTurnOptions = async (
    state: CopilotSessionState,
    options?: ProviderTurnOptions
  ): Promise<void> => {
    if (!options || !state.session) return
    state.options = options
    await this.addAdditionalDirectories(state.session, options)
    const reasoningEffort = normalizeReasoningEffort(options.reasoningEffort)
    const session = state.session
    const key = getSessionModelKey(options.model, reasoningEffort)
    // A model switch during a turn can leave Copilot without its final session.idle event,
    // so queued and steering submissions only switch when the selection really changed.
    if (this.sessionModels.get(session) === key) return
    const { model } = getCopilotCustomProviderSessionOptions(options.model)
    await session.setModel(
      model ?? options.model,
      reasoningEffort ? { reasoningEffort } : undefined
    )
    this.sessionModels.set(session, key)
  }

  private addAdditionalDirectories = async (
    session: CopilotSession,
    options?: ProviderTurnOptions | ProviderOneShotOptions
  ): Promise<void> => {
    const directories = Array.from(
      new Set(
        (options?.additionalDirectories ?? []).filter((directory) => directory !== options?.cwd)
      )
    )

    const allowedDirectories = this.additionalDirectoriesBySession.get(session) ?? new Set<string>()

    await Promise.all(
      directories.map(async (path) => {
        if (allowedDirectories.has(path)) return
        const result = await session.rpc.permissions.paths.add({ path })
        if (!result.success) throw new Error(`Copilot could not add project directory: ${path}`)
        allowedDirectories.add(path)
      })
    )

    if (!this.additionalDirectoriesBySession.has(session)) {
      this.additionalDirectoriesBySession.set(session, allowedDirectories)
    }
  }

  private loadEvents = async (
    state: CopilotSessionState,
    options: { retainLive?: boolean; isCurrent?: () => boolean } = {}
  ): Promise<void> => {
    if (!state.session) return
    this.eventStores.get(state)?.seal()
    const before = state.events
    const events = await state.session.getEvents()
    if (options.isCurrent && !options.isCurrent()) return
    const liveChanges =
      state.events === before
        ? []
        : (() => {
            const previousObjects = new Set(before)
            return state.events.filter((event) => !previousObjects.has(event))
          })()
    state.events = reconcileProviderRecords(state.events, events, {
      authoritative: true,
      getId: (event) => event.id,
      compare: (first, second) =>
        toMilliseconds(first.timestamp) - toMilliseconds(second.timestamp),
      retainCurrent: (event) => options.retainLive === true || event.ephemeral === true
    })
    // The RPC snapshot may have started before a live event arrived. Keep those newer
    // objects, including replacements of an event with the same ID.
    if (liveChanges.length > 0) {
      state.events = reconcileProviderRecords(state.events, liveChanges, {
        authoritative: false,
        getId: (event) => event.id,
        compare: (first, second) =>
          toMilliseconds(first.timestamp) - toMilliseconds(second.timestamp)
      })
    }
  }

  private startChatTitleGeneration = (
    state: CopilotSessionState,
    prompt: string,
    options?: ProviderTurnOptions
  ): void => {
    void this.generateChatTitle(prompt, options, state.container)
      .then(async (title) => {
        if (!title || !state.session || this.states.get(state.id) !== state) return

        const result = await state.session.rpc.name.setAuto({ summary: title })
        if (!result.applied) return

        await this.loadSessionTitle(state)
        this.emitUpdate(state)
      })
      .catch((error) => {
        console.error('[caught:CopilotProviderAdapter:startChatTitleGeneration]', error)
      })
  }

  private generateChatTitle = async (
    prompt: string,
    options: ProviderTurnOptions | undefined,
    container: AppContainerTarget | null
  ): Promise<string | null> => {
    const selection = await this.ensureClient(container)
      .then((client) => client.listModels())
      .then(selectCopilotTitleModel)
      .catch((error) => {
        console.error('[caught:CopilotProviderAdapter:generateChatTitle]', error)
        return null
      })
    const titleOptions: ProviderOneShotOptions = {
      ...options,
      approvalPolicy: 'never',
      approvalsReviewer: options?.approvalsReviewer ?? 'user',
      container,
      files: undefined,
      images: undefined,
      model: selection?.model ?? 'auto',
      reasoningEffort: selection?.reasoningEffort ?? undefined,
      review: undefined,
      sandboxMode: 'read-only',
      serviceTier: null,
      skills: undefined,
      generationId: randomUUID()
    }
    const generatedTitle = await this.generateOneShot(createChatTitlePrompt(prompt), titleOptions)
    return normalizeGeneratedChatTitle(generatedTitle)
  }

  private loadSessionTitle = async (state: CopilotSessionState): Promise<void> => {
    if (!state.session) return
    const result = await state.session.rpc.name.get().catch((error) => {
      console.error('[caught:CopilotProviderAdapter:loadSessionTitle]', error)
      return null
    })
    if (!result) return

    state.title = result.name?.trim() || null
    if (state.metadata) {
      state.metadata = {
        ...state.metadata,
        name: state.title ?? undefined
      }
    }
  }

  private storeEvent = (state: CopilotSessionState, event: SessionEvent): void => {
    let store = this.eventStores.get(state)
    if (!store || store.events !== state.events) {
      // An authoritative reload or history truncation replaces the source array.
      store = new CopilotEventStore(state.events, (candidate) =>
        toMilliseconds(candidate.timestamp)
      )
      this.eventStores.set(state, store)
    }
    state.events = store.add(event)
  }

  private reportEventTokenUsage = (state: CopilotSessionState, event: SessionEvent): void => {
    if (
      event.type === 'assistant.usage' &&
      (event.data.inputTokens != null || event.data.outputTokens != null)
    ) {
      const started = event.agentId
        ? state.events.find(
            (candidate) =>
              candidate.type === 'subagent.started' && candidate.agentId === event.agentId
          )
        : undefined
      const attributedAt = toMilliseconds(started?.timestamp ?? event.timestamp)
      const user = state.events.findLast(
        (candidate) =>
          candidate.type === 'user.message' &&
          !isCopilotSystemContextMessage(candidate) &&
          !candidate.agentId &&
          toMilliseconds(candidate.timestamp) <= attributedAt
      )
      this.tokenUsageReporter.report({
        chatId: state.id,
        sourceKey: getContainerTargetKey(state.container),
        turnId: user?.id ?? null,
        recordId: event.data.providerCallId ?? event.data.apiCallId ?? event.id,
        timestamp: toMilliseconds(event.timestamp),
        usage: normalizeTokenUsage(
          event.data.inputTokens,
          event.data.cacheReadTokens,
          event.data.outputTokens,
          true
        ),
        models: [
          {
            modelId: event.data.model,
            nativePricingKey: `copilot:${getContainerTargetKey(state.container)}:${event.data.model}`,
            contextTokens: event.data.inputTokens,
            totalUSD:
              event.data.copilotUsage?.totalNanoAiu != null
                ? event.data.copilotUsage.totalNanoAiu / 100_000_000_000
                : undefined,
            cacheWriteTokens: event.data.cacheWriteTokens,
            usage: normalizeTokenUsage(
              event.data.inputTokens,
              event.data.cacheReadTokens,
              event.data.outputTokens,
              true
            )
          }
        ]
      })
    }
  }

  private handleEvent = (sessionId: string, event: SessionEvent): void => {
    const state = this.createState(sessionId)
    this.storeEvent(state, event)
    this.reportEventTokenUsage(state, event)

    if (event.type === 'session.autopilot_objective_changed') {
      void this.refreshGoal(state).then(() => this.emitUpdate(state))
      return
    }

    if (event.type === 'elicitation.requested') {
      const pending = state.pendingUserInputs.findLast(
        (value) =>
          value.elicitation &&
          !value.nativeRequestId &&
          value.request.question === event.data.message
      )
      if (pending) pending.nativeRequestId = event.data.requestId
    }
    if (event.type === 'elicitation.completed') {
      const index = state.pendingUserInputs.findIndex(
        (value) => value.nativeRequestId === event.data.requestId
      )
      if (index >= 0) {
        const [pending] = state.pendingUserInputs.splice(index, 1)
        pending.resolve({ kind: 'cancel' })
        this.emitUpdate(state)
      }
    }

    if (event.type === 'session.title_changed') {
      state.title = event.data.title.trim() || null
      if (state.metadata) {
        state.metadata = {
          ...state.metadata,
          name: state.title ?? undefined
        }
      }
    }
    if (isCopilotTurnActivityEvent(event)) {
      if (event.type === 'user.message' || event.type === 'assistant.turn_start') {
        state.turnGeneration += 1
        this.completionCoordinator.cancel(state.id)
      }
      state.active = true
      state.stopped = false
      state.failed = false
    }
    if (event.type === 'session.error') {
      state.browser?.suspend()
      console.error(
        `[CopilotProviderAdapter:handleEvent] Session ${state.id} failed: ${event.data.message}`
      )
      state.failed = true
    }
    if (event.type === 'abort') {
      state.browser?.suspend()
      state.active = false
      state.stopped = true
      this.cancelPendingUserInputs(state)
    }
    if (event.type === 'session.idle') {
      state.browser?.suspend()
      state.active = false
      state.stopped = Boolean(event.data.aborted)
      // One-shot generations await their own reply and delete the session right after,
      // so reconciling it later would only read a session that no longer exists.
      if (this.hiddenSessionIds.has(state.id)) return
      const completedTurnGeneration = state.turnGeneration
      const isCurrent = (): boolean =>
        this.states.get(state.id) === state && state.turnGeneration === completedTurnGeneration
      void this.completionCoordinator.complete(state.id, {
        // session.idle terminates the live lifecycle immediately. Persisted events are only a
        // recovery source for partial, duplicated, or out-of-order SDK notifications.
        publish: () => this.emitUpdate(state, true),
        reconcile: async () => {
          await new Promise((resolve) => setTimeout(resolve, copilotUpdateDelayMs))
          const results = await Promise.allSettled([
            this.loadEvents(state, { retainLive: true, isCurrent }),
            this.loadSessionTitle(state),
            this.refreshPlan(state),
            this.refreshGoal(state)
          ])
          const rejected = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
          )
          results.forEach((result) => {
            if (result.status === 'rejected') {
              console.error(
                `[CopilotProviderAdapter:reconcile] Unable to reconcile completed session ${state.id}`,
                result.reason
              )
            }
          })
          if (state.turnGeneration === completedTurnGeneration) state.active = false
          if (rejected) throw rejected.reason
        },
        publishReconciled: () => this.emitUpdate(state),
        isCurrent,
        onError: (error, phase) => {
          console.error(`Unable to ${phase} completed Copilot session ${state.id}`, error)
        }
      })
      if (!state.stopped && !state.failed) {
        void this.refreshPendingMessages(state)
          .then(() => this.scheduleQueueDrain(state))
          .catch((error) => console.error('Unable to reconcile pending Copilot steering.', error))
      }
      return
    }
    if (event.type === 'session.plan_changed' || event.type === 'session.todos_changed') {
      void this.refreshPlan(state).then(() => this.emitUpdate(state))
      return
    }
    if (event.type === 'pending_messages.modified') {
      void this.refreshPendingMessages(state)
        .then(() => {
          this.emitUpdate(state)
          this.scheduleQueueDrain(state)
        })
        .catch((error) => console.error('Unable to refresh pending Copilot messages.', error))
      return
    }

    this.queueUpdate(state)
  }

  private handlePermission = (
    sessionId: string,
    request: PermissionRequest
  ): Promise<PermissionRequestResult> | PermissionRequestResult => {
    const state = this.createState(sessionId)
    const options = state.options
    const readOnly = options?.sandboxMode === 'read-only'
    if (readOnly && !isReadOnlyPermission(request)) return { kind: 'reject' }
    if (options?.approvalPolicy === 'never' || options?.sandboxMode === 'danger-full-access') {
      return { kind: 'approve-once' }
    }

    return new Promise<PermissionRequestResult>((resolve) => {
      state.pendingPermissions.push({
        id: randomUUID(),
        request,
        startedAt: Date.now(),
        resolve
      })
      this.emitUpdate(state)
    })
  }

  private createElicitationHandler =
    (sessionId: string): NonNullable<SessionConfig['onElicitationRequest']> =>
    async (request) => {
      const state = this.createState(sessionId)
      const presentation = createProviderElicitation(`elicitation:${randomUUID()}`, {
        ...request,
        serverName: request.elicitationSource
      })
      return new Promise<Awaited<ReturnType<NonNullable<SessionConfig['onElicitationRequest']>>>>(
        (resolve) => {
          state.pendingUserInputs.push({
            id: presentation.id,
            request: { question: request.message },
            startedAt: presentation.startedAt!,
            elicitation: presentation,
            resolve: (response) =>
              resolve(
                getProviderElicitationResult(presentation, response) as Awaited<
                  ReturnType<NonNullable<SessionConfig['onElicitationRequest']>>
                >
              )
          })
          this.emitUpdate(state)
        }
      )
    }

  private handleUserInput = (
    sessionId: string,
    request: CopilotUserInputRequest
  ): Promise<CopilotUserInputResponse> => {
    const state = this.createState(sessionId)

    return new Promise<CopilotUserInputResponse>((resolve) => {
      state.pendingUserInputs.push({
        id: randomUUID(),
        request,
        startedAt: Date.now(),
        resolve: (response) =>
          resolve(
            response.kind === 'answer'
              ? { answer: response.answer, wasFreeform: response.wasFreeform }
              : { answer: '', wasFreeform: true }
          )
      })
      this.emitUpdate(state)
    })
  }

  private cancelPendingUserInputs = (state: CopilotSessionState): void => {
    state.pendingUserInputs.splice(0).forEach((pending) => pending.resolve({ kind: 'cancel' }))
  }

  private refreshPendingMessages = async (state: CopilotSessionState): Promise<void> => {
    if (!state.session) return
    const sequence = ++state.pendingRefreshSequence
    const result = await state.session.rpc.queue.pendingItems()
    if (sequence !== state.pendingRefreshSequence) return
    const previous = state.pendingMessages.filter(
      (message) =>
        message.delivery === 'provider' ||
        (message.delivery === 'submitting' && message.kind === 'steering')
    )
    const native: CopilotPendingMessage[] = []
    for (const item of result.items) {
      if (item.kind !== 'message') continue
      native.push(
        previous.find((message) => message.id === item.id) ?? {
          type: 'pendingMessage',
          id: item.id,
          kind: 'queued',
          content: item.displayText,
          delivery: 'provider'
        }
      )
    }
    for (const content of result.steeringMessages.slice(result.inFlightSteeringCount ?? 0)) {
      const index = previous.findIndex(
        (message) => message.kind === 'steering' && message.content === content
      )
      native.push(
        index >= 0
          ? previous.splice(index, 1)[0]!
          : {
              type: 'pendingMessage',
              id: randomUUID(),
              kind: 'steering',
              content,
              delivery: 'provider'
            }
      )
    }
    const live = new Set(native)
    const retained = state.pendingMessages.filter(
      (message) =>
        message.delivery !== 'provider' ||
        live.has(message) ||
        this.pendingMessageEdits.get(state.id)?.messageId === message.id
    )
    state.pendingMessages = [
      ...retained,
      ...native.filter((message) => !retained.includes(message))
    ]
  }

  private refreshPlan = async (state: CopilotSessionState): Promise<void> => {
    const session = state.session
    if (!session) return

    const sequence = ++state.planRefreshSequence
    const [todosResult, planResult] = await Promise.all([
      session.rpc.plan.readSqlTodosWithDependencies().catch((error) => {
        console.error('[caught:CopilotProviderAdapter:refreshPlan]', error)
        return null
      }),
      session.rpc.plan.read().catch((error) => {
        console.error('[caught:CopilotProviderAdapter:refreshPlan]', error)
        return null
      })
    ])
    if (
      state.session !== session ||
      state.planRefreshSequence !== sequence ||
      this.states.get(state.id) !== state
    ) {
      return
    }

    const items = (todosResult?.rows ?? []).flatMap((row): CopilotRenderedPlan['items'] => {
      const step = row.title?.trim() || row.description?.trim()
      return step ? [{ step, status: normalizePlanStatus(row.status) }] : []
    })
    state.plan =
      items.length > 0
        ? { explanation: null, items }
        : parseMarkdownPlan(planResult?.exists ? planResult.content : null)
  }

  private refreshGoal = async (state: CopilotSessionState): Promise<void> => {
    if (this.hiddenSessionIds.has(state.id)) return
    const session = state.session
    if (!session?.rpc?.autopilotObjective?.getState) {
      state.goalCommand = null
      state.goalSupportSession = undefined
      return
    }
    const sequence = ++state.goalRefreshSequence
    try {
      const [result, commands] = await Promise.all([
        session.rpc.autopilotObjective.getState(),
        state.goalSupportSession === session ? null : session.rpc.commands.list()
      ])
      if (
        state.session !== session ||
        this.states.get(state.id) !== state ||
        state.goalRefreshSequence !== sequence
      )
        return
      if (commands) {
        state.goalCommand =
          commands.commands.find(
            (command) =>
              command.kind === 'builtin' &&
              (command.name === 'goal' ||
                command.name === 'autopilot' ||
                command.aliases?.includes('goal'))
          )?.name ?? null
        state.goalSupportSession = session
      }
      state.goal = mapCopilotGoal(
        state.id,
        result.state,
        state.goal && state.goalNativeId !== undefined
          ? { id: state.goalNativeId, goal: state.goal }
          : undefined
      )
      state.goalNativeId = result.state?.id
    } catch (error) {
      if (state.session !== session || state.goalRefreshSequence !== sequence) return
      const unsupported =
        typeof error === 'object' && error !== null && 'code' in error && error.code === -32601
      if (state.goalSupportSession !== session || unsupported) {
        state.goalCommand = null
        state.goalSupportSession = undefined
      }
      console.warn(`Unable to read optional Copilot goal for session ${state.id}`, error)
    }
  }

  private queueUpdate = (state: CopilotSessionState): void => {
    if (this.updateTimers.has(state.id)) return
    const timer = setTimeout(() => {
      this.updateTimers.delete(state.id)
      this.emitUpdate(state)
    }, copilotUpdateDelayMs)
    this.updateTimers.set(state.id, timer)
  }

  private emitUpdate = (state: CopilotSessionState, turnCompleted = false): void => {
    const timer = this.updateTimers.get(state.id)
    if (timer) {
      clearTimeout(timer)
      this.updateTimers.delete(state.id)
    }
    if (this.states.get(state.id) !== state) return
    this.persistPendingMessages(state)
    if (this.hiddenSessionIds.has(state.id)) return
    const detail = this.createChatDetail(state, { startIndex: null, limit: 10 })
    this.chatUpdatedListeners.forEach((listener) => listener(detail, { turnCompleted }))
  }

  private getTitle = (state: CopilotSessionState): string => {
    if (state.title?.trim()) return state.title.trim()
    if (state.metadata?.name?.trim()) return state.metadata.name.trim()
    if (state.metadata?.summary?.trim()) return truncate(state.metadata.summary, 80)
    const firstUserMessage = state.events.find(
      (event): event is Extract<SessionEvent, { type: 'user.message' }> =>
        event.type === 'user.message' && !event.agentId && !isCopilotSystemContextMessage(event)
    )
    return firstUserMessage ? truncate(firstUserMessage.data.content, 80) : 'Copilot session'
  }

  private getCwd = (state: CopilotSessionState): string | null =>
    getEventCwd(state.events) ?? state.metadata?.context?.workingDirectory ?? null

  private getPendingApproval = (state: CopilotSessionState): ProviderPendingApproval | null => {
    const pending = state.pendingPermissions[0]
    if (!pending) return null
    const cwd = this.getCwd(state)

    return {
      id: pending.id,
      type: pending.request.kind === 'write' ? 'fileChange' : 'command',
      command: getPermissionDescription(pending.request),
      cwd,
      reason: getPermissionReason(pending.request),
      startedAt: pending.startedAt
    }
  }

  private getPendingUserInput = (state: CopilotSessionState): ProviderPendingUserInput | null => {
    const pending = state.pendingUserInputs[0]
    if (!pending) return null
    if (pending.elicitation) return pending.elicitation
    const presentation = getUserInputPresentation(state, pending.request)

    return {
      id: pending.id,
      question: pending.request.question,
      choices: presentation.choices,
      allowFreeform: presentation.allowFreeform,
      startedAt: pending.startedAt
    }
  }

  private createChatDetail = (
    state: CopilotSessionState,
    window?: ProviderChatTurnWindow
  ): ProviderChatDetail => {
    this.eventStores.get(state)?.seal()
    state.revision += 1
    return {
      id: state.id,
      revision: state.revision,
      createdAt: state.metadata ? toMilliseconds(state.metadata.startTime) : state.createdAt,
      title: this.getTitle(state),
      cwd: this.getCwd(state),
      cwdKind: 'directory',
      projectCwd: null,
      branchName: null,
      worktreeBaseBranchName: null,
      status: state.pendingUserInputs.length
        ? 'waitingOnUserInput'
        : state.pendingPermissions.length
          ? 'waitingOnApproval'
          : state.failed
            ? 'error'
            : state.active
              ? 'active'
              : null,
      lastTurnOutcome: state.active
        ? null
        : state.failed
          ? 'failed'
          : state.stopped
            ? 'stopped'
            : (getCopilotTurnOutcome(state.events) ?? null),
      pinned: false,
      sidebarOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: state.container,
      capabilities: {
        editMessages: true,
        activeMessages: true,
        setGoal: Boolean(state.goalCommand)
      },
      goal: state.goal,
      pendingApproval: this.getPendingApproval(state),
      pendingUserInput: this.getPendingUserInput(state),
      contextUsage: getContextUsage(state.events),
      ...(() => {
        const settings = {
          active: state.active || state.pendingUserInputs.length > 0,
          stopped: state.stopped,
          failed: state.failed,
          pendingItems: state.pendingMessages.map(
            ({ options: _options, delivery: _delivery, ...message }) => message
          ),
          plan: state.plan
        }
        return window
          ? renderCopilotChatWindow(state.events, settings, window)
          : { items: renderCopilotChatItems(state.events, settings) }
      })()
    }
  }

  private createChatFromMetadata = (
    metadata: CopilotSessionMetadata,
    container?: AppContainerTarget | null
  ): ProviderChat => {
    const state = this.states.get(metadata.sessionId)
    const detail = state ? this.createChatDetail(state, { startIndex: null, limit: 10 }) : null
    if (!state && container !== undefined) this.sessionContainers.set(metadata.sessionId, container)
    const preview =
      detail?.items.findLast((item) => item.type === 'message')?.content ?? metadata.summary ?? ''
    const metadataName = metadata.name?.trim()

    return {
      id: metadata.sessionId,
      providerId: this.id,
      title: detail?.title ?? metadataName ?? truncate(metadata.summary ?? 'Copilot session', 80),
      preview: truncate(preview, 500),
      cwd: detail?.cwd ?? metadata.context?.workingDirectory ?? null,
      cwdKind: 'directory',
      projectCwd: null,
      branchName: metadata.context?.branch ?? null,
      worktreeBaseBranchName: null,
      createdAt: toMilliseconds(metadata.startTime),
      updatedAt: toMilliseconds(metadata.modifiedTime),
      status: detail?.status ?? null,
      lastTurnOutcome: detail?.lastTurnOutcome,
      pendingApproval: detail?.pendingApproval ?? null,
      pinned: false,
      sidebarOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container:
        detail?.container ?? this.sessionContainers.get(metadata.sessionId) ?? container ?? null
    }
  }
}
