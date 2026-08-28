import type * as React from 'react'

import { type CSSProperties } from 'react'

import type {
  AppContainerTarget,
  AppSelectedAttachment,
  AppGitBranchesResult,
  AppGitPullStrategy,
  AppGitPushTarget
} from '../../../shared/app'

import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderActiveSendMode,
  ProviderId,
  ProviderReview,
  ProviderReviewComment,
  ProviderAppInput,
  ProviderSkillInput,
  ProviderTurnOptions
} from '../../../shared/provider'

import { type PinnedChatTextReference } from '../chatRecents'

import type { FileEditorTarget } from '../components/FileEditorDialog'

import { type PinnedRecentChatReferencesByChat } from '../recentReferencePins'

import { type RecentlyOpenedFilesByWorkspace } from '../recentlyOpenedFiles'

import { type AppSettings } from '../settings'

import { type ChatTurnWindow } from '../chatTurnWindow'

import {
  type ChangedFile,
  type ChangeSource,
  type DisplayTreeFile,
  type PatchFilterScope,
  type RepositoryFile
} from '../changeTree'

import { type ChatScrollAnchor } from '../chatLayout'

import { type ChatCommitMarker } from '../components/AppStatusStates'

import { type ScopedCommitActivity, type StartingScopedCommitActivity } from '../chatCommitStorage'

import {
  type ApplyChatDetailOptions,
  type ChangesPaneView,
  type ChatTurnPageLoadDirection,
  type CommitChatReturnTarget,
  type DirectCommitActivity,
  type EditingMessage,
  type GitBranchDeleteRetry,
  type GitBranchWorktreeDeleteRetry,
  type GitBranchesScope,
  type GitChangesScope,
  type GitCommitMode,
  type GitCommitPromptAction,
  type GitSyncAction,
  type GitSyncRecoveryState,
  type LoadState,
  type ScopedGitOperationError,
  type SendState,
  type SubagentChatView,
  type SubagentListState
} from './controllerTypes'

export type GitSyncControllerDependencies = {
  setSyncErrorsByProjectKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSyncRecoveriesByProjectKey: React.Dispatch<
    React.SetStateAction<Record<string, GitSyncRecoveryState>>
  >
  providerUpdateInProgress: boolean
  changesProjectCwd: string | null
  syncProjectKeysRef: React.RefObject<Set<string>>
  hasAiCommitInProgressForProject: (projectKey: string) => boolean
  commitInFlightProjectKeysRef: React.RefObject<Set<string>>
  commitMessageGenerationProjectKeysRef: React.RefObject<Set<string>>
  setSyncProjectKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  changesContainer: AppContainerTarget | null
  setGitChangeLoadRequest: React.Dispatch<React.SetStateAction<number>>
  syncDisabled: boolean
  changesCwd: string | null
  currentProjectKey: string
  visibleSyncRecovery: GitSyncRecoveryState | null
  syncInProgress: boolean
  visibleGitChangeLoadError:
    | ScopedGitOperationError<PatchFilterScope>
    | ScopedGitOperationError<GitChangesScope>
    | { scope: null; cwd: string; error: string; operation: string }
    | null
  effectiveAppSettings: AppSettings
  gitAiResolutionDisabled: boolean
  handleSendMessage: (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments?: AppSelectedAttachment[],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills?: ProviderSkillInput[],
    apps?: ProviderAppInput[],
    turnOptionsOverride?: ProviderTurnOptions,
    sendTarget?: 'current' | 'new'
  ) => Promise<boolean>
  getGitTurnOptions: () => ProviderTurnOptions
  setGitChangeLoadErrorDismissed: React.Dispatch<React.SetStateAction<boolean>>
  setCommitErrorsByProjectKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  currentProjectSyncError: string
  currentProjectCommitError: string
  gitBranchError: string | null
  setGitBranchError: React.Dispatch<React.SetStateAction<string | null>>
  setGitBranchDeleteRetry: React.Dispatch<React.SetStateAction<GitBranchDeleteRetry | null>>
  setGitBranchWorktreeDeleteRetry: React.Dispatch<
    React.SetStateAction<GitBranchWorktreeDeleteRetry | null>
  >
  gitBranchActionState: SendState
  setGitBranchActionState: React.Dispatch<React.SetStateAction<SendState>>
  configProviderId: 'codex' | 'claude' | 'copilot' | 'opencode'
  untrackedFilesHiddenForPerformance: boolean
  untrackedFilesAiDisabled: boolean
}

