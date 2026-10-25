import { PendingMessageEdits } from '../PendingMessageEdits'
import { createProviderElicitation, getProviderElicitationResult } from '../ProviderElicitation'
import { ClaudeLiveTokenUsage } from './ClaudeLiveTokenUsage.ts'
import { encodeClaudeHistory, historyMessageId } from '../NativeHistoryImport'
import { nativeHistoryFile } from '../NativeHistoryFile'
import { TokenUsageReporter } from '../TokenUsageReporter.ts'
import { normalizeTokenUsage, addTokenUsage, emptyTokenUsage } from '../../../shared/tokenUsage.ts'
import { ClaudeSessionDiscovery } from './ClaudeSessionDiscovery'
import { getClaudeSessionTitle } from './ClaudeSessionTitle'
import { getClaudeGoalCommand, mapClaudeActiveGoal } from './ClaudeGoals.ts'
import { ClaudeRemoteSessionStore as RemoteSessionStore } from './ClaudeRemoteSessionStore'
import { isCurrentContainerTarget } from '../../currentContainer'
import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { getBrowserAutomationService } from '../../browser/BrowserAutomation'
import { claudeBrowserServerName, createClaudeBrowserIntegration } from './ClaudeBrowserTools'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  getSessionInfo,
  getSubagentMessages,
  listSubagents,
  query,
  renameSession,
  type CanUseTool,
  type EffortLevel,
  type Options as ClaudeQueryOptions,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKActiveGoalMessage,
  type SDKSessionInfo,
  type SDKUserMessage,
  type SessionMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { AppContainerTarget } from '../../../shared/app'
import {
  isExpectedCommandAbsenceError,
  isExpectedFileAbsenceError
} from '../../../shared/expectedAbsence.ts'
import {
  providerOneShotGenerationCanceledMessage,
  type ProviderAccountUsage,
  type ProviderActiveSendMode,
  type ProviderApprovalDecision,
  type ProviderApprovalModeOption,
  type ProviderApp,
  type ProviderChat,
  type ProviderChatContextUsage,
  type ProviderChatDetail,
  type ProviderChatGoal,
  type ProviderChatListOptions,
  type ProviderChatPage,
  type ProviderLoginResult,
  type ProviderModel,
  type ProviderOneShotOptions,
  type ProviderPendingApproval,
  type ProviderPendingMessage,
  type ProviderPendingUserInput,
  type ProviderReasoningEffort,
  type ProviderResourceUpdateOptions,
  type ProviderSandboxModeOption,
  type ProviderSkill,
  type ProviderSourceOptions,
  type ProviderSubagent,
  type ProviderSubagentDetail,
  type ProviderTokenUsageBreakdown,
  type ProviderTurnOptions,
  type ProviderStartChatOptions,
  type ProviderUpdateAvailability,
  type ProviderUsageOptions,
  type ProviderUserInputResponse
} from '../../../shared/provider'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget'
import { getHostCommand, getHostExecutableCommand, type HostCommand } from '../../hostProcess'
import type {
  ProviderAdapter,
  ProviderChatUpdateMetadata,
  ProviderChatTurnCursorWindow,
  ProviderChatTurnWindow
} from '../ProviderAdapter'
import {
  ProviderConversationCompletionCoordinator,
  reconcileProviderRecords
} from '../ProviderConversationEngine.ts'
import { ProviderClientPool } from '../ProviderClientPool'
import {
  disableProviderSkill,
  listDisabledProviderSkills,
  mergeProviderSkills,
  restoreProviderSkill
} from '../providerResources'
import { getClaudeExecutable } from './ClaudeExecutable'
import { loadClaudeHistory } from './ClaudeHistory'
import { getClaudeLinkedChatSummary } from './ClaudeLinkedChatSummary'
import {
  raceLinkedChatCancellation,
  requireLinkedChatSummary,
  throwIfLinkedChatCancelled,
  watchLinkedChatForkTurn
} from '../linkedChatContext'
import { ClaudeHistoryPages, type ClaudeHistoryPage } from './ClaudeHistoryPages'
import {
  PersistentPendingMessages,
  type PersistedPendingMessage
} from '../PersistentPendingMessages'
import { sqlitePendingMessageBackend } from '../../database/pendingMessages'
import { openClaudeHistorySource } from './ClaudeHistorySource'
import { isClaudeAuthenticationFailure, isClaudeAuthenticationError } from './ClaudeAuthentication'
import { claudeAccounts } from './ClaudeAccounts'
import {
  ClaudeTranscriptProjection,
  getClaudeTurnOutcome,
  classifyClaudeTurnRecord,
  claudeBackgroundTurnSubtype,
  isClaudeInternalUserMessage,
  renderClaudeChatItems,
  renderClaudeChatWindow,
  findClaudeItemTurnWindow,
  resolveClaudeAssistantMessageUuid,
  type ClaudeTranscriptMessage
} from './ClaudeItemRenderers'
import { mapClaudeModels } from './ClaudeModels'
import { discoverClaudeModels } from './ClaudeModelDiscovery'
import {
  claudeReadOnlyAllowedTools,
  getClaudePermissionAction,
  getClaudePermissionMode
} from './ClaudePermissions'
import { getClaudeUpdateAvailability, updateClaudeProvider } from './ClaudeProviderUpdate'
import {
  getClaudeResultError,
  getClaudeResultLifecycleDecision,
  getClaudeSessionStateLifecycleDecision
} from './ClaudeQueryLifecycle'
import { getClaudeQueueDrainDecision } from './ClaudeQueueDrain'
import { discoverClaudeSkills, setClaudePluginEnabled } from './ClaudeSkillDiscovery'
import { getClaudePluginIdForSkillPath, getClaudeSkillInvocation } from './ClaudePluginSkills'
import {
  applyClaudeStreamEvent,
  clearClaudeStreamMessages,
  retainClaudeStreamTiming
} from './ClaudeStreaming'
import {
  collectClaudeSubagentSpawns,
  createClaudeSubagentSummary,
  readLocalClaudeSubagentMetadata
} from './ClaudeSubagents'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors'
import { mapClaudeRateLimits } from './ClaudeUsage'
import { getClaudeUserQuestions } from './ClaudeUserQuestions'
import { parseClaudeVersion, supportsClaudeResumeDropsTurn } from './ClaudeVersion'

type ClaudePendingApproval = {
  id: string
  toolName: string
  input: Record<string, unknown>
  title: string | null
  description: string | null
  reason: string | null
  startedAt: number
  resolve: (result: PermissionResult) => void
}

type ClaudePendingUserInput = {
  id: string
  question: string
  choices: ProviderPendingUserInput['choices']
  allowFreeform: boolean
  startedAt: number
  elicitation?: ProviderPendingUserInput['elicitation']
  resolve: (response: ProviderUserInputResponse) => void
}

type QueuedClaudeMessage = {
  kind?: 'queued' | 'steering'
  id: string
  content: string
  prompt: string
  options?: ProviderTurnOptions
  attachments: ClaudeTranscriptMessage['attachments']
  createdAt: number
}

type StoredClaudeContainer = Extract<AppContainerTarget, { kind: 'container' }>

type ClaudeSessionState = {
  id: string
  revision: number
  createdAt: number
  updatedAt: number
  container: StoredClaudeContainer | null
  cwd: string | null
  metadata: SDKSessionInfo | null
  goal: ProviderChatGoal | null
  goalUpdatedAt?: number
  goalMutation?: boolean
  goalRequest?: {
    id: string
    objective: string | null
    queueWasPaused: boolean
    control?: Query
    resolve: () => void
    reject: (error: Error) => void
  }
  messages: ClaudeTranscriptMessage[]
  /** The stored prefix is retrieved through cursors, independently of the live tail. */
  historyPagination?: ProviderChatDetail['turnPagination']
  /** Live records may reach Sele before the CLI finishes persisting them. */
  historyDirty?: boolean
  messageIds: Set<string>
  partialMessages: Map<string, ClaudeTranscriptMessage>
  query: Query | null
  browser: ReturnType<typeof createClaudeBrowserIntegration> | null
  input: AsyncMessageQueue<SDKUserMessage> | null
  options: ProviderTurnOptions | undefined
  active: boolean
  stopped: boolean
  failed: boolean
  pendingApprovals: ClaudePendingApproval[]
  pendingUserInputs: ClaudePendingUserInput[]
  queuedMessages: QueuedClaudeMessage[]
  /** Steering handed to Claude Code that it may not have folded into a turn yet. */
  submittedSteering: QueuedClaudeMessage[]
  queuedMessagesPaused: boolean
  queueDrainInProgress: boolean
  /**
   * Set while a finished turn waits briefly for context usage before its query may close. A
   * message sent then must wait for that decision; draining it would race the close.
   */
  resultSettling: boolean
  contextUsage: ProviderChatContextUsage | null
  queryReadOnly: boolean | null
  queryModel: string | undefined | null
  queryStartupRevision: number
  backgroundTaskIds: Set<string>
  terminalTaskIds: Set<string>
  subagentTaskStatuses: Map<string, ProviderSubagent['status']>
  waitingForSessionIdle: boolean
  /** A prompt was sent and Claude has not started answering it yet. */
  turnAwaitingStart: boolean
  /** Steering held until the turn starts, so it cannot overtake the turn's own prompt. */
  deferredSteering: SDKUserMessage[]
  /** The SDK may be preparing a follow-up before any assistant output arrives. */
  sessionBusy: boolean
  /** A background task finished and Claude has not started the turn that reads its result. */
  taskNotificationPending: boolean
  /** Set while an interrupt we asked for (to send a queued message) is ending the turn. */
  interruptRequested: boolean
}

type ClaudeOneShotGeneration = {
  container?: AppContainerTarget | null
  query: Query | null
  input: AsyncMessageQueue<SDKUserMessage> | null
  canceled: boolean
}

type StartQueryOptions = {
  forkFrom?: string
  resumeAt?: string
  resumeDropsTurn?: string
}

type ClaudeQueryRuntime = {
  command: HostCommand
  container: Extract<AppContainerTarget, { kind: 'container' }> | null
  accountRevision: number
}

type ClaudeControlQueryProfile = 'account' | 'apps' | 'usage'

type ClaudeControlQueryEntry = {
  query: Query
  input: AsyncMessageQueue<SDKUserMessage>
}

class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private readers: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) throw new Error('Claude input stream is closed')
    const reader = this.readers.shift()
    if (reader) reader({ done: false, value })
    else this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.readers.splice(0).forEach((reader) => reader({ done: true, value: undefined }))
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ done: false, value })
        if (this.closed) return Promise.resolve({ done: true, value: undefined })
        return new Promise((resolve) => this.readers.push(resolve))
      }
    }
  }
}

const claudeApprovalModes: ProviderApprovalModeOption[] = [
  {
    id: 'ask-user',
    label: 'Ask me',
    description: 'Ask before Claude runs permission-gated tools.',
    isDefault: true
  },
  {
    id: 'auto-review',
    label: 'Auto-review',
    description: 'Let Claude auto-mode review permission-gated tools.',
    isDefault: false
  },
  {
    id: 'never',
    label: 'Never ask',
    description: 'Automatically approve Claude tool requests within the selected sandbox.',
    isDefault: false
  }
]

const claudeSandboxModes: ProviderSandboxModeOption[] = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Allow inspection while disabling commands and file mutations.',
    isDefault: false
  },
  {
    id: 'workspace-write',
    label: 'Workspace write',
    description: 'Run commands in Claude Code’s workspace sandbox.',
    isDefault: true
  },
  {
    id: 'danger-full-access',
    label: 'Full access',
    description: 'Disable Claude Code filesystem sandbox restrictions.',
    isDefault: false
  }
]

const emptyUsageSummary = {
  lifetimeTokens: null,
  peakDailyTokens: null,
  longestRunningTurnSec: null,
  currentStreakDays: null,
  longestStreakDays: null
}

const updateDelayMs = 35
const contextUsageCloseGraceMs = 1_000
// Time for the last background task's notification to start its main-thread turn.
const backgroundIdleCloseGraceMs = 15_000
const interruptCloseGraceMs = 500
const turnOptionsTimeoutMs = 15_000
const oneShotCancellationRetentionMs = 60_000
const sessionTitleRefreshDelayMs = 5_000
const maxIdleSessionStates = 8
const maxIdleTranscriptBytes = 32 * 1024 * 1024
const maxPreviewLength = 500
const allowedEffortLevels = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max'])
const backgroundFeatureRestrictions = {
  disableAllHooks: true,
  disableAgentView: true,
  disableRemoteControl: true,
  disableWorkflows: true,
  disableArtifact: true
} as const

const remoteTranscriptMaxBuffer = 64 * 1024 * 1024
const remoteTranscriptTimeoutMs = 30_000
const maxConcurrentRemoteTranscriptCommands = 2
let activeRemoteTranscriptCommands = 0
const pendingRemoteTranscriptCommands: Array<() => void> = []

const acquireRemoteTranscriptCommand = (): Promise<void> =>
  new Promise((resolve) => {
    const acquire = (): void => {
      activeRemoteTranscriptCommands += 1
      resolve()
    }

    if (activeRemoteTranscriptCommands < maxConcurrentRemoteTranscriptCommands) acquire()
    else pendingRemoteTranscriptCommands.push(acquire)
  })

const runRemoteTranscriptCommand = async <Result>(run: () => Promise<Result>): Promise<Result> => {
  await acquireRemoteTranscriptCommand()
  try {
    return await run()
  } finally {
    activeRemoteTranscriptCommands -= 1
    pendingRemoteTranscriptCommands.shift()?.()
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const runHostCommand = (command: HostCommand): Promise<string> =>
  runRemoteTranscriptCommand(
    () =>
      new Promise((resolve, reject) => {
        const child = execFile(
          command.file,
          command.args,
          {
            cwd: command.cwd,
            env: command.env,
            encoding: 'utf8',
            maxBuffer: remoteTranscriptMaxBuffer,
            timeout: remoteTranscriptTimeoutMs,
            windowsHide: true
          },
          (error, stdout) => {
            if (error) reject(error)
            else resolve(stdout)
          }
        )
        child.stdin?.end()
      })
  )

const settleWithin = (promise: Promise<unknown>, timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    const finish = (): void => {
      clearTimeout(timer)
      resolve()
    }
    void promise.then(finish, finish)
  })

const awaitClaudeTurnOptions = (promise: Promise<unknown>): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Claude did not apply chat settings in time. Try sending again.')),
      turnOptionsTimeoutMs
    )
    void promise.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

class ClaudeRemoteSessionStore extends RemoteSessionStore {
  constructor(container: StoredClaudeContainer) {
    super(async (script, args = []) =>
      runHostCommand(
        await getHostCommand('sh', ['-lc', script, 'sele-claude-session-store', ...args], {
          container,
          env: process.env
        })
      )
    )
  }
}

/**
 * A chat bound to the container Sele itself runs in shares this filesystem. Read its
 * transcript directly, as Claude Code does, instead of spawning a shell per range read.
 */
const getRemoteClaudeContainer = async (
  container: StoredClaudeContainer | null
): Promise<StoredClaudeContainer | null> =>
  container && !(await isCurrentContainerTarget(container)) ? container : null

const getClaudeSessionStore = async (
  container: StoredClaudeContainer | null
): Promise<ClaudeRemoteSessionStore | undefined> => {
  const remote = await getRemoteClaudeContainer(container)
  return remote ? new ClaudeRemoteSessionStore(remote) : undefined
}

const getClaudeSessionStoreOption = async (
  container: StoredClaudeContainer | null
): Promise<{ sessionStore?: ClaudeRemoteSessionStore }> => {
  const sessionStore = await getClaudeSessionStore(container)
  return sessionStore ? { sessionStore } : {}
}

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const isExpectedClaudeSessionMetadataAbsenceError = (error: unknown): boolean =>
  isExpectedFileAbsenceError(error) || isExpectedCommandAbsenceError(error, [4])

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

const toEffortLevel = (value: ProviderReasoningEffort | undefined): EffortLevel | undefined =>
  value && allowedEffortLevels.has(value as EffortLevel) ? (value as EffortLevel) : undefined

const getClaudeModel = (
  options: ProviderTurnOptions | ProviderOneShotOptions | undefined
): string | undefined => (options?.model === 'default' ? undefined : options?.model)

