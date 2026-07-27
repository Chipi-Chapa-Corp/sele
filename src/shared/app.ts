export type FolderSelectionOptions = {
  defaultPath?: string | null
}

export type AppProjectIconOptions = {
  cwd?: string | null
}

export type AppProjectIcon = {
  cwd: string | null
  dataUrl: string
  updatedAt: number
}

export type AppColorScheme = 'dark' | 'light'

export type AppWindowState = {
  isMaximized: boolean
}

export type AppDiagnosticsInteractionKind =
  'edit-message' | 'message-input' | 'notes-toggle' | 'plan-toggle' | 'stop-response'

export type AppDiagnosticsInteraction = {
  timestamp: number
  kind: AppDiagnosticsInteractionKind
}

export type AppDiagnosticsHeartbeat = {
  timestamp: number
  jsHeapUsedBytes: number | null
  jsHeapTotalBytes: number | null
  domNodeCount: number
  activeAnimationCount: number
  animatedIconCount: number
  streamingMessageCount: number
  workingSpinnerCount: number
  messageInputLength: number
  messageInputFocused: boolean
  openNotesCount: number
  openPlanCount: number
  openWorkingDetailsCount: number
  lastInteractionAt: number | null
  lastInteractionKind: AppDiagnosticsInteractionKind | null
  visibilityState: string
}

export type AppGitChangeSource = 'branch' | 'uncommitted'

export type AppGitChangeKind = 'edit' | 'create' | 'delete' | 'rename' | 'untracked'

export type AppGitCommitAction = 'commit' | 'amend'

export type AppGitFileChange = {
  path: string
  previousPath?: string | null
  kind: AppGitChangeKind
  status: string
}

export type AppGitPatchChange = {
  path: string
  kind: Extract<AppGitChangeKind, 'edit' | 'create' | 'delete'>
  diff: string
}

export type AppFileTreeFile = {
  path: string
  previousPath?: string | null
  kind?: AppGitChangeKind | null
  status?: string | null
}

export type AppGitChangesOptions = {
  cwd?: string | null
  source: AppGitChangeSource
}

export type AppGitBranchesOptions = {
  cwd?: string | null
}

export type AppGitSwitchBranchOptions = AppGitBranchesOptions & {
  branchName: string
  create?: boolean
}

export type AppGitBranchesResult = {
  repositoryRoot: string
  currentBranch: string | null
  branches: string[]
}

export type AppFileTreeOptions = {
  cwd?: string | null
}

export type AppGitChangesResult = {
  repositoryRoot: string
  branchName: string | null
  baseRef: string | null
  unpulledCount: number
  unpushedCount: number
  files: AppGitFileChange[]
}

export type AppFileTreeResult = {
  repositoryRoot: string
  branchName: string | null
  files: AppFileTreeFile[]
}

export type AppFileContentsOptions = {
  cwd?: string | null
  path: string
}

export type AppFileContentsResult = {
  contents: string
  version: string
}

export type AppWriteFileContentsOptions = AppFileContentsOptions & {
  contents: string
  expectedVersion: string
}

export type AppWriteFileContentsResult = {
  version: string
}

export type AppGitCommitOptions = {
  cwd?: string | null
  action?: AppGitCommitAction
  files: string[]
  patches?: AppGitPatchChange[]
  message?: string | null
}

export type AppGitRecentCommitMessagesOptions = {
  cwd?: string | null
  limit?: number | null
}

export type AppGitRecentCommitMessagesResult = {
  messages: string[]
}

export type AppGitDiffOptions = {
  cwd?: string | null
}

export type AppGitDiffResult = {
  diff: string
}

export type AppGitFileDiffOptions = AppFileContentsOptions & {
  previousPath?: string | null
}

export type AppGitFileDiffResult = {
  diff: string
}

export type AppGitUncommittedPatchChangesOptions = {
  cwd?: string | null
  patches: AppGitPatchChange[]
}

export type AppGitUncommittedPatchChangesResult = {
  patches: AppGitPatchChange[]
}

export type AppGitCommitResult = {
  commitHash: string
  pushed: boolean
}

export type AppGitPushOptions = {
  cwd?: string | null
}

export type AppGitPullStrategy = 'ff-only' | 'rebase' | 'merge'

export type AppGitRecoveryActionId = 'pull-rebase' | 'pull-merge' | 'pull-and-push'

export type AppGitRecoveryAction = {
  id: AppGitRecoveryActionId
  label: string
  description: string
}

