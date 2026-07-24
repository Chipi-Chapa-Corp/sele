export const providerIds = ['codex'] as const
export const providerModelIds = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
] as const
export const providerReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const

export type ProviderId = (typeof providerIds)[number]
export type ProviderModelId = string
export type ProviderReasoningEffort = string
export type ProviderApprovalPolicy = 'on-request' | 'on-failure' | 'never'
export type ProviderApprovalsReviewer = 'user' | 'auto_review'
export type ProviderApprovalMode = 'ask-user' | 'auto-review' | 'never'
export type ProviderSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ProviderActiveSendMode = 'steer' | 'queue' | 'interrupt'

export type ProviderApprovalModeOption = {
  id: ProviderApprovalMode
  label: string
  description: string
  isDefault: boolean
}

export type ProviderSandboxModeOption = {
  id: ProviderSandboxMode
  label: string
  description: string
  isDefault: boolean
}

export type ProviderReasoningEffortOption = {
  id: ProviderReasoningEffort
  label: string
  description: string
  isDefault: boolean
}

export type ProviderModel = {
  id: ProviderModelId
  label: string
  description: string
  isDefault: boolean
  supportedReasoningEfforts: ProviderReasoningEffortOption[]
  defaultReasoningEffort: ProviderReasoningEffort
}

const providerReasoningEffortDescriptions = {
  low: 'Fast responses with lighter reasoning',
  medium: 'Balances speed and reasoning depth for everyday tasks',
  high: 'Greater reasoning depth for complex problems',
  xhigh: 'Extra high reasoning depth for complex problems'
} satisfies Record<(typeof providerReasoningEfforts)[number], string>

export const fallbackProviderModels: ProviderModel[] = [
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    description: 'Latest frontier agentic coding model.',
    isDefault: false,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'low'
    })),
    defaultReasoningEffort: 'low'
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    description: 'Balanced agentic coding model for everyday work.',
    isDefault: false,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'medium'
    })),
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Fast and affordable agentic coding model.',
    isDefault: false,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'medium'
    })),
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    description: 'Frontier model for complex coding, research, and real-world work.',
    isDefault: true,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'medium'
    })),
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Strong model for everyday coding.',
    isDefault: false,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'medium'
    })),
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
    isDefault: false,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'medium'
    })),
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3 Spark',
    description: 'Ultra-fast coding model.',
    isDefault: false,
    supportedReasoningEfforts: providerReasoningEfforts.map((reasoningEffort) => ({
      id: reasoningEffort,
      label: reasoningEffort,
      description: providerReasoningEffortDescriptions[reasoningEffort],
      isDefault: reasoningEffort === 'high'
    })),
    defaultReasoningEffort: 'high'
  }
]

export const fallbackProviderApprovalModes: ProviderApprovalModeOption[] = [
  {
    id: 'ask-user',
    label: 'Ask me',
    description: 'Ask you before approval-gated actions.',
    isDefault: true
  },
  {
    id: 'auto-review',
    label: 'Auto-review',
    description: 'Send eligible approval prompts to the reviewer subagent.',
    isDefault: false
  },
  {
    id: 'never',
    label: 'Never ask',
    description: 'Run without approval prompts.',
    isDefault: false
  }
]

export const fallbackProviderSandboxModes: ProviderSandboxModeOption[] = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Allow reads without workspace writes.',
    isDefault: false
  },
  {
    id: 'workspace-write',
    label: 'Workspace write',
    description: 'Allow reads and writes inside the workspace sandbox.',
    isDefault: true
  },
  {
    id: 'danger-full-access',
    label: 'Full access',
    description: 'Disable filesystem sandbox restrictions.',
    isDefault: false
  }
]

export type ProviderAccount = {
  label: string
}

export type ProviderLoginResult =
  | { status: 'authenticated'; account: ProviderAccount }
  | { status: 'pending'; loginId: string; authUrl: string }
  | { status: 'notRequired' }

