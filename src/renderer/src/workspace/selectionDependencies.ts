import type * as React from 'react'

import type {
  AppContainerTarget,
  AppFileTreeResult,
  AppGitBranchesResult,
  AppGitChangesResult
} from '../../../shared/app'

import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderId,
  ProviderAccountUsage
} from '../../../shared/provider'

import type { ChatPlanData } from '../components/ChatPlan'

import type { FileEditorTarget } from '../components/FileEditorDialog'

import type { TerminalCommandLaunchRequest } from '../components/TerminalPanel'

import { type AppSettings } from '../settings'

import { type ChatTurnWindow } from '../chatTurnWindow'

import { type ChangeSource, type PatchFilterScope } from '../changeTree'

import { type ChatScrollAnchor } from '../chatLayout'

import { type ChatCommitMarker } from '../components/AppStatusStates'

import { type ScopedCommitActivity, type StartingScopedCommitActivity } from '../chatCommitStorage'

import {
  type ApprovalResolutionState,
  type ChangesPaneView,
  type FileTreeScope,
  type GitBranchDeleteRetry,
  type GitBranchWorktreeDeleteRetry,
  type GitBranchesScope,
  type GitChangesScope,
  type LoadState,
  type ScopedGitOperationError,
  type SendState,
  type SourceAvailabilityState,
  type SubagentChatView,
  type SubagentListState,
  type UncommittedPatchFilter,
  type UsageLoadState,
  type UserInputResolutionState
} from './controllerTypes'

