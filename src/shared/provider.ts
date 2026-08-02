import type { AppContainerTarget } from './app'

export const providerIds = ['codex', 'copilot'] as const
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
export type ProviderServiceTier = string
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

export type ProviderServiceTierOption = {
  id: ProviderServiceTier
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
  supportedServiceTiers?: ProviderServiceTierOption[]
  defaultServiceTier?: ProviderServiceTier | null
}

export type ProviderSkillScope = 'user' | 'repo' | 'system' | 'admin'

export type ProviderSkill = {
  name: string
  description: string
  shortDescription: string | null
  displayName: string | null
  path: string
  scope: ProviderSkillScope
  enabled: boolean
}

export type ProviderApp = {
  id: string
  name: string
  description: string
  enabled: boolean
}

const providerReasoningEffortDescriptions = {
  low: 'Fast responses with lighter reasoning',
  medium: 'Balances speed and reasoning depth for everyday tasks',
  high: 'Greater reasoning depth for complex problems',
  xhigh: 'Extra high reasoning depth for complex problems'
} satisfies Record<(typeof providerReasoningEfforts)[number], string>

const fallbackFastServiceTier: ProviderServiceTierOption = {
  id: 'fast',
  label: 'Fast',
  description: 'Faster responses with higher credit usage',
  isDefault: false
}

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
    defaultReasoningEffort: 'low',
    supportedServiceTiers: [fallbackFastServiceTier],
    defaultServiceTier: null
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
    defaultReasoningEffort: 'medium',
    supportedServiceTiers: [fallbackFastServiceTier],
    defaultServiceTier: null
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
    defaultReasoningEffort: 'medium',
    supportedServiceTiers: [fallbackFastServiceTier],
    defaultServiceTier: null
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
    defaultReasoningEffort: 'medium',
    supportedServiceTiers: [fallbackFastServiceTier],
    defaultServiceTier: null
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
    defaultReasoningEffort: 'medium',
    supportedServiceTiers: [fallbackFastServiceTier],
    defaultServiceTier: null
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

