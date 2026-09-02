import type * as React from 'react'

import type {
  AppContainerTarget,
  AppProject,
  AppSelectedAttachment,
  AppProjectIcon
} from '../../../shared/app'

import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatUpdateSummary,
  ProviderChatMetadata,
  ProviderActiveSendMode,
  ProviderAgentMode,
  ProviderApprovalMode,
  ProviderApprovalDecision,
  ProviderPendingApproval,
  ProviderPendingUserInput,
  ProviderId,
  ProviderModel,
  ProviderReview,
  ProviderSandboxMode,
  ProviderAppInput,
  ProviderSkillInput,
  ProviderTurnOptions
} from '../../../shared/provider'

import { type ChatListGroupData } from '../components/ChatListGroup'

import type { MessageBoxQuoteRequest } from '../components/MessageBox'

import {
  type AppProjectSettingsByCwd,
  type AppProjectSettingsOverrides,
  type AppSettings
} from '../settings'

import { type ChatTurnWindow } from '../chatTurnWindow'

import { type ChatScrollAnchor } from '../chatLayout'

import { type ProviderUpdatePreference, type ProviderUpdateSuggestion } from '../providerSettings'

import { type ContinuedStoppedWorkingStepsByChat } from '../chatCommitStorage'

import {
  type ApplyChatDetailOptions,
  type ApprovalResolutionState,
  type ChatGroupingPreference,
  type EditingMessage,
  type RecentChatCacheEntry,
  type NewSessionLocation,
  type ProviderUpdateState,
  type SendState,
  type SubagentChatView,
  type UserInputResolutionState,
  type WorktreeCreationState
} from './controllerTypes'

export type ChatInteractionControllerDependencies = {
  contentRef: React.RefObject<HTMLDivElement | null>
  chatTurnWindowRef: React.RefObject<ChatTurnWindow | null>
  chatScrollAdjustmentTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  previousChatScrollTopRef: React.RefObject<number | null>
  chatTurnScrollDirectionRef: React.RefObject<'up' | 'down' | null>
  setChatAtConversationBottom: React.Dispatch<React.SetStateAction<boolean>>
  chatViewportAnchorRef: React.RefObject<ChatScrollAnchor | null>
  chatAutoScrollEnabledRef: React.RefObject<boolean>
  chatUserScrollIntentRef: React.RefObject<boolean>
  chatAutoScrollTargetRef: React.RefObject<{ element: HTMLElement; top: number } | null>
  scheduleChatAutoScroll: (contentElement?: HTMLElement | null) => void
  chatUserScrollIntentFrameRef: React.RefObject<number | null>
  searchTerms: string[]
  collapsedCwdGroups: Record<string, boolean>
  effectiveAppSettings: AppSettings
  visibleChatPageCountsByGroup: Record<string, number>
  projectRecordsByCwd: Map<string, AppProject>
  projectIconsByGroup: Record<string, AppProjectIcon | null>
  activeChatGroups: ChatListGroupData[]
  chatGroupingPreference: ChatGroupingPreference
  projectDropInsertionIndex: number | null
  selectedChat: ProviderChat | null
  committingChatKeys: Set<string>
  latestCommitFinishedAtByChatKey: ReadonlyMap<string, number>
  draggedProjectGroupKey: string | null
  projectNamesByCwd: Map<string, string>
  handleLoadMoreChatsInGroup: (group: ChatListGroupData) => void
  handleShowLessChatsInGroup: (group: ChatListGroupData) => void
  handleMarkChatDone: (chat: ProviderChat, done?: boolean) => Promise<void>
  restoreExpandedProjectsAfterDrag: () => void
  handleProjectDragStart: (event: React.DragEvent<HTMLElement>, group: ChatListGroupData) => void
  handleMarkCwdChatsDone: (group: ChatListGroupData) => Promise<void>
  handleNewChatInCwd: (group: ChatListGroupData) => void
  handleRenameChat: (chat: ProviderChat, title: string) => Promise<void>
  handleSelectProjectIcon: (group: ChatListGroupData) => Promise<void>
  handleResolveChatApproval: (
    chat: ProviderChat,
    decision: ProviderApprovalDecision
  ) => Promise<void>
  handleReorderChats: (group: ChatListGroupData, orderedChats: ProviderChat[]) => void
  handleSelectChat: (chat: ProviderChat) => void
  handleToggleCwdGroup: (groupKey: string) => void
  handleToggleChatPinned: (chat: ProviderChat) => Promise<void>
  handleUnpinPinnedChats: (group: ChatListGroupData) => Promise<void>
  resolvingApprovalId: string | null
  chatDetail: ProviderChatDetail | null
  sendState: SendState
  providerUpdateInProgress: boolean
  forkInFlightRef: React.RefObject<boolean>
  setSendState: React.Dispatch<React.SetStateAction<SendState>>
  setSendError: React.Dispatch<React.SetStateAction<string | null>>
  setForkingMessageId: React.Dispatch<React.SetStateAction<string | null>>
  applyViewedChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  handleSendFailure: (error: unknown, fallback: string) => void
  setMessageBoxQuoteRequest: React.Dispatch<React.SetStateAction<MessageBoxQuoteRequest | null>>
  runPromptActionRef: React.RefObject<(prompt: string, target: 'current' | 'new') => Promise<void>>
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
}

