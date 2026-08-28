import type { ProviderId } from './provider'

export type FolderSelectionOptions = {
  defaultPath?: string | null
}

export type AppProjectIconOptions = {
  cwd?: string | null
  persist?: boolean
}

export type AppProjectIcon = {
  cwd: string | null
  dataUrl: string
  selectionId?: string
  updatedAt: number
}

export const appProjectGlyphIds = [
  'folder',
  'code',
  'git',
  'package',
  'database',
  'web',
  'mobile',
  'server'
] as const

export type AppProjectGlyph = (typeof appProjectGlyphIds)[number]

export type AppProjectIconKind = AppProjectGlyph | 'image'

export const isAppProjectIconKind = (value: unknown): value is AppProjectIconKind =>
  value === 'image' || appProjectGlyphIds.includes(value as AppProjectGlyph)

export type AppProject = {
  cwd: string
  name: string
  icon: AppProjectIconKind | null
  additionalCwds: string[]
  sidebarOrder: number | null
  addedAt: number
  updatedAt: number
}

export type AppAddProjectOptions = {
  cwd: string
  name?: string
  icon?: AppProjectIconKind | null
  iconSelectionId?: string
  additionalCwds?: string[]
}

export type AppLocalImageOptions = {
  container?: AppContainerTarget | null
  cwd?: string | null
  path: string
  relativeTo?: 'cwd' | 'repository'
}

export type AppLocalImage = {
  data: ArrayBuffer
  mimeType: string
  updatedAt: number
}

export type AppSelectedImage = {
  kind: 'image'
  dataUrl: string
  name: string
  path: string
}

export type AppSelectedFile = {
  kind: 'file'
  name: string
  path: string
}

export type AppSelectedAttachment = AppSelectedImage | AppSelectedFile

export type AppColorScheme = 'dark' | 'light'

export type AppExternalLinkAction = 'copy' | 'open'

export type AppExternalLinkOptions = {
  url: string
  action?: AppExternalLinkAction
}

export type AppExternalLinkResult = {
  action: AppExternalLinkAction
  always: boolean
}

export type AppWindowState = {
  isMaximized: boolean
}

const appWindowZoomFactorBase = 1.2
const appWindowZoomPercentBase = 100
export const appWindowZoomPercentDefault = 125
export const appWindowZoomLevelDefault =
  Math.log(appWindowZoomPercentDefault / appWindowZoomPercentBase) /
  Math.log(appWindowZoomFactorBase)
export const appWindowZoomLevelMin = -4
export const appWindowZoomLevelMax = 6

export const normalizeAppWindowZoomLevel = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return appWindowZoomLevelDefault

  return Math.min(Math.max(value, appWindowZoomLevelMin), appWindowZoomLevelMax)
}

export const appWindowZoomPercentMin = Math.round(
  appWindowZoomPercentBase * appWindowZoomFactorBase ** appWindowZoomLevelMin
)
export const appWindowZoomPercentMax = Math.round(
  appWindowZoomPercentBase * appWindowZoomFactorBase ** appWindowZoomLevelMax
)

export const normalizeAppWindowZoomPercent = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return appWindowZoomPercentDefault

  return Math.min(Math.max(Math.round(value), appWindowZoomPercentMin), appWindowZoomPercentMax)
}

export const appWindowZoomLevelToFactor = (level: number): number =>
  appWindowZoomFactorBase ** normalizeAppWindowZoomLevel(level)

export const appWindowZoomLevelToPercent = (level: number): number =>
  normalizeAppWindowZoomPercent(appWindowZoomPercentBase * appWindowZoomLevelToFactor(level))

export const appWindowZoomPercentToLevel = (percent: number): number =>
  normalizeAppWindowZoomLevel(
    Math.log(normalizeAppWindowZoomPercent(percent) / appWindowZoomPercentBase) /
      Math.log(appWindowZoomFactorBase)
  )

export type AppWindowZoomShortcutAction = 'in' | 'out' | 'reset'

export type AppWindowZoomShortcutInput = {
  alt?: boolean
  altKey?: boolean
  code?: string
  control?: boolean
  ctrlKey?: boolean
  isAutoRepeat?: boolean
  key?: string
  meta?: boolean
  metaKey?: boolean
  repeat?: boolean
  type?: string
}

