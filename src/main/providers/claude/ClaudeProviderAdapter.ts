import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  type CanUseTool,
  type EffortLevel,
  type Options as ClaudeQueryOptions,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKSessionInfo,
  type SDKUserMessage,
  type SessionKey,
  type SessionMessage,
  type SessionStore,
  type SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'
import type { AppContainerTarget } from '../../../shared/app'
import {
  fallbackClaudeModels,
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
  type ProviderReasoningEffort,
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
import { getHostCommand, getHostExecutableCommand, type HostCommand } from '../../hostProcess'
import type { ProviderAdapter, ProviderChatUpdateMetadata } from '../ProviderAdapter'
import { ProviderClientPool } from '../ProviderClientPool'
import {
  disableProviderSkill,
  listDisabledProviderSkills,
  mergeProviderSkills,
  restoreProviderSkill
} from '../providerResources'
import { getClaudeExecutable } from './ClaudeExecutable'
import {
  isClaudeInternalUserMessage,
  renderClaudeChatItems,
  type ClaudeTranscriptMessage
} from './ClaudeItemRenderers'
import { mapClaudeModels } from './ClaudeModels'
import { getClaudeUpdateAvailability, updateClaudeProvider } from './ClaudeProviderUpdate'
import { discoverClaudeSkills } from './ClaudeSkillDiscovery'
import { applyClaudeStreamEvent, clearClaudeStreamMessages } from './ClaudeStreaming'
import { mapClaudeRateLimits } from './ClaudeUsage'
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
  choices: string[]
  allowFreeform: boolean
  startedAt: number
  resolve: (response: ProviderUserInputResponse) => void
}

type QueuedClaudeMessage = {
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
  createdAt: number
  updatedAt: number
  container: StoredClaudeContainer | null
  cwd: string | null
  metadata: SDKSessionInfo | null
  messages: ClaudeTranscriptMessage[]
  messageIds: Set<string>
  partialMessages: Map<string, ClaudeTranscriptMessage>
  query: Query | null
  input: AsyncMessageQueue<SDKUserMessage> | null
  options: ProviderTurnOptions | undefined
  active: boolean
  stopped: boolean
  failed: boolean
  pendingApprovals: ClaudePendingApproval[]
  pendingUserInputs: ClaudePendingUserInput[]
  queuedMessages: QueuedClaudeMessage[]
  contextUsage: ProviderChatContextUsage | null
  queryReadOnly: boolean | null
  queryModel: string | undefined | null
}

type ClaudeOneShotGeneration = {
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
}

type ClaudeControlQueryProfile = 'account' | 'apps'

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
const interruptCloseGraceMs = 500
const oneShotCancellationRetentionMs = 60_000
const maxTitleLength = 80
const maxPreviewLength = 500
const allowedEffortLevels = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max'])
const readOnlyAllowedTools = [
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'Read',
  'Skill',
  'TodoWrite',
  'WebFetch',
  'WebSearch'
]
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

/** Lets the SDK's own session parser operate on transcripts in a selected container. */
class ClaudeRemoteSessionStore implements SessionStore {
  constructor(private readonly container: StoredClaudeContainer) {}

  private run = async (script: string, args: string[] = []): Promise<string> => {
    const command = await getHostCommand(
      'sh',
      ['-lc', script, 'sele-claude-session-store', ...args],
      { container: this.container, env: process.env }
    )
    return runHostCommand(command)
  }

  listSessions = async (): Promise<Array<{ sessionId: string; mtime: number }>> => {
    const output = await this.run(`
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/*.jsonl; do
  [ -f "$path" ] || continue
  file=\${path##*/}
  session=\${file%.jsonl}
  modified=$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path" 2>/dev/null || echo 0)
  printf '%s\\t%s\\n' "$session" "$modified"
done
`)
    return output.split('\n').flatMap((line) => {
      const [sessionId, seconds] = line.split('\t')
      const mtime = Number.parseInt(seconds ?? '', 10) * 1_000
      return sessionId && Number.isFinite(mtime) ? [{ sessionId, mtime }] : []
    })
  }