export type ProviderUpdateAvailability = {
  currentVersion: string
  latestVersion: string
}

export type ProviderTokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export type ProviderChatContextUsage = {
  usedTokens: number
  maxTokens: number | null
  total: ProviderTokenUsageBreakdown
  last: ProviderTokenUsageBreakdown
  updatedAt: number
}

export type ProviderAccountUsageSummary = {
  lifetimeTokens: string | null
  peakDailyTokens: string | null
  longestRunningTurnSec: string | null
  currentStreakDays: string | null
  longestStreakDays: string | null
}

export type ProviderAccountUsageDailyBucket = {
  startDate: string
  tokens: string
}

export type ProviderAccountRateLimitKind = 'primary' | 'secondary'

export type ProviderAccountRateLimit = {
  id: string | null
  label: string
  kind: ProviderAccountRateLimitKind
  usedPercent: number
  windowMinutes: number | null
  resetsAt: number | null
}

export type ProviderAccountUsage = {
  updatedAt: number
  statisticsLoaded: boolean
  summary: ProviderAccountUsageSummary | null
  dailyUsageBuckets: ProviderAccountUsageDailyBucket[] | null
  rateLimits: ProviderAccountRateLimit[]
  errors: string[]
}

export type ProviderUsageOptions = {
  includeStatistics?: boolean
}

export type ProviderChatStatus = 'active' | 'error' | 'waitingOnApproval' | 'waitingOnUserInput'
export type ProviderChatPurpose = 'commit'
export type ProviderChatCwdKind = 'directory' | 'gitWorktree'
export type ProviderChatCwdMetadata = {
  kind: ProviderChatCwdKind
  projectCwd: string | null
  branchName: string | null
}

export type ProviderApprovalDecision = 'allow' | 'deny'

export type ProviderPendingApproval = {
  id: string
  type: 'command' | 'fileChange'
  command: string | null
  cwd: string | null
  reason: string | null
  startedAt: number
}

export type ProviderChatMetadata = {
  id: string
  pinned: boolean
  done: boolean
  seenUpdatedAt: number | null
  purpose: ProviderChatPurpose | null
}

export type ProviderCwdNote = {
  id: string
  text: string
  createdAt: number
}

export type ProviderChat = {
  id: string
  providerId: ProviderId
  title: string
  preview: string
  cwd: string | null
  cwdKind: ProviderChatCwdKind
  projectCwd: string | null
  branchName: string | null
  createdAt: number
  updatedAt: number
  status: ProviderChatStatus | null
  pendingApproval: ProviderPendingApproval | null
  pinned: boolean
  done: boolean
  seenUpdatedAt: number | null
  purpose: ProviderChatPurpose | null
}

export type ProviderChatListOptions = {
  cursor?: string | null
  limit?: number | null
}

export type ProviderChatPage = {
  chats: ProviderChat[]
  nextCursor: string | null
}

export type ProviderCapabilities = {
  editMessages: boolean
  activeMessages: boolean
}

export type ProviderMessage = {
  type: 'message'
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: number | null
  label?: string | null
  model?: ProviderModelId | null
}

export type ProviderWorkingMessage = {
  type: 'message'
  id: string
  content: string
}

export type ProviderFileDiff = {
  path: string
  kind: 'edit' | 'create' | 'delete'
  diff: string
}

export type ProviderToolActivity =
  | 'read'
  | 'search'
  | 'git'
  | 'edit'
  | 'create'
  | 'delete'
  | 'npm'
  | 'npx'
  | 'script'
  | 'command'
  | 'other'

export type ProviderWorkingToolStatus = 'running' | 'finished'

export type ProviderWorkingTool = {
  type: 'tool'
  id: string
  toolId: string
  status: ProviderWorkingToolStatus
  activity: ProviderToolActivity
  label: string
  command: string | null
  stdout: string | null
  diffs: ProviderFileDiff[]
  backgroundSessionId: string | null
  finishedBackgroundSessionId: string | null
  rawInput: unknown
  rawOutput: unknown
  raw: unknown[]
}