export const getAppWindowZoomShortcutAction = (
  input: AppWindowZoomShortcutInput
): AppWindowZoomShortcutAction | null => {
  if (input.type && input.type !== 'keyDown' && input.type !== 'keydown') return null
  if (input.repeat || input.isAutoRepeat || input.alt || input.altKey) return null
  if (!input.control && !input.ctrlKey && !input.meta && !input.metaKey) return null

  const key = input.key?.toLocaleLowerCase()
  const code = input.code

  if (
    key === '+' ||
    key === '=' ||
    key === 'add' ||
    key === 'plus' ||
    code === 'Equal' ||
    code === 'NumpadAdd'
  ) {
    return 'in'
  }

  if (key === '0' || key === ')' || code === 'Digit0' || code === 'Numpad0') {
    return 'reset'
  }

  if (
    key === '-' ||
    key === '_' ||
    key === 'minus' ||
    key === 'subtract' ||
    key === '\u2212' ||
    key === '\u2013' ||
    code === 'Minus' ||
    code === 'NumpadSubtract'
  ) {
    return 'out'
  }

  return null
}

export type AppContainerTool = 'distrobox' | 'toolbox' | 'podman' | 'docker'

export type AppContainerTargetTool = AppContainerTool | 'ssh'

export type AppLocalContainerTarget =
  | {
      kind: 'host'
    }
  | {
      kind: 'container'
      tool: AppContainerTool
      name: string
    }

export type AppContainerTarget =
  | AppLocalContainerTarget
  | {
      kind: 'container'
      tool: 'ssh'
      name: string
      runtime?: AppLocalContainerTarget
    }

export type AppSshEnvironment = {
  id: string
  name: string
  host: string
  port: number
  user: string | null
  identityFile: string | null
  createdAt: number
  updatedAt: number
}

export type AppCreateSshEnvironmentOptions = {
  name: string
  host: string
  port: number
  user?: string | null
  identityFile?: string | null
}

export type AppUpdateSshEnvironmentOptions = AppCreateSshEnvironmentOptions & {
  id: string
}

export type AppDeleteSshEnvironmentOptions = {
  id: string
}

