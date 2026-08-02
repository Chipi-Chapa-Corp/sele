import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  CopilotClient,
  RuntimeConnection,
  type CopilotSession,
  type ModelInfo,
  type PermissionRequest,
  type PermissionRequestResult,
  type SessionEvent,
  type SessionMetadata
} from '@github/copilot-sdk'
import type {
  ProviderAccountUsage,
  ProviderActiveSendMode,
  ProviderAgentTerminalDataEvent,
  ProviderApprovalDecision,
  ProviderApprovalModeOption,
  ProviderApp,
  ProviderChat,
  ProviderChatContextUsage,
  ProviderChatDetail,
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderLoginResult,
  ProviderModel,
  ProviderOneShotOptions,
  ProviderPendingApproval,
  ProviderPendingMessage,
  ProviderReasoningEffort,
  ProviderSandboxModeOption,
  ProviderSkill,
  ProviderSourceOptions,
  ProviderTokenUsageBreakdown,
  ProviderTurnOptions,
  ProviderUsageOptions,
  ProviderUpdateAvailability
} from '../../../shared/provider'
import type { AppContainerTarget } from '../../../shared/app'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget'
import { getCurrentContainerHostBridge } from '../../currentContainer'
import { getHostExecutableCommand, isRunningInFlatpak } from '../../hostProcess'
import { fallbackCopilotModels } from '../../../shared/provider'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from '../ProviderAdapter'
import { getCopilotExecutable } from './CopilotExecutable'
import { renderCopilotChatItems } from './CopilotItemRenderers'

type PendingPermission = {
  id: string
  request: PermissionRequest
  startedAt: number
  resolve: (result: PermissionRequestResult) => void
}