const getRuntimeEnvironment = (env: NodeJS.ProcessEnv | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env ?? process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

const isStoredContainer = (
  container: AppContainerTarget | null | undefined
): container is Extract<AppContainerTarget, { kind: 'container' }> =>
  container?.kind === 'container'

const getSandbox = (
  options: ProviderTurnOptions | ProviderOneShotOptions | undefined
): NonNullable<ClaudeQueryOptions['sandbox']> => {
  if (!options || options.sandboxMode === 'danger-full-access') return { enabled: false }
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: options.sandboxMode === 'workspace-write',
    allowUnsandboxedCommands: false
  }
}

const getMessageContent = (message: unknown): unknown =>
  isRecord(message) ? message.content : undefined

const getTextFromContent = (content: unknown): string => {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block): string[] =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )
    .join('\n')
    .trim()
}

const toTranscriptMessage = (
  message: SessionMessage | Extract<SDKMessage, { type: 'user' | 'assistant' }>
): ClaudeTranscriptMessage => ({
  type: message.type,
  uuid: message.uuid ?? randomUUID(),
  session_id: message.session_id ?? '',
  message: message.message,
  parent_tool_use_id: message.parent_tool_use_id,
  ...('error' in message && typeof message.error === 'string' ? { error: message.error } : {}),
  ...('isSynthetic' in message && message.isSynthetic === true ? { isSynthetic: true } : {}),
  // The SDK types omit isMeta, but live stream events still carry it for injected context
  // such as skill bodies. Keep it so the renderer can hide those from the person.
  ...('isMeta' in message && message.isMeta === true ? { isMeta: true } : {}),
  ...('isCompactSummary' in message && message.isCompactSummary === true
    ? { isCompactSummary: true }
    : {}),
  ...('timestamp' in message && typeof message.timestamp === 'string'
    ? { timestamp: message.timestamp }
    : {}),
  ...('tool_use_result' in message ? { tool_use_result: message.tool_use_result } : {})
})

const getAttachments = (
  options: ProviderTurnOptions | ProviderOneShotOptions | undefined
): ClaudeTranscriptMessage['attachments'] => [
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

const getPrompt = (
  message: string,
  options: ProviderTurnOptions | ProviderOneShotOptions | undefined
): string => {
  let prompt = message
  const skills = options?.skills ?? []
  if (skills.length > 0) {
    const selectedMentions = skills.map((skill) => `$${skill.name}`)
    selectedMentions.forEach((mention) => {
      if (prompt.startsWith(mention)) prompt = prompt.slice(mention.length).trimStart()
    })
    const invocation =
      skills.length === 1
        ? getClaudeSkillInvocation(skills[0]!.name, skills[0]!.path)
        : `Use each of these skills before proceeding: ${skills
            .map((skill) => getClaudeSkillInvocation(skill.name, skill.path))
            .join(', ')}.`
    prompt = `${invocation}${prompt ? `\n${prompt}` : ''}`
  }
  const files = [...(options?.files ?? []), ...(options?.images ?? [])]
  if (files.length > 0) {
    prompt = `${prompt}${prompt ? '\n\n' : ''}${files.map((file) => `@${file.path}`).join('\n')}`
  }
  return prompt
}

const createSdkUserMessage = (
  sessionId: string,
  id: string,
  prompt: string,
  priority?: SDKUserMessage['priority']
): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: prompt },
  parent_tool_use_id: null,
  origin: { kind: 'human' },
  ...(priority ? { priority } : {}),
  uuid: id as `${string}-${string}-${string}-${string}-${string}`,
  session_id: sessionId
})

const isFileChangeTool = (toolName: string): boolean =>
  ['Edit', 'Write', 'NotebookEdit'].includes(toolName)

const getPermissionCommand = (toolName: string, input: Record<string, unknown>): string =>
  getString(input.command) ??
  getString(input.file_path) ??
  getString(input.path) ??
  getString(input.url) ??
  toolName.replace(/([a-z])([A-Z])/g, '$1 $2')

const getTokenBreakdown = (
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number
): ProviderTokenUsageBreakdown => ({
  totalTokens: inputTokens + outputTokens,
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningOutputTokens: 0
})

export class ClaudeProviderAdapter implements ProviderAdapter {
  constructor(private readonly accountId?: string) {}

  private pendingMessageEdits = new PendingMessageEdits()
  private pendingMessageStore = new PersistentPendingMessages<QueuedClaudeMessage>(
    'claude',
    sqlitePendingMessageBackend
  )
  private readonly sessionDiscovery = new ClaudeSessionDiscovery()
  id = 'claude' as const
  private tokenUsageReporter = new TokenUsageReporter()
  private tokenUsageQueryIds = new WeakMap<Query, string>()
  private liveTokenUsage = new ClaudeLiveTokenUsage()
  onTokenUsage = this.tokenUsageReporter.subscribe

  private states = new Map<string, ClaudeSessionState>()
  // Delivery and renderer caches outlive idle transcript eviction. A reloaded session must
  // never restart below a revision those consumers have already seen.
  private detailRevision = 0
  private stateLoads = new Map<string, Promise<ClaudeSessionState>>()
  private historyPages = new ClaudeHistoryPages()
  private stateGeneration = 0
  private disposed = false
  private pinnedStates = new Map<ClaudeSessionState, number>()
  private completingStates = new Set<ClaudeSessionState>()
  private stateTranscriptBytes = new WeakMap<ClaudeSessionState, number>()
  private admissionLeases = new Map<ClaudeSessionState, ReturnType<typeof setTimeout>>()
  private sessionContainers = new Map<string, StoredClaudeContainer | null>()
  private sessionMetadata = new Map<string, SDKSessionInfo>()
  private sessionOptions = new Map<string, ProviderTurnOptions>()
  private transcriptProjections = new Map<ClaudeSessionState, ClaudeTranscriptProjection>()
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private metadataRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private completionCoordinator = new ProviderConversationCompletionCoordinator()
  private oneShotGenerations = new Map<string, ClaudeOneShotGeneration>()
  private canceledOneShotGenerationIds = new Set<string>()
  private canceledOneShotGenerationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private hiddenSessionIds = new Set<string>()
  private resumeDropsTurnSupport = new Map<string, Promise<boolean>>()
  private modelDiscoveryRequests = new Map<string, Promise<ProviderModel[]>>()
  private modelDiscoveryQueries = new WeakSet<Query>()
  private accountChanges = new Map<string, Promise<unknown>>()
  private accountRevisions = new Map<string, number>()
  private authenticationFailures = new Set<string>()
  private authenticatedSources = new Set<string>()