export type ProviderWorkingToolGroup = {
  type: 'toolGroup'
  id: string
  label: string
  tools: ProviderWorkingTool[]
}

export type ProviderWorkingItem =
  ProviderWorkingMessage | ProviderWorkingTool | ProviderWorkingToolGroup

export type ProviderWorkingStep = {
  type: 'working'
  id: string
  status: 'working' | 'worked' | 'stopped' | 'queued'
  items: ProviderWorkingItem[]
}

export type ProviderPendingMessageKind = 'steering' | 'queued'

export type ProviderPendingMessage = {
  type: 'pendingMessage'
  id: string
  kind: ProviderPendingMessageKind
  content: string
  createdAt?: number | null
}

export type ProviderContextCompaction = {
  type: 'contextCompaction'
  id: string
}

export type ProviderChatItem =
  ProviderMessage | ProviderWorkingStep | ProviderPendingMessage | ProviderContextCompaction

export type ProviderChatDetail = {
  id: string
  title: string
  cwd: string | null
  cwdKind: ProviderChatCwdKind
  projectCwd: string | null
  branchName: string | null
  status: ProviderChatStatus | null
  pinned: boolean
  done: boolean
  seenUpdatedAt: number | null
  purpose: ProviderChatPurpose | null
  capabilities: ProviderCapabilities
  pendingApproval: ProviderPendingApproval | null
  contextUsage: ProviderChatContextUsage | null
  items: ProviderChatItem[]
}

export type ProviderChatUpdatedEvent = {
  providerId: ProviderId
  chatId: string
  detail: ProviderChatDetail
}

export type ProviderTurnOptions = {
  approvalPolicy: ProviderApprovalPolicy
  approvalsReviewer: ProviderApprovalsReviewer
  cwd?: string
  model: ProviderModelId
  reasoningEffort: ProviderReasoningEffort
  sandboxMode: ProviderSandboxMode
}

export type ProviderOneShotOptions = ProviderTurnOptions & {
  generationId?: string
}

export const providerOneShotGenerationCanceledMessage = 'One-shot generation canceled'

