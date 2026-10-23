import { PendingMessageEdits } from '../PendingMessageEdits'
import { PersistentPendingMessages } from '../PersistentPendingMessages'
import { sqlitePendingMessageBackend } from '../../database/pendingMessages'
import { readOpenCodeCredentialTypes } from './OpenCodeConnectionStorage'
import { encodeOpenCodeHistory, importOpenCodeHistory } from './OpenCodeHistoryImport'
import { forEachOpenCodeHistoryMessage, loadOpenCodeMessages } from './OpenCodeHistory'
import {
  raceLinkedChatCancellation,
  requireLinkedChatSummary,
  throwIfLinkedChatCancelled
} from '../linkedChatContext'
import { OpenCodeCredentialHealth, checkOpenCodeCredential } from './OpenCodeCredentialHealth'
import type {
  ProviderConnectInput,
  ProviderConnection,
  ProviderConnectionAttempt,
  ProviderConnectionAttemptStatus,
  ProviderConnectionStatus
} from '../../../shared/providerConnections'
import {
  listOpenCodeConnections,
  connectOpenCode,
  getOpenCodeConnectionAttempt,
  completeOpenCodeConnection,
  cancelOpenCodeConnection,
  deleteOpenCodeConnection
} from './OpenCodeConnections'
import { TokenUsageReporter } from '../TokenUsageReporter.ts'
import { normalizeTokenUsage } from '../../../shared/tokenUsage.ts'
import { setNativeModelPricing } from '../modelPricing/TokenPricing'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  GlobalSession,
  OpencodeClient,
  PermissionRequest,
  QuestionRequest,
  Session
} from '@opencode-ai/sdk/v2'
import type { AppContainerTarget } from '../../../shared/app'
import {
  fallbackOpenCodeModels,
  providerOneShotGenerationCanceledMessage,
  type ProviderAccountUsage,
  type ProviderActiveSendMode,
  type ProviderApprovalDecision,
  type ProviderApprovalModeOption,
  type ProviderApp,
  type ProviderChat,
  type ProviderChatContextUsage,
  type ProviderChatDetail,
  type ProviderChatListOptions,
  type ProviderChatPage,
  type ProviderLoginResult,
  type ProviderModel,
  type ProviderOneShotOptions,
  type ProviderPendingApproval,
  type ProviderPendingMessage,
  type ProviderPendingUserInput,
  type ProviderPermissionOptions,
  type ProviderResourceUpdateOptions,
  type ProviderSandboxModeOption,
  type ProviderSkill,
  type ProviderSourceOptions,
  type ProviderSubagent,
  type ProviderSubagentDetail,
  type ProviderTokenUsageBreakdown,
  type ProviderTurnOptions,
  type ProviderUpdateAvailability,
  type ProviderUsageOptions,
  type ProviderUserInputResponse
} from '../../../shared/provider'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget'
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
import {
  getOpenCodeErrorMessage,
  getOpenCodeTurnOutcome,
  isOpenCodeAbortError,
  getOpenCodeDisplayTitle,
  renderOpenCodeChatItems,
  renderOpenCodeChatWindow,
  findOpenCodeItemTurnWindow,
  type OpenCodeMessageWithParts
} from './OpenCodeItemRenderers'
import {
  extractOpenCodeApiKeys,
  getOpenCodeAuthStore,
  getOpenCodeGoRateLimits,
  isLocalOpenCodeTarget,
  OpenCodeGoApiKeyMissingError,
  OpenCodeGoNoSubscriptionError
} from './OpenCodeUsage'
import { OpenCodeFreeLimitTracker } from './OpenCodeFreeLimit'
import { getOpenCodeUsageLimitMessage } from './OpenCodeUsageLimit'
import {
  getOpenCodeEnvironmentApiKeys,
  OpenCodeBalanceCache,
  selectOpenCodeBalanceKeys,
  verifyOpenCodeAdminKey
} from './OpenCodeBalances'
import {
  createOpenCodeAdminKeyStore,
  getOpenCodeAdminConnectionId,
  isOpenCodeAdminKey,
  openCodeAdminKeyMethodId,
  openCodeAdminKeyProviders,
  parseOpenCodeAdminConnectionId,
  supportsOpenCodeAdminKey
} from './OpenCodeAdminKeys'
import { mapOpenCodeModels, parseOpenCodeModelId } from './OpenCodeModels'
import {
  generateOpenCodeChatTitle,
  isDefaultOpenCodeTitle,
  selectOpenCodeTitleModels
} from './OpenCodeChatTitle.ts'
import { getOpenCodePermissionRules } from './OpenCodePermissions'
import { OpenCodeServerClient } from './OpenCodeServerClient'
import { createOpenCodeTerminalTasks } from './OpenCodeTerminalTasks'
import { getOpenCodeUpdateAvailability, updateOpenCodeProvider } from './OpenCodeProviderUpdate'
import {
  applyOpenCodeMessageEvent,
  parseOpenCodeSessionEvent,
  reconcileOpenCodeMessageSnapshot
} from './OpenCodeEvents'
import {
  createOpenCodeSubagentSummary,
  getOpenCodeSubagentPromptSettings,
  isOpenCodeChildState,
  isOpenCodeSubagentSession
} from './OpenCodeSubagents'
import type { BrowserMcpIntegration } from '../../browser/BrowserMcpServer'

type OpenCodeClientEntry = {
  server: OpenCodeServerClient
  client: OpencodeClient
  container: AppContainerTarget | null
  eventAbortController: AbortController
  terminalTasks: ReturnType<typeof createOpenCodeTerminalTasks>
}

type QueuedOpenCodeMessage = ProviderPendingMessage & {
  options?: ProviderTurnOptions
}

type OpenCodeChatState = {
  browser: BrowserMcpIntegration | null
  browserGeneration: number
  id: string
  revision: number
  directory: string
  container: AppContainerTarget | null
  session: Session | GlobalSession | null
  fallbackTitle?: string
  messages: OpenCodeMessageWithParts[]
  messagesHydrated: boolean
  messagesDirty: boolean
  hydratedUpdatedAt: number | null
  eventRevision: number
  historyInvalidationRevision?: number
  client: OpencodeClient | null
  active: boolean
  stopped: boolean
  failed: boolean
  failureMessage: string | null
  usageLimitReached: boolean
  pendingApprovals: PermissionRequest[]
  pendingQuestions: QuestionRequest[]
  queuedMessages: QueuedOpenCodeMessage[]
  /** Messages restored after a restart wait until the user sends again, as after Stop. */
  queuePaused: boolean
}

type OpenCodeOneShotGeneration = {
  client: OpencodeClient | null
  sessionId: string | null
  directory: string | null
  canceled: boolean
}

type OpenCodeModelRuntime = {
  variants?: Record<string, unknown>
  limit: { context: number }
}

const openCodeApprovalModes: ProviderApprovalModeOption[] = [
  {
    id: 'ask-user',
    label: 'Ask me',
    description: 'Ask before OpenCode edits files or runs commands.',
    isDefault: true
  },
  {
    id: 'never',
    label: 'Never ask',
    description: 'Run permitted OpenCode actions without approval prompts.',
    isDefault: false
  }
]