  private requireAuthentication = (state: Pick<ClaudeSessionState, 'container'>): void => {
    if (this.authenticationFailures.has(getContainerTargetKey(state.container))) {
      throw new Error('Claude authentication expired. Sign in again before sending messages.')
    }
  }
  private controlQueries = new ProviderClientPool<ClaudeControlQueryEntry>((entry) =>
    this.closeControlQueryEntry(entry)
  )

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult> => {
    const pending = await claudeAccounts.login(options)
    if (pending) return pending
    return this.withControlQuery(options, 'account', async (control) => {
      const account = await control.accountInfo()
      return {
        status: 'authenticated' as const,
        account: {
          label: account.organization || account.email || account.subscriptionType || 'Claude'
        }
      }
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Claude is not authenticated. Run \`claude auth login\` first. ${detail}`)
    })
  }

  releaseChat = async (chatId: string): Promise<void> => {
    const state = this.states.get(chatId)
    if (!state) return
    if (
      state.active ||
      state.queueDrainInProgress ||
      state.pendingApprovals.length ||
      state.pendingUserInputs.length
    )
      await this.stopChat(chatId)
    await this.closeStateQuery(state)
    this.states.delete(chatId)
  }

  changeAccount = <T>(
    container: AppContainerTarget | null | undefined,
    change: () => Promise<T>
  ): Promise<T> => {
    const key = getContainerTargetKey(container)
    const previous = this.accountChanges.get(key) ?? Promise.resolve()
    const pending = previous
      .catch((error: unknown) => {
        console.error('The previous Claude account switch failed.', error)
      })
      .then(async () => {
        this.accountRevisions.set(key, (this.accountRevisions.get(key) ?? 0) + 1)
        for (const profile of ['account', 'apps', 'usage'])
          this.controlQueries.invalidateKey(`${profile}:${key}`)
        this.modelDiscoveryRequests.delete(`account:${key}`)
        for (const generation of this.oneShotGenerations.values()) {
          if (getContainerTargetKey(generation.container) !== key) continue
          generation.canceled = true
          generation.input?.close()
          generation.query?.close()
        }
        await Promise.all(
          [...this.states.values()]
            .filter((state) => getContainerTargetKey(state.container) === key)
            .map(async (state) => {
              const hasUnfinishedTurn =
                state.active ||
                (state.queueDrainInProgress && !state.queuedMessagesPaused) ||
                state.pendingApprovals.length > 0 ||
                state.pendingUserInputs.length > 0
              if (hasUnfinishedTurn) {
                await this.stopChat(state.id)
              } else {
                // Retire the old credentials without turning a completed (or failed)
                // response into a stopped turn. Leave any queued messages paused.
                state.queuedMessagesPaused = state.queuedMessages.length > 0
                await this.closeStateQuery(state)
              }
            })
        )
        const result = await change()
        this.authenticationFailures.delete(key)
        this.authenticatedSources.add(key)
        for (const state of this.states.values()) {
          if (getContainerTargetKey(state.container) === key) this.emitUpdate(state, false, false)
        }
        return result
      })
    this.accountChanges.set(key, pending)
    void pending
      .finally(() => {
        if (this.accountChanges.get(key) === pending) this.accountChanges.delete(key)
      })
      .catch((error: unknown) => {
        console.error('Unable to switch Claude accounts.', error)
      })
    return pending
  }

  getUpdateAvailability = async (
    options: ProviderSourceOptions = {}
  ): Promise<ProviderUpdateAvailability | null> =>
    getClaudeUpdateAvailability({ container: options.container, env: process.env })

  updateProvider = async (
    options: ProviderSourceOptions = {}
  ): Promise<ProviderUpdateAvailability | null> => {
    try {
      return await updateClaudeProvider({ container: options.container, env: process.env })
    } finally {
      this.resumeDropsTurnSupport.clear()
      const key = `account:${getContainerTargetKey(options.container)}`
      this.controlQueries.invalidateKey(key)
      this.modelDiscoveryRequests.delete(key)
    }
  }

  getApprovalModes = async (): Promise<ProviderApprovalModeOption[]> => claudeApprovalModes

  getSandboxModes = async (): Promise<ProviderSandboxModeOption[]> => claudeSandboxModes

  getModels = async (options: ProviderSourceOptions = {}): Promise<ProviderModel[]> => {
    const key = `account:${getContainerTargetKey(options.container)}`
    const pending = this.modelDiscoveryRequests.get(key)
    if (pending) return pending

    const request = this.withControlQuery(options, 'account', async (control) => {
      const refresh = this.modelDiscoveryQueries.has(control)
      this.modelDiscoveryQueries.add(control)
      const models = await discoverClaudeModels(control, refresh)
      if (models.length === 0) throw new Error('Claude did not report any supported models.')
      return mapClaudeModels(models)
    })
      .catch((error: unknown) => {
        console.error('Unable to discover Claude models.', error)
        throw error
      })
      .finally(() => {
        if (this.modelDiscoveryRequests.get(key) === request) {
          this.modelDiscoveryRequests.delete(key)
        }
      })
    this.modelDiscoveryRequests.set(key, request)
    return request
  }

  getSkills = async (
    cwd?: string | null,
    options: ProviderSourceOptions = {}
  ): Promise<ProviderSkill[]> => {
    const [discoveredSkills, disabledSkills] = await Promise.all([
      discoverClaudeSkills(cwd, options.container),
      listDisabledProviderSkills('claude', options.container)
    ])
    return mergeProviderSkills(discoveredSkills, disabledSkills)
  }

  getApps = async (options: ProviderSourceOptions = {}): Promise<ProviderApp[]> =>
    this.withControlQuery(options, 'apps', async (control) => {
      const servers = await control.mcpServerStatus()
      return servers
        .map((server) => ({
          id: server.name,
          name: server.serverInfo?.name || server.name,
          description:
            server.status === 'failed'
              ? server.error || 'Claude MCP server failed to connect.'
              : `Claude MCP server · ${server.status}`,
          enabled: server.status !== 'disabled',
          callable: server.status === 'connected',
          skillNames: []
        }))
        .sort((first, second) => first.name.localeCompare(second.name))
    })

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
    const changedSkills = paths
      .map((path) => {
        const skill = skillsByPath.get(path)
        if (!skill) throw new Error('Skill is not available in this environment')
        return skill
      })
      .filter((skill) => skill.enabled !== enabled)

    const pluginUpdates = new Map<string, Promise<void>>()
    const results = await Promise.allSettled(
      changedSkills.map(async (skill) => {
        const pluginId = getClaudePluginIdForSkillPath(skill.path)
        if (pluginId) {
          if (enabled) {
            await restoreProviderSkill(skill.path, options.container, { skipIfOccupied: true })
          }
          let update = pluginUpdates.get(pluginId)
          if (!update) {
            update = setClaudePluginEnabled(pluginId, enabled, options.container)
            pluginUpdates.set(pluginId, update)
          }
          return update
        }
        if (!enabled) return disableProviderSkill('claude', skill, options.container)
        const restored = await restoreProviderSkill(skill.path, options.container)
        if (!restored) throw new Error('Skill was not disabled by Sele')
      })
    )
    const failure = results.find((result) => result.status === 'rejected')
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `Unable to update Claude skill ${changedSkills[index]?.path ?? index}.`,
          result.reason
        )
      }
    })
    if (!toleratePartialFailure && failure?.status === 'rejected') throw failure.reason
    if (options.deferRefresh) {
      return changedSkills.map((skill, index) =>
        results[index]?.status === 'fulfilled' ? { ...skill, enabled } : skill
      )
    }
    return this.getSkills(cwd, options)
  }

  setAppEnabled = async (
    appId: string,
    enabled: boolean,
    options: ProviderResourceUpdateOptions = {}
  ): Promise<ProviderApp[]> =>
    this.withControlQuery(options, 'apps', async (control) => {
      await control.toggleMcpServer(appId, enabled)
      if (options.deferRefresh && options.knownApp?.id === appId) {
        return [{ ...options.knownApp, enabled }]
      }
      const servers = await control.mcpServerStatus()
      return servers.map((server) => ({
        id: server.name,
        name: server.serverInfo?.name || server.name,
        description: server.error || `Claude MCP server · ${server.status}`,
        enabled: server.status !== 'disabled',
        callable: server.status === 'connected',
        skillNames: []
      }))
    })

  getUsage = async (options: ProviderUsageOptions = {}): Promise<ProviderAccountUsage> => {
    options = { ...options, accountId: this.accountId }
    const sourceKey = getContainerTargetKey(options.container)
    const accountRevision = this.accountRevisions.get(sourceKey) ?? 0
    try {
      return await this.withControlQuery(options, 'usage', async (control) => {
        const usage = await control.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true
        })
        // Claude can report that subscription limits apply while silently returning
        // null after its usage request. Read the same account's endpoint in that case;
        // the SDK has already handled any credential refresh.
        if (usage.rate_limits) await claudeAccounts.rememberUsage(options, usage.rate_limits)
        // Missing credentials and an isolated config without the subscription
        // profile can both look like an API-key session to the usage API.
        const subscriptionLogin =
          !usage.rate_limits && !usage.rate_limits_available
            ? (await claudeAccounts.getAuthenticationMethod(options)) === 'claude.ai'
            : false
        const limits =
          usage.rate_limits ??
          (usage.rate_limits_available || subscriptionLogin
            ? await claudeAccounts.getUsageFallback(options)
            : null)
        return {
          updatedAt: Date.now(),
          statisticsLoaded: false,
          summary: emptyUsageSummary,
          dailyUsageBuckets: null,
          rateLimits: mapClaudeRateLimits(limits),
          rateLimitResetCredits: null,
          errors: [],
          authenticationRequired: this.authenticationFailures.has(sourceKey)
        }
      })
    } catch (error) {
      console.error('Unable to load Claude usage.', error)
      if (
        isClaudeAuthenticationError(error) &&
        accountRevision === (this.accountRevisions.get(sourceKey) ?? 0)
      ) {
        this.authenticationFailures.add(sourceKey)
        this.authenticatedSources.delete(sourceKey)
        for (const state of this.states.values()) {
          if (getContainerTargetKey(state.container) === sourceKey) {
            state.queuedMessagesPaused = true
            this.emitUpdate(state, false, false)
          }
        }
      }
      // Keep the last known limits through temporary failures such as rate limiting.
      const lastLimits = isClaudeAuthenticationError(error)
        ? null
        : await claudeAccounts.getLastUsage(options).catch(() => null)
      return {
        authenticationRequired: this.authenticationFailures.has(sourceKey),
        updatedAt: Date.now(),
        statisticsLoaded: false,
        summary: emptyUsageSummary,
        dailyUsageBuckets: null,
        rateLimits: mapClaudeRateLimits(lastLimits),
        rateLimitResetCredits: null,
        errors: [error instanceof Error ? error.message : 'Claude usage is unavailable.']
      }
    }
  }

  resetRateLimits = async (): Promise<'nothingToReset'> => 'nothingToReset'

  getChatTerminalTasks = async (chatId: string): Promise<string[]> => [
    ...(this.states.get(chatId)?.terminalTaskIds ?? [])
  ]

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const normalizedContainer = normalizeContainerTarget(options.container)
    const container = isStoredContainer(normalizedContainer) ? normalizedContainer : null
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const { sessions: page, nextCursor } = await this.sessionDiscovery.list(
      container,
      options.cursor ?? null,
      limit,
      [...this.hiddenSessionIds]
    )
    page.forEach((session) => {
      this.sessionContainers.set(session.sessionId, container)
      this.sessionMetadata.set(session.sessionId, session)
    })
    const chats: ProviderChat[] = []
    for (let index = 0; index < page.length; index += 8) {
      chats.push(
        ...(await Promise.all(
          page.slice(index, index + 8).map(async (session) => {
            const chat = this.createChatFromMetadata(session)
            if (chat.status === 'active' || chat.pendingApproval) return chat
            try {
              const latest = await this.readHistoryPage(session.sessionId, container, {
                cursor: null,
                direction: 'older',
                limit: 1
              })
              return {
                ...chat,
                updatedAt: Math.max(chat.updatedAt, latest.metadata.lastModified),
                lastTurnOutcome: getClaudeTurnOutcome(latest.messages)
              }
            } catch (error) {
              console.error('Unable to read latest Claude sidebar turn.', error)
              return chat
            }
          })
        ))
      )
    }
    return { chats, nextCursor }
  }

  getChat = async (
    chatId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, undefined, options.container)
    return this.createChatDetail(state)
  }

  getChatWindow = async (
    chatId: string,
    window: ProviderChatTurnWindow,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    if (window.startIndex == null) {
      const existing = this.states.get(chatId)
      const state = await this.ensureState(chatId, undefined, options.container)
      if (existing === state) await this.refreshIdleHistory(state)
      if (state.historyPagination && window.limit !== 10) {
        const page = await this.readHistoryPage(chatId, state.container, {
          cursor: null,
          direction: 'older',
          limit: window.limit
        })
        return this.createChatDetail(
          { ...state, messages: page.messages, historyPagination: page.pagination },
          window
        )
      }
      return this.createChatDetail(state, window)
    }
    // Explicit full-history consumers (export/edit) are separate from opening and scrolling.
    const state = await this.ensureState(chatId, undefined, options.container)
    const messages = state.historyPagination?.olderCursor
      ? await this.readCompleteHistory(state)
      : state.messages
    // Export/numeric compatibility reads must not replace a live cursor view's state.
    return this.createChatDetail({ ...state, messages, historyPagination: undefined }, window)
  }

  getChatCursorWindow = async (
    chatId: string,
    window: ProviderChatTurnCursorWindow,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    if (!window.cursor)
      return this.getChatWindow(chatId, { startIndex: null, limit: window.limit }, options)
    const state = await this.ensureState(chatId, undefined, options.container)
    const page = await this.readHistoryPage(chatId, state.container, window)
    const detail = this.createChatDetail({
      ...state,
      messages: [],
      partialMessages: new Map(),
      historyPagination: undefined
    })
    const first = state.messages.findIndex((message) => message.uuid === page.messages[0]?.uuid)
    const messages =
      !page.pagination.newerCursor &&
      first >= 0 &&
      page.messages.every((message, index) => state.messages[first + index]?.uuid === message.uuid)
        ? state.messages.slice(first)
        : page.messages
    const items = renderClaudeChatItems(messages, { active: false, stopped: false })
    return {
      ...detail,
      items,
      itemsStartTurnIndex: 0,
      turnCount: getProviderChatTurns(items).length,
      turnPagination: page.pagination
    }
  }

  getChatWindowForItem = async (
    chatId: string,
    itemId: string,
    limit: number,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, undefined, options.container)
    if (state.historyPagination) {
      // Jump/tool expansion seeks page by page, retaining no historical message bodies.
      let detail = this.createChatDetail(state)
      while (!detail.items.some((item) => item.id === itemId || itemId.startsWith(`${item.id}:`))) {
        const cursor = detail.turnPagination?.olderCursor
        if (!cursor) throw new Error('Chat item not found')
        detail = await this.getChatCursorWindow(
          chatId,
          { cursor, direction: 'older', limit: 10 },
          options
        )
      }
      return detail
    }
    const window = findClaudeItemTurnWindow(state.messages, itemId, limit)
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
    const state = await this.ensureState(chatId, undefined, options.container)
    const sessionStore = await getClaudeSessionStore(state.container)
    const agentIds = await listSubagents(chatId, {
      ...(state.cwd ? { dir: state.cwd } : {}),
      ...(sessionStore ? { sessionStore } : {})
    })
    const transcripts = await Promise.all(
      agentIds.map(
        async (agentId) =>
          [
            agentId,
            await getSubagentMessages(chatId, agentId, {
              ...(state.cwd ? { dir: state.cwd } : {}),
              ...(sessionStore ? { sessionStore } : {})
            })
          ] as const
      )
    )
    const spawns = collectClaudeSubagentSpawns([
      state.messages,
      ...transcripts.map(([, messages]) => messages)
    ])
    const metadata = await this.loadSubagentMetadata(chatId, sessionStore)
    const subagents = transcripts.map(([agentId, messages]): ProviderSubagent => {
      const summary = createClaudeSubagentSummary(agentId, messages, spawns, metadata.get(agentId))
      return {
        ...summary,
        status:
          state.subagentTaskStatuses.get(agentId) ??
          (state.backgroundTaskIds.has(agentId) ? 'running' : 'completed')
      }
    })
    return subagents.sort(
      (first, second) =>
        (first.createdAt ?? Number.MAX_SAFE_INTEGER) - (second.createdAt ?? Number.MAX_SAFE_INTEGER)
    )
  }

  private loadSubagentMetadata = async (
    chatId: string,
    sessionStore: ClaudeRemoteSessionStore | undefined
  ): Promise<Map<string, unknown>> => {
    try {
      return sessionStore
        ? await sessionStore.loadSubagentMetadata(chatId)
        : await readLocalClaudeSubagentMetadata(chatId)
    } catch (error) {
      // Names fall back to the transcripts; the list itself must still load.
      console.error('[caught:ClaudeProviderAdapter:loadSubagentMetadata]', error)
      return new Map()
    }
  }

  getSubagent = async (
    chatId: string,
    subagentId: string,
    options: { container?: AppContainerTarget | null } = {},
    window?: ProviderChatTurnWindow
  ): Promise<ProviderSubagentDetail> => {
    const state = await this.ensureState(chatId, undefined, options.container)
    const sessionStore = await getClaudeSessionStore(state.container)
    const listOptions = {
      ...(state.cwd ? { dir: state.cwd } : {}),
      ...(sessionStore ? { sessionStore } : {})
    }
    const agentIds = await listSubagents(chatId, listOptions)
    if (!agentIds.includes(subagentId)) throw new Error('Claude subagent was not found.')

    const messages = await getSubagentMessages(chatId, subagentId, listOptions)
    const metadata = (await this.loadSubagentMetadata(chatId, sessionStore)).get(subagentId)
    // A nested subagent's delegation call is in its parent subagent's transcript.
    const parentAgentId =
      createClaudeSubagentSummary(subagentId, messages, new Map(), metadata).parentId ?? undefined
    const parentMessages =
      parentAgentId && agentIds.includes(parentAgentId)
        ? await getSubagentMessages(chatId, parentAgentId, listOptions)
        : []
    const summary = {
      ...createClaudeSubagentSummary(
        subagentId,
        messages,
        collectClaudeSubagentSpawns([state.messages, parentMessages, messages]),
        metadata
      ),
      status:
        state.subagentTaskStatuses.get(subagentId) ??
        (state.backgroundTaskIds.has(subagentId) ? ('running' as const) : ('completed' as const))
    }
    const transcript = messages.map((message) => ({
      ...toTranscriptMessage(message),
      parent_tool_use_id: null
    }))
    const rendered = window
      ? renderClaudeChatWindow(
          transcript,
          {
            active: summary.status === 'running' || summary.status === 'pending',
            stopped: summary.status === 'stopped',
            failed: summary.status === 'failed'
          },
          window
        )
      : null
    return {
      ...summary,
      ...(rendered ?? {
        items: renderClaudeChatItems(transcript, {
          active: summary.status === 'running' || summary.status === 'pending',
          stopped: summary.status === 'stopped',
          failed: summary.status === 'failed'
        })
      })
    }
  }

  cancelSubagent = async (
    chatId: string,
    subagentId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<void> => {
    const state = await this.ensureState(chatId, undefined, options.container)
    if (!state.query) return

    await state.query.stopTask(subagentId)
    state.backgroundTaskIds.delete(subagentId)
    state.subagentTaskStatuses.set(subagentId, 'stopped')
    this.emitUpdate(state)
  }

  setChatTitle = async (chatId: string, title: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.pinState(state)
    try {
      await renameSession(chatId, title, {
        ...(state.cwd ? { dir: state.cwd } : {}),
        ...(await getClaudeSessionStoreOption(state.container))
      })
      state.metadata = state.metadata
        ? { ...state.metadata, customTitle: title, summary: title }
        : {
            sessionId: chatId,
            summary: title,
            customTitle: title,
            lastModified: Date.now(),
            createdAt: state.createdAt,
            cwd: state.cwd ?? undefined
          }
      this.emitUpdate(state)
      return this.createChatDetail(state)
    } finally {
      this.unpinState(state)
      this.trimIdleStates(state)
    }
  }

  generateOneShot = async (message: string, options?: ProviderOneShotOptions): Promise<string> => {
    if (!message.trim()) throw new Error('Cannot generate from an empty message')
    const generationId = options?.generationId ?? randomUUID()
    if (this.oneShotGenerations.has(generationId)) {
      throw new Error('Duplicate one-shot generation ID')
    }
    const generation: ClaudeOneShotGeneration = {
      container: options?.container,
      query: null,
      input: null,
      canceled: this.takeCanceledOneShotGeneration(generationId)
    }
    this.oneShotGenerations.set(generationId, generation)
    const sessionId = randomUUID()
    this.hiddenSessionIds.add(sessionId)

    try {
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      const input = new AsyncMessageQueue<SDKUserMessage>()
      generation.input = input
      const runtime = await this.getQueryRuntime(options?.container, options?.cwd)
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      const control = query({
        prompt: input,
        options: {
          ...this.getBaseQueryOptions(options, runtime),
          sessionId,
          persistSession: false,
          tools: []
        }
      })
      generation.query = control
      input.push(createSdkUserMessage(sessionId, randomUUID(), getPrompt(message, options)))
      let result: string | null = null
      for await (const event of control) {
        if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
        if (event.type === 'result') {
          this.reportResultTokenUsage(
            { id: sessionId, container: options?.container },
            control,
            event
          )
          const error = getClaudeResultError(event)
          if (error) throw new Error(error)
          if (event.subtype === 'success') result = event.result.trim()
          break
        }
      }
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      if (result === null) throw new Error('Claude disconnected before completing the generation.')
      return result
    } catch (error) {
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      throw error
    } finally {
      generation.input?.close()
      generation.query?.close()
      if (this.oneShotGenerations.get(generationId) === generation) {
        this.oneShotGenerations.delete(generationId)
      }
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
    generation.input?.close()
    generation.query?.close()
  }

  importHistory: NonNullable<ProviderAdapter['importHistory']> = async (
    chatId,
    messages,
    options,
    onChatCreated
  ) => {
    const id = chatId ?? randomUUID()
    await onChatCreated?.(id)
    const previous = this.states.get(id)
    if (previous) {
      if (
        previous.active ||
        previous.waitingForSessionIdle ||
        previous.queueDrainInProgress ||
        previous.queuedMessages.length ||
        previous.pendingApprovals.length ||
        previous.pendingUserInputs.length ||
        previous.backgroundTaskIds.size
      )
        throw new Error('Claude is still working in this conversation.')
      const control = previous.query
      await this.closeStateQuery(previous)
      if (control) await control.return(undefined)
    }
    const cwd = options.cwd ?? previous?.cwd ?? process.cwd()
    const file = await nativeHistoryFile('claude', id, cwd, options.container)
    const entries = await file.read()
    // Internal attachments also extend the resume chain.
    const parent = entries.findLast(
      (entry) => typeof entry.uuid === 'string' && !entry.isSidechain && !entry.teamName
    )?.uuid
    await file.append(
      encodeClaudeHistory(
        id,
        cwd,
        messages,
        typeof parent === 'string' ? parent : null,
        new Set(entries.map((entry) => String(entry.uuid)))
      )
    )
    const imported = await file.read()
    const importedIds = new Set(imported.map((entry) => entry.uuid))
    if (messages.some((message, index) => !importedIds.has(historyMessageId(id, message, index))))
      throw new Error('Claude did not persist the complete imported conversation.')
    this.states.delete(id)
    this.sessionOptions.set(id, options)
    const normalized = normalizeContainerTarget(options.container)
    this.sessionContainers.set(id, normalized.kind === 'container' ? normalized : null)
    return id
  }

  startChat = async (
    message: string,
    options?: ProviderStartChatOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    if (options?.initialGoal) getClaudeGoalCommand(options.initialGoal)
    const id = randomUUID()
    const state = this.createState(id, options)
    this.requireAuthentication(state)
    this.states.set(id, state)
    this.pendingMessageStore.track(id)
    this.sessionContainers.set(id, state.container)
    await this.startStateQuery(state, options)
    await onChatCreated?.(id)
    if (options?.initialGoal) {
      await this.setChatGoal(id, options.initialGoal, { container: options.container })
    } else {
      this.sendMessageNow(state, message, options)
    }
    this.scheduleSessionMetadataRefresh(state)
    return this.createChatDetail(state)
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    await this.sendMessageRespectingQueue(state, message, options)
    return this.createChatDetail(state)
  }

  setChatGoal = async (
    chatId: string,
    objective: string | null,
    sourceOptions: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatGoal | null> => {
    const command = getClaudeGoalCommand(objective)
    const state = await this.ensureState(chatId, undefined, sourceOptions.container)
    this.requireAuthentication(state)
    if (state.goalMutation) throw new Error('A Claude goal update is already in progress.')
    state.goalMutation = true
    this.pinState(state)
    const hadQuery = state.query !== null
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await this.ensureStateQuery(state, state.options)
      const commands = await state.query!.supportedCommands()
      if (!commands.some((item) => item.name === 'goal'))
        throw new Error(
          'This Claude CLI does not expose /goal. Update Claude Code or check its hook policy.'
        )
      // A slash command must stay at the start of the prompt. Do not reuse the last send's
      // skill invocation or attachments as part of the condition (or the clear command).
      const options = state.options
        ? { ...state.options, skills: undefined, files: undefined, images: undefined }
        : undefined
      const message = this.createQueuedMessage(command, options)
      const acknowledged = new Promise<void>((resolve, reject) => {
        state.goalRequest = {
          id: message.id,
          objective: objective?.trim() || null,
          queueWasPaused: state.queuedMessagesPaused,
          resolve,
          reject
        }
        timeout = setTimeout(
          () => reject(new Error('Claude did not acknowledge the goal update.')),
          15000
        )
      })
      // Attach the rejection handler before dispatch, which may itself wait on an interrupt.
      state.queuedMessagesPaused = false
      const dispatch = state.active
        ? this.interruptWithMessage(state, message)
        : (async () => {
            state.queuedMessages.unshift(message)
            state.queuedMessagesPaused = false
            await this.drainNextQueuedMessage(state)
          })()
      await Promise.all([dispatch, acknowledged])
      return state.goal
    } finally {
      if (timeout) clearTimeout(timeout)
      const pending = state.goalRequest
      if (pending && !pending.control) {
        const previousLength = state.queuedMessages.length
        state.queuedMessages = state.queuedMessages.filter((message) => message.id !== pending.id)
        state.queuedMessagesPaused = pending.queueWasPaused
        if (state.queuedMessages.length !== previousLength) this.emitUpdate(state)
      }
      if (!hadQuery && !state.active && state.query && !pending?.control)
        await this.closeStateQuery(state)
      state.goalRequest = undefined
      state.goalMutation = false
      this.unpinState(state)
      this.trimIdleStates(state)
    }
  }

  continueChatInFork = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const source = await this.ensureCompleteState(chatId, options)
    this.requireAuthentication(source)
    const id = randomUUID()
    const state = this.createState(id, options, source.container)
    state.cwd = source.cwd
    state.messages = source.messages.map((entry) => ({ ...entry, session_id: id }))
    state.messageIds = new Set(state.messages.map((entry) => entry.uuid))
    this.states.set(id, state)
    this.pendingMessageStore.track(id)
    this.sessionContainers.set(id, state.container)
    await this.startStateQuery(state, options, { forkFrom: chatId })
    await onForkCreated?.(id)
    this.sendMessageNow(state, message, options)
    return this.createChatDetail(state)
  }

  forkChat = async (
    chatId: string,
    messageId: string,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const source = await this.ensureCompleteState(chatId)
    if (source.active) throw new Error('Cannot fork a chat with an active response.')

    // Rendered assistant ids derive from the API message id, not the transcript uuid.
    const targetUuid = resolveClaudeAssistantMessageUuid(source.messages, messageId) ?? messageId
    const targetIndex = source.messages.findIndex(
      (entry) => entry.type === 'assistant' && entry.uuid === targetUuid
    )
    if (targetIndex < 0) throw new Error('Message cannot be forked.')

    const id = randomUUID()
    const state = this.createState(id, source.options, source.container)
    state.cwd = source.cwd
    state.messages = source.messages
      .slice(0, targetIndex + 1)
      .map((entry) => ({ ...entry, session_id: id }))
    state.messageIds = new Set(state.messages.map((entry) => entry.uuid))
    this.states.set(id, state)
    this.pendingMessageStore.track(id)
    this.sessionContainers.set(id, state.container)
    await this.startStateQuery(state, source.options, { forkFrom: chatId, resumeAt: targetUuid })
    await onForkCreated?.(id)
    return this.createChatDetail(state)
  }

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    this.requireAuthentication(state)

    if (this.pendingMessageEdits.has(chatId)) {
      state.queuedMessages.push({
        ...this.createQueuedMessage(message, options),
        kind: mode === 'steer' ? 'steering' : 'queued'
      })
      this.emitUpdate(state)
    } else if (!state.active) {
      await this.sendMessageRespectingQueue(state, message, options)
    } else if (mode === 'queue') {
      const queued = this.createQueuedMessage(message, options)
      state.queuedMessages.push(queued)
      state.queuedMessagesPaused = false
      this.emitUpdate(state)
    } else if (mode === 'interrupt') {
      await this.interruptWithMessage(state, this.createQueuedMessage(message, options))
    } else {
      this.steerWithMessage(state, this.createQueuedMessage(message, options))
      this.emitUpdate(state)
    }
    return this.createChatDetail(state)
  }

  beginPendingMessageEdit = async (
    chatId: string,
    messageId: string,
    editId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    if (!state.queuedMessages.some((message) => message.id === messageId))
      throw new Error('The Claude message is no longer queued.')
    this.pendingMessageEdits.begin(chatId, messageId, editId, state.queuedMessages)
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  cancelPendingMessageEdit = async (
    chatId: string,
    messageId: string,
    editId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    if (this.pendingMessageEdits.release(chatId, messageId, editId)) {
      await this.resumePendingMessages(state)
      this.emitUpdate(state)
    }
    return this.createChatDetail(state)
  }

  private resumePendingMessages = async (state: ClaudeSessionState): Promise<void> => {
    if (
      this.pendingMessageEdits.blocks(state.id, state.queuedMessages[0]?.id) ||
      state.queuedMessagesPaused ||
      state.stopped
    )
      return
    const pending = state.queuedMessages[0]
    if (pending?.kind === 'steering' && state.active && state.input) {
      state.queuedMessages.shift()
      this.steerWithMessage(state, pending)
    } else {
      await this.drainNextQueuedMessage(state)
    }
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const index = state.queuedMessages.findIndex((message) => message.id === messageId)
    if (index < 0) throw new Error('The Claude message is no longer queued.')
    state.queuedMessages.splice(index, 1)
    if (state.queuedMessages.length === 0) state.queuedMessagesPaused = false
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions,
    editId?: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    this.pendingMessageEdits.assert(chatId, messageId, editId)
    const index = state.queuedMessages.findIndex((item) => item.id === messageId)
    if (index < 0) throw new Error('The Claude message is no longer queued.')
    const original = state.queuedMessages[index]!
    const replacement = {
      ...this.createQueuedMessage(message, options, messageId),
      kind: original.kind
    }
    state.queuedMessages[index] = replacement
    if (editId) {
      this.pendingMessageEdits.release(chatId, messageId, editId)
      const wasPaused = state.queuedMessagesPaused
      try {
        await this.resumePendingMessages(state)
      } catch (error) {
        if (!state.active && state.queuedMessages.includes(replacement)) {
          state.queuedMessages = state.queuedMessages.map((item) =>
            item === replacement ? original : item
          )
          state.queuedMessagesPaused = wasPaused
          this.pendingMessageEdits.begin(chatId, messageId, editId, state.queuedMessages)
          this.emitUpdate(state)
        }
        throw error
      }
    }
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  steerPendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.requireAuthentication(state)
    this.pendingMessageEdits.assert(chatId, messageId)
    const index = state.queuedMessages.findIndex((item) => item.id === messageId)
    const pending = state.queuedMessages[index]
    if (!pending) throw new Error('The Claude message is no longer queued.')
    if (state.active && !state.input) throw new Error('Claude session is not connected')
    state.queuedMessages.splice(index, 1)
    state.queuedMessagesPaused = false

    if (!state.active) {
      state.queuedMessages.unshift(pending)
      await this.drainNextQueuedMessage(state)
      return this.createChatDetail(state)
    }

    this.steerWithMessage(state, pending)
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.requireAuthentication(state)
    this.pendingMessageEdits.assert(chatId, messageId)
    const index = state.queuedMessages.findIndex((item) => item.id === messageId)
    const pending = state.queuedMessages[index]
    if (!pending) throw new Error('The Claude message is no longer queued.')
    state.queuedMessages.splice(index, 1)
    state.queuedMessagesPaused = false
    if (!state.active) {
      state.queuedMessages.unshift(pending)
      await this.drainNextQueuedMessage(state)
      return this.createChatDetail(state)
    }

    await this.interruptWithMessage(state, pending)
    return this.createChatDetail(state)
  }

  editMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureCompleteState(chatId, options)
    this.requireAuthentication(state)
    this.pinState(state)
    try {
      const targetIndex = state.messages.findIndex(
        (entry) => entry.type === 'user' && entry.uuid === messageId
      )
      if (targetIndex < 0) throw new Error('Message cannot be edited')
      // Display history also contains local timing/error/background records and
      // streamed subagent output. Their UUIDs are not resume points in this session.
      // Keep user records eligible: a completed tool result may end the kept turn.
      const previous = state.messages
        .slice(0, targetIndex)
        .findLast(
          (entry) =>
            (entry.type === 'user' || entry.type === 'assistant') && !entry.parent_tool_use_id
        )
      if (!previous) throw new Error('Claude cannot edit the first message in a session.')

      const resumeDropsTurn = (await this.supportsResumeDropsTurn(state)) ? messageId : undefined

      await this.closeStateQuery(state)
      state.messages = state.messages.slice(0, targetIndex)
      state.messageIds = new Set(state.messages.map((entry) => entry.uuid))
      state.queuedMessagesPaused = false
      await this.startStateQuery(state, options, {
        resumeAt: previous.uuid,
        resumeDropsTurn
      })
      this.sendMessageNow(state, message, options)
      return this.createChatDetail(state)
    } finally {
      this.unpinState(state)
      this.trimIdleStates(state)
    }
  }

  resolveApproval = async (
    chatId: string,
    decision: ProviderApprovalDecision
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const pending = state.pendingApprovals.shift()
    if (!pending) throw new Error('There is no pending Claude approval.')
    pending.resolve(
      decision === 'allow'
        ? { behavior: 'allow', updatedInput: pending.input, toolUseID: pending.id }
        : {
            behavior: 'deny',
            message: 'The user denied this tool request.',
            toolUseID: pending.id
          }
    )
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  resolveUserInput = async (
    chatId: string,
    requestId: string,
    response: ProviderUserInputResponse
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const pending = state.pendingUserInputs[0]
    if (!pending || pending.id !== requestId) {
      throw new Error('There is no matching pending Claude question.')
    }
    if (pending.elicitation) getProviderElicitationResult(pending, response)
    else if (response.kind === 'elicitation')
      throw new Error('This request is not an MCP interaction.')
    if (response.kind === 'answer') {
      const answer = response.wasFreeform ? response.answer.trim() : response.answer
      if (!answer.trim()) throw new Error('An answer is required.')
      if (!response.wasFreeform && !pending.choices.some((choice) => choice.label === answer)) {
        throw new Error('The selected Claude answer is no longer available.')
      }
    }
    state.pendingUserInputs.shift()
    pending.resolve(response)
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  compactChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    if (state.active || state.queueDrainInProgress || state.queuedMessages.length > 0) {
      throw new Error('Wait for the current response before compacting context.')
    }
    await this.sendMessageRespectingQueue(state, '/compact')
    return this.createChatDetail(state)
  }

  summarizeChatInFork = async (
    chatId: string,
    { signal }: { summaryPrompt: string; signal: AbortSignal },
    onForkCreated: (chatId: string) => Promise<void>
  ): Promise<string> => {
    throwIfLinkedChatCancelled(signal)
    const source = await this.ensureState(chatId)
    const watcher = watchLinkedChatForkTurn(this.onChatUpdated, signal)
    let forkId: string | null = null
    try {
      // Native compaction runs in the fork; the source transcript is untouched.
      const initial = await raceLinkedChatCancellation(
        signal,
        this.continueChatInFork(chatId, '/compact', source.options, async (id) => {
          forkId = id
          watcher.track(id)
          await onForkCreated(id)
          throwIfLinkedChatCancelled(signal)
        })
      )
      await watcher.finished(initial)
      const fork = this.states.get(initial.id)
      const messages = await raceLinkedChatCancellation(
        signal,
        loadClaudeHistory(
          initial.id,
          await getClaudeSessionStore(fork?.container ?? source.container)
        )
      )
      return requireLinkedChatSummary(getClaudeLinkedChatSummary(messages))
    } catch (error) {
      const startedForkId = forkId
      if (signal.aborted && startedForkId) {
        void this.stopChat(startedForkId).catch((stopError: unknown) => {
          console.error('[caught:ClaudeProviderAdapter:summarizeChatInFork:stop]', stopError)
        })
      }
      throw error
    } finally {
      watcher.dispose()
    }
  }

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.pinState(state)
    try {
      state.stopped = true
      state.active = false
      state.failed = false
      state.waitingForSessionIdle = false
      state.queuedMessagesPaused = state.queuedMessages.length > 0
      this.rejectPendingRequests(state)
      const interrupt = state.query?.interrupt().catch((error: unknown) => {
        if (isExpectedClaudeQueryShutdownError(error)) return
        console.error(`Unable to interrupt Claude session ${state.id} while stopping it.`, error)
      })
      if (interrupt) await settleWithin(interrupt, interruptCloseGraceMs)
      await this.closeStateQuery(state)
      this.emitUpdate(state, true)
      return this.createChatDetail(state)
    } finally {
      this.unpinState(state)
      this.trimIdleStates(state)
    }
  }

  onChatUpdated = (
    listener: (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  ): (() => void) => {
    this.chatUpdatedListeners.add(listener)
    return () => this.chatUpdatedListeners.delete(listener)
  }

  dispose = (): void => {
    // Record the final live lists, then keep them: closing queries below would discard them.
    this.states.forEach((state) => this.persistPendingMessages(state))
    void this.pendingMessageStore.close()
    this.disposed = true
    this.stateGeneration += 1
    this.sessionDiscovery.dispose()
    this.historyPages.clear()
    claudeAccounts.dispose()
    this.updateTimers.forEach((timer) => clearTimeout(timer))
    this.updateTimers.clear()
    this.metadataRefreshTimers.forEach((timer) => clearTimeout(timer))
    this.metadataRefreshTimers.clear()
    this.completionCoordinator.clear()
    this.states.forEach((state) => {
      void this.closeStateQuery(state)
    })
    this.states.clear()
    this.stateLoads.clear()
    this.admissionLeases.forEach((timer) => clearTimeout(timer))
    this.admissionLeases.clear()
    this.pinnedStates.clear()
    this.completingStates.clear()
    this.transcriptProjections.clear()
    this.oneShotGenerations.forEach((generation) => {
      generation.input?.close()
      generation.query?.close()
    })
    this.oneShotGenerations.clear()
    this.canceledOneShotGenerationTimers.forEach((timer) => clearTimeout(timer))
    this.canceledOneShotGenerationTimers.clear()
    this.canceledOneShotGenerationIds.clear()
    this.resumeDropsTurnSupport.clear()
    this.modelDiscoveryRequests.clear()
    this.controlQueries.dispose()
    this.hiddenSessionIds.clear()
    this.sessionContainers.clear()
    this.sessionMetadata.clear()
    this.sessionOptions.clear()
  }

  private closeControlQueryEntry = (entry: ClaudeControlQueryEntry): void => {
    entry.input.close()
    try {
      entry.query.close()
    } catch (error) {
      if (isExpectedClaudeQueryShutdownError(error)) return
      console.error('Unable to close a Claude control query.', error)
      // The process is already unusable; dropping the entry is sufficient.
    }
  }

  private createControlQueryEntry = async (
    options: ProviderSourceOptions,
    profile: ClaudeControlQueryProfile
  ): Promise<ClaudeControlQueryEntry> => {
    const input = new AsyncMessageQueue<SDKUserMessage>()
    const runtime = await this.getQueryRuntime(options.container, undefined, profile === 'usage')
    const control = query({
      prompt: input,
      options: {
        ...this.getBaseQueryOptions(undefined, runtime),
        persistSession: false,
        settingSources: ['user'],
        tools: [],
        settings: backgroundFeatureRestrictions,
        includePartialMessages: false,
        forwardSubagentText: false,
        strictMcpConfig: profile !== 'apps'
      }
    })
    const entry = { query: control, input }
    try {
      await control.initializationResult()
      return entry
    } catch (error) {
      this.closeControlQueryEntry(entry)
      throw error
    }
  }

  private getControlQueryEntry = (
    options: ProviderSourceOptions,
    profile: ClaudeControlQueryProfile
  ): Promise<ClaudeControlQueryEntry> =>
    this.controlQueries.get(`${profile}:${getContainerTargetKey(options.container)}`, () =>
      this.createControlQueryEntry(options, profile)
    )

  private withControlQuery = async <T>(
    options: ProviderSourceOptions,
    profile: ClaudeControlQueryProfile,
    run: (control: Query) => Promise<T>
  ): Promise<T> => {
    const key = `${profile}:${getContainerTargetKey(options.container)}`
    const entry = await this.getControlQueryEntry(options, profile)
    try {
      return await run(entry.query)
    } catch (error) {
      const healthy = await entry.query.reinitialize().then(
        () => true,
        (reinitializeError: unknown) => {
          console.error(
            `Unable to reinitialize Claude ${profile} control query.`,
            reinitializeError
          )
          return false
        }
      )
      if (!healthy) this.controlQueries.invalidate(key, entry)
      throw error
    }
  }

  private getQueryRuntime = async (
    container: AppContainerTarget | null | undefined,
    cwd?: string | null,
    usageOnly = false
  ): Promise<ClaudeQueryRuntime> => {
    const normalized = normalizeContainerTarget(container)
    const storedContainer = normalized.kind === 'container' ? normalized : null
    const key = getContainerTargetKey(storedContainer)
    await this.accountChanges.get(key)
    const accountRevision = this.accountRevisions.get(key) ?? 0
    const executable = storedContainer ? 'claude' : getClaudeExecutable()
    const command = await getHostExecutableCommand(executable, [], {
      container: storedContainer,
      cwd: cwd ?? undefined,
      env: usageOnly
        ? await claudeAccounts.getUsageEnvironment(storedContainer, this.accountId)
        : await claudeAccounts.getEnvironment(storedContainer, this.accountId)
    })
    if (accountRevision !== (this.accountRevisions.get(key) ?? 0) || this.accountChanges.has(key)) {
      throw new Error('Claude account changed while starting the session. Please try again.')
    }
    return { command, container: storedContainer, accountRevision }
  }

  private getBaseQueryOptions = (
    options: ProviderTurnOptions | ProviderOneShotOptions | undefined,
    runtime: Awaited<ReturnType<ClaudeProviderAdapter['getQueryRuntime']>>
  ): ClaudeQueryOptions => {
    const permissionMode = getClaudePermissionMode(options)
    return {
      cwd: runtime.container ? undefined : options?.cwd,
      pathToClaudeCodeExecutable: runtime.command.file,
      env: {
        ...getRuntimeEnvironment(runtime.command.env),
        CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1'
      },
      spawnClaudeCodeProcess: ({ args, env, signal }) => {
        const key = getContainerTargetKey(runtime.container)
        if (
          runtime.accountRevision !== (this.accountRevisions.get(key) ?? 0) ||
          this.accountChanges.has(key)
        ) {
          throw new Error('Claude account changed before the session started. Please try again.')
        }
        return spawn(runtime.command.file, [...runtime.command.args, ...args], {
          cwd: runtime.command.cwd,
          env: { ...runtime.command.env, ...env },
          signal,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
      },
      additionalDirectories: options?.additionalDirectories,
      model: getClaudeModel(options),
      effort: toEffortLevel(options?.reasoningEffort),
      permissionMode,
      sandbox: getSandbox(options),
      settings: {
        fastMode: options?.serviceTier === 'fast',
        ...(options?.sandboxMode === 'read-only' ? backgroundFeatureRestrictions : {})
      },
      tools: options?.sandboxMode === 'read-only' ? [...claudeReadOnlyAllowedTools] : undefined,
      strictMcpConfig: options?.sandboxMode === 'read-only' ? true : undefined,
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      forwardSubagentText: true,
      persistSession: true
    }
  }

  private createState = (
    id: string,
    options?: ProviderTurnOptions,
    inheritedContainer?: AppContainerTarget | null
  ): ClaudeSessionState => {
    const normalized = normalizeContainerTarget(options?.container ?? inheritedContainer)
    const createdAt = Date.now()
    return {
      id,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      container: normalized.kind === 'container' ? normalized : null,
      cwd: options?.cwd ?? null,
      metadata: null,
      goal: null,
      messages: [],
      messageIds: new Set(),
      partialMessages: new Map(),
      query: null,
      browser: null,
      input: null,
      options,
      active: false,
      stopped: false,
      failed: false,
      pendingApprovals: [],
      pendingUserInputs: [],
      queuedMessages: [],
      submittedSteering: [],
      queuedMessagesPaused: false,
      queueDrainInProgress: false,
      resultSettling: false,
      contextUsage: null,
      queryReadOnly: null,
      queryModel: null,
      queryStartupRevision: 0,
      backgroundTaskIds: new Set(),
      terminalTaskIds: new Set(),
      subagentTaskStatuses: new Map(),
      waitingForSessionIdle: false,
      turnAwaitingStart: false,
      deferredSteering: [],
      sessionBusy: false,
      taskNotificationPending: false,
      interruptRequested: false
    }
  }

  private rememberStateTranscriptSize = (state: ClaudeSessionState): void => {
    // Walk references once at admission/completion. String length is O(1), including for
    // large tool results, and no second serialized copy of the transcript is allocated.
    const visited = new WeakSet<object>()
    const pending: unknown[] = [state.messages]
    let bytes = 0
    while (pending.length > 0) {
      const value = pending.pop()
      if (typeof value === 'string') {
        bytes += value.length * 2
      } else if (typeof value === 'number' || typeof value === 'bigint') {
        bytes += 8
      } else if (typeof value === 'boolean') {
        bytes += 4
      } else if (value && typeof value === 'object' && !visited.has(value)) {
        visited.add(value)
        bytes += 48
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index += 1) pending.push(value[index])
        } else {
          for (const [key, child] of Object.entries(value)) {
            bytes += key.length * 2 + 16
            pending.push(child)
          }
        }
      }
    }
    this.stateTranscriptBytes.set(state, bytes)
  }

  private pinState = (state: ClaudeSessionState): void => {
    this.pinnedStates.set(state, (this.pinnedStates.get(state) ?? 0) + 1)
  }

  private unpinState = (state: ClaudeSessionState): void => {
    const count = this.pinnedStates.get(state)
    if (!count) return
    if (count === 1) this.pinnedStates.delete(state)
    else this.pinnedStates.set(state, count - 1)
  }

  private leaseStateForAdmission = (state: ClaudeSessionState): void => {
    const previous = this.admissionLeases.get(state)
    if (previous) clearTimeout(previous)
    // Promise callers resume in microtasks. Release on the next task, after they can pin a
    // query or queue a message, and trim any temporary burst of idle admissions then.
    const timer = setTimeout(() => {
      if (this.admissionLeases.get(state) !== timer) return
      this.admissionLeases.delete(state)
      this.trimIdleStates()
    }, 0)
    this.admissionLeases.set(state, timer)
  }

  private isStateBusy = (state: ClaudeSessionState): boolean =>
    this.pinnedStates.has(state) ||
    this.admissionLeases.has(state) ||
    this.completingStates.has(state) ||
    state.query !== null ||
    state.active ||
    state.waitingForSessionIdle ||
    state.queueDrainInProgress ||
    state.queuedMessages.length > 0 ||
    state.pendingApprovals.length > 0 ||
    state.pendingUserInputs.length > 0 ||
    state.backgroundTaskIds.size > 0 ||
    this.updateTimers.has(state.id)

  private touchState = (state: ClaudeSessionState): void => {
    if (this.states.get(state.id) !== state) return
    this.states.delete(state.id)
    this.states.set(state.id, state)
  }

  private trimIdleStates = (retain?: ClaudeSessionState): void => {
    if (this.disposed) return
    // Live work is outside the budget. Keep one oversized idle transcript so the currently
    // viewed chat remains available; the next admission can replace it.
    const idle = [...this.states.values()].filter((state) => !this.isStateBusy(state))
    let bytes = idle.reduce(
      (total, state) => total + (this.stateTranscriptBytes.get(state) ?? 0),
      0
    )
    while (
      idle.length > maxIdleSessionStates ||
      (idle.length > 1 && bytes > maxIdleTranscriptBytes)
    ) {
      const index = idle.findIndex((state) => state !== retain)
      if (index < 0) break
      const [state] = idle.splice(index, 1)
      if (!state) break
      bytes -= this.stateTranscriptBytes.get(state) ?? 0
      if (state.options) {
        // Keep only the small query configuration needed by a later fork or resume.
        this.sessionOptions.set(state.id, {
          ...state.options,
          files: undefined,
          images: undefined,
          skills: undefined,
          review: undefined
        })
      }
      this.states.delete(state.id)
      this.transcriptProjections.delete(state)
      this.completionCoordinator.cancel(state.id)
      const timer = this.updateTimers.get(state.id)
      if (timer) clearTimeout(timer)
      this.updateTimers.delete(state.id)
      const metadataTimer = this.metadataRefreshTimers.get(state.id)
      if (metadataTimer) clearTimeout(metadataTimer)
      this.metadataRefreshTimers.delete(state.id)
    }
  }

  private supportsResumeDropsTurn = async (state: ClaudeSessionState): Promise<boolean> => {
    const executable = state.container ? 'claude' : getClaudeExecutable()
    const command = await getHostExecutableCommand(executable, ['--version'], {
      container: state.container,
      cwd: state.cwd ?? state.options?.cwd,
      env: process.env
    })
    const key = JSON.stringify([
      getContainerTargetKey(state.container),
      command.file,
      command.args,
      command.cwd
    ])
    const existing = this.resumeDropsTurnSupport.get(key)
    if (existing) return existing

    const support = runHostCommand(command).then(
      (output) => {
        const version = parseClaudeVersion(output)
        return version ? supportsClaudeResumeDropsTurn(version) : false
      },
      (error: unknown) => {
        this.resumeDropsTurnSupport.delete(key)
        if (!isExpectedCommandAbsenceError(error)) {
          console.error(`Unable to inspect Claude resume support for session ${state.id}.`, error)
        }
        return false
      }
    )
    this.resumeDropsTurnSupport.set(key, support)
    return support
  }

  private ensureState = async (
    chatId: string,
    options?: ProviderTurnOptions,
    container?: AppContainerTarget | null
  ): Promise<ClaudeSessionState> => {
    if (this.disposed) throw new Error('Claude provider was disposed.')
    const existing = this.states.get(chatId)
    if (existing) {
      // Incoming settings belong to that send, which may be queued. Permission callbacks
      // must retain the running turn's settings until the next turn is actually prepared.
      this.touchState(existing)
      this.leaseStateForAdmission(existing)
      return existing
    }

    const loading = this.stateLoads.get(chatId)
    if (loading) {
      const state = await loading
      this.touchState(state)
      this.leaseStateForAdmission(state)
      return state
    }

    const rememberedContainer =
      container ?? options?.container ?? this.sessionContainers.get(chatId) ?? null
    const rememberedOptions = options ?? this.sessionOptions.get(chatId)
    const state = this.createState(chatId, rememberedOptions, rememberedContainer)
    const generation = this.stateGeneration
    const pending = (async (): Promise<ClaudeSessionState> => {
      const [page, stored] = await Promise.all([
        this.readHistoryPage(chatId, state.container, {
          cursor: null,
          direction: 'older',
          limit: 10
        }),
        this.pendingMessageStore.restore(chatId)
      ])
      // The page already contains display metadata. Keep catalog fields that the bounded
      // read could not find, and refresh local SDK metadata after messages are available.
      // A remote SessionStore's metadata API loads the whole file, so avoid it on open.
      const metadata = {
        ...this.sessionMetadata.get(chatId),
        ...Object.fromEntries(
          Object.entries(page.metadata).filter(([, value]) => value !== undefined)
        )
      } as SDKSessionInfo
      const messages = page.messages
      if (this.disposed || generation !== this.stateGeneration)
        throw new Error('Claude provider was disposed.')
      const current = this.states.get(chatId)
      if (current) return current
      if (!metadata && messages.length === 0) throw new Error('Claude session was not found.')
      state.metadata = metadata ?? null
      state.createdAt = metadata?.createdAt ?? state.createdAt
      state.updatedAt = metadata?.lastModified ?? state.updatedAt
      state.cwd = metadata?.cwd ?? rememberedOptions?.cwd ?? null
      state.messages = messages
      state.historyPagination = page.pagination
      state.goal = page.goal ?? null
      state.failed = isClaudeAuthenticationFailure(
        messages.findLast(
          (message) =>
            !message.parent_tool_use_id &&
            (message.type === 'assistant' ||
              (message.type === 'user' && !isClaudeInternalUserMessage(message)))
        ) ?? { type: 'system' }
      )
      const sourceKey = getContainerTargetKey(state.container)
      if (state.failed && !this.authenticatedSources.has(sourceKey)) {
        this.authenticationFailures.add(sourceKey)
        for (const other of this.states.values()) {
          if (getContainerTargetKey(other.container) === sourceKey) {
            other.queuedMessagesPaused = true
            this.queueUpdate(other, false)
          }
        }
      }
      state.messageIds = new Set(messages.map((message) => message.uuid))
      this.restorePendingMessages(state, stored, page.inputIds)
      this.rememberStateTranscriptSize(state)
      this.states.set(chatId, state)
      this.persistPendingMessages(state)
      this.sessionContainers.set(chatId, state.container)
      if (!state.container) this.scheduleSessionMetadataRefresh(state)
      this.leaseStateForAdmission(state)
      this.trimIdleStates(state)
      return state
    })()
    this.stateLoads.set(chatId, pending)
    try {
      return await pending
    } finally {
      if (this.stateLoads.get(chatId) === pending) this.stateLoads.delete(chatId)
    }
  }

  private readHistoryPage = (
    chatId: string,
    container: StoredClaudeContainer | null,
    window: ProviderChatTurnCursorWindow
  ): Promise<ClaudeHistoryPage> =>
    this.historyPages.read(chatId, getContainerTargetKey(container), window, () =>
      getRemoteClaudeContainer(container).then((remote) =>
        openClaudeHistorySource(
          chatId,
          remote
            ? async (script, args = []) =>
                runHostCommand(
                  await getHostCommand('sh', ['-lc', script, 'sele-claude-history-page', ...args], {
                    container: remote,
                    env: process.env
                  })
                )
            : undefined
        )
      )
    )

  private refreshIdleHistory = async (state: ClaudeSessionState): Promise<void> => {
    const busy = (): boolean =>
      state.query !== null ||
      state.active ||
      state.queueDrainInProgress ||
      state.queuedMessages.length > 0 ||
      state.pendingApprovals.length > 0 ||
      state.pendingUserInputs.length > 0
    if (busy()) return
    const previous = state.messages
    const page = await this.readHistoryPage(state.id, state.container, {
      cursor: null,
      direction: 'older',
      limit: 10
    })
    if (
      this.disposed ||
      this.states.get(state.id) !== state ||
      state.messages !== previous ||
      busy()
    )
      return
    if (state.historyDirty) {
      const latest = previous.findLast(
        (message) =>
          !message.parent_tool_use_id &&
          (message.type === 'assistant' ||
            (message.type === 'user' && !isClaudeInternalUserMessage(message)))
      )
      const identity = (message: ClaudeTranscriptMessage): string => {
        const record = message.message as { id?: unknown } | null
        return record && typeof record.id === 'string' ? record.id : message.uuid
      }
      // Persisted assistant blocks have different UUIDs from the live aggregate, but the
      // API message ID is stable. Do not replace a completed response with a lagging file.
      if (latest && !page.messages.some((message) => identity(message) === identity(latest))) return
      if (state.failed && previous.at(-1)?.failed) return
    }
    state.messages = page.messages
    state.historyDirty = false
    state.messageIds = new Set(page.messages.map((message) => message.uuid))
    state.historyPagination = page.pagination
    if (page.goal !== undefined && page.metadata.lastModified >= (state.goalUpdatedAt ?? 0))
      state.goal = page.goal
    state.failed = isClaudeAuthenticationFailure(
      page.messages.findLast(
        (message) =>
          !message.parent_tool_use_id &&
          (message.type === 'assistant' ||
            (message.type === 'user' && !isClaudeInternalUserMessage(message)))
      ) ?? { type: 'system' }
    )
    state.metadata = {
      ...state.metadata,
      ...Object.fromEntries(
        Object.entries(page.metadata).filter(([, value]) => value !== undefined)
      )
    } as SDKSessionInfo
    state.cwd = page.metadata.cwd ?? state.cwd
    state.updatedAt = page.metadata.lastModified
    this.transcriptProjections.delete(state)
    this.rememberStateTranscriptSize(state)
  }

  private readCompleteHistory = async (
    state: ClaudeSessionState
  ): Promise<ClaudeTranscriptMessage[]> => {
    const messages = await loadClaudeHistory(state.id, await getClaudeSessionStore(state.container))
    if (this.disposed || this.states.get(state.id) !== state)
      throw new Error('Claude session changed.')
    if (state.historyDirty) {
      const persisted = new Set(messages.map((message) => message.uuid))
      const start = state.messages.findIndex(
        (message) => classifyClaudeTurnRecord(message) === 'start' && persisted.has(message.uuid)
      )
      if (start >= 0) {
        // Replace whole overlapping turns. A live aggregate and its persisted split blocks
        // can have different UUIDs; merging them individually would duplicate the answer.
        const prefixEnd = messages.findIndex(
          (message) => message.uuid === state.messages[start].uuid
        )
        return [...messages.slice(0, prefixEnd), ...state.messages.slice(start)]
      }
    }
    const current = new Map(state.messages.map((message) => [message.uuid, message]))
    const ids = new Set(messages.map((message) => message.uuid))
    return [
      ...messages.map((message) => current.get(message.uuid) ?? message),
      ...state.messages.filter((message) => !ids.has(message.uuid))
    ]
  }

  private ensureCompleteState = async (
    chatId: string,
    options?: ProviderTurnOptions,
    container?: AppContainerTarget | null
  ): Promise<ClaudeSessionState> => {
    const state = await this.ensureState(chatId, options, container)
    if (!state.historyPagination) return state
    const previous = state.messages
    state.messages = state.historyPagination.olderCursor
      ? await this.readCompleteHistory(state)
      : state.messages
    state.messageIds = new Set(state.messages.map((message) => message.uuid))
    state.historyPagination = undefined
    markTranscriptRecordsChanged(previous, state.messages, 0)
    this.transcriptProjections.delete(state)
    this.rememberStateTranscriptSize(state)
    return state
  }

  private ensureStateQuery = async (
    state: ClaudeSessionState,
    options?: ProviderTurnOptions
  ): Promise<void> => {
    if (state.query) return
    await this.startStateQuery(state, options)
  }

  private startStateQuery = async (
    state: ClaudeSessionState,
    options?: ProviderTurnOptions,
    startOptions: StartQueryOptions = {}
  ): Promise<void> => {
    this.pinState(state)
    try {
      await this.closeStateQuery(state)
      state.queryStartupRevision += 1
      const startupRevision = state.queryStartupRevision
      const adapterGeneration = this.stateGeneration
      state.options = options ?? state.options
      const input = new AsyncMessageQueue<SDKUserMessage>()
      const runtime = await this.getQueryRuntime(state.container, state.cwd ?? state.options?.cwd)
      if (
        this.disposed ||
        adapterGeneration !== this.stateGeneration ||
        this.states.get(state.id) !== state ||
        state.queryStartupRevision !== startupRevision
      ) {
        input.close()
        throw new Error('Claude session startup was canceled.')
      }
      const queryReadOnly = state.options?.sandboxMode === 'read-only'
      const isNew =
        !state.historyPagination &&
        state.metadata === null &&
        state.messages.length === 0 &&
        !startOptions.forkFrom &&
        !startOptions.resumeAt
      const browserService = getBrowserAutomationService()
      // Do not connect remote/container or restricted queries to an unrelated host browser.
      const browser =
        browserService && !state.container && !queryReadOnly
          ? createClaudeBrowserIntegration(browserService, {
              providerId: 'claude',
              sessionId: state.id,
              cwd: state.cwd ?? state.options?.cwd ?? '',
              containerKey: getContainerTargetKey(state.container)
            })
          : null
      let control: Query
      try {
        control = query({
          prompt: input,
          options: {
            ...this.getBaseQueryOptions(state.options, runtime),
            ...(browser ? { mcpServers: { [claudeBrowserServerName]: browser.server } } : {}),
            canUseTool: this.createPermissionHandler(state),
            onElicitation: this.createElicitationHandler(state),
            ...(isNew ? { sessionId: state.id } : { resume: startOptions.forkFrom ?? state.id }),
            ...(startOptions.forkFrom ? { forkSession: true, sessionId: state.id } : {}),
            ...(startOptions.resumeAt ? { resumeSessionAt: startOptions.resumeAt } : {}),
            ...(startOptions.resumeDropsTurn
              ? { resumeDropsTurn: startOptions.resumeDropsTurn }
              : {})
          }
        })
      } catch (error) {
        input.close()
        browser?.close()
        throw error
      }
      state.browser = browser
      state.input = input
      state.query = control
      state.queryReadOnly = queryReadOnly
      state.queryModel = getClaudeModel(state.options)
      void this.consumeStateQuery(state, control)
    } finally {
      this.unpinState(state)
      this.trimIdleStates(state)
    }
  }

  private closeStateQuery = async (state: ClaudeSessionState): Promise<void> => {
    state.queryStartupRevision += 1
    state.resultSettling = false
    const control = state.query
    state.browser?.close()
    state.browser = null
    if (!control) return
    if (state.goalRequest?.control === control)
      state.goalRequest.reject(
        new Error('Claude disconnected before acknowledging the goal update.')
      )
    this.rejectPendingRequests(state)
    state.input?.close()
    state.query = null
    state.input = null
    state.active = false
    state.queryReadOnly = null
    state.queryModel = null
    state.backgroundTaskIds.clear()
    state.terminalTaskIds?.clear()
    state.waitingForSessionIdle = false
    state.turnAwaitingStart = false
    state.deferredSteering = []
    // Closing the query discards input Claude Code had not consumed, as Stop always has.
    state.submittedSteering = []
    state.sessionBusy = false
    state.taskNotificationPending = false
    state.interruptRequested = false
    state.partialMessages.clear()
    try {
      control.close()
    } catch (error) {
      if (isExpectedClaudeQueryShutdownError(error)) return
      console.error(`Unable to close Claude session query ${state.id}.`, error)
      // Closing is best-effort after all local references have been released.
    }
  }

  private applyTurnOptions = async (
    state: ClaudeSessionState,
    options?: ProviderTurnOptions
  ): Promise<void> => {
    if (!options || !state.query) return
    state.options = options
    const needsReadOnlyQuery = options.sandboxMode === 'read-only'
    if (state.queryReadOnly !== needsReadOnlyQuery) {
      const interrupt = state.active
        ? state.query.interrupt().catch((error: unknown) => {
            if (isExpectedClaudeQueryShutdownError(error)) return
            console.error(
              `Unable to interrupt Claude session ${state.id} while changing access mode.`,
              error
            )
          })
        : null
      if (interrupt) await settleWithin(interrupt, interruptCloseGraceMs)
      await this.startStateQuery(state, options)
      return
    }
    const control = state.query
    const model = getClaudeModel(options)
    const modelChanged = state.queryModel !== model
    try {
      await awaitClaudeTurnOptions(
        Promise.all([
          ...(modelChanged ? [control.setModel(model)] : []),
          control.setPermissionMode(getClaudePermissionMode(options)),
          control.applyFlagSettings({
            effortLevel: toEffortLevel(options.reasoningEffort) ?? null,
            fastMode: options.serviceTier === 'fast',
            sandbox: getSandbox(options)
          })
        ])
      )
    } catch (error) {
      // A partially applied or unresponsive query cannot safely accept the next prompt.
      if (state.query === control) await this.closeStateQuery(state)
      throw error
    }
    if (modelChanged && state.query === control) state.queryModel = model
  }

  private createElicitationHandler =
    (state: ClaudeSessionState): NonNullable<ClaudeQueryOptions['onElicitation']> =>
    (request, options) => {
      const existing = state.pendingUserInputs.find(
        (pending) => pending.id === `elicitation:${options.requestId}`
      )
      if (existing) return Promise.reject(new Error('This MCP interaction is already pending.'))
      const presentation = createProviderElicitation(`elicitation:${options.requestId}`, request)
      return new Promise((resolve) => {
        const pending: ClaudePendingUserInput = {
          ...presentation,
          resolve: (response) =>
            resolve(
              getProviderElicitationResult(presentation, response) as NonNullable<
                Awaited<ReturnType<NonNullable<ClaudeQueryOptions['onElicitation']>>>
              >
            )
        }
        state.pendingUserInputs.push(pending)
        this.cancelPendingOnAbort(state, state.pendingUserInputs, pending, options, () =>
          pending.resolve({ kind: 'cancel' })
        )
        this.emitUpdate(state)
      })
    }

  private createPermissionHandler =
    (state: ClaudeSessionState): CanUseTool =>
    async (toolName, input, permissionOptions): Promise<PermissionResult> => {
      const action = getClaudePermissionAction(state.options, toolName, input)
      if (action.kind === 'userQuestion') {
        const questions = getClaudeUserQuestions(input)
        const answers: Record<string, string> = {}
        for (const question of questions) {
          const response = await new Promise<ProviderUserInputResponse>((resolve) => {
            const pending: ClaudePendingUserInput = {
              id: `${permissionOptions.toolUseID}:${state.pendingUserInputs.length}`,
              question: question.question,
              choices: question.choices,
              allowFreeform: question.allowFreeform,
              startedAt: Date.now(),
              resolve
            }
            state.pendingUserInputs.push(pending)
            this.cancelPendingOnAbort(
              state,
              state.pendingUserInputs,
              pending,
              permissionOptions,
              () => resolve({ kind: 'cancel' })
            )
            this.emitUpdate(state)
          })
          if (response.kind !== 'answer') {
            return { behavior: 'deny', message: 'The user canceled the question.' }
          }
          answers[question.question] = response.answer
        }
        return { behavior: 'allow', updatedInput: { ...input, answers } }
      }
      if (action.kind === 'resolve') return action.result

      return new Promise<PermissionResult>((resolve) => {
        const pending: ClaudePendingApproval = {
          id: permissionOptions.toolUseID,
          toolName,
          input,
          title: permissionOptions.title ?? null,
          description: permissionOptions.description ?? null,
          reason: permissionOptions.decisionReason ?? null,
          startedAt: Date.now(),
          resolve
        }
        state.pendingApprovals.push(pending)
        this.cancelPendingOnAbort(state, state.pendingApprovals, pending, permissionOptions, () =>
          resolve({ behavior: 'deny', message: 'The tool request was interrupted.' })
        )
        this.emitUpdate(state)
      })
    }

  /**
   * Claude Code aborts an in-flight permission prompt when the turn is interrupted (for example
   * by "Stop & send" on a queued message). Without dropping it here, the stale question stays on
   * screen, blocks the queue drain, and any answer fails because the SDK no longer waits for it.
   */
  private cancelPendingOnAbort = <T>(
    state: ClaudeSessionState,
    list: T[],
    pending: T,
    permissionOptions: { signal: AbortSignal },
    resolveCanceled: () => void
  ): void => {
    const cancel = (): void => {
      const index = list.indexOf(pending)
      if (index < 0) return
      list.splice(index, 1)
      resolveCanceled()
      this.emitUpdate(state)
    }
    if (permissionOptions.signal.aborted) cancel()
    else permissionOptions.signal.addEventListener('abort', cancel, { once: true })
  }

  private consumeStateQuery = async (state: ClaudeSessionState, control: Query): Promise<void> => {
    try {
      for await (const event of control) {
        if (state.query !== control) break
        if (await this.handleQueryEvent(state, control, event)) break
      }
    } catch (error) {
      if (state.query !== control && isExpectedClaudeQueryShutdownError(error)) return
      console.error(`Claude session ${state.id} event stream failed.`, error)
      if (state.query !== control) return
      state.failed = true
      state.active = false
      const content = error instanceof Error ? error.message : String(error)
      this.addTranscriptMessage(state, {
        type: 'system',
        uuid: randomUUID(),
        session_id: state.id,
        message: { content },
        parent_tool_use_id: null,
        failed: true
      })
      this.emitUpdate(state, true)
    } finally {
      if (state.query === control) {
        if (state.active) {
          state.active = false
          state.failed = !state.stopped
          if (state.failed) {
            this.addTranscriptMessage(state, {
              type: 'system',
              uuid: randomUUID(),
              session_id: state.id,
              message: { content: 'Claude disconnected before completing the turn.' },
              parent_tool_use_id: null,
              failed: true
            })
            this.emitUpdate(state, true)
          }
        }
        await this.closeStateQuery(state)
      }
      if (this.states.get(state.id) === state) {
        this.rememberStateTranscriptSize(state)
        this.trimIdleStates()
      }
    }
  }

  private getUsageQueryId = (control: Query): string => {
    let id = this.tokenUsageQueryIds.get(control)
    if (!id) {
      id = randomUUID()
      this.tokenUsageQueryIds.set(control, id)
    }
    return id
  }

  private reportLiveTokenUsage = (
    state: ClaudeSessionState,
    control: Query,
    event: SDKMessage
  ): boolean => {
    if (event.type !== 'stream_event' && event.type !== 'assistant') return false
    const user = state.messages.findLast(
      (message) =>
        message.type === 'user' &&
        !message.parent_tool_use_id &&
        !isClaudeInternalUserMessage(message) &&
        getTextFromContent(getMessageContent(message.message))
    )
    const usage = this.liveTokenUsage.consume(control, event, user?.uuid ?? null)
    if (!usage) return false
    this.tokenUsageReporter.report({
      chatId: state.id,
      sourceKey: getContainerTargetKey(state.container),
      turnId: usage.turnId,
      recordId: `request:${usage.id}`,
      timestamp: usage.timestamp,
      usage: usage.usage,
      models: usage.modelId
        ? [
            {
              modelId: usage.modelId,
              pricingProvider: 'anthropic',
              usage: usage.usage,
              cacheWriteTokens: usage.cacheWriteTokens,
              contextTokens: usage.contextTokens
            }
          ]
        : undefined,
      provisionalGroup: this.getUsageQueryId(control),
      provisionalComplete: usage.completed
    })
    return true
  }

  private reportResultTokenUsage = (
    state: {
      id: string
      container?: AppContainerTarget | null
      messages?: ClaudeTranscriptMessage[]
    },
    control: Query,
    event: Extract<SDKMessage, { type: 'result' }>
  ): void => {
    const usageQueryId = this.getUsageQueryId(control)
    const turnId =
      event.user_message_uuid ??
      event.user_message_uuids?.[0] ??
      state.messages?.findLast((message) => {
        if (message.type !== 'user' || isClaudeInternalUserMessage(message)) return false
        const record = isRecord(message.message) ? message.message : null
        const content = record?.content
        return (
          !Array.isArray(content) ||
          !content.some((block) => isRecord(block) && block.type === 'tool_result')
        )
      })?.uuid ??
      null
    const usage = Object.values(event.modelUsage ?? {}).reduce(
      (total, model) =>
        addTokenUsage(
          total,
          normalizeTokenUsage(
            model.inputTokens + model.cacheCreationInputTokens,
            model.cacheReadInputTokens,
            model.outputTokens
          )
        ),
      emptyTokenUsage()
    )
    this.tokenUsageReporter.report({
      chatId: state.id,
      sourceKey: getContainerTargetKey(state.container),
      turnId,
      recordId: `query:${usageQueryId}`,
      timestamp: Date.now(),
      usage,
      models: Object.entries(event.modelUsage ?? {}).map(([id, model]) => ({
        modelId: model.canonicalModel ?? id,
        pricingProvider: 'anthropic' as const,
        usage: normalizeTokenUsage(
          model.inputTokens + model.cacheCreationInputTokens,
          model.cacheReadInputTokens,
          model.outputTokens
        ),
        cacheWriteTokens: model.cacheCreationInputTokens,
        totalUSD: model.costUSD
      })),
      cumulative: true,
      replaceProvisionalGroup: usageQueryId
    })
  }

  /**
   * After a result, the query stays open while background agents run. When one finishes, Claude
   * starts a main-thread turn on its own to handle the task notification. Show that turn as live
   * so the chat doesn't look finished while Claude keeps working.
   */
  private resumeBackgroundTurn = (state: ClaudeSessionState, control: Query): void => {
    if (state.active || state.query !== control || !state.waitingForSessionIdle) return
    // The SDK may not stream the task-notification record, so mark where this turn begins.
    this.addTranscriptMessage(state, {
      type: 'system',
      uuid: randomUUID(),
      session_id: state.id,
      parent_tool_use_id: null,
      timestamp: new Date().toISOString(),
      message: { subtype: claudeBackgroundTurnSubtype }
    })
    state.active = true
    state.stopped = false
    state.failed = false
    state.waitingForSessionIdle = false
    state.taskNotificationPending = false
    this.emitUpdate(state)
  }

  /** Background tasks still running, plus a finished one whose follow-up turn hasn't started. */
  private getOutstandingBackgroundWork = (state: ClaudeSessionState): number =>
    state.backgroundTaskIds.size + (state.taskNotificationPending ? 1 : 0)

  private scheduleBackgroundIdleClose = (state: ClaudeSessionState, control: Query): void => {
    const shouldClose = (): boolean =>
      state.query === control &&
      state.waitingForSessionIdle &&
      !state.sessionBusy &&
      !state.active &&
      !state.queueDrainInProgress &&
      state.backgroundTaskIds.size === 0
    setTimeout(() => {
      if (shouldClose()) void this.closeStateQuery(state)
    }, backgroundIdleCloseGraceMs).unref?.()
  }

  private handleQueryEvent = async (
    state: ClaudeSessionState,
    control: Query,
    // The SDK forwards active_goal at runtime but omits it from Query's SDKMessage union.
    event: SDKMessage | SDKActiveGoalMessage
  ): Promise<boolean> => {
    if (event.type === 'active_goal') {
      state.goalUpdatedAt = Date.now()
      state.goal = mapClaudeActiveGoal(state.id, event.value)
      const pending = state.goalRequest
      if (pending?.control === control && (state.goal?.objective ?? null) === pending.objective)
        pending.resolve()
      this.emitUpdate(state, false, false)
      return false
    }
    if (event.type === 'system' && event.subtype === 'local_command_output') {
      const pending = state.goalRequest
      if (pending?.control === control) {
        if (/^(Goal set:|Goal cleared:|No goal set\b)/.test(event.content)) {
          if (!pending.objective) {
            state.goalUpdatedAt = Date.now()
            state.goal = null
            pending.resolve()
          }
        } else pending.reject(new Error(event.content))
      }
      this.addTranscriptMessage(state, {
        type: 'system',
        uuid: event.uuid,
        session_id: event.session_id,
        message: { content: event.content },
        parent_tool_use_id: null
      })
      this.queueUpdate(state)
      return false
    }
    if (
      (event.type === 'stream_event' || event.type === 'assistant') &&
      event.parent_tool_use_id == null
    ) {
      if (state.turnAwaitingStart) this.releaseDeferredSteering(state, true)
      this.resumeBackgroundTurn(state, control)
    }
    if (event.type === 'stream_event') {
      const usageUpdated = this.reportLiveTokenUsage(state, control, event)
      if (applyClaudeStreamEvent(state.partialMessages, event) || usageUpdated)
        this.queueUpdate(state)
      return false
    }
    if (event.type === 'user' || event.type === 'assistant') {
      this.reportLiveTokenUsage(state, control, event)
      let message = toTranscriptMessage(event)
      message.timestamp ??= new Date().toISOString()
      if (event.type === 'assistant') {
        message = retainClaudeStreamTiming(state.partialMessages, message)
        clearClaudeStreamMessages(state.partialMessages, event)
      }
      this.addTranscriptMessage(state, message)
      if (isClaudeAuthenticationFailure(message)) {
        const sourceKey = getContainerTargetKey(state.container)
        this.authenticationFailures.add(sourceKey)
        this.authenticatedSources.delete(sourceKey)
        for (const other of this.states.values()) {
          if (other !== state && getContainerTargetKey(other.container) === sourceKey) {
            other.queuedMessagesPaused = true
            this.queueUpdate(other, false)
          }
        }
        state.failed = true
        state.active = false
        state.queuedMessagesPaused = true
        this.emitUpdate(state, true)
        return true
      }
      this.queueUpdate(state)
      return false
    }
    if (event.type === 'system' && event.subtype === 'compact_boundary') {
      this.addTranscriptMessage(state, {
        type: 'system',
        uuid: event.uuid,
        session_id: event.session_id,
        message: { subtype: 'compact_boundary' },
        parent_tool_use_id: null
      })
      this.queueUpdate(state)
      return false
    }
    if (event.type === 'system' && event.subtype === 'background_tasks_changed') {
      const taskIds = new Set(event.tasks.map((task) => task.task_id))
      // A background task that left the list has finished; Claude follows up with a turn.
      if ([...state.backgroundTaskIds].some((id) => !taskIds.has(id))) {
        state.taskNotificationPending = true
      }
      state.backgroundTaskIds = taskIds
      state.terminalTaskIds = new Set(
        event.tasks
          .filter((task) => task.task_type === 'local_bash' && !task.ambient)
          .map((task) => task.task_id)
      )
      this.queueUpdate(state, false)
      // The last task's notification still has to start a main-thread turn that reads its
      // result. Closing here would kill that turn, so only close if it never arrives.
      if (state.waitingForSessionIdle && state.backgroundTaskIds.size === 0 && !state.active) {
        this.scheduleBackgroundIdleClose(state, control)
      }
      return false
    }
    if (event.type === 'system' && event.subtype === 'task_started') {
      state.subagentTaskStatuses.set(event.task_id, 'running')
      this.queueUpdate(state, false)
      return false
    }
    if (event.type === 'system' && event.subtype === 'task_notification') {
      if (event.status === 'failed') {
        console.error(`Claude background task ${event.task_id} failed in session ${state.id}.`)
      }
      state.subagentTaskStatuses.set(
        event.task_id,
        event.status === 'failed' ? 'failed' : event.status === 'stopped' ? 'stopped' : 'completed'
      )
      this.queueUpdate(state, false)
      return false
    }
    if (event.type === 'system' && event.subtype === 'session_state_changed') {
      state.sessionBusy = event.state !== 'idle'
      // These informational notifications can arrive after a result without another turn.
      // Reopen the foreground only when main-thread assistant output actually arrives;
      // otherwise a late "running" notification leaves it active and blocks idle cleanup.
      if (event.state !== 'idle') return false
      // A result completes the visible foreground turn. Session idle only decides when the
      // underlying query can be closed after its background tasks have also finished.
      const lifecycle = getClaudeSessionStateLifecycleDecision(
        state.waitingForSessionIdle,
        event.state,
        this.getOutstandingBackgroundWork(state),
        // A queued message that is preparing to send will use this query.
        state.active || state.queueDrainInProgress
      )
      if (lifecycle === 'ignore') {
        if (state.waitingForSessionIdle && !state.active && state.backgroundTaskIds.size === 0) {
          // A prior grace timer may have expired while the SDK was preparing a response.
          this.scheduleBackgroundIdleClose(state, control)
        }
        return false
      }
      state.waitingForSessionIdle = false
      return true
    }
    if (event.type !== 'result') return false
    const releasedSteeringTurns = state.turnAwaitingStart
      ? this.releaseDeferredSteering(state, false)
      : 0

    // Keep elapsed wall time on the existing transcript path. API duration excludes tool/wait time.
    this.addTranscriptMessage(state, {
      type: 'system',
      uuid: `${event.uuid}:timing`,
      session_id: event.session_id,
      parent_tool_use_id: null,
      timestamp: new Date().toISOString(),
      message: { subtype: 'sele_turn_timing', duration_ms: event.duration_ms }
    })
    state.partialMessages.clear()

    const wasStopped = state.stopped
    // A turn we interrupted to send a queued message ends with error_during_execution; that is
    // the expected outcome, not a failure.
    const wasInterrupted = state.interruptRequested && event.subtype === 'error_during_execution'
    state.interruptRequested = false
    const resultError = getClaudeResultError(event)
    state.failed = !wasStopped && !wasInterrupted && resultError !== null
    if (state.failed) {
      // API failures can use subtype "success" with is_error=true and the error in result.
      const reason = event.subtype === 'success' ? 'api_error' : event.subtype
      const errors = 'errors' in event ? event.errors : [event.result]
      console.error(`Claude session ${state.id} returned ${reason}.`, { errors })
      this.addTranscriptMessage(state, {
        type: 'system',
        uuid: event.uuid,
        session_id: event.session_id,
        message: { content: resultError },
        parent_tool_use_id: null,
        failed: true
      })
    }

    this.reportResultTokenUsage(state, control, event)

    const inputTokens = event.usage.input_tokens + event.usage.cache_creation_input_tokens
    const outputTokens = event.usage.output_tokens
    const cachedInputTokens = event.usage.cache_read_input_tokens
    const last = getTokenBreakdown(inputTokens, outputTokens, cachedInputTokens)
    const currentTotal = state.contextUsage?.total
    state.contextUsage = {
      usedTokens: inputTokens + cachedInputTokens,
      maxTokens: null,
      last,
      total: currentTotal
        ? getTokenBreakdown(
            currentTotal.inputTokens + inputTokens,
            currentTotal.outputTokens + outputTokens,
            currentTotal.cachedInputTokens + cachedInputTokens
          )
        : last,
      updatedAt: Date.now()
    }
    const refreshContextUsage = control
      .getContextUsage({ detail: 'summary' })
      .then((usage) => {
        if (state.query !== control) return
        state.contextUsage = {
          ...(state.contextUsage ?? {
            total: last,
            last,
            updatedAt: Date.now()
          }),
          usedTokens: usage.totalTokens,
          maxTokens: usage.maxTokens
        }
        this.queueUpdate(state, false)
      })
      .catch((error: unknown) => {
        if (state.query !== control && isExpectedClaudeQueryShutdownError(error)) return
        console.error(`Unable to refresh Claude context usage for session ${state.id}.`, error)
      })
    // Claude Code writes the auto-generated session title to the transcript during the turn; it
    // is not surfaced as a stream event, so re-read session metadata once the turn has ended.
    const refreshMetadata = this.refreshSessionMetadata(state).catch((error: unknown) => {
      if (isExpectedClaudeSessionMetadataAbsenceError(error)) return
      console.error(`Unable to refresh Claude session metadata for ${state.id}.`, error)
    })

    // Steering is already in the SDK's queue, not queuedMessages. This result can
    // belong to the preceding turn; closing the query here kills the follow-up.
    if (!wasStopped && (event.queued_turn_count ?? 0) + releasedSteeringTurns > 0) {
      state.active = true
      state.waitingForSessionIdle = false
      this.emitUpdate(state)
      void refreshContextUsage
      void refreshMetadata
      return false
    }

    state.active = false
    state.stopped = wasStopped
    state.waitingForSessionIdle = false
    // Claude Code drains its own input queue before it reports an idle result.
    state.submittedSteering = []

    if (this.getQueueDrainDecision(state) === 'start') {
      this.emitUpdate(state, true)
      state.waitingForSessionIdle = false
      void refreshContextUsage
      void refreshMetadata
      await this.drainNextQueuedMessage(state)
      return false
    } else {
      const lifecycle = getClaudeResultLifecycleDecision(
        this.getOutstandingBackgroundWork(state),
        event.terminal_reason,
        state.failed || wasStopped
      )
      state.waitingForSessionIdle = lifecycle.waitForSessionIdle
      if (lifecycle.keepQueryAlive && state.taskNotificationPending) {
        this.scheduleBackgroundIdleClose(state, control)
      }
      state.resultSettling = true
      try {
        await settleWithin(
          Promise.all([refreshContextUsage, refreshMetadata]),
          contextUsageCloseGraceMs
        )
      } finally {
        // Stop/edit may have replaced this query while metadata requests were pending.
        if (state.query === control) state.resultSettling = false
      }
      if (state.query !== control) return !lifecycle.keepQueryAlive
      this.emitUpdate(state, true)
      // A message sent while the result settled was held in the queue; send it on this query
      // instead of closing the query underneath it.
      if (this.getQueueDrainDecision(state) === 'start') {
        state.waitingForSessionIdle = false
        await this.drainNextQueuedMessage(state)
        return false
      }
      return !lifecycle.keepQueryAlive
    }
  }

  private createQueuedMessage = (
    message: string,
    options?: ProviderTurnOptions,
    id: string = randomUUID()
  ): QueuedClaudeMessage => ({
    id,
    content: message,
    prompt: getPrompt(message, options),
    options,
    attachments: getAttachments(options),
    createdAt: Date.now()
  })

  private persistPendingMessages = (state: ClaudeSessionState): void => {
    this.pendingMessageStore.save(state.id, [
      ...state.submittedSteering.map((message) => ({
        id: message.id,
        kind: 'steering' as const,
        submitted: true,
        createdAt: message.createdAt,
        payload: message
      })),
      ...state.queuedMessages.map((message) => ({
        id: message.id,
        kind: message.kind ?? 'queued',
        submitted: false,
        createdAt: message.createdAt,
        payload: message
      }))
    ])
  }

  /**
   * The previous process ended with these messages undelivered. Nothing is running now, so they
   * wait in a paused queue, as after Stop. Steering Claude Code already recorded is dropped.
   */
  private restorePendingMessages = (
    state: ClaudeSessionState,
    stored: PersistedPendingMessage<QueuedClaudeMessage>[],
    deliveredIds: readonly string[]
  ): void => {
    const delivered = new Set(deliveredIds)
    const restored = stored
      .filter((message) => !(message.submitted && delivered.has(message.id)))
      .map(
        (message): QueuedClaudeMessage => ({
          ...message.payload,
          id: message.id,
          kind: message.kind,
          createdAt: message.createdAt
        })
      )
    if (!restored.length) return
    state.queuedMessages = [...restored, ...state.queuedMessages]
    state.queuedMessagesPaused = true
  }

  /** Sends steering into the running turn and keeps it until Claude Code has consumed it. */
  private steerWithMessage = (state: ClaudeSessionState, message: QueuedClaudeMessage): void => {
    state.waitingForSessionIdle = false
    this.addUserMessage(state, message, 'Steering with', 'steering')
    state.submittedSteering.push({ ...message, kind: 'steering' })
    this.pushSteering(state, createSdkUserMessage(state.id, message.id, message.prompt, 'now'))
  }

  /**
   * Claude Code moves priority "now" input ahead of input it has not started yet. Steering
   * sent before the turn begins would be answered before the prompt it is meant to steer.
   */
  private pushSteering = (state: ClaudeSessionState, message: SDKUserMessage): void => {
    if (state.turnAwaitingStart) state.deferredSteering.push(message)
    else state.input!.push(message)
  }

  /** Returns how many follow-up turns this queued in Claude Code. */
  private releaseDeferredSteering = (state: ClaudeSessionState, steer: boolean): number => {
    state.turnAwaitingStart = false
    const messages = state.deferredSteering.splice(0)
    if (!messages.length || !state.input) return 0
    for (const message of messages)
      state.input.push(steer ? message : { ...message, priority: 'next' })
    if (steer) return 0
    // The turn ended before it started, so the steering is the next prompt instead.
    state.turnAwaitingStart = true
    return messages.length
  }

  private sendMessageNow = (
    state: ClaudeSessionState,
    message: string,
    options?: ProviderTurnOptions
  ): void => this.sendQueuedMessageNow(state, this.createQueuedMessage(message, options))

  private sendMessageRespectingQueue = async (
    state: ClaudeSessionState,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<void> => {
    this.requireAuthentication(state)
    const queued = this.createQueuedMessage(message, options)
    const immediate =
      !state.active && !state.queueDrainInProgress && state.queuedMessages.length === 0
    state.queuedMessages.push(queued)
    state.queuedMessagesPaused = false
    if (this.getQueueDrainDecision(state) !== 'start') {
      this.emitUpdate(state)
      return
    }
    try {
      await this.drainNextQueuedMessage(state)
    } catch (error) {
      // A rejected idle send stays in the composer's draft, rather than becoming an unseen retry.
      // Explicit queued messages and other submissions must remain untouched.
      if (immediate && !state.active) {
        const index = state.queuedMessages.indexOf(queued)
        if (index >= 0) state.queuedMessages.splice(index, 1)
        if (!state.queuedMessages.length) state.queuedMessagesPaused = false
        this.emitUpdate(state)
      }
      throw error
    }
  }

  private getQueueDrainDecision = (
    state: ClaudeSessionState
  ): ReturnType<typeof getClaudeQueueDrainDecision> =>
    getClaudeQueueDrainDecision({
      hasQueuedMessage: state.queuedMessages.length > 0,
      paused:
        state.queuedMessagesPaused ||
        this.pendingMessageEdits.blocks(state.id, state.queuedMessages[0]?.id),
      drainInProgress: state.queueDrainInProgress || state.resultSettling,
      foregroundActive: state.active,
      hasPendingRequest: state.pendingApprovals.length > 0 || state.pendingUserInputs.length > 0
    })

  private drainNextQueuedMessage = async (state: ClaudeSessionState): Promise<boolean> => {
    if (this.getQueueDrainDecision(state) !== 'start') return false

    state.queueDrainInProgress = true
    this.emitUpdate(state)
    try {
      while (true) {
        const queued = state.queuedMessages[0]
        if (!queued) return false
        await this.ensureStateQuery(state, queued.options)
        await this.applyTurnOptions(state, queued.options)
        if (
          state.queuedMessagesPaused ||
          state.active ||
          this.pendingMessageEdits.blocks(state.id, queued.id)
        ) {
          if (state.stopped && state.queuedMessagesPaused) await this.closeStateQuery(state)
          return false
        }
        // An edit replaces the object but retains its id. Re-prepare the current head after
        // edits/deletions during startup so neither an old payload nor an abandoned queue wins.
        if (state.queuedMessages[0] !== queued) continue

        state.queuedMessages.shift()
        this.sendQueuedMessageNow(state, queued)
        return true
      }
    } catch (error) {
      state.queuedMessagesPaused = true
      throw error
    } finally {
      state.queueDrainInProgress = false
      this.emitUpdate(state)
    }
  }

  private sendQueuedMessageNow = (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage
  ): void => {
    this.requireAuthentication(state)
    if (!state.input) throw new Error('Claude session is not connected')
    state.waitingForSessionIdle = false
    state.active = true
    state.stopped = false
    state.failed = false
    state.queuedMessagesPaused = false
    state.options = message.options ?? state.options
    if (state.goalRequest?.id === message.id) {
      state.goalRequest.control = state.query ?? undefined
      if (!state.goalRequest.objective)
        state.queuedMessagesPaused = state.goalRequest.queueWasPaused
    }
    this.addUserMessage(state, message)
    state.turnAwaitingStart = true
    state.input.push(createSdkUserMessage(state.id, message.id, message.prompt))
    this.emitUpdate(state)
  }

  private interruptWithMessage = async (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage
  ): Promise<void> => {
    state.queuedMessages.unshift(message)
    // Sending a new message supersedes any open question or approval; leaving them pending
    // would block the queue drain after the interrupted turn ends.
    this.rejectPendingRequests(state)
    this.emitUpdate(state)
    const control = state.query
    if (control) {
      state.interruptRequested = true
      let finish = (): void => {}
      const ended = new Promise<void>((resolve) => {
        finish = resolve
      })
      const unsubscribe = this.onChatUpdated((detail) => {
        if (
          detail.id === state.id &&
          (state.query !== control || !state.active || !state.queuedMessages.includes(message))
        )
          finish()
      })
      try {
        void control.interrupt().catch((error: unknown) => {
          if (!isExpectedClaudeQueryShutdownError(error))
            console.error(`Unable to interrupt Claude session ${state.id} for steering.`, error)
          finish()
        })
        // An acknowledgement alone does not guarantee a result will follow. Bound both waits.
        await settleWithin(ended, interruptCloseGraceMs)
      } finally {
        unsubscribe()
      }
    }
    // Stop or another send may have taken over while the interrupt was pending.
    if (
      state.stopped ||
      state.queuedMessagesPaused ||
      state.query !== control ||
      !state.queuedMessages.includes(message) ||
      state.queueDrainInProgress
    )
      return

    await this.closeStateQuery(state)
    // Keep the message queued until startup succeeds, so a failed recovery cannot lose it.
    await this.drainNextQueuedMessage(state)
  }

  private createUserTranscriptMessage = (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage,
    label: string | null = null,
    kind?: 'steering'
  ): ClaudeTranscriptMessage => ({
    type: 'user',
    uuid: message.id,
    session_id: state.id,
    message: { role: 'user', content: message.content },
    parent_tool_use_id: null,
    timestamp: new Date(message.createdAt).toISOString(),
    attachments: message.attachments,
    kind,
    label
  })

  private addUserMessage = (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage,
    label: string | null = null,
    kind?: 'steering'
  ): void => {
    this.addTranscriptMessage(state, this.createUserTranscriptMessage(state, message, label, kind))
  }

  private addTranscriptMessage = (
    state: ClaudeSessionState,
    message: ClaudeTranscriptMessage
  ): void => {
    const previousMessages = state.messages
    const changedIndex = state.messageIds.has(message.uuid)
      ? state.messages.findIndex((entry) => entry.uuid === message.uuid)
      : state.messages.length
    state.messages =
      changedIndex === state.messages.length
        ? [...state.messages, message]
        : reconcileProviderRecords(state.messages, [message], {
            authoritative: false,
            getId: (candidate) => candidate.uuid,
            merge: (previous, next) => ({
              ...previous,
              ...next,
              attachments: next.attachments ?? previous.attachments,
              kind: next.kind ?? previous.kind,
              label: next.label ?? previous.label
            })
          })
    markTranscriptRecordsChanged(previousMessages, state.messages, changedIndex)
    this.transcriptProjections
      .get(state)
      ?.acceptSource(previousMessages, state.messages, changedIndex)
    state.messageIds.add(message.uuid)
    state.historyDirty = true
  }

  private rejectPendingRequests = (state: ClaudeSessionState): void => {
    if (!state.pendingApprovals.length && !state.pendingUserInputs.length) return
    state.pendingApprovals
      .splice(0)
      .forEach((pending) => pending.resolve({ behavior: 'deny', message: 'The chat was stopped.' }))
    state.pendingUserInputs.splice(0).forEach((pending) => pending.resolve({ kind: 'cancel' }))
    // Some callers (e.g. a query closing on its own) never emit afterwards; without this the
    // renderer keeps showing a question that can no longer be answered.
    this.queueUpdate(state, false)
  }

  private getTitle = (state: ClaudeSessionState): string => {
    const firstUserMessage = state.messages.find(
      (message) => message.type === 'user' && !isClaudeInternalUserMessage(message)
    )
    const firstPrompt = firstUserMessage
      ? getTextFromContent(getMessageContent(firstUserMessage.message))
      : ''
    return getClaudeSessionTitle(state.metadata, firstPrompt)
  }

  private getPendingApproval = (state: ClaudeSessionState): ProviderPendingApproval | null => {
    const pending = state.pendingApprovals[0]
    if (!pending) return null
    return {
      id: pending.id,
      type: isFileChangeTool(pending.toolName) ? 'fileChange' : 'command',
      command: pending.title || getPermissionCommand(pending.toolName, pending.input),
      cwd: state.cwd,
      reason: pending.description || pending.reason,
      startedAt: pending.startedAt
    }
  }

  private getPendingUserInput = (state: ClaudeSessionState): ProviderPendingUserInput | null => {
    const pending = state.pendingUserInputs[0]
    return pending
      ? {
          id: pending.id,
          question: pending.question,
          choices: pending.choices,
          allowFreeform: pending.allowFreeform,
          startedAt: pending.startedAt,
          elicitation: pending.elicitation,
          isBlocking: true
        }
      : null
  }

  private getPendingMessages = (
    state: ClaudeSessionState,
    excludedMessageId: string | null = null
  ): ProviderPendingMessage[] =>
    state.queuedMessages
      .filter((message) => message.id !== excludedMessageId)
      .map((message) => ({
        type: 'pendingMessage',
        id: message.id,
        kind: message.kind ?? 'queued',
        content: message.content,
        attachments: message.attachments,
        createdAt: message.createdAt
      }))

  /**
   * The head queued message is already committed to the next turn while the query is being
   * started for it. Presenting it as a sent user message (with the same ids the transcript will
   * use) avoids flashing a "queued" item between the composer submit and the SDK accepting it.
   */
  private getDrainingMessage = (state: ClaudeSessionState): QueuedClaudeMessage | null =>
    state.queueDrainInProgress &&
    !state.active &&
    !state.queuedMessagesPaused &&
    !this.pendingMessageEdits.blocks(state.id, state.queuedMessages[0]?.id)
      ? (state.queuedMessages[0] ?? null)
      : null

  private createChatDetail = (
    state: ClaudeSessionState,
    windowed: boolean | ProviderChatTurnWindow = false
  ): ProviderChatDetail => {
    const foregroundActive =
      state.active || (state.queueDrainInProgress && !state.queuedMessagesPaused)
    const drainingMessage = this.getDrainingMessage(state)
    const renderOptions = {
      active: foregroundActive || state.pendingUserInputs.length > 0,
      stopped: state.stopped,
      failed: state.failed,
      pendingItems: this.getPendingMessages(state, drainingMessage?.id ?? null)
    }
    const overlays = [
      ...state.partialMessages.values(),
      ...(drainingMessage ? [this.createUserTranscriptMessage(state, drainingMessage)] : [])
    ]
    let projected: ReturnType<ClaudeTranscriptProjection['read']> | null = null
    if (windowed === true) {
      let projection = this.transcriptProjections.get(state)
      if (!projection) {
        projection = new ClaudeTranscriptProjection()
      }
      this.transcriptProjections.delete(state)
      this.transcriptProjections.set(state, projection)
      while (this.transcriptProjections.size > 8) {
        this.transcriptProjections.delete(this.transcriptProjections.keys().next().value!)
      }
      // The older cursor is anchored before the retained live tail. Keep that tail whole,
      // including newly streamed turns, so a live publication cannot leave a paging gap.
      projected = projection.read(
        state.messages,
        overlays,
        renderOptions,
        state.historyPagination ? Number.MAX_SAFE_INTEGER : 10
      )
    }
    if (typeof windowed === 'object') {
      const records = overlays.length ? [...state.messages, ...overlays] : state.messages
      if (records !== state.messages)
        markTranscriptRecordsChanged(state.messages, records, state.messages.length)
      projected = renderClaudeChatWindow(
        records,
        renderOptions,
        state.historyPagination ? { startIndex: 0, limit: Number.MAX_SAFE_INTEGER } : windowed
      )
    }
    state.revision = ++this.detailRevision
    return {
      id: state.id,
      revision: state.revision,
      createdAt: state.metadata?.createdAt ?? state.createdAt,
      title: this.getTitle(state),
      cwd: state.cwd,
      cwdKind: 'directory',
      projectCwd: null,
      branchName: state.metadata?.gitBranch ?? null,
      worktreeBaseBranchName: null,
      status: state.pendingUserInputs.length
        ? 'waitingOnUserInput'
        : state.pendingApprovals.length
          ? 'waitingOnApproval'
          : state.failed
            ? 'error'
            : foregroundActive
              ? 'active'
              : null,
      lastTurnOutcome: state.historyPagination?.newerCursor
        ? undefined
        : foregroundActive
          ? null
          : state.failed
            ? 'failed'
            : state.stopped
              ? 'stopped'
              : getClaudeTurnOutcome([...state.messages, ...overlays]),
      pinned: false,
      sidebarOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: state.container,
      capabilities: { editMessages: true, activeMessages: true, setGoal: true },
      goal: state.goal,
      authenticationRequired: this.authenticationFailures.has(
        getContainerTargetKey(state.container)
      ),
      pendingApproval: this.getPendingApproval(state),
      pendingUserInput: this.getPendingUserInput(state),
      contextUsage: state.contextUsage,
      ...(projected ?? {
        items: renderClaudeChatItems([...state.messages, ...overlays], renderOptions)
      }),
      ...(state.historyPagination ? { turnPagination: state.historyPagination } : {})
    }
  }

  private createChatFromState = (state: ClaudeSessionState): ProviderChat => {
    const detail = this.createChatDetail(state, true)
    const preview = detail.items.findLast((item) => item.type === 'message')?.content ?? ''
    return {
      id: state.id,
      providerId: this.id,
      title: detail.title,
      preview: truncate(preview, maxPreviewLength),
      cwd: detail.cwd,
      cwdKind: detail.cwdKind,
      projectCwd: null,
      branchName: detail.branchName,
      worktreeBaseBranchName: null,
      createdAt: detail.createdAt,
      updatedAt: state.updatedAt,
      status: detail.status,
      lastTurnOutcome: detail.lastTurnOutcome,
      pendingApproval: detail.pendingApproval,
      pinned: false,
      sidebarOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: state.container
    }
  }

  private createChatFromMetadata = (metadata: SDKSessionInfo): ProviderChat => {
    const state = this.states.get(metadata.sessionId)
    if (state) {
      this.applySessionMetadata(state, metadata)
      return this.createChatFromState(state)
    }
    const title = getClaudeSessionTitle(metadata)
    return {
      id: metadata.sessionId,
      providerId: this.id,
      title,
      preview: truncate(metadata.firstPrompt || metadata.summary || '', maxPreviewLength),
      cwd: metadata.cwd ?? null,
      cwdKind: 'directory',
      projectCwd: null,
      branchName: metadata.gitBranch ?? null,
      worktreeBaseBranchName: null,
      createdAt: metadata.createdAt ?? metadata.lastModified,
      updatedAt: metadata.lastModified,
      status: null,
      lastTurnOutcome: undefined,
      pendingApproval: null,
      pinned: false,
      sidebarOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: this.sessionContainers.get(metadata.sessionId) ?? null
    }
  }

  private applySessionMetadata = (state: ClaudeSessionState, metadata: SDKSessionInfo): boolean => {
    const previousTitle = this.getTitle(state)
    // A rename issued while the metadata read was in flight must not be reverted by stale data.
    const customTitle = metadata.customTitle ?? state.metadata?.customTitle
    state.metadata =
      customTitle && !metadata.customTitle
        ? { ...metadata, customTitle, summary: customTitle }
        : metadata
    state.createdAt = metadata.createdAt ?? state.createdAt
    return this.getTitle(state) !== previousTitle
  }

  private refreshSessionMetadata = async (state: ClaudeSessionState): Promise<void> => {
    const sessionStore = await getClaudeSessionStore(state.container)
    const metadata = await getSessionInfo(state.id, { sessionStore })
    if (!metadata || this.states.get(state.id) !== state) return
    if (this.applySessionMetadata(state, metadata)) this.queueUpdate(state, false)
  }

  private scheduleSessionMetadataRefresh = (state: ClaudeSessionState): void => {
    const previous = this.metadataRefreshTimers.get(state.id)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      if (this.metadataRefreshTimers.get(state.id) !== timer) return
      this.metadataRefreshTimers.delete(state.id)
      if (this.states.get(state.id) !== state) return
      void this.refreshSessionMetadata(state).catch((error: unknown) => {
        if (isExpectedClaudeSessionMetadataAbsenceError(error)) return
        console.error(`Unable to refresh delayed Claude session metadata for ${state.id}.`, error)
      })
    }, sessionTitleRefreshDelayMs)
    timer.unref?.()
    this.metadataRefreshTimers.set(state.id, timer)
  }

  private queueUpdate = (state: ClaudeSessionState, conversationChanged = true): void => {
    if (this.disposed || this.states.get(state.id) !== state) return
    if (conversationChanged) state.updatedAt = Date.now()
    if (this.updateTimers.has(state.id)) return
    const timer = setTimeout(() => {
      if (this.updateTimers.get(state.id) !== timer) return
      this.updateTimers.delete(state.id)
      this.emitUpdate(state, false, false)
      this.trimIdleStates()
    }, updateDelayMs)
    this.updateTimers.set(state.id, timer)
  }

  private emitUpdate = (
    state: ClaudeSessionState,
    turnCompleted = false,
    conversationChanged = true
  ): void => {
    if (this.disposed || this.states.get(state.id) !== state) return
    this.persistPendingMessages(state)
    if (turnCompleted) {
      // The ordered SDK result/error event is the lifecycle boundary. Provisional fragments are
      // no longer needed once that event has supplied the completed message collection.
      state.partialMessages.clear()
      this.completingStates.add(state)
      void this.completionCoordinator
        .complete(state.id, {
          publish: () => this.publishUpdate(state, true, conversationChanged),
          isCurrent: () => this.states.get(state.id) === state,
          onError: (error, phase) => {
            console.error(`Unable to ${phase} completed Claude session ${state.id}`, error)
          }
        })
        .finally(() => {
          this.completingStates.delete(state)
          if (this.states.get(state.id) === state) {
            this.rememberStateTranscriptSize(state)
            this.trimIdleStates()
          }
        })
      return
    }
    this.publishUpdate(state, false, conversationChanged)
  }

  private publishUpdate = (
    state: ClaudeSessionState,
    turnCompleted: boolean,
    conversationChanged: boolean
  ): void => {
    if (this.disposed || this.states.get(state.id) !== state) return
    if (conversationChanged) state.updatedAt = Date.now()
    const timer = this.updateTimers.get(state.id)
    if (timer) clearTimeout(timer)
    this.updateTimers.delete(state.id)
    if (this.hiddenSessionIds.has(state.id)) return
    const detail = this.createChatDetail(state, true)
    this.chatUpdatedListeners.forEach((listener) => listener(detail, { turnCompleted }))
  }

  private rememberCanceledOneShotGeneration = (generationId: string): void => {
    this.canceledOneShotGenerationIds.add(generationId)
    const current = this.canceledOneShotGenerationTimers.get(generationId)
    if (current) clearTimeout(current)
    const timer = setTimeout(() => {
      this.canceledOneShotGenerationIds.delete(generationId)
      this.canceledOneShotGenerationTimers.delete(generationId)
    }, oneShotCancellationRetentionMs)
    this.canceledOneShotGenerationTimers.set(generationId, timer)
  }

  private takeCanceledOneShotGeneration = (generationId: string): boolean => {
    const canceled = this.canceledOneShotGenerationIds.delete(generationId)
    const timer = this.canceledOneShotGenerationTimers.get(generationId)
    if (timer) clearTimeout(timer)
    this.canceledOneShotGenerationTimers.delete(generationId)
    return canceled
  }
}