export const fallbackCopilotModels: ProviderModel[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Let GitHub Copilot choose an available model.',
    isDefault: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: 'medium'
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

export type ProviderAccountRateLimitResetCredits = {
  availableCount: number
}

export type ProviderAccountRateLimitResetOutcome =
  'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'

export type ProviderAccountUsage = {
  updatedAt: number
  statisticsLoaded: boolean
  summary: ProviderAccountUsageSummary | null
  dailyUsageBuckets: ProviderAccountUsageDailyBucket[] | null
  rateLimits: ProviderAccountRateLimit[]
  rateLimitResetCredits: ProviderAccountRateLimitResetCredits | null
  errors: string[]
}

export type ProviderSourceOptions = {
  container?: AppContainerTarget | null
}

export type ProviderUsageOptions = ProviderSourceOptions & {
  includeStatistics?: boolean
}

export type ProviderChatStatus = 'active' | 'error' | 'waitingOnApproval' | 'waitingOnUserInput'
export type ProviderChatPurpose = 'commit'
export type ProviderChatCwdKind = 'directory' | 'gitWorktree'
export type ProviderChatCwdMetadata = {
  kind: ProviderChatCwdKind
  projectCwd: string | null
  branchName: string | null
  worktreeBaseBranchName: string | null
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
  container: AppContainerTarget | null
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
  worktreeBaseBranchName: string | null
  createdAt: number
  updatedAt: number
  status: ProviderChatStatus | null
  pendingApproval: ProviderPendingApproval | null
  pinned: boolean
  done: boolean
  seenUpdatedAt: number | null
  purpose: ProviderChatPurpose | null
  container: AppContainerTarget | null
}

export type ProviderChatListOptions = ProviderSourceOptions & {
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

export type ProviderReviewComment = {
  id: string
  path: string
  comment: string
  line: number
  endLine?: number
  side: 'old' | 'new'
}

export type ProviderReview = {
  id: string
  prompt: string
  comments: ProviderReviewComment[]
}

export type ProviderMessageAttachment =
  | {
      kind: 'image'
      name: string
      path?: string | null
      dataUrl?: string | null
    }
  | {
      kind: 'file'
      name: string
      path?: string | null
    }
  | {
      kind: 'review'
      id: string
      comments: ProviderReviewComment[]
    }

export type ProviderMessage = {
  type: 'message'
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: ProviderMessageAttachment[]
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

export type ProviderToolIcon = 'image-view' | 'image-generation' | 'openai-docs' | 'plan'

export type ProviderToolImage = {
  path: string
}

export type ProviderAgentTerminalTarget = {
  turnId: string
  itemId: string
  processId: string
}

export type ProviderAgentTerminalDataEvent = {
  providerId: ProviderId
  chatId: string
  turnId: string
  itemId: string
  processId: string | null
  source: 'output' | 'input'
  data: string
}

export type ProviderWorkingTool = {
  type: 'tool'
  id: string
  toolId: string
  status: ProviderWorkingToolStatus
  activity: ProviderToolActivity
  icon: ProviderToolIcon | null
  label: string
  command: string | null
  agentTerminal: ProviderAgentTerminalTarget | null
  agentTerminalDisabledReason: string | null
  cwd: string | null
  stdout: string | null
  diffs: ProviderFileDiff[]
  backgroundSessionId: string | null
  finishedBackgroundSessionId: string | null
  rawInput: unknown
  rawOutput: unknown
  images: ProviderToolImage[]
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
  attachments?: ProviderMessageAttachment[]
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
  worktreeBaseBranchName: string | null
  status: ProviderChatStatus | null
  pinned: boolean
  done: boolean
  seenUpdatedAt: number | null
  purpose: ProviderChatPurpose | null
  container: AppContainerTarget | null
  capabilities: ProviderCapabilities
  pendingApproval: ProviderPendingApproval | null
  contextUsage: ProviderChatContextUsage | null
  items: ProviderChatItem[]
}

export type ProviderChatActivitySummary = {
  label: string
  activity: ProviderToolActivity
}

export type ProviderChatUpdateSummary = Omit<ProviderChat, 'providerId' | 'createdAt'> & {
  currentActivity: ProviderChatActivitySummary | null
}

export type ProviderChatUpdatedEvent = {
  providerId: ProviderId
  chatId: string
  detail: ProviderChatDetail
  summary: ProviderChatUpdateSummary
  turnCompleted: boolean
}

export type ProviderWorkingStepUpdate = Omit<ProviderWorkingStep, 'items'> & {
  items: ProviderWorkingItem[]
  workingItemsStartIndex: number
  workingItemsPrefixLastId: string | null
}

export type ProviderChatItemUpdate =
  Exclude<ProviderChatItem, ProviderWorkingStep> | ProviderWorkingStepUpdate

export type ProviderChatDetailUpdate = Omit<ProviderChatDetail, 'items'> & {
  items: ProviderChatItemUpdate[]
  chatItemsStartIndex: number
  chatItemsPrefixLastId: string | null
}

export type ProviderWindowChatUpdatedEvent = Omit<ProviderChatUpdatedEvent, 'detail'> & {
  detail: ProviderChatDetailUpdate | null
  sequence: number
}

export type ProviderImageInput = {
  path: string
}

export type ProviderFileInput = {
  path: string
}

export type ProviderSkillInput = {
  name: string
  path: string
}

export type ProviderAppInput = {
  id: string
  name: string
}

export type ProviderTurnOptions = {
  approvalPolicy: ProviderApprovalPolicy
  approvalsReviewer: ProviderApprovalsReviewer
  container?: AppContainerTarget | null
  cwd?: string
  files?: ProviderFileInput[]
  images?: ProviderImageInput[]
  model: ProviderModelId
  reasoningEffort: ProviderReasoningEffort
  serviceTier: ProviderServiceTier | null
  review?: ProviderReview
  sandboxMode: ProviderSandboxMode
  skills?: ProviderSkillInput[]
}

export type ProviderOneShotOptions = ProviderTurnOptions & {
  generationId?: string
}

export const providerOneShotGenerationCanceledMessage = 'One-shot generation canceled'

export type ProviderApi = {
  login: (providerId: ProviderId, options?: ProviderSourceOptions) => Promise<ProviderLoginResult>
  getUpdateAvailability: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderUpdateAvailability | null>
  updateProvider: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderUpdateAvailability | null>
  getApprovalModes: (providerId: ProviderId) => Promise<ProviderApprovalModeOption[]>
  getSandboxModes: (providerId: ProviderId) => Promise<ProviderSandboxModeOption[]>
  getModels: (providerId: ProviderId, options?: ProviderSourceOptions) => Promise<ProviderModel[]>
  getSkills: (
    providerId: ProviderId,
    cwd?: string | null,
    options?: ProviderSourceOptions
  ) => Promise<ProviderSkill[]>
  getApps: (providerId: ProviderId, options?: ProviderSourceOptions) => Promise<ProviderApp[]>
  getUsage: (
    providerId: ProviderId,
    options?: ProviderUsageOptions
  ) => Promise<ProviderAccountUsage>
  resetRateLimits: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountRateLimitResetOutcome>
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
  writeAgentTerminalInput: (
    providerId: ProviderId,
    chatId: string,
    processId: string,
    data: string
  ) => Promise<void>
  resizeAgentTerminal: (
    providerId: ProviderId,
    chatId: string,
    processId: string,
    cols: number,
    rows: number
  ) => Promise<void>
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
  onAgentTerminalData: (listener: (event: ProviderAgentTerminalDataEvent) => void) => () => void
}

export type ProviderRendererApi = Omit<ProviderApi, 'onChatUpdated' | 'onAgentTerminalData'> & {
  continueChatSummary: (
    providerId: ProviderId,
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatUpdateSummary>
  sendActiveChatMessageSummary: (
    providerId: ProviderId,
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatUpdateSummary>
  stopChatSummary: (providerId: ProviderId, chatId: string) => Promise<ProviderChatUpdateSummary>
  setViewedChat: (providerId: ProviderId | null, chatId: string | null) => void
  acknowledgeChatUpdate: (sequence: number, detailApplied: boolean) => void
  onChatUpdated: (listener: (event: ProviderWindowChatUpdatedEvent) => void) => () => void
  onAgentTerminalData: (listener: (event: ProviderAgentTerminalDataEvent) => void) => () => void
}

export const providerIpcChannels = {
  login: 'provider:login',
  getUpdateAvailability: 'provider:get-update-availability',
  updateProvider: 'provider:update',
  getApprovalModes: 'provider:get-approval-modes',
  getSandboxModes: 'provider:get-sandbox-modes',
  getModels: 'provider:get-models',
  getSkills: 'provider:get-skills',
  getApps: 'provider:get-apps',
  getUsage: 'provider:get-usage',
  resetRateLimits: 'provider:reset-rate-limits',
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
  writeAgentTerminalInput: 'provider:write-agent-terminal-input',
  resizeAgentTerminal: 'provider:resize-agent-terminal',
  agentTerminalData: 'provider:agent-terminal-data',
  markChatDone: 'provider:mark-chat-done',
  markCwdChatsDone: 'provider:mark-cwd-chats-done',
  getCwdNotes: 'provider:get-cwd-notes',
  setCwdNotes: 'provider:set-cwd-notes',
  markChatSeen: 'provider:mark-chat-seen',
  setChatPinned: 'provider:set-chat-pinned',
  continueChatSummary: 'provider:continue-chat-summary',
  sendActiveChatMessageSummary: 'provider:send-active-chat-message-summary',
  stopChatSummary: 'provider:stop-chat-summary',
  chatUpdated: 'provider:chat-updated',
  chatUpdatesReady: 'provider:chat-updates-ready',
  chatUpdatesStopped: 'provider:chat-updates-stopped',
  viewedChatChanged: 'provider:viewed-chat-changed',
  chatUpdateAcknowledged: 'provider:chat-update-acknowledged'
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

export const isProviderServiceTier = (value: unknown): value is ProviderServiceTier =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128