export type AppGitRecoverableFailure = {
  kind: 'pull-diverged' | 'push-rejected'
  title: string
  message: string
  command: string
  actions: AppGitRecoveryAction[]
}

export type AppGitPushResult = {
  pushed: boolean
  failure?: AppGitRecoverableFailure | null
}

export type AppGitPullOptions = {
  cwd?: string | null
  rememberStrategy?: boolean
  strategy?: AppGitPullStrategy
}

export type AppGitPullResult = {
  pulled: boolean
  failure?: AppGitRecoverableFailure | null
}

export type AppApi = {
  getColorScheme: () => Promise<AppColorScheme>
  getWindowState: () => Promise<AppWindowState>
  minimizeWindow: () => Promise<void>
  toggleWindowMaximized: () => Promise<AppWindowState>
  closeWindow: () => Promise<void>
  getDefaultCwd: () => Promise<string>
  getGitChanges: (options: AppGitChangesOptions) => Promise<AppGitChangesResult>
  getGitBranches: (options?: AppGitBranchesOptions) => Promise<AppGitBranchesResult>
  switchGitBranch: (options: AppGitSwitchBranchOptions) => Promise<AppGitBranchesResult>
  getFileTree: (options?: AppFileTreeOptions) => Promise<AppFileTreeResult>
  getFileContents: (options: AppFileContentsOptions) => Promise<AppFileContentsResult>
  writeFileContents: (options: AppWriteFileContentsOptions) => Promise<AppWriteFileContentsResult>
  getRecentGitCommitMessages: (
    options?: AppGitRecentCommitMessagesOptions
  ) => Promise<AppGitRecentCommitMessagesResult>
  getUncommittedGitDiff: (options?: AppGitDiffOptions) => Promise<AppGitDiffResult>
  getGitFileDiff: (options: AppGitFileDiffOptions) => Promise<AppGitFileDiffResult>
  getUncommittedGitPatchChanges: (
    options: AppGitUncommittedPatchChangesOptions
  ) => Promise<AppGitUncommittedPatchChangesResult>
  commitGitChanges: (options: AppGitCommitOptions) => Promise<AppGitCommitResult>
  pullGitChanges: (options?: AppGitPullOptions) => Promise<AppGitPullResult>
  pushGitChanges: (options?: AppGitPushOptions) => Promise<AppGitPushResult>
  selectFolder: (options?: FolderSelectionOptions) => Promise<string | null>
  getProjectIcon: (options: AppProjectIconOptions) => Promise<AppProjectIcon | null>
  selectProjectIcon: (options: AppProjectIconOptions) => Promise<AppProjectIcon | null>
  onColorSchemeUpdated: (listener: (scheme: AppColorScheme) => void) => () => void
  onWindowStateUpdated: (listener: (state: AppWindowState) => void) => () => void
}

export const appIpcChannels = {
  getColorScheme: 'app:get-color-scheme',
  colorSchemeUpdated: 'app:color-scheme-updated',
  getWindowState: 'app:get-window-state',
  windowStateUpdated: 'app:window-state-updated',
  minimizeWindow: 'app:minimize-window',
  toggleWindowMaximized: 'app:toggle-window-maximized',
  closeWindow: 'app:close-window',
  getDefaultCwd: 'app:get-default-cwd',
  getGitChanges: 'app:get-git-changes',
  getGitBranches: 'app:get-git-branches',
  switchGitBranch: 'app:switch-git-branch',
  getFileTree: 'app:get-file-tree',
  getFileContents: 'app:get-file-contents',
  writeFileContents: 'app:write-file-contents',
  getRecentGitCommitMessages: 'app:get-recent-git-commit-messages',
  getUncommittedGitDiff: 'app:get-uncommitted-git-diff',
  getGitFileDiff: 'app:get-git-file-diff',
  getUncommittedGitPatchChanges: 'app:get-uncommitted-git-patch-changes',
  commitGitChanges: 'app:commit-git-changes',
  pullGitChanges: 'app:pull-git-changes',
  pushGitChanges: 'app:push-git-changes',
  selectFolder: 'app:select-folder',
  getProjectIcon: 'app:get-project-icon',
  selectProjectIcon: 'app:select-project-icon',
  diagnosticsHeartbeat: 'app:diagnostics-heartbeat',
  diagnosticsInteraction: 'app:diagnostics-interaction'
} as const
