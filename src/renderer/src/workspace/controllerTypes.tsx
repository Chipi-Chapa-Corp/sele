import { GitCommitHorizontal, Upload } from 'lucide-react'

import type {
  AppContainerTarget,
  AppGitCommitAction,
  AppSourceAvailability,
  AppGitDeleteBranchScope,
  AppGitPatchChange,
  AppGitRecoverableFailure
} from '../../../shared/app'

import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderApprovalDecision,
  ProviderId,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderSubagent,
  ProviderSubagentDetail
} from '../../../shared/provider'

import {
  fallbackProviderApprovalModes,
  fallbackProviderModels,
  fallbackProviderSandboxModes
} from '../../../shared/provider'

import {
  type ChangeSource,
  type ChangedFile,
  type GitChangeSource,
  type PatchChangeSource,
  type PatchFilterScope
} from '../changeTree'

import { type CommitActivityAction } from '../chatCommitStorage'

export type LoadState = 'loading' | 'ready' | 'error'

export type SendState = 'idle' | 'sending' | 'error'

export type NewSessionLocation = 'folder' | 'worktree'

export type WorktreeCreationState = 'idle' | 'creating' | 'canceling'

export type ApplyChatDetailOptions = {
  allowEqualRevision?: boolean
  select?: boolean
}

export type ChatTurnPageLoadDirection = 'older' | 'newer' | 'latest'

export type CommittedChatUpdate = {
  detailApplied: boolean
  sequence: number
  turnCompleted: boolean
}

export type EditingMessage =
  | (Pick<ProviderMessage, 'id' | 'content'> & { type: 'message'; targetId: string })
  | (Pick<ProviderPendingMessage, 'id' | 'content' | 'kind'> & { type: 'pending' })

export type ApprovalResolutionState = {
  approvalId: string | null
  decision: ProviderApprovalDecision | null
  error: string | null
}

export type UserInputResolutionState = {
  requestId: string | null
  resolving: boolean
  error: string | null
}

export type ProviderUpdateState = 'idle' | 'updating'

export type UsageLoadState = 'idle' | 'loading' | 'ready' | 'error'

export type ChangesPaneView = 'recents' | 'git' | 'files' | 'terminal' | 'browser'

export type GitCommitPromptAction = AppGitCommitAction

export type GitCommitMode = 'commit' | 'push'

export type GitSyncAction = 'pull' | 'push' | 'pullAndPush'

export type GitSyncStep = Exclude<GitSyncAction, 'pullAndPush'>

export type GitSyncRecoveryState = {
  cwd: string
  requestedAction: GitSyncAction
  failedAction: GitSyncStep
  failure: AppGitRecoverableFailure
  error: string | null
}

export type CommitChatReturnTarget = {
  providerId: ProviderId
  commitChatId: string
  sourceChat: ProviderChat
}

export type SubagentListState = {
  rootChatKey: string
  items: ProviderSubagent[]
  loadState: LoadState
  error: string | null
}

export type SubagentChatView = {
  rootChatKey: string
  summary: ProviderSubagent
  detail: ProviderSubagentDetail | null
  loadState: LoadState
  error: string | null
}

export type DirectCommitActivity = {
  source: 'git'
  id: string
  projectCwd: string | null
  commitAction: GitCommitPromptAction
  currentAction: CommitActivityAction
  startedAt: number
}

export type GitSyncRecoveryActionOptions = {
  rememberPushTarget?: boolean
  rememberStrategy?: boolean
}

export type DeferredProviderResourceRefresh = {
  providerId: ProviderId
  cwd: string | null
  container: AppContainerTarget
}

export type CachedPatchChangedFiles = {
  containerKey: string
  cwd: string
  source: PatchChangeSource
  files: ChangedFile[]
}

export type FileTreeScope = {
  containerKey: string
  cwd: string
}

export type GitBranchesScope = {
  sourceKey: string
  cwd: string
}

export type GitBranchDeleteRetry = {
  branchName: string
  scope: AppGitDeleteBranchScope
}

