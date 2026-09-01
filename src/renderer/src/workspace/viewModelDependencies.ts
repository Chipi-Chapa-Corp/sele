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
  ProviderChatItem,
  ProviderId,
  ProviderSubagent
} from '../../../shared/provider'

import { type PinnedChatTextReference, type RecentChatReference } from '../chatRecents'

import { type PinnedRecentChatReferencesByChat } from '../recentReferencePins'

import { type RecentlyOpenedFilesByWorkspace } from '../recentlyOpenedFiles'

import { type AppSettings } from '../settings'

import { type ChatTurnWindow } from '../chatTurnWindow'

import { type ChangeSource, type PatchFilterScope } from '../changeTree'

import { type ChatScrollAnchor } from '../chatLayout'

import { type ChatCommitMarker } from '../components/AppStatusStates'

import { type ContinuedStoppedWorkingStepsByChat } from '../chatCommitStorage'

import {
  type ApplyChatDetailOptions,
  type CachedPatchChangedFiles,
  type ChangesPaneView,
  type ChatTurnPageLoadDirection,
  type EditingMessage,
  type FileTreeScope,
  type GitBranchesScope,
  type GitChangesScope,
  type LoadState,
  type ScopedGitOperationError,
  type SendState,
  type SubagentChatView,
  type UncommittedPatchFilter
} from './controllerTypes'

export type ChangesDataDependencies = {
  changeSource: ChangeSource
  visibleChatItems: ProviderChatItem[]
  uncommittedPatchFilter: UncommittedPatchFilter | null
  changesContainerKey: string
  changesCwd: string | null
  uncommittedPatchFilterError: ScopedGitOperationError<PatchFilterScope> | null
  setCachedPatchChangedFiles: React.Dispatch<React.SetStateAction<CachedPatchChangedFiles | null>>
  gitChangesScope: GitChangesScope | null
  gitAvailabilityScopeKey: 'missing' | 'available'
  gitChanges: AppGitChangesResult | null
  fileTreeScope: FileTreeScope | null
  fileTree: AppFileTreeResult | null
  changesProjectCwd: string | null
  gitChangeLoadScope: GitChangesScope | null
  gitChangeLoadError: ScopedGitOperationError<GitChangesScope> | null
  uncommittedPatchFilterState: LoadState
  gitChangeLoadState: LoadState
  gitChangeLoadErrorDismissed: boolean
  fileTreeLoadScope: FileTreeScope | null
  fileTreeLoadState: LoadState
  cachedPatchChangedFiles: CachedPatchChangedFiles | null
  changesContainer: AppContainerTarget | null
  gitBranchesScope: GitBranchesScope | null
  gitBranches: AppGitBranchesResult | null
  changesPaneView: ChangesPaneView
  selectedChat: ProviderChat | null
}

export type ConversationViewModelDependencies = {
  selectedChat: ProviderChat | null
  newSessionProviderAvailable: boolean
  providerUpdateInProgress: boolean
  chatLoadState: LoadState
  activeSubagentChatView: SubagentChatView | null
  chatHasActiveTurn: boolean
  chatDetail: ProviderChatDetail | null
  sendState: SendState
  editingMessage: EditingMessage | null
  selectedChatSubagents: ProviderSubagent[]
  effectiveAppSettings: AppSettings
  selectedChatId: string | undefined
  selectedChatKey: string | null
  recentChatReferencePage: {
    chatKey: string
    items: ProviderChatItem[]
    latestItemId: string | null
    messageLimit: number
    totalTurnCount: number
  } | null
  recentChatReferencesCache: { chatKey: string; references: RecentChatReference[] } | null
  pinnedRecentChatReferences: PinnedRecentChatReferencesByChat
  recentlyOpenedFilesByWorkspace: RecentlyOpenedFilesByWorkspace
  recentlyOpenedFilesWorkspaceKey: string
  changesPaneView: ChangesPaneView
  selectedProviderId: 'codex' | 'claude' | 'copilot' | 'opencode' | undefined
  setRecentChatReferencePage: React.Dispatch<
    React.SetStateAction<{
      chatKey: string
      items: ProviderChatItem[]
      latestItemId: string | null
      messageLimit: number
      totalTurnCount: number
    } | null>
  >
  setRecentChatReferencesCache: React.Dispatch<
    React.SetStateAction<{ chatKey: string; references: RecentChatReference[] } | null>
  >
  chatTurnWindow: ChatTurnWindow | null
  chatAtConversationBottom: boolean
  pendingPinnedMessageNavigationRef: React.RefObject<PinnedChatTextReference | null>
  scrollPinnedChatMessageIntoView: (messageId: string) => boolean
  chatTurnPageLoadRequestRef: React.RefObject<number>
  chatTurnPageLoadInFlightRef: React.RefObject<boolean>
  chatTurnScrollDirectionRef: React.RefObject<'up' | 'down' | null>
  setChatTurnPageLoadDirection: React.Dispatch<
    React.SetStateAction<ChatTurnPageLoadDirection | null>
  >
  chatTurnWindowRef: React.RefObject<ChatTurnWindow | null>
  setChatTurnWindow: React.Dispatch<React.SetStateAction<ChatTurnWindow | null>>
  chatAutoScrollEnabledRef: React.RefObject<boolean>
  scrollToLatestTurnAfterRenderRef: React.RefObject<boolean>
  pendingChatScrollAnchorRef: React.RefObject<ChatScrollAnchor | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  chatScrollAdjustmentTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  chatViewportAnchorRef: React.RefObject<ChatScrollAnchor | null>
  scrollChatContentToBottom: (contentElement: HTMLElement) => void
  selectedChatRef: React.RefObject<ProviderChat | null>
  selectedChatKeyRef: React.RefObject<string | null>
  applyViewedChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  chatAutoScrollTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  setChatDetail: React.Dispatch<React.SetStateAction<ProviderChatDetail | null>>
  chatDetailRef: React.RefObject<ProviderChatDetail | null>
  handleChatContentScroll: () => boolean
  handleChatContentWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  continuedStoppedWorkingStepsByChat: ContinuedStoppedWorkingStepsByChat
  selectedChatCommitMarkers: ChatCommitMarker[]
}