export type AppContainerSuggestion = {
  id: string
  tool: AppContainerTool
  name: string
  label: string
  description: string | null
  status: string | null
  current?: boolean
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

export type AppContainerOptions = {
  container?: AppContainerTarget | null
}

export type AppSourceAvailabilityOptions = AppContainerOptions

export type AppSourceAvailability = {
  gitAvailable: boolean
  providers: Array<{
    providerId: ProviderId
    available: boolean
  }>
}

export type AppGitChangesOptions = AppContainerOptions & {
  cwd?: string | null
  source: AppGitChangeSource
}

export type AppGitBranchesOptions = AppContainerOptions & {
  cwd?: string | null
}

export type AppGitSwitchBranchOptions = AppGitBranchesOptions & {
  branchName: string
  create?: boolean
}

export type AppGitDeleteBranchScope = 'local' | 'remote' | 'both'

export type AppGitDeleteBranchOptions = AppGitBranchesOptions & {
  branchName: string
  force?: boolean
  removeWorktree?: boolean
  scope?: AppGitDeleteBranchScope
}

export type AppGitCreateWorktreeOptions = AppContainerOptions & {
  cwd?: string | null
  name: string
}

export type AppGitBranchesResult = {
  repositoryRoot: string
  currentBranch: string | null
  branches: string[]
}

export type AppGitDeleteBranchResult = {
  branches: AppGitBranchesResult | null
  cancelled: boolean
  deleted: boolean
  error: string | null
  force: boolean
  forceSuggested: boolean
  scope: AppGitDeleteBranchScope | null
  worktreePath: string | null
}

export type AppGitCreateWorktreeResult = {
  repositoryRoot: string
  worktreePath: string
  branchName: string
  baseBranchName: string | null
}

export type AppFileTreeOptions = AppContainerOptions & {
  cwd?: string | null
}

export type AppGitChangesResult = {
  repositoryRoot: string
  branchName: string | null
  baseRef: string | null
  unpulledCount: number
  unpushedCount: number
  untrackedFilesHiddenForPerformance: boolean
  files: AppGitFileChange[]
}

export type AppFileTreeResult = {
  repositoryRoot: string
  branchName: string | null
  files: AppFileTreeFile[]
}

export type AppFileContentsOptions = AppContainerOptions & {
  cwd?: string | null
  path: string
}

export type AppFileContentsResult = {
  contents: string
  editable: boolean
  gitRepositoryRoot: string | null
  version: string
}

export type AppWriteFileContentsOptions = AppFileContentsOptions & {
  contents: string
  expectedVersion: string
}

export type AppWriteFileContentsResult = {
  version: string
}

export type AppGitCommitOptions = AppContainerOptions & {
  cwd?: string | null
  action?: AppGitCommitAction
  patches?: AppGitPatchChange[]
  message?: string | null
}

export type AppGitRecentCommitMessagesOptions = AppContainerOptions & {
  cwd?: string | null
  limit?: number | null
}

export type AppGitRecentCommitMessagesResult = {
  messages: string[]
}

export type AppGitDiffOptions = AppContainerOptions & {
  cwd?: string | null
}

export type AppGitDiffResult = {
  diff: string
}

export const appGitCommitMessageLargeChangeLineThreshold = 1_000
export const appGitCommitMessageMaxFiles = 100

export type AppGitCommitMessageFileChange = {
  path: string
  previousPath?: string | null
  additions: number | null
  deletions: number | null
}

export type AppGitCommitMessageContextResult = {
  diff: string | null
  fileCount: number
  files: AppGitCommitMessageFileChange[]
  totalChangedLines: number
}

export type AppGitFileDiffOptions = AppFileContentsOptions & {
  previousPath?: string | null
}

export type AppGitFileDiffResult = {
  diff: string
}

export type AppGitUncommittedPatchChangesOptions = AppContainerOptions & {
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

export type AppGitPushOptions = AppContainerOptions & {
  cwd?: string | null
  rememberTarget?: boolean
  target?: AppGitPushTarget
  setUpstream?: boolean
}

export type AppGitPullStrategy = 'ff-only' | 'rebase' | 'merge'
export type AppGitPushTarget = 'current-branch' | 'upstream-branch'

export type AppGitRecoveryActionId =
  | 'pull-rebase'
  | 'pull-merge'
  | 'pull-and-push'
  | 'set-upstream'
  | 'push-current-branch'
  | 'push-upstream-branch'

export type AppGitRecoveryAction = {
  id: AppGitRecoveryActionId
  label: string
  description: string
}

export type AppGitRecoverableFailure = {
  kind: 'pull-diverged' | 'push-rejected' | 'push-no-upstream' | 'push-upstream-mismatch'
  title: string
  message: string
  command: string
  error: string
  actions: AppGitRecoveryAction[]
}

export type AppGitPushResult = {
  pushed: boolean
  failure?: AppGitRecoverableFailure | null
}

export type AppGitPullOptions = AppContainerOptions & {
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
  getInstalledFontFamilies: () => Promise<string[]>
  getWindowState: () => Promise<AppWindowState>
  minimizeWindow: () => Promise<void>
  toggleWindowMaximized: () => Promise<AppWindowState>
  closeWindow: () => Promise<void>
  setWindowZoomLevel: (level: number) => Promise<void>
  handleExternalLink: (options: AppExternalLinkOptions) => Promise<AppExternalLinkResult | null>
  getDefaultCwd: () => Promise<string>
  getProjects: () => Promise<AppProject[]>
  addProject: (options: AppAddProjectOptions) => Promise<AppProject>
  setProjectOrder: (cwds: string[]) => Promise<AppProject[]>
  getSshEnvironments: () => Promise<AppSshEnvironment[]>
  createSshEnvironment: (options: AppCreateSshEnvironmentOptions) => Promise<AppSshEnvironment>
  updateSshEnvironment: (options: AppUpdateSshEnvironmentOptions) => Promise<AppSshEnvironment>
  deleteSshEnvironment: (options: AppDeleteSshEnvironmentOptions) => Promise<void>
  selectSshIdentityFile: () => Promise<string | null>
  getContainerSuggestions: (options?: AppContainerOptions) => Promise<AppContainerSuggestion[]>
  getSourceAvailability: (options?: AppSourceAvailabilityOptions) => Promise<AppSourceAvailability>
  getGitChanges: (options: AppGitChangesOptions) => Promise<AppGitChangesResult>
  getGitBranches: (options?: AppGitBranchesOptions) => Promise<AppGitBranchesResult>
  switchGitBranch: (options: AppGitSwitchBranchOptions) => Promise<AppGitBranchesResult>
  deleteGitBranch: (options: AppGitDeleteBranchOptions) => Promise<AppGitDeleteBranchResult>
  createGitWorktree: (options: AppGitCreateWorktreeOptions) => Promise<AppGitCreateWorktreeResult>
  getFileTree: (options?: AppFileTreeOptions) => Promise<AppFileTreeResult>
  getFileContents: (options: AppFileContentsOptions) => Promise<AppFileContentsResult>
  writeFileContents: (options: AppWriteFileContentsOptions) => Promise<AppWriteFileContentsResult>
  getRecentGitCommitMessages: (
    options?: AppGitRecentCommitMessagesOptions
  ) => Promise<AppGitRecentCommitMessagesResult>
  getUncommittedGitDiff: (options?: AppGitDiffOptions) => Promise<AppGitDiffResult>
  getGitCommitMessageContext: (
    options?: AppGitDiffOptions
  ) => Promise<AppGitCommitMessageContextResult>
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
  selectMessageAttachments: () => Promise<AppSelectedAttachment[]>
  getDroppedMessageAttachments: (files: File[]) => Promise<AppSelectedAttachment[]>
  readClipboardText: () => Promise<string>
  writeClipboardText: (text: string) => Promise<void>
  getClipboardImage: () => Promise<AppSelectedImage | null>
  getLocalImage: (options: AppLocalImageOptions) => Promise<AppLocalImage>
  copyLocalImage: (options: AppLocalImageOptions) => Promise<void>
  saveLocalImage: (options: AppLocalImageOptions) => Promise<string | null>
  onColorSchemeUpdated: (listener: (scheme: AppColorScheme) => void) => () => void
  onWindowStateUpdated: (listener: (state: AppWindowState) => void) => () => void
  onWindowZoomLevelUpdated: (listener: (level: number) => void) => () => void
}

export const appIpcChannels = {
  getColorScheme: 'app:get-color-scheme',
  getInstalledFontFamilies: 'app:get-installed-font-families',
  colorSchemeUpdated: 'app:color-scheme-updated',
  getWindowState: 'app:get-window-state',
  windowStateUpdated: 'app:window-state-updated',
  minimizeWindow: 'app:minimize-window',
  toggleWindowMaximized: 'app:toggle-window-maximized',
  closeWindow: 'app:close-window',
  setWindowZoomLevel: 'app:set-window-zoom-level',
  windowZoomLevelUpdated: 'app:window-zoom-level-updated',
  handleExternalLink: 'app:handle-external-link',
  getDefaultCwd: 'app:get-default-cwd',
  getProjects: 'app:get-projects',
  addProject: 'app:add-project',
  setProjectOrder: 'app:set-project-order',
  getSshEnvironments: 'app:get-ssh-environments',
  createSshEnvironment: 'app:create-ssh-environment',
  updateSshEnvironment: 'app:update-ssh-environment',
  deleteSshEnvironment: 'app:delete-ssh-environment',
  selectSshIdentityFile: 'app:select-ssh-identity-file',
  getContainerSuggestions: 'app:get-container-suggestions',
  getSourceAvailability: 'app:get-source-availability',
  getGitChanges: 'app:get-git-changes',
  getGitBranches: 'app:get-git-branches',
  switchGitBranch: 'app:switch-git-branch',
  deleteGitBranch: 'app:delete-git-branch',
  createGitWorktree: 'app:create-git-worktree',
  getFileTree: 'app:get-file-tree',
  getFileContents: 'app:get-file-contents',
  writeFileContents: 'app:write-file-contents',
  getRecentGitCommitMessages: 'app:get-recent-git-commit-messages',
  getUncommittedGitDiff: 'app:get-uncommitted-git-diff',
  getGitCommitMessageContext: 'app:get-git-commit-message-context',
  getGitFileDiff: 'app:get-git-file-diff',
  getUncommittedGitPatchChanges: 'app:get-uncommitted-git-patch-changes',
  commitGitChanges: 'app:commit-git-changes',
  pullGitChanges: 'app:pull-git-changes',
  pushGitChanges: 'app:push-git-changes',
  selectFolder: 'app:select-folder',
  getProjectIcon: 'app:get-project-icon',
  selectProjectIcon: 'app:select-project-icon',
  selectMessageAttachments: 'app:select-message-attachments',
  getDroppedMessageAttachments: 'app:get-dropped-message-attachments',
  readClipboardText: 'app:read-clipboard-text',
  writeClipboardText: 'app:write-clipboard-text',
  getClipboardImage: 'app:get-clipboard-image',
  getLocalImage: 'app:get-local-image',
  copyLocalImage: 'app:copy-local-image',
  saveLocalImage: 'app:save-local-image'
} as const
