import { useRef, useState } from 'react'
import type {
  AppContainerTarget,
  AppGitBranchesResult,
  AppGitChangesResult
} from '../../../../shared/app'
import {
  readStoredChatCommitMarkers,
  readStoredContinuedStoppedWorkingSteps,
  type ContinuedStoppedWorkingStepsByChat,
  type ScopedCommitActivity,
  type StartingScopedCommitActivity
} from '../../chatCommitStorage'
import { type ChatCommitMarker } from '../../components/AppStatusStates'
import type { FileTreeIndex } from '../../fileTreeIndex'
import { usePreferenceState } from '../../usePreferenceState'
import {
  readGitCommitMode,
  type CommitChatReturnTarget,
  type DirectCommitActivity,
  type FileTreeScope,
  type GitBranchDeleteRetry,
  type GitBranchWorktreeDeleteRetry,
  type GitBranchesScope,
  type GitChangesScope,
  type GitCommitMode,
  type GitSyncRecoveryState,
  type LoadState,
  type ScopedGitOperationError,
  type SendState,
  type SourceAvailabilityState
} from '../controllerTypes'

export function useWorkspaceGitState() {
  const [gitChanges, setGitChanges] = useState<AppGitChangesResult | null>(null)

  const [gitChangesScope, setGitChangesScope] = useState<GitChangesScope | null>(null)

  const [gitChangeLoadState, setGitChangeLoadState] = useState<LoadState>('ready')

  const [gitChangeLoadScope, setGitChangeLoadScope] = useState<GitChangesScope | null>(null)

  const [gitChangeLoadError, setGitChangeLoadError] = useState<ScopedGitOperationError | null>(null)

  const [gitChangeLoadErrorDismissed, setGitChangeLoadErrorDismissed] = useState(false)

  const [gitChangeLoadRequest, setGitChangeLoadRequest] = useState(0)

  const [gitBranches, setGitBranches] = useState<AppGitBranchesResult | null>(null)

  const [gitBranchesScope, setGitBranchesScope] = useState<GitBranchesScope | null>(null)

  const [gitBranchLoadState, setGitBranchLoadState] = useState<LoadState>('ready')

  const [gitBranchLoadRequest, setGitBranchLoadRequest] = useState(0)

  // Operation locks survive navigation, which invalidates the visible branch request.
  const [branchActionProjectKeys, setBranchActionProjectKeys] = useState<Set<string>>(
    () => new Set()
  )

  const branchActionProjectKeysRef = useRef(new Set<string>())

  const [gitBranchActionState, setGitBranchActionState] = useState<SendState>('idle')

  const [gitBranchError, setGitBranchError] = useState<string | null>(null)

  const [gitBranchDeleteRetry, setGitBranchDeleteRetry] = useState<GitBranchDeleteRetry | null>(
    null
  )

  const [gitBranchWorktreeDeleteRetry, setGitBranchWorktreeDeleteRetry] =
    useState<GitBranchWorktreeDeleteRetry | null>(null)

  const [gitSourceAvailability, setGitSourceAvailability] =
    useState<SourceAvailabilityState | null>(null)

  const [lastGitAvailable, setLastGitAvailable] = useState<boolean | null>(null)

  const [gitAvailabilityChangeId, setGitAvailabilityChangeId] = useState(0)

  const [fileTree, setFileTree] = useState<FileTreeIndex | null>(null)

  const [fileTreeScope, setFileTreeScope] = useState<FileTreeScope | null>(null)

  const [fileTreeLoadState, setFileTreeLoadState] = useState<LoadState>('ready')

  const [fileTreeLoadError, setFileTreeLoadError] = useState<string | null>(null)

  const [fileTreeLoadScope, setFileTreeLoadScope] = useState<FileTreeScope | null>(null)

  const [fileTreeLoadRequest, setFileTreeLoadRequest] = useState(0)

  const [collapsedChangeTreeFolders, setCollapsedChangeTreeFolders] = useState<
    Record<string, boolean>
  >({})

  const [collapsedFileTreeFolders, setCollapsedFileTreeFolders] = useState<Record<string, boolean>>(
    {}
  )

  const [commitInput, setCommitInput] = useState('')

  const [gitCommitMode, setGitCommitMode] = usePreferenceState<GitCommitMode>(readGitCommitMode)

  const [commitMessageGenerationProjectKeys, setCommitMessageGenerationProjectKeys] = useState<
    Set<string>
  >(() => new Set())

  const [commitErrorsByProjectKey, setCommitErrorsByProjectKey] = useState<Record<string, string>>(
    {}
  )

  const [scopedCommitActivities, setScopedCommitActivities] = useState<
    Record<string, ScopedCommitActivity>
  >({})

  const [chatCommitMarkers, setChatCommitMarkers] = usePreferenceState<
    Record<string, ChatCommitMarker>
  >(readStoredChatCommitMarkers)

  const [continuedStoppedWorkingStepsByChat, setContinuedStoppedWorkingStepsByChat] =
    usePreferenceState<ContinuedStoppedWorkingStepsByChat>(readStoredContinuedStoppedWorkingSteps)

  const [startingScopedCommitActivities, setStartingScopedCommitActivities] = useState<
    Record<string, StartingScopedCommitActivity>
  >({})

  const [directCommitActivities, setDirectCommitActivities] = useState<
    Record<string, DirectCommitActivity>
  >({})

  const [cancelingAiCommitKeys, setCancelingAiCommitKeys] = useState<Set<string>>(() => new Set())

  const [openingAiCommitChatIds, setOpeningAiCommitChatIds] = useState<Set<string>>(() => new Set())

  const [commitChatReturnTarget, setCommitChatReturnTarget] =
    useState<CommitChatReturnTarget | null>(null)

  const [syncProjectKeys, setSyncProjectKeys] = useState<Set<string>>(() => new Set())

  const [syncErrorsByProjectKey, setSyncErrorsByProjectKey] = useState<Record<string, string>>({})

  const [syncRecoveriesByProjectKey, setSyncRecoveriesByProjectKey] = useState<
    Record<string, GitSyncRecoveryState>
  >({})

  const visibleGitErrorProjectKeyRef = useRef<string | null>(null)

  const commitInFlightProjectKeysRef = useRef(new Set<string>())

  const commitMessageGenerationProjectKeysRef = useRef(new Set<string>())

  const syncProjectKeysRef = useRef(new Set<string>())

  const gitBranchRequestIdRef = useRef(0)

  const changesCwdRef = useRef<string | null>(null)

  const changesContainerRef = useRef<AppContainerTarget | null>(null)

  const gitAvailableRef = useRef<boolean | null>(null)

  const scopedCommitActivitiesRef =
    useRef<Record<string, ScopedCommitActivity>>(scopedCommitActivities)

  const startingScopedCommitActivitiesRef = useRef<Record<string, StartingScopedCommitActivity>>({})

  const collapsedFileTreeFoldersByCwdRef = useRef(new Map<string, Record<string, boolean>>())
  return {
    gitChanges,
    setGitChanges,
    gitChangesScope,
    setGitChangesScope,
    gitChangeLoadState,
    setGitChangeLoadState,
    gitChangeLoadScope,
    setGitChangeLoadScope,
    gitChangeLoadError,
    setGitChangeLoadError,
    gitChangeLoadErrorDismissed,
    setGitChangeLoadErrorDismissed,
    gitChangeLoadRequest,
    setGitChangeLoadRequest,
    gitBranches,
    setGitBranches,
    gitBranchesScope,
    setGitBranchesScope,
    gitBranchLoadState,
    setGitBranchLoadState,
    gitBranchLoadRequest,
    setGitBranchLoadRequest,
    branchActionProjectKeys,
    setBranchActionProjectKeys,
    branchActionProjectKeysRef,
    gitBranchActionState,
    setGitBranchActionState,
    gitBranchError,
    setGitBranchError,
    gitBranchDeleteRetry,
    setGitBranchDeleteRetry,
    gitBranchWorktreeDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    gitSourceAvailability,
    setGitSourceAvailability,
    lastGitAvailable,
    setLastGitAvailable,
    gitAvailabilityChangeId,
    setGitAvailabilityChangeId,
    fileTree,
    setFileTree,
    fileTreeScope,
    setFileTreeScope,
    fileTreeLoadState,
    setFileTreeLoadState,
    fileTreeLoadError,
    setFileTreeLoadError,
    fileTreeLoadScope,
    setFileTreeLoadScope,
    fileTreeLoadRequest,
    setFileTreeLoadRequest,
    collapsedChangeTreeFolders,
    setCollapsedChangeTreeFolders,
    collapsedFileTreeFolders,
    setCollapsedFileTreeFolders,
    commitInput,
    setCommitInput,
    gitCommitMode,
    setGitCommitMode,
    commitMessageGenerationProjectKeys,
    setCommitMessageGenerationProjectKeys,
    commitErrorsByProjectKey,
    setCommitErrorsByProjectKey,
    scopedCommitActivities,
    setScopedCommitActivities,
    chatCommitMarkers,
    setChatCommitMarkers,
    continuedStoppedWorkingStepsByChat,
    setContinuedStoppedWorkingStepsByChat,
    startingScopedCommitActivities,
    setStartingScopedCommitActivities,
    directCommitActivities,
    setDirectCommitActivities,
    cancelingAiCommitKeys,
    setCancelingAiCommitKeys,
    openingAiCommitChatIds,
    setOpeningAiCommitChatIds,
    commitChatReturnTarget,
    setCommitChatReturnTarget,
    syncProjectKeys,
    setSyncProjectKeys,
    syncErrorsByProjectKey,
    setSyncErrorsByProjectKey,
    syncRecoveriesByProjectKey,
    setSyncRecoveriesByProjectKey,
    visibleGitErrorProjectKeyRef,
    commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef,
    syncProjectKeysRef,
    gitBranchRequestIdRef,
    changesCwdRef,
    changesContainerRef,
    gitAvailableRef,
    scopedCommitActivitiesRef,
    startingScopedCommitActivitiesRef,
    collapsedFileTreeFoldersByCwdRef
  }
}
