import type { AppContainerTarget } from './app'

export const providerIds = ['codex', 'claude', 'copilot', 'opencode'] as const
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
export type ProviderAgentMode = 'interactive' | 'autopilot'

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

export type ProviderAgentModeOption = {
  id: ProviderAgentMode
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
  usageScope?: string
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
  callable: boolean
  skillNames: string[]
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

export const fallbackOpenCodeModels: ProviderModel[] = [
  {
    id: 'opencode/big-pickle',
    label: 'Big Pickle',
    description: 'Use OpenCode Zen’s default coding model.',
    isDefault: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: 'medium'
  }
]

const fallbackClaudeReasoningEfforts: ProviderReasoningEffortOption[] = [
  {
    id: 'low',
    label: 'low',
    description: 'Fast responses with lighter reasoning',
    isDefault: false
  },
  {
    id: 'medium',
    label: 'medium',
    description: 'Balances speed and reasoning depth',
    isDefault: false
  },
  {
    id: 'high',
    label: 'high',
    description: 'Greater reasoning depth for complex problems',
    isDefault: true
  },
  {
    id: 'xhigh',
    label: 'xhigh',
    description: 'Extra high reasoning depth for complex problems',
    isDefault: false
  },
  {
    id: 'max',
    label: 'max',
    description: 'Maximum reasoning depth on supported Claude models',
    isDefault: false
  }
]

export const fallbackClaudeModels: ProviderModel[] = [
  {
    id: 'default',
    label: 'Default (recommended)',
    description: 'Use the model selected by Claude Code.',
    isDefault: true,
    supportedReasoningEfforts: fallbackClaudeReasoningEfforts,
    defaultReasoningEffort: 'high'
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    description: 'Use the latest available Claude Sonnet model.',
    isDefault: false,
    supportedReasoningEfforts: fallbackClaudeReasoningEfforts,
    defaultReasoningEffort: 'high'
  },
  {
    id: 'opus',
    label: 'Opus',
    description: 'Use the latest available Claude Opus model.',
    isDefault: false,
    supportedReasoningEfforts: fallbackClaudeReasoningEfforts,
    defaultReasoningEffort: 'high',
    supportedServiceTiers: [fallbackFastServiceTier],
    defaultServiceTier: null
  },
  {
    id: 'haiku',
    label: 'Haiku',
    description: 'Use the latest available Claude Haiku model.',
    isDefault: false,
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

export type ProviderManagedAccount = {
  id: string
  name: string
  active: boolean
}

export const providerDefaultAccountId = 'default'

export type ProviderAccountConfiguration = {
  available: boolean
  unavailableMessage: string | null
  accounts: ProviderManagedAccount[]
}

export type ProviderAccountCreation = {
  accountId: string
}

export type ProviderAccountLoginCompletion = {
  success: boolean
  error: string | null
  configuration: ProviderAccountConfiguration
}

export type ProviderLoginResult =
  | { status: 'authenticated'; account: ProviderAccount }
  | { status: 'pending'; loginId: string; authUrl: string; userCode?: string }
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
  displayLabel?: string
  usageScope?: string
  kind: ProviderAccountRateLimitKind
  usedPercent: number
  windowMinutes: number | null
  resetsAt: number | null
}

export type ProviderAccountRateLimitResetCredits = {
  availableCount: number
  credits: ProviderAccountRateLimitResetCredit[] | null
}

export type ProviderAccountRateLimitResetCredit = {
  id: string
  expiresAt: number | null
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
  forceRefresh?: boolean
}

export type ProviderUpdateOptions = ProviderSourceOptions & {
  stopActiveChats?: boolean
}

export type ProviderUpdateImpact = {
  activeChatCount: number
}

export type ProviderResourceUpdateOptions = ProviderSourceOptions & {
  deferRefresh?: boolean
  knownApp?: ProviderApp
  knownSkills?: ProviderSkill[]
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

export type ProviderUserInputChoice = {
  label: string
  description: string | null
}

export type ProviderPendingUserInput = {
  id: string
  question: string
  choices: ProviderUserInputChoice[]
  allowFreeform: boolean
  startedAt: number
}

export type ProviderUserInputResponse =
  | {
      kind: 'answer'
      answer: string
      wasFreeform: boolean
    }
  | {
      kind: 'cancel'
    }

export type ProviderChatMetadata = {
  id: string
  pinned: boolean
  sidebarOrder: number | null
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
  sidebarOrder: number | null
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
  /** Provider-native mutation target. Null means this rendered user message is not editable. */
  editTargetId?: string | null
  role: 'user' | 'assistant'
  content: string
  contentLoaded?: boolean
  contentCharacterCount?: number
  contentTruncated?: boolean
  payloadCharacterCount?: number
  payloadTruncated?: boolean
  attachments?: ProviderMessageAttachment[]
  createdAt?: number | null
  label?: string | null
  model?: ProviderModelId | null
}

export type ProviderWorkingMessage = {
  type: 'message'
  id: string
  content: string
  contentLoaded?: boolean
  contentCharacterCount?: number
  contentTruncated?: boolean
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

export type ProviderToolIcon =
  'image-view' | 'image-generation' | 'openai-docs' | 'plan' | 'question' | 'subagent'

export type ProviderToolImage = {
  path?: string | null
  dataUrl?: string | null
  name?: string | null
}

export type ProviderWorkingTool = {
  type: 'tool'
  id: string
  toolId: string
  compact?: boolean
  status: ProviderWorkingToolStatus
  activity: ProviderToolActivity
  icon: ProviderToolIcon | null
  label: string
  command: string | null
  cwd: string | null
  stdout: string | null
  diffs: ProviderFileDiff[]
  diffCount?: number
  diffsStartIndex?: number
  backgroundSessionId: string | null
  finishedBackgroundSessionId: string | null
  rawInput: unknown
  rawOutput: unknown
  images: ProviderToolImage[]
  imageCount?: number
  imagesStartIndex?: number
  payloadLoaded?: boolean
  payloadCharacterCount?: number
  payloadTruncated?: boolean
}

export type ProviderWorkingToolGroup = {
  type: 'toolGroup'
  id: string
  label: string
  tools: ProviderWorkingTool[]
  toolCount?: number
  toolsStartIndex?: number
  toolActivities?: ProviderToolActivity[]
  dominantActivity?: ProviderToolActivity
}

export type ProviderWorkingItem =
  ProviderWorkingMessage | ProviderWorkingTool | ProviderWorkingToolGroup

export type ProviderWorkingItemSegment = {
  kind: 'history' | 'tail'
  startIndex: number
  items: ProviderWorkingItem[]
}

export type ProviderWorkingStep = {
  type: 'working'
  id: string
  status: 'working' | 'worked' | 'stopped' | 'failed' | 'queued'
  failureReason?: 'rateLimit'
  items: ProviderWorkingItem[]
  itemsLoaded?: boolean
  itemCount?: number
  itemsStartIndex?: number
  itemSegments?: ProviderWorkingItemSegment[]
}

export type ProviderPendingMessageKind = 'steering' | 'queued'

export type ProviderPendingMessage = {
  type: 'pendingMessage'
  id: string
  kind: ProviderPendingMessageKind
  content: string
  contentLoaded?: boolean
  contentCharacterCount?: number
  contentTruncated?: boolean
  payloadCharacterCount?: number
  payloadTruncated?: boolean
  attachments?: ProviderMessageAttachment[]
  createdAt?: number | null
}

export type ProviderContextCompaction = {
  type: 'contextCompaction'
  id: string
}

export type ProviderTimelineAnchor = {
  type: 'timelineAnchor'
  id: string
}

export type ProviderChatItem =
  | ProviderMessage
  | ProviderWorkingStep
  | ProviderPendingMessage
  | ProviderContextCompaction
  | ProviderTimelineAnchor

export type ProviderSubagentStatus =
  'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'stopped' | 'unknown'

export type ProviderSubagent = {
  id: string
  parentId: string | null
  turnId?: string | null
  beforeItemId?: string | null
  afterItemId?: string | null
  title: string
  description: string | null
  status: ProviderSubagentStatus
  createdAt: number | null
  updatedAt: number | null
}

export type ProviderSubagentDetail = ProviderSubagent & {
  items: ProviderChatItem[]
}

export type ProviderChatDetail = {
  id: string
  createdAt: number
  title: string
  cwd: string | null
  cwdKind: ProviderChatCwdKind
  projectCwd: string | null
  branchName: string | null
  worktreeBaseBranchName: string | null
  status: ProviderChatStatus | null
  pinned: boolean
  sidebarOrder: number | null
  done: boolean
  seenUpdatedAt: number | null
  purpose: ProviderChatPurpose | null
  container: AppContainerTarget | null
  capabilities: ProviderCapabilities
  pendingApproval: ProviderPendingApproval | null
  pendingUserInput: ProviderPendingUserInput | null
  contextUsage: ProviderChatContextUsage | null
  subagents?: ProviderSubagent[]
  items: ProviderChatItem[]
  itemsStartTurnIndex?: number
  turnCount?: number
  turnPagination?: ProviderChatTurnPagination
}

export type ProviderChatTurnPagination = {
  kind: 'cursor'
  olderCursor: string | null
  newerCursor: string | null
}

export type ProviderChatActivitySummary = {
  label: string
  activity: ProviderToolActivity
}

export type ProviderChatUpdateSummary = Omit<ProviderChat, 'providerId'> & {
  currentActivity: ProviderChatActivitySummary | null
  previewLength: number
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

export type ProviderChatTurnPage = {
  items: ProviderChatItem[]
  subagents?: ProviderSubagent[]
  startIndex: number
  totalCount: number
  turnPagination?: ProviderChatTurnPagination
}

export type ProviderWorkingStepPage = {
  items: ProviderWorkingItem[]
  startIndex: number
  status: ProviderWorkingStep['status']
  totalCount: number
  workingStepId: string
}

export type ProviderWorkingToolPage = {
  tools: ProviderWorkingTool[]
  startIndex: number
  totalCount: number
  workingItemId: string
  workingStepId: string
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
  additionalDirectories?: string[]
  agentMode?: ProviderAgentMode
  approvalPolicy: ProviderApprovalPolicy
  approvalsReviewer: ProviderApprovalsReviewer
  container?: AppContainerTarget | null
  cwd?: string
  files?: ProviderFileInput[]
  images?: ProviderImageInput[]
  model: ProviderModelId
  reasoningEffort?: ProviderReasoningEffort
  serviceTier: ProviderServiceTier | null
  review?: ProviderReview
  sandboxMode: ProviderSandboxMode
  showRecommendedPlugins?: boolean
  skills?: ProviderSkillInput[]
}

export type ProviderOneShotOptions = ProviderTurnOptions & {
  generationId?: string
}

export const providerOneShotGenerationCanceledMessage = 'One-shot generation canceled'

export type ProviderApi = {
  login: (providerId: ProviderId, options?: ProviderSourceOptions) => Promise<ProviderLoginResult>
  getAccounts: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountConfiguration>
  createAccount: (
    providerId: ProviderId,
    name: string,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountCreation>
  completeAccountCreation: (
    providerId: ProviderId,
    accountId: string,
    loginId: string | null,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountLoginCompletion>
  cancelAccountCreation: (
    providerId: ProviderId,
    accountId: string,
    loginId: string | null,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountConfiguration>
  useAccount: (
    providerId: ProviderId,
    accountId: string,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountConfiguration>
  deleteAccount: (
    providerId: ProviderId,
    accountId: string,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountConfiguration>
  getUpdateAvailability: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderUpdateAvailability | null>
  getProviderUpdateImpact: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderUpdateImpact>
  updateProvider: (
    providerId: ProviderId,
    options?: ProviderUpdateOptions
  ) => Promise<ProviderUpdateAvailability | null>
  getApprovalModes: (providerId: ProviderId) => Promise<ProviderApprovalModeOption[]>
  getSandboxModes: (providerId: ProviderId) => Promise<ProviderSandboxModeOption[]>
  getAgentModes: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAgentModeOption[]>
  getModels: (providerId: ProviderId, options?: ProviderSourceOptions) => Promise<ProviderModel[]>
  getSkills: (
    providerId: ProviderId,
    cwd?: string | null,
    options?: ProviderSourceOptions
  ) => Promise<ProviderSkill[]>
  getApps: (providerId: ProviderId, options?: ProviderSourceOptions) => Promise<ProviderApp[]>
  setSkillEnabled: (
    providerId: ProviderId,
    path: string,
    enabled: boolean,
    cwd?: string | null,
    options?: ProviderResourceUpdateOptions
  ) => Promise<ProviderSkill[]>
  setSkillsEnabled: (
    providerId: ProviderId,
    paths: string[],
    enabled: boolean,
    cwd?: string | null,
    options?: ProviderResourceUpdateOptions
  ) => Promise<ProviderSkill[]>
  setAppEnabled: (
    providerId: ProviderId,
    appId: string,
    enabled: boolean,
    options?: ProviderResourceUpdateOptions
  ) => Promise<ProviderApp[]>
  getUsage: (
    providerId: ProviderId,
    options?: ProviderUsageOptions
  ) => Promise<ProviderAccountUsage>
  resetRateLimits: (
    providerId: ProviderId,
    options?: ProviderSourceOptions
  ) => Promise<ProviderAccountRateLimitResetOutcome>
  getChatContainers: () => Promise<AppContainerTarget[]>
  getChats: (providerId: ProviderId, options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (providerId: ProviderId, chatId: string) => Promise<ProviderChatDetail>
  getSubagents: (providerId: ProviderId, chatId: string) => Promise<ProviderSubagent[]>
  getSubagent: (
    providerId: ProviderId,
    chatId: string,
    subagentId: string
  ) => Promise<ProviderSubagentDetail>
  cancelSubagent: (providerId: ProviderId, chatId: string, subagentId: string) => Promise<void>
  setChatTitle: (
    providerId: ProviderId,
    chatId: string,
    title: string
  ) => Promise<ProviderChatDetail>
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
  forkChat: (
    providerId: ProviderId,
    chatId: string,
    messageId: string
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
  steerPendingMessage: (
    providerId: ProviderId,
    chatId: string,
    messageId: string
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
  resolveUserInput: (
    providerId: ProviderId,
    chatId: string,
    requestId: string,
    response: ProviderUserInputResponse
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
  setChatOrder: (chatIds: string[]) => Promise<ProviderChatMetadata[]>
  onChatUpdated: (listener: (event: ProviderChatUpdatedEvent) => void) => () => void
}

export type ProviderRendererApi = Omit<ProviderApi, 'onChatUpdated'> & {
  getChatWorkingStepPage: (
    providerId: ProviderId,
    chatId: string,
    workingStepId: string,
    startIndex: number,
    limit: number
  ) => Promise<ProviderWorkingStepPage>
  getChatWorkingItem: (
    providerId: ProviderId,
    chatId: string,
    workingStepId: string,
    workingItemId: string
  ) => Promise<ProviderWorkingItem>
  getChatWorkingToolPage: (
    providerId: ProviderId,
    chatId: string,
    workingStepId: string,
    workingItemId: string,
    startIndex: number,
    limit: number
  ) => Promise<ProviderWorkingToolPage>
  getChatTurnPage: (
    providerId: ProviderId,
    chatId: string,
    startIndex: number,
    limit: number
  ) => Promise<ProviderChatTurnPage>
  getChatTurnCursorPage: (
    providerId: ProviderId,
    chatId: string,
    direction: 'older' | 'newer',
    cursor: string | null,
    limit: number
  ) => Promise<ProviderChatTurnPage>
  getChatTurnPageForItem: (
    providerId: ProviderId,
    chatId: string,
    itemId: string,
    limit: number
  ) => Promise<ProviderChatTurnPage>
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
}

export const providerIpcChannels = {
  login: 'provider:login',
  getAccounts: 'provider:get-accounts',
  createAccount: 'provider:create-account',
  completeAccountCreation: 'provider:complete-account-creation',
  cancelAccountCreation: 'provider:cancel-account-creation',
  useAccount: 'provider:use-account',
  deleteAccount: 'provider:delete-account',
  getUpdateAvailability: 'provider:get-update-availability',
  getProviderUpdateImpact: 'provider:get-update-impact',
  updateProvider: 'provider:update',
  getApprovalModes: 'provider:get-approval-modes',
  getSandboxModes: 'provider:get-sandbox-modes',
  getAgentModes: 'provider:get-agent-modes',
  getModels: 'provider:get-models',
  getSkills: 'provider:get-skills',
  getApps: 'provider:get-apps',
  setSkillEnabled: 'provider:set-skill-enabled',
  setSkillsEnabled: 'provider:set-skills-enabled',
  setAppEnabled: 'provider:set-app-enabled',
  getUsage: 'provider:get-usage',
  resetRateLimits: 'provider:reset-rate-limits',
  getChatContainers: 'provider:get-chat-containers',
  getChats: 'provider:get-chats',
  getChat: 'provider:get-chat',
  getSubagents: 'provider:get-subagents',
  getSubagent: 'provider:get-subagent',
  cancelSubagent: 'provider:cancel-subagent',
  getChatWorkingStepPage: 'provider:get-chat-working-step-page',
  getChatWorkingItem: 'provider:get-chat-working-item',
  getChatWorkingToolPage: 'provider:get-chat-working-tool-page',
  getChatTurnPage: 'provider:get-chat-turn-page',
  getChatTurnCursorPage: 'provider:get-chat-turn-cursor-page',
  getChatTurnPageForItem: 'provider:get-chat-turn-page-for-item',
  setChatTitle: 'provider:set-chat-title',
  generateOneShot: 'provider:generate-one-shot',
  cancelOneShot: 'provider:cancel-one-shot',
  startChat: 'provider:start-chat',
  continueChat: 'provider:continue-chat',
  continueChatInFork: 'provider:continue-chat-in-fork',
  forkChat: 'provider:fork-chat',
  sendActiveChatMessage: 'provider:send-active-chat-message',
  deletePendingMessage: 'provider:delete-pending-message',
  editPendingMessage: 'provider:edit-pending-message',
  steerPendingMessage: 'provider:steer-pending-message',
  interruptPendingMessage: 'provider:interrupt-pending-message',
  editMessage: 'provider:edit-message',
  resolveApproval: 'provider:resolve-approval',
  resolveUserInput: 'provider:resolve-user-input',
  stopChat: 'provider:stop-chat',
  markChatDone: 'provider:mark-chat-done',
  markCwdChatsDone: 'provider:mark-cwd-chats-done',
  getCwdNotes: 'provider:get-cwd-notes',
  setCwdNotes: 'provider:set-cwd-notes',
  markChatSeen: 'provider:mark-chat-seen',
  setChatPinned: 'provider:set-chat-pinned',
  setChatOrder: 'provider:set-chat-order',
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

export const isProviderAgentMode = (value: unknown): value is ProviderAgentMode =>
  value === 'interactive' || value === 'autopilot'

export const isProviderModelId = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

export const isProviderReasoningEffort = (value: unknown): value is ProviderReasoningEffort =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 64

export const isProviderServiceTier = (value: unknown): value is ProviderServiceTier =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128