export type GitBranchWorktreeDeleteRetry = GitBranchDeleteRetry & {
  force: boolean
  worktreePath: string
}

export type RecentChatCacheEntry = {
  detail: ProviderChatDetail
  updatedAt: number
}

export type GitChangesScope = {
  sourceKey: string
  cwd: string
  source: GitChangeSource
}

export type ScopedGitOperationError<TScope> = {
  scope: TScope
  cwd: string
  error: string
  operation: string
}

export type SourceAvailabilityState = {
  containerKey: string
  availability: AppSourceAvailability
  error: string | null
}

export type UncommittedPatchFilter = {
  scope: PatchFilterScope
  patches: AppGitPatchChange[]
}

export const chatListFetchPageSize = 100

export const chatTurnPageSize = 10

export const chatTurnWindowSize = chatTurnPageSize * 2

export const chatWorkingItemPageSize = 50

export const chatWorkingItemWindowSize = chatWorkingItemPageSize * 2

export const chatWorkingToolPageSize = 50

export const chatWorkingToolWindowSize = chatWorkingToolPageSize * 2

export const loadedWorkingStepCacheSize = 3

export const chatTurnLoadThresholdPx = 80

export const streamingChatUpdateIntervalMs = 50

export const chatGroupingPreferenceStorageKey = 'sele:chat-grouping-preference:v1'

export const gitCurrentChatModelValue = '__sele_current_chat_model__'

export const pinnedGroupKey = 'pinned'

export const activeGroupKey = 'active'

export const unknownCwdGroupKey = 'cwd:unknown'

export const doneGroupKey = 'done'

export const allDoneProjectsValue = '__sele_all_done_projects__'

export const newSessionProjectPlaceholderValue = '__sele_new_session_project_placeholder__'

export const fallbackDefaultModel = fallbackProviderModels.find((model) => model.isDefault)

export const fallbackInitialModel = fallbackDefaultModel ?? fallbackProviderModels[0]!

export const fallbackInitialReasoningEffort =
  fallbackInitialModel?.defaultReasoningEffort ?? 'medium'

export const fallbackDefaultApprovalMode =
  fallbackProviderApprovalModes.find((mode) => mode.isDefault)?.id ??
  fallbackProviderApprovalModes[0]?.id ??
  'ask-user'

export const fallbackDefaultSandboxMode =
  fallbackProviderSandboxModes.find((mode) => mode.isDefault)?.id ??
  fallbackProviderSandboxModes[0]?.id ??
  'workspace-write'

export type ChatGroupingPreference = 'grouped' | 'ungrouped'

export const readChatGroupingPreference = (): ChatGroupingPreference => {
  try {
    return window.localStorage.getItem(chatGroupingPreferenceStorageKey) === 'ungrouped'
      ? 'ungrouped'
      : 'grouped'
  } catch {
    return 'grouped'
  }
}

export const writeChatGroupingPreference = (preference: ChatGroupingPreference): void => {
  try {
    window.localStorage.setItem(chatGroupingPreferenceStorageKey, preference)
  } catch {
    // Sidebar grouping is non-critical; ignore unavailable storage.
  }
}

export const changeSourceLabels = {
  uncommitted: 'Uncommitted',
  lastTurn: 'Last turn',
  chat: 'Chat'
} satisfies Record<ChangeSource, string>

export const getFixedChangeSource = (): ChangeSource => 'uncommitted'

export const commitActionLabels = {
  commit: 'Commit',
  amend: 'Amend'
} satisfies Record<GitCommitPromptAction, string>

export const gitCommitModeOptions = [
  {
    value: 'commit',
    label: null,
    ariaLabel: 'Commit only',
    title: 'Commit only',
    icon: <GitCommitHorizontal aria-hidden="true" />
  },
  {
    value: 'push',
    label: null,
    ariaLabel: 'Commit and push',
    title: 'Commit and push',
    icon: <Upload aria-hidden="true" />
  }
] satisfies readonly {
  value: GitCommitMode
  label: null
  ariaLabel: string
  title: string
  icon: React.ReactNode
}[]
