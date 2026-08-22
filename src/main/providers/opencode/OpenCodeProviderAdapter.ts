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
  type ProviderResourceUpdateOptions,
  type ProviderSandboxModeOption,
  type ProviderSkill,
  type ProviderSourceOptions,
  type ProviderTokenUsageBreakdown,
  type ProviderTurnOptions,
  type ProviderUpdateAvailability,
  type ProviderUsageOptions,
  type ProviderUserInputResponse
} from '../../../shared/provider'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from '../ProviderAdapter'
import {
  disableProviderSkill,
  listDisabledProviderSkills,
  mergeProviderSkills,
  restoreProviderSkill
} from '../providerResources'
import { renderOpenCodeChatItems, type OpenCodeMessageWithParts } from './OpenCodeItemRenderers'
import { mapOpenCodeModels, parseOpenCodeModelId } from './OpenCodeModels'
import { getOpenCodePermissionRules } from './OpenCodePermissions'
import { OpenCodeServerClient } from './OpenCodeServerClient'
import { getOpenCodeUpdateAvailability, updateOpenCodeProvider } from './OpenCodeProviderUpdate'
import { parseOpenCodeSessionEvent } from './OpenCodeEvents'

type OpenCodeClientEntry = {
  server: OpenCodeServerClient
  client: OpencodeClient
  container: AppContainerTarget | null
  eventAbortController: AbortController
}

type QueuedOpenCodeMessage = ProviderPendingMessage & {
  options?: ProviderTurnOptions
}

type OpenCodeChatState = {
  id: string
  directory: string
  container: AppContainerTarget | null
  session: Session | GlobalSession | null
  messages: OpenCodeMessageWithParts[]
  active: boolean
  stopped: boolean
  failed: boolean
  pendingApprovals: PermissionRequest[]
  pendingQuestions: QuestionRequest[]
  queuedMessages: QueuedOpenCodeMessage[]
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
const maxChatTitleLength = 80
const maxPreviewLength = 500

const requireData = <T>(result: { data: T }): T => result.data

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
  const items = renderOpenCodeChatItems(messages, { active: false, stopped: false })
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
    choices: question.options.map((option) => option.label),
    allowFreeform: question.custom ?? true,
    startedAt: Date.now()
  }
}

export class OpenCodeProviderAdapter implements ProviderAdapter {
  id = 'opencode' as const