export type ChatMessagingControllerDependencies = {
  chatDetail: ProviderChatDetail | null
  sendInFlightRef: React.RefObject<boolean>
  setSendState: React.Dispatch<React.SetStateAction<SendState>>
  setEditingMessage: React.Dispatch<React.SetStateAction<EditingMessage | null>>
  selectedChatId: string | undefined
  models: ProviderModel[]
  changesProjectCwd: string | null
  projectRecordsByCwd: Map<string, AppProject>
  agentMode: ProviderAgentMode
  effectiveApprovalMode: ProviderApprovalMode
  effectiveSandboxMode: ProviderSandboxMode
  changesContainer: AppContainerTarget | null
  changesCwd: string | null
  effectiveModel: string
  selectedEffectiveModel: ProviderModel | undefined
  effectiveReasoningEffort: string
  effectiveServiceTier: string | null
  effectiveAppSettings: AppSettings
  configProviderId: 'codex' | 'claude' | 'copilot' | 'opencode'
  configProviderContainerKey: string
  worktreeCreationCanceledRef: React.RefObject<boolean>
  setWorktreeCreationState: React.Dispatch<React.SetStateAction<WorktreeCreationState>>
  worktreeBranchGenerationRef: React.RefObject<{
    generationId: string
    providerId: ProviderId
  } | null>
  providerUpdateInProgress: boolean
  activeSubagentChatView: SubagentChatView | null
  selectedChat: ProviderChat | null
  newSessionCwd: string | null
  sendInFlightProjectKeyRef: React.RefObject<string | null>
  setSendInFlightProjectKey: React.Dispatch<React.SetStateAction<string | null>>
  chatAutoScrollEnabledRef: React.RefObject<boolean>
  setChatAtConversationBottom: React.Dispatch<React.SetStateAction<boolean>>
  scrollToLatestTurnAfterRenderRef: React.RefObject<boolean>
  editingMessage: EditingMessage | null
  applyViewedChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  handleSendFailure: (error: unknown, fallback: string) => void
  newSessionProvider: 'codex' | 'claude' | 'copilot' | 'opencode'
  newSessionLocation: NewSessionLocation
  defaultCwd: string | null
  rememberProject: (cwd: string | null | undefined) => Promise<void>
  chatHasActiveTurn: boolean
  applyChatSummary: (
    providerId: ProviderId,
    summary: ProviderChatUpdateSummary,
    turnCompleted: boolean
  ) => void
  markChatSeenAt: (providerId: ProviderId, chatId: string, seenUpdatedAt: number) => void
  selectedChatKeyRef: React.RefObject<string | null>
  setContinuedStoppedWorkingStepsByChat: React.Dispatch<
    React.SetStateAction<ContinuedStoppedWorkingStepsByChat>
  >
  runPromptActionRef: React.RefObject<(prompt: string, target: 'current' | 'new') => Promise<void>>
  selectedChatRef: React.RefObject<ProviderChat | null>
  chatDetailRef: React.RefObject<ProviderChatDetail | null>
  loadedWorkingStepIdsRef: React.RefObject<string[]>
  setChatDetail: React.Dispatch<React.SetStateAction<ProviderChatDetail | null>>
  selectedProviderId: 'codex' | 'claude' | 'copilot' | 'opencode' | undefined
  approvalResolution: ApprovalResolutionState
  setApprovalResolution: React.Dispatch<React.SetStateAction<ApprovalResolutionState>>
  applyChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  pendingApproval: ProviderPendingApproval | null
  approvalDecisionInFlight: ProviderApprovalDecision | null
  pendingUserInput: ProviderPendingUserInput | null
  userInputResolving: boolean
  setUserInputResolution: React.Dispatch<React.SetStateAction<UserInputResolutionState>>
  sendState: SendState
}