  load = async (key: SessionKey): Promise<SessionStoreEntry[] | null> => {
    if (key.subpath) return null
    const output = await this.run(
      `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/"$1.jsonl"; do
  [ -f "$path" ] || continue
  cat "$path"
  exit 0
done
exit 4
`,
      [key.sessionId]
    ).catch((error: unknown) => {
      const code = isRecord(error) ? error.code : undefined
      if (code === 4) return null
      throw error
    })
    if (output === null) return null
    return output.split('\n').flatMap((line): SessionStoreEntry[] => {
      if (!line.trim()) return []
      try {
        const entry: unknown = JSON.parse(line)
        return isRecord(entry) && typeof entry.type === 'string' ? [entry as SessionStoreEntry] : []
      } catch {
        return []
      }
    })
  }

  append = async (key: SessionKey, entries: SessionStoreEntry[]): Promise<void> => {
    if (key.subpath) throw new Error('Claude subagent session writes are unavailable remotely.')
    const payload = entries.map((entry) => JSON.stringify(entry)).join('\n')
    await this.run(
      `
root=\${CLAUDE_CONFIG_DIR:-"$HOME/.claude"}/projects
for path in "$root"/*/"$1.jsonl"; do
  [ -f "$path" ] || continue
  printf '%s\\n' "$2" >> "$path"
  exit 0
done
exit 4
`,
      [key.sessionId, payload]
    )
  }
}

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

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

const getPermissionMode = (options: ProviderTurnOptions | undefined): PermissionMode => {
  if (options?.approvalsReviewer === 'auto_review') return 'auto'
  if (options?.approvalPolicy === 'never') return 'bypassPermissions'
  return 'default'
}

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
  ...('isSynthetic' in message && message.isSynthetic === true ? { isSynthetic: true } : {}),
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
        ? `/${skills[0]!.name}`
        : `Use each of these skills before proceeding: ${skills.map((skill) => skill.name).join(', ')}.`
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