  private clientEntries = new Map<string, OpenCodeClientEntry>()
  private clientEntryPromises = new Map<string, Promise<OpenCodeClientEntry>>()
  private states = new Map<string, OpenCodeChatState>()
  private sessionContainers = new Map<string, AppContainerTarget | null>()
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingTurnCompletion = new Set<string>()
  private modelContextLimits = new Map<string, number>()
  private oneShotGenerations = new Map<string, OpenCodeOneShotGeneration>()
  private oneShotSessionIds = new Set<string>()
  private canceledOneShotGenerationIds = new Set<string>()
  private canceledOneShotGenerationTimers = new Map<string, ReturnType<typeof setTimeout>>()

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult> => {
    const client = (await this.getClientEntry(options.container)).client
    const providers = requireData(await client.provider.list({}, { throwOnError: true }))
    const connectedNames = providers.all
      .filter((provider) => providers.connected.includes(provider.id))
      .map((provider) => provider.name)
    if (connectedNames.length === 0) {
      throw new Error('OpenCode has no connected model providers. Run `opencode auth login` first.')
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
        })
      })
      const models = mapOpenCodeModels(catalog.providers, catalog.default, config.model)
      return models.length > 0 ? models : fallbackOpenCodeModels
    } catch {
      return fallbackOpenCodeModels
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
    ).map((skill): ProviderSkill => ({
      name: skill.name,
      description: skill.description ?? '',
      shortDescription: skill.description?.trim() || null,
      displayName: null,
      path: skill.location,
      scope: getSkillScope(skill.location, cwd),
      enabled: true
    }))
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
    if (!options.includeStatistics) {
      return {
        updatedAt: Date.now(),
        statisticsLoaded: false,
        summary: emptyUsageSummary,
        dailyUsageBuckets: null,
        rateLimits: [],
        rateLimitResetCredits: null,
        errors: []
      }
    }
    try {
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
      return {
        updatedAt: Date.now(),
        statisticsLoaded: true,
        summary: { ...emptyUsageSummary, lifetimeTokens: lifetimeTokens.toLocaleString() },
        dailyUsageBuckets: null,
        rateLimits: [],
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
        errors: [error instanceof Error ? error.message : 'OpenCode usage is unavailable.']
      }
    }
  }

  resetRateLimits = async (): Promise<'nothingToReset'> => 'nothingToReset'

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
    const chats = await Promise.all(
      visibleSessions.map(async (session) => {
        this.rememberSession(session, entry.container)
        const messages = await this.loadMessages(entry.client, session).catch(() => [])
        const state = this.states.get(session.id)
        if (state) state.messages = messages
        return this.createChat(session, messages, state)
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
    return this.createChatDetail(state)
  }

  setChatTitle = async (chatId: string, title: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
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
          .catch(() => {})
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
          .catch(() => {})
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
        .catch(() => {})
    }
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
          title: truncate(text || 'File attachment', maxChatTitleLength),
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
    if (state.active) return this.queueMessage(state, message, options)
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
    await onForkCreated?.(fork.id)
    await this.sendPrompt(state, message, options)
    return this.createChatDetail(state, true)
  }

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options?.container)
    if (mode === 'queue') return this.queueMessage(state, message, options)
    if (mode === 'interrupt') {
      await this.abortState(state)
      await this.sendPrompt(state, message, options)
      return this.createChatDetail(state, true)
    }

    try {
      await this.sendPrompt(state, message, options)
      return this.createChatDetail(state, true)
    } catch {
      return this.queueMessage(state, message, options, 'steering')
    }
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const index = state.queuedMessages.findIndex((message) => message.id === messageId)
    if (index < 0) throw new Error('Pending message was not found.')
    state.queuedMessages.splice(index, 1)
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options?.container)
    const pending = state.queuedMessages.find((item) => item.id === messageId)
    if (!pending) throw new Error('Pending message was not found.')
    pending.content = message.trim()
    pending.options = options
    pending.createdAt = Date.now()
    this.scheduleUpdate(chatId)
    return this.createChatDetail(state, true)
  }

  steerPendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const pending = this.takeQueuedMessage(state, messageId)
    if (!pending) throw new Error('Pending message was not found.')
    try {
      await this.sendPrompt(state, pending.content, pending.options)
    } catch {
      state.queuedMessages.unshift({ ...pending, kind: 'steering' })
    }
    return this.createChatDetail(state, true)
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const pending = this.takeQueuedMessage(state, messageId)
    if (!pending) throw new Error('Pending message was not found.')
    await this.abortState(state)
    await this.sendPrompt(state, pending.content, pending.options)
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

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const client = (await this.getClientEntry(state.container)).client
    state.stopped = true
    await Promise.allSettled([
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

  dispose = (): void => {
    this.updateTimers.forEach((timer) => clearTimeout(timer))
    this.updateTimers.clear()
    this.pendingTurnCompletion.clear()
    this.oneShotGenerations.forEach((generation) => {
      if (generation.client && generation.sessionId && generation.directory) {
        void generation.client.session
          .abort({ sessionID: generation.sessionId, directory: generation.directory })
          .catch(() => {})
      }
    })
    this.oneShotGenerations.clear()
    this.oneShotSessionIds.clear()
    this.canceledOneShotGenerationIds.clear()
    this.canceledOneShotGenerationTimers.forEach((timer) => clearTimeout(timer))
    this.canceledOneShotGenerationTimers.clear()
    void this.disposeClients()
    this.states.clear()
    this.sessionContainers.clear()
  }

  private disposeClients = async (): Promise<void> => {
    const pendingEntries = Array.from(this.clientEntryPromises.values())
    this.clientEntryPromises.clear()
    const settledPendingEntries = await Promise.allSettled(pendingEntries)
    const entries = new Set(this.clientEntries.values())
    settledPendingEntries.forEach((result) => {
      if (result.status === 'fulfilled') entries.add(result.value)
    })
    await Promise.all(
      Array.from(entries, async (entry) => {
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
    const client = await server.getClient()
    const entry: OpenCodeClientEntry = {
      server,
      client,
      container: storedContainer,
      eventAbortController: new AbortController()
    }
    server.onExit(() => {
      const key = getContainerTargetKey(storedContainer)
      if (this.clientEntries.get(key) === entry) this.clientEntries.delete(key)
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
      if (!entry.eventAbortController.signal.aborted) {
        console.error('OpenCode event stream stopped', error)
      }
    }
  }

  private handleEvent = (entry: OpenCodeClientEntry, globalEvent: unknown): void => {
    const event = parseOpenCodeSessionEvent(globalEvent)
    if (!event) return
    const { type, properties, sessionID } = event
    const sessionInfo = isRecord(properties.info) ? (properties.info as unknown as Session) : null
    if (sessionInfo && isOneShotSession(sessionInfo)) {
      this.states.delete(sessionID)
      if (type === 'session.deleted') this.oneShotSessionIds.delete(sessionID)
      else this.oneShotSessionIds.add(sessionID)
      return
    }
    if (this.oneShotSessionIds.has(sessionID)) {
      if (type === 'session.deleted') this.oneShotSessionIds.delete(sessionID)
      return
    }
    const directory = event.directory ?? this.states.get(sessionID)?.directory
    if (!directory) return
    const state = this.getOrCreateState(sessionID, directory, entry.container)

    if (
      type === 'message.updated' ||
      type === 'message.part.updated' ||
      type === 'session.status'
    ) {
      const status = isRecord(properties.status) ? properties.status : null
      if (type !== 'session.status' || status?.type === 'busy' || status?.type === 'retry') {
        state.active = true
        state.stopped = false
        state.failed = false
      }
    }
    if (type === 'session.updated' && isRecord(properties.info)) {
      state.session = properties.info as unknown as Session
    }
    if (type === 'permission.asked' || type === 'permission.v2.asked') {
      this.scheduleUpdate(sessionID)
      return
    }
    if (type === 'question.asked' || type === 'question.v2.asked') {
      this.scheduleUpdate(sessionID)
      return
    }
    if (type === 'session.error') {
      state.active = false
      state.failed = true
    }
    if (type === 'session.idle') {
      state.active = false
      if (state.queuedMessages.length > 0 && !state.stopped) {
        void this.finishTurnAndDrainQueue(state)
        return
      }
      this.scheduleUpdate(sessionID, true)
      return
    }
    this.scheduleUpdate(sessionID)
  }

  private getOrCreateState = (
    sessionId: string,
    directory: string,
    container: AppContainerTarget | null
  ): OpenCodeChatState => {
    const existing = this.states.get(sessionId)
    if (existing) return existing
    const state: OpenCodeChatState = {
      id: sessionId,
      directory,
      container,
      session: null,
      messages: [],
      active: false,
      stopped: false,
      failed: false,
      pendingApprovals: [],
      pendingQuestions: [],
      queuedMessages: []
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
    state.session = session
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
    if (!state)
      state = this.rememberSession(await this.findSession(entry.client, chatId), entry.container)
    await this.refreshState(state, entry.client)
    return state
  }

  private loadMessages = async (
    client: OpencodeClient,
    session: Session | GlobalSession
  ): Promise<OpenCodeMessageWithParts[]> =>
    requireData(
      await client.session.messages(
        { sessionID: session.id, directory: session.directory },
        { throwOnError: true }
      )
    )

  private refreshState = async (
    state: OpenCodeChatState,
    client: OpencodeClient,
    preserveActive = false
  ): Promise<void> => {
    const [session, messages, statuses, permissions, questions] = await Promise.all([
      client.session
        .get({ sessionID: state.id, directory: state.directory }, { throwOnError: true })
        .then(requireData),
      client.session
        .messages({ sessionID: state.id, directory: state.directory }, { throwOnError: true })
        .then(requireData),
      client.session
        .status({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch(() => ({})),
      client.permission
        .list({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch(() => []),
      client.question
        .list({ directory: state.directory }, { throwOnError: true })
        .then(requireData)
        .catch(() => [])
    ])
    state.session = session
    state.messages = messages
    const status = statuses[state.id]
    if (status?.type === 'busy' || status?.type === 'retry') state.active = true
    else if (!preserveActive) state.active = false
    state.pendingApprovals = permissions.filter((request) => request.sessionID === state.id)
    state.pendingQuestions = questions.filter((request) => request.sessionID === state.id)
  }

  private createChat = (
    session: Session | GlobalSession,
    messages: OpenCodeMessageWithParts[],
    state?: OpenCodeChatState
  ): ProviderChat => ({
    id: session.id,
    providerId: 'opencode',
    title: session.title,
    preview: getMessagePreview(messages),
    cwd: session.directory || null,
    cwdKind: 'directory',
    projectCwd: null,
    branchName: null,
    worktreeBaseBranchName: null,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    status: state ? this.getChatStatus(state) : null,
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
    preserveActive = false
  ): Promise<ProviderChatDetail> => {
    const client = (await this.getClientEntry(state.container)).client
    await this.refreshState(state, client, preserveActive)
    const session = state.session
    if (!session) throw new Error('Unable to load OpenCode session.')
    const pendingItems = state.queuedMessages.map((message): ProviderPendingMessage => ({
      type: message.type,
      id: message.id,
      kind: message.kind,
      content: message.content,
      attachments: message.attachments,
      createdAt: message.createdAt
    }))
    return {
      id: session.id,
      createdAt: session.time.created,
      title: session.title,
      cwd: state.directory,
      cwdKind: 'directory',
      projectCwd: null,
      branchName: null,
      worktreeBaseBranchName: null,
      status: this.getChatStatus(state),
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
      items: renderOpenCodeChatItems(state.messages, {
        active: state.active,
        stopped: state.stopped,
        pendingItems
      })
    }
  }

  private sendPrompt = async (
    state: OpenCodeChatState,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<void> => {
    const text = message.trim()
    const parts = await createPromptParts(text, options)
    if (parts.length === 0) throw new Error('Cannot send an empty OpenCode message.')
    const client = (await this.getClientEntry(state.container)).client
    const model = parseOpenCodeModelId(options?.model ?? fallbackOpenCodeModels[0]!.id)
    await client.session.update(
      {
        sessionID: state.id,
        directory: state.directory,
        permission: getOpenCodePermissionRules(options)
      },
      { throwOnError: true }
    )
    state.active = true
    state.stopped = false
    state.failed = false
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
    this.scheduleUpdate(state.id)
  }

  private abortState = async (state: OpenCodeChatState): Promise<void> => {
    const client = (await this.getClientEntry(state.container)).client
    await client.session.abort(
      { sessionID: state.id, directory: state.directory },
      { throwOnError: true }
    )
    state.active = false
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

  private drainQueue = async (state: OpenCodeChatState): Promise<void> => {
    const pending = state.queuedMessages.shift()
    if (!pending) {
      this.scheduleUpdate(state.id, true)
      return
    }
    try {
      await this.sendPrompt(state, pending.content, pending.options)
    } catch (error) {
      state.failed = true
      state.queuedMessages.unshift(pending)
      this.scheduleUpdate(state.id, true)
      console.error('Unable to send queued OpenCode message', error)
    }
  }

  private finishTurnAndDrainQueue = async (state: OpenCodeChatState): Promise<void> => {
    try {
      await this.emitUpdateNow(state, true)
    } catch (error) {
      this.scheduleUpdate(state.id, true)
      console.error('Unable to emit the completed OpenCode turn', error)
    }
    if (!state.stopped && state.queuedMessages.length > 0) await this.drainQueue(state)
  }

  private emitUpdateNow = async (
    state: OpenCodeChatState,
    turnCompleted = false
  ): Promise<void> => {
    const timer = this.updateTimers.get(state.id)
    if (timer) clearTimeout(timer)
    this.updateTimers.delete(state.id)
    const completed = this.pendingTurnCompletion.delete(state.id) || turnCompleted
    const detail = await this.createChatDetail(state)
    if (this.states.get(state.id) !== state) return
    this.chatUpdatedListeners.forEach((listener) => listener(detail, { turnCompleted: completed }))
  }

  private scheduleUpdate = (chatId: string, turnCompleted = false): void => {
    if (turnCompleted) this.pendingTurnCompletion.add(chatId)
    const existingTimer = this.updateTimers.get(chatId)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      this.updateTimers.delete(chatId)
      const state = this.states.get(chatId)
      if (!state) return
      const completed = this.pendingTurnCompletion.delete(chatId)
      void this.createChatDetail(state)
        .then((detail) => {
          this.chatUpdatedListeners.forEach((listener) =>
            listener(detail, { turnCompleted: completed })
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