export type ChatListControllerDependencies = {
  applyChatMetadata: (metadataList: ProviderChatMetadata[]) => void
  removeRecentChatCacheEntry: (providerId: ProviderId, chatId: string) => void
  selectedChat: ProviderChat | null
  chatDetail: ProviderChatDetail | null
  showNewChatView: (projectCwd?: string | null, container?: AppContainerTarget | null) => void
  newSessionContainer: AppContainerTarget
  applyChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    options?: ApplyChatDetailOptions
  ) => void
  chatOrderMutationsRef: React.RefObject<Map<string, number>>
  setChats: React.Dispatch<React.SetStateAction<ProviderChat[]>>
  projectCollapseFrameRef: React.RefObject<number | null>
  expandedProjectGroupsBeforeDragRef: React.RefObject<Set<string> | null>
  draggedProjectGroupKeyRef: React.RefObject<string | null>
  projectDropInsertionIndexRef: React.RefObject<number | null>
  setDraggedProjectGroupKey: React.Dispatch<React.SetStateAction<string | null>>
  setProjectDropInsertionIndex: React.Dispatch<React.SetStateAction<number | null>>
  activeChatGroups: ChatListGroupData[]
  setCollapsedCwdGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  projectOrderMutationRef: React.RefObject<number>
  projects: AppProject[]
  setProjects: React.Dispatch<React.SetStateAction<AppProject[]>>
  chatGroupingPreference: ChatGroupingPreference
  searchTerms: string[]
  collapsedCwdGroups: Record<string, boolean>
}

export type SettingsControllerDependencies = {
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  settingsProjectCwd: string | null
  setProjectSettingsByCwd: React.Dispatch<React.SetStateAction<AppProjectSettingsByCwd>>
  settingsViewIsProject: boolean
  effectiveAppSettings: AppSettings
  setAppearanceZoomLevelInputDraft: React.Dispatch<
    React.SetStateAction<{ key: string; value: string } | null>
  >
  setBrowserDefaultScaleInputDraft: React.Dispatch<
    React.SetStateAction<{ key: string; value: string } | null>
  >
  setAppearanceFontSizeInputDraft: React.Dispatch<
    React.SetStateAction<{ key: string; value: string } | null>
  >
  settingsProjectOverrides: AppProjectSettingsOverrides | undefined
  settingsScopeKey: string
  updateAppearanceZoomLevel: (value: number, clearInputDraft?: boolean) => void
  settingsPanelSettings: AppSettings
  recentChatCacheLimitRef: React.RefObject<number>
  recentChatCacheRef: React.RefObject<Map<string, RecentChatCacheEntry>>
  selectedChat: ProviderChat | null
  chatDetail: ProviderChatDetail | null
  cacheRecentChatDetail: (
    providerId: ProviderId,
    detail: ProviderChatDetail,
    updatedAt: number,
    force?: boolean
  ) => void
  newSessionProvider: 'codex' | 'claude' | 'copilot' | 'opencode'
  newSessionContainerKey: string
  setProjects: React.Dispatch<React.SetStateAction<AppProject[]>>
  setNewSessionCwd: React.Dispatch<React.SetStateAction<string | null>>
  setProjectDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  setProjectIconsByGroup: React.Dispatch<
    React.SetStateAction<Record<string, AppProjectIcon | null>>
  >
  modelManuallySelectedRef: React.RefObject<boolean>
  setModel: React.Dispatch<React.SetStateAction<string>>
  models: ProviderModel[]
  setReasoningEffort: React.Dispatch<React.SetStateAction<string>>
  reasoningManuallySelectedRef: React.RefObject<boolean>
  sandboxMode: ProviderSandboxMode
  approvalModeManuallySelectedRef: React.RefObject<boolean>
  setApprovalMode: React.Dispatch<React.SetStateAction<ProviderApprovalMode>>
  sandboxModeManuallySelectedRef: React.RefObject<boolean>
  approvalModeBeforeFullAccessRef: React.RefObject<ProviderApprovalMode | null>
  approvalMode: ProviderApprovalMode
  setSandboxMode: React.Dispatch<React.SetStateAction<ProviderSandboxMode>>
  setProviderUpdatePreferences: React.Dispatch<
    React.SetStateAction<
      Partial<Record<'codex' | 'claude' | 'copilot' | 'opencode', ProviderUpdatePreference>>
    >
  >
  setProviderUpdateSuggestion: React.Dispatch<React.SetStateAction<ProviderUpdateSuggestion | null>>
  setProviderUpdateError: React.Dispatch<React.SetStateAction<string | null>>
  providerUpdateSuggestion: ProviderUpdateSuggestion | null
  providerUpdateState: ProviderUpdateState
  setProviderUpdateState: React.Dispatch<React.SetStateAction<ProviderUpdateState>>
  newSessionContainer: AppContainerTarget
  setProviderModelsRevision: React.Dispatch<React.SetStateAction<number>>
  providerUpdatePreferences: Partial<
    Record<'codex' | 'claude' | 'copilot' | 'opencode', ProviderUpdatePreference>
  >
}