export type WorkspaceSelectionDependencies = {
  selectedChat: ProviderChat | null
  subagentChatView: SubagentChatView | null
  subagentListState: SubagentListState | null
  chatDetail: ProviderChatDetail | null
  setSubagentListState: React.Dispatch<React.SetStateAction<SubagentListState | null>>
  setSubagentChatView: React.Dispatch<React.SetStateAction<SubagentChatView | null>>
  selectedChatKeyRef: React.RefObject<string | null>
  subagentChatLoadRequestRef: React.RefObject<number>
  chatDetailResyncRequestIdRef: React.RefObject<number>
  chatDetailResyncRef: React.RefObject<{ chatKey: string; requestId: number } | null>
  scopedCommitActivities: Record<string, ScopedCommitActivity>
  startingScopedCommitActivities: Record<string, StartingScopedCommitActivity>
  chatCommitMarkers: Record<string, ChatCommitMarker>
  extractedChatPlan: ChatPlanData | null
  effectiveAppSettings: AppSettings
  setExtractedChatPlan: React.Dispatch<React.SetStateAction<ChatPlanData | null>>
  newSessionProvider: 'codex' | 'claude' | 'copilot' | 'opencode'
  newSessionProviderAvailable: boolean
  newSessionSourceAvailabilityReady: boolean
  newSessionCwd: string | null
  newSessionContainer: AppContainerTarget
  gitSourceAvailability: SourceAvailabilityState | null
  lastGitAvailable: boolean | null
  changesContainerRef: React.RefObject<AppContainerTarget | null>
  changeSourceRef: React.RefObject<ChangeSource>
  changeSource: ChangeSource
  setGitSourceAvailability: React.Dispatch<React.SetStateAction<SourceAvailabilityState | null>>
  setLastGitAvailable: React.Dispatch<React.SetStateAction<boolean | null>>
  setGitAvailabilityChangeId: React.Dispatch<React.SetStateAction<number>>
  gitAvailableRef: React.RefObject<boolean | null>
  gitBranchLoadRequest: number
  gitChangeLoadRequest: number
  setTerminalOpened: React.Dispatch<React.SetStateAction<boolean>>
  setBrowserOpened: React.Dispatch<React.SetStateAction<boolean>>
  lastNonTerminalChangesPaneViewRef: React.RefObject<'recents' | 'git' | 'files' | 'browser'>
  setChangesPaneView: React.Dispatch<React.SetStateAction<ChangesPaneView>>
  changesPaneView: ChangesPaneView
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  runPromptActionRef: React.RefObject<(prompt: string, target: 'current' | 'new') => Promise<void>>
  setTerminalCommandLaunchRequest: React.Dispatch<
    React.SetStateAction<TerminalCommandLaunchRequest | null>
  >
  updateAppearanceZoomLevel: (value: number, clearInputDraft?: boolean) => void
  settingsOpen: boolean
  fileEditorTarget: FileEditorTarget | null
  appSettings: AppSettings
  changesCwdRef: React.RefObject<string | null>
  approvalResolution: ApprovalResolutionState
  userInputResolution: UserInputResolutionState
  setAccountUsage: React.Dispatch<React.SetStateAction<ProviderAccountUsage | null>>
  setAccountUsageState: React.Dispatch<React.SetStateAction<UsageLoadState>>
  setAccountUsageError: React.Dispatch<React.SetStateAction<string | null>>
  loadState: LoadState
  providerAccountRevision: number
  chatDetailRef: React.RefObject<ProviderChatDetail | null>
  cacheRecentChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    updatedAt: number,
    force?: boolean
  ) => void
  selectedChatUpdatedAtRef: React.RefObject<number | null>
  setChatDetail: React.Dispatch<React.SetStateAction<ProviderChatDetail | null>>
  setChatLoadState: React.Dispatch<React.SetStateAction<LoadState>>
  markChatSeenAt: (providerId: ProviderId, chatId: string, seenUpdatedAt: number) => void
  chatLoadRequest: number
  chatInitialLayoutKeyRef: React.RefObject<string | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  chatAutoScrollEnabledRef: React.RefObject<boolean>
  chatUserScrollIntentRef: React.RefObject<boolean>
  chatAutoScrollTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  scrollChatContentToBottom: (contentElement: HTMLElement) => void
  scheduleChatAutoScroll: (contentElement?: HTMLElement | null) => void
  loadedWorkingStepIdsRef: React.RefObject<string[]>
  chatScrollAdjustmentTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  pendingChatScrollAnchorRef: React.RefObject<ChatScrollAnchor | null>
  chatViewportAnchorRef: React.RefObject<ChatScrollAnchor | null>
  previousChatScrollTopRef: React.RefObject<number | null>
  searchOpen: boolean
  searchInputRef: React.RefObject<HTMLInputElement | null>
  chatSearchReturnFocusRef: React.RefObject<HTMLElement | null>
  resetChatSearch: () => void
  chatTurnWindowRef: React.RefObject<ChatTurnWindow | null>
  chatSearchOpen: boolean
  setChatSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  chatSearchInputRef: React.RefObject<HTMLInputElement | null>
  chatSearchContentRef: React.RefObject<HTMLDivElement | null>
  chatSearchQuery: string
  chatSearchActiveIndexRef: React.RefObject<number>
  chatSearchMatchesRef: React.RefObject<Range[]>
  setChatSearchMatchCount: React.Dispatch<React.SetStateAction<number>>
  setChatSearchActiveIndex: React.Dispatch<React.SetStateAction<number>>
  setGitBranchActionState: React.Dispatch<React.SetStateAction<SendState>>
  setGitBranchError: React.Dispatch<React.SetStateAction<string | null>>
  setGitBranchDeleteRetry: React.Dispatch<React.SetStateAction<GitBranchDeleteRetry | null>>
  setGitBranchWorktreeDeleteRetry: React.Dispatch<
    React.SetStateAction<GitBranchWorktreeDeleteRetry | null>
  >
  setGitChangeLoadError: React.Dispatch<
    React.SetStateAction<ScopedGitOperationError<GitChangesScope> | null>
  >
  setUncommittedPatchFilterError: React.Dispatch<
    React.SetStateAction<ScopedGitOperationError<PatchFilterScope> | null>
  >
  setGitChangeLoadErrorDismissed: React.Dispatch<React.SetStateAction<boolean>>
  newChatOpen: boolean
  setDefaultCwd: React.Dispatch<React.SetStateAction<string | null>>
  setNewSessionCwd: React.Dispatch<React.SetStateAction<string | null>>
  gitBranchRequestIdRef: React.RefObject<number>
  setGitBranches: React.Dispatch<React.SetStateAction<AppGitBranchesResult | null>>
  setGitBranchesScope: React.Dispatch<React.SetStateAction<GitBranchesScope | null>>
  setGitBranchLoadState: React.Dispatch<React.SetStateAction<LoadState>>
  gitAvailabilityChangeId: number
  setGitChangeLoadScope: React.Dispatch<React.SetStateAction<GitChangesScope | null>>
  setGitChangeLoadState: React.Dispatch<React.SetStateAction<LoadState>>
  setGitChanges: React.Dispatch<React.SetStateAction<AppGitChangesResult | null>>
  setGitChangesScope: React.Dispatch<React.SetStateAction<GitChangesScope | null>>
  setUncommittedPatchFilterState: React.Dispatch<React.SetStateAction<LoadState>>
  setUncommittedPatchFilter: React.Dispatch<React.SetStateAction<UncommittedPatchFilter | null>>
  setFileTreeLoadScope: React.Dispatch<React.SetStateAction<FileTreeScope | null>>
  setFileTreeLoadState: React.Dispatch<React.SetStateAction<LoadState>>
  setFileTree: React.Dispatch<React.SetStateAction<AppFileTreeResult | null>>
  setFileTreeScope: React.Dispatch<React.SetStateAction<FileTreeScope | null>>
  setLastOpenedFileTreeFolderPath: React.Dispatch<React.SetStateAction<string | null>>
  lastOpenedFileTreeFolderByCwdRef: React.RefObject<Map<string, string>>
  collapsedFileTreeFoldersByCwdRef: React.RefObject<Map<string, Record<string, boolean>>>
  setCollapsedFileTreeFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  fileTreeLoadRequest: number
}