export type SubagentControllerDependencies = {
  selectedProviderId: 'codex' | 'claude' | 'copilot' | 'opencode' | undefined
  selectedChatId: string | undefined
  selectedChatKey: string | null
  subagentChatLoadRequestRef: React.RefObject<number>
  resetChatSearch: () => void
  setEditingMessage: React.Dispatch<React.SetStateAction<EditingMessage | null>>
  setSubagentChatView: React.Dispatch<React.SetStateAction<SubagentChatView | null>>
  selectedChatKeyRef: React.RefObject<string | null>
  subagentContentRef: React.RefObject<HTMLDivElement | null>
  scrollChatContentToBottom: (contentElement: HTMLElement) => void
  cancelingSubagentIds: Set<string>
  setCancelingSubagentIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSubagentListState: React.Dispatch<React.SetStateAction<SubagentListState | null>>
  contentRef: React.RefObject<HTMLDivElement | null>
  scopedCommitActivitiesByMarkerId: Map<string, ScopedCommitActivity>
  providerUpdateInProgress: boolean
  cancelingAiCommitKeys: Set<string>
  openingAiCommitChatIds: Set<string>
  handleCancelAiCommit: (activity: ScopedCommitActivity) => Promise<void>
  handleOpenAiCommitChat: (marker: ChatCommitMarker) => Promise<void>
}

export type CommitControllerDependencies = {
  startingScopedCommitActivitiesRef: React.RefObject<Record<string, StartingScopedCommitActivity>>
  scopedCommitActivitiesRef: React.RefObject<Record<string, ScopedCommitActivity>>
  providerUpdateInProgress: boolean
  selectedChat: ProviderChat | null
  chatDetail: ProviderChatDetail | null
  changesCwd: string | null
  newSessionProvider: 'codex' | 'claude' | 'copilot' | 'opencode'
  changesProjectCwd: string | null
  projectCommitInProgress: boolean
  commitInFlightProjectKeysRef: React.RefObject<Set<string>>
  commitMessageGenerationProjectKeysRef: React.RefObject<Set<string>>
  syncProjectKeysRef: React.RefObject<Set<string>>
  sendInFlightRef: React.RefObject<boolean>
  sendInFlightProjectKeyRef: React.RefObject<string | null>
  getGitTurnOptions: () => ProviderTurnOptions
  setStartingScopedCommitActivities: React.Dispatch<
    React.SetStateAction<Record<string, StartingScopedCommitActivity>>
  >
  chatAutoScrollEnabledRef: React.RefObject<boolean>
  setCommitErrorsByProjectKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setChatCommitMarkers: React.Dispatch<React.SetStateAction<Record<string, ChatCommitMarker>>>
  applyChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  changesCwdRef: React.RefObject<string | null>
  setCommitInput: React.Dispatch<React.SetStateAction<string>>
  setScopedCommitActivities: React.Dispatch<
    React.SetStateAction<Record<string, ScopedCommitActivity>>
  >
  commitMessageGenerationDisabled: boolean
  setCommitMessageGenerationProjectKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  changesContainer: AppContainerTarget | null
  effectiveAppSettings: AppSettings
  aiCommitInstructions: string
  commitInputValue: string
  getCommitActionDisabled: (action: GitCommitPromptAction, message?: string) => boolean
  setDirectCommitActivities: React.Dispatch<
    React.SetStateAction<Record<string, DirectCommitActivity>>
  >
  patchChangeSourceSelected: boolean
  changedFiles: DisplayTreeFile<ChangedFile>[]
  setGitChangeLoadRequest: React.Dispatch<React.SetStateAction<number>>
  pushAfterCommit: boolean
  runSyncChanges: (
    action: GitSyncAction,
    cwd: string,
    options?: {
      pullStrategy?: AppGitPullStrategy
      pushTarget?: AppGitPushTarget
      rememberPushTarget?: boolean
      rememberStrategy?: boolean
      setUpstream?: boolean
      recovery?: GitSyncRecoveryState | null
    }
  ) => Promise<void>
  getAiCommitActionDisabled: () => boolean
  cancelingAiCommitKeys: Set<string>
  setCancelingAiCommitKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  openingAiCommitChatIds: Set<string>
  chatsRef: React.RefObject<ProviderChat[]>
  setOpeningAiCommitChatIds: React.Dispatch<React.SetStateAction<Set<string>>>
  markSelectedChatSeen: (rememberPendingCompletion?: boolean) => void
  setSendState: React.Dispatch<React.SetStateAction<SendState>>
  setEditingMessage: React.Dispatch<React.SetStateAction<EditingMessage | null>>
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
  subagentChatLoadRequestRef: React.RefObject<number>
  setSubagentChatView: React.Dispatch<React.SetStateAction<SubagentChatView | null>>
  setCommitChatReturnTarget: React.Dispatch<React.SetStateAction<CommitChatReturnTarget | null>>
  applyViewedChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  commitChatReturnTarget: CommitChatReturnTarget | null
  handleSelectChat: (chat: ProviderChat) => void
  hasAiCommitInProgressForProject: (projectKey: string) => boolean
}

