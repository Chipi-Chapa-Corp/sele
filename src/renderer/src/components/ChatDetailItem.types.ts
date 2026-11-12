import type { ReactNode } from 'react'
import 'react-diff-view/style/index.css'
import type { AppContainerTarget } from '../../../shared/app'
import type { McpAppScope as McpAppScopeValue } from '../../../shared/mcpApps'
import type {
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountRateLimitResetOption,
  ProviderChatItem,
  ProviderMessage,
  ProviderModelId,
  ProviderPendingMessage,
  ProviderWorkingStep
} from '../../../shared/provider'
import { type AppChatProgressSettings } from '../settings'
import {
  type WorkingStepDisclosureTarget,
  type WorkingStepProgressPolicy
} from '../workingStepDisclosure'
import './ChatDetailItem.css'
import './UnifiedDiff.css'
export type ChatDetailItemProps = {
  mcpAppScope?: McpAppScopeValue
  authenticationRequired?: boolean
  motionChatKey?: string | null
  availableRateLimitResets?: number
  rateLimitResetOptions?: ProviderAccountRateLimitResetOption[]
  canEditOwnMessages?: boolean
  markdownBaseUrl?: string
  messageBubble?: boolean
  container?: AppContainerTarget | null
  continuePrompt?: string
  continueStoppedTurnDisabled?: boolean
  continuedStoppedTurn?: boolean
  followingWorkingStepHasNext?: boolean
  followingWorkingStepStatus?: ProviderWorkingStep['status']
  hasNextWorkingStep?: boolean
  item: ProviderChatItem
  messagePinned?: boolean
  pendingMessageLabel?: ReactNode
  pendingMessageDeleteDisabled?: boolean
  resolvedModelIdsById?: ReadonlyMap<ProviderModelId, ProviderModelId>
  modelLabelsById?: ReadonlyMap<ProviderModelId, string>
  onDeletePendingMessage?: (message: ProviderPendingMessage) => void
  onEditPendingMessage?: (message: ProviderPendingMessage) => void
  onSteerPendingMessage?: (message: ProviderPendingMessage) => void
  onInterruptPendingMessage?: (message: ProviderPendingMessage) => void
  onEditMessage?: (message: ProviderMessage) => void
  onForkMessage?: (message: ProviderMessage) => Promise<void> | void
  onLoadWorkingStep?: (workingStepId: string, startIndex?: number) => Promise<void> | void
  onLoadWorkingItem?: (workingStepId: string, workingItemId: string) => Promise<void> | void
  onLoadWorkingToolPage?: (
    workingStepId: string,
    workingItemId: string,
    startIndex: number
  ) => Promise<void> | void
  onDisclosureToggle?: () => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onToggleMessagePinned?: (message: ProviderMessage, turnIndex: number, pinned: boolean) => void
  onContinueStoppedTurn?: (workingStepId: string, prompt: string) => Promise<void> | void
  onRetryStoppedTurn?: (message: ProviderMessage) => Promise<void> | void
  onManageAccounts?: () => void
  onReauthenticate?: () => void
  onUsageRefresh?: () => Promise<void> | void
  onUsageReset?: (creditId?: string) => Promise<ProviderAccountRateLimitResetOutcome>
  previousItem?: ProviderChatItem | null
  cwd?: string | null
  projectCwd?: string | null
  progressPolicy?: WorkingStepProgressPolicy
  progressDisclosureTarget?: WorkingStepDisclosureTarget
  progressSettings?: AppChatProgressSettings
  rateLimitResetDisabled?: boolean
  retryMessage?: ProviderMessage | null
  retryStoppedTurnDisabled?: boolean
  selectedModelId?: ProviderModelId
  streaming?: boolean
  turnIndex?: number
  workingStepContent?: ReactNode
}