const openCodeSandboxModes: ProviderSandboxModeOption[] = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Allow inspection while denying commands, edits, and subagents.',
    isDefault: false
  },
  {
    id: 'workspace-write',
    label: 'Workspace write',
    description: 'Allow actions in the project and explicitly added directories.',
    isDefault: true
  },
  {
    id: 'danger-full-access',
    label: 'Full access',
    description: 'Allow OpenCode to access paths outside the project.',
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
const oneShotCancellationRetentionMs = 60_000
const maxPreviewLength = 500

const requireData = <T>(result: { data: T }): T => result.data

/** The summary is the newest assistant record; a bounded tail avoids rereading long histories. */
const linkedChatSummaryTailLimit = 20
const linkedChatSummaryPollMs = 1_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const normalizeStoredContainer = (
  container: AppContainerTarget | null | undefined
): AppContainerTarget | null => {
  const normalized = normalizeContainerTarget(container)
  return normalized.kind === 'container' ? normalized : null
}

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

const isOneShotSession = (session: Session | GlobalSession): boolean => {
  const seleMetadata = isRecord(session.metadata?.sele) ? session.metadata.sele : null
  return seleMetadata?.purpose === 'oneShot'
}

const getSkillScope = (path: string, cwd?: string | null): ProviderSkill['scope'] => {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedCwd = cwd?.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedCwd && normalizedPath.startsWith(`${normalizedCwd}/`) ? 'repo' : 'user'
}

const getMimeType = (path: string): string => {
  switch (extname(path).toLocaleLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.pdf':
      return 'application/pdf'
    case '.json':
      return 'application/json'
    default:
      return 'text/plain'
  }
}

const createPromptParts = async (
  message: string,
  options?: ProviderTurnOptions | ProviderOneShotOptions
): Promise<
  Array<
    { type: 'text'; text: string } | { type: 'file'; mime: string; filename: string; url: string }
  >
> => {
  const text = message.trim()
  const files = options?.files ?? []
  const images = options?.images ?? []
  const imageParts = await Promise.all(
    images.map(async (image) => {
      const mime = getMimeType(image.path)
      const data = await readFile(image.path)
      return {
        type: 'file' as const,
        mime,
        filename: basename(image.path),
        url: `data:${mime};base64,${data.toString('base64')}`
      }
    })
  )

  return [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...files.map((file) => ({
      type: 'file' as const,
      mime: getMimeType(file.path),
      filename: basename(file.path),
      url: pathToFileURL(file.path).href
    })),
    ...imageParts
  ]
}

const getSelectedSkillsSystemPrompt = (
  options?: ProviderTurnOptions | ProviderOneShotOptions
): string | undefined => {
  const skills = options?.skills ?? []
  if (skills.length === 0) return undefined
  return `Before proceeding, load and follow these explicitly selected skills with the skill tool: ${skills
    .map((skill) => skill.name)
    .join(', ')}.`
}

const getTokenBreakdown = (
  message: OpenCodeMessageWithParts | undefined
): ProviderTokenUsageBreakdown => {
  if (message?.info.role !== 'assistant') {
    return {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0
    }
  }
  const tokens = message.info.tokens
  const cachedInputTokens = tokens.cache.read
  return {
    totalTokens: tokens.input + tokens.output + tokens.reasoning + cachedInputTokens,
    inputTokens: tokens.input,
    cachedInputTokens,
    outputTokens: tokens.output,
    reasoningOutputTokens: tokens.reasoning
  }
}

const sumBreakdowns = (breakdowns: ProviderTokenUsageBreakdown[]): ProviderTokenUsageBreakdown =>
  breakdowns.reduce(
    (total, value) => ({
      totalTokens: total.totalTokens + value.totalTokens,
      inputTokens: total.inputTokens + value.inputTokens,
      cachedInputTokens: total.cachedInputTokens + value.cachedInputTokens,
      outputTokens: total.outputTokens + value.outputTokens,
      reasoningOutputTokens: total.reasoningOutputTokens + value.reasoningOutputTokens
    }),
    {
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0
    }
  )

const getMessagePreview = (messages: OpenCodeMessageWithParts[]): string => {
  const items = renderOpenCodeChatItems(messages.slice(-8), { active: false, stopped: false })
  return truncate(
    items.findLast((item) => item.type === 'message')?.content ?? '',
    maxPreviewLength
  )
}

const getPendingApproval = (
  request: PermissionRequest | undefined,
  cwd: string
): ProviderPendingApproval | null => {
  if (!request) return null
  const metadata = request.metadata
  const command =
    getString(metadata.command) ??
    getString(metadata.cmd) ??
    (request.permission === 'bash' ? request.patterns.join(' ') : null)
  const path = getString(metadata.path) ?? getString(metadata.file)
  return {
    id: request.id,
    type: request.permission === 'edit' ? 'fileChange' : 'command',
    command: command ?? path,
    cwd,
    reason:
      getString(metadata.description) ??
      getString(metadata.reason) ??
      getString(metadata.title) ??
      `OpenCode requested ${request.permission} permission.`,
    startedAt: Date.now()
  }
}

const getPendingUserInput = (
  request: QuestionRequest | undefined
): ProviderPendingUserInput | null => {
  const question = request?.questions[0]
  if (!request || !question) return null
  return {
    id: request.id,
    question: question.question,
    choices: question.options.map((option) => ({
      label: option.label,
      description: option.description.trim() || null
    })),
    allowFreeform: question.custom ?? true,
    startedAt: Date.now()
  }
}

export class OpenCodeProviderAdapter implements ProviderAdapter {
  id = 'opencode' as const
  private pendingMessageEdits = new PendingMessageEdits()
  private pendingMessageStore = new PersistentPendingMessages<QueuedOpenCodeMessage>(
    'opencode',
    sqlitePendingMessageBackend
  )
  private queueDrains = new Set<string>()
  private tokenUsageReporter = new TokenUsageReporter()
  onTokenUsage = this.tokenUsageReporter.subscribe

  private clientEntries = new Map<string, OpenCodeClientEntry>()
  private clientEntryPromises = new Map<string, Promise<OpenCodeClientEntry>>()
  private states = new Map<string, OpenCodeChatState>()
  private sessionDiscoveries = new Map<string, Promise<OpenCodeChatState>>()
  private refreshes = new WeakMap<OpenCodeChatState, Promise<void>>()
  private stateChecks = new WeakMap<OpenCodeChatState, Promise<void>>()
  private sessionContainers = new Map<string, AppContainerTarget | null>()
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private completionCoordinator = new ProviderConversationCompletionCoordinator()
  private modelContextLimits = new Map<string, number>()
  private titleGenerations = new WeakSet<OpenCodeChatState>()
  private manualTitles = new WeakSet<OpenCodeChatState>()
  private titleWrites = new WeakMap<OpenCodeChatState, Promise<void>>()
  private oneShotGenerations = new Map<string, OpenCodeOneShotGeneration>()
  private oneShotSessionIds = new Set<string>()
  private canceledOneShotGenerationIds = new Set<string>()
  private canceledOneShotGenerationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private credentialHealth = new OpenCodeCredentialHealth()
  private connectionAttemptProviders = new Map<string, string>()
  private connectionChecks = new Map<string, Promise<ProviderConnectionStatus>>()
  private adminKeys = createOpenCodeAdminKeyStore()
  private adminKeyStatuses = new Map<string, ProviderConnectionStatus>()
  private balanceCache = new OpenCodeBalanceCache(fetch, Date.now, async (models) => {
    const { resolveModelPricing } = await import('../modelPricing/ModelsDevPricing')
    return resolveModelPricing(models)
  })
  private freeLimits = new OpenCodeFreeLimitTracker()

  /** `forceRefresh` (the Refresh button) tests every listed connection with a real request. */
  getConnections = async (options: ProviderSourceOptions = {}): Promise<ProviderConnection[]> => {
    const targetKey = getContainerTargetKey(options.container)
    const list = (): Promise<ProviderConnection[]> =>
      listOpenCodeConnections(
        client,
        () => readOpenCodeCredentialTypes(options.container),
        (providerId) => this.credentialHealth.get(targetKey, providerId)
      )
    const client = (await this.getClientEntry(options.container)).client
    const providers = await list()
    if (!options.forceRefresh) return this.withAdminKeyConnections(providers, false)
    await Promise.all(
      providers
        .filter((provider) => provider.connections.length > 0)
        .map((provider) => this.checkConnection(provider.id, options))
    )
    return this.withAdminKeyConnections(await list(), true)
  }

  /** Adds the usage-only admin key method and any saved admin keys to OpenCode's providers. */
  private withAdminKeyConnections = async (
    providers: ProviderConnection[],
    check: boolean
  ): Promise<ProviderConnection[]> => {
    let saved: Record<string, string> = {}
    try {
      saved = await this.adminKeys.list()
    } catch (error) {
      console.error('[OpenCodeProviderAdapter:withAdminKeyConnections]', error)
    }
    if (check) {
      await Promise.all(
        Object.entries(saved).map(async ([providerId, key]) => {
          try {
            await verifyOpenCodeAdminKey(providerId, key)
            this.adminKeyStatuses.set(providerId, { state: 'verified', checkedAt: Date.now() })
          } catch (error) {
            this.adminKeyStatuses.set(providerId, {
              state: 'failed',
              message: error instanceof Error ? error.message : 'Key check failed.',
              checkedAt: Date.now()
            })
          }
        })
      )
    }
    return providers.map((provider) => {
      if (!supportsOpenCodeAdminKey(provider.id)) return provider
      const adminMethod = openCodeAdminKeyProviders[provider.id]!
      const status = this.adminKeyStatuses.get(provider.id)
      return {
        ...provider,
        methods: [
          ...provider.methods,
          { type: 'key', id: openCodeAdminKeyMethodId, label: adminMethod.label }
        ],
        connections: saved[provider.id]
          ? [
              ...provider.connections,
              {
                type: 'credential',
                id: getOpenCodeAdminConnectionId(provider.id),
                label: adminMethod.label,
                usageOnly: true,
                // Saved keys are checked when added and on Refresh; unchecked ones show no status.
                ...(status ? { status } : {})
              }
            ]
          : provider.connections
      }
    })
  }

  /** Saves the credential, then tests it so the result reflects what the provider says. */
  connectProvider = async (
    input: ProviderConnectInput,
    options: ProviderSourceOptions = {}
  ): Promise<ProviderConnectionAttempt | null> => {
    if (
      input.method === 'key' &&
      input.key &&
      (input.methodId === openCodeAdminKeyMethodId ||
        isOpenCodeAdminKey(input.integrationId, input.key))
    ) {
      // Admin keys cannot run models, so they never go to OpenCode.
      if (!supportsOpenCodeAdminKey(input.integrationId))
        throw new Error('This provider does not support admin keys.')
      await verifyOpenCodeAdminKey(input.integrationId, input.key)
      await this.adminKeys.set(input.integrationId, input.key)
      this.adminKeyStatuses.set(input.integrationId, { state: 'verified', checkedAt: Date.now() })
      this.balanceCache.clear()
      return null
    }
    const result = await connectOpenCode(
      (await this.getClientEntry(options.container)).client,
      input
    )
    this.balanceCache.clear()
    if (result) this.connectionAttemptProviders.set(result.attemptId, input.integrationId)
    else await this.checkConnection(input.integrationId, options)
    return result
  }

  getConnectionAttempt = async (
    attemptId: string,
    options: ProviderSourceOptions = {}
  ): Promise<ProviderConnectionAttemptStatus> => {
    const status = await getOpenCodeConnectionAttempt(
      (await this.getClientEntry(options.container)).client,
      attemptId
    )
    if (status.status !== 'pending') await this.finishConnectionAttempt(attemptId, status, options)
    return status
  }

  completeConnection = async (
    attemptId: string,
    code: string,
    options: ProviderSourceOptions = {}
  ): Promise<void> => {
    await completeOpenCodeConnection(
      (await this.getClientEntry(options.container)).client,
      attemptId,
      code
    )
    await this.finishConnectionAttempt(attemptId, { status: 'complete' }, options)
  }

  private finishConnectionAttempt = async (
    attemptId: string,
    status: ProviderConnectionAttemptStatus,
    options: ProviderSourceOptions
  ): Promise<void> => {
    const providerId = this.connectionAttemptProviders.get(attemptId)
    this.connectionAttemptProviders.delete(attemptId)
    if (providerId && status.status === 'complete') await this.checkConnection(providerId, options)
  }

  private checkConnection = (
    providerId: string,
    options: ProviderSourceOptions
  ): Promise<ProviderConnectionStatus> => {
    const targetKey = getContainerTargetKey(options.container)
    const key = `${targetKey}\0${providerId}`
    const running = this.connectionChecks.get(key)
    if (running) return running
    const check = (async () => {
      const entry = await this.getClientEntry(options.container)
      const status = await checkOpenCodeCredential({
        client: entry.client,
        directory: homedir(),
        providerId,
        onSession: (sessionId) => this.oneShotSessionIds.add(sessionId)
      })
      this.credentialHealth.set(targetKey, providerId, status)
      return status
    })().finally(() => this.connectionChecks.delete(key))
    this.connectionChecks.set(key, check)
    return check
  }

  cancelConnection = async (
    attemptId: string,
    options: ProviderSourceOptions = {}
  ): Promise<void> => {
    this.connectionAttemptProviders.delete(attemptId)
    await cancelOpenCodeConnection((await this.getClientEntry(options.container)).client, attemptId)
  }

  deleteConnection = async (
    credentialId: string,
    options: ProviderSourceOptions = {}
  ): Promise<void> => {
    this.balanceCache.clear()
    const adminProviderId = parseOpenCodeAdminConnectionId(credentialId)
    if (adminProviderId) {
      await this.adminKeys.remove(adminProviderId)
      this.adminKeyStatuses.delete(adminProviderId)
      return
    }
    await deleteOpenCodeConnection(
      (await this.getClientEntry(options.container)).client,
      credentialId
    )
    this.credentialHealth.clear(getContainerTargetKey(options.container), credentialId)
  }

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult> => {
    const client = (await this.getClientEntry(options.container)).client
    const providers = requireData(await client.provider.list({}, { throwOnError: true }))
    const connectedNames = providers.all
      .filter((provider) => providers.connected.includes(provider.id))
      .map((provider) => provider.name)
    if (connectedNames.length === 0) {
      throw new Error(
        'OpenCode has no connected model providers. Add a connection in Settings → Providers → OpenCode → Connections.'
      )
    }
    return {
      status: 'authenticated',
      account: { label: connectedNames.join(', ') }
    }
  }

  getUpdateAvailability = async (
    options: ProviderSourceOptions = {}
  ): Promise<ProviderUpdateAvailability | null> =>
    getOpenCodeUpdateAvailability({ container: options.container, env: process.env })

  updateProvider = async (
    options: ProviderSourceOptions = {}
  ): Promise<ProviderUpdateAvailability | null> => {
    await this.disposeClients()
    return updateOpenCodeProvider({ container: options.container, env: process.env })
  }

  getApprovalModes = async (): Promise<ProviderApprovalModeOption[]> => openCodeApprovalModes

  getSandboxModes = async (): Promise<ProviderSandboxModeOption[]> => openCodeSandboxModes

  getModels = async (options: ProviderSourceOptions = {}): Promise<ProviderModel[]> => {
    try {
      const client = (await this.getClientEntry(options.container)).client
      const [providerResult, configResult] = await Promise.all([
        client.config.providers({}, { throwOnError: true }),
        client.config.get({}, { throwOnError: true })
      ])
      const catalog = requireData(providerResult)
      const config = requireData(configResult)
      catalog.providers.forEach((provider) => {
        Object.values(provider.models).forEach((modelValue) => {
          const model = modelValue as OpenCodeModelRuntime
          this.modelContextLimits.set(`${provider.id}/${modelValue.id}`, model.limit.context)
          setNativeModelPricing(
            `opencode:${getContainerTargetKey(options.container)}:${provider.id}/${modelValue.id}`,
            {
              input: modelValue.cost.input,
              output: modelValue.cost.output,
              cacheRead: modelValue.cost.cache.read,
              cacheWrite: modelValue.cost.cache.write,
              tiers: modelValue.cost.tiers?.map((tier) => ({
                input: tier.input,
                output: tier.output,
                cacheRead: tier.cache.read,
                cacheWrite: tier.cache.write,
                contextAbove: tier.tier.size
              }))
            }
          )
        })
      })
      const models = mapOpenCodeModels(catalog.providers, catalog.default, config.model)
      if (models.length === 0) throw new Error('OpenCode returned no available models.')
      return models
    } catch (error) {
      console.error('[OpenCodeProviderAdapter:getModels] Unable to load models', error)
      throw error
    }
  }

  getSkills = async (
    cwd?: string | null,
    options: ProviderSourceOptions = {}
  ): Promise<ProviderSkill[]> => {
    const [entry, disabledSkills] = await Promise.all([
      this.getClientEntry(options.container),
      listDisabledProviderSkills('opencode', options.container)
    ])
    const discovered = requireData(
      await entry.client.app.skills(cwd ? { directory: cwd } : {}, { throwOnError: true })
    ).map(
      (skill): ProviderSkill => ({
        name: skill.name,
        description: skill.description ?? '',
        shortDescription: skill.description?.trim() || null,
        displayName: null,
        path: skill.location,
        scope: getSkillScope(skill.location, cwd),
        enabled: true
      })
    )
    return mergeProviderSkills(discovered, disabledSkills)
  }

  setSkillEnabled = async (
    path: string,
    enabled: boolean,
    cwd?: string | null,
    options: ProviderResourceUpdateOptions = {}
  ): Promise<ProviderSkill[]> => this.setSkillsEnabledInternal([path], enabled, cwd, options, false)

  setSkillsEnabled = async (
    paths: string[],
    enabled: boolean,
    cwd?: string | null,
    options: ProviderResourceUpdateOptions = {}
  ): Promise<ProviderSkill[]> => this.setSkillsEnabledInternal(paths, enabled, cwd, options, true)

  private setSkillsEnabledInternal = async (
    paths: string[],
    enabled: boolean,
    cwd: string | null | undefined,
    options: ProviderResourceUpdateOptions,
    toleratePartialFailure: boolean
  ): Promise<ProviderSkill[]> => {
    const requestedPaths = new Set(paths)
    const knownSkills = options.knownSkills?.filter((skill) => requestedPaths.has(skill.path))
    const skills =
      options.deferRefresh && knownSkills?.length === requestedPaths.size
        ? knownSkills
        : await this.getSkills(cwd, options)
    const skillsByPath = new Map(skills.map((skill) => [skill.path, skill]))
    const requestedSkills = paths.map((path) => {
      const skill = skillsByPath.get(path)
      if (!skill) throw new Error('Skill is not available in this environment')
      return skill
    })
    const changedSkills = requestedSkills.filter((skill) => skill.enabled !== enabled)
    if (changedSkills.length === 0) return skills

    const updateSkill = async (skill: ProviderSkill): Promise<void> => {
      if (!enabled) await disableProviderSkill('opencode', skill, options.container)
      else if (!(await restoreProviderSkill(skill.path, options.container))) {
        throw new Error('Skill was not disabled by Sele')
      }
    }
    const results = await Promise.allSettled(changedSkills.map(updateSkill))
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(
          `[OpenCodeProviderAdapter:setSkillsEnabledInternal] Unable to update skill ${changedSkills[index]?.path ?? 'unknown'}`,
          result.reason
        )
      }
    })
    const failure = results.find((result) => result.status === 'rejected')
    if (!toleratePartialFailure && failure?.status === 'rejected') throw failure.reason
    if (options.deferRefresh) {
      return requestedSkills.map((skill, index) =>
        results[index]?.status === 'rejected' ? skill : { ...skill, enabled }
      )
    }
    return this.getSkills(cwd, options)
  }

  getApps = async (): Promise<ProviderApp[]> => []

  setAppEnabled = async (): Promise<ProviderApp[]> => {
    throw new Error('OpenCode does not expose connected apps through its server API.')
  }

  getUsage = async (options: ProviderUsageOptions = {}): Promise<ProviderAccountUsage> => {
    const includeStatistics = Boolean(options.includeStatistics)
    const authStore = getOpenCodeAuthStore(options.container)
    // Keep the Go lookup's missing-key handling when the auth store cannot be read.
    const goStore = authStore.catch(() => undefined)
    const [rateLimitsResult, statisticsResult, balancesResult] = await Promise.allSettled([
      goStore.then((store) => getOpenCodeGoRateLimits(options.container, fetch, store)),
      includeStatistics
        ? (async (): Promise<{ lifetimeTokens: string }> => {
            const client = (await this.getClientEntry(options.container)).client
            const sessions = requireData(
              await client.experimental.session.list({ limit: 1_000 }, { throwOnError: true })
            )
            const lifetimeTokens = sessions.reduce(
              (sum, session) =>
                sum +
                (session.tokens?.input ?? 0) +
                (session.tokens?.output ?? 0) +
                (session.tokens?.reasoning ?? 0) +
                (session.tokens?.cache.read ?? 0),
              0
            )
            return { lifetimeTokens: lifetimeTokens.toLocaleString() }
          })()
        : Promise.resolve<{ lifetimeTokens: string } | null>(null),
      (async () => {
        const [store, adminKeys, local] = await Promise.all([
          authStore.catch(() => null),
          this.adminKeys.list().catch((error: unknown) => {
            console.error('[OpenCodeProviderAdapter:getUsage] Unable to read admin keys', error)
            return {}
          }),
          isLocalOpenCodeTarget(options.container)
        ])
        // OpenCode prefers saved credentials over environment variables; match that order.
        const apiKeys = {
          ...(local ? getOpenCodeEnvironmentApiKeys(process.env) : {}),
          ...extractOpenCodeApiKeys(store)
        }
        return this.balanceCache.get(selectOpenCodeBalanceKeys(apiKeys, adminKeys), {
          forceRefresh: Boolean(options.forceRefresh)
        })
      })()
    ])

    const errors: string[] = []
    if (rateLimitsResult.status === 'rejected') {
      console.error(
        '[OpenCodeProviderAdapter:getUsage] Unable to load rate limits',
        rateLimitsResult.reason
      )
    }
    if (
      rateLimitsResult.status === 'rejected' &&
      !(rateLimitsResult.reason instanceof OpenCodeGoNoSubscriptionError) &&
      !(rateLimitsResult.reason instanceof OpenCodeGoApiKeyMissingError)
    ) {
      errors.push(
        rateLimitsResult.reason instanceof Error
          ? rateLimitsResult.reason.message
          : 'OpenCode Go usage is unavailable.'
      )
    }
    if (statisticsResult.status === 'rejected') {
      console.error(
        '[OpenCodeProviderAdapter:getUsage] Unable to load usage statistics',
        statisticsResult.reason
      )
      errors.push(
        statisticsResult.reason instanceof Error
          ? statisticsResult.reason.message
          : 'OpenCode usage is unavailable.'
      )
    }

    if (balancesResult.status === 'rejected') {
      console.error(
        '[OpenCodeProviderAdapter:getUsage] Unable to load balances',
        balancesResult.reason
      )
    } else errors.push(...balancesResult.value.errors)

    const statistics = statisticsResult.status === 'fulfilled' ? statisticsResult.value : null
    return {
      updatedAt: Date.now(),
      statisticsLoaded: includeStatistics && statisticsResult.status === 'fulfilled',
      summary: {
        ...emptyUsageSummary,
        lifetimeTokens: statistics?.lifetimeTokens ?? null
      },
      dailyUsageBuckets: null,
      rateLimits: [
        ...this.freeLimits.getRateLimits(getContainerTargetKey(options.container)),
        ...(rateLimitsResult.status === 'fulfilled' ? rateLimitsResult.value : [])
      ],
      rateLimitResetCredits: null,
      balances: balancesResult.status === 'fulfilled' ? balancesResult.value.balances : [],
      errors
    }
  }

  resetRateLimits = async (): Promise<'nothingToReset'> => 'nothingToReset'

  getChatTerminalTasks = async (chatId: string): Promise<string[]> => {
    const state = this.states.get(chatId)
    if (!state?.session) return []
    const session = state.session
    const entry = this.clientEntries.get(getContainerTargetKey(state.container))
    if (!entry) throw new Error('OpenCode terminal activity is unavailable.')
    return entry.terminalTasks.read(
      chatId,
      async () =>
        requireData(
          await entry.client.session.status({ directory: state.directory }, { throwOnError: true })
        )[chatId],
      async () => {
        const before = state.messages
        const messages = await this.loadMessages(entry.client, session, 8)
        return reconcileOpenCodeMessageSnapshot(before, state.messages, messages)
      }
    )
  }

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const entry = await this.getClientEntry(options.container)
    const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))
    const sessions = requireData(
      await entry.client.experimental.session.list(
        { cursor: offset, limit, roots: true },
        { throwOnError: true }
      )
    )
    const visibleSessions = sessions.filter((session) => !isOneShotSession(session))
    const statusesByDirectory = new Map(
      [...new Set(visibleSessions.map((session) => session.directory))].map((directory) => [
        directory,
        entry.client.session
          .status({ directory }, { throwOnError: true })
          .then(requireData)
          .catch((error) => {
            console.error('[caught:OpenCodeProviderAdapter:getChats:status]', error)
            return null
          })
      ])
    )
    const chats = await Promise.all(
      visibleSessions.map(async (session) => {
        const state = this.rememberSession(session, entry.container)
        const eventRevision = state.eventRevision
        // Default session names are displayed from the original prompt. A bounded
        // tail can omit it after restart, or substitute a later follow-up's text.
        const messages =
          state.messagesHydrated && !state.messagesDirty
            ? state.messages
            : await this.loadMessages(
                entry.client,
                session,
                isDefaultOpenCodeTitle(session.title) && !state.fallbackTitle ? undefined : 8
              ).catch((error) => {
                console.error('[caught:OpenCodeProviderAdapter:getChats]', error)
                return []
              })
        if (isDefaultOpenCodeTitle(session.title) && !state.fallbackTitle) {
          const title = getOpenCodeDisplayTitle(session.title, messages)
          if (title !== session.title) state.fallbackTitle = title
        }
        const statuses = await statusesByDirectory.get(session.directory)
        if (statuses && state.eventRevision === eventRevision) {
          const status = statuses[session.id]
          const limitMessage = getOpenCodeUsageLimitMessage('session.status', { status })
          if (limitMessage) this.failUsageLimitedTurn(state, entry.client, limitMessage)
          state.active =
            !state.usageLimitReached && (status?.type === 'busy' || status?.type === 'retry')
        }
        return this.createChat(session, messages.slice(-8), state)
      })
    )
    return {
      chats,
      nextCursor: sessions.length === limit ? String(offset + sessions.length) : null
    }
  }

  getChat = async (
    chatId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options.container)
    return this.createChatDetailFromState(state)
  }

  getChatWindow = async (
    chatId: string,
    window: ProviderChatTurnWindow,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options.container)
    return this.createChatDetailFromState(state, window)
  }

  getChatWindowForItem = async (
    chatId: string,
    itemId: string,
    limit: number,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options.container)
    const window = findOpenCodeItemTurnWindow(state.messages, itemId, limit)
    if (window) return this.createChatDetailFromState(state, window)
    // Some synthetic message IDs have no native record ID. Preserve that uncommon lookup.
    const detail = this.createChatDetailFromState(state)
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
    const state = await this.ensureState(chatId, options.container)
    const client = (await this.getClientEntry(state.container)).client
    const [sessions, statuses] = await Promise.all([
      this.loadSubagentSessions(client, state.session!),
      client.session
        .status({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch((error) => {
          console.error('[caught:OpenCodeProviderAdapter:getSubagents]', error)
          return {}
        })
    ])
    return sessions.map((session) =>
      createOpenCodeSubagentSummary(session, chatId, statuses[session.id])
    )
  }

  getSubagent = async (
    chatId: string,
    subagentId: string,
    options: { container?: AppContainerTarget | null } = {},
    window?: ProviderChatTurnWindow
  ): Promise<ProviderSubagentDetail> => {
    const rootState = await this.ensureState(chatId, options.container)
    const entry = await this.getClientEntry(rootState.container)
    const sessions = await this.loadSubagentSessions(entry.client, rootState.session!)
    const session = sessions.find((candidate) => candidate.id === subagentId)
    if (!session) throw new Error('OpenCode subagent was not found.')

    this.rememberSession(session, entry.container)
    const state = await this.ensureState(subagentId, entry.container)
    const detail = this.createChatDetailFromState(state, window)
    const summary = createOpenCodeSubagentSummary(
      state.session!,
      chatId,
      state.active ? { type: 'busy' } : undefined
    )
    return {
      ...summary,
      status: state.failed ? 'failed' : state.stopped ? 'stopped' : summary.status,
      items: detail.items,
      itemsStartTurnIndex: detail.itemsStartTurnIndex,
      turnCount: detail.turnCount
    }
  }

  cancelSubagent = async (
    chatId: string,
    subagentId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<void> => {
    const rootState = await this.ensureState(chatId, options.container)
    const entry = await this.getClientEntry(rootState.container)
    const sessions = await this.loadSubagentSessions(entry.client, rootState.session!)
    const session = sessions.find((candidate) => candidate.id === subagentId)
    if (!session) throw new Error('OpenCode subagent was not found.')

    await entry.client.session.abort(
      { sessionID: session.id, directory: session.directory },
      { throwOnError: true }
    )
    const state = this.states.get(session.id)
    if (state) {
      state.active = false
      state.stopped = true
    }
  }

  sendSubagentMessage = async (
    chatId: string,
    subagentId: string,
    message: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<void> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot send an empty OpenCode message.')
    const rootState = await this.ensureState(chatId, options.container)
    const entry = await this.getClientEntry(rootState.container)
    const sessions = await this.loadSubagentSessions(entry.client, rootState.session!)
    const session = sessions.find((candidate) => candidate.id === subagentId)
    if (!session) throw new Error('OpenCode subagent was not found.')

    this.rememberSession(session, entry.container)
    const state = await this.ensureState(subagentId, entry.container)
    state.active = true
    state.eventRevision += 1
    state.stopped = false
    state.failed = false
    state.failureMessage = null
    state.usageLimitReached = false
    // Unlike root sends, keep the child's own permissions: its task tool scoped them on creation.
    await entry.client.session.promptAsync(
      {
        sessionID: session.id,
        directory: session.directory,
        ...getOpenCodeSubagentPromptSettings(state.session ?? session, state.messages),
        parts: [{ type: 'text', text }]
      },
      { throwOnError: true }
    )
    this.scheduleUpdate(state.id)
    this.scheduleUpdate(chatId)
  }

  setChatTitle = async (chatId: string, title: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.manualTitles.add(state)
    // A manual rename must be the last write even if an automatic update is in flight.
    await this.titleWrites.get(state)
    const client = (await this.getClientEntry(state.container)).client
    state.session = requireData(
      await client.session.update(
        { sessionID: chatId, directory: state.directory, title },
        { throwOnError: true }
      )
    )
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  generateOneShot = async (message: string, options?: ProviderOneShotOptions): Promise<string> => {
    const generationId = options?.generationId ?? randomUUID()
    if (this.oneShotGenerations.has(generationId)) {
      throw new Error('Duplicate one-shot generation ID')
    }
    const generation: OpenCodeOneShotGeneration = {
      client: null,
      sessionId: null,
      directory: null,
      canceled: this.takeCanceledOneShotGeneration(generationId)
    }
    this.oneShotGenerations.set(generationId, generation)

    const throwIfCanceled = async (): Promise<void> => {
      if (!generation.canceled) return
      if (generation.client && generation.sessionId && generation.directory) {
        await generation.client.session
          .abort(
            { sessionID: generation.sessionId, directory: generation.directory },
            { throwOnError: true }
          )
          .catch((error) => {
            console.error('[caught:OpenCodeProviderAdapter:throwIfCanceled]', error)
          })
      }
      throw new Error(providerOneShotGenerationCanceledMessage)
    }

    try {
      await throwIfCanceled()
      const entry = await this.getClientEntry(options?.container)
      const directory = options?.cwd?.trim() || homedir()
      const model = parseOpenCodeModelId(options?.model ?? fallbackOpenCodeModels[0]!.id)
      generation.client = entry.client
      generation.directory = directory
      const session = requireData(
        await entry.client.session.create(
          {
            directory,
            title: 'Sele one-shot',
            model: {
              providerID: model.providerID,
              id: model.modelID,
              variant: options?.reasoningEffort
            },
            metadata: { sele: { purpose: 'oneShot' } },
            permission: getOpenCodePermissionRules(options)
          },
          { throwOnError: true }
        )
      )
      generation.sessionId = session.id
      this.oneShotSessionIds.add(session.id)
      await throwIfCanceled()
      const result = requireData(
        await entry.client.session.prompt(
          {
            sessionID: session.id,
            directory,
            model,
            variant: options?.reasoningEffort,
            system: getSelectedSkillsSystemPrompt(options),
            parts: await createPromptParts(message, options)
          },
          { throwOnError: true }
        )
      )
      this.reportMessageTokenUsage(
        { id: session.id, container: entry.container, session },
        result.info
      )
      await throwIfCanceled()
      return result.parts
        .flatMap((part): string[] => (part.type === 'text' && !part.synthetic ? [part.text] : []))
        .join('\n')
        .trim()
    } catch (error) {
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
      throw error
    } finally {
      if (generation.client && generation.sessionId && generation.directory) {
        await generation.client.session
          .delete(
            { sessionID: generation.sessionId, directory: generation.directory },
            { throwOnError: true }
          )
          .catch((error) => {
            console.error('[caught:OpenCodeProviderAdapter:generateOneShot]', error)
          })
      }
      this.oneShotGenerations.delete(generationId)
    }
  }

  cancelOneShot = async (generationId: string): Promise<void> => {
    const generation = this.oneShotGenerations.get(generationId)
    if (!generation) {
      this.rememberCanceledOneShotGeneration(generationId)
      return
    }
    generation.canceled = true
    if (generation.client && generation.sessionId && generation.directory) {
      await generation.client.session
        .abort(
          { sessionID: generation.sessionId, directory: generation.directory },
          { throwOnError: true }
        )
        .catch((error) => {
          console.error('[caught:OpenCodeProviderAdapter:cancelOneShot]', error)
        })
    }
  }

  importHistory: NonNullable<ProviderAdapter['importHistory']> = async (
    chatId,
    messages,
    options,
    onChatCreated
  ) => {
    const entry = await this.getClientEntry(options.container)
    const model = parseOpenCodeModelId(options.model)
    const state = chatId
      ? await this.ensureState(chatId, options.container)
      : this.rememberSession(
          requireData(
            await entry.client.session.create(
              {
                directory: options.cwd ?? homedir(),
                model: {
                  providerID: model.providerID,
                  id: model.modelID,
                  variant: options.reasoningEffort
                },
                metadata: { sele: { client: 'Sele' } },
                permission: getOpenCodePermissionRules(options)
              },
              { throwOnError: true }
            )
          ),
          entry.container
        )
    if (state.active) throw new Error('OpenCode is still working in this conversation.')
    if (!state.session) throw new Error('OpenCode session is unavailable.')
    const id = state.session.id
    await onChatCreated?.(id)
    const imported = encodeOpenCodeHistory(state.session, messages, model)
    if (imported.length) await importOpenCodeHistory(state.session, imported, entry.container)
    state.messagesDirty = true
    await this.refreshState(state, entry.client)
    const ids = new Set(state.messages.map((message) => message.info.id))
    if (imported.some((message) => !ids.has(message.info.id)))
      throw new Error('OpenCode did not load the imported conversation history.')
    return id
  }

  startChat = async (
    message: string,
    options?: ProviderTurnOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !(options?.files?.length || options?.images?.length)) {
      throw new Error('Cannot start a chat with an empty message')
    }
    const entry = await this.getClientEntry(options?.container)
    const directory = options?.cwd?.trim() || homedir()
    const model = parseOpenCodeModelId(options?.model ?? fallbackOpenCodeModels[0]!.id)
    const session = requireData(
      await entry.client.session.create(
        {
          directory,
          model: {
            providerID: model.providerID,
            id: model.modelID,
            variant: options?.reasoningEffort
          },
          metadata: { sele: { client: 'Sele' } },
          permission: getOpenCodePermissionRules(options)
        },
        { throwOnError: true }
      )
    )
    const state = this.rememberSession(session, entry.container)
    this.pendingMessageStore.track(session.id)
    await onChatCreated?.(session.id)
    await this.sendPrompt(state, text, options)
    return this.createChatDetail(state, true)
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options?.container)
    if (state.active || this.pendingMessageEdits.has(chatId) || state.queuedMessages.length > 0) {
      this.resumeRestoredQueue(state)
      const detail = await this.queueMessage(state, message, options)
      if (!state.active && !state.stopped) await this.drainQueue(state)
      return detail
    }
    await this.sendPrompt(state, message, options)
    return this.createChatDetail(state, true)
  }

  continueChatInFork = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const sourceState = await this.ensureState(chatId, options?.container)
    if (sourceState.active) throw new Error('Cannot fork a chat with an active response.')
    const entry = await this.getClientEntry(sourceState.container)
    const fork = requireData(
      await entry.client.session.fork(
        { sessionID: chatId, directory: sourceState.directory },
        { throwOnError: true }
      )
    )
    const state = this.rememberSession(fork, entry.container)
    this.pendingMessageStore.track(fork.id)
    await onForkCreated?.(fork.id)
    await this.sendPrompt(state, message, options)
    return this.createChatDetail(state, true)
  }

  forkChat = async (
    chatId: string,
    messageId: string,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const sourceState = await this.ensureState(chatId)
    if (sourceState.active) throw new Error('Cannot fork a chat with an active response.')

    const target = sourceState.messages.find(
      (entry) =>
        entry.info.role === 'assistant' && entry.parts.some((part) => part.id === messageId)
    )
    if (!target) throw new Error('Message cannot be forked.')

    const entry = await this.getClientEntry(sourceState.container)
    const fork = requireData(
      await entry.client.session.fork(
        {
          sessionID: chatId,
          directory: sourceState.directory,
          messageID: target.info.id
        },
        { throwOnError: true }
      )
    )
    const state = this.rememberSession(fork, entry.container)
    this.pendingMessageStore.track(fork.id)
    await this.refreshState(state, entry.client)
    await onForkCreated?.(fork.id)
    return this.createChatDetail(state, true)
  }

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options?.container)
    if (this.pendingMessageEdits.has(chatId))
      return this.queueMessage(state, message, options, mode === 'steer' ? 'steering' : 'queued')
    if (mode === 'queue') {
      this.resumeRestoredQueue(state)
      // The renderer may still show a turn that already ended; send instead of parking it.
      const detail = await this.queueMessage(state, message, options)
      if (!state.active && !state.stopped) await this.drainQueue(state)
      return detail
    }
    if (mode === 'interrupt') {
      await this.abortState(state)
      await this.sendPrompt(state, message, options)
      return this.createChatDetail(state, true)
    }

    try {
      await this.sendPrompt(state, message, options)
      return this.createChatDetail(state, true)
    } catch (error) {
      console.error('[caught:OpenCodeProviderAdapter:sendActiveChatMessage]', error)
      return this.queueMessage(state, message, options, 'steering')
    }
  }

  beginPendingMessageEdit = async (
    chatId: string,
    messageId: string,
    editId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    if (!state.queuedMessages.some((message) => message.id === messageId))
      throw new Error('The OpenCode message is no longer queued.')
    this.pendingMessageEdits.begin(chatId, messageId, editId, state.queuedMessages)
    return this.createChatDetail(state, true)
  }

  cancelPendingMessageEdit = async (
    chatId: string,
    messageId: string,
    editId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    if (this.pendingMessageEdits.release(chatId, messageId, editId) && !state.stopped)
      await this.drainQueue(state)
    return this.createChatDetail(state, true)
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const index = state.queuedMessages.findIndex((message) => message.id === messageId)
    if (index < 0) throw new Error('Pending message was not found.')
    state.queuedMessages.splice(index, 1)
    if (state.queuedMessages.length === 0) state.queuePaused = false
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions,
    editId?: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options?.container)
    this.pendingMessageEdits.assert(chatId, messageId, editId)
    const pending = state.queuedMessages.find((item) => item.id === messageId)
    if (!pending) throw new Error('Pending message was not found.')
    if (!message.trim() && !options?.images?.length && !options?.files?.length)
      throw new Error('Cannot edit a message to empty content')
    const replacement = { ...pending, content: message.trim(), options, createdAt: Date.now() }
    state.queuedMessages = state.queuedMessages.map((item) =>
      item === pending ? replacement : item
    )
    if (editId) {
      this.pendingMessageEdits.release(chatId, messageId, editId)
      if (!state.stopped) await this.drainQueue(state)
    }
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  steerPendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const pending = this.takeQueuedMessage(state, messageId)
    if (!pending) throw new Error('Pending message was not found.')
    try {
      await this.sendPrompt(state, pending.content, pending.options, () => true)
    } catch (error) {
      console.error('[caught:OpenCodeProviderAdapter:steerPendingMessage]', error)
      state.queuedMessages.unshift({ ...pending, kind: 'steering' })
    }
    return this.createChatDetail(state, true)
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.pendingMessageEdits.assert(chatId, messageId)
    const pending = this.takeQueuedMessage(state, messageId)
    if (!pending) throw new Error('Pending message was not found.')
    try {
      await this.abortState(state)
      await this.sendPrompt(state, pending.content, pending.options, () => true)
    } catch (error) {
      state.queuedMessages.unshift({ ...pending, kind: 'steering' })
      this.scheduleUpdate(chatId)
      console.error('[caught:OpenCodeProviderAdapter:interruptPendingMessage]', error)
    }
    return this.createChatDetail(state, true)
  }

  editMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options?.container)
    const target = state.messages.find(
      (entry) => entry.info.role === 'user' && entry.info.id === messageId
    )
    if (!target) throw new Error('Message cannot be edited.')
    await this.abortState(state)
    const client = (await this.getClientEntry(state.container)).client
    await client.session.revert(
      { sessionID: chatId, directory: state.directory, messageID: target.info.id },
      { throwOnError: true }
    )
    await this.sendPrompt(state, message, options)
    return this.createChatDetail(state, true)
  }

  updateChatPermissions = async (
    chatId: string,
    options: ProviderPermissionOptions
  ): Promise<void> => {
    const state = this.states.get(chatId) ?? (await this.ensureState(chatId, options.container))
    const client = (await this.getClientEntry(state.container)).client
    await client.session.update(
      {
        sessionID: chatId,
        directory: state.directory,
        permission: getOpenCodePermissionRules(options, Boolean(state.browser))
      },
      { throwOnError: true }
    )
    for (const pending of state.queuedMessages) {
      if (pending.options) pending.options = { ...pending.options, ...options }
    }
    // The queued objects keep their identity for in-flight drains; resave their new options.
    this.pendingMessageStore.invalidate(chatId)
    this.persistPendingMessages(state)
  }

  resolveApproval = async (
    chatId: string,
    decision: ProviderApprovalDecision
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const pending = state.pendingApprovals[0]
    if (!pending) throw new Error('There is no pending OpenCode approval.')
    const client = (await this.getClientEntry(state.container)).client
    await client.permission.reply(
      {
        requestID: pending.id,
        directory: state.directory,
        reply: decision === 'allow' ? 'once' : 'reject'
      },
      { throwOnError: true }
    )
    state.pendingApprovals.shift()
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  resolveUserInput = async (
    chatId: string,
    requestId: string,
    response: ProviderUserInputResponse
  ): Promise<ProviderChatDetail> => {
    if (response.kind === 'elicitation')
      throw new Error('MCP interaction responses are not supported by this provider.')
    const state = await this.ensureState(chatId)
    const pending = state.pendingQuestions.find((request) => request.id === requestId)
    if (!pending) throw new Error('There is no matching OpenCode question.')
    const client = (await this.getClientEntry(state.container)).client
    if (response.kind === 'cancel') {
      await client.question.reject(
        { requestID: requestId, directory: state.directory },
        { throwOnError: true }
      )
    } else {
      const answer = response.answer.trim()
      if (!answer) throw new Error('An answer is required.')
      const firstQuestion = pending.questions[0]
      if (
        !response.wasFreeform &&
        !firstQuestion?.options.some((option) => option.label === answer)
      ) {
        throw new Error('The selected OpenCode answer is no longer available.')
      }
      await client.question.reply(
        {
          requestID: requestId,
          directory: state.directory,
          answers: pending.questions.map((_, index) => (index === 0 ? [answer] : []))
        },
        { throwOnError: true }
      )
    }
    state.pendingQuestions = state.pendingQuestions.filter((request) => request.id !== requestId)
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  compactChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    if (state.active) {
      throw new Error('Wait for the current response before compacting context.')
    }
    const client = (await this.getClientEntry(state.container)).client
    await client.session.summarize(
      { sessionID: chatId, directory: state.directory, auto: false },
      { throwOnError: true }
    )
    await this.refreshState(state, client)
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  summarizeChatInFork = async (
    chatId: string,
    { signal }: { summaryPrompt: string; signal: AbortSignal },
    onForkCreated: (chatId: string) => Promise<void>
  ): Promise<string> => {
    const sourceState = await this.ensureState(chatId)
    if (sourceState.active)
      throw new Error('Wait for the current response before linking this chat.')
    throwIfLinkedChatCancelled(signal)
    const entry = await this.getClientEntry(sourceState.container)
    const client = entry.client
    const fork = requireData(
      await client.session.fork(
        { sessionID: chatId, directory: sourceState.directory },
        { throwOnError: true }
      )
    )
    this.rememberSession(fork, entry.container)
    await onForkCreated(fork.id)
    const abort = (): void => {
      void client.session
        .abort({ sessionID: fork.id, directory: fork.directory }, { throwOnError: true })
        .catch((error: unknown) => {
          console.error('[caught:OpenCodeProviderAdapter:summarizeChatInFork:abort]', error)
        })
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      throwIfLinkedChatCancelled(signal)
      // Native compaction writes a readable assistant summary record.
      await raceLinkedChatCancellation(
        signal,
        client.session.summarize(
          { sessionID: fork.id, directory: fork.directory, auto: false },
          { throwOnError: true }
        )
      )
      for (;;) {
        const messages = await raceLinkedChatCancellation(
          signal,
          loadOpenCodeMessages(client, fork, linkedChatSummaryTailLimit)
        )
        const summary = messages.findLast(
          (message) => message.info.role === 'assistant' && message.info.summary === true
        )
        if (summary?.info.role === 'assistant' && summary.info.time.completed != null) {
          if (summary.info.error) throw new Error('OpenCode could not summarize the linked chat.')
          return requireLinkedChatSummary(
            summary.parts
              .flatMap((part) => (part.type === 'text' && !part.synthetic ? [part.text] : []))
              .join('\n\n')
          )
        }
        await raceLinkedChatCancellation(
          signal,
          new Promise((resolve) => setTimeout(resolve, linkedChatSummaryPollMs))
        )
      }
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    this.closeBrowser(state)
    const client = (await this.getClientEntry(state.container)).client
    state.stopped = true
    const pendingRequestResults = await Promise.allSettled([
      ...state.pendingApprovals.map((request) =>
        client.permission.reply(
          { requestID: request.id, directory: state.directory, reply: 'reject' },
          { throwOnError: true }
        )
      ),
      ...state.pendingQuestions.map((request) =>
        client.question.reject(
          { requestID: request.id, directory: state.directory },
          { throwOnError: true }
        )
      )
    ])
    pendingRequestResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error(
          '[OpenCodeProviderAdapter:stopChat] Unable to reject pending request',
          result.reason
        )
      }
    })
    await this.abortState(state)
    state.pendingApprovals = []
    state.pendingQuestions = []
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  onChatUpdated = (
    listener: (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  ): (() => void) => {
    this.chatUpdatedListeners.add(listener)
    return () => this.chatUpdatedListeners.delete(listener)
  }

  dispose = (): Promise<void> => {
    this.updateTimers.forEach((timer) => clearTimeout(timer))
    this.updateTimers.clear()
    this.completionCoordinator.clear()
    this.oneShotGenerations.forEach((generation) => {
      if (generation.client && generation.sessionId && generation.directory) {
        void generation.client.session
          .abort({ sessionID: generation.sessionId, directory: generation.directory })
          .catch((error) => {
            console.error('[caught:OpenCodeProviderAdapter:dispose]', error)
          })
      }
    })
    this.oneShotGenerations.clear()
    this.oneShotSessionIds.clear()
    this.canceledOneShotGenerationIds.clear()
    this.canceledOneShotGenerationTimers.forEach((timer) => clearTimeout(timer))
    this.canceledOneShotGenerationTimers.clear()
    // Record the final live lists, then keep them: the states are discarded below.
    this.states.forEach((state) => this.persistPendingMessages(state))
    void this.pendingMessageStore.close()
    const clients = this.disposeClients()
    this.states.clear()
    this.sessionDiscoveries.clear()
    this.sessionContainers.clear()
    return clients
  }

  private disposeClients = async (): Promise<void> => {
    this.states.forEach((state) => {
      this.closeBrowser(state)
      state.messagesDirty = true
      state.client = null
    })
    const pendingEntries = Array.from(this.clientEntryPromises.values())
    this.clientEntryPromises.clear()
    const settledPendingEntries = await Promise.allSettled(pendingEntries)
    const entries = new Set(this.clientEntries.values())
    settledPendingEntries.forEach((result) => {
      if (result.status === 'fulfilled') entries.add(result.value)
      else {
        console.error(
          '[OpenCodeProviderAdapter:disposeClients] Unable to resolve pending client entry',
          result.reason
        )
      }
    })
    await Promise.all(
      Array.from(entries, async (entry) => {
        entry.terminalTasks.dispose()
        entry.eventAbortController.abort()
        await entry.server.dispose()
      })
    )
    this.clientEntries.clear()
    this.clientEntryPromises.clear()
  }

  private createClientEntry = async (
    container?: AppContainerTarget | null
  ): Promise<OpenCodeClientEntry> => {
    const storedContainer = normalizeStoredContainer(container)
    const server = new OpenCodeServerClient(storedContainer)
    const terminalTasks = createOpenCodeTerminalTasks()
    const client = await server.getClient()
    const entry: OpenCodeClientEntry = {
      server,
      client,
      container: storedContainer,
      eventAbortController: new AbortController(),
      terminalTasks
    }
    server.onExit((error) => {
      terminalTasks.dispose()
      console.error('[OpenCodeProviderAdapter:createClientEntry] OpenCode server exited', error)
      const key = getContainerTargetKey(storedContainer)
      if (this.clientEntries.get(key) === entry) this.clientEntries.delete(key)
      this.states.forEach((state) => {
        if (state.client === client) {
          state.messagesDirty = true
          this.closeBrowser(state)
        }
      })
      entry.eventAbortController.abort()
    })
    void this.consumeEvents(entry)
    return entry
  }

  private getClientEntry = (
    container?: AppContainerTarget | null
  ): Promise<OpenCodeClientEntry> => {
    const storedContainer = normalizeStoredContainer(container)
    const key = getContainerTargetKey(storedContainer)
    const existing = this.clientEntries.get(key)
    if (existing) return Promise.resolve(existing)
    const pending = this.clientEntryPromises.get(key)
    if (pending) return pending
    const promise = this.createClientEntry(storedContainer)
      .then((entry) => {
        this.clientEntries.set(key, entry)
        return entry
      })
      .finally(() => this.clientEntryPromises.delete(key))
    this.clientEntryPromises.set(key, promise)
    return promise
  }

  private consumeEvents = async (entry: OpenCodeClientEntry): Promise<void> => {
    try {
      const events = await entry.client.global.event({
        signal: entry.eventAbortController.signal,
        throwOnError: true
      })
      for await (const event of events.stream) {
        if (entry.eventAbortController.signal.aborted) return
        this.handleEvent(entry, event)
      }
    } catch (error) {
      console.error(
        entry.eventAbortController.signal.aborted
          ? '[OpenCodeProviderAdapter:consumeEvents] Event stream stopped during shutdown'
          : '[OpenCodeProviderAdapter:consumeEvents] Event stream stopped unexpectedly',
        error
      )
    } finally {
      entry.terminalTasks.dispose()
      if (!entry.eventAbortController.signal.aborted) {
        const key = getContainerTargetKey(entry.container)
        if (this.clientEntries.get(key) === entry) this.clientEntries.delete(key)
        this.states.forEach((state) => {
          if (state.client === entry.client) {
            state.messagesDirty = true
            this.closeBrowser(state)
          }
        })
      }
    }
  }

  private handleEvent = (entry: OpenCodeClientEntry, globalEvent: unknown): void => {
    const event = parseOpenCodeSessionEvent(globalEvent)
    if (!event) return
    const { type, properties, sessionID } = event
    const sessionInfo = isRecord(properties.info) ? (properties.info as unknown as Session) : null
    // Title and one-shot sessions count too: they use the same stored credentials.
    if (type === 'message.updated')
      this.credentialHealth.record(getContainerTargetKey(entry.container), properties.info)
    // The keyless free tier only reports its limit when a request hits it.
    this.freeLimits.observe(getContainerTargetKey(entry.container), type, properties)
    if (sessionInfo && isOneShotSession(sessionInfo)) {
      this.completionCoordinator.cancel(sessionID)
      this.states.delete(sessionID)
      if (type === 'session.deleted') this.oneShotSessionIds.delete(sessionID)
      else this.oneShotSessionIds.add(sessionID)
      return
    }
    if (this.oneShotSessionIds.has(sessionID)) {
      if (
        type === 'message.updated' &&
        isRecord(properties.info) &&
        properties.info.role === 'assistant'
      ) {
        this.reportMessageTokenUsage(
          { id: sessionID, container: entry.container, session: null },
          properties.info as unknown as OpenCodeMessageWithParts['info']
        )
      }
      if (type === 'session.deleted') this.oneShotSessionIds.delete(sessionID)
      return
    }
    if (
      type === 'session.idle' ||
      type === 'session.error' ||
      type === 'session.deleted' ||
      (type === 'session.status' &&
        isRecord(properties.status) &&
        properties.status.type === 'idle')
    )
      entry.terminalTasks.invalidate(sessionID)
    const directory = event.directory ?? this.states.get(sessionID)?.directory
    if (!directory) return
    const state = this.getOrCreateState(sessionID, directory, entry.container)
    state.eventRevision += 1
    if (type.startsWith('message.')) {
      const messages = applyOpenCodeMessageEvent(state.messages, type, properties)
      if (messages) state.messages = messages
      else {
        state.messagesDirty = true
        state.historyInvalidationRevision = (state.historyInvalidationRevision ?? 0) + 1
      }
    }
    if (
      type === 'message.updated' &&
      isRecord(properties.info) &&
      properties.info.role === 'assistant'
    ) {
      this.reportMessageTokenUsage(
        state,
        properties.info as unknown as OpenCodeMessageWithParts['info']
      )
    }
    if (type === 'session.deleted') {
      this.closeBrowser(state)
      this.completionCoordinator.cancel(sessionID)
      this.states.delete(sessionID)
      this.sessionContainers.delete(sessionID)
      return
    }

    const limitMessage = getOpenCodeUsageLimitMessage(type, properties)
    if (limitMessage) {
      entry.terminalTasks.invalidate(sessionID)
      this.failUsageLimitedTurn(state, entry.client, limitMessage)
      return
    }
    // Aborting OpenCode's retry loop emits busy/idle and MessageAbortedError events.
    // Preserve the limit failure until the user explicitly sends another prompt.
    if (state.usageLimitReached) {
      this.scheduleUpdate(sessionID)
      return
    }

    if (type === 'message.updated' || type === 'session.status') {
      const status = isRecord(properties.status) ? properties.status : null
      // OpenCode publishes a failed or stopped reply's final message.updated after session.error
      // and session.idle. That record ends the turn; treating it as activity flashed the
      // finished turn back to working until the next idle.
      // User records are not activity either: OpenCode rewrites the user message with its
      // background summary after session.idle, which left finished turns stuck as working.
      const info = type === 'message.updated' && isRecord(properties.info) ? properties.info : null
      const replyInProgress =
        info?.role === 'assistant' &&
        info.summary !== true &&
        !info.error &&
        !(isRecord(info.time) && typeof info.time.completed === 'number')
      if (
        type === 'session.status'
          ? status?.type === 'busy' || status?.type === 'retry'
          : replyInProgress
      ) {
        entry.terminalTasks.advance(sessionID)
        this.completionCoordinator.cancel(sessionID)
        state.active = true
        state.stopped = false
        state.failed = false
        state.failureMessage = null
      }
    }
    if (type === 'session.updated' && isRecord(properties.info)) {
      state.session = properties.info as unknown as Session
    }
    // Keep interaction events in the live cache. A refresh already in flight may have
    // read the permission list before this event and cannot supply this request.
    if (type === 'permission.asked' && typeof properties.id === 'string') {
      const request = properties as unknown as PermissionRequest
      const index = state.pendingApprovals.findIndex((pending) => pending.id === request.id)
      if (index < 0) state.pendingApprovals.push(request)
      else state.pendingApprovals[index] = request
      this.publishInteractionUpdate(state)
      return
    }
    if (type === 'permission.replied') {
      state.pendingApprovals = state.pendingApprovals.filter(
        (request) => request.id !== properties.requestID
      )
      this.publishInteractionUpdate(state)
      return
    }
    if (type === 'question.asked' && typeof properties.id === 'string') {
      const request = properties as unknown as QuestionRequest
      const index = state.pendingQuestions.findIndex((pending) => pending.id === request.id)
      if (index < 0) state.pendingQuestions.push(request)
      else state.pendingQuestions[index] = request
      this.publishInteractionUpdate(state)
      return
    }
    if (type === 'question.replied' || type === 'question.rejected') {
      state.pendingQuestions = state.pendingQuestions.filter(
        (request) => request.id !== properties.requestID
      )
      this.publishInteractionUpdate(state)
      return
    }
    if (type === 'permission.asked' || type === 'permission.v2.asked') {
      this.scheduleUpdate(sessionID)
      return
    }
    if (type === 'question.asked' || type === 'question.v2.asked') {
      this.scheduleUpdate(sessionID)
      return
    }
    if (type === 'session.error' && isOpenCodeAbortError(properties.error)) {
      // An abort the user asked for ends the turn as stopped, not failed.
      this.closeBrowser(state)
      state.active = false
      state.stopped = true
    } else if (type === 'session.error') {
      this.closeBrowser(state)
      console.error(
        `[OpenCodeProviderAdapter:handleEvent] Session ${sessionID} failed: ${getOpenCodeErrorMessage(properties.error)}`
      )
      state.active = false
      state.failed = true
      state.failureMessage = getOpenCodeErrorMessage(properties.error)
    }
    if (type === 'session.idle') {
      this.closeBrowser(state)
      state.active = false
      if (state.queuedMessages.length > 0 && !state.stopped) {
        void this.finishTurnAndDrainQueue(state)
        return
      }
      void this.completeTurn(state)
      return
    }
    this.scheduleUpdate(sessionID)
  }

  private failUsageLimitedTurn = (
    state: OpenCodeChatState,
    client: OpencodeClient,
    message: string
  ): void => {
    if (state.usageLimitReached) return
    state.usageLimitReached = true
    state.eventRevision += 1
    state.active = false
    state.stopped = false
    state.failed = true
    state.failureMessage = message
    state.pendingApprovals = []
    state.pendingQuestions = []
    this.closeBrowser(state)
    void this.completeTurn(state)
    void client.session
      .abort({ sessionID: state.id, directory: state.directory }, { throwOnError: true })
      .catch((error) => console.error('Unable to abort usage-limited OpenCode turn', error))
  }

  private publishInteractionUpdate = (state: OpenCodeChatState): void => {
    if (state.session) {
      // Approval controls must not wait on message history or another HTTP request.
      void this.emitUpdateNow(state, false, false).catch((error) =>
        console.error('Unable to publish OpenCode interaction update', error)
      )
    }
    this.scheduleUpdate(state.id)
  }

  private getOrCreateState = (
    sessionId: string,
    directory: string,
    container: AppContainerTarget | null
  ): OpenCodeChatState => {
    const existing = this.states.get(sessionId)
    if (existing) return existing
    const state: OpenCodeChatState = {
      browser: null,
      browserGeneration: 0,
      id: sessionId,
      revision: 0,
      directory,
      container,
      session: null,
      messages: [],
      messagesHydrated: false,
      messagesDirty: false,
      hydratedUpdatedAt: null,
      eventRevision: 0,
      client: null,
      active: false,
      stopped: false,
      failed: false,
      failureMessage: null,
      usageLimitReached: false,
      pendingApprovals: [],
      pendingQuestions: [],
      queuedMessages: [],
      queuePaused: false
    }
    this.states.set(sessionId, state)
    this.sessionContainers.set(sessionId, container)
    return state
  }

  private rememberSession = (
    session: Session | GlobalSession,
    container: AppContainerTarget | null
  ): OpenCodeChatState => {
    const state = this.getOrCreateState(session.id, session.directory, container)
    if (
      state.messagesHydrated &&
      state.hydratedUpdatedAt !== null &&
      session.time.updated !== state.hydratedUpdatedAt
    )
      state.messagesDirty = true
    state.session = session
    if (
      state.directory !== session.directory ||
      getContainerTargetKey(state.container) !== getContainerTargetKey(container)
    ) {
      this.closeBrowser(state)
    }
    state.directory = session.directory
    state.container = container
    this.sessionContainers.set(session.id, container)
    return state
  }

  private findSession = async (client: OpencodeClient, chatId: string): Promise<GlobalSession> => {
    let cursor = 0
    const limit = 200
    while (cursor < 10_000) {
      const sessions = requireData(
        await client.experimental.session.list(
          { cursor, limit, roots: true },
          { throwOnError: true }
        )
      )
      const session = sessions.find((candidate) => candidate.id === chatId)
      if (session) return session
      if (sessions.length < limit) break
      cursor += sessions.length
    }
    throw new Error(`OpenCode session was not found: ${chatId}`)
  }

  private loadSubagentSessions = async (
    client: OpencodeClient,
    rootSession: Session | GlobalSession
  ): Promise<Session[]> => {
    const subagents: Session[] = []
    const pending: Array<Session | GlobalSession> = [rootSession]
    const seen = new Set([rootSession.id])

    while (pending.length > 0) {
      const parent = pending.shift()!
      const children = requireData(
        await client.session.children(
          { sessionID: parent.id, directory: parent.directory },
          { throwOnError: true }
        )
      ).filter(isOpenCodeSubagentSession)

      children.forEach((child) => {
        if (seen.has(child.id)) return
        seen.add(child.id)
        subagents.push(child)
        pending.push(child)
      })
    }

    return subagents.sort((first, second) => first.time.created - second.time.created)
  }

  private ensureState = async (
    chatId: string,
    container?: AppContainerTarget | null
  ): Promise<OpenCodeChatState> => {
    const storedContainer =
      container === undefined
        ? (this.sessionContainers.get(chatId) ?? this.states.get(chatId)?.container ?? null)
        : normalizeStoredContainer(container)
    const entry = await this.getClientEntry(storedContainer)
    let state = this.states.get(chatId)
    if (!state) {
      const key = `${getContainerTargetKey(entry.container)}:${chatId}`
      let discovery = this.sessionDiscoveries.get(key)
      if (!discovery) {
        discovery = this.findSession(entry.client, chatId)
          .then((session) => this.rememberSession(session, entry.container))
          .finally(() => this.sessionDiscoveries.delete(key))
        this.sessionDiscoveries.set(key, discovery)
      }
      state = await discovery
    }
    this.restorePendingMessages(state, await this.pendingMessageStore.restore(chatId))
    if (!state.messagesHydrated || state.messagesDirty || state.client !== entry.client) {
      await this.refreshState(state, entry.client)
    } else {
      const pending = this.stateChecks.get(state)
      if (pending) await pending
      else {
        const check = (async (): Promise<void> => {
          const session = requireData(
            await entry.client.session.get(
              { sessionID: chatId, directory: state.directory },
              { throwOnError: true }
            )
          )
          if (session.time.updated !== state.hydratedUpdatedAt) {
            state.messagesDirty = true
            await this.refreshState(state, entry.client)
          } else {
            state.session = session
          }
        })()
        this.stateChecks.set(state, check)
        try {
          await check
        } finally {
          this.stateChecks.delete(state)
        }
      }
    }
    return state
  }

  private loadMessages = async (
    client: OpencodeClient,
    session: Session | GlobalSession,
    limit?: number
  ): Promise<OpenCodeMessageWithParts[]> => loadOpenCodeMessages(client, session, limit)

  private refreshState = async (
    state: OpenCodeChatState,
    client: OpencodeClient,
    preserveActive = false
  ): Promise<void> => {
    const pending = this.refreshes.get(state)
    if (pending) return pending
    const refresh = this.refreshStateNow(state, client, preserveActive)
    this.refreshes.set(state, refresh)
    try {
      await refresh
    } finally {
      this.refreshes.delete(state)
    }
  }

  private refreshStateNow = async (
    state: OpenCodeChatState,
    client: OpencodeClient,
    preserveActive: boolean
  ): Promise<void> => {
    const eventRevision = state.eventRevision
    const historyInvalidationRevision = state.historyInvalidationRevision ?? 0
    const initialMessages = state.messages
    const [session, messages, statuses, permissions, questions] = await Promise.all([
      client.session
        .get({ sessionID: state.id, directory: state.directory }, { throwOnError: true })
        .then(requireData),
      loadOpenCodeMessages(client, { id: state.id, directory: state.directory }),
      client.session
        .status({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch((error) => {
          console.error('[caught:OpenCodeProviderAdapter:refreshState]', error)
          return {}
        }),
      client.permission
        .list({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch((error) => {
          console.error('[caught:OpenCodeProviderAdapter:refreshState]', error)
          return []
        }),
      client.question
        .list({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch((error) => {
          console.error('[caught:OpenCodeProviderAdapter:refreshState]', error)
          return []
        })
    ])
    if (
      eventRevision === state.eventRevision ||
      !state.session ||
      session.time.updated >= state.session.time.updated
    ) {
      state.session = session
    }
    const reconciledMessages = reconcileOpenCodeMessageSnapshot(
      initialMessages,
      state.messages,
      messages
    )
    state.messages = reconcileProviderRecords(state.messages, reconciledMessages, {
      authoritative: true,
      getId: (message) => message.info.id
    })
    await forEachOpenCodeHistoryMessage(state.messages, (message) =>
      this.reportMessageTokenUsage(state, message.info)
    )
    state.messagesHydrated = true
    state.messagesDirty = historyInvalidationRevision !== (state.historyInvalidationRevision ?? 0)
    state.hydratedUpdatedAt = session.time.updated
    state.client = client
    // A live event may have advanced these fields while the snapshot was in flight.
    // Leave them intact until the dirty state receives its next reconciliation.
    const status = statuses[state.id]
    const serverBusy = status?.type === 'busy' || status?.type === 'retry'
    if (eventRevision === state.eventRevision) {
      const limitMessage = getOpenCodeUsageLimitMessage('session.status', { status })
      if (limitMessage) this.failUsageLimitedTurn(state, client, limitMessage)
      if (state.usageLimitReached) return
      const wasActive = state.active
      if (serverBusy) state.active = true
      else if (!preserveActive) state.active = false
      state.pendingApprovals = permissions.filter((request) => request.sessionID === state.id)
      state.pendingQuestions = questions.filter((request) => request.sessionID === state.id)
      // session.idle is the usual queue trigger; a refresh that ends the turn must also send it.
      if (wasActive && !state.active && state.queuedMessages.length > 0 && !state.stopped) {
        void this.drainQueue(state).catch((error) =>
          console.error('Unable to resume OpenCode queue after refresh.', error)
        )
      }
    } else if (state.active && !serverBusy && !preserveActive) {
      // The server is idle but a live event outdated this snapshot; reconcile again rather
      // than leave the chat working with no further idle event coming.
      state.messagesDirty = true
      this.scheduleUpdate(state.id)
    }
  }

  private createChat = (
    session: Session | GlobalSession,
    messages: OpenCodeMessageWithParts[],
    state?: OpenCodeChatState
  ): ProviderChat => ({
    id: session.id,
    providerId: 'opencode',
    title:
      isDefaultOpenCodeTitle(session.title) && state?.fallbackTitle
        ? state.fallbackTitle
        : getOpenCodeDisplayTitle(session.title, messages),
    preview: getMessagePreview(messages),
    cwd: session.directory || null,
    cwdKind: 'directory',
    projectCwd: null,
    branchName: null,
    worktreeBaseBranchName: null,
    createdAt: session.time.created,
    updatedAt: Math.max(
      session.time.updated,
      ...messages.map(({ info }) =>
        info.role === 'assistant' ? (info.time.completed ?? info.time.created) : info.time.created
      )
    ),
    status: state ? this.getChatStatus(state) : null,
    lastTurnOutcome: state?.active
      ? null
      : state?.failed
        ? 'failed'
        : state?.stopped
          ? 'stopped'
          : getOpenCodeTurnOutcome(messages),
    pendingApproval: state ? getPendingApproval(state.pendingApprovals[0], state.directory) : null,
    pinned: false,
    sidebarOrder: null,
    done: false,
    seenUpdatedAt: null,
    purpose: null,
    container: state?.container ?? null
  })

  private getChatStatus = (state: OpenCodeChatState): ProviderChat['status'] => {
    if (state.pendingQuestions.length > 0) return 'waitingOnUserInput'
    if (state.pendingApprovals.length > 0) return 'waitingOnApproval'
    if (state.failed) return 'error'
    if (state.active) return 'active'
    return null
  }

  private reportMessageTokenUsage = (
    state: Pick<OpenCodeChatState, 'id' | 'container' | 'session'>,
    info: OpenCodeMessageWithParts['info']
  ): void => {
    if (info.role !== 'assistant') return
    const session = state.session
    const parent = session?.parentID ? this.states.get(session.parentID) : undefined
    const parentTurnId = parent?.messages.findLast(
      (message) =>
        message.info.role === 'user' &&
        message.info.time.created <= (session?.time.created ?? info.time.created)
    )?.info.id
    this.tokenUsageReporter.linkChat(
      state.id,
      getContainerTargetKey(state.container),
      session?.parentID,
      parentTurnId
    )

    this.tokenUsageReporter.report({
      chatId: state.id,
      sourceKey: getContainerTargetKey(state.container),
      turnId: info.parentID,
      recordId: info.id,
      timestamp: info.time.created,
      usage: normalizeTokenUsage(
        info.tokens.input + info.tokens.cache.write,
        info.tokens.cache.read,
        info.tokens.output + info.tokens.reasoning
      ),
      models: [
        {
          modelId: `${info.providerID}/${info.modelID}`,
          nativePricingKey: `opencode:${getContainerTargetKey(state.container)}:${info.providerID}/${info.modelID}`,
          totalUSD: info.cost,
          cacheWriteTokens: info.tokens.cache.write,
          contextTokens: info.tokens.input + info.tokens.cache.read + info.tokens.cache.write,
          usage: normalizeTokenUsage(
            info.tokens.input + info.tokens.cache.write,
            info.tokens.cache.read,
            info.tokens.output + info.tokens.reasoning
          )
        }
      ]
    })
  }

  private getContextUsage = (state: OpenCodeChatState): ProviderChatContextUsage | null => {
    const assistantMessages = state.messages.filter((message) => message.info.role === 'assistant')
    const lastMessage = assistantMessages.at(-1)
    if (!lastMessage) return null
    const last = getTokenBreakdown(lastMessage)
    const total = sumBreakdowns(assistantMessages.map(getTokenBreakdown))
    const model =
      lastMessage.info.role === 'assistant'
        ? `${lastMessage.info.providerID}/${lastMessage.info.modelID}`
        : null
    return {
      usedTokens: last.totalTokens,
      maxTokens: model ? (this.modelContextLimits.get(model) ?? null) : null,
      total,
      last,
      updatedAt:
        lastMessage.info.role === 'assistant'
          ? (lastMessage.info.time.completed ?? lastMessage.info.time.created)
          : Date.now()
    }
  }

  private createChatDetail = async (
    state: OpenCodeChatState,
    preserveActive = false,
    window?: ProviderChatTurnWindow
  ): Promise<ProviderChatDetail> => {
    const client = (await this.getClientEntry(state.container)).client
    await this.refreshState(state, client, preserveActive)
    return this.createChatDetailFromState(state, window)
  }

  private createChatDetailFromState = (
    state: OpenCodeChatState,
    window?: ProviderChatTurnWindow
  ): ProviderChatDetail => {
    this.persistPendingMessages(state)
    const session = state.session
    if (!session) throw new Error('Unable to load OpenCode session.')
    state.revision += 1
    const pendingItems = state.queuedMessages.map(
      (message): ProviderPendingMessage => ({
        type: message.type,
        id: message.id,
        kind: message.kind,
        content: message.content,
        attachments: message.attachments,
        createdAt: message.createdAt
      })
    )
    return {
      id: session.id,
      revision: state.revision,
      createdAt: session.time.created,
      title: getOpenCodeDisplayTitle(session.title, state.messages),
      cwd: state.directory,
      cwdKind: 'directory',
      projectCwd: null,
      branchName: null,
      worktreeBaseBranchName: null,
      status: this.getChatStatus(state),
      lastTurnOutcome: state.active
        ? null
        : state.failed
          ? 'failed'
          : state.stopped
            ? 'stopped'
            : getOpenCodeTurnOutcome(state.messages),
      pinned: false,
      sidebarOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: state.container,
      capabilities: { editMessages: true, activeMessages: true },
      pendingApproval: getPendingApproval(state.pendingApprovals[0], state.directory),
      pendingUserInput: getPendingUserInput(state.pendingQuestions[0]),
      contextUsage: this.getContextUsage(state),
      ...(() => {
        const settings = {
          active: state.active,
          stopped: state.stopped,
          failed: state.failed,
          failureMessage: state.failureMessage ?? undefined,
          pendingItems
        }
        return window
          ? renderOpenCodeChatWindow(state.messages, settings, window)
          : { items: renderOpenCodeChatItems(state.messages, settings) }
      })()
    }
  }

  private sendPrompt = async (
    state: OpenCodeChatState,
    message: string,
    options?: ProviderTurnOptions,
    claim?: () => boolean
  ): Promise<boolean> => {
    const text = message.trim()
    const parts = await createPromptParts(text, options)
    if (parts.length === 0) throw new Error('Cannot send an empty OpenCode message.')
    this.completionCoordinator.cancel(state.id)
    const entry = await this.getClientEntry(state.container)
    const client = entry.client
    this.closeBrowser(state)
    const generation = state.browserGeneration
    if (!state.container && options?.sandboxMode !== 'read-only') {
      const browser = await entry.server.registerBrowser({
        providerId: 'opencode',
        sessionId: state.id,
        cwd: state.directory,
        containerKey: 'host'
      })
      if (generation !== state.browserGeneration || this.states.get(state.id) !== state) {
        await browser?.close()
        throw new Error('OpenCode browser startup was canceled')
      }
      state.browser = browser
    }
    const model = parseOpenCodeModelId(options?.model ?? fallbackOpenCodeModels[0]!.id)
    try {
      await client.session.update(
        {
          sessionID: state.id,
          directory: state.directory,
          permission: getOpenCodePermissionRules(options, Boolean(state.browser))
        },
        { throwOnError: true }
      )
      if (claim && !claim()) return false
      if (!claim && this.pendingMessageEdits.has(state.id)) {
        await this.queueMessage(state, message, options, state.active ? 'steering' : 'queued')
        return false
      }
      state.active = true
      state.eventRevision += 1
      state.stopped = false
      state.queuePaused = false
      state.failed = false
      state.failureMessage = null
      state.usageLimitReached = false
      await client.session.promptAsync(
        {
          sessionID: state.id,
          directory: state.directory,
          model,
          variant: options?.reasoningEffort,
          system: getSelectedSkillsSystemPrompt(options),
          parts
        },
        { throwOnError: true }
      )
    } catch (error) {
      this.closeBrowser(state)
      throw error
    }
    this.scheduleUpdate(state.id)
    return true
  }

  private abortState = async (state: OpenCodeChatState): Promise<void> => {
    this.closeBrowser(state)
    const entry = await this.getClientEntry(state.container)
    entry.terminalTasks.invalidate(state.id)
    const client = entry.client
    await client.session.abort(
      { sessionID: state.id, directory: state.directory },
      { throwOnError: true }
    )
    state.active = false
  }

  private closeBrowser = (state: OpenCodeChatState): void => {
    state.browserGeneration += 1
    const browser = state.browser
    state.browser = null
    // Revoke synchronously; network shutdown must not delay abort or an idle event.
    browser?.suspend()
    void browser
      ?.close()
      .catch((error) => console.error('Unable to close OpenCode browser.', error))
  }

  private queueMessage = (
    state: OpenCodeChatState,
    message: string,
    options?: ProviderTurnOptions,
    kind: ProviderPendingMessage['kind'] = 'queued'
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text && !(options?.files?.length || options?.images?.length)) {
      throw new Error('Cannot queue an empty OpenCode message.')
    }
    state.queuedMessages.push({
      type: 'pendingMessage',
      id: randomUUID(),
      kind,
      content: text,
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
      ],
      createdAt: Date.now(),
      options
    })
    this.scheduleUpdate(state.id)
    return this.createChatDetail(state, true)
  }

  private takeQueuedMessage = (
    state: OpenCodeChatState,
    messageId: string
  ): QueuedOpenCodeMessage | null => {
    const index = state.queuedMessages.findIndex((message) => message.id === messageId)
    if (index < 0) return null
    return state.queuedMessages.splice(index, 1)[0] ?? null
  }

  private persistPendingMessages = (state: OpenCodeChatState): void => {
    this.pendingMessageStore.save(
      state.id,
      state.queuedMessages.map((message) => ({
        id: message.id,
        kind: message.kind,
        submitted: false,
        createdAt: message.createdAt ?? Date.now(),
        payload: message
      }))
    )
  }

  /**
   * A new send resumes a queue restored after a restart, as it does for the other providers.
   * The restart also left the interrupted turn stopped; that must not park the queue again.
   */
  private resumeRestoredQueue = (state: OpenCodeChatState): void => {
    if (!state.queuePaused) return
    state.queuePaused = false
    state.stopped = false
  }

  /** Messages left undelivered by the previous process wait in a paused queue. */
  private restorePendingMessages = (
    state: OpenCodeChatState,
    stored: Awaited<ReturnType<typeof this.pendingMessageStore.restore>>
  ): void => {
    if (!stored.length) return
    const restoredIds = new Set(stored.map((message) => message.id))
    state.queuedMessages = [
      ...stored.map(
        (message): QueuedOpenCodeMessage => ({
          ...message.payload,
          id: message.id,
          kind: message.kind,
          createdAt: message.createdAt
        })
      ),
      ...state.queuedMessages.filter((message) => !restoredIds.has(message.id))
    ]
    state.queuePaused = true
    this.persistPendingMessages(state)
    this.scheduleUpdate(state.id)
  }

  private drainQueue = async (state: OpenCodeChatState): Promise<void> => {
    if (
      this.queueDrains.has(state.id) ||
      state.stopped ||
      state.queuePaused ||
      state.usageLimitReached
    )
      return
    const pending = state.active
      ? state.queuedMessages.find(
          (message) =>
            message.kind === 'steering' && !this.pendingMessageEdits.blocks(state.id, message.id)
        )
      : state.queuedMessages[0]
    if (!pending || this.pendingMessageEdits.blocks(state.id, pending.id)) return
    this.queueDrains.add(state.id)
    let failed = false
    try {
      await this.sendPrompt(state, pending.content, pending.options, () => {
        if (
          this.pendingMessageEdits.blocks(state.id, pending.id) ||
          (state.active && pending.kind !== 'steering') ||
          state.stopped ||
          state.usageLimitReached ||
          !state.queuedMessages.includes(pending)
        )
          return false
        state.queuedMessages = state.queuedMessages.filter((message) => message !== pending)
        return true
      })
    } catch (error) {
      failed = true
      state.failed = true
      state.failureMessage = getOpenCodeErrorMessage(error)
      if (!state.queuedMessages.includes(pending)) state.queuedMessages.unshift(pending)
      void this.completeTurn(state)
      console.error('Unable to send queued OpenCode message', error)
    } finally {
      this.queueDrains.delete(state.id)
      this.scheduleUpdate(state.id)
      if (
        !failed &&
        !state.stopped &&
        !state.usageLimitReached &&
        state.queuedMessages.length > 0 &&
        state.queuedMessages.some(
          (message) =>
            !this.pendingMessageEdits.blocks(state.id, message.id) &&
            (!state.active || message.kind === 'steering')
        )
      ) {
        void this.drainQueue(state).catch((error) =>
          console.error('Unable to resume OpenCode queue.', error)
        )
      }
    }
  }

  private finishTurnAndDrainQueue = async (state: OpenCodeChatState): Promise<void> => {
    // completeTurn publishes synchronously from the live cache; recovery must not hold the queue.
    void this.completeTurn(state)
    if (!state.stopped && state.queuedMessages.length > 0) await this.drainQueue(state)
  }

  private completeTurn = (state: OpenCodeChatState): Promise<boolean> =>
    this.completionCoordinator.complete(state.id, {
      publish: () => this.emitUpdateNow(state, true, state.session === null),
      reconcile: async () => {
        await new Promise((resolve) => setTimeout(resolve, updateDelayMs))
        const client = (await this.getClientEntry(state.container)).client
        await this.refreshState(state, client)
        this.recoverChatTitle(state, client)
      },
      publishReconciled: () => this.emitUpdateNow(state, false, false),
      isCurrent: () => this.states.get(state.id) === state,
      onError: (error, phase) => {
        console.error(`Unable to ${phase} completed OpenCode session ${state.id}`, error)
      }
    })

  private recoverChatTitle = (state: OpenCodeChatState, client: OpencodeClient): void => {
    const isCurrent = (): boolean =>
      this.states.get(state.id) === state &&
      !this.manualTitles.has(state) &&
      Boolean(
        state.session && !state.session.parentID && isDefaultOpenCodeTitle(state.session.title)
      )
    if (!isCurrent() || this.titleGenerations.has(state) || state.stopped || state.failed) return
    const firstUser = state.messages.find((message) => message.info.role === 'user')
    if (!firstUser || firstUser.info.role !== 'user') return
    const prompt = firstUser.parts
      .flatMap((part) =>
        part.type === 'text' && !part.synthetic && !part.ignored ? [part.text] : []
      )
      .join('\n')
      .trim()
    if (!prompt) return
    const latestUser = state.messages.findLast((message) => message.info.role === 'user')!
    const model = latestUser.info.role === 'user' ? latestUser.info.model : firstUser.info.model
    const chatModel = `${model.providerID}/${model.modelID}`
    this.titleGenerations.add(state)
    void (async () => {
      const request = { throwOnError: true as const, signal: AbortSignal.timeout(10_000) }
      const [catalog, config] = await Promise.all([
        client.provider.list({ directory: state.directory }, request).then(requireData),
        client.config.get({ directory: state.directory }, request).then(requireData)
      ])
      if (config.agent?.title?.disable || !isCurrent()) return
      const models = selectOpenCodeTitleModels(
        catalog.all,
        catalog.connected,
        config.agent?.title?.model ?? config.small_model,
        chatModel
      )
      const title = await generateOpenCodeChatTitle(
        client,
        state.directory,
        prompt,
        models,
        isCurrent,
        (session, message) =>
          this.reportMessageTokenUsage(
            { id: session.id, container: state.container, session },
            message
          )
      )
      if (!title || !isCurrent()) return
      const write = (async () => {
        // Native generation or another client may have named the chat while we waited.
        const latest = requireData(
          await client.session.get(
            { sessionID: state.id, directory: state.directory },
            { throwOnError: true, signal: AbortSignal.timeout(10_000) }
          )
        )
        if (!isCurrent() || !isDefaultOpenCodeTitle(latest.title)) return
        state.session = requireData(
          await client.session.update(
            { sessionID: state.id, directory: state.directory, title },
            { throwOnError: true, signal: AbortSignal.timeout(10_000) }
          )
        )
        this.scheduleUpdate(state.id)
      })().catch((error) => {
        console.error('[OpenCodeProviderAdapter:recoverChatTitle] Unable to save title', error)
      })
      this.titleWrites.set(state, write)
      try {
        await write
      } finally {
        this.titleWrites.delete(state)
      }
    })()
      .catch((error) => {
        console.error('[OpenCodeProviderAdapter:recoverChatTitle] Unable to recover title', error)
      })
      .finally(() => this.titleGenerations.delete(state))
  }

  private emitUpdateNow = async (
    state: OpenCodeChatState,
    turnCompleted = false,
    refresh = true
  ): Promise<void> => {
    const timer = this.updateTimers.get(state.id)
    if (timer) clearTimeout(timer)
    this.updateTimers.delete(state.id)
    if (isOpenCodeChildState(state)) return
    const detail = refresh
      ? await this.createChatDetail(state, false, { startIndex: null, limit: 10 })
      : this.createChatDetailFromState(state, { startIndex: null, limit: 10 })
    if (this.states.get(state.id) !== state || isOpenCodeChildState(state)) return
    this.chatUpdatedListeners.forEach((listener) => listener(detail, { turnCompleted }))
  }

  private scheduleUpdate = (chatId: string): void => {
    // Throttle publications: restarting this timer on every token starves the display.
    if (this.updateTimers.has(chatId)) return
    if (isOpenCodeChildState(this.states.get(chatId))) return
    const timer = setTimeout(() => {
      this.updateTimers.delete(chatId)
      const state = this.states.get(chatId)
      if (!state) return
      const window = { startIndex: null, limit: 10 }
      const detail =
        state.messagesHydrated && !state.messagesDirty
          ? Promise.resolve(this.createChatDetailFromState(state, window))
          : this.createChatDetail(state, false, window)
      void detail
        .then((detail) => {
          // The first event of a child session arrives before its session record is known.
          if (isOpenCodeChildState(state)) return
          this.chatUpdatedListeners.forEach((listener) =>
            listener(detail, { turnCompleted: false })
          )
        })
        .catch((error) => console.error('Unable to refresh OpenCode chat update', error))
    }, updateDelayMs)
    this.updateTimers.set(chatId, timer)
  }

  private rememberCanceledOneShotGeneration = (generationId: string): void => {
    this.canceledOneShotGenerationIds.add(generationId)
    const existing = this.canceledOneShotGenerationTimers.get(generationId)
    if (existing) clearTimeout(existing)
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