export type FileNavigationDependencies = {
  setCollapsedChangeTreeFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  collapsedFileTreeFolders: Record<string, boolean>
  setLastOpenedFileTreeFolderPath: React.Dispatch<React.SetStateAction<string | null>>
  setCollapsedFileTreeFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  changesCwd: string | null
  lastOpenedFileTreeFolderByCwdRef: React.RefObject<Map<string, string>>
  collapsedFileTreeFoldersByCwdRef: React.RefObject<Map<string, Record<string, boolean>>>
  branchSwitchDisabled: boolean
  gitBranchRequestIdRef: React.RefObject<number>
  setGitBranchActionState: React.Dispatch<React.SetStateAction<SendState>>
  setGitBranchError: React.Dispatch<React.SetStateAction<string | null>>
  setGitBranchDeleteRetry: React.Dispatch<React.SetStateAction<GitBranchDeleteRetry | null>>
  setGitBranchWorktreeDeleteRetry: React.Dispatch<
    React.SetStateAction<GitBranchWorktreeDeleteRetry | null>
  >
  changesContainer: AppContainerTarget | null
  setGitBranches: React.Dispatch<React.SetStateAction<AppGitBranchesResult | null>>
  setGitBranchesScope: React.Dispatch<React.SetStateAction<GitBranchesScope | null>>
  gitAvailabilityScopeKey: 'missing' | 'available'
  setGitBranchLoadState: React.Dispatch<React.SetStateAction<LoadState>>
  setGitChangeLoadRequest: React.Dispatch<React.SetStateAction<number>>
  setFileTreeLoadRequest: React.Dispatch<React.SetStateAction<number>>
  gitBranchDeleteRetry: GitBranchDeleteRetry | null
  gitBranchWorktreeDeleteRetry: GitBranchWorktreeDeleteRetry | null
  gitBranchActionState: SendState
  activeTreeFolderPaths: string[]
  hasCollapsedActiveTreeFolders: boolean
  changesPaneView: ChangesPaneView
  setFileEditorTarget: React.Dispatch<React.SetStateAction<FileEditorTarget | null>>
  setRecentlyOpenedFilesByWorkspace: React.Dispatch<
    React.SetStateAction<RecentlyOpenedFilesByWorkspace>
  >
  selectedChatKey: string | null
  setPinnedRecentChatReferences: React.Dispatch<
    React.SetStateAction<PinnedRecentChatReferencesByChat>
  >
  selectedChatRef: React.RefObject<ProviderChat | null>
  handleChangesPaneViewChange: (view: ChangesPaneView) => void
  selectedChatKeyRef: React.RefObject<string | null>
  pendingPinnedMessageNavigationRef: React.RefObject<PinnedChatTextReference | null>
  scrollPinnedChatMessageIntoView: (messageId: string) => boolean
  chatDetailRef: React.RefObject<ProviderChatDetail | null>
  chatTurnPageLoadRequestRef: React.RefObject<number>
  chatTurnPageLoadInFlightRef: React.RefObject<boolean>
  chatTurnScrollDirectionRef: React.RefObject<'up' | 'down' | null>
  pendingChatScrollAnchorRef: React.RefObject<ChatScrollAnchor | null>
  chatViewportAnchorRef: React.RefObject<ChatScrollAnchor | null>
  chatAutoScrollEnabledRef: React.RefObject<boolean>
  chatAutoScrollTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  chatTurnWindowRef: React.RefObject<ChatTurnWindow | null>
  setChatTurnPageLoadDirection: React.Dispatch<
    React.SetStateAction<ChatTurnPageLoadDirection | null>
  >
  setChatAtConversationBottom: React.Dispatch<React.SetStateAction<boolean>>
  setChatDetail: React.Dispatch<React.SetStateAction<ProviderChatDetail | null>>
  setChatTurnWindow: React.Dispatch<React.SetStateAction<ChatTurnWindow | null>>
  setReviewCommentsDraft: React.Dispatch<React.SetStateAction<ProviderReviewComment[]>>
  setSelectedReview: React.Dispatch<React.SetStateAction<Omit<ProviderReview, 'prompt'> | null>>
  getChangeTreeRowStyle: (depth: number) => CSSProperties
  collapsedChangeTreeFolders: Record<string, boolean>
}