export type ProviderApi = {
  login: (providerId: ProviderId) => Promise<ProviderLoginResult>
  getUpdateAvailability: (providerId: ProviderId) => Promise<ProviderUpdateAvailability | null>
  updateProvider: (providerId: ProviderId) => Promise<ProviderUpdateAvailability | null>
  getApprovalModes: (providerId: ProviderId) => Promise<ProviderApprovalModeOption[]>
  getSandboxModes: (providerId: ProviderId) => Promise<ProviderSandboxModeOption[]>
  getModels: (providerId: ProviderId) => Promise<ProviderModel[]>
  getUsage: (
    providerId: ProviderId,
    options?: ProviderUsageOptions
  ) => Promise<ProviderAccountUsage>
  getChats: (providerId: ProviderId, options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (providerId: ProviderId, chatId: string) => Promise<ProviderChatDetail>
  generateOneShot: (
    providerId: ProviderId,
    message: string,
    options?: ProviderOneShotOptions
  ) => Promise<string>
  cancelOneShot: (providerId: ProviderId, generationId: string) => Promise<void>
  startChat: (
    providerId: ProviderId,
    message: string,
    options?: ProviderTurnOptions,
    purpose?: ProviderChatPurpose
  ) => Promise<ProviderChatDetail>
  continueChat: (
    providerId: ProviderId,
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  continueChatInFork: (
    providerId: ProviderId,
    chatId: string,
    message: string,
    purpose: ProviderChatPurpose,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  sendActiveChatMessage: (
    providerId: ProviderId,
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  deletePendingMessage: (
    providerId: ProviderId,
    chatId: string,
    messageId: string
  ) => Promise<ProviderChatDetail>
  editPendingMessage: (
    providerId: ProviderId,
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  interruptPendingMessage: (
    providerId: ProviderId,
    chatId: string,
    messageId: string
  ) => Promise<ProviderChatDetail>
  editMessage: (
    providerId: ProviderId,
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  resolveApproval: (
    providerId: ProviderId,
    chatId: string,
    decision: ProviderApprovalDecision
  ) => Promise<ProviderChatDetail>
  stopChat: (providerId: ProviderId, chatId: string) => Promise<ProviderChatDetail>
  markChatDone: (
    providerId: ProviderId,
    chatId: string,
    done?: boolean
  ) => Promise<ProviderChatMetadata>
  markCwdChatsDone: (providerId: ProviderId, cwd: string | null) => Promise<ProviderChatMetadata[]>
  getCwdNotes: (providerId: ProviderId, cwd: string | null) => Promise<ProviderCwdNote[]>
  setCwdNotes: (
    providerId: ProviderId,
    cwd: string | null,
    notes: ProviderCwdNote[]
  ) => Promise<ProviderCwdNote[]>
  markChatSeen: (
    providerId: ProviderId,
    chatId: string,
    seenUpdatedAt: number
  ) => Promise<ProviderChatMetadata>
  setChatPinned: (
    providerId: ProviderId,
    chatId: string,
    pinned: boolean
  ) => Promise<ProviderChatMetadata>
  onChatUpdated: (listener: (event: ProviderChatUpdatedEvent) => void) => () => void
}

export const providerIpcChannels = {
  login: 'provider:login',
  getUpdateAvailability: 'provider:get-update-availability',
  updateProvider: 'provider:update',
  getApprovalModes: 'provider:get-approval-modes',
  getSandboxModes: 'provider:get-sandbox-modes',
  getModels: 'provider:get-models',
  getUsage: 'provider:get-usage',
  getChats: 'provider:get-chats',
  getChat: 'provider:get-chat',
  generateOneShot: 'provider:generate-one-shot',
  cancelOneShot: 'provider:cancel-one-shot',
  startChat: 'provider:start-chat',
  continueChat: 'provider:continue-chat',
  continueChatInFork: 'provider:continue-chat-in-fork',
  sendActiveChatMessage: 'provider:send-active-chat-message',
  deletePendingMessage: 'provider:delete-pending-message',
  editPendingMessage: 'provider:edit-pending-message',
  interruptPendingMessage: 'provider:interrupt-pending-message',
  editMessage: 'provider:edit-message',
  resolveApproval: 'provider:resolve-approval',
  stopChat: 'provider:stop-chat',
  markChatDone: 'provider:mark-chat-done',
  markCwdChatsDone: 'provider:mark-cwd-chats-done',
  getCwdNotes: 'provider:get-cwd-notes',
  setCwdNotes: 'provider:set-cwd-notes',
  markChatSeen: 'provider:mark-chat-seen',
  setChatPinned: 'provider:set-chat-pinned',
  chatUpdated: 'provider:chat-updated'
} as const

export const isProviderId = (value: unknown): value is ProviderId =>
  providerIds.includes(value as ProviderId)

export const isProviderApprovalPolicy = (value: unknown): value is ProviderApprovalPolicy =>
  value === 'on-request' || value === 'on-failure' || value === 'never'

export const isProviderApprovalsReviewer = (value: unknown): value is ProviderApprovalsReviewer =>
  value === 'user' || value === 'auto_review'

export const isProviderApprovalMode = (value: unknown): value is ProviderApprovalMode =>
  value === 'ask-user' || value === 'auto-review' || value === 'never'

export const isProviderSandboxMode = (value: unknown): value is ProviderSandboxMode =>
  value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'

export const isProviderActiveSendMode = (value: unknown): value is ProviderActiveSendMode =>
  value === 'steer' || value === 'queue' || value === 'interrupt'

export const isProviderModelId = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

export const isProviderReasoningEffort = (value: unknown): value is ProviderReasoningEffort =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 64
