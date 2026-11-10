import type { AppContainerTarget, AppSelectedAttachment } from '../../../shared/app'
import type {
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderActiveSendMode,
  ProviderAgentMode,
  ProviderAgentModeOption,
  ProviderAppInput,
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderCwdNote,
  ProviderId,
  ProviderModel,
  ProviderModelId,
  ProviderPromptSuggestion,
  ProviderReasoningEffort,
  ProviderReview,
  ProviderSandboxMode,
  ProviderSandboxModeOption,
  ProviderServiceTier,
  ProviderSkillInput,
  ProviderUsageOptions
} from '../../../shared/provider'
import type { AppAction } from '../actions'
import type { MessageBoxSelection } from '../messageBoxPreferences'
import type { AppChatDropdownSelectionAction, AppChatUsageDisplay } from '../settings'
import { type ChatContextUsage } from './UsageIndicator'

export type MessageBoxProps = {
  agentMode: ProviderAgentMode
  agentModes: ProviderAgentModeOption[]
  agentModesLoading?: boolean
  approvalMode: ProviderApprovalMode
  approvalModes: ProviderApprovalModeOption[]
  active?: boolean
  activePrimaryMode?: Extract<ProviderActiveSendMode, 'steer' | 'queue'>
  activeSteeringEnabled?: boolean
  autoFocus?: boolean
  draftScopeKey: string
  chatId?: string | null
  promptSuggestion?: ProviderPromptSuggestion | null
  /**
   * Gates sending and actions only, like `operationsDisabled` and `pending`. The prompt,
   * attachments, usage, chat settings and notes remain usable in every state.
   */
  disabled?: boolean
  editSession?: {
    id: string
    content: string
    attachments: AppSelectedAttachment[]
    type?: 'message' | 'pending'
  } | null
  error?: string | null
  /** Used when native compaction fails or leaves no readable summary for a linked chat. */
  linkedChatSummaryPrompt?: string
  container?: AppContainerTarget | null
  model: ProviderModelId
  models: ProviderModel[]
  modelsError?: string | null
  modelsLoading?: boolean
  modelsUnavailable?: boolean
  operationsDisabled?: boolean
  pending?: boolean
  providerId: ProviderId
  providerUpdating?: boolean
  providerResourcesRevision?: number
  projectCwd?: string | null
  quoteRequest?: MessageBoxQuoteRequest | null
  onQuoteRequestHandled?: (id: number) => void
  cwd?: string | null
  reasoningEffort: ProviderReasoningEffort
  serviceTier: ProviderServiceTier | null
  sandboxMode: ProviderSandboxMode
  sandboxModes: ProviderSandboxModeOption[]
  selectedReview?: Omit<ProviderReview, 'prompt'> | null
  accountUsage: ProviderAccountUsage | null
  accountUsageError: string | null
  accountUsageState: 'idle' | 'loading' | 'ready' | 'error'
  actions?: AppAction[]
  contextUsage: MessageBoxContextUsage
  displayUsage: AppChatUsageDisplay
  lastActionId?: string | null
  goalObjective?: string | null
  notes?: ProviderCwdNote[]
  notesContextKey?: string
  notesLabel?: string
  presetsEnabled?: boolean
  selectionAction?: AppChatDropdownSelectionAction
  onPresetChange: (selection: Partial<MessageBoxSelection>) => void
  showAccessSelector?: boolean
  showActions?: boolean
  showActionLabel?: boolean
  showModelSelector?: boolean
  showNotesButton?: boolean
  showReasoningSelector?: boolean
  showReviewSelector?: boolean
  showUsageIndicator?: boolean
  showSpeedSelector?: boolean
  onAgentModeChange: (agentMode: ProviderAgentMode) => void
  onApprovalModeChange: (approvalMode: ProviderApprovalMode) => void
  onActionsChange?: (actions: AppAction[]) => void
  onLastActionChange?: (actionId: string | null) => void
  onCancelEdit?: () => void
  onModelChange: (model: ProviderModelId) => void
  onSetGoal?: (objective: string) => Promise<void>
  onNotesChange?: (notes: ProviderCwdNote[]) => void
  onOpenAttachment?: (attachment: AppSelectedAttachment) => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onReasoningEffortChange: (reasoningEffort: ProviderReasoningEffort) => void
  onServiceTierChange: (serviceTier: ProviderServiceTier | null) => void
  onRunAction?: (action: AppAction) => Promise<void> | void
  onSelectedReviewChange?: (review: Omit<ProviderReview, 'prompt'> | null) => void
  onSandboxModeChange: (sandboxMode: ProviderSandboxMode) => void
  onCompact?: () => Promise<void> | void
  onStop?: () => Promise<void> | void
  onUsageRefresh?: (options?: ProviderUsageOptions) => Promise<void> | void
  onQueueLimitReset?: (prompt: string) => Promise<void>
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
  onSend: (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments?: AppSelectedAttachment[],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills?: ProviderSkillInput[],
    apps?: ProviderAppInput[]
  ) => Promise<boolean> | boolean
}

export type MessageBoxQuoteRequest = {
  id: number
  scopeKey: string
  content: string
  comment: string
}

type MessageBoxContextUsage = ChatContextUsage