export type GitViewModelDependencies = {
  commitInput: string
  effectiveAppSettings: AppSettings
  gitCommitMode: GitCommitMode
  changesProjectCwd: string | null
  changesCwd: string | null
  visibleGitErrorProjectKeyRef: React.RefObject<string | null>
  setCommitErrorsByProjectKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSyncErrorsByProjectKey: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setSyncRecoveriesByProjectKey: React.Dispatch<
    React.SetStateAction<Record<string, GitSyncRecoveryState>>
  >
  syncProjectKeys: Set<string>
  syncErrorsByProjectKey: Record<string, string>
  syncRecoveriesByProjectKey: Record<string, GitSyncRecoveryState>
  commitMessageGenerationProjectKeys: Set<string>
  commitErrorsByProjectKey: Record<string, string>
  scopedCommitActivities: Record<string, ScopedCommitActivity>
  directCommitActivities: Record<string, DirectCommitActivity>
  startingScopedCommitActivities: Record<string, StartingScopedCommitActivity>
  sendState: SendState
  sendInFlightProjectKey: string | null
  editingMessage: EditingMessage | null
  selectedChat: ProviderChat | null
  chatDetail: ProviderChatDetail | null
  chatLoadState: LoadState
  chatIsBusy: boolean
  changedFiles: DisplayTreeFile<ChangedFile>[]
  untrackedFilesHiddenForPerformance: boolean
  providerUpdateInProgress: boolean
  changesLoadState: LoadState
  uncommittedChangedFiles: ChangedFile[]
  gitAvailableForCurrentSource: boolean | null
  setGitCommitMode: React.Dispatch<React.SetStateAction<GitCommitMode>>
  gitBranchActionState: SendState
  hasUnpulledChanges: boolean
  unpulledCount: number
  handleSyncChanges: (action: GitSyncAction) => Promise<void>
  hasUnpushedChanges: boolean
  unpushedCount: number
  chatHasActiveTurn: boolean
  newSessionProviderAvailable: boolean
  changeSource: ChangeSource
  repositoryFiles: DisplayTreeFile<RepositoryFile>[]
  lastOpenedFileTreeFolderPath: string | null
  changesPaneView: ChangesPaneView
  collapsedFileTreeFolders: Record<string, boolean>
  collapsedChangeTreeFolders: Record<string, boolean>
  filesLoadState: LoadState
}