const getAskUserQuestions = (
  input: Record<string, unknown>
): Array<{ question: string; choices: string[]; allowFreeform: boolean }> => {
  if (!Array.isArray(input.questions)) return []
  return input.questions.flatMap((value) => {
    if (!isRecord(value)) return []
    const question = getString(value.question)
    if (!question) return []
    const choices = Array.isArray(value.options)
      ? value.options.flatMap((option): string[] => {
          const label = isRecord(option) ? getString(option.label) : null
          return label ? [label] : []
        })
      : []
    return [{ question, choices, allowFreeform: true }]
  })
}

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
  id = 'claude' as const

  private states = new Map<string, ClaudeSessionState>()
  private sessionContainers = new Map<string, StoredClaudeContainer | null>()
  private chatUpdatedListeners = new Set<
    (detail: ProviderChatDetail, metadata?: ProviderChatUpdateMetadata) => void
  >()
  private updateTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private oneShotGenerations = new Map<string, ClaudeOneShotGeneration>()
  private canceledOneShotGenerationIds = new Set<string>()
  private canceledOneShotGenerationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private hiddenSessionIds = new Set<string>()
  private resumeDropsTurnSupport = new Map<string, Promise<boolean>>()
  private controlQueries = new ProviderClientPool<ClaudeControlQueryEntry>((entry) =>
    this.closeControlQueryEntry(entry)
  )

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult> =>
    this.withControlQuery(options, 'account', async (control) => {
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
    }
  }

  getApprovalModes = async (): Promise<ProviderApprovalModeOption[]> => claudeApprovalModes

  getSandboxModes = async (): Promise<ProviderSandboxModeOption[]> => claudeSandboxModes

  getModels = async (options: ProviderSourceOptions = {}): Promise<ProviderModel[]> => {
    try {
      return await this.withControlQuery(options, 'account', async (control) => {
        const models = await control.supportedModels()
        return models.length > 0 ? mapClaudeModels(models) : fallbackClaudeModels
      })
    } catch {
      return fallbackClaudeModels
    }
  }

  getSkills = async (
    cwd?: string | null,
    options: ProviderSourceOptions = {}
  ): Promise<ProviderSkill[]> => {
    const [discoveredSkills, disabledSkills] = await Promise.all([
      discoverClaudeSkills(cwd, options.container),
      listDisabledProviderSkills(options.container)
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

    const results = await Promise.allSettled(
      changedSkills.map(async (skill) => {
        if (!enabled) return disableProviderSkill(skill, options.container)
        const restored = await restoreProviderSkill(skill.path, options.container)
        if (!restored) throw new Error('Skill was not disabled by Sele')
      })
    )
    const failure = results.find((result) => result.status === 'rejected')
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
    try {
      return await this.withControlQuery(options, 'account', async (control) => {
        const usage = await control.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()
        return {
          updatedAt: Date.now(),
          statisticsLoaded: false,
          summary: emptyUsageSummary,
          dailyUsageBuckets: null,
          rateLimits: mapClaudeRateLimits(usage.rate_limits),
          rateLimitResetCredits: null,
          errors: []
        }
      })
    } catch (error) {
      return {
        updatedAt: Date.now(),
        statisticsLoaded: false,
        summary: emptyUsageSummary,
        dailyUsageBuckets: null,
        rateLimits: [],
        rateLimitResetCredits: null,
        errors: [error instanceof Error ? error.message : 'Claude usage is unavailable.']
      }
    }
  }

  resetRateLimits = async (): Promise<'nothingToReset'> => 'nothingToReset'

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const normalizedContainer = normalizeContainerTarget(options.container)
    const container = isStoredContainer(normalizedContainer) ? normalizedContainer : null
    const offset = Math.max(0, Number.parseInt(options.cursor ?? '0', 10) || 0)
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))

    const sessionStore = container ? new ClaudeRemoteSessionStore(container) : undefined
    const sessions = (await listSessions({ includeProgrammatic: true, sessionStore }))
      .filter((session) => !this.hiddenSessionIds.has(session.sessionId))
      .sort((first, second) => second.lastModified - first.lastModified)
    const page = sessions.slice(offset, offset + limit)
    page.forEach((session) => this.sessionContainers.set(session.sessionId, container))
    return {
      chats: page.map((session) => this.createChatFromMetadata(session)),
      nextCursor: offset + page.length < sessions.length ? String(offset + page.length) : null
    }
  }

  getChat = async (
    chatId: string,
    options: { container?: AppContainerTarget | null } = {}
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, undefined, options.container)
    return this.createChatDetail(state)
  }

  setChatTitle = async (chatId: string, title: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    await renameSession(chatId, title, {
      ...(state.cwd ? { dir: state.cwd } : {}),
      ...(state.container ? { sessionStore: new ClaudeRemoteSessionStore(state.container) } : {})
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
  }

  generateOneShot = async (message: string, options?: ProviderOneShotOptions): Promise<string> => {
    if (!message.trim()) throw new Error('Cannot generate from an empty message')
    const generationId = options?.generationId ?? randomUUID()
    if (this.oneShotGenerations.has(generationId)) {
      throw new Error('Duplicate one-shot generation ID')
    }
    const generation: ClaudeOneShotGeneration = {
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
      let result = ''
      for await (const event of control) {
        if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
        if (event.type === 'result') {
          if (event.subtype === 'success') result = event.result.trim()
          else throw new Error(event.errors.join('\n') || 'Claude generation failed.')
          break
        }
      }
      if (generation.canceled) throw new Error(providerOneShotGenerationCanceledMessage)
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

  startChat = async (
    message: string,
    options?: ProviderTurnOptions,
    onChatCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const id = randomUUID()
    const state = this.createState(id, options)
    this.states.set(id, state)
    this.sessionContainers.set(id, state.container)
    await this.startStateQuery(state, options)
    await onChatCreated?.(id)
    this.sendMessageNow(state, message, options)
    return this.createChatDetail(state)
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    await this.ensureStateQuery(state, options)
    await this.applyTurnOptions(state, options)
    this.sendMessageNow(state, message, options)
    return this.createChatDetail(state)
  }

  continueChatInFork = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions,
    onForkCreated?: (chatId: string) => Promise<void>
  ): Promise<ProviderChatDetail> => {
    const source = await this.ensureState(chatId, options)
    const id = randomUUID()
    const state = this.createState(id, options, source.container)
    state.cwd = source.cwd
    state.messages = source.messages.map((entry) => ({ ...entry, session_id: id }))
    state.messageIds = new Set(state.messages.map((entry) => entry.uuid))
    this.states.set(id, state)
    this.sessionContainers.set(id, state.container)
    await this.startStateQuery(state, options, { forkFrom: chatId })
    await onForkCreated?.(id)
    this.sendMessageNow(state, message, options)
    return this.createChatDetail(state)
  }

  sendActiveChatMessage = async (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    await this.ensureStateQuery(state, options)
    await this.applyTurnOptions(state, options)

    if (!state.active) {
      this.sendMessageNow(state, message, options)
    } else if (mode === 'queue') {
      const queued = this.createQueuedMessage(message, options)
      state.queuedMessages.push(queued)
      this.emitUpdate(state)
    } else if (mode === 'interrupt') {
      await this.interruptWithMessage(state, this.createQueuedMessage(message, options))
    } else {
      const queued = this.createQueuedMessage(message, options)
      this.addUserMessage(state, queued, 'Steering with')
      state.input!.push(createSdkUserMessage(state.id, queued.id, queued.prompt, 'now'))
      this.emitUpdate(state)
    }
    return this.createChatDetail(state)
  }

  deletePendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const index = state.queuedMessages.findIndex((message) => message.id === messageId)
    if (index < 0) throw new Error('The Claude message is no longer queued.')
    state.queuedMessages.splice(index, 1)
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  editPendingMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    const index = state.queuedMessages.findIndex((item) => item.id === messageId)
    if (index < 0) throw new Error('The Claude message is no longer queued.')
    state.queuedMessages[index] = this.createQueuedMessage(message, options, messageId)
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  steerPendingMessage = async (chatId: string, messageId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const index = state.queuedMessages.findIndex((item) => item.id === messageId)
    const pending = state.queuedMessages[index]
    if (!pending) throw new Error('The Claude message is no longer queued.')
    if (state.active && !state.input) throw new Error('Claude session is not connected')
    state.queuedMessages.splice(index, 1)

    if (!state.active) {
      this.sendQueuedMessageNow(state, pending)
      return this.createChatDetail(state)
    }

    this.addUserMessage(state, pending, 'Steering with')
    state.input!.push(createSdkUserMessage(state.id, pending.id, pending.prompt, 'now'))
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  interruptPendingMessage = async (
    chatId: string,
    messageId: string
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    const index = state.queuedMessages.findIndex((item) => item.id === messageId)
    const pending = state.queuedMessages[index]
    if (!pending) throw new Error('The Claude message is no longer queued.')
    state.queuedMessages.splice(index, 1)
    await this.interruptWithMessage(state, pending)
    return this.createChatDetail(state)
  }

  editMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId, options)
    const targetIndex = state.messages.findIndex(
      (entry) => entry.type === 'user' && entry.uuid === messageId
    )
    if (targetIndex < 0) throw new Error('Message cannot be edited')
    const previous = state.messages[targetIndex - 1]
    if (!previous) throw new Error('Claude cannot edit the first message in a session.')

    const resumeDropsTurn = (await this.supportsResumeDropsTurn(state)) ? messageId : undefined

    await this.closeStateQuery(state)
    state.messages = state.messages.slice(0, targetIndex)
    state.messageIds = new Set(state.messages.map((entry) => entry.uuid))
    state.queuedMessages = []
    await this.startStateQuery(state, options, {
      resumeAt: previous.uuid,
      resumeDropsTurn
    })
    this.sendMessageNow(state, message, options)
    return this.createChatDetail(state)
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
    if (response.kind === 'answer') {
      const answer = response.wasFreeform ? response.answer.trim() : response.answer
      if (!answer.trim()) throw new Error('An answer is required.')
      if (!response.wasFreeform && !pending.choices.includes(answer)) {
        throw new Error('The selected Claude answer is no longer available.')
      }
    }
    state.pendingUserInputs.shift()
    pending.resolve(response)
    this.emitUpdate(state)
    return this.createChatDetail(state)
  }

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const state = await this.ensureState(chatId)
    state.stopped = true
    state.active = false
    state.queuedMessages = []
    this.rejectPendingRequests(state)
    const interrupt = state.query?.interrupt().catch(() => undefined)
    if (interrupt) await settleWithin(interrupt, interruptCloseGraceMs)
    await this.closeStateQuery(state)
    this.emitUpdate(state, true)
    return this.createChatDetail(state)
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
    this.states.forEach((state) => {
      void this.closeStateQuery(state)
    })
    this.states.clear()
    this.oneShotGenerations.forEach((generation) => {
      generation.input?.close()
      generation.query?.close()
    })
    this.oneShotGenerations.clear()
    this.canceledOneShotGenerationTimers.forEach((timer) => clearTimeout(timer))
    this.canceledOneShotGenerationTimers.clear()
    this.canceledOneShotGenerationIds.clear()
    this.resumeDropsTurnSupport.clear()
    this.controlQueries.dispose()
    this.hiddenSessionIds.clear()
    this.sessionContainers.clear()
  }

  private closeControlQueryEntry = (entry: ClaudeControlQueryEntry): void => {
    entry.input.close()
    try {
      entry.query.close()
    } catch {
      // The process is already unusable; dropping the entry is sufficient.
    }
  }

  private createControlQueryEntry = async (
    options: ProviderSourceOptions,
    profile: ClaudeControlQueryProfile
  ): Promise<ClaudeControlQueryEntry> => {
    const input = new AsyncMessageQueue<SDKUserMessage>()
    const runtime = await this.getQueryRuntime(options.container)
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
        strictMcpConfig: profile === 'account'
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
        () => false
      )
      if (!healthy) this.controlQueries.invalidate(key, entry)
      throw error
    }
  }

  private getQueryRuntime = async (
    container: AppContainerTarget | null | undefined,
    cwd?: string | null
  ): Promise<ClaudeQueryRuntime> => {
    const normalized = normalizeContainerTarget(container)
    const storedContainer = normalized.kind === 'container' ? normalized : null
    const executable = storedContainer ? 'claude' : getClaudeExecutable()
    const command = await getHostExecutableCommand(executable, [], {
      container: storedContainer,
      cwd: cwd ?? undefined,
      env: process.env
    })
    return { command, container: storedContainer }
  }

  private getBaseQueryOptions = (
    options: ProviderTurnOptions | ProviderOneShotOptions | undefined,
    runtime: Awaited<ReturnType<ClaudeProviderAdapter['getQueryRuntime']>>
  ): ClaudeQueryOptions => {
    const permissionMode = getPermissionMode(options)
    return {
      cwd: runtime.container ? undefined : options?.cwd,
      pathToClaudeCodeExecutable: runtime.command.file,
      env: getRuntimeEnvironment(runtime.command.env),
      spawnClaudeCodeProcess: ({ args, env, signal }) =>
        spawn(runtime.command.file, [...runtime.command.args, ...args], {
          cwd: runtime.command.cwd,
          env: { ...runtime.command.env, ...env },
          signal,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        }),
      additionalDirectories: options?.additionalDirectories,
      model: getClaudeModel(options),
      effort: toEffortLevel(options?.reasoningEffort),
      permissionMode,
      // Claude requires this opt-in when permission mode may later be changed to
      // bypassPermissions on an already-running query. The actual mode remains
      // governed by the user's approval selection above.
      allowDangerouslySkipPermissions: true,
      sandbox: getSandbox(options),
      settings: {
        fastMode: options?.serviceTier === 'fast',
        ...(options?.sandboxMode === 'read-only' ? backgroundFeatureRestrictions : {})
      },
      tools: options?.sandboxMode === 'read-only' ? readOnlyAllowedTools : undefined,
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
      createdAt,
      updatedAt: createdAt,
      container: normalized.kind === 'container' ? normalized : null,
      cwd: options?.cwd ?? null,
      metadata: null,
      messages: [],
      messageIds: new Set(),
      partialMessages: new Map(),
      query: null,
      input: null,
      options,
      active: false,
      stopped: false,
      failed: false,
      pendingApprovals: [],
      pendingUserInputs: [],
      queuedMessages: [],
      contextUsage: null,
      queryReadOnly: null,
      queryModel: null
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
      () => {
        this.resumeDropsTurnSupport.delete(key)
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
    const existing = this.states.get(chatId)
    if (existing) {
      if (options) existing.options = options
      return existing
    }

    const rememberedContainer =
      container ?? options?.container ?? this.sessionContainers.get(chatId) ?? null
    const state = this.createState(chatId, options, rememberedContainer)
    const sessionStore = state.container ? new ClaudeRemoteSessionStore(state.container) : undefined
    const [metadata, messages] = await Promise.all([
      getSessionInfo(chatId, { sessionStore }),
      getSessionMessages(chatId, { includeSystemMessages: true, sessionStore })
    ])
    if (!metadata && messages.length === 0) throw new Error('Claude session was not found.')
    state.metadata = metadata ?? null
    state.createdAt = metadata?.createdAt ?? state.createdAt
    state.updatedAt = metadata?.lastModified ?? state.updatedAt
    state.cwd = metadata?.cwd ?? options?.cwd ?? null
    state.messages = messages.map(toTranscriptMessage)
    state.messageIds = new Set(state.messages.map((message) => message.uuid))
    this.states.set(chatId, state)
    this.sessionContainers.set(chatId, state.container)
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
    await this.closeStateQuery(state)
    state.options = options ?? state.options
    const input = new AsyncMessageQueue<SDKUserMessage>()
    const runtime = await this.getQueryRuntime(state.container, state.cwd ?? state.options?.cwd)
    const queryReadOnly = state.options?.sandboxMode === 'read-only'
    const isNew = state.messages.length === 0 && !startOptions.forkFrom && !startOptions.resumeAt
    const control = query({
      prompt: input,
      options: {
        ...this.getBaseQueryOptions(state.options, runtime),
        canUseTool: this.createPermissionHandler(state),
        ...(isNew ? { sessionId: state.id } : { resume: startOptions.forkFrom ?? state.id }),
        ...(startOptions.forkFrom ? { forkSession: true, sessionId: state.id } : {}),
        ...(startOptions.resumeAt ? { resumeSessionAt: startOptions.resumeAt } : {}),
        ...(startOptions.resumeDropsTurn ? { resumeDropsTurn: startOptions.resumeDropsTurn } : {})
      }
    })
    state.input = input
    state.query = control
    state.queryReadOnly = queryReadOnly
    state.queryModel = getClaudeModel(state.options)
    void this.consumeStateQuery(state, control)
  }

  private closeStateQuery = async (state: ClaudeSessionState): Promise<void> => {
    const control = state.query
    if (!control) return
    this.rejectPendingRequests(state)
    state.input?.close()
    state.query = null
    state.input = null
    state.active = false
    state.queryReadOnly = null
    state.queryModel = null
    state.partialMessages.clear()
    try {
      control.close()
    } catch {
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
      const interrupt = state.active ? state.query.interrupt().catch(() => undefined) : null
      if (interrupt) await settleWithin(interrupt, interruptCloseGraceMs)
      await this.startStateQuery(state, options)
      return
    }
    const control = state.query
    const model = getClaudeModel(options)
    const modelChanged = state.queryModel !== model
    await Promise.all([
      ...(modelChanged ? [control.setModel(model)] : []),
      control.setPermissionMode(getPermissionMode(options)),
      control.applyFlagSettings({
        effortLevel: toEffortLevel(options.reasoningEffort) ?? null,
        fastMode: options.serviceTier === 'fast',
        sandbox: getSandbox(options)
      })
    ])
    if (modelChanged && state.query === control) state.queryModel = model
  }

  private createPermissionHandler =
    (state: ClaudeSessionState): CanUseTool =>
    async (toolName, input, permissionOptions): Promise<PermissionResult> => {
      if (toolName === 'AskUserQuestion') {
        const questions = getAskUserQuestions(input)
        const answers: Record<string, string> = {}
        for (const question of questions) {
          const response = await new Promise<ProviderUserInputResponse>((resolve) => {
            state.pendingUserInputs.push({
              id: `${permissionOptions.toolUseID}:${state.pendingUserInputs.length}`,
              question: question.question,
              choices: question.choices,
              allowFreeform: question.allowFreeform,
              startedAt: Date.now(),
              resolve
            })
            this.emitUpdate(state)
          })
          if (response.kind === 'cancel') {
            return { behavior: 'deny', message: 'The user canceled the question.' }
          }
          answers[question.question] = response.answer
        }
        return { behavior: 'allow', updatedInput: { ...input, answers } }
      }

      if (state.options?.sandboxMode === 'read-only' && !readOnlyAllowedTools.includes(toolName)) {
        return { behavior: 'deny', message: 'This chat is in read-only mode.' }
      }
      if (state.options?.approvalPolicy === 'never') {
        return { behavior: 'allow', updatedInput: input }
      }
      if (state.options?.approvalsReviewer === 'auto_review') {
        return {
          behavior: 'deny',
          message: 'Claude auto-mode could not approve this tool request.'
        }
      }

      return new Promise<PermissionResult>((resolve) => {
        state.pendingApprovals.push({
          id: permissionOptions.toolUseID,
          toolName,
          input,
          title: permissionOptions.title ?? null,
          description: permissionOptions.description ?? null,
          reason: permissionOptions.decisionReason ?? null,
          startedAt: Date.now(),
          resolve
        })
        this.emitUpdate(state)
      })
    }

  private consumeStateQuery = async (state: ClaudeSessionState, control: Query): Promise<void> => {
    try {
      for await (const event of control) {
        if (state.query !== control) break
        if (await this.handleQueryEvent(state, control, event)) break
      }
    } catch (error) {
      if (state.query !== control) return
      state.failed = true
      state.active = false
      const content = error instanceof Error ? error.message : String(error)
      this.addTranscriptMessage(state, {
        type: 'system',
        uuid: randomUUID(),
        session_id: state.id,
        message: { content },
        parent_tool_use_id: null
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
              parent_tool_use_id: null
            })
            this.emitUpdate(state, true)
          }
        }
        await this.closeStateQuery(state)
      }
    }
  }

  private handleQueryEvent = async (
    state: ClaudeSessionState,
    control: Query,
    event: SDKMessage
  ): Promise<boolean> => {
    if (event.type === 'stream_event') {
      if (applyClaudeStreamEvent(state.partialMessages, event)) this.queueUpdate(state)
      return false
    }
    if (event.type === 'user' || event.type === 'assistant') {
      if (event.type === 'assistant') clearClaudeStreamMessages(state.partialMessages, event)
      this.addTranscriptMessage(state, toTranscriptMessage(event))
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
    if (event.type !== 'result') return false

    state.partialMessages.clear()

    const wasStopped = state.stopped
    state.failed = !wasStopped && event.subtype !== 'success'
    if (state.failed) {
      const errors = 'errors' in event ? event.errors : []
      const content = errors.join('\n').trim()
      if (content) {
        this.addTranscriptMessage(state, {
          type: 'system',
          uuid: event.uuid,
          session_id: event.session_id,
          message: { content },
          parent_tool_use_id: null
        })
      }
    }

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
      .getContextUsage()
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
      .catch(() => undefined)

    const queued = state.failed ? undefined : state.queuedMessages.shift()
    if (queued) {
      void refreshContextUsage
      this.sendQueuedMessageNow(state, queued)
      return false
    } else {
      await settleWithin(refreshContextUsage, contextUsageCloseGraceMs)
      if (state.query === control) {
        state.active = false
        state.stopped = wasStopped
        this.emitUpdate(state, true)
      }
      return true
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

  private sendMessageNow = (
    state: ClaudeSessionState,
    message: string,
    options?: ProviderTurnOptions
  ): void => this.sendQueuedMessageNow(state, this.createQueuedMessage(message, options))

  private sendQueuedMessageNow = (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage
  ): void => {
    if (!state.input) throw new Error('Claude session is not connected')
    state.active = true
    state.stopped = false
    state.failed = false
    state.options = message.options ?? state.options
    this.addUserMessage(state, message)
    state.input.push(createSdkUserMessage(state.id, message.id, message.prompt))
    this.emitUpdate(state)
  }

  private interruptWithMessage = async (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage
  ): Promise<void> => {
    state.queuedMessages.unshift(message)
    this.emitUpdate(state)
    const control = state.query
    const interrupted = control
      ? await control.interrupt().then(
          () => true,
          () => false
        )
      : false
    const queuedIndex = state.queuedMessages.findIndex((queued) => queued.id === message.id)
    if (queuedIndex < 0) return
    if (interrupted && state.query === control && state.active) return

    state.queuedMessages.splice(queuedIndex, 1)
    await this.closeStateQuery(state)
    await this.ensureStateQuery(state, message.options)
    await this.applyTurnOptions(state, message.options)
    this.sendQueuedMessageNow(state, message)
  }

  private addUserMessage = (
    state: ClaudeSessionState,
    message: QueuedClaudeMessage,
    label: string | null = null
  ): void => {
    this.addTranscriptMessage(state, {
      type: 'user',
      uuid: message.id,
      session_id: state.id,
      message: { role: 'user', content: message.content },
      parent_tool_use_id: null,
      timestamp: new Date(message.createdAt).toISOString(),
      attachments: message.attachments,
      label
    })
  }

  private addTranscriptMessage = (
    state: ClaudeSessionState,
    message: ClaudeTranscriptMessage
  ): void => {
    if (state.messageIds.has(message.uuid)) return
    state.messageIds.add(message.uuid)
    state.messages.push(message)
  }

  private rejectPendingRequests = (state: ClaudeSessionState): void => {
    state.pendingApprovals
      .splice(0)
      .forEach((pending) => pending.resolve({ behavior: 'deny', message: 'The chat was stopped.' }))
    state.pendingUserInputs.splice(0).forEach((pending) => pending.resolve({ kind: 'cancel' }))
  }

  private getTitle = (state: ClaudeSessionState): string => {
    const metadataTitle = state.metadata?.customTitle || state.metadata?.summary
    if (metadataTitle?.trim()) return truncate(metadataTitle.trim(), maxTitleLength)
    const firstUserMessage = state.messages.find(
      (message) => message.type === 'user' && !isClaudeInternalUserMessage(message)
    )
    const firstPrompt = firstUserMessage
      ? getTextFromContent(getMessageContent(firstUserMessage.message))
      : ''
    return firstPrompt ? truncate(firstPrompt, maxTitleLength) : 'Claude session'
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
          startedAt: pending.startedAt
        }
      : null
  }

  private getPendingMessages = (state: ClaudeSessionState): ProviderPendingMessage[] =>
    state.queuedMessages.map((message) => ({
      type: 'pendingMessage',
      id: message.id,
      kind: 'queued',
      content: message.content,
      attachments: message.attachments,
      createdAt: message.createdAt
    }))

  private createChatDetail = (state: ClaudeSessionState): ProviderChatDetail => ({
    id: state.id,
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
          : state.active
            ? 'active'
            : null,
    pinned: false,
    pinnedOrder: null,
    done: false,
    seenUpdatedAt: null,
    purpose: null,
    container: state.container,
    capabilities: { editMessages: true, activeMessages: true },
    pendingApproval: this.getPendingApproval(state),
    pendingUserInput: this.getPendingUserInput(state),
    contextUsage: state.contextUsage,
    items: renderClaudeChatItems([...state.messages, ...state.partialMessages.values()], {
      active: state.active || state.pendingUserInputs.length > 0,
      stopped: state.stopped,
      pendingItems: this.getPendingMessages(state)
    })
  })

  private createChatFromState = (state: ClaudeSessionState): ProviderChat => {
    const detail = this.createChatDetail(state)
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
      pendingApproval: detail.pendingApproval,
      pinned: false,
      pinnedOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: state.container
    }
  }

  private createChatFromMetadata = (metadata: SDKSessionInfo): ProviderChat => {
    const state = this.states.get(metadata.sessionId)
    if (state) return this.createChatFromState(state)
    const title = truncate(
      metadata.customTitle || metadata.summary || 'Claude session',
      maxTitleLength
    )
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
      pendingApproval: null,
      pinned: false,
      pinnedOrder: null,
      done: false,
      seenUpdatedAt: null,
      purpose: null,
      container: this.sessionContainers.get(metadata.sessionId) ?? null
    }
  }

  private queueUpdate = (state: ClaudeSessionState, conversationChanged = true): void => {
    if (conversationChanged) state.updatedAt = Date.now()
    if (this.updateTimers.has(state.id)) return
    const timer = setTimeout(() => {
      this.updateTimers.delete(state.id)
      this.emitUpdate(state, false, false)
    }, updateDelayMs)
    this.updateTimers.set(state.id, timer)
  }

  private emitUpdate = (
    state: ClaudeSessionState,
    turnCompleted = false,
    conversationChanged = true
  ): void => {
    if (conversationChanged) state.updatedAt = Date.now()
    const timer = this.updateTimers.get(state.id)
    if (timer) clearTimeout(timer)
    this.updateTimers.delete(state.id)
    if (this.hiddenSessionIds.has(state.id) || this.states.get(state.id) !== state) return
    const detail = this.createChatDetail(state)
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