type CopilotSessionState = {
  id: string
  client: CopilotClient | null
  container: AppContainerTarget | null
  session: CopilotSession | null
  metadata: SessionMetadata | null
  events: SessionEvent[]
  eventIds: Set<string>
  title: string | null
  active: boolean
  stopped: boolean
  failed: boolean
  options: ProviderTurnOptions | undefined
  pendingMessages: ProviderPendingMessage[]
  pendingPermissions: PendingPermission[]
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

const toMilliseconds = (value: Date | string | number | undefined): number => {
  if (value instanceof Date) return value.getTime()
  const timestamp = typeof value === 'number' ? value : value ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

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

const getPermissionDescription = (request: PermissionRequest): string => {
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
    case 'extension-permission-access':
      return request.extensionName
  }
}

const getPermissionReason = (request: PermissionRequest): string | null => {
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

  private clientEntries = new Map<string, CopilotClientEntry>()
  private clientEntryPromises = new Map<string, Promise<CopilotClientEntry>>()
  private sessionContainers = new Map<string, AppContainerTarget | null>()
  private states = new Map<string, CopilotSessionState>()
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private agentTerminalDataListeners = new Set<(event: ProviderAgentTerminalDataEvent) => void>()
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private oneShotSessions = new Map<string, CopilotSession>()

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult> => {
    const client = await this.ensureClient(options.container)
    const status = await client.getAuthStatus()
    if (!status.isAuthenticated) {
      throw new Error('GitHub Copilot is not authenticated. Run `copilot` and use `/login` first.')
    }

    return {
      status: 'authenticated',
      account: { label: status.login || status.host || 'GitHub Copilot' }
    }
  }

  getUpdateAvailability = async (): Promise<ProviderUpdateAvailability | null> => null

  updateProvider = async (): Promise<ProviderUpdateAvailability | null> => null

  getApprovalModes = async (): Promise<ProviderApprovalModeOption[]> => copilotApprovalModes

  getSandboxModes = async (): Promise<ProviderSandboxModeOption[]> => copilotSandboxModes

  getModels = async (options: ProviderSourceOptions = {}): Promise<ProviderModel[]> => {
    try {
      const client = await this.ensureClient(options.container)
      const models = await client.listModels()
      const enabledModels = models.filter((model) => model.policy?.state !== 'disabled')
      if (enabledModels.length === 0) return fallbackCopilotModels

      const defaultIndex = enabledModels.findIndex((model) => model.id === 'auto')
      return enabledModels.map((model, index) =>
        mapModel(model, index === (defaultIndex >= 0 ? defaultIndex : 0))
      )
    } catch {
      return fallbackCopilotModels
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

    return result.skills
      .flatMap((skill): ProviderSkill[] => {
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
      .sort((first, second) => first.name.localeCompare(second.name))
  }

  getApps = async (): Promise<ProviderApp[]> => []

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

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const normalizedContainer = normalizeContainerTarget(options.container)
    const storedContainer = normalizedContainer.kind === 'container' ? normalizedContainer : null
    const client = await this.ensureClient(storedContainer)
    const sessions = (await client.listSessions()).sort(
      (first, second) => toMilliseconds(second.modifiedTime) - toMilliseconds(first.modifiedTime)
    )
    const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const page = sessions.slice(offset, offset + limit)
    const chats = page.map((metadata) => this.createChatFromMetadata(metadata, storedContainer))
    const nextOffset = offset + page.length

    return {
      chats,
      nextCursor: nextOffset < sessions.length ? String(nextOffset) : null
    }
  }

  getChat = async (
    chatId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, undefined, options.container)
    await this.loadEvents(state)
    return this.createChatDetail(state)
  }

  generateOneShot = async (message: string, options?: ProviderOneShotOptions): Promise<string> => {
    const generationId = options?.generationId ?? randomUUID()
    const sessionId = randomUUID()
    const state = this.createState(sessionId, options)

    try {
      const session = await this.createSession(state, options)
      this.oneShotSessions.set(generationId, session)
      const response = await session.sendAndWait(getMessageOptions(message, options), 10 * 60_000)
      if (response?.data.content.trim()) return response.data.content.trim()

      await this.loadEvents(state)
      const lastMessage = state.events.findLast(
        (event): event is Extract<SessionEvent, { type: 'assistant.message' }> =>
          event.type === 'assistant.message' && Boolean(event.data.content.trim())
      )
      return lastMessage?.data.content.trim() ?? ''
    } finally {
      this.oneShotSessions.delete(generationId)
      const session = state.session
      if (session) await session.disconnect().catch(() => {})
      await state.client?.deleteSession(sessionId).catch(() => {})
      this.states.delete(sessionId)
    }
  }

  cancelOneShot = async (generationId: string): Promise<void> => {
    await this.oneShotSessions.get(generationId)?.abort()
  }

  startChat = async (
    message: string,
    options?: ProviderTurnOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const sessionId = randomUUID()
    const state = this.createState(sessionId, options)
    const session = await this.createSession(state, options)
    await onChatCreated?.(sessionId)
    state.active = true
    await session.send(getMessageOptions(message, options))
    return this.createChatDetail(state)
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, options)
    await this.applyTurnOptions(state, options)
    state.active = true
    state.stopped = false
    state.failed = false
    await state.session!.send(getMessageOptions(message, options))
    return this.createChatDetail(state)
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

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, options)
    await this.applyTurnOptions(state, options)

    if (mode === 'interrupt') {
      await state.session!.abort()
      await state.session!.send(getMessageOptions(message, options, 'enqueue'))
    } else {
      await state.session!.send(
        getMessageOptions(message, options, mode === 'steer' ? 'immediate' : 'enqueue')
      )
    }
    state.active = true
    await this.refreshPendingMessages(state)
    return this.createChatDetail(state)
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    const pending = state.pendingMessages.find((message) => message.id === messageId)
    if (!pending || state.pendingMessages.at(-1)?.id !== messageId) {
      throw new Error('Copilot can only remove the most recently queued message.')
    }
    const result = await state.session!.rpc.queue.removeMostRecent()
    if (!result.removed) throw new Error('The queued message is no longer pending.')
    await this.refreshPendingMessages(state)
    return this.createChatDetail(state)
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId, options)
    const pending = state.pendingMessages.find((item) => item.id === messageId)
    if (!pending || state.pendingMessages.at(-1)?.id !== messageId) {
      throw new Error('Copilot can only edit the most recently queued message.')
    }
    const result = await state.session!.rpc.queue.removeMostRecent()
    if (!result.removed) throw new Error('The queued message is no longer pending.')
    await state.session!.send(
      getMessageOptions(message, options, pending.kind === 'steering' ? 'immediate' : 'enqueue')
    )
    await this.refreshPendingMessages(state)
    return this.createChatDetail(state)
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    const pending = state.pendingMessages.find((item) => item.id === messageId)
    if (!pending || state.pendingMessages.at(-1)?.id !== messageId) {
      throw new Error('Copilot can only promote the most recently queued message.')
    }
    const result = await state.session!.rpc.queue.removeMostRecent()
    if (!result.removed) throw new Error('The queued message is no longer pending.')
    await state.session!.send({
      prompt: pending.content,
      displayPrompt: pending.content,
      mode: 'immediate'
    })
    await this.refreshPendingMessages(state)
    return this.createChatDetail(state)
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
    await this.loadEvents(state)

    const target = state.events.find(
      (event): event is Extract<SessionEvent, { type: 'user.message' }> =>
        event.type === 'user.message' && !event.agentId && event.id === messageId
    )
    if (!target) throw new Error('Message cannot be edited')

    state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
    if (state.active) await state.session!.abort()
    await state.session!.rpc.queue.clear()
    state.pendingMessages = []

    await this.applyTurnOptions(state, options)
    const result = await state.session!.rpc.history.truncate({ eventId: target.id })
    if (result.eventsRemoved < 1) throw new Error('Message cannot be edited')

    state.events = []
    state.eventIds.clear()
    state.title = null
    state.active = true
    state.stopped = false
    state.failed = false
    state.metadata =
      (await state.client?.getSessionMetadata(chatId).catch(() => undefined)) ?? state.metadata
    await this.loadEvents(state)
    await this.refreshPendingMessages(state)
    this.emitUpdate(state)

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

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureSession(chatId)
    state.stopped = true
    state.active = false
    state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
    await state.session!.abort()
    await this.refreshPendingMessages(state)
    return this.createChatDetail(state)
  }

  writeAgentTerminalInput = async (): Promise<void> => {
    throw new Error('Copilot CLI does not expose agent terminal input through the SDK.')
  }

  resizeAgentTerminal = async (): Promise<void> => {
    throw new Error('Copilot CLI does not expose agent terminal resizing through the SDK.')
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
    this.updateTimers.forEach((timer) => clearTimeout(timer))
    this.updateTimers.clear()
    this.states.forEach((state) => {
      state.pendingPermissions.splice(0).forEach((pending) => pending.resolve({ kind: 'reject' }))
    })
    this.clientEntries.forEach((entry) => {
      void entry.client.stop()
    })
    this.clientEntries.clear()
    this.clientEntryPromises.clear()
    this.sessionContainers.clear()
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
      client: null,
      container: storedContainer,
      session: null,
      metadata: null,
      events: [],
      eventIds: new Set(),
      title: null,
      active: false,
      stopped: false,
      failed: false,
      options,
      pendingMessages: [],
      pendingPermissions: []
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

  private createSession = async (
    state: CopilotSessionState,
    options?: ProviderTurnOptions | ProviderOneShotOptions
  ): Promise<CopilotSession> => {
    const client = await this.ensureClient(state.container)
    state.client = client
    const session = await client.createSession({
      sessionId: state.id,
      clientName: 'Sele',
      workingDirectory: options?.cwd,
      model: options?.model,
      reasoningEffort: normalizeReasoningEffort(options?.reasoningEffort),
      streaming: false,
      enableConfigDiscovery: true,
      enableSkills: true,
      onEvent: (event) => this.handleEvent(state.id, event),
      onPermissionRequest: (request) => this.handlePermission(state.id, request)
    })
    state.session = session
    state.metadata = (await client.getSessionMetadata(state.id).catch(() => undefined)) ?? null
    await this.loadEvents(state)
    return session
  }

  private ensureSession = async (
    sessionId: string,
    options?: ProviderTurnOptions,
    container: AppContainerTarget | null = this.getSessionContainer(sessionId, options)
  ): Promise<CopilotSessionState> => {
    const state = this.createState(sessionId, options, container)
    const client = await this.ensureClient(state.container)
    state.client = client
    if (options) state.options = options
    if (state.session) return state

    state.metadata = (await client.getSessionMetadata(sessionId).catch(() => undefined)) ?? null
    if (!state.metadata) throw new Error(`Copilot session was not found: ${sessionId}`)

    state.session = await client.resumeSession(sessionId, {
      clientName: 'Sele',
      workingDirectory: options?.cwd ?? state.metadata.context?.workingDirectory,
      model: options?.model,
      reasoningEffort: normalizeReasoningEffort(options?.reasoningEffort),
      streaming: false,
      enableConfigDiscovery: true,
      enableSkills: true,
      suppressResumeEvent: true,
      onEvent: (event) => this.handleEvent(sessionId, event),
      onPermissionRequest: (request) => this.handlePermission(sessionId, request)
    })
    await this.loadEvents(state)
    await this.refreshPendingMessages(state)
    return state
  }

  private applyTurnOptions = async (
    state: CopilotSessionState,
    options?: ProviderTurnOptions
  ): Promise<void> => {
    if (!options || !state.session) return
    state.options = options
    await state.session.setModel(options.model, {
      reasoningEffort: normalizeReasoningEffort(options.reasoningEffort)
    })
  }

  private loadEvents = async (state: CopilotSessionState): Promise<void> => {
    if (!state.session) return
    const events = await state.session.getEvents()
    events.forEach((event) => this.storeEvent(state, event))
    state.events.sort(
      (first, second) => toMilliseconds(first.timestamp) - toMilliseconds(second.timestamp)
    )
  }

  private storeEvent = (state: CopilotSessionState, event: SessionEvent): void => {
    if (state.eventIds.has(event.id)) return
    state.eventIds.add(event.id)
    state.events.push(event)
  }

  private handleEvent = (sessionId: string, event: SessionEvent): void => {
    const state = this.createState(sessionId)
    this.storeEvent(state, event)

    if (event.type === 'session.title_changed') state.title = event.data.title
    if (
      event.type === 'user.message' ||
      event.type === 'assistant.turn_start' ||
      event.type === 'tool.execution_start'
    ) {
      state.active = true
      state.stopped = false
      state.failed = false
    }
    if (event.type === 'session.error') state.failed = true
    if (event.type === 'abort') {
      state.active = false
      state.stopped = true
    }
    if (event.type === 'session.idle') {
      state.active = false
      state.stopped = Boolean(event.data.aborted)
      this.emitUpdate(state, true)
      return
    }
    if (event.type === 'pending_messages.modified') {
      void this.refreshPendingMessages(state).then(() => this.emitUpdate(state))
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

  private refreshPendingMessages = async (state: CopilotSessionState): Promise<void> => {
    if (!state.session) return
    const result = await state.session.rpc.queue.pendingItems()
    const previous = [...state.pendingMessages]
    const takeId = (kind: ProviderPendingMessage['kind'], content: string): string => {
      const index = previous.findIndex(
        (message) => message.kind === kind && message.content === content
      )
      if (index < 0) return randomUUID()
      return previous.splice(index, 1)[0]!.id
    }

    state.pendingMessages = [
      ...result.items
        .filter((item) => item.kind === 'message')
        .map((item): ProviderPendingMessage => ({
          type: 'pendingMessage',
          id: takeId('queued', item.displayText),
          kind: 'queued',
          content: item.displayText
        })),
      ...result.steeringMessages.map((message): ProviderPendingMessage => ({
        type: 'pendingMessage',
        id: takeId('steering', message),
        kind: 'steering',
        content: message
      }))
    ]
  }

  private queueUpdate = (state: CopilotSessionState): void => {
    if (this.updateTimers.has(state.id)) return
    const timer = setTimeout(() => {
      this.updateTimers.delete(state.id)
      this.emitUpdate(state)
    }, 35)
    this.updateTimers.set(state.id, timer)
  }

  private emitUpdate = (state: CopilotSessionState, turnCompleted = false): void => {
    const timer = this.updateTimers.get(state.id)
    if (timer) {
      clearTimeout(timer)
      this.updateTimers.delete(state.id)
    }
    const detail = this.createChatDetail(state)
    this.chatUpdatedListeners.forEach((listener) => listener(detail, { turnCompleted }))
  }

  private getTitle = (state: CopilotSessionState): string => {
    if (state.title?.trim()) return state.title.trim()
    if (state.metadata?.summary?.trim()) return truncate(state.metadata.summary, 80)
    const firstUserMessage = state.events.find(
      (event): event is Extract<SessionEvent, { type: 'user.message' }> =>
        event.type === 'user.message' && !event.agentId
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

  private createChatDetail = (state: CopilotSessionState): ProviderChatDetail => ({
    id: state.id,
    title: this.getTitle(state),
    cwd: this.getCwd(state),
    cwdKind: 'directory',
    projectCwd: null,
    branchName: null,
    worktreeBaseBranchName: null,
    status: state.pendingPermissions.length
      ? 'waitingOnApproval'
      : state.failed
        ? 'error'
        : state.active
          ? 'active'
          : null,
    pinned: false,
    done: false,
    seenUpdatedAt: null,
    purpose: null,
    container: state.container,
    capabilities: {
      editMessages: true,
      activeMessages: true
    },
    pendingApproval: this.getPendingApproval(state),
    contextUsage: getContextUsage(state.events),
    items: renderCopilotChatItems(state.events, {
      active: state.active,
      stopped: state.stopped,
      pendingItems: state.pendingMessages
    })
  })

  private createChatFromMetadata = (
    metadata: SessionMetadata,
    container?: AppContainerTarget | null
  ): ProviderChat => {
    const state = this.states.get(metadata.sessionId)
    const detail = state ? this.createChatDetail(state) : null
    if (!state && container !== undefined) this.sessionContainers.set(metadata.sessionId, container)
    const preview =
      detail?.items.findLast((item) => item.type === 'message')?.content ?? metadata.summary ?? ''

    return {
      id: metadata.sessionId,
      providerId: this.id,
      title: detail?.title ?? truncate(metadata.summary ?? 'Copilot session', 80),
      preview: truncate(preview, 500),
      cwd: detail?.cwd ?? metadata.context?.workingDirectory ?? null,
      cwdKind: 'directory',
      projectCwd: null,
      branchName: metadata.context?.branch ?? null,
      worktreeBaseBranchName: null,
      createdAt: toMilliseconds(metadata.startTime),
      updatedAt: toMilliseconds(metadata.modifiedTime),
      status: detail?.status ?? null,
      pendingApproval: detail?.pendingApproval ?? null,
      pinned: false,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container:
        detail?.container ?? this.sessionContainers.get(metadata.sessionId) ?? container ?? null
    }
  }
}
