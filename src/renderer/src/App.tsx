import {
  type CSSProperties,
  Fragment,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { flushSync } from 'react-dom'
import {
  Apple,
  AppWindow,
  ArrowLeft,
  BadgeCheck,
  BellOff,
  Bot,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  Container,
  Download,
  EyeOff,
  FileLock,
  Files,
  FolderKanban,
  FolderPen,
  FolderPlus,
  FolderTree,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  Link2,
  LayoutList,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  PackagePlus,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Settings,
  MessageSquare,
  ShieldQuestionMark,
  Sparkles,
  SquarePen,
  Sun,
  Terminal,
  ToolCase,
  Undo2,
  Upload,
  UnlockKeyhole,
  X,
  Zap
} from 'lucide-react'
import {
  DownloadIcon as AnimatedDownloadIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  GitCommitHorizontalIcon as AnimatedGitCommitHorizontalIcon,
  MessageSquareMoreIcon as AnimatedMessageSquareMoreIcon,
  UploadIcon as AnimatedUploadIcon
} from 'lucide-animated'
import {
  FileIcon as SymbolsFileIcon,
  FolderIcon as SymbolsFolderIcon
} from '@react-symbols/icons/utils'
import type {
  AppContainerSuggestion,
  AppContainerTarget,
  AppContainerTool,
  AppLocalContainerTarget,
  AppCreateSshEnvironmentOptions,
  AppProject,
  AppSelectedAttachment,
  AppSshEnvironment,
  AppSourceAvailability,
  AppFileTreeResult,
  AppGitBranchesResult,
  AppGitChangeKind,
  AppGitChangesResult,
  AppGitCommitAction,
  AppGitDeleteBranchScope,
  AppGitPatchChange,
  AppProjectIcon,
  AppGitPullStrategy,
  AppGitRecoverableFailure,
  AppGitRecoveryActionId,
  AppWindowState
} from '../../shared/app'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatDetailUpdate,
  ProviderChatItemUpdate,
  ProviderChatUpdateSummary,
  ProviderFileDiff,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool,
  ProviderChatItem,
  ProviderChatMetadata,
  ProviderCwdNote,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderActiveSendMode,
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderApprovalPolicy,
  ProviderApprovalsReviewer,
  ProviderApprovalDecision,
  ProviderId,
  ProviderModel,
  ProviderModelId,
  ProviderToolActivity,
  ProviderToolIcon,
  ProviderAccountUsage,
  ProviderReasoningEffort,
  ProviderServiceTier,
  ProviderReview,
  ProviderReviewComment,
  ProviderSandboxMode,
  ProviderSandboxModeOption,
  ProviderAppInput,
  ProviderSkillInput,
  ProviderTurnOptions,
  ProviderUsageOptions,
  ProviderUpdateAvailability
} from '../../shared/provider'
import {
  getProviderChatTurns,
  unloadChatItemsOutsideTurnRange,
  type ProviderChatTurn
} from '../../shared/chatTurns'
import {
  fallbackCopilotModels,
  fallbackProviderApprovalModes,
  fallbackProviderModels,
  fallbackProviderSandboxModes,
  isProviderId,
  isProviderApprovalMode,
  isProviderApprovalPolicy,
  isProviderApprovalsReviewer,
  isProviderSandboxMode,
  isProviderServiceTier,
  providerOneShotGenerationCanceledMessage,
  providerIds
} from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { buildChatConversationModel, markChatItemsChanged } from './chatConversationModel'
import { ChatListGroup, type ChatListGroupData } from './components/ChatListGroup'
import { BranchSwitcher } from './components/BranchSwitcher'
import { Button, type ButtonDropdownAction } from './components/Button'
import { ChatPlan, type ChatPlanData, type ChatPlanItem } from './components/ChatPlan'
import { Dropdown, type DropdownOption } from './components/Dropdown'
import { FileEditorDialog, type FileEditorTarget } from './components/FileEditorDialog'
import { getReasoningEffortPresentation } from './reasoningEffortPresentation'
import { Input } from './components/Input'
import { MessageBox, type MessageBoxQuoteRequest } from './components/MessageBox'
import { MessageSelectionQuoteButton } from './components/MessageSelectionQuoteButton'
import { SegmentedControl } from './components/SegmentedControl'
import { Switch } from './components/Switch'
import { SshEnvironmentDialog } from './components/SshEnvironmentDialog'
import { TerminalPanel, type TerminalCommandLaunchRequest } from './components/TerminalPanel'
import { UserInputRequestBox } from './components/UserInputRequestBox'
import type { AppAction } from './actions'
import { getAppActionsForProject, getAppActionKeybindingFromEvent } from './actions'
import { appApi } from './appApi'
import { mergeChatMetadata } from './chatMetadata'
import { applyFontAppearancePreferences } from './fontAppearance'
import { providerApi } from './providerApi'
import { terminalApi } from './terminalApi'
import {
  type AppAppearancePositionPreference,
  type AppAppearanceControlStylePreference,
  type AppAppearanceStylePreference,
  type AppFontSetting,
  type AppGitCommitMessageGenerationSettings,
  type AppGitCommitPromptSettings,
  type AppGitWorktreeSettings,
  type AppChatDropdownSettings,
  type AppChatUsageDisplay,
  type AppExternalLinkBehavior,
  type AppProjectSettingsByCwd,
  type AppProjectSettingsOverrides,
  type AppSettings,
  type AppThemePreference,
  appAppearanceZoomLevelMax,
  appAppearanceZoomLevelMin,
  appMaxChatsRenderedMax,
  appMaxChatsRenderedMin,
  appFontInheritValue,
  appFontMonospaceValue,
  appFontSizeMax,
  appFontSizeMin,
  appFontSystemValue,
  appChatManualDropdownValue,
  appChatStandardSpeedValue,
  isAppProjectSettingsOverridesEmpty,
  normalizeAppProjectSettingsCwd,
  normalizeAppAppearanceZoomLevel,
  normalizeAppFontSize,
  normalizeAppMaxChatsRendered,
  readStoredAppProjectSettings,
  readStoredAppSettings,
  resolveAppSettings,
  writeStoredAppProjectSettings,
  writeStoredAppSettings
} from './settings'
import { setThemePreference } from './systemColorScheme'
import {
  clearChatSearchHighlights,
  findChatSearchMatches,
  scrollChatSearchMatchIntoView,
  setChatSearchHighlights
} from './chatSearch'
import { getLatestChatTurnWindow, shiftChatTurnWindow, type ChatTurnWindow } from './chatTurnWindow'
import './App.css'

type LoadState = 'loading' | 'ready' | 'error'
type SendState = 'idle' | 'sending' | 'error'
type NewSessionLocation = 'folder' | 'worktree'
type WorktreeCreationState = 'idle' | 'creating' | 'canceling'
type ApplyChatDetailOptions = {
  select?: boolean
}
type ChatScrollAnchor = {
  chatKey: string
  offset: number
  turnId: string
}
type ChatTurnPageLoadDirection = 'older' | 'newer' | 'latest'
type CommittedChatUpdate = {
  sequence: number
  detailApplied: boolean
  turnCompleted: boolean
}
type EditingMessage =
  | (Pick<ProviderMessage, 'id' | 'content'> & { type: 'message' })
  | (Pick<ProviderPendingMessage, 'id' | 'content' | 'kind'> & { type: 'pending' })
type ApprovalResolutionState = {
  approvalId: string | null
  decision: ProviderApprovalDecision | null
  error: string | null
}
type UserInputResolutionState = {
  requestId: string | null
  resolving: boolean
  error: string | null
}
type ProviderUpdateState = 'idle' | 'updating'
type UsageLoadState = 'idle' | 'loading' | 'ready' | 'error'
type ProviderUpdateSuggestion = ProviderUpdateAvailability & {
  providerId: ProviderId
}
type ProviderUpdatePreference = {
  neverSuggest: boolean
  ignoredVersions: string[]
}
type ProviderUpdatePreferences = Partial<Record<ProviderId, ProviderUpdatePreference>>
type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}
type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number
    animateOnHover?: boolean
  } & RefAttributes<AnimatedIconHandle>
>
type ChangeSource = 'chat' | 'lastTurn' | 'uncommitted'
type PatchChangeSource = Extract<ChangeSource, 'chat' | 'lastTurn'>
type GitChangeSource = Exclude<ChangeSource, 'chat' | 'lastTurn'>
type ChangesPaneView = 'git' | 'files' | 'terminal'
type GitCommitPromptAction = AppGitCommitAction
type GitSyncAction = 'pull' | 'push' | 'pullAndPush'
type GitSyncStep = Exclude<GitSyncAction, 'pullAndPush'>
type GitSyncRecoveryState = {
  cwd: string
  requestedAction: GitSyncAction
  failedAction: GitSyncStep
  failure: AppGitRecoverableFailure
  error: string | null
}
type CommitActivityAction = {
  label: string
  activity: ProviderToolActivity
  icon?: ProviderToolIcon | null
}
type ScopedCommitActivity = {
  source: 'ai'
  providerId: ProviderId
  chatId: string
  sourceChatId: string | null
  markerId: string
  projectCwd: string | null
  commitAction: GitCommitPromptAction
  currentAction: CommitActivityAction
  startedAt: number
}
type StartingScopedCommitActivity = {
  providerId: ProviderId
  sourceChatId: string
  markerId: string
  commitAction: GitCommitPromptAction
}
type ChatCommitMarkerStatus = 'pending' | 'finished' | 'stopped' | 'failed'
type ChatCommitMarker = {
  id: string
  providerId: ProviderId
  sourceChatId: string
  commitChatId: string | null
  commitAction: GitCommitPromptAction
  status: ChatCommitMarkerStatus
  afterItemId: string | null
  startedAt: number
  finishedAt: number | null
}
type DirectCommitActivity = {
  source: 'git'
  id: string
  projectCwd: string | null
  commitAction: GitCommitPromptAction
  currentAction: CommitActivityAction
  startedAt: number
}
type GitSyncRecoveryActionOptions = {
  rememberStrategy?: boolean
}
type SettingsTab = 'appearance' | 'chat' | 'links' | 'performance' | 'git'
type SettingsScope = 'global' | 'project'
type CachedPatchChangedFiles = {
  containerKey: string
  cwd: string
  source: PatchChangeSource
  files: ChangedFile[]
}
type FileTreeScope = {
  containerKey: string
  cwd: string
}
type GitBranchesScope = {
  sourceKey: string
  cwd: string
}
type GitBranchDeleteRetry = {
  branchName: string
  scope: AppGitDeleteBranchScope
}
type GitBranchWorktreeDeleteRetry = GitBranchDeleteRetry & {
  force: boolean
  worktreePath: string
}
type ChangedFile = {
  path: string
  previousPath?: string | null
  displayPath?: string
  displayPreviousPath?: string | null
  kind: AppGitChangeKind
  status?: string
  diff?: string
  patches?: AppGitPatchChange[]
}
type RepositoryFile = {
  path: string
  previousPath?: string | null
  displayPath?: string
  displayPreviousPath?: string | null
  kind?: AppGitChangeKind | null
  status?: string | null
}
type TreeFile = ChangedFile | RepositoryFile
type DisplayTreeFile<TFile extends TreeFile> = TFile & {
  displayPath: string
  displayPreviousPath: string | null
}
type ChangeTreeFileNode<TFile extends TreeFile = TreeFile> = {
  type: 'file'
  name: string
  file: TFile
}
type ChangeTreeFolderNode<TFile extends TreeFile = TreeFile> = {
  type: 'folder'
  name: string
  path: string
  children: ChangeTreeNode<TFile>[]
  childrenPrecomputed: boolean
}
type ChangeTreeNode<TFile extends TreeFile = TreeFile> =
  ChangeTreeFolderNode<TFile> | ChangeTreeFileNode<TFile>
type MutableChangeTreeFolder<TFile extends TreeFile = TreeFile> = {
  name: string
  path: string
  folders: Map<string, MutableChangeTreeFolder<TFile>>
  files: ChangeTreeFileNode<TFile>[]
  childrenPrecomputed: boolean
}
type ChatPaneWidths = {
  sidebar: number
  changes: number
}
type ChatPanePercents = {
  sidebar: number
  changes: number
}
type LegacyProviderAccessMode = 'sandbox' | 'auto' | 'full'
type MessageBoxSelection = {
  approvalMode: ProviderApprovalMode
  model: ProviderModelId
  reasoningEffort: ProviderReasoningEffort
  sandboxMode: ProviderSandboxMode
  serviceTier: ProviderServiceTier | null
}
type StoredMessageBoxSelection = Partial<MessageBoxSelection>
type StoredMessageBoxSelections = Partial<Record<ProviderId, StoredMessageBoxSelection>>
type ChatBooleanSettingKey = {
  [Key in keyof AppSettings['chat']]: AppSettings['chat'][Key] extends boolean ? Key : never
}[keyof AppSettings['chat']]
type ChatBooleanSettingField = {
  key: ChatBooleanSettingKey
  label: string
  description?: string
  id: string
}
type AppearanceFontKey = 'applicationFont' | 'chatFont' | 'codeFont'
type AppProjectSettingPath =
  | { section: 'appearance'; key: keyof AppSettings['appearance'] }
  | { section: 'chat'; key: keyof AppSettings['chat'] }
  | { section: 'links'; key: keyof AppSettings['links'] }
  | { section: 'performance'; key: keyof AppSettings['performance'] }
  | { section: 'git'; key: 'commitModel' }
  | { section: 'gitCommitPrompt'; key: keyof AppGitCommitPromptSettings }
  | {
      section: 'gitCommitMessageGeneration'
      key: keyof AppGitCommitMessageGenerationSettings
    }
  | { section: 'gitWorktree'; key: keyof AppGitWorktreeSettings }

const hasSettingKey = (value: object | null | undefined, key: PropertyKey): boolean =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key))

const getProjectSettingPathId = (path: AppProjectSettingPath): string =>
  `settings-project-action-${path.section}-${path.key}`

const cleanProjectSettingsOverrides = (
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsOverrides => {
  const nextOverrides: AppProjectSettingsOverrides = { ...overrides }

  if (nextOverrides.appearance && Object.keys(nextOverrides.appearance).length === 0) {
    delete nextOverrides.appearance
  }
  if (nextOverrides.chat && Object.keys(nextOverrides.chat).length === 0) {
    delete nextOverrides.chat
  }
  if (nextOverrides.links && Object.keys(nextOverrides.links).length === 0) {
    delete nextOverrides.links
  }
  if (nextOverrides.performance && Object.keys(nextOverrides.performance).length === 0) {
    delete nextOverrides.performance
  }

  if (nextOverrides.git) {
    const gitOverrides = { ...nextOverrides.git }
    if (gitOverrides.commitPrompt && Object.keys(gitOverrides.commitPrompt).length === 0) {
      delete gitOverrides.commitPrompt
    }
    if (
      gitOverrides.commitMessageGeneration &&
      Object.keys(gitOverrides.commitMessageGeneration).length === 0
    ) {
      delete gitOverrides.commitMessageGeneration
    }
    if (gitOverrides.worktree && Object.keys(gitOverrides.worktree).length === 0) {
      delete gitOverrides.worktree
    }

    if (Object.keys(gitOverrides).length === 0) {
      delete nextOverrides.git
    } else {
      nextOverrides.git = gitOverrides
    }
  }

  return nextOverrides
}

const getAppProjectSettingValue = (settings: AppSettings, path: AppProjectSettingPath): unknown => {
  switch (path.section) {
    case 'appearance':
      return settings.appearance[path.key]
    case 'chat':
      return settings.chat[path.key]
    case 'links':
      return settings.links[path.key]
    case 'performance':
      return settings.performance[path.key]
    case 'git':
      return settings.git.commitModel
    case 'gitCommitPrompt':
      return settings.git.commitPrompt[path.key]
    case 'gitCommitMessageGeneration':
      return settings.git.commitMessageGeneration[path.key]
    case 'gitWorktree':
      return settings.git.worktree[path.key]
  }
}

const isAppProjectSettingOverridden = (
  overrides: AppProjectSettingsOverrides | null | undefined,
  path: AppProjectSettingPath
): boolean => {
  switch (path.section) {
    case 'appearance':
      return hasSettingKey(overrides?.appearance, path.key)
    case 'chat':
      return hasSettingKey(overrides?.chat, path.key)
    case 'links':
      return hasSettingKey(overrides?.links, path.key)
    case 'performance':
      return hasSettingKey(overrides?.performance, path.key)
    case 'git':
      return hasSettingKey(overrides?.git, 'commitModel')
    case 'gitCommitPrompt':
      return hasSettingKey(overrides?.git?.commitPrompt, path.key)
    case 'gitCommitMessageGeneration':
      return hasSettingKey(overrides?.git?.commitMessageGeneration, path.key)
    case 'gitWorktree':
      return hasSettingKey(overrides?.git?.worktree, path.key)
  }
}

const setAppProjectSettingOverrideValue = (
  overrides: AppProjectSettingsOverrides,
  path: AppProjectSettingPath,
  value: unknown
): AppProjectSettingsOverrides => {
  switch (path.section) {
    case 'appearance':
      return cleanProjectSettingsOverrides({
        ...overrides,
        appearance: {
          ...overrides.appearance,
          [path.key]: value
        } as Partial<AppSettings['appearance']>
      })
    case 'chat':
      return cleanProjectSettingsOverrides({
        ...overrides,
        chat: {
          ...overrides.chat,
          [path.key]: value
        } as Partial<AppSettings['chat']>
      })
    case 'links':
      return cleanProjectSettingsOverrides({
        ...overrides,
        links: {
          ...overrides.links,
          [path.key]: value
        } as Partial<AppSettings['links']>
      })
    case 'performance':
      return cleanProjectSettingsOverrides({
        ...overrides,
        performance: {
          ...overrides.performance,
          [path.key]: value
        } as Partial<AppSettings['performance']>
      })
    case 'git':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          commitModel: value as ProviderModelId | null
        }
      })
    case 'gitCommitPrompt':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          commitPrompt: {
            ...overrides.git?.commitPrompt,
            [path.key]: value
          } as Partial<AppGitCommitPromptSettings>
        }
      })
    case 'gitCommitMessageGeneration':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          commitMessageGeneration: {
            ...overrides.git?.commitMessageGeneration,
            [path.key]: value
          } as Partial<AppGitCommitMessageGenerationSettings>
        }
      })
    case 'gitWorktree':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          worktree: {
            ...overrides.git?.worktree,
            [path.key]: value
          } as Partial<AppGitWorktreeSettings>
        }
      })
  }
}

const clearAppProjectSettingOverrideValue = (
  overrides: AppProjectSettingsOverrides,
  path: AppProjectSettingPath
): AppProjectSettingsOverrides => {
  switch (path.section) {
    case 'appearance': {
      const appearance = { ...(overrides.appearance ?? {}) }
      delete appearance[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, appearance })
    }
    case 'chat': {
      const chat = { ...(overrides.chat ?? {}) }
      delete chat[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, chat })
    }
    case 'links': {
      const links = { ...(overrides.links ?? {}) }
      delete links[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, links })
    }
    case 'performance': {
      const performance = { ...(overrides.performance ?? {}) }
      delete performance[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, performance })
    }
    case 'git': {
      const git = { ...(overrides.git ?? {}) }
      delete git.commitModel
      return cleanProjectSettingsOverrides({ ...overrides, git })
    }
    case 'gitCommitPrompt': {
      const commitPrompt = { ...(overrides.git?.commitPrompt ?? {}) }
      delete commitPrompt[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), commitPrompt }
      })
    }
    case 'gitCommitMessageGeneration': {
      const commitMessageGeneration = { ...(overrides.git?.commitMessageGeneration ?? {}) }
      delete commitMessageGeneration[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), commitMessageGeneration }
      })
    }
    case 'gitWorktree': {
      const worktree = { ...(overrides.git?.worktree ?? {}) }
      delete worktree[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), worktree }
      })
    }
  }
}

const setAppProjectSettingsForCwd = (
  projectSettings: AppProjectSettingsByCwd,
  cwd: string,
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsByCwd => {
  const normalizedCwd = normalizeAppProjectSettingsCwd(cwd)
  if (!normalizedCwd) return projectSettings

  const nextProjectSettings = { ...projectSettings }
  if (isAppProjectSettingsOverridesEmpty(overrides)) {
    delete nextProjectSettings[normalizedCwd]
  } else {
    nextProjectSettings[normalizedCwd] = cleanProjectSettingsOverrides(overrides)
  }

  return nextProjectSettings
}

const chatPromptBoxSettingFields = [
  {
    key: 'hidePlans',
    label: 'Hide plans in chats',
    description: 'Hide the expandable plan panel above the message box.',
    id: 'settings-chat-hide-plans'
  },
  {
    key: 'enableNotesButton',
    label: 'Enable notes button',
    description: 'Show workspace notes beside the prompt controls.',
    id: 'settings-chat-enable-notes'
  },
  {
    key: 'enableActions',
    label: 'Enable actions',
    description: 'Show saved workspace actions beside the prompt controls.',
    id: 'settings-chat-enable-actions'
  }
] satisfies ChatBooleanSettingField[]
const chatDropdownSettingFields = [
  { key: 'updateExistingChats', label: 'Update all existing chats', id: 'settings-chat-existing' },
  { key: 'updateNewChats', label: 'Update all new chats', id: 'settings-chat-new' }
] satisfies ChatBooleanSettingField[]
const chatThoughtSettingFields = [
  {
    key: 'expandThoughtsOnStart',
    label: 'Expand thoughts on start',
    id: 'settings-chat-thought-expand-start'
  },
  {
    key: 'collapseThoughtsOnFinish',
    label: 'Collapse thoughts on finish',
    id: 'settings-chat-thought-collapse-finish'
  },
  {
    key: 'collapseThoughtsOnNextTurn',
    label: 'Collapse thoughts on next turn',
    id: 'settings-chat-thought-collapse-next-turn'
  },
  {
    key: 'expandStoppedTurns',
    label: 'Expand stopped turns',
    id: 'settings-chat-thought-expand-stopped'
  },
  {
    key: 'collapseStoppedOnNextTurn',
    label: 'Collapse stopped on next turn',
    id: 'settings-chat-thought-collapse-stopped-next-turn'
  }
] satisfies ChatBooleanSettingField[]
type RecentChatCacheEntry = {
  detail: ProviderChatDetail
  updatedAt: number
}
type ContinuedStoppedWorkingStepsByChat = Record<string, string[]>
type ChatResizeEdge = 'left' | 'right'
type GitChangesScope = {
  sourceKey: string
  cwd: string
  source: GitChangeSource
}
type PatchFilterScope = {
  containerKey: string
  cwd: string
  source: PatchChangeSource
  signature: string
}
type SourceAvailabilityState = {
  containerKey: string
  availability: AppSourceAvailability
}
type UncommittedPatchFilter = {
  scope: PatchFilterScope
  patches: AppGitPatchChange[]
}

const chatListFetchPageSize = 100
const chatTurnPageSize = 10
const chatTurnWindowSize = chatTurnPageSize * 2
const chatTurnLoadThresholdPx = 80
const streamingChatUpdateIntervalMs = 50
const chatSidebarDefaultWidth = 280
const changesSidebarDefaultWidth = 240
const chatSidebarMinWidth = 220
const changesSidebarMinWidth = 220
const chatBlockMinWidth = 320
const chatResizeHandleWidth = 9
const chatResizeHandleCount = 2
const chatPaneDefaultReferenceWidth = 1200
const chatPanePreferenceStorageKey = 'sele:chat-pane-preference:v1'
const legacyMessageBoxSelectionStorageKey = 'sele:message-box-selection:v1'
const messageBoxSelectionsStorageKey = 'sele:message-box-selections:v2'
const providerUpdatePreferenceStorageKey = 'sele:provider-update-preferences:v1'
const legacyContainerSelectionStorageKeys = [
  'sele:container-selection:v3',
  'sele:container-selection:v2',
  'sele:container-selection:v1'
]
const containerSelectionStorageKey = 'sele:container-selection:v4'
const scopedCommitActivitiesStorageKey = 'sele:scoped-commit-activities:v1'
const chatCommitMarkersStorageKey = 'sele:chat-commit-markers:v1'
const continuedStoppedWorkingStepsStorageKey = 'sele:continued-stopped-working-steps:v1'
const chatGroupingPreferenceStorageKey = 'sele:chat-grouping-preference:v1'
const gitCurrentChatModelValue = '__sele_current_chat_model__'
const pinnedGroupKey = 'pinned'
const activeGroupKey = 'active'
const unknownCwdGroupKey = 'cwd:unknown'
const doneGroupKey = 'done'
const newSessionProjectPlaceholderValue = '__sele_new_session_project_placeholder__'
const hostContainerValue = 'host'
const fallbackDefaultModel = fallbackProviderModels.find((model) => model.isDefault)
const fallbackInitialModel = fallbackDefaultModel ?? fallbackProviderModels[0]!
const fallbackInitialReasoningEffort = fallbackInitialModel?.defaultReasoningEffort ?? 'medium'
const fallbackDefaultApprovalMode =
  fallbackProviderApprovalModes.find((mode) => mode.isDefault)?.id ??
  fallbackProviderApprovalModes[0]?.id ??
  'ask-user'
const fallbackDefaultSandboxMode =
  fallbackProviderSandboxModes.find((mode) => mode.isDefault)?.id ??
  fallbackProviderSandboxModes[0]?.id ??
  'workspace-write'

const mergeLoadedChatTurnItems = (
  detail: ProviderChatDetail,
  loadedItems: ProviderChatItem[]
): ProviderChatDetail => {
  const loadedItemsById = new Map(loadedItems.map((item) => [item.id, item]))
  let changed = false
  const items = detail.items.map((item) => {
    const loadedItem = loadedItemsById.get(item.id)
    if (
      !loadedItem ||
      loadedItem.type !== item.type ||
      (loadedItem.type !== 'message' && loadedItem.type !== 'pendingMessage')
    ) {
      return item
    }

    changed = true
    return { ...loadedItem, contentLoaded: true }
  })

  return changed ? { ...detail, items } : detail
}
const refreshIconReplayMs = 1_050

type ChatGroupingPreference = 'grouped' | 'ungrouped'

const readChatGroupingPreference = (): ChatGroupingPreference => {
  try {
    return window.localStorage.getItem(chatGroupingPreferenceStorageKey) === 'ungrouped'
      ? 'ungrouped'
      : 'grouped'
  } catch {
    return 'grouped'
  }
}

const writeChatGroupingPreference = (preference: ChatGroupingPreference): void => {
  try {
    window.localStorage.setItem(chatGroupingPreferenceStorageKey, preference)
  } catch {
    // Sidebar grouping is non-critical; ignore unavailable storage.
  }
}

const providerLabels = {
  codex: 'Codex',
  copilot: 'Copilot'
} satisfies Record<ProviderId, string>

const getFallbackModels = (providerId: ProviderId): ProviderModel[] =>
  providerId === 'copilot' ? fallbackCopilotModels : fallbackProviderModels

const getProviderUpdatePreference = (
  preferences: ProviderUpdatePreferences,
  providerId: ProviderId
): ProviderUpdatePreference => ({
  neverSuggest: Boolean(preferences[providerId]?.neverSuggest),
  ignoredVersions: preferences[providerId]?.ignoredVersions ?? []
})

const shouldSuggestProviderUpdate = (
  preferences: ProviderUpdatePreferences,
  providerId: ProviderId,
  availability: ProviderUpdateAvailability
): boolean => {
  const preference = getProviderUpdatePreference(preferences, providerId)
  return (
    !preference.neverSuggest && !preference.ignoredVersions.includes(availability.latestVersion)
  )
}

const isProviderUpdatePreference = (value: unknown): value is ProviderUpdatePreference => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false

  const preference = value as Partial<ProviderUpdatePreference>
  return (
    typeof preference.neverSuggest === 'boolean' &&
    Array.isArray(preference.ignoredVersions) &&
    preference.ignoredVersions.every((version) => typeof version === 'string')
  )
}

const readStoredProviderUpdatePreferences = (): ProviderUpdatePreferences => {
  try {
    const storedValue = window.localStorage.getItem(providerUpdatePreferenceStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const preferences: ProviderUpdatePreferences = {}
    for (const providerId of Object.keys(providerLabels) as ProviderId[]) {
      const preference = parsedValue[providerId]
      if (isProviderUpdatePreference(preference)) preferences[providerId] = preference
    }

    return preferences
  } catch {
    return {}
  }
}

const writeStoredProviderUpdatePreferences = (preferences: ProviderUpdatePreferences): void => {
  try {
    window.localStorage.setItem(providerUpdatePreferenceStorageKey, JSON.stringify(preferences))
  } catch {
    // Update suggestion preferences are non-critical; ignore unavailable storage.
  }
}

const isContainerTool = (value: unknown): value is AppContainerTool | 'ssh' =>
  value === 'distrobox' ||
  value === 'toolbox' ||
  value === 'podman' ||
  value === 'docker' ||
  value === 'ssh'

const normalizeContainerTarget = (
  container: AppContainerTarget | null | undefined
): AppContainerTarget => {
  if (!container || container.kind === 'host') return { kind: 'host' }
  if (container.tool === 'ssh') {
    return {
      kind: 'container',
      tool: 'ssh',
      name: container.name,
      runtime:
        container.runtime?.kind === 'container'
          ? {
              kind: 'container',
              tool: container.runtime.tool,
              name: container.runtime.name
            }
          : { kind: 'host' }
    }
  }
  return { kind: 'container', tool: container.tool, name: container.name }
}

const getContainerTargetKey = (container: AppContainerTarget | null | undefined): string => {
  const normalizedContainer = normalizeContainerTarget(container)
  if (normalizedContainer.kind === 'host') return hostContainerValue
  if (normalizedContainer.tool !== 'ssh') {
    return `${normalizedContainer.tool}:${normalizedContainer.name}`
  }

  const runtime = normalizedContainer.runtime ?? { kind: 'host' }
  const runtimeKey =
    runtime.kind === 'container' ? `${runtime.tool}:${runtime.name}` : hostContainerValue
  return `ssh:${normalizedContainer.name}/from:${runtimeKey}`
}

const getContainerSelectionValue = (container: AppContainerTarget): string =>
  container.kind === 'container' && container.tool === 'ssh'
    ? `ssh:${container.name}`
    : getContainerTargetKey(container)

const getContainerTargetFromSuggestion = (
  suggestion: AppContainerSuggestion
): AppLocalContainerTarget => ({
  kind: 'container',
  tool: suggestion.tool,
  name: suggestion.name
})

const getContainerToolIcon = (tool: AppContainerTool): React.ReactNode => {
  if (tool === 'distrobox') return <Box aria-hidden="true" />
  if (tool === 'toolbox') return <ToolCase aria-hidden="true" />
  if (tool === 'podman') return <Boxes aria-hidden="true" />

  return <Container aria-hidden="true" />
}

const getContainerSuggestionState = (suggestion: AppContainerSuggestion): string =>
  suggestion.status?.trim() || (suggestion.current ? 'Running' : 'Unknown')

const isContainerTargetAvailable = (
  container: AppContainerTarget,
  suggestions: AppContainerSuggestion[],
  sshEnvironments: AppSshEnvironment[]
): boolean =>
  container.kind === 'host' ||
  (container.tool === 'ssh'
    ? sshEnvironments.some((environment) => environment.id === container.name)
    : suggestions.some(
        (suggestion) => suggestion.tool === container.tool && suggestion.name === container.name
      ))

const parseStoredContainerSelection = (
  storedValue: string | null,
  options: { allowHost: boolean }
): AppContainerTarget | null => {
  if (!storedValue) return null

  try {
    const parsedValue = JSON.parse(storedValue) as
      (Partial<AppContainerTarget> & { runtime?: unknown }) | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return null
    }
    if (parsedValue.kind === 'host') return options.allowHost ? { kind: 'host' } : null
    if (
      parsedValue.kind === 'container' &&
      isContainerTool(parsedValue.tool) &&
      typeof parsedValue.name === 'string' &&
      parsedValue.name.trim()
    ) {
      if (parsedValue.tool === 'ssh') {
        const runtime = parsedValue.runtime
        const normalizedRuntime: AppLocalContainerTarget =
          runtime &&
          typeof runtime === 'object' &&
          !Array.isArray(runtime) &&
          (runtime as { kind?: unknown }).kind === 'container' &&
          isContainerTool((runtime as { tool?: unknown }).tool) &&
          (runtime as { tool?: unknown }).tool !== 'ssh' &&
          typeof (runtime as { name?: unknown }).name === 'string' &&
          (runtime as { name: string }).name.trim()
            ? {
                kind: 'container',
                tool: (runtime as { tool: AppContainerTool }).tool,
                name: (runtime as { name: string }).name.trim()
              }
            : { kind: 'host' }

        return {
          kind: 'container',
          tool: 'ssh',
          name: parsedValue.name.trim(),
          runtime: normalizedRuntime
        }
      }

      return {
        kind: 'container',
        tool: parsedValue.tool,
        name: parsedValue.name.trim()
      }
    }
  } catch {
    return null
  }

  return null
}

const readStoredContainerSelection = (): AppContainerTarget | null => {
  try {
    const storedSelection = parseStoredContainerSelection(
      window.localStorage.getItem(containerSelectionStorageKey),
      { allowHost: true }
    )
    if (storedSelection) return storedSelection

    for (const legacyStorageKey of legacyContainerSelectionStorageKeys) {
      const legacySelection = parseStoredContainerSelection(
        window.localStorage.getItem(legacyStorageKey),
        { allowHost: legacyStorageKey === 'sele:container-selection:v3' }
      )
      if (legacySelection) return legacySelection
    }

    return null
  } catch {
    return null
  }
}

const writeStoredContainerSelection = (container: AppContainerTarget): void => {
  try {
    window.localStorage.setItem(
      containerSelectionStorageKey,
      JSON.stringify(normalizeContainerTarget(container))
    )
  } catch {
    // Container selection is a convenience preference; ignore unavailable storage.
  }
}

const changeSourceLabels = {
  uncommitted: 'Uncommitted',
  lastTurn: 'Last turn',
  chat: 'Chat'
} satisfies Record<ChangeSource, string>

const getFixedChangeSource = (): ChangeSource => 'uncommitted'

const commitActionLabels = {
  commit: 'Commit',
  amend: 'Amend'
} satisfies Record<GitCommitPromptAction, string>

const providerToolActivities = new Set<ProviderToolActivity>([
  'read',
  'search',
  'git',
  'edit',
  'create',
  'delete',
  'npm',
  'npx',
  'script',
  'command',
  'other'
])
const providerToolIcons = new Set<ProviderToolIcon>([
  'image-view',
  'image-generation',
  'openai-docs',
  'plan',
  'question'
])
const chatCommitMarkerStatuses = new Set<ChatCommitMarkerStatus>([
  'pending',
  'finished',
  'stopped',
  'failed'
])

const readStoredScopedCommitActivities = (): Record<string, ScopedCommitActivity> => {
  try {
    const storedValue = window.localStorage.getItem(scopedCommitActivitiesStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const activities: Record<string, ScopedCommitActivity> = {}
    Object.values(parsedValue as Record<string, unknown>).forEach((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return

      const candidate = value as Partial<ScopedCommitActivity>
      const currentAction =
        candidate.currentAction &&
        typeof candidate.currentAction === 'object' &&
        !Array.isArray(candidate.currentAction)
          ? (candidate.currentAction as Partial<CommitActivityAction>)
          : null
      const markerId =
        typeof candidate.markerId === 'string' && candidate.markerId
          ? candidate.markerId
          : typeof candidate.providerId === 'string' &&
              typeof candidate.chatId === 'string' &&
              typeof candidate.startedAt === 'number'
            ? `legacy:${candidate.providerId}:${candidate.chatId}:${candidate.startedAt}`
            : ''
      if (
        candidate.source !== 'ai' ||
        !isProviderId(candidate.providerId) ||
        typeof candidate.chatId !== 'string' ||
        !candidate.chatId ||
        (candidate.sourceChatId !== null && typeof candidate.sourceChatId !== 'string') ||
        !markerId ||
        (candidate.projectCwd !== null && typeof candidate.projectCwd !== 'string') ||
        (candidate.commitAction !== 'commit' && candidate.commitAction !== 'amend') ||
        !currentAction ||
        typeof currentAction.label !== 'string' ||
        !providerToolActivities.has(currentAction.activity as ProviderToolActivity) ||
        (currentAction.icon != null &&
          !providerToolIcons.has(currentAction.icon as ProviderToolIcon)) ||
        typeof candidate.startedAt !== 'number' ||
        !Number.isFinite(candidate.startedAt)
      ) {
        return
      }

      const activity = {
        source: 'ai',
        providerId: candidate.providerId,
        chatId: candidate.chatId,
        sourceChatId: candidate.sourceChatId,
        markerId,
        projectCwd: candidate.projectCwd,
        commitAction: candidate.commitAction,
        currentAction: {
          label: currentAction.label,
          activity: currentAction.activity as ProviderToolActivity,
          icon: (currentAction.icon as ProviderToolIcon | null | undefined) ?? null
        },
        startedAt: candidate.startedAt
      } satisfies ScopedCommitActivity

      activities[getProviderChatKey(activity.providerId, activity.chatId)] = activity
    })

    return activities
  } catch {
    return {}
  }
}

const readStoredChatCommitMarkers = (): Record<string, ChatCommitMarker> => {
  try {
    const storedValue = window.localStorage.getItem(chatCommitMarkersStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const markers: Record<string, ChatCommitMarker> = {}
    Object.values(parsedValue as Record<string, unknown>).forEach((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return

      const candidate = value as Partial<ChatCommitMarker>
      if (
        typeof candidate.id !== 'string' ||
        !candidate.id ||
        !isProviderId(candidate.providerId) ||
        typeof candidate.sourceChatId !== 'string' ||
        !candidate.sourceChatId ||
        (candidate.commitChatId !== null && typeof candidate.commitChatId !== 'string') ||
        (candidate.commitAction !== 'commit' && candidate.commitAction !== 'amend') ||
        !chatCommitMarkerStatuses.has(candidate.status as ChatCommitMarkerStatus) ||
        (candidate.afterItemId !== null && typeof candidate.afterItemId !== 'string') ||
        typeof candidate.startedAt !== 'number' ||
        !Number.isFinite(candidate.startedAt) ||
        (candidate.finishedAt !== null &&
          (typeof candidate.finishedAt !== 'number' || !Number.isFinite(candidate.finishedAt)))
      ) {
        return
      }

      markers[candidate.id] = {
        id: candidate.id,
        providerId: candidate.providerId,
        sourceChatId: candidate.sourceChatId,
        commitChatId: candidate.commitChatId,
        commitAction: candidate.commitAction,
        status: candidate.status as ChatCommitMarkerStatus,
        afterItemId: candidate.afterItemId,
        startedAt: candidate.startedAt,
        finishedAt: candidate.finishedAt
      }
    })

    return markers
  } catch {
    return {}
  }
}

const writeStoredChatCommitMarkers = (markers: Record<string, ChatCommitMarker>): void => {
  try {
    if (Object.keys(markers).length === 0) {
      window.localStorage.removeItem(chatCommitMarkersStorageKey)
      return
    }

    window.localStorage.setItem(chatCommitMarkersStorageKey, JSON.stringify(markers))
  } catch {
    // Visual commit history remains available for this session if storage is unavailable.
  }
}

const writeStoredScopedCommitActivities = (
  activities: Record<string, ScopedCommitActivity>
): void => {
  try {
    if (Object.keys(activities).length === 0) {
      window.localStorage.removeItem(scopedCommitActivitiesStorageKey)
      return
    }

    window.localStorage.setItem(scopedCommitActivitiesStorageKey, JSON.stringify(activities))
  } catch {
    // Commit activity recovery is best-effort when storage is unavailable.
  }
}

const readStoredContinuedStoppedWorkingSteps = (): ContinuedStoppedWorkingStepsByChat => {
  try {
    const storedValue = window.localStorage.getItem(continuedStoppedWorkingStepsStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as unknown
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const continuedSteps: ContinuedStoppedWorkingStepsByChat = {}
    Object.entries(parsedValue as Record<string, unknown>).forEach(([chatKey, value]) => {
      if (!chatKey || !Array.isArray(value)) return

      const workingStepIds = Array.from(
        new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))
      )
      if (workingStepIds.length > 0) continuedSteps[chatKey] = workingStepIds
    })

    return continuedSteps
  } catch {
    return {}
  }
}

const writeStoredContinuedStoppedWorkingSteps = (
  continuedSteps: ContinuedStoppedWorkingStepsByChat
): void => {
  try {
    if (Object.keys(continuedSteps).length === 0) {
      window.localStorage.removeItem(continuedStoppedWorkingStepsStorageKey)
      return
    }

    window.localStorage.setItem(
      continuedStoppedWorkingStepsStorageKey,
      JSON.stringify(continuedSteps)
    )
  } catch {
    // Continued-step grouping remains available for this session if storage is unavailable.
  }
}

const GitRefreshIcon: React.FC = () => (
  <RefreshCw className="changes-sidebar__refresh-icon" aria-hidden="true" />
)

const AnimatedStatusIcon: React.FC<{
  Icon: AnimatedIconComponent
  active: boolean
  className?: string
  size?: number
}> = ({ Icon, active, className, size = 20 }) => {
  const iconRef = useRef<AnimatedIconHandle | null>(null)

  useEffect(() => {
    const icon = iconRef.current

    if (!active) {
      icon?.stopAnimation()
      return undefined
    }

    icon?.startAnimation()
    const interval = window.setInterval(() => icon?.startAnimation(), refreshIconReplayMs)

    return () => {
      window.clearInterval(interval)
      icon?.stopAnimation()
    }
  }, [active])

  return (
    <Icon
      ref={iconRef}
      className={['app-animated-icon', className ?? 'app-animated-icon--control']
        .filter(Boolean)
        .join(' ')}
      size={size}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

const getChatCommitMarkerLabel = (marker: ChatCommitMarker): string => {
  if (marker.status === 'pending') {
    return marker.commitAction === 'amend'
      ? 'AI is amending the commit…'
      : 'AI is committing changes…'
  }
  if (marker.status === 'failed') {
    return marker.commitAction === 'amend' ? 'AI amend failed' : 'AI commit failed'
  }
  if (marker.status === 'stopped') {
    return marker.commitAction === 'amend' ? 'AI amend stopped' : 'AI commit stopped'
  }

  return marker.commitAction === 'amend' ? 'AI amend finished' : 'AI commit finished'
}

const ChatCommitMarkerItem: React.FC<{
  marker: ChatCommitMarker
  canceling?: boolean
  onCancel?: () => Promise<void> | void
}> = ({ marker, canceling = false, onCancel }) => {
  const label = getChatCommitMarkerLabel(marker)
  const cancelLabel = `Cancel AI ${marker.commitAction}`

  return (
    <div
      className={`chat-detail__commit-marker chat-detail__commit-marker--${marker.status}`}
      role="status"
      aria-live={marker.status === 'pending' ? 'polite' : undefined}
    >
      {marker.status === 'pending' ? (
        <AnimatedStatusIcon
          Icon={AnimatedGitCommitHorizontalIcon}
          active
          className="chat-detail__commit-marker-icon"
        />
      ) : (
        <span className="chat-detail__commit-marker-icon" aria-hidden="true">
          {marker.status === 'finished' ? (
            <Check />
          ) : marker.status === 'stopped' ? (
            <Minus />
          ) : (
            <X />
          )}
        </span>
      )}
      <span>{label}</span>
      {marker.status === 'pending' && onCancel && (
        <span className="chat-detail__commit-marker-cancel">
          <Button
            aria-label={cancelLabel}
            callback={onCancel}
            disabled={canceling}
            icon={<X aria-hidden="true" />}
            size="small"
            theme="transparent"
            title={cancelLabel}
          />
        </span>
      )}
    </div>
  )
}

const ChangesSidebarGitState: React.FC<{ active: boolean; label: string }> = ({
  active,
  label
}) => (
  <div className="changes-sidebar__git-state" role="status">
    {active ? (
      <AnimatedStatusIcon
        Icon={AnimatedGitBranchIcon}
        active
        className="changes-sidebar__git-state-icon"
        size={72}
      />
    ) : (
      <GitBranch className="changes-sidebar__git-state-icon" aria-hidden="true" />
    )}
    <span className="sr-only">{label}</span>
  </div>
)

const ChatSidebarLoadingState: React.FC<{ label: string }> = ({ label }) => (
  <div className="chat-sidebar__loading-state" role="status">
    <AnimatedStatusIcon
      Icon={AnimatedMessageSquareMoreIcon}
      active
      className="chat-sidebar__loading-icon"
      size={72}
    />
    <span className="sr-only">{label}</span>
  </div>
)

const GitSyncCountsLabel: React.FC<{
  active: boolean
  unpulledCount: number
  unpushedCount: number
}> = ({ active, unpulledCount, unpushedCount }) => {
  const showPull = unpulledCount > 0
  const showPush = unpushedCount > 0

  return (
    <span className="changes-sidebar__sync-label">
      {showPull && (
        <span className="changes-sidebar__sync-label-segment">
          {active ? (
            <AnimatedStatusIcon
              Icon={AnimatedDownloadIcon}
              active={active}
              className="changes-sidebar__sync-label-icon"
            />
          ) : (
            <Download className="changes-sidebar__sync-label-icon" aria-hidden="true" />
          )}
          <span>Pull</span>
          <span className="changes-sidebar__sync-label-count">{unpulledCount}</span>
        </span>
      )}
      {showPull && showPush && <span className="changes-sidebar__sync-label-separator">·</span>}
      {showPush && (
        <span className="changes-sidebar__sync-label-segment">
          {active ? (
            <AnimatedStatusIcon
              Icon={AnimatedUploadIcon}
              active={active}
              className="changes-sidebar__sync-label-icon"
            />
          ) : (
            <Upload className="changes-sidebar__sync-label-icon" aria-hidden="true" />
          )}
          <span>Push</span>
          <span className="changes-sidebar__sync-label-count">{unpushedCount}</span>
        </span>
      )}
    </span>
  )
}

const getGitRecoveryPullStrategy = (
  actionId: AppGitRecoveryActionId
): AppGitPullStrategy | null => {
  if (actionId === 'pull-rebase') return 'rebase'
  if (actionId === 'pull-merge') return 'merge'

  return null
}

const getGitRecoveryActionIcon = (actionId: AppGitRecoveryActionId): React.ReactNode => {
  if (actionId === 'pull-rebase') return <GitPullRequestArrow aria-hidden="true" />
  if (actionId === 'pull-merge') return <GitMerge aria-hidden="true" />

  return <GitRefreshIcon />
}

const getGitRecoveryRememberLabel = (actionId: AppGitRecoveryActionId): string | null => {
  if (actionId === 'pull-rebase') return 'Remember rebase'
  if (actionId === 'pull-merge') return 'Remember merge'

  return null
}

const getGitSyncWorkflowLabel = (action: GitSyncAction): string => {
  if (action === 'pullAndPush') return 'pull remote changes and push local commits'
  if (action === 'push') return 'push local commits'

  return 'pull remote changes'
}

const getGitAiResolutionPrompt = (
  recovery: GitSyncRecoveryState,
  rememberStrategy: boolean
): string => {
  const workflow = getGitSyncWorkflowLabel(recovery.requestedAction)
  const promptParts = [
    `Resolve this Git sync failure in ${recovery.cwd}.`,
    `Failed command: ${recovery.failure.command}.`,
    `Failure: ${recovery.failure.title}. ${recovery.failure.message}`
  ]

  if (rememberStrategy) {
    promptParts.push(
      'Make the pull strategy persistent for this repository using repo-local Git config before resolving it.',
      'Choose rebase or merge based on the repository history, then pull and push.'
    )
  } else {
    promptParts.push(
      `Resolve it once without changing persistent Git pull configuration, then complete the original workflow: ${workflow}.`
    )
  }

  promptParts.push('If conflicts occur, stop and explain the files that need manual resolution.')

  return promptParts.join('\n')
}

const getDropdownOptions = <TValue extends string>(
  labels: Record<TValue, string>
): DropdownOption<TValue>[] =>
  Object.entries(labels).map(([value, label]) => ({
    value: value as TValue,
    label: label as string
  }))

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

const getScrollBottomTop = (element: HTMLElement): number =>
  Math.max(0, element.scrollHeight - element.clientHeight)

const isScrolledToBottom = (element: HTMLElement): boolean =>
  getScrollBottomTop(element) - element.scrollTop <= 1

const readChatScrollAnchor = (
  contentElement: HTMLElement,
  chatKey: string,
  retainedWindow?: Pick<ChatTurnWindow, 'startIndex' | 'endIndex'>
): ChatScrollAnchor | null => {
  const contentRect = contentElement.getBoundingClientRect()
  const turnElements = contentElement.querySelectorAll<HTMLElement>('[data-chat-turn-id]')

  for (const turnElement of turnElements) {
    const turnIndex = Number(turnElement.dataset.chatTurnIndex)
    if (
      retainedWindow &&
      (!Number.isInteger(turnIndex) ||
        turnIndex < retainedWindow.startIndex ||
        turnIndex >= retainedWindow.endIndex)
    ) {
      continue
    }

    const turnRect = turnElement.getBoundingClientRect()
    if (turnRect.bottom <= contentRect.top || turnRect.top >= contentRect.bottom) continue

    const turnId = turnElement.dataset.chatTurnId
    if (!turnId) continue

    return {
      chatKey,
      offset: turnRect.top - contentRect.top,
      turnId
    }
  }

  return null
}

const restoreChatScrollAnchor = (
  contentElement: HTMLElement,
  anchor: ChatScrollAnchor
): boolean => {
  const turnElements = contentElement.querySelectorAll<HTMLElement>('[data-chat-turn-id]')
  let anchorElement: HTMLElement | null = null
  for (const turnElement of turnElements) {
    if (turnElement.dataset.chatTurnId === anchor.turnId) {
      anchorElement = turnElement
      break
    }
  }
  if (!anchorElement) return false

  const contentRect = contentElement.getBoundingClientRect()
  const nextOffset = anchorElement.getBoundingClientRect().top - contentRect.top
  const adjustment = nextOffset - anchor.offset
  if (Math.abs(adjustment) >= 0.5) contentElement.scrollTop += adjustment
  return true
}

const resetDocumentScroll = (): void => {
  window.scrollTo(0, 0)
  document.body.scrollLeft = 0
  document.body.scrollTop = 0

  if (document.scrollingElement instanceof HTMLElement) {
    document.scrollingElement.scrollLeft = 0
    document.scrollingElement.scrollTop = 0
  }
}

const roundPanePercent = (value: number): number => Math.round(value * 1000) / 1000

const getChatPanePercentsFromWidths = (
  widths: ChatPaneWidths,
  totalWidth: number
): ChatPanePercents => {
  const referenceWidth = totalWidth > 0 ? totalWidth : chatPaneDefaultReferenceWidth

  return {
    sidebar: roundPanePercent((widths.sidebar / referenceWidth) * 100),
    changes: roundPanePercent((widths.changes / referenceWidth) * 100)
  }
}

const getDefaultChatPanePercents = (totalWidth: number): ChatPanePercents =>
  getChatPanePercentsFromWidths(
    {
      sidebar: chatSidebarDefaultWidth,
      changes: changesSidebarDefaultWidth
    },
    totalWidth
  )

const getChatPaneWidthsFromPercents = (
  percents: ChatPanePercents,
  totalWidth: number
): ChatPaneWidths => {
  const referenceWidth = totalWidth > 0 ? totalWidth : chatPaneDefaultReferenceWidth

  return {
    sidebar: (percents.sidebar / 100) * referenceWidth,
    changes: (percents.changes / 100) * referenceWidth
  }
}

const clampChatPaneWidthsToAvailable = (
  widths: ChatPaneWidths,
  totalWidth: number
): ChatPaneWidths => {
  if (!totalWidth) return widths

  const handleWidth = chatResizeHandleWidth * chatResizeHandleCount
  const availableForSidebars = Math.max(0, totalWidth - handleWidth - chatBlockMinWidth)
  const minimumSidebarTotal = chatSidebarMinWidth + changesSidebarMinWidth

  if (availableForSidebars <= minimumSidebarTotal) {
    return {
      sidebar: chatSidebarMinWidth,
      changes: changesSidebarMinWidth
    }
  }

  let sidebar = Math.max(widths.sidebar, chatSidebarMinWidth)
  let changes = Math.max(widths.changes, changesSidebarMinWidth)
  const overflow = sidebar + changes - availableForSidebars

  if (overflow > 0) {
    const sidebarShrinkCapacity = sidebar - chatSidebarMinWidth
    const changesShrinkCapacity = changes - changesSidebarMinWidth
    const shrinkCapacity = sidebarShrinkCapacity + changesShrinkCapacity

    if (shrinkCapacity > 0) {
      sidebar -= overflow * (sidebarShrinkCapacity / shrinkCapacity)
      changes -= overflow * (changesShrinkCapacity / shrinkCapacity)
    }
  }

  return {
    sidebar: Math.round(sidebar),
    changes: Math.round(changes)
  }
}

const clampChatPanePercentsToAvailable = (
  percents: ChatPanePercents,
  totalWidth: number
): ChatPanePercents => {
  if (!totalWidth) return percents

  return getChatPanePercentsFromWidths(
    clampChatPaneWidthsToAvailable(getChatPaneWidthsFromPercents(percents, totalWidth), totalWidth),
    totalWidth
  )
}

const formatChatPanePercent = (percent: number): string => `${roundPanePercent(percent)}%`

const isChatPanePercentValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100

const readStoredChatPanePercents = (): ChatPanePercents | null => {
  try {
    const storedValue = window.localStorage.getItem(chatPanePreferenceStorageKey)
    if (!storedValue) return null

    const parsedValue = JSON.parse(storedValue) as Partial<ChatPanePercents> | null
    if (!parsedValue || typeof parsedValue !== 'object') return null
    if (!isChatPanePercentValue(parsedValue.sidebar)) return null
    if (!isChatPanePercentValue(parsedValue.changes)) return null

    return {
      sidebar: roundPanePercent(parsedValue.sidebar),
      changes: roundPanePercent(parsedValue.changes)
    }
  } catch {
    return null
  }
}

const writeStoredChatPanePercents = (percents: ChatPanePercents): void => {
  try {
    window.localStorage.setItem(chatPanePreferenceStorageKey, JSON.stringify(percents))
  } catch {
    // Layout preferences are non-critical; ignore unavailable storage.
  }
}

const isLegacyProviderAccessMode = (value: unknown): value is LegacyProviderAccessMode =>
  value === 'sandbox' || value === 'auto' || value === 'full'

const getLegacyApprovalMode = (accessMode: LegacyProviderAccessMode): ProviderApprovalMode =>
  accessMode === 'sandbox' ? 'ask-user' : 'never'

const getApprovalModeForPolicy = (
  approvalPolicy: ProviderApprovalPolicy,
  approvalsReviewer: ProviderApprovalsReviewer
): ProviderApprovalMode => {
  if (approvalPolicy === 'never') return 'never'
  if (approvalPolicy === 'on-request' && approvalsReviewer === 'auto_review') return 'auto-review'

  return 'ask-user'
}

const getApprovalAccessOptions = (
  approvalMode: ProviderApprovalMode,
  sandboxMode: ProviderSandboxMode
): { approvalPolicy: ProviderApprovalPolicy; approvalsReviewer: ProviderApprovalsReviewer } => {
  const effectiveApprovalMode = sandboxMode === 'danger-full-access' ? 'never' : approvalMode

  if (effectiveApprovalMode === 'never') {
    return { approvalPolicy: 'never', approvalsReviewer: 'user' }
  }
  if (effectiveApprovalMode === 'auto-review') {
    return { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
  }

  return { approvalPolicy: 'on-request', approvalsReviewer: 'user' }
}

const getLegacySandboxMode = (accessMode: LegacyProviderAccessMode): ProviderSandboxMode =>
  accessMode === 'full' ? 'danger-full-access' : 'workspace-write'

const isStoredSelectionString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const parseStoredMessageBoxSelection = (value: unknown): StoredMessageBoxSelection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const parsedValue = value as Record<string, unknown>
  const selection: StoredMessageBoxSelection = {}
  if (isProviderApprovalMode(parsedValue.approvalMode)) {
    selection.approvalMode = parsedValue.approvalMode
  } else if (isProviderApprovalPolicy(parsedValue.approvalPolicy)) {
    const approvalsReviewer = isProviderApprovalsReviewer(parsedValue.approvalsReviewer)
      ? parsedValue.approvalsReviewer
      : 'user'

    selection.approvalMode = getApprovalModeForPolicy(parsedValue.approvalPolicy, approvalsReviewer)
  }
  if (isProviderSandboxMode(parsedValue.sandboxMode)) {
    selection.sandboxMode = parsedValue.sandboxMode
  }
  if (
    (!selection.approvalMode || !selection.sandboxMode) &&
    isLegacyProviderAccessMode(parsedValue.accessMode)
  ) {
    selection.approvalMode ??= getLegacyApprovalMode(parsedValue.accessMode)
    selection.sandboxMode ??= getLegacySandboxMode(parsedValue.accessMode)
  }
  if (isStoredSelectionString(parsedValue.model)) selection.model = parsedValue.model
  if (isStoredSelectionString(parsedValue.reasoningEffort)) {
    selection.reasoningEffort = parsedValue.reasoningEffort
  }
  if (parsedValue.serviceTier == null || isProviderServiceTier(parsedValue.serviceTier)) {
    selection.serviceTier = parsedValue.serviceTier ?? null
  }

  return selection
}

const readStoredMessageBoxSelections = (): StoredMessageBoxSelections => {
  try {
    const storedValue = window.localStorage.getItem(messageBoxSelectionsStorageKey)
    if (storedValue) {
      const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
      if (parsedValue && typeof parsedValue === 'object' && !Array.isArray(parsedValue)) {
        return Object.fromEntries(
          providerIds.flatMap((providerId) => {
            const value = parsedValue[providerId]
            return value && typeof value === 'object' && !Array.isArray(value)
              ? [[providerId, parseStoredMessageBoxSelection(value)]]
              : []
          })
        )
      }
    }
  } catch {
    // Fall through to the legacy single-provider preference.
  }

  try {
    const storedValue = window.localStorage.getItem(legacyMessageBoxSelectionStorageKey)
    if (!storedValue) return {}

    const legacySelection = parseStoredMessageBoxSelection(JSON.parse(storedValue))
    if (Object.keys(legacySelection).length === 0) return {}

    return Object.fromEntries(providerIds.map((providerId) => [providerId, { ...legacySelection }]))
  } catch {
    return {}
  }
}

const writeStoredMessageBoxSelections = (selections: StoredMessageBoxSelections): void => {
  try {
    window.localStorage.setItem(messageBoxSelectionsStorageKey, JSON.stringify(selections))
  } catch {
    // Composer preferences are non-critical; ignore unavailable storage.
  }
}

const providerOptions = getDropdownOptions(providerLabels)

const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

const formatSelectionLabel = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || value

const highlightedControlIconClassName = 'message-box__selected-control-icon'

const chatApprovalModeIcons = {
  'ask-user': <ShieldQuestionMark aria-hidden="true" />,
  'auto-review': <Sparkles aria-hidden="true" />,
  never: <BadgeCheck aria-hidden="true" />
} satisfies Record<ProviderApprovalMode, React.ReactNode>

const chatSandboxModeIcons = {
  'read-only': <FileLock aria-hidden="true" />,
  'workspace-write': <FolderPen aria-hidden="true" />,
  'danger-full-access': (
    <UnlockKeyhole className={highlightedControlIconClassName} aria-hidden="true" />
  )
} satisfies Record<ProviderSandboxMode, React.ReactNode>

const getChatServiceTierIcon = (id: string, label = id): React.ReactNode =>
  id.toLocaleLowerCase() === 'fast' ||
  id.toLocaleLowerCase() === 'priority' ||
  label.toLocaleLowerCase() === 'fast' ? (
    <Zap className="message-box__fast-speed-icon" aria-hidden="true" />
  ) : (
    <Gauge aria-hidden="true" />
  )

const applyShadowPreference = (disableShadows: boolean): void => {
  const root = document.documentElement

  if (disableShadows) {
    root.dataset.disableShadows = 'true'
  } else {
    delete root.dataset.disableShadows
  }
}

const getEffectiveAppearancePosition = (
  preference: AppAppearancePositionPreference
): Exclude<AppAppearancePositionPreference, 'system'> => {
  if (preference !== 'system') return preference

  return document.documentElement.dataset.platform === 'darwin' ? 'left' : 'right'
}

const getEffectiveAppearanceStyle = (
  preference: AppAppearanceStylePreference
): Exclude<AppAppearanceStylePreference, 'system'> => {
  if (preference !== 'system') return preference

  return document.documentElement.dataset.platform === 'darwin' ? 'macos' : 'sele'
}

const applyWindowControlAppearancePreferences = (appearance: AppSettings['appearance']): void => {
  const root = document.documentElement

  root.dataset.windowControlPosition = getEffectiveAppearancePosition(appearance.position)
  root.dataset.windowControlStyle = getEffectiveAppearanceStyle(appearance.style)
  root.dataset.controlStyle = appearance.controlStyle
}

const settingsTabOptions = [
  {
    value: 'appearance',
    label: 'Appearance',
    icon: <Sun aria-hidden="true" />
  },
  {
    value: 'chat',
    label: 'Chat',
    icon: <MessageSquare aria-hidden="true" />
  },
  {
    value: 'links',
    label: 'Links',
    icon: <Link2 aria-hidden="true" />
  },
  {
    value: 'performance',
    label: 'Performance',
    icon: <Gauge aria-hidden="true" />
  },
  {
    value: 'git',
    label: 'Git',
    icon: <GitBranch aria-hidden="true" />
  }
] satisfies readonly {
  value: SettingsTab
  label: string
  icon: React.ReactNode
}[]

const themeOptions = [
  {
    value: 'light',
    label: 'Light',
    icon: <Sun aria-hidden="true" />
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <Moon aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppThemePreference
  label: string
  icon: React.ReactNode
}[]

const appearancePositionOptions = [
  {
    value: 'left',
    label: 'Left',
    icon: <PanelLeft aria-hidden="true" />
  },
  {
    value: 'right',
    label: 'Right',
    icon: <PanelRight aria-hidden="true" />
  },
  {
    value: 'hidden',
    label: 'Hidden',
    icon: <EyeOff aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearancePositionPreference
  label: string
  icon: React.ReactNode
}[]

const appearanceStyleOptions = [
  {
    value: 'sele',
    label: 'Sele',
    icon: <AppWindow aria-hidden="true" />
  },
  {
    value: 'macos',
    label: 'macOS',
    icon: <Apple aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearanceStylePreference
  label: string
  icon: React.ReactNode
}[]

const appearanceControlStyleOptions = [
  {
    value: 'bordered',
    label: 'Bordered',
    icon: <AppWindow aria-hidden="true" />
  },
  {
    value: 'transparent',
    label: 'Transparent',
    icon: <Sparkles aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearanceControlStylePreference
  label: string
  icon: React.ReactNode
}[]

const externalLinkOptions = [
  {
    value: 'manual',
    label: 'Manual'
  },
  {
    value: 'copy',
    label: 'Copy'
  },
  {
    value: 'open',
    label: 'Open'
  }
] satisfies readonly {
  value: AppExternalLinkBehavior
  label: string
}[]

const chatUsageDisplayOptions = [
  {
    value: 'chatContext',
    label: 'Chat context'
  },
  {
    value: 'global',
    label: 'Global'
  }
] satisfies readonly {
  value: AppChatUsageDisplay
  label: string
}[]

const gitCommitPromptFieldOptions = [
  {
    key: 'instructions',
    label: 'Instructions',
    rows: 6
  },
  {
    key: 'workflow',
    label: 'Workflow',
    rows: 9
  },
  {
    key: 'commitStep',
    label: 'Commit step',
    rows: 2
  },
  {
    key: 'amendStep',
    label: 'Amend step',
    rows: 2
  },
  {
    key: 'extraInstructionsPrefix',
    label: 'Extra instructions prefix',
    rows: 1
  }
] satisfies readonly {
  key: keyof AppGitCommitPromptSettings
  label: string
  rows: number
}[]

const approvalTypeLabels = {
  command: 'Command approval',
  fileChange: 'File change approval'
} as const

const getDefaultModel = (models: ProviderModel[]): ProviderModel =>
  models.find((nextModel) => nextModel.isDefault) ?? models[0] ?? fallbackInitialModel

const getDefaultReasoningEffort = (model: ProviderModel | undefined): ProviderReasoningEffort =>
  model?.defaultReasoningEffort ||
  model?.supportedReasoningEfforts.find((option) => option.isDefault)?.id ||
  model?.supportedReasoningEfforts[0]?.id ||
  fallbackInitialReasoningEffort

const modelHasReasoningEffortOptions = (model: ProviderModel | undefined): boolean =>
  Boolean(model?.supportedReasoningEfforts.length)

const modelHasServiceTierOptions = (model: ProviderModel | undefined): boolean =>
  Boolean(model?.supportedServiceTiers?.length)

const getDefaultApprovalMode = (
  approvalModes: ProviderApprovalModeOption[]
): ProviderApprovalMode =>
  approvalModes.find((mode) => mode.isDefault)?.id ??
  approvalModes[0]?.id ??
  fallbackDefaultApprovalMode

const getDefaultSandboxMode = (sandboxModes: ProviderSandboxModeOption[]): ProviderSandboxMode =>
  sandboxModes.find((mode) => mode.isDefault)?.id ??
  sandboxModes[0]?.id ??
  fallbackDefaultSandboxMode

const modelSupportsReasoningEffort = (
  model: ProviderModel | undefined,
  reasoningEffort: ProviderReasoningEffort | undefined
): boolean =>
  reasoningEffort != null &&
  (!model || model.supportedReasoningEfforts.some((option) => option.id === reasoningEffort))

const modelSupportsServiceTier = (
  model: ProviderModel | undefined,
  serviceTier: ProviderServiceTier | null
): boolean =>
  serviceTier == null ||
  !model ||
  Boolean(model.supportedServiceTiers?.some((option) => option.id === serviceTier))

const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

const getProviderChatKey = (providerId: ProviderId, chatId: string): string =>
  getChatKey({ providerId, id: chatId })

const optimisticChatItemIdPrefix = 'optimistic:'

const createChatCommitMarkerId = (): string => {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `ai-commit:${Date.now()}:${randomId}`
}

const trimRecentChatCache = (cache: Map<string, RecentChatCacheEntry>, limit: number): void => {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value
    if (typeof oldestKey !== 'string') return
    cache.delete(oldestKey)
  }
}

const isActiveChatStatus = (status: ProviderChatDetail['status'] | undefined): boolean =>
  status === 'active' || status === 'waitingOnApproval' || status === 'waitingOnUserInput'

const getChatCommitMarkerTerminalStatus = (
  detail: ProviderChatDetail
): Exclude<ChatCommitMarkerStatus, 'pending'> => {
  if (detail.status === 'error') return 'failed'

  const lastWorkingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working'
  )
  return lastWorkingStep?.status === 'stopped' ? 'stopped' : 'finished'
}

const getLastChatCommitMarkerAnchorId = (
  items: ProviderChatItem[],
  fallbackId: string | null = null
): string | null => items.findLast((item) => item.type !== 'pendingMessage')?.id ?? fallbackId

const getChatItemCreatedAt = (item: ProviderChatItem): number | null =>
  (item.type === 'message' || item.type === 'pendingMessage') &&
  typeof item.createdAt === 'number' &&
  Number.isFinite(item.createdAt)
    ? item.createdAt
    : null

const getChatCommitMarkerPlacementTime = (marker: ChatCommitMarker): number =>
  marker.finishedAt ?? marker.startedAt

const compareChatsByCreatedAtDesc = (firstChat: ProviderChat, secondChat: ProviderChat): number => {
  if (secondChat.createdAt !== firstChat.createdAt) {
    return secondChat.createdAt - firstChat.createdAt
  }

  return secondChat.updatedAt - firstChat.updatedAt
}

const mergeChats = (...chatGroups: ProviderChat[][]): ProviderChat[] => {
  const chatsById = new Map<string, ProviderChat>()

  for (const chatGroup of chatGroups) {
    for (const chat of chatGroup) {
      const chatKey = getChatKey(chat)
      const existingChat = chatsById.get(chatKey)

      if (!existingChat || chat.updatedAt >= existingChat.updatedAt) {
        chatsById.set(chatKey, chat)
      }
    }
  }

  return Array.from(chatsById.values()).sort(compareChatsByCreatedAtDesc)
}

const compareProjectsByUpdatedAtDesc = (
  firstProject: AppProject,
  secondProject: AppProject
): number => {
  if (secondProject.updatedAt !== firstProject.updatedAt) {
    return secondProject.updatedAt - firstProject.updatedAt
  }

  return getFolderName(firstProject.cwd).localeCompare(getFolderName(secondProject.cwd))
}

const mergeProjects = (...projectGroups: AppProject[][]): AppProject[] => {
  const projectsByCwd = new Map<string, AppProject>()

  for (const projectGroup of projectGroups) {
    for (const project of projectGroup) {
      const cwd = project.cwd.trim()
      if (!cwd) continue

      const normalizedProject = { ...project, cwd }
      const existingProject = projectsByCwd.get(cwd)
      if (!existingProject || project.updatedAt >= existingProject.updatedAt) {
        projectsByCwd.set(cwd, normalizedProject)
      }
    }
  }

  return Array.from(projectsByCwd.values()).sort(compareProjectsByUpdatedAtDesc)
}

const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const getParentPath = (path: string): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const pathSeparatorIndex = normalizedPath.lastIndexOf('/')

  return pathSeparatorIndex < 0 ? '.' : normalizedPath.slice(0, pathSeparatorIndex)
}

const getFolderName = (path: string | null): string =>
  path ? getLastPathPart(path) : 'Choose folder'

const getFolderDescription = (path: string): string => {
  const parentPath = getParentPath(path)

  return parentPath && parentPath !== '.' ? parentPath : path
}

const getChatCwdLabel = (cwd: string | null): string =>
  cwd?.trim() ? getLastPathPart(cwd.trim()) : 'Unknown cwd'

const getChatCwdGroupKey = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? `cwd:${normalizedCwd}` : unknownCwdGroupKey
}

const getChatProjectCwd = (chat: Pick<ProviderChat, 'cwd' | 'projectCwd'>): string | null =>
  chat.projectCwd?.trim() || chat.cwd?.trim() || null

const getDefaultCollapsedGroupState = (groupKey: string): boolean => groupKey === doneGroupKey

const getCollapsedGroupState = (
  groupKey: string,
  collapsedGroups: Record<string, boolean>
): boolean => collapsedGroups[groupKey] ?? getDefaultCollapsedGroupState(groupKey)

const sortChatsForGroup = (chats: ProviderChat[]): ProviderChat[] =>
  [...chats].sort(compareChatsByCreatedAtDesc)

const sortPinnedChats = (chats: ProviderChat[]): ProviderChat[] =>
  [...chats].sort((firstChat, secondChat) => {
    if (firstChat.pinnedOrder !== null && secondChat.pinnedOrder !== null) {
      const orderDifference = firstChat.pinnedOrder - secondChat.pinnedOrder
      if (orderDifference !== 0) return orderDifference
    } else if (firstChat.pinnedOrder !== null) {
      return -1
    } else if (secondChat.pinnedOrder !== null) {
      return 1
    }

    if (secondChat.createdAt !== firstChat.createdAt) {
      return secondChat.createdAt - firstChat.createdAt
    }

    return getChatKey(firstChat).localeCompare(getChatKey(secondChat))
  })

const groupChatsForSidebar = (chats: ProviderChat[]): ChatListGroupData[] => {
  const groupsByCwd = new Map<string, ChatListGroupData>()
  const groupCreatedAtByKey = new Map<string, number>()
  const pinnedChats: ProviderChat[] = []
  const doneChats: ProviderChat[] = []

  for (const chat of chats) {
    const projectCwd = getChatProjectCwd(chat)
    const key = getChatCwdGroupKey(projectCwd)
    const groupCreatedAt = groupCreatedAtByKey.get(key)
    if (groupCreatedAt === undefined || chat.createdAt > groupCreatedAt) {
      groupCreatedAtByKey.set(key, chat.createdAt)
    }

    if (chat.pinned) {
      pinnedChats.push(chat)
      continue
    }

    if (chat.done) {
      doneChats.push(chat)
      continue
    }

    const existingGroup = groupsByCwd.get(key)

    if (existingGroup) {
      existingGroup.chats.push(chat)
      continue
    }

    groupsByCwd.set(key, {
      key,
      cwd: projectCwd,
      label: getChatCwdLabel(projectCwd),
      chats: [chat],
      kind: 'cwd'
    })
  }

  const cwdGroups = Array.from(groupsByCwd.values()).map((group) => ({
    ...group,
    chats: sortChatsForGroup(group.chats)
  }))
  cwdGroups.sort((firstGroup, secondGroup) => {
    const firstCreatedAt = groupCreatedAtByKey.get(firstGroup.key) ?? 0
    const secondCreatedAt = groupCreatedAtByKey.get(secondGroup.key) ?? 0
    if (secondCreatedAt !== firstCreatedAt) {
      return secondCreatedAt - firstCreatedAt
    }

    return firstGroup.label.localeCompare(secondGroup.label)
  })
  const pinnedGroups =
    pinnedChats.length === 0
      ? []
      : [
          {
            key: pinnedGroupKey,
            cwd: null,
            label: 'Pinned',
            chats: sortPinnedChats(pinnedChats),
            kind: 'pinned' as const
          }
        ]

  return [
    ...pinnedGroups,
    ...cwdGroups,
    ...(doneChats.length === 0
      ? []
      : [
          {
            key: doneGroupKey,
            cwd: null,
            label: 'Done',
            chats: sortChatsForGroup(doneChats),
            kind: 'done' as const
          }
        ])
  ]
}

const getChatPreview = (detail: ProviderChatDetail): string | null => {
  const message = detail.items.findLast((item) => item.type === 'message')
  return message?.content.trim() || null
}

const getChatFromDetail = (
  providerId: ProviderId,
  detail: ProviderChatDetail,
  existingChat: ProviderChat | null,
  updatedAt: number
): ProviderChat => ({
  id: detail.id,
  providerId,
  title: detail.title,
  preview: getChatPreview(detail) ?? existingChat?.preview ?? '',
  cwd: detail.cwd ?? existingChat?.cwd ?? null,
  cwdKind: detail.cwdKind ?? existingChat?.cwdKind ?? 'directory',
  projectCwd: detail.projectCwd ?? existingChat?.projectCwd ?? detail.cwd ?? null,
  branchName: detail.branchName ?? existingChat?.branchName ?? null,
  worktreeBaseBranchName:
    detail.worktreeBaseBranchName ?? existingChat?.worktreeBaseBranchName ?? null,
  createdAt: detail.createdAt,
  updatedAt,
  status: detail.status,
  pendingApproval: detail.pendingApproval,
  seenUpdatedAt: detail.seenUpdatedAt ?? existingChat?.seenUpdatedAt ?? null,
  pinned: detail.pinned ?? existingChat?.pinned ?? false,
  pinnedOrder: detail.pinnedOrder ?? existingChat?.pinnedOrder ?? null,
  done: detail.done ?? existingChat?.done ?? false,
  purpose: detail.purpose ?? existingChat?.purpose ?? null,
  container: detail.container ?? existingChat?.container ?? null
})

const getWorkingStepFromUpdate = (
  update: Extract<ProviderChatItemUpdate, { type: 'working' }>,
  currentItem: ProviderChatItem | undefined
): ProviderWorkingStep | null => {
  const { items, workingItemsPrefixLastId, workingItemsStartIndex, ...workingStep } = update
  if (
    !Number.isSafeInteger(workingItemsStartIndex) ||
    workingItemsStartIndex < 0 ||
    (workingItemsStartIndex > 0 &&
      (currentItem?.type !== 'working' ||
        currentItem.id !== update.id ||
        currentItem.items.length < workingItemsStartIndex ||
        currentItem.items[workingItemsStartIndex - 1]?.id !== workingItemsPrefixLastId))
  ) {
    return null
  }

  return {
    ...workingStep,
    items:
      workingItemsStartIndex === 0
        ? items
        : [...(currentItem as ProviderWorkingStep).items.slice(0, workingItemsStartIndex), ...items]
  }
}

const getChatDetailFromUpdate = (
  update: ProviderChatDetailUpdate,
  currentDetail: ProviderChatDetail | null,
  preserveOptimisticTurnUntilUserMessage = false
): ProviderChatDetail | null => {
  const { chatItemsPrefixLastId, chatItemsStartIndex, items, ...chatDetail } = update
  if (
    !Number.isSafeInteger(chatItemsStartIndex) ||
    chatItemsStartIndex < 0 ||
    (chatItemsStartIndex > 0 &&
      (currentDetail?.id !== update.id ||
        currentDetail.items.length < chatItemsStartIndex ||
        currentDetail.items[chatItemsStartIndex - 1]?.id !== chatItemsPrefixLastId))
  ) {
    return null
  }

  const preserveOptimisticItems =
    chatItemsStartIndex === 0 &&
    items.length === 0 &&
    currentDetail?.id === update.id &&
    currentDetail.items.some((item) => item.id.startsWith(optimisticChatItemIdPrefix))
  const mergedItems: ProviderChatItem[] = preserveOptimisticItems
    ? currentDetail.items
    : chatItemsStartIndex === 0
      ? []
      : currentDetail!.items.slice(0, chatItemsStartIndex)
  for (const [index, item] of items.entries()) {
    const currentItem = currentDetail?.items[chatItemsStartIndex + index]
    if (item.type !== 'working') {
      if (
        (item.type === 'message' || item.type === 'pendingMessage') &&
        item.contentLoaded === false &&
        currentItem?.type === item.type &&
        currentItem.contentLoaded !== false
      ) {
        mergedItems.push(currentItem)
        continue
      }
      mergedItems.push(item)
      continue
    }

    if (
      item.itemsLoaded === false &&
      currentItem?.type === 'working' &&
      currentItem.itemsLoaded !== false
    ) {
      mergedItems.push(currentItem)
      continue
    }

    const mergedWorkingStep = getWorkingStepFromUpdate(item, currentItem)
    if (!mergedWorkingStep) return null
    mergedItems.push(mergedWorkingStep)
  }

  if (preserveOptimisticTurnUntilUserMessage && currentDetail?.id === update.id) {
    // Copilot can report an active turn before its SDK echoes the new user message. Keep the
    // optimistic turn during that gap so the previous working step is not briefly reactivated.
    const optimisticTurnStartIndex = currentDetail.items.findIndex((item) =>
      item.id.startsWith(optimisticChatItemIdPrefix)
    )

    if (optimisticTurnStartIndex >= 0) {
      const existingUserMessageIds = new Set(
        currentDetail.items
          .slice(0, optimisticTurnStartIndex)
          .filter(
            (item): item is ProviderMessage => item.type === 'message' && item.role === 'user'
          )
          .map((item) => item.id)
      )
      const hasNewProviderUserMessage = mergedItems.some(
        (item) =>
          item.type === 'message' &&
          item.role === 'user' &&
          !item.id.startsWith(optimisticChatItemIdPrefix) &&
          !existingUserMessageIds.has(item.id)
      )

      if (!hasNewProviderUserMessage) {
        return {
          ...chatDetail,
          items: currentDetail.items
        }
      }
    }
  }

  markChatItemsChanged(mergedItems, chatItemsStartIndex, currentDetail?.items ?? null)

  return {
    ...chatDetail,
    items: mergedItems
  }
}

const getChatDetailFromUpdateSummary = (
  detail: ProviderChatDetail,
  summary: ProviderChatUpdateSummary
): ProviderChatDetail => ({
  ...detail,
  createdAt: summary.createdAt,
  title: summary.title,
  cwd: summary.cwd,
  cwdKind: summary.cwdKind,
  projectCwd: summary.projectCwd,
  branchName: summary.branchName,
  worktreeBaseBranchName: summary.worktreeBaseBranchName,
  status: summary.status,
  pendingApproval: summary.pendingApproval,
  pinned: summary.pinned,
  pinnedOrder: summary.pinnedOrder,
  done: summary.done,
  seenUpdatedAt: summary.seenUpdatedAt,
  purpose: summary.purpose,
  container: summary.container ?? detail.container
})

const arePendingApprovalsEqual = (
  first: ProviderChat['pendingApproval'],
  second: ProviderChat['pendingApproval']
): boolean =>
  first === second ||
  (Boolean(first) &&
    Boolean(second) &&
    first?.id === second?.id &&
    first?.type === second?.type &&
    first?.command === second?.command &&
    first?.cwd === second?.cwd &&
    first?.reason === second?.reason &&
    first?.startedAt === second?.startedAt)

const areContainerTargetsEqual = (
  first: ProviderChat['container'],
  second: ProviderChat['container']
): boolean =>
  first === second ||
  ((!first || first.kind === 'host') && (!second || second.kind === 'host')) ||
  (first?.kind === 'container' &&
    second?.kind === 'container' &&
    first.tool === second.tool &&
    first.name === second.name &&
    (first.tool !== 'ssh' ||
      second.tool !== 'ssh' ||
      getContainerTargetKey(first) === getContainerTargetKey(second)))

const areChatsEqual = (first: ProviderChat, second: ProviderChat): boolean =>
  first.id === second.id &&
  first.providerId === second.providerId &&
  first.title === second.title &&
  first.preview === second.preview &&
  first.cwd === second.cwd &&
  first.cwdKind === second.cwdKind &&
  first.projectCwd === second.projectCwd &&
  first.branchName === second.branchName &&
  first.worktreeBaseBranchName === second.worktreeBaseBranchName &&
  first.createdAt === second.createdAt &&
  first.updatedAt === second.updatedAt &&
  first.status === second.status &&
  arePendingApprovalsEqual(first.pendingApproval, second.pendingApproval) &&
  first.pinned === second.pinned &&
  first.pinnedOrder === second.pinnedOrder &&
  first.done === second.done &&
  first.seenUpdatedAt === second.seenUpdatedAt &&
  first.purpose === second.purpose &&
  areContainerTargetsEqual(first.container, second.container)

const getChatFromUpdateSummary = (
  providerId: ProviderId,
  summary: ProviderChatUpdateSummary,
  existingChat: ProviderChat | null,
  turnCompleted: boolean
): ProviderChat => {
  const container = summary.container ?? existingChat?.container ?? null
  const summaryChanged =
    !existingChat ||
    existingChat.title !== summary.title ||
    existingChat.cwd !== summary.cwd ||
    existingChat.cwdKind !== summary.cwdKind ||
    existingChat.projectCwd !== summary.projectCwd ||
    existingChat.branchName !== summary.branchName ||
    existingChat.worktreeBaseBranchName !== summary.worktreeBaseBranchName ||
    existingChat.status !== summary.status ||
    !arePendingApprovalsEqual(existingChat.pendingApproval, summary.pendingApproval) ||
    existingChat.pinned !== summary.pinned ||
    existingChat.pinnedOrder !== summary.pinnedOrder ||
    existingChat.done !== summary.done ||
    existingChat.seenUpdatedAt !== summary.seenUpdatedAt ||
    existingChat.purpose !== summary.purpose ||
    !areContainerTargetsEqual(existingChat.container, container)

  return {
    id: summary.id,
    providerId,
    title: summary.title,
    preview: !existingChat || turnCompleted ? summary.preview : existingChat.preview,
    cwd: summary.cwd,
    cwdKind: summary.cwdKind,
    projectCwd: summary.projectCwd,
    branchName: summary.branchName,
    worktreeBaseBranchName: summary.worktreeBaseBranchName,
    createdAt: summary.createdAt,
    updatedAt:
      !existingChat || summaryChanged || turnCompleted ? summary.updatedAt : existingChat.updatedAt,
    status: summary.status,
    pendingApproval: summary.pendingApproval,
    pinned: summary.pinned,
    pinnedOrder: summary.pinnedOrder,
    done: summary.done,
    seenUpdatedAt:
      existingChat?.seenUpdatedAt == null
        ? summary.seenUpdatedAt
        : summary.seenUpdatedAt == null
          ? existingChat.seenUpdatedAt
          : Math.max(existingChat.seenUpdatedAt, summary.seenUpdatedAt),
    purpose: summary.purpose,
    container
  }
}

const getOptimisticItems = (
  items: ProviderChatItem[],
  message: string,
  attachments: AppSelectedAttachment[] = [],
  review?: Omit<ProviderReview, 'prompt'> | null
): ProviderChatItem[] => {
  const createdAt = Date.now()
  const id = `${optimisticChatItemIdPrefix}${createdAt}`

  return [
    ...items,
    {
      type: 'message',
      id: `${id}:user`,
      role: 'user',
      content: message.trim(),
      attachments: [
        ...attachments.map((attachment) =>
          attachment.kind === 'image'
            ? {
                kind: attachment.kind,
                name: attachment.name,
                path: attachment.path,
                dataUrl: attachment.dataUrl
              }
            : {
                kind: attachment.kind,
                name: attachment.name,
                path: attachment.path
              }
        ),
        ...(review
          ? [
              {
                kind: 'review' as const,
                id: review.id,
                comments: review.comments
              }
            ]
          : [])
      ] satisfies NonNullable<ProviderMessage['attachments']>,
      createdAt
    },
    {
      type: 'working',
      id: `${id}:working`,
      status: 'working',
      items: []
    }
  ]
}

const formatReviewComments = (comments: ProviderReviewComment[]): string => {
  const commentsByPath = new Map<string, string[]>()

  comments.forEach(({ path, comment, line, endLine }) => {
    const normalizedEndLine = Math.max(line, endLine ?? line)
    const location =
      normalizedEndLine === line ? `Line ${line}` : `Lines ${line}-${normalizedEndLine}`
    const locatedComment = `${location}: ${comment}`
    const pathComments = commentsByPath.get(path)
    if (pathComments) pathComments.push(locatedComment)
    else commentsByPath.set(path, [locatedComment])
  })

  return Array.from(commentsByPath, ([path, pathComments]) =>
    pathComments.length === 1
      ? `${path}: ${pathComments[0]}`
      : `${path}:\n${pathComments.map((comment) => `- ${comment.replace(/\n/g, '\n  ')}`).join('\n')}`
  ).join('\n\n')
}

const serializeReviewMessage = (prompt: string, review: Omit<ProviderReview, 'prompt'>): string =>
  [prompt.trim(), formatReviewComments(review.comments)].filter(Boolean).join('\n\n')

const escapeSkillName = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const escapeAppLinkLabel = (value: string): string => value.replace(/[\\[\]]/g, '\\$&')

const serializeComposerMessage = (
  message: string,
  skills: ProviderSkillInput[],
  apps: ProviderAppInput[]
): string => {
  const missingSkillMentions = skills
    .filter(
      (skill) =>
        !new RegExp(`(^|[\\s([{])\\$${escapeSkillName(skill.name)}(?=$|[\\s)\\]},.!?;:])`).test(
          message
        )
    )
    .map((skill) => `$${skill.name}`)
  const missingAppMentions = apps
    .filter((app) => !message.includes(`app://${app.id}`))
    .map((app) => `[$${escapeAppLinkLabel(app.name)}](app://${app.id})`)

  return [[...missingSkillMentions, ...missingAppMentions].join(' '), message]
    .filter(Boolean)
    .join('\n')
}

const getWorktreeBranchGenerationPrompt = (
  prompt: string,
  settings: AppGitWorktreeSettings
): string => {
  const template = settings.branchNamePrompt.trim()
  if (!template) return `Prompt:\n\`\`\`${prompt}\`\`\``

  return template.includes('{prompt}')
    ? template.replaceAll('{prompt}', prompt)
    : [template, `Prompt:\n\`\`\`${prompt}\`\`\``].join('\n\n')
}

const normalizeGeneratedWorktreeName = (value: string): string | null => {
  const name = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .find((line) => line.trim())
    ?.trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^refs\/heads\//, '')
    .replace(/^agents\//, '')
    .trim()

  return name || null
}

const hasActiveWorkingStep = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'working' && item.status === 'working') ?? false

const hasPendingSteeringMessage = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'pendingMessage' && item.kind === 'steering') ?? false

const activeCommitActivityLabelReplacements: Array<[RegExp, string]> = [
  [/^Read\b/, 'Reading'],
  [/^Searched\b/, 'Searching'],
  [/^Checked\b/, 'Checking'],
  [/^Viewed\b/, 'Viewing'],
  [/^Ran\b/, 'Running'],
  [/^Used\b/, 'Using'],
  [/^Changed\b/, 'Changing'],
  [/^Created\b/, 'Creating'],
  [/^Deleted\b/, 'Deleting'],
  [/^Applied\b/, 'Applying'],
  [/^Updated\b/, 'Updating'],
  [/^Generated\b/, 'Generating']
]

const getCommitActivityActionFromLabel = (
  label: string,
  activity: ProviderToolActivity,
  icon?: ProviderToolIcon | null
): CommitActivityAction => ({
  label: getActiveCommitActivityLabel(label) ?? 'Working',
  activity,
  icon
})

const getActiveCommitActivityLabel = (label: string): string | null => {
  const trimmedLabel = label.trim()
  if (!trimmedLabel || trimmedLabel === 'Tool use') return null

  for (const [pattern, replacement] of activeCommitActivityLabelReplacements) {
    if (pattern.test(trimmedLabel)) return trimmedLabel.replace(pattern, replacement)
  }

  return trimmedLabel
}

const getActiveCommitToolAction = (tool: ProviderWorkingTool): CommitActivityAction => {
  return getCommitActivityActionFromLabel(tool.label, tool.activity, tool.icon)
}

const getWorkingItemTools = (item: ProviderWorkingItem): ProviderWorkingTool[] => {
  if (item.type === 'tool') return [item]
  if (item.type === 'toolGroup') return item.tools
  return []
}

const planItemStatuses = new Set<ChatPlanItem['status']>(['pending', 'in_progress', 'completed'])

const getToolInputRecord = (rawInput: unknown): Record<string, unknown> | null => {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>
  }
  if (typeof rawInput !== 'string') return null

  const trimmedInput = rawInput.trim()
  const objectStart = trimmedInput.indexOf('{')
  const objectEnd = trimmedInput.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) return null

  try {
    const parsedInput = JSON.parse(trimmedInput.slice(objectStart, objectEnd + 1)) as unknown
    return parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput)
      ? (parsedInput as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const getPlanSignature = (items: ChatPlanItem[]): string => {
  const serializedItems = JSON.stringify(items)
  let hash = 2_166_136_261

  for (let index = 0; index < serializedItems.length; index += 1) {
    hash ^= serializedItems.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }

  return `${items.length}:${(hash >>> 0).toString(36)}`
}

const getPlanFromTool = (tool: ProviderWorkingTool, contextKey: string): ChatPlanData | null => {
  if (tool.toolId !== 'update_plan') return null

  const input = getToolInputRecord(tool.rawInput)
  if (!input || !Array.isArray(input.plan)) return null

  const items = input.plan.flatMap((item): ChatPlanItem[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []

    const candidate = item as Record<string, unknown>
    const step = typeof candidate.step === 'string' ? candidate.step.trim() : ''
    const status = candidate.status
    if (
      !step ||
      typeof status !== 'string' ||
      !planItemStatuses.has(status as ChatPlanItem['status'])
    ) {
      return []
    }

    return [{ step, status: status as ChatPlanItem['status'] }]
  })
  if (items.length === 0) return null

  const explanation =
    typeof input.explanation === 'string' && input.explanation.trim()
      ? input.explanation.trim()
      : null

  return {
    contextKey,
    explanation,
    items,
    signature: getPlanSignature(items)
  }
}

const getLatestChatPlan = (
  items: readonly ProviderChatItem[] | null | undefined,
  contextKey: string | null
): ChatPlanData | null => {
  if (!items || !contextKey) return null

  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex]
    if (item.type !== 'working') continue

    for (
      let workingItemIndex = item.items.length - 1;
      workingItemIndex >= 0;
      workingItemIndex -= 1
    ) {
      const tools = getWorkingItemTools(item.items[workingItemIndex])

      for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
        const plan = getPlanFromTool(tools[toolIndex], contextKey)
        if (plan) return plan
      }
    }
  }

  return null
}

const getCommitActivityCurrentAction = (
  detail: ProviderChatDetail,
  fallbackAction: GitCommitPromptAction
): CommitActivityAction => {
  const workingStep = detail.items.findLast(
    (item): item is ProviderWorkingStep => item.type === 'working' && item.status === 'working'
  )
  const tools = workingStep?.items.flatMap(getWorkingItemTools) ?? []
  const activeTool = tools.findLast((tool) => tool.status === 'running') ?? tools.at(-1)
  if (activeTool) return getActiveCommitToolAction(activeTool)

  const workingMessage = workingStep?.items.findLast(
    (item): item is Extract<ProviderWorkingItem, { type: 'message' }> =>
      item.type === 'message' && item.content.trim().length > 0
  )
  if (workingMessage) {
    return {
      label: workingMessage.content.trim(),
      activity: 'other'
    }
  }

  return {
    label: `Preparing ${commitActionLabels[fallbackAction].toLocaleLowerCase()}`,
    activity: 'other'
  }
}

const getCommitActivityCurrentActionFromSummary = (
  summary: ProviderChatUpdateSummary,
  fallbackAction: GitCommitPromptAction
): CommitActivityAction => {
  if (summary.currentActivity) {
    return getCommitActivityActionFromLabel(
      summary.currentActivity.label,
      summary.currentActivity.activity
    )
  }

  return {
    label: `Preparing ${commitActionLabels[fallbackAction].toLocaleLowerCase()}`,
    activity: 'other'
  }
}

const getDirectCommitActivityAction = (action: GitCommitPromptAction): CommitActivityAction =>
  getCommitActivityActionFromLabel(
    action === 'amend' ? 'Ran git commit --amend' : 'Ran git commit',
    'git'
  )

const isAsciiWhitespaceCode = (code: number): boolean =>
  code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32

const getTrimmedAsciiLength = (text: string): number => {
  let startIndex = 0
  let endIndex = text.length

  while (startIndex < endIndex && isAsciiWhitespaceCode(text.charCodeAt(startIndex))) {
    startIndex += 1
  }
  while (endIndex > startIndex && isAsciiWhitespaceCode(text.charCodeAt(endIndex - 1))) {
    endIndex -= 1
  }

  return endIndex - startIndex
}

const estimateTokenCount = (text: string): number => {
  const normalizedLength = getTrimmedAsciiLength(text)
  if (normalizedLength === 0) return 0

  return Math.max(1, Math.ceil(normalizedLength / 4))
}

const getWorkingItemEstimatedTokens = (item: ProviderWorkingItem): number => {
  if (item.type === 'message') return estimateTokenCount(item.content)
  if (item.type === 'tool') {
    return (
      estimateTokenCount(item.label) +
      estimateTokenCount(item.command ?? '') +
      estimateTokenCount(item.stdout ?? '')
    )
  }
  if (item.type === 'toolGroup') {
    return item.tools.reduce((total, tool) => total + getWorkingItemEstimatedTokens(tool), 0)
  }

  return 0
}

const getChatItemEstimatedTokens = (item: ProviderChatItem): number => {
  if (item.type === 'message') return estimateTokenCount(item.content)
  if (item.type === 'pendingMessage') return estimateTokenCount(item.content)
  if (item.type === 'working') {
    return item.items.reduce(
      (total, workingItem) => total + getWorkingItemEstimatedTokens(workingItem),
      0
    )
  }

  return 0
}

const getEstimatedContextTokens = (
  items: readonly ProviderChatItem[] | null | undefined
): number | null => {
  if (!items) return null

  return items.reduce((total, item) => total + getChatItemEstimatedTokens(item), 0)
}

const mergeAccountUsage = (
  currentUsage: ProviderAccountUsage | null,
  nextUsage: ProviderAccountUsage
): ProviderAccountUsage => {
  if (nextUsage.statisticsLoaded || !currentUsage?.statisticsLoaded) return nextUsage

  return {
    ...nextUsage,
    statisticsLoaded: true,
    summary: currentUsage.summary,
    dailyUsageBuckets: currentUsage.dailyUsageBuckets
  }
}

const sortTreeFiles = <TFile extends TreeFile>(files: TFile[]): TFile[] =>
  [...files].sort((firstFile, secondFile) => firstFile.path.localeCompare(secondFile.path))

const sortChangedFiles = (files: ChangedFile[]): ChangedFile[] => sortTreeFiles(files)

const getPathParts = (path: string): string[] => path.replace(/\\/g, '/').split('/').filter(Boolean)

const normalizeDisplayPath = (path: string, root: string | null): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedRoot = root?.trim().replace(/\\/g, '/').replace(/\/+$/, '')

  if (!normalizedRoot) return normalizedPath
  if (normalizedPath === normalizedRoot) return getLastPathPart(normalizedPath)
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }

  return normalizedPath
}

const getChangedFileDisplayPath = (file: TreeFile): string => file.displayPath ?? file.path

const getChangedFileDisplayPreviousPath = (file: TreeFile): string | null =>
  file.displayPreviousPath ?? file.previousPath ?? null

const getTreeFilesWithDisplayPaths = <TFile extends TreeFile>(
  files: TFile[],
  root: string | null
): DisplayTreeFile<TFile>[] =>
  files.map((file) => ({
    ...file,
    displayPath: normalizeDisplayPath(file.path, root),
    displayPreviousPath: file.previousPath ? normalizeDisplayPath(file.previousPath, root) : null
  }))

const createMutableChangeTreeFolder = <TFile extends TreeFile>(
  name: string,
  path: string,
  childrenPrecomputed = true
): MutableChangeTreeFolder<TFile> => ({
  name,
  path,
  folders: new Map(),
  files: [],
  childrenPrecomputed
})

const finalizeChangeTreeFolder = <TFile extends TreeFile>(
  folder: MutableChangeTreeFolder<TFile>
): ChangeTreeNode<TFile>[] => {
  const folders = Array.from(folder.folders.values())
    .sort((firstFolder, secondFolder) => firstFolder.name.localeCompare(secondFolder.name))
    .map<ChangeTreeFolderNode<TFile>>((childFolder) => ({
      type: 'folder',
      name: childFolder.name,
      path: childFolder.path,
      children: finalizeChangeTreeFolder(childFolder),
      childrenPrecomputed: childFolder.childrenPrecomputed
    }))

  const files = [...folder.files].sort((firstFile, secondFile) =>
    firstFile.name.localeCompare(secondFile.name)
  )

  return [...folders, ...files]
}

const buildChangeTree = <TFile extends TreeFile>(
  files: TFile[],
  shouldPrecomputeFolderChildren?: (folderPath: string) => boolean
): ChangeTreeNode<TFile>[] => {
  const root = createMutableChangeTreeFolder<TFile>('', '')

  for (const file of files) {
    const displayPath = getChangedFileDisplayPath(file)
    const pathPartIterator = displayPath.replace(/\\/g, '/').matchAll(/[^/]+/g)
    let pathPart = pathPartIterator.next()
    let nextPathPart = pathPartIterator.next()
    let folder = root
    let folderPath = ''
    let fileParentPrecomputed = true

    while (!pathPart.done && !nextPathPart.done && fileParentPrecomputed) {
      const folderName = pathPart.value[0]
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      let childFolder = folder.folders.get(folderName)

      if (!childFolder) {
        childFolder = createMutableChangeTreeFolder(
          folderName,
          folderPath,
          shouldPrecomputeFolderChildren?.(folderPath) ?? true
        )
        folder.folders.set(folderName, childFolder)
      }

      folder = childFolder
      fileParentPrecomputed = childFolder.childrenPrecomputed
      pathPart = nextPathPart
      nextPathPart = pathPartIterator.next()
    }

    if (!fileParentPrecomputed) continue

    folder.files.push({
      type: 'file',
      name: pathPart.done ? displayPath : pathPart.value[0],
      file
    })
  }

  return finalizeChangeTreeFolder(root)
}

const getTreeFolderPaths = <TFile extends TreeFile>(nodes: ChangeTreeNode<TFile>[]): string[] =>
  nodes.flatMap((node) =>
    node.type === 'folder' ? [node.path, ...getTreeFolderPaths(node.children)] : []
  )

const getCollapsedTreeFolders = (folderPaths: string[]): Record<string, boolean> =>
  Object.fromEntries(folderPaths.map((folderPath) => [folderPath, true]))

const fileTreePrecomputedLevels = 2

const buildProgressiveFileTree = <TFile extends TreeFile>(
  files: TFile[],
  lastOpenedFolderPath: string | null
): ChangeTreeNode<TFile>[] => {
  const lastOpenedFolderDepth = lastOpenedFolderPath ? getPathParts(lastOpenedFolderPath).length : 0

  return buildChangeTree(files, (folderPath) => {
    const folderDepth = getPathParts(folderPath).length
    if (folderDepth < fileTreePrecomputedLevels) return true
    if (!lastOpenedFolderPath) return false

    if (folderPath === lastOpenedFolderPath || lastOpenedFolderPath.startsWith(`${folderPath}/`)) {
      return true
    }

    return (
      folderPath.startsWith(`${lastOpenedFolderPath}/`) &&
      folderDepth - lastOpenedFolderDepth < fileTreePrecomputedLevels
    )
  })
}

const getDefaultFileTreeCollapsedFolders = (files: RepositoryFile[]): Record<string, boolean> => {
  const folderPaths = getTreeFolderPaths(buildProgressiveFileTree(files, null))

  if (!folderPaths.includes('src')) return {}

  return Object.fromEntries(
    folderPaths.filter((folderPath) => folderPath !== 'src').map((folderPath) => [folderPath, true])
  )
}

const getWorkingItemDiffs = (item: ProviderWorkingItem): ProviderFileDiff[] => {
  if (item.type === 'tool') return item.diffs
  if (item.type === 'toolGroup') return item.tools.flatMap((tool) => tool.diffs)

  return []
}

const getPatchChangeKind = (kind: ProviderFileDiff['kind']): AppGitPatchChange['kind'] => kind

const mergePatchChangeKind = (
  currentKind: AppGitPatchChange['kind'],
  nextKind: AppGitPatchChange['kind']
): AppGitPatchChange['kind'] => {
  if (currentKind === 'create' && nextKind !== 'delete') return 'create'
  return nextKind
}

const getPatchChangedFiles = (workingSteps: ProviderWorkingStep[]): ChangedFile[] => {
  const filesByPath = new Map<string, ChangedFile>()

  for (const workingStep of workingSteps) {
    for (const workingItem of workingStep.items) {
      for (const diff of getWorkingItemDiffs(workingItem)) {
        const patch = {
          path: diff.path,
          kind: getPatchChangeKind(diff.kind),
          diff: diff.diff
        } satisfies AppGitPatchChange
        const existingFile = filesByPath.get(diff.path)
        const existingKind = existingFile?.patches?.at(-1)?.kind

        filesByPath.set(diff.path, {
          path: diff.path,
          kind: existingKind ? mergePatchChangeKind(existingKind, patch.kind) : patch.kind,
          diff: diff.diff,
          patches: [...(existingFile?.patches ?? []), patch]
        })
      }
    }
  }

  return sortChangedFiles(Array.from(filesByPath.values()))
}

const getChatWorkingSteps = (
  items: readonly ProviderChatItem[] | null | undefined
): ProviderWorkingStep[] =>
  items?.filter((item): item is ProviderWorkingStep => item.type === 'working') ?? []

const getLastTurnChangedFiles = (
  items: readonly ProviderChatItem[] | null | undefined
): ChangedFile[] => {
  const lastWorkingStep = getChatWorkingSteps(items).at(-1)
  return lastWorkingStep ? getPatchChangedFiles([lastWorkingStep]) : []
}

const getChatChangedFiles = (
  items: readonly ProviderChatItem[] | null | undefined
): ChangedFile[] => getPatchChangedFiles(getChatWorkingSteps(items))

const getGitChangedFiles = (result: AppGitChangesResult | null): ChangedFile[] =>
  sortChangedFiles(
    result?.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      kind: file.kind,
      status: file.status
    })) ?? []
  )

const getRepositoryFiles = (result: AppFileTreeResult | null): RepositoryFile[] =>
  sortTreeFiles(
    result?.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      kind: file.kind,
      status: file.status
    })) ?? []
  )

const getCommitFiles = (files: ChangedFile[]): string[] =>
  Array.from(
    new Set(
      files.flatMap((file) =>
        [file.previousPath, file.path].filter((path): path is string => Boolean(path))
      )
    )
  )

const getCommitPatches = (files: ChangedFile[]): AppGitPatchChange[] =>
  files.flatMap((file) => file.patches ?? [])

const isPatchChangeSource = (source: ChangeSource): source is PatchChangeSource =>
  source === 'chat' || source === 'lastTurn'

const getPatchChangeKey = (patch: AppGitPatchChange): string =>
  [patch.path, patch.kind, patch.diff].join('\0')

const addStringToHash = (hash: number, value: string): number => {
  let nextHash = hash
  for (let index = 0; index < value.length; index += 1) {
    nextHash ^= value.charCodeAt(index)
    nextHash = Math.imul(nextHash, 16_777_619)
  }

  return nextHash
}

const getPatchFilterSignature = (patches: AppGitPatchChange[]): string => {
  let hash = 2_166_136_261
  let totalLength = 0

  for (const patch of patches) {
    hash = addStringToHash(hash, patch.path)
    hash = addStringToHash(hash, '\0')
    hash = addStringToHash(hash, patch.kind)
    hash = addStringToHash(hash, '\0')
    hash = addStringToHash(hash, patch.diff)
    hash = addStringToHash(hash, '\0\0')
    totalLength += patch.path.length + patch.kind.length + patch.diff.length
  }

  return `${patches.length}:${totalLength}:${(hash >>> 0).toString(36)}`
}

const isPatchFilterScope = (
  scope: PatchFilterScope | null,
  containerKey: string,
  cwd: string | null,
  source: ChangeSource,
  signature: string
): boolean =>
  Boolean(
    scope &&
    cwd &&
    isPatchChangeSource(source) &&
    scope.containerKey === containerKey &&
    scope.cwd === cwd &&
    scope.source === source &&
    scope.signature === signature
  )

const getPatchFileKind = (patches: AppGitPatchChange[]): AppGitPatchChange['kind'] =>
  patches.reduce<AppGitPatchChange['kind']>(
    (kind, patch, index) => (index === 0 ? patch.kind : mergePatchChangeKind(kind, patch.kind)),
    patches[0]?.kind ?? 'edit'
  )

const filterChangedFilesByPatches = (
  files: ChangedFile[],
  patches: AppGitPatchChange[]
): ChangedFile[] => {
  const remainingPatchCounts = new Map<string, number>()

  for (const patch of patches) {
    const key = getPatchChangeKey(patch)
    remainingPatchCounts.set(key, (remainingPatchCounts.get(key) ?? 0) + 1)
  }

  return files.flatMap((file): ChangedFile[] => {
    const filePatches = file.patches ?? []
    const keptPatches = filePatches.filter((patch) => {
      const key = getPatchChangeKey(patch)
      const remainingCount = remainingPatchCounts.get(key) ?? 0
      if (remainingCount <= 0) return false

      remainingPatchCounts.set(key, remainingCount - 1)
      return true
    })

    if (keptPatches.length === 0) return []

    return [
      {
        ...file,
        kind: getPatchFileKind(keptPatches),
        diff: keptPatches.at(-1)?.diff ?? file.diff,
        patches: keptPatches
      }
    ]
  })
}

const formatExtraUserInstructionsForPrompt = (
  instructions: string,
  promptSettings: AppGitCommitPromptSettings
): string | null => {
  const trimmedInstructions = instructions.trim()
  if (!trimmedInstructions) return null

  const prefix = promptSettings.extraInstructionsPrefix.trim()
  return prefix
    ? `${prefix} ${JSON.stringify(trimmedInstructions)}`
    : JSON.stringify(trimmedInstructions)
}

const getScopedChatCommitWorkflowStep = (
  action: GitCommitPromptAction,
  promptSettings: AppGitCommitPromptSettings
): string => (action === 'amend' ? promptSettings.amendStep : promptSettings.commitStep)

const getScopedChatCommitPromptBody = (
  action: GitCommitPromptAction,
  promptSettings: AppGitCommitPromptSettings
): string => {
  const instructions = promptSettings.instructions.trim()
  const workflow = [
    promptSettings.workflow.trim(),
    getScopedChatCommitWorkflowStep(action, promptSettings).trim()
  ]
    .filter(Boolean)
    .join('\n')

  return [instructions, workflow].filter(Boolean).join('\n\n')
}

const getScopedChatCommitPrompt = (
  action: GitCommitPromptAction,
  extraInstructions: string,
  promptSettings: AppGitCommitPromptSettings
): string => {
  return [
    getScopedChatCommitPromptBody(action, promptSettings),
    formatExtraUserInstructionsForPrompt(extraInstructions, promptSettings)
  ]
    .filter((line): line is string => line != null)
    .join('\n')
}

const getCommitMessageGenerationPrompt = (
  diff: string,
  recentCommitMessages: string[],
  aiInstructions: string,
  settings: AppGitCommitMessageGenerationSettings
): string => {
  const instructions = aiInstructions.trim()
  const instructionsPrefix = settings.aiInstructionsPrefix.trim()
  const formattedInstructions = instructions
    ? instructionsPrefix
      ? `${instructionsPrefix} ${JSON.stringify(instructions)}`
      : JSON.stringify(instructions)
    : null
  const recentCommitNames =
    recentCommitMessages.length > 0
      ? recentCommitMessages.map((message) => `- ${message}`).join('\n')
      : '(No recent commits)'

  return [
    settings.prompt.trim(),
    ['Recent commit names:', recentCommitNames].join('\n'),
    ['Git diff:', diff.trim()].join('\n'),
    formattedInstructions
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n')
}

const normalizeGeneratedCommitMessage = (message: string): string => {
  const firstLine = message
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!firstLine) return ''

  return firstLine.replace(/^(["'`])(.+)\1$/, '$2').trim()
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()

  return message || fallback
}

const isGitChangesScope = (
  scope: GitChangesScope | null,
  sourceKey: string,
  cwd: string | null,
  source: GitChangeSource | null
): boolean =>
  Boolean(
    scope &&
    cwd &&
    source &&
    scope.sourceKey === sourceKey &&
    scope.cwd === cwd &&
    scope.source === source
  )

const isFileTreeScope = (
  scope: FileTreeScope | null,
  containerKey: string,
  cwd: string | null
): boolean => Boolean(scope && cwd && scope.containerKey === containerKey && scope.cwd === cwd)

const getChangesEmptyMessage = (
  source: ChangeSource,
  cwd: string | null,
  options: { hasNonReadOnlyTools?: boolean; hasUncommittedChanges?: boolean } = {}
): string => {
  if (source === 'lastTurn') {
    if (options.hasNonReadOnlyTools && options.hasUncommittedChanges) {
      return 'Command changes will be scoped by the chat when committed.'
    }
    return 'No files changed in the last turn.'
  }
  if (source === 'chat') {
    if (options.hasNonReadOnlyTools && options.hasUncommittedChanges) {
      return 'Command changes will be scoped by the chat when committed.'
    }
    return 'No files changed in this chat.'
  }
  if (!cwd) return 'Choose a folder to see changes.'

  return `No ${changeSourceLabels[source].toLocaleLowerCase()} changes.`
}

const getFileTreeEmptyMessage = (cwd: string | null): string =>
  cwd ? 'No files found.' : 'Choose a folder to see files.'

const getApprovalSummary = (
  approval: NonNullable<ProviderChatDetail['pendingApproval']>
): string => {
  if (approval.command) return approval.command
  if (approval.reason) return approval.reason
  if (approval.cwd) return approval.cwd

  return approval.type === 'fileChange'
    ? 'File changes require approval'
    : 'Command requires approval'
}

const getProviderUpdateSummary = (suggestion: ProviderUpdateSuggestion): string =>
  `Update ${providerLabels[suggestion.providerId]} from ${suggestion.currentVersion} to ${
    suggestion.latestVersion
  }`

const isAppActionShortcutTargetBlocked = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], .terminal-panel'
    )
  )
}

export const App: React.FC = () => {
  const storedMessageBoxSelections = useMemo(() => readStoredMessageBoxSelections(), [])
  const storedMessageBoxSelection = storedMessageBoxSelections.codex ?? {}
  const [appSettings, setAppSettings] = useState<AppSettings>(readStoredAppSettings)
  const [projectSettingsByCwd, setProjectSettingsByCwd] = useState<AppProjectSettingsByCwd>(
    readStoredAppProjectSettings
  )
  const [appearanceZoomLevelInputDraft, setAppearanceZoomLevelInputDraft] = useState<{
    key: string
    value: string
  } | null>(null)
  const [appearanceFontSizeInputDraft, setAppearanceFontSizeInputDraft] = useState<{
    key: string
    value: string
  } | null>(null)
  const [installedFontFamilies, setInstalledFontFamilies] = useState<string[]>([])
  const [installedFontsLoaded, setInstalledFontsLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const [settingsScope, setSettingsScope] = useState<SettingsScope>('global')
  const [fileEditorTarget, setFileEditorTarget] = useState<FileEditorTarget | null>(null)
  const [selectedReview, setSelectedReview] = useState<Omit<ProviderReview, 'prompt'> | null>(null)
  const [reviewCommentsDraft, setReviewCommentsDraft] = useState<ProviderReviewComment[]>([])
  const [terminalOpened, setTerminalOpened] = useState(false)
  const [terminalCommandLaunchRequest, setTerminalCommandLaunchRequest] =
    useState<TerminalCommandLaunchRequest | null>(null)
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [chatTurnWindow, setChatTurnWindow] = useState<ChatTurnWindow | null>(null)
  const [chatTurnPageLoadDirection, setChatTurnPageLoadDirection] =
    useState<ChatTurnPageLoadDirection | null>(null)
  const [chatAtConversationBottom, setChatAtConversationBottom] = useState(true)
  const [extractedChatPlan, setExtractedChatPlan] = useState<ChatPlanData | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('ready')
  const [chatLoadRequest, setChatLoadRequest] = useState(0)
  const [committedChatUpdate, setCommittedChatUpdate] = useState<CommittedChatUpdate | null>(null)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null)
  const [messageBoxQuoteRequest, setMessageBoxQuoteRequest] =
    useState<MessageBoxQuoteRequest | null>(null)
  const [approvalModes, setApprovalModes] = useState<ProviderApprovalModeOption[]>(
    fallbackProviderApprovalModes
  )
  const [approvalMode, setApprovalMode] = useState<ProviderApprovalMode>(
    storedMessageBoxSelection.approvalMode ?? fallbackDefaultApprovalMode
  )
  const [sandboxModes, setSandboxModes] = useState<ProviderSandboxModeOption[]>(
    fallbackProviderSandboxModes
  )
  const [sandboxMode, setSandboxMode] = useState<ProviderSandboxMode>(
    storedMessageBoxSelection.sandboxMode ?? fallbackDefaultSandboxMode
  )
  const [models, setModels] = useState<ProviderModel[]>(fallbackProviderModels)
  const [model, setModel] = useState<ProviderModelId>(
    storedMessageBoxSelection.model ?? fallbackInitialModel.id
  )
  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>(
    storedMessageBoxSelection.reasoningEffort ?? fallbackInitialReasoningEffort
  )
  const [serviceTier, setServiceTier] = useState<ProviderServiceTier | null>(
    storedMessageBoxSelection.serviceTier ?? null
  )
  const [approvalResolution, setApprovalResolution] = useState<ApprovalResolutionState>({
    approvalId: null,
    decision: null,
    error: null
  })
  const [userInputResolution, setUserInputResolution] = useState<UserInputResolutionState>({
    requestId: null,
    resolving: false,
    error: null
  })
  const [providerUpdateSuggestion, setProviderUpdateSuggestion] =
    useState<ProviderUpdateSuggestion | null>(null)
  const [providerUpdateState, setProviderUpdateState] = useState<ProviderUpdateState>('idle')
  const [providerUpdateError, setProviderUpdateError] = useState<string | null>(null)
  const [providerUpdatePreferences, setProviderUpdatePreferences] =
    useState<ProviderUpdatePreferences>(readStoredProviderUpdatePreferences)
  const [containerSuggestions, setContainerSuggestions] = useState<AppContainerSuggestion[]>([])
  const [remoteContainerSuggestions, setRemoteContainerSuggestions] = useState<
    AppContainerSuggestion[]
  >([])
  const [remoteContainerSuggestionsLoading, setRemoteContainerSuggestionsLoading] = useState(false)
  const [remoteContainerSuggestionsError, setRemoteContainerSuggestionsError] = useState<
    string | null
  >(null)
  const [sshEnvironments, setSshEnvironments] = useState<AppSshEnvironment[]>([])
  const [sshEnvironmentDialogOpen, setSshEnvironmentDialogOpen] = useState(false)
  const [editingSshEnvironment, setEditingSshEnvironment] = useState<AppSshEnvironment | null>(null)
  const [deletingSshEnvironmentId, setDeletingSshEnvironmentId] = useState<string | null>(null)
  const [sshEnvironmentError, setSshEnvironmentError] = useState<string | null>(null)
  const [storedContainerSelection] = useState<AppContainerTarget | null>(
    readStoredContainerSelection
  )
  const [containerSelectionReady, setContainerSelectionReady] = useState(false)
  const [newSessionContainer, setNewSessionContainer] = useState<AppContainerTarget>(
    () => storedContainerSelection ?? { kind: 'host' }
  )
  const newSessionSshEnvironmentId =
    newSessionContainer.kind === 'container' && newSessionContainer.tool === 'ssh'
      ? newSessionContainer.name
      : null
  const newSessionContainerKey = getContainerTargetKey(newSessionContainer)
  const [newSessionSourceAvailability, setNewSessionSourceAvailability] =
    useState<SourceAvailabilityState | null>(null)
  const [accountUsage, setAccountUsage] = useState<ProviderAccountUsage | null>(null)
  const [accountUsageState, setAccountUsageState] = useState<UsageLoadState>('idle')
  const [accountUsageError, setAccountUsageError] = useState<string | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(true)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const settingsProjectCwd = normalizeAppProjectSettingsCwd(
    selectedChat
      ? (chatDetail?.projectCwd ?? selectedChat.projectCwd ?? chatDetail?.cwd ?? selectedChat.cwd)
      : newSessionCwd
  )
  const settingsProjectOverrides = settingsProjectCwd
    ? projectSettingsByCwd[settingsProjectCwd]
    : undefined
  const effectiveAppSettings = useMemo(
    () => resolveAppSettings(appSettings, settingsProjectOverrides),
    [appSettings, settingsProjectOverrides]
  )
  const settingsViewIsProject = settingsScope === 'project' && Boolean(settingsProjectCwd)
  const settingsPanelSettings = settingsViewIsProject ? effectiveAppSettings : appSettings
  const settingsScopeKey =
    settingsViewIsProject && settingsProjectCwd ? `project:${settingsProjectCwd}` : 'global'
  const installedFontOptions = useMemo<DropdownOption<string>[]>(
    () => installedFontFamilies.map((family) => ({ value: family, label: family })),
    [installedFontFamilies]
  )
  const updateAppearanceZoomLevel = useCallback(
    (value: number): void => {
      const zoomLevel = normalizeAppAppearanceZoomLevel(value)
      const zoomPath = { section: 'appearance', key: 'zoomLevel' } satisfies AppProjectSettingPath

      setAppearanceZoomLevelInputDraft(null)

      if (
        settingsViewIsProject &&
        settingsProjectCwd &&
        isAppProjectSettingOverridden(settingsProjectOverrides, zoomPath)
      ) {
        setProjectSettingsByCwd((currentSettings) => {
          const currentOverrides = currentSettings[settingsProjectCwd] ?? {}
          const nextOverrides = setAppProjectSettingOverrideValue(
            currentOverrides,
            zoomPath,
            zoomLevel
          )
          return setAppProjectSettingsForCwd(currentSettings, settingsProjectCwd, nextOverrides)
        })
        return
      }

      setAppSettings((currentSettings) =>
        currentSettings.appearance.zoomLevel === zoomLevel
          ? currentSettings
          : {
              ...currentSettings,
              appearance: {
                ...currentSettings.appearance,
                zoomLevel
              }
            }
      )
    },
    [settingsProjectCwd, settingsProjectOverrides, settingsViewIsProject]
  )
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null)
  const [newSessionLocation, setNewSessionLocation] = useState<NewSessionLocation>('folder')
  const [worktreeCreationState, setWorktreeCreationState] = useState<WorktreeCreationState>('idle')
  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')
  const newSessionAvailableProviderIds = useMemo(
    () =>
      newSessionSourceAvailability?.containerKey === newSessionContainerKey
        ? newSessionSourceAvailability.availability.providers.flatMap((provider) =>
            provider.available ? [provider.providerId] : []
          )
        : [],
    [newSessionContainerKey, newSessionSourceAvailability]
  )
  const newSessionProviderAvailable = newSessionAvailableProviderIds.includes(newSessionProvider)
  const newSessionSourceAvailabilityReady =
    newSessionSourceAvailability?.containerKey === newSessionContainerKey
  const configProviderId = selectedChat?.providerId ?? newSessionProvider
  const configProviderHasSelectedChat = Boolean(selectedChat)
  const configProviderContainer = selectedChat ? selectedChat.container : newSessionContainer
  const configProviderContainerKey = getContainerTargetKey(configProviderContainer)
  const [projects, setProjects] = useState<AppProject[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [chatSearchMatchCount, setChatSearchMatchCount] = useState(0)
  const [chatSearchActiveIndex, setChatSearchActiveIndex] = useState(0)
  const [chatGroupingPreference, setChatGroupingPreference] = useState<ChatGroupingPreference>(
    readChatGroupingPreference
  )
  const [collapsedCwdGroups, setCollapsedCwdGroups] = useState<Record<string, boolean>>({})
  const [visibleChatPageCountsByGroup, setVisibleChatPageCountsByGroup] = useState<
    Record<string, number>
  >({})
  const [cwdNotesByGroup, setCwdNotesByGroup] = useState<Record<string, ProviderCwdNote[]>>({})
  const [projectIconsByGroup, setProjectIconsByGroup] = useState<
    Record<string, AppProjectIcon | null>
  >({})
  const changeSource = getFixedChangeSource()
  const [changesPaneView, setChangesPaneView] = useState<ChangesPaneView>('git')
  const [gitChanges, setGitChanges] = useState<AppGitChangesResult | null>(null)
  const [gitChangesScope, setGitChangesScope] = useState<GitChangesScope | null>(null)
  const [gitChangeLoadState, setGitChangeLoadState] = useState<LoadState>('ready')
  const [gitChangeLoadScope, setGitChangeLoadScope] = useState<GitChangesScope | null>(null)
  const [gitChangeLoadRequest, setGitChangeLoadRequest] = useState(0)
  const [gitBranches, setGitBranches] = useState<AppGitBranchesResult | null>(null)
  const [gitBranchesScope, setGitBranchesScope] = useState<GitBranchesScope | null>(null)
  const [gitBranchLoadState, setGitBranchLoadState] = useState<LoadState>('ready')
  const [gitBranchLoadRequest, setGitBranchLoadRequest] = useState(0)
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
  const [uncommittedPatchFilter, setUncommittedPatchFilter] =
    useState<UncommittedPatchFilter | null>(null)
  const [uncommittedPatchFilterState, setUncommittedPatchFilterState] = useState<LoadState>('ready')
  const [cachedPatchChangedFiles, setCachedPatchChangedFiles] =
    useState<CachedPatchChangedFiles | null>(null)
  const [fileTree, setFileTree] = useState<AppFileTreeResult | null>(null)
  const [fileTreeScope, setFileTreeScope] = useState<FileTreeScope | null>(null)
  const [fileTreeLoadState, setFileTreeLoadState] = useState<LoadState>('ready')
  const [fileTreeLoadScope, setFileTreeLoadScope] = useState<FileTreeScope | null>(null)
  const [fileTreeLoadRequest, setFileTreeLoadRequest] = useState(0)
  const [collapsedChangeTreeFolders, setCollapsedChangeTreeFolders] = useState<
    Record<string, boolean>
  >({})
  const [collapsedFileTreeFolders, setCollapsedFileTreeFolders] = useState<Record<string, boolean>>(
    {}
  )
  const [lastOpenedFileTreeFolderPath, setLastOpenedFileTreeFolderPath] = useState<string | null>(
    null
  )
  const [commitInput, setCommitInput] = useState('')
  const [commitState, setCommitState] = useState<SendState>('idle')
  const [commitMessageGenerationState, setCommitMessageGenerationState] =
    useState<SendState>('idle')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [scopedCommitActivities, setScopedCommitActivities] = useState<
    Record<string, ScopedCommitActivity>
  >(readStoredScopedCommitActivities)
  const [chatCommitMarkers, setChatCommitMarkers] = useState<Record<string, ChatCommitMarker>>(
    readStoredChatCommitMarkers
  )
  const [continuedStoppedWorkingStepsByChat, setContinuedStoppedWorkingStepsByChat] =
    useState<ContinuedStoppedWorkingStepsByChat>(readStoredContinuedStoppedWorkingSteps)
  const [startingScopedCommitActivity, setStartingScopedCommitActivity] =
    useState<StartingScopedCommitActivity | null>(null)
  const [directCommitActivities, setDirectCommitActivities] = useState<
    Record<string, DirectCommitActivity>
  >({})
  const [cancelingAiCommitKeys, setCancelingAiCommitKeys] = useState<Set<string>>(() => new Set())
  const [syncState, setSyncState] = useState<SendState>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncRecovery, setSyncRecovery] = useState<GitSyncRecoveryState | null>(null)
  const [panePercents, setPanePercents] = useState<ChatPanePercents | null>(
    readStoredChatPanePercents
  )
  const [panelsWidth, setPanelsWidth] = useState(0)
  const [windowState, setWindowState] = useState<AppWindowState>({ isMaximized: false })
  const panelsRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const chatTurnWindowRef = useRef<ChatTurnWindow | null>(chatTurnWindow)
  const chatTurnPageLoadRequestRef = useRef(0)
  const chatTurnPageLoadInFlightRef = useRef(false)
  const chatTurnScrollDirectionRef = useRef<'up' | 'down' | null>(null)
  const previousChatScrollTopRef = useRef<number | null>(null)
  const pendingChatScrollAnchorRef = useRef<ChatScrollAnchor | null>(null)
  const chatViewportAnchorRef = useRef<ChatScrollAnchor | null>(null)
  const chatScrollAdjustmentTargetRef = useRef<{ element: HTMLElement; top: number } | null>(null)
  const scrollToLatestTurnAfterRenderRef = useRef(false)
  const chatDetailRef = useRef<ProviderChatDetail | null>(chatDetail)
  const chatSearchContentRef = useRef<HTMLDivElement>(null)
  const chatSearchInputRef = useRef<HTMLInputElement>(null)
  const chatSearchMatchesRef = useRef<Range[]>([])
  const chatSearchActiveIndexRef = useRef(0)
  const chatSearchReturnFocusRef = useRef<HTMLElement | null>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const changesResizeHandleRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null)
  const sendInFlightRef = useRef(false)
  const runPromptActionRef = useRef<(prompt: string, target: 'current' | 'new') => Promise<void>>(
    async () => {}
  )
  const commitInFlightRef = useRef(false)
  const commitMessageGenerationInFlightRef = useRef(false)
  const gitBranchRequestIdRef = useRef(0)
  const chatAutoScrollEnabledRef = useRef(true)
  const chatAutoScrollFrameRef = useRef<number | null>(null)
  const chatAutoScrollTargetRef = useRef<{ element: HTMLElement; top: number } | null>(null)
  const chatUserScrollIntentRef = useRef(false)
  const chatUserScrollIntentFrameRef = useRef<number | null>(null)
  const selectedChatKeyRef = useRef<string | null>(null)
  const selectedChatUpdatedAtRef = useRef<number | null>(null)
  const recentChatCacheLimitRef = useRef(effectiveAppSettings.chat.recentChatCacheLimit)
  const recentChatCacheRef = useRef(new Map<string, RecentChatCacheEntry>())
  const pinnedOrderMutationRef = useRef(0)
  const changesCwdRef = useRef<string | null>(null)
  const changesContainerRef = useRef<AppContainerTarget | null>(null)
  const changeSourceRef = useRef(changeSource)
  const gitAvailableRef = useRef<boolean | null>(null)
  const selectedChatRef = useRef<ProviderChat | null>(selectedChat)
  const worktreeCreationCanceledRef = useRef(false)
  const worktreeBranchGenerationRef = useRef<{
    generationId: string
    providerId: ProviderId
  } | null>(null)
  const containerSelectionReadyRef = useRef(false)
  const initialChatCommitMarkersRef = useRef(chatCommitMarkers)
  const scopedCommitActivitiesRef =
    useRef<Record<string, ScopedCommitActivity>>(scopedCommitActivities)
  const loadingCwdNotesRef = useRef(new Set<string>())
  const loadingProjectIconsRef = useRef(new Set<string>())
  const messageBoxSelectionsRef = useRef(storedMessageBoxSelections)
  const messageBoxSelectionProviderRef = useRef<ProviderId>('codex')
  const modelManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.model))
  const reasoningManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.reasoningEffort))
  const approvalModeManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.approvalMode))
  const sandboxModeManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.sandboxMode))
  const approvalModeBeforeFullAccessRef = useRef<ProviderApprovalMode | null>(null)
  const collapsedFileTreeFoldersByCwdRef = useRef(new Map<string, Record<string, boolean>>())
  const lastOpenedFileTreeFolderByCwdRef = useRef(new Map<string, string>())
  const lastNonTerminalChangesPaneViewRef = useRef<Exclude<ChangesPaneView, 'terminal'>>('git')

  const scrollChatContentToBottom = useCallback((contentElement: HTMLElement): void => {
    const top = getScrollBottomTop(contentElement)
    contentElement.scrollTop = top
    setChatAtConversationBottom(true)
    chatAutoScrollTargetRef.current = {
      element: contentElement,
      top: contentElement.scrollTop
    }
    const chatKey = selectedChatKeyRef.current
    chatViewportAnchorRef.current = chatKey ? readChatScrollAnchor(contentElement, chatKey) : null
  }, [])

  const scheduleChatAutoScroll = useCallback(
    (contentElement: HTMLElement | null = contentRef.current): void => {
      if (
        !contentElement ||
        !chatAutoScrollEnabledRef.current ||
        chatAutoScrollFrameRef.current !== null
      ) {
        return
      }

      chatAutoScrollTargetRef.current = {
        element: contentElement,
        top: contentElement.scrollTop
      }
      chatAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
        chatAutoScrollFrameRef.current = null
        if (contentRef.current !== contentElement || !chatAutoScrollEnabledRef.current) {
          return
        }

        scrollChatContentToBottom(contentElement)
      })
    },
    [scrollChatContentToBottom]
  )

  const resetChatSearch = useCallback((): void => {
    setChatSearchOpen(false)
    setChatSearchQuery('')
    setChatSearchMatchCount(0)
    setChatSearchActiveIndex(0)
    chatSearchMatchesRef.current = []
    chatSearchActiveIndexRef.current = 0
    chatSearchReturnFocusRef.current = null
    clearChatSearchHighlights()
  }, [])

  const defaultPanePercents = useMemo(() => getDefaultChatPanePercents(panelsWidth), [panelsWidth])
  const preferredPanePercents = panePercents ?? defaultPanePercents
  const displayedPanePercents = useMemo(
    () => clampChatPanePercentsToAvailable(preferredPanePercents, panelsWidth),
    [panelsWidth, preferredPanePercents]
  )

  useEffect(() => {
    selectedChatRef.current = selectedChat
    selectedChatKeyRef.current = selectedChat ? getChatKey(selectedChat) : null
    selectedChatUpdatedAtRef.current = selectedChat?.updatedAt ?? null
  }, [selectedChat])

  useEffect(() => {
    chatDetailRef.current = chatDetail
  }, [chatDetail])

  useEffect(() => {
    chatTurnWindowRef.current = chatTurnWindow
  }, [chatTurnWindow])

  const clearSelectedChatIfUnavailableInSource = useCallback(
    (availableProviderIds: ProviderId[], container: AppContainerTarget | null): void => {
      const currentChat = selectedChatRef.current
      if (
        !currentChat ||
        availableProviderIds.includes(currentChat.providerId) ||
        !areContainerTargetsEqual(currentChat.container, container)
      ) {
        return
      }

      resetChatSearch()
      selectedChatRef.current = null
      selectedChatKeyRef.current = null
      selectedChatUpdatedAtRef.current = null
      chatDetailRef.current = null
      setSelectedChat(null)
      setChatDetail(null)
      setChatLoadState('ready')
      setSendState('idle')
      setEditingMessage(null)
      setNewChatOpen(true)
    },
    [resetChatSearch]
  )

  useEffect(() => {
    const limit = effectiveAppSettings.chat.recentChatCacheLimit
    recentChatCacheLimitRef.current = limit
    if (limit === 0) {
      recentChatCacheRef.current.clear()
      return
    }

    trimRecentChatCache(recentChatCacheRef.current, limit)
  }, [effectiveAppSettings.chat.recentChatCacheLimit])

  useEffect(() => {
    scopedCommitActivitiesRef.current = scopedCommitActivities
    writeStoredScopedCommitActivities(scopedCommitActivities)
  }, [scopedCommitActivities])

  useEffect(() => {
    writeStoredChatCommitMarkers(chatCommitMarkers)
  }, [chatCommitMarkers])

  useEffect(() => {
    writeStoredContinuedStoppedWorkingSteps(continuedStoppedWorkingStepsByChat)
  }, [continuedStoppedWorkingStepsByChat])

  useEffect(() => {
    let active = true
    const restoredActivities = Object.values(scopedCommitActivitiesRef.current)
    const restoredMarkerIds = new Set(restoredActivities.map((activity) => activity.markerId))
    const recoverablePendingMarkers = Object.values(initialChatCommitMarkersRef.current).filter(
      (marker) =>
        marker.status === 'pending' &&
        Boolean(marker.commitChatId) &&
        !restoredMarkerIds.has(marker.id)
    )

    setChatCommitMarkers((currentMarkers) => {
      let changed = false
      const nextMarkers = { ...currentMarkers }

      Object.values(nextMarkers).forEach((marker) => {
        if (
          marker.status !== 'pending' ||
          marker.commitChatId ||
          restoredMarkerIds.has(marker.id)
        ) {
          return
        }

        changed = true
        nextMarkers[marker.id] = {
          ...marker,
          status: 'failed',
          finishedAt: Date.now()
        }
      })

      restoredActivities.forEach((activity) => {
        if (!activity.sourceChatId || nextMarkers[activity.markerId]) return

        changed = true
        nextMarkers[activity.markerId] = {
          id: activity.markerId,
          providerId: activity.providerId,
          sourceChatId: activity.sourceChatId,
          commitChatId: activity.chatId,
          commitAction: activity.commitAction,
          status: 'pending',
          afterItemId: null,
          startedAt: activity.startedAt,
          finishedAt: null
        }
      })

      return changed ? nextMarkers : currentMarkers
    })

    void Promise.all(
      restoredActivities.map(async (activity) => {
        try {
          const detail = await providerApi.getChat(activity.providerId, activity.chatId)
          if (!active) return

          const activityKey = getProviderChatKey(activity.providerId, activity.chatId)
          if (!isActiveChatStatus(detail.status)) {
            setChatCommitMarkers((currentMarkers) => {
              const marker = currentMarkers[activity.markerId]
              if (!marker || marker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...marker,
                  status: getChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    activity.chatId === activity.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                      : marker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
          }

          setScopedCommitActivities((currentActivities) => {
            const currentActivity = currentActivities[activityKey]
            if (!currentActivity) return currentActivities

            if (!isActiveChatStatus(detail.status)) {
              const nextActivities = { ...currentActivities }
              delete nextActivities[activityKey]
              return nextActivities
            }

            return {
              ...currentActivities,
              [activityKey]: {
                ...currentActivity,
                currentAction: getCommitActivityCurrentAction(detail, currentActivity.commitAction)
              }
            }
          })
        } catch {
          // Keep the restored activity if the provider cannot be reached yet.
        }
      })
    )

    void Promise.all(
      recoverablePendingMarkers.map(async (marker) => {
        const commitChatId = marker.commitChatId
        if (!commitChatId) return

        try {
          const detail = await providerApi.getChat(marker.providerId, commitChatId)
          if (!active) return

          if (!isActiveChatStatus(detail.status)) {
            setChatCommitMarkers((currentMarkers) => {
              const currentMarker = currentMarkers[marker.id]
              if (!currentMarker || currentMarker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...currentMarker,
                  status: getChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    commitChatId === marker.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, currentMarker.afterItemId)
                      : currentMarker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
            return
          }

          const activityKey = getProviderChatKey(marker.providerId, commitChatId)
          const activity = {
            source: 'ai',
            providerId: marker.providerId,
            chatId: commitChatId,
            sourceChatId: marker.sourceChatId,
            markerId: marker.id,
            projectCwd: detail.projectCwd ?? detail.cwd,
            commitAction: marker.commitAction,
            currentAction: getCommitActivityCurrentAction(detail, marker.commitAction),
            startedAt: marker.startedAt
          } satisfies ScopedCommitActivity

          setScopedCommitActivities((currentActivities) => {
            const nextActivities = {
              ...currentActivities,
              [activityKey]: activity
            }
            scopedCommitActivitiesRef.current = nextActivities
            return nextActivities
          })
        } catch {
          // Keep the pending marker for a later provider update if recovery is temporarily offline.
        }
      })
    )

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!panePercents) return

    writeStoredChatPanePercents(panePercents)
  }, [panePercents])

  useEffect(() => {
    writeStoredAppSettings(appSettings)
  }, [appSettings])

  useEffect(() => {
    writeStoredAppProjectSettings(projectSettingsByCwd)
  }, [projectSettingsByCwd])

  useEffect(() => {
    setThemePreference(effectiveAppSettings.appearance.theme)
  }, [effectiveAppSettings.appearance.theme])

  useEffect(() => {
    let active = true

    void appApi
      .getInstalledFontFamilies()
      .then((families) => {
        if (active) setInstalledFontFamilies(families)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setInstalledFontsLoaded(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void appApi.setWindowZoomLevel(effectiveAppSettings.appearance.zoomLevel).catch(() => {})
  }, [effectiveAppSettings.appearance.zoomLevel])

  useEffect(() => {
    const handleLinkClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return

      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor) return

      let url: URL
      try {
        url = new URL(anchor.href)
      } catch {
        return
      }
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return

      event.preventDefault()
      const behavior = effectiveAppSettings.links.behavior
      void appApi
        .handleExternalLink({
          url: url.toString(),
          action: behavior === 'manual' ? undefined : behavior
        })
        .then((result) => {
          if (!result?.always || behavior !== 'manual') return

          setAppSettings((currentSettings) => ({
            ...currentSettings,
            links: {
              behavior: result.action
            }
          }))
        })
        .catch(() => {})
    }

    document.addEventListener('click', handleLinkClick)
    return () => document.removeEventListener('click', handleLinkClick)
  }, [effectiveAppSettings.links])

  useLayoutEffect(() => {
    applyShadowPreference(effectiveAppSettings.performance.disableShadows)
  }, [effectiveAppSettings.performance.disableShadows])

  useLayoutEffect(() => {
    applyWindowControlAppearancePreferences(effectiveAppSettings.appearance)
  }, [effectiveAppSettings.appearance])

  useLayoutEffect(() => {
    applyFontAppearancePreferences(effectiveAppSettings.appearance)
  }, [effectiveAppSettings.appearance])

  useEffect(() => {
    if (!settingsOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      setSettingsOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    queueMicrotask(() => settingsCloseButtonRef.current?.focus({ preventScroll: true }))

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  useEffect(
    () => () => {
      if (chatAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(chatAutoScrollFrameRef.current)
      }
      if (chatUserScrollIntentFrameRef.current !== null) {
        window.cancelAnimationFrame(chatUserScrollIntentFrameRef.current)
      }
    },
    []
  )

  useEffect(() => {
    const currentSelection: MessageBoxSelection = {
      approvalMode,
      model,
      reasoningEffort,
      sandboxMode,
      serviceTier
    }
    const previousProviderId = messageBoxSelectionProviderRef.current

    if (previousProviderId !== configProviderId) {
      const nextSelections = {
        ...messageBoxSelectionsRef.current,
        [previousProviderId]: currentSelection
      }
      const nextSelection = nextSelections[configProviderId] ?? {}
      const fallbackModels = getFallbackModels(configProviderId)
      const nextModel =
        fallbackModels.find((candidateModel) => candidateModel.id === nextSelection.model) ??
        getDefaultModel(fallbackModels)

      messageBoxSelectionsRef.current = nextSelections
      messageBoxSelectionProviderRef.current = configProviderId
      modelManuallySelectedRef.current = Boolean(nextSelection.model)
      reasoningManuallySelectedRef.current = Boolean(nextSelection.reasoningEffort)
      approvalModeManuallySelectedRef.current = Boolean(nextSelection.approvalMode)
      sandboxModeManuallySelectedRef.current = Boolean(nextSelection.sandboxMode)
      approvalModeBeforeFullAccessRef.current = null

      setApprovalMode(nextSelection.approvalMode ?? fallbackDefaultApprovalMode)
      setSandboxMode(nextSelection.sandboxMode ?? fallbackDefaultSandboxMode)
      setModel(nextSelection.model ?? nextModel.id)
      setReasoningEffort(nextSelection.reasoningEffort ?? getDefaultReasoningEffort(nextModel))
      setServiceTier(nextSelection.serviceTier ?? null)
      writeStoredMessageBoxSelections(nextSelections)
      return
    }

    const nextSelections = {
      ...messageBoxSelectionsRef.current,
      [configProviderId]: currentSelection
    }
    messageBoxSelectionsRef.current = nextSelections
    writeStoredMessageBoxSelections(nextSelections)
  }, [approvalMode, configProviderId, model, reasoningEffort, sandboxMode, serviceTier])

  useEffect(() => {
    if (sandboxMode !== 'danger-full-access' || approvalMode === 'never') return

    approvalModeBeforeFullAccessRef.current = approvalMode
    queueMicrotask(() => setApprovalMode('never'))
  }, [approvalMode, sandboxMode])

  useEffect(() => {
    let active = true

    appApi
      .getWindowState()
      .then((nextWindowState) => {
        if (active) setWindowState(nextWindowState)
      })
      .catch(() => {})

    const unsubscribe = appApi.onWindowStateUpdated((nextWindowState) => {
      setWindowState(nextWindowState)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    writeStoredProviderUpdatePreferences(providerUpdatePreferences)
  }, [providerUpdatePreferences])

  useEffect(() => {
    if (!containerSelectionReady) return

    writeStoredContainerSelection(newSessionContainer)
  }, [containerSelectionReady, newSessionContainer])

  useEffect(() => {
    let active = true

    Promise.all([
      appApi.getContainerSuggestions().catch(() => [] satisfies AppContainerSuggestion[]),
      appApi.getSshEnvironments()
    ])
      .then(([suggestions, environments]) => {
        if (!active) return

        const currentSuggestion = suggestions.find((suggestion) => suggestion.current)
        const currentSource = currentSuggestion
          ? getContainerTargetFromSuggestion(currentSuggestion)
          : ({ kind: 'host' } satisfies AppContainerTarget)

        setContainerSuggestions(suggestions)
        setSshEnvironments(environments)
        setNewSessionContainer((currentContainer) => {
          if (!containerSelectionReadyRef.current) {
            const initialContainer = storedContainerSelection ?? currentSource
            return isContainerTargetAvailable(initialContainer, suggestions, environments)
              ? initialContainer
              : currentSource
          }

          return isContainerTargetAvailable(currentContainer, suggestions, environments)
            ? currentContainer
            : currentSource
        })
        containerSelectionReadyRef.current = true
        setContainerSelectionReady(true)
      })
      .catch(() => {
        if (!active) return

        setContainerSuggestions([])
        setSshEnvironments([])
        if (!containerSelectionReadyRef.current) {
          setNewSessionContainer(storedContainerSelection ?? { kind: 'host' })
        } else {
          setNewSessionContainer({ kind: 'host' })
        }
        containerSelectionReadyRef.current = true
        setContainerSelectionReady(true)
      })

    return () => {
      active = false
    }
  }, [storedContainerSelection])

  useEffect(() => {
    let active = true
    const environmentId = newSessionSshEnvironmentId

    if (!environmentId) {
      queueMicrotask(() => {
        if (!active) return
        setRemoteContainerSuggestions([])
        setRemoteContainerSuggestionsLoading(false)
        setRemoteContainerSuggestionsError(null)
      })
      return () => {
        active = false
      }
    }

    const remoteEnvironment = {
      kind: 'container',
      tool: 'ssh',
      name: environmentId,
      runtime: { kind: 'host' }
    } satisfies AppContainerTarget

    queueMicrotask(() => {
      if (!active) return
      setRemoteContainerSuggestions([])
      setRemoteContainerSuggestionsLoading(true)
      setRemoteContainerSuggestionsError(null)
    })

    appApi
      .getContainerSuggestions({ container: remoteEnvironment })
      .then((suggestions) => {
        if (!active) return

        setRemoteContainerSuggestions(suggestions)
        setRemoteContainerSuggestionsError(null)
        setNewSessionContainer((currentContainer) => {
          if (
            currentContainer.kind !== 'container' ||
            currentContainer.tool !== 'ssh' ||
            currentContainer.name !== environmentId ||
            currentContainer.runtime?.kind !== 'container'
          ) {
            return currentContainer
          }

          const runtime = currentContainer.runtime
          return suggestions.some(
            (suggestion) => suggestion.tool === runtime.tool && suggestion.name === runtime.name
          )
            ? currentContainer
            : { ...currentContainer, runtime: { kind: 'host' } }
        })
      })
      .catch((error) => {
        if (!active) return
        setRemoteContainerSuggestions([])
        setRemoteContainerSuggestionsError(
          getErrorMessage(error, 'Unable to check containers over SSH.')
        )
      })
      .finally(() => {
        if (active) setRemoteContainerSuggestionsLoading(false)
      })

    return () => {
      active = false
    }
  }, [newSessionSshEnvironmentId])

  useEffect(() => {
    let active = true
    const container = normalizeContainerTarget(newSessionContainer)
    const containerKey = getContainerTargetKey(container)

    queueMicrotask(() => {
      if (!active) return
      setNewSessionSourceAvailability((currentAvailability) =>
        currentAvailability?.containerKey === containerKey ? currentAvailability : null
      )
    })

    appApi
      .getSourceAvailability({ container })
      .then((availability) => {
        if (!active) return

        setNewSessionSourceAvailability({ containerKey, availability })
      })
      .catch(() => {
        if (!active) return

        setNewSessionSourceAvailability({
          containerKey,
          availability: {
            gitAvailable: false,
            providers: providerIds.map((providerId) => ({ providerId, available: false }))
          }
        })
      })

    return () => {
      active = false
    }
  }, [newSessionContainer, newSessionContainerKey])

  useEffect(() => {
    if (newSessionAvailableProviderIds.length === 0 || newSessionProviderAvailable) return

    let active = true
    queueMicrotask(() => {
      if (active) setNewSessionProvider(newSessionAvailableProviderIds[0]!)
    })

    return () => {
      active = false
    }
  }, [newSessionAvailableProviderIds, newSessionProviderAvailable])

  useEffect(() => {
    const queueProviderUpdateClear = (): void => {
      queueMicrotask(() => {
        setProviderUpdateSuggestion(null)
        setProviderUpdateError(null)
      })
    }

    if (selectedChat || !newChatOpen || !newSessionProviderAvailable) {
      queueProviderUpdateClear()
      return undefined
    }

    const providerId = newSessionProvider
    const container = normalizeContainerTarget(newSessionContainer)
    const preference = getProviderUpdatePreference(providerUpdatePreferences, providerId)
    if (preference.neverSuggest) {
      queueProviderUpdateClear()
      return undefined
    }

    let active = true

    queueMicrotask(() => {
      if (!active) return

      setProviderUpdateSuggestion((currentSuggestion) =>
        currentSuggestion?.providerId === providerId ? currentSuggestion : null
      )
      setProviderUpdateError(null)
    })

    providerApi
      .getUpdateAvailability(providerId, { container })
      .then((availability) => {
        if (!active) return

        setProviderUpdateSuggestion(
          availability &&
            shouldSuggestProviderUpdate(providerUpdatePreferences, providerId, availability)
            ? { ...availability, providerId }
            : null
        )
      })
      .catch(() => {
        if (active) setProviderUpdateSuggestion(null)
      })

    return () => {
      active = false
    }
  }, [
    newChatOpen,
    newSessionContainer,
    newSessionProvider,
    newSessionProviderAvailable,
    providerUpdatePreferences,
    selectedChat
  ])

  useEffect(() => {
    const panels = panelsRef.current
    if (!panels) return

    const updatePanelsWidth = (width: number): void => {
      const roundedWidth = Math.round(width)
      setPanelsWidth((currentWidth) =>
        currentWidth === roundedWidth ? currentWidth : roundedWidth
      )
    }

    updatePanelsWidth(panels.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updatePanelsWidth(entry.contentRect.width)
    })
    observer.observe(panels)

    return () => observer.disconnect()
  }, [])

  const handleStartChatResize = useCallback(
    (edge: ChatResizeEdge, event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return

      const panels = panelsRef.current
      if (!panels) return

      event.preventDefault()
      event.currentTarget.blur()

      const startX = event.clientX
      const totalWidth = panels.getBoundingClientRect().width
      if (!totalWidth) return

      const startWidths = getChatPaneWidthsFromPercents(displayedPanePercents, totalWidth)
      const handleWidth = chatResizeHandleWidth * chatResizeHandleCount
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const deltaX = moveEvent.clientX - startX

        setPanePercents(() => {
          if (edge === 'left') {
            const maxSidebarWidth =
              totalWidth - startWidths.changes - handleWidth - chatBlockMinWidth

            const nextWidths = {
              sidebar: Math.round(
                clamp(startWidths.sidebar + deltaX, chatSidebarMinWidth, maxSidebarWidth)
              ),
              changes: startWidths.changes
            }

            return getChatPanePercentsFromWidths(nextWidths, totalWidth)
          }

          const maxChangesWidth = totalWidth - startWidths.sidebar - handleWidth - chatBlockMinWidth

          const nextWidths = {
            sidebar: startWidths.sidebar,
            changes: Math.round(
              clamp(startWidths.changes - deltaX, changesSidebarMinWidth, maxChangesWidth)
            )
          }

          return getChatPanePercentsFromWidths(nextWidths, totalWidth)
        })
      }

      const handlePointerUp = (): void => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [displayedPanePercents]
  )

  useEffect(() => {
    let active = true

    const loadInitialChats = async (): Promise<void> => {
      if (!newSessionSourceAvailabilityReady) return

      const container = normalizeContainerTarget(newSessionContainer)
      if (newSessionAvailableProviderIds.length === 0) {
        setChats([])
        clearSelectedChatIfUnavailableInSource([], container)
        setLoadState('ready')
        return
      }

      const availableProviderIds = new Set(newSessionAvailableProviderIds)
      setChats((currentChats) =>
        currentChats.filter(
          (chat) =>
            availableProviderIds.has(chat.providerId) &&
            areContainerTargetsEqual(chat.container, container)
        )
      )
      clearSelectedChatIfUnavailableInSource(newSessionAvailableProviderIds, container)
      setLoadState('loading')

      let settledProviderCount = 0
      let loadedProviderCount = 0
      const markProviderSettled = (): void => {
        settledProviderCount += 1
        if (
          settledProviderCount === newSessionAvailableProviderIds.length &&
          loadedProviderCount === 0
        ) {
          setLoadState('error')
        }
      }

      newSessionAvailableProviderIds.forEach((providerId) => {
        const loadProviderChats = async (): Promise<void> => {
          let cursor: string | null = null
          let firstPage = true
          const seenCursors = new Set<string>()

          do {
            const page = await providerApi.getChats(providerId, {
              container,
              cursor,
              limit: chatListFetchPageSize
            })
            if (!active) return

            const replaceProviderChats = firstPage
            if (replaceProviderChats) loadedProviderCount += 1
            setChats((currentChats) =>
              mergeChats(
                replaceProviderChats
                  ? currentChats.filter(
                      (chat) =>
                        chat.providerId !== providerId &&
                        availableProviderIds.has(chat.providerId) &&
                        areContainerTargetsEqual(chat.container, container)
                    )
                  : currentChats,
                page.chats
              )
            )
            setLoadState('ready')

            firstPage = false
            cursor = page.nextCursor
            if (cursor && seenCursors.has(cursor)) break
            if (cursor) seenCursors.add(cursor)
          } while (cursor)
        }

        void loadProviderChats()
          .catch(() => {
            // Other providers should still populate the sidebar.
          })
          .finally(() => {
            if (active) markProviderSettled()
          })
      })
    }

    void loadInitialChats()

    return () => {
      active = false
    }
  }, [
    clearSelectedChatIfUnavailableInSource,
    newSessionAvailableProviderIds,
    newSessionContainer,
    newSessionSourceAvailabilityReady
  ])

  useEffect(() => {
    let active = true

    appApi
      .getProjects()
      .then((storedProjects) => {
        if (active) setProjects(mergeProjects(storedProjects))
      })
      .catch(() => {
        if (active) setProjects([])
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    providerApi
      .getApprovalModes(configProviderId)
      .then((nextApprovalModes) => {
        if (!active || nextApprovalModes.length === 0) return

        setApprovalModes(nextApprovalModes)
      })
      .catch(() => {
        if (active) setApprovalModes(fallbackProviderApprovalModes)
      })

    return () => {
      active = false
    }
  }, [configProviderId])

  useEffect(() => {
    if (approvalModes.length === 0) return

    const defaultApprovalMode = getDefaultApprovalMode(approvalModes)

    setApprovalMode((currentApprovalMode) => {
      const currentApprovalModeExists = approvalModes.some(
        (mode) => mode.id === currentApprovalMode
      )

      if (!currentApprovalModeExists) return defaultApprovalMode
      if (
        !approvalModeManuallySelectedRef.current &&
        currentApprovalMode === fallbackDefaultApprovalMode
      ) {
        return defaultApprovalMode
      }

      return currentApprovalMode
    })
  }, [approvalModes])

  useEffect(() => {
    let active = true

    providerApi
      .getSandboxModes(configProviderId)
      .then((nextSandboxModes) => {
        if (!active || nextSandboxModes.length === 0) return

        setSandboxModes(nextSandboxModes)
      })
      .catch(() => {
        if (active) setSandboxModes(fallbackProviderSandboxModes)
      })

    return () => {
      active = false
    }
  }, [configProviderId])

  useEffect(() => {
    if (sandboxModes.length === 0) return

    const defaultSandboxMode = getDefaultSandboxMode(sandboxModes)

    setSandboxMode((currentSandboxMode) => {
      const currentSandboxModeExists = sandboxModes.some((mode) => mode.id === currentSandboxMode)

      if (!currentSandboxModeExists) return defaultSandboxMode
      if (
        !sandboxModeManuallySelectedRef.current &&
        currentSandboxMode === fallbackDefaultSandboxMode
      ) {
        return defaultSandboxMode
      }

      return currentSandboxMode
    })
  }, [sandboxModes])

  useEffect(() => {
    let active = true
    const fallbackModels = getFallbackModels(configProviderId)

    if (
      !configProviderHasSelectedChat &&
      (!newSessionSourceAvailabilityReady ||
        !newSessionProviderAvailable ||
        loadState === 'loading')
    ) {
      queueMicrotask(() => {
        if (active) setModels([])
      })

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(configProviderContainer)
    queueMicrotask(() => {
      if (active) setModels(fallbackModels)
    })

    providerApi
      .getModels(configProviderId, { container })
      .then((nextModels) => {
        if (!active || nextModels.length === 0) return

        setModels(nextModels)
      })
      .catch(() => {
        if (active) setModels(fallbackModels)
      })

    return () => {
      active = false
    }
  }, [
    configProviderContainer,
    configProviderContainerKey,
    configProviderHasSelectedChat,
    configProviderId,
    loadState,
    newSessionProviderAvailable,
    newSessionSourceAvailabilityReady
  ])

  useEffect(() => {
    if (models.length === 0) return

    const defaultModel = getDefaultModel(models)

    setModel((currentModel) => {
      const currentModelExists = models.some((nextModel) => nextModel.id === currentModel)

      if (!currentModelExists) {
        modelManuallySelectedRef.current = false
        return defaultModel.id
      }
      if (!modelManuallySelectedRef.current && currentModel === fallbackInitialModel.id) {
        return defaultModel.id
      }

      return currentModel
    })
  }, [models])

  useEffect(() => {
    const selectedModel = models.find((nextModel) => nextModel.id === model)
    if (!selectedModel) return

    setReasoningEffort((currentReasoningEffort) => {
      if (!modelHasReasoningEffortOptions(selectedModel)) {
        reasoningManuallySelectedRef.current = false
        return getDefaultReasoningEffort(selectedModel)
      }
      if (!reasoningManuallySelectedRef.current) return getDefaultReasoningEffort(selectedModel)
      if (modelSupportsReasoningEffort(selectedModel, currentReasoningEffort)) {
        return currentReasoningEffort
      }

      reasoningManuallySelectedRef.current = false
      return getDefaultReasoningEffort(selectedModel)
    })

    setServiceTier((currentServiceTier) =>
      modelSupportsServiceTier(selectedModel, currentServiceTier)
        ? currentServiceTier
        : (selectedModel.defaultServiceTier ?? null)
    )
  }, [
    effectiveAppSettings.chat.forceModel,
    effectiveAppSettings.chat.forceReasoning,
    effectiveAppSettings.chat.forceSpeed,
    model,
    models
  ])

  const removeRecentChatCacheEntry = useCallback((providerId: ProviderId, chatId: string): void => {
    recentChatCacheRef.current.delete(getProviderChatKey(providerId, chatId))
  }, [])

  const cacheRecentChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      updatedAt: number,
      force = false
    ): void => {
      const cache = recentChatCacheRef.current
      const limit = recentChatCacheLimitRef.current
      const cacheKey = getProviderChatKey(providerId, detail.id)

      if (limit === 0 || detail.done || detail.purpose === 'commit') {
        cache.delete(cacheKey)
        return
      }
      if (!force && selectedChatKeyRef.current !== cacheKey && !cache.has(cacheKey)) return

      cache.delete(cacheKey)
      cache.set(cacheKey, { detail, updatedAt })
      trimRecentChatCache(cache, limit)
    },
    []
  )

  const getRecentCachedChatDetail = useCallback((chat: ProviderChat): ProviderChatDetail | null => {
    if (recentChatCacheLimitRef.current === 0 || chat.done) return null

    const cache = recentChatCacheRef.current
    const cacheKey = getChatKey(chat)
    const entry = cache.get(cacheKey)
    if (!entry) return null

    if (
      entry.detail.done ||
      entry.detail.purpose === 'commit' ||
      entry.updatedAt < chat.updatedAt ||
      entry.detail.status !== chat.status
    ) {
      cache.delete(cacheKey)
      return null
    }

    cache.delete(cacheKey)
    cache.set(cacheKey, entry)
    return entry.detail
  }, [])

  const applyChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      const updatedAt = Date.now()
      const detailKey = getProviderChatKey(providerId, detail.id)
      if (options.select || selectedChatKeyRef.current === detailKey) {
        chatDetailRef.current = detail
        selectedChatUpdatedAtRef.current = options.select
          ? updatedAt
          : Math.max(selectedChatUpdatedAtRef.current ?? 0, updatedAt)
      }
      cacheRecentChatDetail(providerId, detail, updatedAt, options.select)

      if (detail.purpose === 'commit') {
        setChats((currentChats) =>
          currentChats.filter((chat) => chat.providerId !== providerId || chat.id !== detail.id)
        )
        return
      }

      if (options.select) {
        resetChatSearch()
        setChatDetail(detail)
        setChatLoadState('ready')
        setSelectedChat(getChatFromDetail(providerId, detail, null, updatedAt))
        setNewChatOpen(false)
      } else {
        setChatDetail((currentDetail) => (currentDetail?.id === detail.id ? detail : currentDetail))
        setSelectedChat((currentChat) =>
          currentChat?.providerId === providerId && currentChat.id === detail.id
            ? getChatFromDetail(providerId, detail, currentChat, updatedAt)
            : currentChat
        )
      }

      setChats((currentChats) => {
        const existingChat =
          currentChats.find((chat) => chat.providerId === providerId && chat.id === detail.id) ??
          null
        const nextChat = getChatFromDetail(providerId, detail, existingChat, updatedAt)

        return mergeChats(currentChats, [nextChat])
      })
    },
    [cacheRecentChatDetail, resetChatSearch]
  )

  const applyChatSummary = useCallback(
    (providerId: ProviderId, summary: ProviderChatUpdateSummary, turnCompleted: boolean): void => {
      removeRecentChatCacheEntry(providerId, summary.id)

      if (summary.purpose === 'commit') {
        setChats((currentChats) =>
          currentChats.filter((chat) => chat.providerId !== providerId || chat.id !== summary.id)
        )
        return
      }

      const summaryKey = getProviderChatKey(providerId, summary.id)
      if (selectedChatKeyRef.current === summaryKey) {
        selectedChatUpdatedAtRef.current = Math.max(
          selectedChatUpdatedAtRef.current ?? 0,
          summary.updatedAt
        )
      }
      if (selectedChatKeyRef.current === summaryKey && chatDetailRef.current?.id === summary.id) {
        chatDetailRef.current = getChatDetailFromUpdateSummary(chatDetailRef.current, summary)
        setChatDetail((currentDetail) =>
          currentDetail?.id === summary.id
            ? getChatDetailFromUpdateSummary(currentDetail, summary)
            : currentDetail
        )
      }

      setSelectedChat((currentChat) => {
        if (currentChat?.providerId !== providerId || currentChat.id !== summary.id) {
          return currentChat
        }

        const nextChat = getChatFromUpdateSummary(providerId, summary, currentChat, turnCompleted)
        return areChatsEqual(currentChat, nextChat) ? currentChat : nextChat
      })
      setChats((currentChats) => {
        const existingChat =
          currentChats.find((chat) => chat.providerId === providerId && chat.id === summary.id) ??
          null
        const nextChat = getChatFromUpdateSummary(providerId, summary, existingChat, turnCompleted)
        if (existingChat && areChatsEqual(existingChat, nextChat)) return currentChats

        return mergeChats(currentChats, [nextChat])
      })
    },
    [removeRecentChatCacheEntry]
  )

  const showNewChatView = useCallback(
    (projectCwd?: string | null, container?: AppContainerTarget | null): void => {
      resetChatSearch()
      chatDetailRef.current = null
      setSelectedChat(null)
      setChatDetail(null)
      setChatLoadState('ready')
      setSendState('idle')
      setEditingMessage(null)
      setSearchOpen(false)
      setSearchQuery('')
      if (projectCwd !== undefined) setNewSessionCwd(projectCwd)
      if (container !== undefined) {
        const normalizedContainer = normalizeContainerTarget(container)
        setNewSessionContainer(
          isContainerTargetAvailable(normalizedContainer, containerSuggestions, sshEnvironments)
            ? normalizedContainer
            : { kind: 'host' }
        )
      }
      setNewChatOpen(true)
    },
    [containerSuggestions, resetChatSearch, sshEnvironments]
  )

  const applyChatMetadata = useCallback((metadataList: ProviderChatMetadata[]): void => {
    const metadataById = new Map(metadataList.map((metadata) => [metadata.id, metadata]))
    const recentChatCache = recentChatCacheRef.current

    for (const [cacheKey, entry] of recentChatCache) {
      const metadata = metadataById.get(entry.detail.id)
      if (!metadata) continue

      if (metadata.done || metadata.purpose === 'commit') {
        recentChatCache.delete(cacheKey)
        continue
      }

      recentChatCache.set(cacheKey, {
        ...entry,
        detail: mergeChatMetadata(entry.detail, metadata)
      })
    }

    setChats((currentChats) =>
      currentChats.map((chat) => {
        const metadata = metadataById.get(chat.id)
        return metadata ? mergeChatMetadata(chat, metadata) : chat
      })
    )
    setSelectedChat((currentChat) => {
      if (!currentChat) return currentChat

      const metadata = metadataById.get(currentChat.id)
      return metadata ? mergeChatMetadata(currentChat, metadata) : currentChat
    })
    setChatDetail((currentDetail) => {
      if (!currentDetail) return currentDetail

      const metadata = metadataById.get(currentDetail.id)
      return metadata ? mergeChatMetadata(currentDetail, metadata) : currentDetail
    })
  }, [])

  const applySeenUpdatedAt = useCallback(
    (providerId: ProviderId, chatId: string, seenUpdatedAt: number): void => {
      const mergeSeenUpdatedAt = (currentSeenUpdatedAt: number | null): number =>
        currentSeenUpdatedAt == null ? seenUpdatedAt : Math.max(currentSeenUpdatedAt, seenUpdatedAt)
      const cacheKey = getProviderChatKey(providerId, chatId)
      const cacheEntry = recentChatCacheRef.current.get(cacheKey)
      if (cacheEntry) {
        recentChatCacheRef.current.set(cacheKey, {
          ...cacheEntry,
          detail: {
            ...cacheEntry.detail,
            seenUpdatedAt: mergeSeenUpdatedAt(cacheEntry.detail.seenUpdatedAt)
          }
        })
      }

      setChats((currentChats) =>
        currentChats.map((chat) =>
          chat.providerId === providerId && chat.id === chatId
            ? { ...chat, seenUpdatedAt: mergeSeenUpdatedAt(chat.seenUpdatedAt) }
            : chat
        )
      )
      setSelectedChat((currentChat) =>
        currentChat?.providerId === providerId && currentChat.id === chatId
          ? { ...currentChat, seenUpdatedAt: mergeSeenUpdatedAt(currentChat.seenUpdatedAt) }
          : currentChat
      )
      setChatDetail((currentDetail) =>
        currentDetail?.id === chatId
          ? { ...currentDetail, seenUpdatedAt: mergeSeenUpdatedAt(currentDetail.seenUpdatedAt) }
          : currentDetail
      )
    },
    []
  )

  const markChatSeenAt = useCallback(
    (providerId: ProviderId, chatId: string, seenUpdatedAt: number): void => {
      applySeenUpdatedAt(providerId, chatId, seenUpdatedAt)

      void providerApi
        .markChatSeen(providerId, chatId, seenUpdatedAt)
        .then((metadata) => applyChatMetadata([metadata]))
        .catch(() => {
          // Keep the optimistic in-memory seen state if persistence fails.
        })
    },
    [applyChatMetadata, applySeenUpdatedAt]
  )

  const markSelectedChatSeen = useCallback((): void => {
    if (!selectedChat) return

    const cacheEntry = recentChatCacheRef.current.get(getChatKey(selectedChat))
    markChatSeenAt(
      selectedChat.providerId,
      selectedChat.id,
      Math.max(
        Date.now(),
        selectedChat.updatedAt,
        selectedChatUpdatedAtRef.current ?? 0,
        cacheEntry?.updatedAt ?? 0
      )
    )
  }, [markChatSeenAt, selectedChat])

  const applyViewedChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      applyChatDetail(providerId, detail, options)
      markChatSeenAt(providerId, detail.id, Date.now())
    },
    [applyChatDetail, markChatSeenAt]
  )

  useEffect(
    () =>
      providerApi.onChatUpdated((event) => {
        const seenUpdatedAt = Date.now()
        const updatedChatKey = getChatKey({ providerId: event.providerId, id: event.chatId })
        const viewingUpdatedChat = selectedChatKeyRef.current === updatedChatKey
        const selectedDetail =
          viewingUpdatedChat && event.detail
            ? getChatDetailFromUpdate(
                event.detail,
                chatDetailRef.current,
                event.providerId === 'copilot'
              )
            : null

        if (selectedDetail) {
          applyChatDetail(event.providerId, selectedDetail)
          setCommittedChatUpdate({
            sequence: event.sequence,
            detailApplied: true,
            turnCompleted: event.turnCompleted
          })
        } else {
          applyChatSummary(event.providerId, event.summary, event.turnCompleted)
          if (viewingUpdatedChat) {
            chatDetailRef.current = null
            setChatDetail(null)
            setChatLoadState('loading')
            setChatLoadRequest((currentRequest) => currentRequest + 1)
          }
          providerApi.acknowledgeChatUpdate(event.sequence, false)
        }
        if (viewingUpdatedChat && event.turnCompleted) {
          markChatSeenAt(event.providerId, event.chatId, seenUpdatedAt)
        }
        if (
          event.turnCompleted &&
          changesCwdRef.current &&
          event.summary.cwd === changesCwdRef.current
        ) {
          setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
          setGitBranchLoadRequest((currentRequest) => currentRequest + 1)
          setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
        }
        const commitActivity = scopedCommitActivitiesRef.current[updatedChatKey]
        if (commitActivity && !isActiveChatStatus(event.summary.status)) {
          const finishCommitActivity = (detail: ProviderChatDetail): void => {
            setChatCommitMarkers((currentMarkers) => {
              const marker = currentMarkers[commitActivity.markerId]
              if (!marker || marker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...marker,
                  status: getChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    commitActivity.chatId === commitActivity.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                      : marker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
            setScopedCommitActivities((currentActivities) => {
              if (!currentActivities[updatedChatKey]) return currentActivities

              const nextActivities = { ...currentActivities }
              delete nextActivities[updatedChatKey]
              return nextActivities
            })
          }

          if (selectedDetail) {
            finishCommitActivity(selectedDetail)
          } else {
            void providerApi
              .getChat(event.providerId, event.chatId)
              .then(finishCommitActivity)
              .catch(() => {
                // Keep the activity pending so startup recovery can finish it later.
              })
          }
        }
        if (commitActivity && isActiveChatStatus(event.summary.status)) {
          setScopedCommitActivities((currentActivities) => {
            const currentActivity = currentActivities[updatedChatKey]
            if (!currentActivity) return currentActivities

            return {
              ...currentActivities,
              [updatedChatKey]: {
                ...currentActivity,
                currentAction: selectedDetail
                  ? getCommitActivityCurrentAction(selectedDetail, currentActivity.commitAction)
                  : getCommitActivityCurrentActionFromSummary(
                      event.summary,
                      currentActivity.commitAction
                    )
              }
            }
          })
        }
      }),
    [applyChatDetail, applyChatSummary, markChatSeenAt]
  )

  useEffect(() => {
    if (!committedChatUpdate) return
    if (committedChatUpdate.turnCompleted) {
      providerApi.acknowledgeChatUpdate(
        committedChatUpdate.sequence,
        committedChatUpdate.detailApplied
      )
      return
    }

    const timeout = window.setTimeout(() => {
      providerApi.acknowledgeChatUpdate(
        committedChatUpdate.sequence,
        committedChatUpdate.detailApplied
      )
    }, streamingChatUpdateIntervalMs)
    return () => window.clearTimeout(timeout)
  }, [committedChatUpdate])

  const selectedProviderId = selectedChat?.providerId
  const selectedChatId = selectedChat?.id
  const selectedChatKey =
    selectedProviderId && selectedChatId
      ? getChatKey({ providerId: selectedProviderId, id: selectedChatId })
      : null

  useEffect(() => {
    providerApi.setViewedChat(selectedProviderId ?? null, selectedChatId ?? null)
  }, [selectedChatId, selectedProviderId])

  const committingSelectedChatKey =
    selectedProviderId && selectedChatId
      ? getChatKey({ providerId: selectedProviderId, id: selectedChatId })
      : null
  const committingChatActions = useMemo(() => {
    const actions = new Map<string, GitCommitPromptAction>()

    Object.values(scopedCommitActivities).forEach((activity) => {
      if (!activity.sourceChatId) return

      actions.set(
        getChatKey({ providerId: activity.providerId, id: activity.sourceChatId }),
        activity.commitAction
      )
    })
    if (startingScopedCommitActivity) {
      actions.set(
        getChatKey({
          providerId: startingScopedCommitActivity.providerId,
          id: startingScopedCommitActivity.sourceChatId
        }),
        startingScopedCommitActivity.commitAction
      )
    }

    return actions
  }, [scopedCommitActivities, startingScopedCommitActivity])
  const committingChatKeys = useMemo(
    () => new Set(committingChatActions.keys()),
    [committingChatActions]
  )
  const selectedChatAiCommitAction = committingSelectedChatKey
    ? (committingChatActions.get(committingSelectedChatKey) ?? null)
    : null
  const selectedChatCommitMarkers = useMemo(
    () =>
      selectedProviderId && selectedChatId
        ? Object.values(chatCommitMarkers)
            .filter(
              (marker) =>
                marker.providerId === selectedProviderId && marker.sourceChatId === selectedChatId
            )
            .sort((firstMarker, secondMarker) => firstMarker.startedAt - secondMarker.startedAt)
        : [],
    [chatCommitMarkers, selectedChatId, selectedProviderId]
  )
  const scopedCommitActivitiesByMarkerId = useMemo(
    () =>
      new Map(
        Object.values(scopedCommitActivities).map((activity) => [activity.markerId, activity])
      ),
    [scopedCommitActivities]
  )
  const messageBoxPlan =
    extractedChatPlan?.contextKey === selectedChatKey ? extractedChatPlan : null
  useEffect(() => {
    if (
      effectiveAppSettings.chat.hidePlans ||
      !selectedChatKey ||
      !selectedChatId ||
      chatDetail?.id !== selectedChatId
    ) {
      return
    }

    let active = true
    let timeoutId: number | null = null
    const items = chatDetail.items
    const contextKey = selectedChatKey
    const animationFrame = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        if (!active) return

        const nextPlan = getLatestChatPlan(items, contextKey)
        setExtractedChatPlan((currentPlan) =>
          currentPlan?.contextKey === nextPlan?.contextKey &&
          currentPlan?.signature === nextPlan?.signature
            ? currentPlan
            : nextPlan
        )
      }, 0)
    })

    return () => {
      active = false
      window.cancelAnimationFrame(animationFrame)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [
    effectiveAppSettings.chat.hidePlans,
    chatDetail?.id,
    chatDetail?.items,
    selectedChatId,
    selectedChatKey
  ])
  const usageProviderId = selectedProviderId ?? newSessionProvider
  const usageProviderAvailable = selectedChat ? true : newSessionProviderAvailable
  const usageProviderAvailabilityReady = selectedChat ? true : newSessionSourceAvailabilityReady
  const changesCwd = selectedChat ? (chatDetail?.cwd ?? selectedChat.cwd) : newSessionCwd
  const changesProjectCwd = selectedChat
    ? (chatDetail?.projectCwd ?? selectedChat.projectCwd ?? changesCwd)
    : newSessionCwd
  const changesContainer = selectedChat
    ? (chatDetail?.container ?? selectedChat.container)
    : newSessionContainer
  const changesContainerKey = getContainerTargetKey(changesContainer)
  const terminalWorkspaceKey = `${changesContainerKey}\0${changesProjectCwd ?? changesCwd ?? ''}`
  const gitAvailableForCurrentSource =
    gitSourceAvailability?.containerKey === changesContainerKey
      ? gitSourceAvailability.availability.gitAvailable
      : lastGitAvailable
  const gitAvailabilityScopeKey = gitAvailableForCurrentSource === false ? 'missing' : 'available'

  useEffect(() => {
    changesContainerRef.current = changesContainer
  }, [changesContainer])

  useEffect(() => {
    changeSourceRef.current = changeSource
  }, [changeSource])

  useEffect(() => {
    let active = true
    const container = normalizeContainerTarget(changesContainer)
    const containerKey = getContainerTargetKey(container)

    appApi
      .getSourceAvailability({ container })
      .then((availability) => {
        if (!active) return

        setGitSourceAvailability({ containerKey, availability })
        setLastGitAvailable(availability.gitAvailable)
        setGitAvailabilityChangeId((currentChangeId) => {
          const previousAvailable = gitAvailableRef.current
          gitAvailableRef.current = availability.gitAvailable
          return previousAvailable === availability.gitAvailable
            ? currentChangeId
            : currentChangeId + 1
        })
      })
      .catch(() => {
        if (!active) return

        setGitSourceAvailability({
          containerKey,
          availability: {
            gitAvailable: false,
            providers: providerIds.map((providerId) => ({ providerId, available: false }))
          }
        })
        setLastGitAvailable(false)
        setGitAvailabilityChangeId((currentChangeId) => {
          const previousAvailable = gitAvailableRef.current
          gitAvailableRef.current = false
          return previousAvailable === false ? currentChangeId : currentChangeId + 1
        })
      })

    return () => {
      active = false
    }
  }, [changesContainer, changesContainerKey, gitBranchLoadRequest, gitChangeLoadRequest])

  const handleChangesPaneViewChange = useCallback((view: ChangesPaneView): void => {
    if (view === 'terminal') {
      setTerminalOpened(true)
    } else {
      lastNonTerminalChangesPaneViewRef.current = view
    }

    setChangesPaneView(view)
  }, [])

  const handleToggleTerminal = useCallback((): void => {
    handleChangesPaneViewChange(
      changesPaneView === 'terminal' ? lastNonTerminalChangesPaneViewRef.current : 'terminal'
    )
  }, [changesPaneView, handleChangesPaneViewChange])

  const handleRunAction = useCallback(
    async (action: AppAction): Promise<void> => {
      const targetCwd = changesCwd
      const markActionUsed = (): void => {
        setAppSettings((currentSettings) =>
          currentSettings.lastActionId === action.id
            ? currentSettings
            : {
                ...currentSettings,
                lastActionId: action.id
              }
        )
      }

      if (action.type === 'prompt') {
        await runPromptActionRef.current(action.prompt, action.sendInNewChat ? 'new' : 'current')
        markActionUsed()
        return
      }

      if (action.openInTerminal) {
        setTerminalOpened(true)
        setTerminalCommandLaunchRequest({
          id: crypto.randomUUID(),
          command: action.command,
          container: changesContainer,
          cwd: targetCwd,
          projectCwd: changesProjectCwd,
          workspaceKey: terminalWorkspaceKey,
          label: action.name,
          focus: true,
          closeOnFinish: action.closeTerminalOnFinish
        })
        handleChangesPaneViewChange('terminal')
        markActionUsed()
        return
      }

      await terminalApi.runCommand({
        command: action.command,
        container: changesContainer,
        cwd: targetCwd
      })
      markActionUsed()
    },
    [
      changesContainer,
      changesCwd,
      changesProjectCwd,
      handleChangesPaneViewChange,
      terminalWorkspaceKey
    ]
  )

  useEffect(
    () => appApi.onWindowZoomLevelUpdated((level) => updateAppearanceZoomLevel(level)),
    [updateAppearanceZoomLevel]
  )

  useEffect(() => {
    const handleTerminalShortcut = (event: KeyboardEvent): void => {
      if (settingsOpen || fileEditorTarget) return
      if (
        event.code !== 'Backquote' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      handleToggleTerminal()
    }

    document.addEventListener('keydown', handleTerminalShortcut, true)
    return () => document.removeEventListener('keydown', handleTerminalShortcut, true)
  }, [fileEditorTarget, handleToggleTerminal, settingsOpen])

  useEffect(() => {
    const handleActionShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || settingsOpen || fileEditorTarget) return
      if (isAppActionShortcutTargetBlocked(event.target)) return

      const keybinding = getAppActionKeybindingFromEvent(event)
      if (!keybinding) return

      const action = getAppActionsForProject(appSettings.actions, changesProjectCwd).find(
        (candidateAction) => candidateAction.keybinding === keybinding
      )
      if (!action) return

      event.preventDefault()
      event.stopPropagation()
      void handleRunAction(action)
    }

    document.addEventListener('keydown', handleActionShortcut, true)
    return () => document.removeEventListener('keydown', handleActionShortcut, true)
  }, [appSettings.actions, changesProjectCwd, fileEditorTarget, handleRunAction, settingsOpen])
  useEffect(() => {
    changesCwdRef.current = changesCwd
  }, [changesCwd])
  const pendingApproval = chatDetail?.pendingApproval ?? null
  const currentApprovalResolution =
    approvalResolution.approvalId === pendingApproval?.id ? approvalResolution : null
  const approvalDecisionInFlight = currentApprovalResolution?.decision ?? null
  const resolvingApprovalId = approvalResolution.decision ? approvalResolution.approvalId : null
  const approvalError = currentApprovalResolution?.error ?? null
  const pendingUserInput = chatDetail?.pendingUserInput ?? null
  const pendingUserInputId = pendingUserInput?.id ?? null
  const currentUserInputResolution =
    userInputResolution.requestId === pendingUserInput?.id ? userInputResolution : null
  const userInputResolving = currentUserInputResolution?.resolving ?? false
  const userInputError = currentUserInputResolution?.error ?? null

  const refreshAccountUsage = useCallback(
    async (options: ProviderUsageOptions = {}): Promise<void> => {
      if (!usageProviderAvailable) {
        setAccountUsage(null)
        setAccountUsageState(usageProviderAvailabilityReady ? 'ready' : 'loading')
        setAccountUsageError(null)
        return
      }

      const providerId = usageProviderId
      const container = normalizeContainerTarget(changesContainer)
      setAccountUsageState('loading')
      setAccountUsageError(null)

      try {
        const usage = await providerApi.getUsage(providerId, { ...options, container })
        setAccountUsage((currentUsage) => mergeAccountUsage(currentUsage, usage))
        setAccountUsageState('ready')
      } catch (error) {
        setAccountUsageState('error')
        setAccountUsageError(getErrorMessage(error, 'Unable to load usage.'))
      }
    },
    [changesContainer, usageProviderAvailabilityReady, usageProviderAvailable, usageProviderId]
  )

  const resetAccountRateLimits = useCallback(() => {
    if (!usageProviderAvailable) return Promise.resolve('nothingToReset' as const)

    return providerApi.resetRateLimits(usageProviderId, {
      container: normalizeContainerTarget(changesContainer)
    })
  }, [changesContainer, usageProviderAvailable, usageProviderId])

  useEffect(() => {
    let active = true

    if (
      !usageProviderAvailabilityReady ||
      !usageProviderAvailable ||
      (!selectedChat && loadState === 'loading')
    ) {
      queueMicrotask(() => {
        if (!active) return
        setAccountUsage(null)
        setAccountUsageState(
          usageProviderAvailabilityReady && usageProviderAvailable && loadState !== 'loading'
            ? 'ready'
            : 'loading'
        )
        setAccountUsageError(null)
      })

      return () => {
        active = false
      }
    }

    const providerId = usageProviderId
    const container = normalizeContainerTarget(changesContainer)

    queueMicrotask(() => {
      if (!active) return
      setAccountUsageState('loading')
      setAccountUsageError(null)
    })

    providerApi
      .getUsage(providerId, { container })
      .then((usage) => {
        if (!active) return
        setAccountUsage((currentUsage) => mergeAccountUsage(currentUsage, usage))
        setAccountUsageState('ready')
      })
      .catch((error) => {
        if (!active) return
        setAccountUsageState('error')
        setAccountUsageError(getErrorMessage(error, 'Unable to load usage.'))
      })

    return () => {
      active = false
    }
  }, [
    changesContainer,
    loadState,
    selectedChat,
    usageProviderAvailabilityReady,
    usageProviderAvailable,
    usageProviderId
  ])

  useEffect(() => {
    if (!selectedProviderId || !selectedChatId) return
    if (chatDetail?.id === selectedChatId) return

    let active = true

    providerApi
      .getChat(selectedProviderId, selectedChatId)
      .then((detail) => {
        if (!active) return
        chatDetailRef.current = detail
        cacheRecentChatDetail(
          selectedProviderId,
          detail,
          selectedChatUpdatedAtRef.current ?? Date.now(),
          true
        )
        startTransition(() => {
          setChatDetail(detail)
          setChatLoadState('ready')
        })
        markChatSeenAt(selectedProviderId, selectedChatId, Date.now())
      })
      .catch(() => {
        if (active) setChatLoadState('error')
      })

    return () => {
      active = false
    }
  }, [
    cacheRecentChatDetail,
    chatDetail?.id,
    chatLoadRequest,
    markChatSeenAt,
    selectedProviderId,
    selectedChatId
  ])

  useEffect(() => {
    const resizeHandles = [resizeHandleRef.current, changesResizeHandleRef.current].filter(
      (resizeHandle): resizeHandle is HTMLDivElement => Boolean(resizeHandle)
    )
    if (resizeHandles.length === 0) return

    const removeTabStop = (resizeHandle: HTMLDivElement): void => {
      resizeHandle.removeAttribute('tabindex')
      if (document.activeElement === resizeHandle) resizeHandle.blur()
    }

    resizeHandles.forEach(removeTabStop)

    const observers = resizeHandles.map((resizeHandle) => {
      const observer = new MutationObserver(() => removeTabStop(resizeHandle))
      observer.observe(resizeHandle, {
        attributeFilter: ['tabindex'],
        attributes: true
      })

      return observer
    })

    return () => {
      observers.forEach((observer) => observer.disconnect())
    }
  }, [])

  useEffect(() => {
    if (!chatDetail) return

    const contentElement = contentRef.current
    if (!contentElement || !chatAutoScrollEnabledRef.current) return

    if (!isActiveChatStatus(chatDetail.status)) {
      scrollChatContentToBottom(contentElement)
    }
    scheduleChatAutoScroll(contentElement)
  }, [chatDetail, scheduleChatAutoScroll, scrollChatContentToBottom, selectedChatCommitMarkers])

  useEffect(() => {
    if (!pendingUserInputId) return

    const contentElement = contentRef.current
    if (!contentElement) return

    chatAutoScrollEnabledRef.current = true
    chatUserScrollIntentRef.current = false
    chatAutoScrollTargetRef.current = null
    scrollChatContentToBottom(contentElement)
    scheduleChatAutoScroll(contentElement)
  }, [pendingUserInputId, scheduleChatAutoScroll, scrollChatContentToBottom])

  useEffect(() => {
    chatAutoScrollEnabledRef.current = true
    chatAutoScrollTargetRef.current = null
    chatScrollAdjustmentTargetRef.current = null
    pendingChatScrollAnchorRef.current = null
    chatViewportAnchorRef.current = null
    previousChatScrollTopRef.current = null
    scheduleChatAutoScroll()
    resetDocumentScroll()
  }, [scheduleChatAutoScroll, selectedProviderId, selectedChatId])

  useEffect(() => {
    if (!selectedChatKey) return

    const contentElement = contentRef.current
    const contentInnerElement = contentElement?.querySelector<HTMLElement>(
      '.chat-detail__messages-inner'
    )
    if (!contentElement || !contentInnerElement) return

    const observer = new ResizeObserver(() => {
      if (contentRef.current !== contentElement || !contentElement.contains(contentInnerElement)) {
        return
      }

      if (chatAutoScrollEnabledRef.current) {
        scheduleChatAutoScroll(contentElement)
        return
      }

      const anchor = chatViewportAnchorRef.current
      if (pendingChatScrollAnchorRef.current || !anchor || anchor.chatKey !== selectedChatKey) {
        return
      }

      const previousScrollTop = contentElement.scrollTop
      if (!restoreChatScrollAnchor(contentElement, anchor)) return
      if (contentElement.scrollTop !== previousScrollTop) {
        chatScrollAdjustmentTargetRef.current = {
          element: contentElement,
          top: contentElement.scrollTop
        }
      }
      chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, selectedChatKey)
    })
    observer.observe(contentElement)
    observer.observe(contentInnerElement)

    return () => observer.disconnect()
  }, [scheduleChatAutoScroll, selectedChatKey])

  useEffect(() => {
    if (selectedChat) return

    chatAutoScrollEnabledRef.current = true
    chatAutoScrollTargetRef.current = null
    chatScrollAdjustmentTargetRef.current = null
    pendingChatScrollAnchorRef.current = null
    chatViewportAnchorRef.current = null
    previousChatScrollTopRef.current = null
    contentRef.current?.scrollTo({ top: 0 })
    resetDocumentScroll()
  }, [selectedChat])

  useEffect(() => {
    if (!searchOpen) return

    searchInputRef.current?.focus()
  }, [searchOpen])

  const closeChatSearch = useCallback((): void => {
    const returnFocusElement = chatSearchReturnFocusRef.current

    resetChatSearch()

    const contentElement = contentRef.current
    const currentTurnWindow = chatTurnWindowRef.current
    chatAutoScrollEnabledRef.current = contentElement
      ? Boolean(
          isScrolledToBottom(contentElement) &&
          currentTurnWindow &&
          currentTurnWindow.endIndex >= currentTurnWindow.totalCount
        )
      : true
    if (chatAutoScrollEnabledRef.current) {
      scheduleChatAutoScroll(contentElement)
    } else {
      chatAutoScrollTargetRef.current = null
    }

    window.requestAnimationFrame(() => {
      if (returnFocusElement?.isConnected) returnFocusElement.focus({ preventScroll: true })
    })
  }, [resetChatSearch, scheduleChatAutoScroll])

  const openChatSearch = useCallback((): void => {
    if (!selectedChatKey) return

    if (!chatSearchOpen && document.activeElement instanceof HTMLElement) {
      chatSearchReturnFocusRef.current = document.activeElement
    }

    setChatSearchOpen(true)
    window.requestAnimationFrame(() => {
      chatSearchInputRef.current?.focus({ preventScroll: true })
      chatSearchInputRef.current?.select()
    })
  }, [chatSearchOpen, selectedChatKey])

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || settingsOpen || fileEditorTarget) return

      if (
        !event.altKey &&
        !event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === 'f' &&
        selectedChatKey
      ) {
        event.preventDefault()
        if (chatSearchOpen) closeChatSearch()
        else openChatSearch()
        return
      }

      if (event.key === 'Escape' && chatSearchOpen) {
        event.preventDefault()
        closeChatSearch()
      }
    }

    document.addEventListener('keydown', handleSearchShortcut)

    return () => document.removeEventListener('keydown', handleSearchShortcut)
  }, [
    chatSearchOpen,
    closeChatSearch,
    fileEditorTarget,
    openChatSearch,
    selectedChatKey,
    settingsOpen
  ])

  useEffect(() => {
    if (!chatSearchOpen) return

    chatSearchInputRef.current?.focus({ preventScroll: true })
  }, [chatSearchOpen])

  useEffect(() => {
    if (!chatSearchOpen) return

    const searchContent = chatSearchContentRef.current
    if (!searchContent) return

    let searchFrame: number | null = null

    const refreshMatches = (resetActiveMatch: boolean): void => {
      const matches = findChatSearchMatches(searchContent, chatSearchQuery)
      const activeIndex =
        matches.length === 0
          ? 0
          : resetActiveMatch
            ? 0
            : Math.min(chatSearchActiveIndexRef.current, matches.length - 1)

      chatSearchMatchesRef.current = matches
      chatSearchActiveIndexRef.current = activeIndex
      setChatSearchMatchCount(matches.length)
      setChatSearchActiveIndex(activeIndex)
      setChatSearchHighlights(matches, activeIndex)
      chatAutoScrollEnabledRef.current = false
      chatAutoScrollTargetRef.current = null

      if (resetActiveMatch && matches[activeIndex]) {
        scrollChatSearchMatchIntoView(
          matches[activeIndex],
          contentRef.current ?? searchContent,
          'auto'
        )
      }
    }

    refreshMatches(true)

    const observer = new MutationObserver(() => {
      if (searchFrame !== null) window.cancelAnimationFrame(searchFrame)

      searchFrame = window.requestAnimationFrame(() => {
        searchFrame = null
        refreshMatches(false)
      })
    })
    observer.observe(searchContent, { characterData: true, childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (searchFrame !== null) window.cancelAnimationFrame(searchFrame)
      clearChatSearchHighlights()
    }
  }, [chatSearchOpen, chatSearchQuery, selectedChatKey])

  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (!active) return

      setSyncState('idle')
      setSyncError(null)
      setSyncRecovery(null)
      setGitBranchActionState('idle')
      setGitBranchError(null)
      setGitBranchDeleteRetry(null)
      setGitBranchWorktreeDeleteRetry(null)
    })

    return () => {
      active = false
    }
  }, [changesCwd, newChatOpen, selectedChatId, selectedProviderId])

  useEffect(() => {
    let active = true

    appApi
      .getDefaultCwd()
      .then((cwd) => {
        if (active) {
          setDefaultCwd(cwd)
          setNewSessionCwd(cwd)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    const requestId = ++gitBranchRequestIdRef.current

    if (!changesCwd) {
      queueMicrotask(() => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranches(null)
        setGitBranchesScope(null)
        setGitBranchLoadState('ready')
      })

      return () => {
        active = false
      }
    }

    const scope: GitBranchesScope = { sourceKey: gitAvailabilityScopeKey, cwd: changesCwd }

    if (gitAvailableForCurrentSource === false) {
      queueMicrotask(() => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranches(null)
        setGitBranchesScope(scope)
        setGitBranchLoadState('error')
        setGitBranchError('Git is not available in this source.')
      })

      return () => {
        active = false
      }
    }

    queueMicrotask(() => {
      if (!active || gitBranchRequestIdRef.current !== requestId) return
      setGitBranchLoadState('loading')
      setGitBranchError(null)
      setGitBranchDeleteRetry(null)
      setGitBranchWorktreeDeleteRetry(null)
    })

    appApi
      .getGitBranches({ container: changesContainerRef.current, cwd: changesCwd })
      .then((result) => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranches(result)
        setGitBranchesScope(scope)
        setGitBranchLoadState('ready')
      })
      .catch((error) => {
        if (!active || gitBranchRequestIdRef.current !== requestId) return
        setGitBranchLoadState('error')
        setGitBranchError(getErrorMessage(error, 'Unable to load branches.'))
      })

    return () => {
      active = false
    }
  }, [
    changesCwd,
    gitAvailabilityChangeId,
    gitAvailabilityScopeKey,
    gitAvailableForCurrentSource,
    gitBranchLoadRequest
  ])

  useEffect(() => {
    if (!changesCwd) return

    let active = true
    const gitChangeSource: GitChangeSource = 'uncommitted'
    const gitChangeScope: GitChangesScope = {
      sourceKey: gitAvailabilityScopeKey,
      cwd: changesCwd,
      source: gitChangeSource
    }
    const visibleChangeSource = changeSourceRef.current

    if (gitAvailableForCurrentSource === false) {
      queueMicrotask(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        if (visibleChangeSource === 'uncommitted') setGitChangeLoadState('error')
      })

      return () => {
        active = false
      }
    }

    if (visibleChangeSource === 'uncommitted') {
      queueMicrotask(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadState('loading')
      })
    }

    appApi
      .getGitChanges({
        container: changesContainerRef.current,
        cwd: changesCwd,
        source: gitChangeSource
      })
      .then((result) => {
        if (!active) return
        setGitChanges(result)
        setGitChangesScope(gitChangeScope)
        setGitChangeLoadScope(gitChangeScope)
        if (changeSourceRef.current === 'uncommitted') setGitChangeLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        if (changeSourceRef.current === 'uncommitted') setGitChangeLoadState('error')
      })

    return () => {
      active = false
    }
  }, [
    changesCwd,
    gitAvailabilityChangeId,
    gitAvailabilityScopeKey,
    gitAvailableForCurrentSource,
    gitChangeLoadRequest
  ])

  useEffect(() => {
    let active = true

    if (!changesCwd || !isPatchChangeSource(changeSource)) {
      queueMicrotask(() => {
        if (active) setUncommittedPatchFilterState('ready')
      })

      return () => {
        active = false
      }
    }

    const sourceFiles =
      changeSource === 'chat'
        ? getChatChangedFiles(chatDetail?.items)
        : getLastTurnChangedFiles(chatDetail?.items)
    const patches = getCommitPatches(sourceFiles)
    const scope: PatchFilterScope = {
      containerKey: changesContainerKey,
      cwd: changesCwd,
      source: changeSource,
      signature: getPatchFilterSignature(patches)
    }

    if (patches.length === 0) {
      queueMicrotask(() => {
        if (!active) return

        setUncommittedPatchFilter({ scope, patches: [] })
        setUncommittedPatchFilterState('ready')
      })

      return () => {
        active = false
      }
    }

    queueMicrotask(() => {
      if (active) setUncommittedPatchFilterState('loading')
    })

    appApi
      .getUncommittedGitPatchChanges({ container: changesContainer, cwd: changesCwd, patches })
      .then((result) => {
        if (!active) return

        setUncommittedPatchFilter({ scope, patches: result.patches })
        setUncommittedPatchFilterState('ready')
      })
      .catch(() => {
        if (active) setUncommittedPatchFilterState('error')
      })

    return () => {
      active = false
    }
  }, [
    changeSource,
    changesContainer,
    changesContainerKey,
    changesCwd,
    chatDetail?.items,
    gitChangeLoadRequest
  ])

  useEffect(() => {
    if (changesPaneView !== 'files' || !changesCwd) return

    let active = true
    const nextFileTreeScope: FileTreeScope = { containerKey: changesContainerKey, cwd: changesCwd }

    queueMicrotask(() => {
      if (!active) return
      setFileTreeLoadScope(nextFileTreeScope)
      setFileTreeLoadState('loading')
    })

    appApi
      .getFileTree({ container: changesContainer, cwd: changesCwd })
      .then((result) => {
        if (!active) return
        setFileTree(result)
        setFileTreeScope(nextFileTreeScope)
        setFileTreeLoadScope(nextFileTreeScope)
        setFileTreeLoadState('ready')
        setLastOpenedFileTreeFolderPath(
          lastOpenedFileTreeFolderByCwdRef.current.get(nextFileTreeScope.cwd) ?? null
        )
        const rememberedCollapsedFolders = collapsedFileTreeFoldersByCwdRef.current.get(
          nextFileTreeScope.cwd
        )
        const nextCollapsedFolders =
          rememberedCollapsedFolders ??
          getDefaultFileTreeCollapsedFolders(getRepositoryFiles(result))

        setCollapsedFileTreeFolders(nextCollapsedFolders)
        collapsedFileTreeFoldersByCwdRef.current.set(nextFileTreeScope.cwd, nextCollapsedFolders)
      })
      .catch(() => {
        if (!active) return
        setFileTreeLoadScope(nextFileTreeScope)
        setFileTreeLoadState('error')
      })

    return () => {
      active = false
    }
  }, [changesContainer, changesContainerKey, changesCwd, changesPaneView, fileTreeLoadRequest])

  const searchTerms = searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const filteredChats =
    searchTerms.length === 0
      ? chats
      : chats.filter((chat) => {
          const title = chat.title.toLocaleLowerCase()
          const cwd = chat.cwd?.toLocaleLowerCase() ?? ''
          const cwdLabel = getChatCwdLabel(chat.cwd).toLocaleLowerCase()
          return searchTerms.every(
            (term) => title.includes(term) || cwd.includes(term) || cwdLabel.includes(term)
          )
        })
  const chatGroups = groupChatsForSidebar(filteredChats)
  const pinnedChatGroup = chatGroups.find((group) => group.kind === 'pinned') ?? null
  const activeChatGroups = chatGroups.filter((group) => group.kind === 'cwd')
  const displayedActiveChatGroups =
    chatGroupingPreference === 'grouped' || activeChatGroups.length === 0
      ? activeChatGroups
      : [
          {
            key: activeGroupKey,
            cwd: null,
            label: 'Active',
            chats: sortChatsForGroup(activeChatGroups.flatMap((group) => group.chats)),
            kind: 'active' as const
          }
        ]
  const doneChatGroup = chatGroups.find((group) => group.kind === 'done') ?? null
  const messageBoxNotesCwd = selectedChat ? changesProjectCwd : newSessionCwd
  const messageBoxNotesVisible = Boolean(selectedChat) || newChatOpen
  const messageBoxNotesGroup = useMemo(
    () =>
      messageBoxNotesVisible
        ? {
            key: getChatCwdGroupKey(messageBoxNotesCwd),
            cwd: messageBoxNotesCwd,
            label: getChatCwdLabel(messageBoxNotesCwd)
          }
        : null,
    [messageBoxNotesCwd, messageBoxNotesVisible]
  )

  useEffect(() => {
    const notesGroups = new Map(
      activeChatGroups.map((group) => [group.key, { key: group.key, cwd: group.cwd }])
    )
    if (messageBoxNotesGroup) {
      notesGroups.set(messageBoxNotesGroup.key, {
        key: messageBoxNotesGroup.key,
        cwd: messageBoxNotesGroup.cwd
      })
    }
    const groupsToLoad = Array.from(notesGroups.values()).filter(
      (group) => !(group.key in cwdNotesByGroup) && !loadingCwdNotesRef.current.has(group.key)
    )
    if (groupsToLoad.length === 0) return

    groupsToLoad.forEach((group) => loadingCwdNotesRef.current.add(group.key))

    void Promise.all(
      groupsToLoad.map((group) =>
        providerApi
          .getCwdNotes('codex', group.cwd)
          .then((notes) => ({ key: group.key, notes }))
          .catch(() => ({ key: group.key, notes: [] }))
      )
    ).then((groupNotes) => {
      groupNotes.forEach(({ key }) => loadingCwdNotesRef.current.delete(key))

      setCwdNotesByGroup((currentNotes) => {
        const nextNotes = { ...currentNotes }
        groupNotes.forEach(({ key, notes }) => {
          nextNotes[key] = notes
        })
        return nextNotes
      })
    })
  }, [activeChatGroups, cwdNotesByGroup, messageBoxNotesGroup])

  useEffect(() => {
    const entriesByKey = new Map<string, { key: string; cwd: string | null }>()
    const addProjectIconEntry = (cwd: string | null): void => {
      const key = getChatCwdGroupKey(cwd)
      if (!entriesByKey.has(key)) entriesByKey.set(key, { key, cwd })
    }

    activeChatGroups.forEach((group) => addProjectIconEntry(group.cwd))
    projects.forEach((project) => addProjectIconEntry(project.cwd))
    addProjectIconEntry(newSessionCwd)

    const projectIconEntries = Array.from(entriesByKey.values())
    const iconsToLoad = projectIconEntries.filter(
      (entry) =>
        !(entry.key in projectIconsByGroup) && !loadingProjectIconsRef.current.has(entry.key)
    )
    if (iconsToLoad.length === 0) return

    iconsToLoad.forEach((entry) => loadingProjectIconsRef.current.add(entry.key))

    void Promise.all(
      iconsToLoad.map((entry) =>
        appApi
          .getProjectIcon({ cwd: entry.cwd })
          .then((icon) => ({ key: entry.key, icon }))
          .catch(() => ({ key: entry.key, icon: null }))
      )
    ).then((groupIcons) => {
      groupIcons.forEach(({ key }) => loadingProjectIconsRef.current.delete(key))

      setProjectIconsByGroup((currentIcons) => {
        const nextIcons = { ...currentIcons }
        groupIcons.forEach(({ key, icon }) => {
          nextIcons[key] = icon
        })
        return nextIcons
      })
    })
  }, [activeChatGroups, newSessionCwd, projects, projectIconsByGroup])

  const projectOptions = useMemo<DropdownOption<string>[]>(() => {
    const projectsByCwd = new Map<string, { cwd: string; updatedAt: number }>()

    const addProject = (cwd: string | null, updatedAt: number): void => {
      const normalizedCwd = cwd?.trim()
      if (!normalizedCwd) return

      const existingProject = projectsByCwd.get(normalizedCwd)
      if (!existingProject || updatedAt > existingProject.updatedAt) {
        projectsByCwd.set(normalizedCwd, { cwd: normalizedCwd, updatedAt })
      }
    }

    projects.forEach((project) => addProject(project.cwd, project.updatedAt))
    addProject(newSessionCwd, Number.MAX_SAFE_INTEGER)

    const getProjectOptionIcon = (cwd: string | null): React.ReactElement => {
      const projectIcon = projectIconsByGroup[getChatCwdGroupKey(cwd)]

      return projectIcon?.dataUrl ? (
        <img src={projectIcon.dataUrl} alt="" />
      ) : (
        <FolderKanban aria-hidden="true" />
      )
    }

    const options = Array.from(projectsByCwd.values())
      .sort((firstProject, secondProject) => {
        if (secondProject.updatedAt !== firstProject.updatedAt) {
          return secondProject.updatedAt - firstProject.updatedAt
        }

        return getFolderName(firstProject.cwd).localeCompare(getFolderName(secondProject.cwd))
      })
      .map((project) => ({
        value: project.cwd,
        label: getFolderName(project.cwd),
        menuLabel: getFolderName(project.cwd),
        description: getFolderDescription(project.cwd),
        icon: getProjectOptionIcon(project.cwd)
      }))

    if (!newSessionCwd) {
      return [
        {
          value: newSessionProjectPlaceholderValue,
          label: 'Choose folder',
          icon: getProjectOptionIcon(null),
          disabled: true
        },
        ...options
      ]
    }

    return options
  }, [newSessionCwd, projects, projectIconsByGroup])
  const newSessionProjectValue = newSessionCwd ?? newSessionProjectPlaceholderValue
  const handleDeleteSshEnvironment = useCallback(
    async (environment: AppSshEnvironment): Promise<void> => {
      if (deletingSshEnvironmentId) return

      setDeletingSshEnvironmentId(environment.id)
      setSshEnvironmentError(null)
      try {
        await appApi.deleteSshEnvironment({ id: environment.id })
        setSshEnvironments((currentEnvironments) =>
          currentEnvironments.filter(
            (currentEnvironment) => currentEnvironment.id !== environment.id
          )
        )
        setNewSessionContainer((currentContainer) =>
          currentContainer.kind === 'container' &&
          currentContainer.tool === 'ssh' &&
          currentContainer.name === environment.id
            ? { kind: 'host' }
            : currentContainer
        )
      } catch (error) {
        setSshEnvironmentError(getErrorMessage(error, 'Unable to remove environment.'))
      } finally {
        setDeletingSshEnvironmentId(null)
      }
    },
    [deletingSshEnvironmentId]
  )
  const containerOptions = useMemo<DropdownOption<string>[]>(
    () => [
      {
        value: hostContainerValue,
        label: 'Host',
        icon: <Monitor aria-hidden="true" />
      },
      ...sshEnvironments.map((environment) => ({
        value: `ssh:${environment.id}`,
        label: environment.name,
        menuLabel: environment.name,
        description: `${environment.user ? `${environment.user}@` : ''}${environment.host}:${environment.port}`,
        icon: <Server aria-hidden="true" />,
        inlineActions: [
          {
            id: `edit-${environment.id}`,
            ariaLabel: `Edit ${environment.name}`,
            title: `Edit ${environment.name}`,
            icon: <Pencil aria-hidden="true" />,
            callback: () => {
              setEditingSshEnvironment(environment)
              setSshEnvironmentError(null)
              setSshEnvironmentDialogOpen(true)
            }
          },
          {
            id: `remove-${environment.id}`,
            ariaLabel: `Remove ${environment.name}`,
            title: `Remove ${environment.name}`,
            disabled: Boolean(deletingSshEnvironmentId),
            icon: <X aria-hidden="true" />,
            callback: () => handleDeleteSshEnvironment(environment)
          }
        ]
      })),
      ...containerSuggestions.map((container) => ({
        value: container.id,
        label: container.name,
        menuLabel: `${container.name} · ${getContainerSuggestionState(container)}`,
        icon: getContainerToolIcon(container.tool)
      }))
    ],
    [containerSuggestions, deletingSshEnvironmentId, handleDeleteSshEnvironment, sshEnvironments]
  )
  const newSessionRemoteRuntime = useMemo<AppLocalContainerTarget | null>(
    () =>
      newSessionContainer.kind === 'container' && newSessionContainer.tool === 'ssh'
        ? (newSessionContainer.runtime ?? { kind: 'host' })
        : null,
    [newSessionContainer]
  )
  const remoteRuntimeOptions = useMemo<DropdownOption<string>[]>(() => {
    const suggestions = [...remoteContainerSuggestions]
    if (
      newSessionRemoteRuntime?.kind === 'container' &&
      !suggestions.some(
        (suggestion) =>
          suggestion.tool === newSessionRemoteRuntime.tool &&
          suggestion.name === newSessionRemoteRuntime.name
      )
    ) {
      suggestions.unshift({
        id: `${newSessionRemoteRuntime.tool}:${newSessionRemoteRuntime.name}`,
        tool: newSessionRemoteRuntime.tool,
        name: newSessionRemoteRuntime.name,
        label: newSessionRemoteRuntime.name,
        description: null,
        status: null
      })
    }

    return [
      {
        value: hostContainerValue,
        label: 'Host',
        icon: <Monitor aria-hidden="true" />
      },
      ...suggestions.map((container) => ({
        value: container.id,
        label: container.name,
        menuLabel: `${container.name} · ${getContainerSuggestionState(container)}`,
        icon: getContainerToolIcon(container.tool)
      }))
    ]
  }, [newSessionRemoteRuntime, remoteContainerSuggestions])
  const newSessionProviderOptions = useMemo<DropdownOption<ProviderId>[]>(
    () =>
      providerOptions.filter((option) =>
        newSessionAvailableProviderIds.includes(option.value as ProviderId)
      ),
    [newSessionAvailableProviderIds]
  )
  const newSessionProviderValueContent = !newSessionSourceAvailabilityReady
    ? 'Checking'
    : newSessionProviderOptions.length === 0
      ? 'No providers found'
      : undefined
  const newSessionContainerValue = getContainerSelectionValue(newSessionContainer)
  const handleNewSessionContainerChange = (value: string): void => {
    if (value === hostContainerValue) {
      setNewSessionContainer({ kind: 'host' })
      return
    }

    const environment = sshEnvironments.find(
      (candidateEnvironment) => `ssh:${candidateEnvironment.id}` === value
    )
    if (environment) {
      setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: environment.id,
        runtime: { kind: 'host' }
      })
      return
    }

    const suggestion = containerSuggestions.find((container) => container.id === value)
    if (suggestion) setNewSessionContainer(getContainerTargetFromSuggestion(suggestion))
  }
  const handleNewSessionRemoteRuntimeChange = (value: string): void => {
    if (!newSessionSshEnvironmentId) return
    if (value === hostContainerValue) {
      setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: newSessionSshEnvironmentId,
        runtime: { kind: 'host' }
      })
      return
    }

    const suggestion = remoteContainerSuggestions.find((container) => container.id === value)
    if (!suggestion) return
    setNewSessionContainer({
      kind: 'container',
      tool: 'ssh',
      name: newSessionSshEnvironmentId,
      runtime: getContainerTargetFromSuggestion(suggestion)
    })
  }
  const handleSaveSshEnvironment = async (
    options: AppCreateSshEnvironmentOptions
  ): Promise<void> => {
    const environment = editingSshEnvironment
      ? await appApi.updateSshEnvironment({ id: editingSshEnvironment.id, ...options })
      : await appApi.createSshEnvironment(options)
    setSshEnvironments((currentEnvironments) => [
      environment,
      ...currentEnvironments.filter(
        (currentEnvironment) => currentEnvironment.id !== environment.id
      )
    ])
    setSshEnvironmentError(null)
    if (!editingSshEnvironment) {
      setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: environment.id,
        runtime: { kind: 'host' }
      })
    }
  }
  const savedGitCommitModel = settingsPanelSettings.git.commitModel
  const savedGitCommitModelOption = savedGitCommitModel
    ? models.find((candidateModel) => candidateModel.id === savedGitCommitModel)
    : undefined
  const modelLabelsById = useMemo(
    () =>
      new Map<ProviderModelId, string>(
        models.map((candidateModel) => [candidateModel.id, formatModelLabel(candidateModel.label)])
      ),
    [models]
  )
  const fallbackGitCommitModel = getDefaultModel(models)
  const gitCommitModelValue = savedGitCommitModel
    ? (savedGitCommitModelOption ?? fallbackGitCommitModel).id
    : gitCurrentChatModelValue
  const gitCommitModelOptions = useMemo<DropdownOption<string>[]>(() => {
    const modelOptions = models.map((candidateModel): DropdownOption<string> => ({
      value: candidateModel.id,
      label: formatModelLabel(candidateModel.label),
      menuLabel: candidateModel.isDefault
        ? `${formatModelLabel(candidateModel.label)} (default)`
        : formatModelLabel(candidateModel.label),
      description: candidateModel.description || undefined,
      icon: <Bot aria-hidden="true" />
    }))

    return [
      {
        value: gitCurrentChatModelValue,
        label: 'Selected model',
        description: 'Use the model selected in the chat at the moment you commit.',
        icon: <MessageSquare aria-hidden="true" />
      },
      ...modelOptions
    ]
  }, [models])
  const effectiveSandboxMode =
    effectiveAppSettings.chat.forceAccess === appChatManualDropdownValue
      ? sandboxMode
      : effectiveAppSettings.chat.forceAccess
  const configuredApprovalMode =
    effectiveAppSettings.chat.forceReview === appChatManualDropdownValue
      ? approvalMode
      : effectiveAppSettings.chat.forceReview
  const effectiveApprovalMode =
    effectiveSandboxMode === 'danger-full-access' ? 'never' : configuredApprovalMode
  const configuredModel =
    effectiveAppSettings.chat.forceModel === appChatManualDropdownValue
      ? model
      : effectiveAppSettings.chat.forceModel
  const effectiveModel = models.some((candidateModel) => candidateModel.id === configuredModel)
    ? configuredModel
    : getDefaultModel(models).id
  const selectedEffectiveModel = models.find(
    (candidateModel) => candidateModel.id === effectiveModel
  )
  const configuredServiceTier =
    effectiveAppSettings.chat.forceSpeed === appChatManualDropdownValue
      ? serviceTier
      : effectiveAppSettings.chat.forceSpeed === appChatStandardSpeedValue
        ? null
        : effectiveAppSettings.chat.forceSpeed
  const effectiveServiceTier = modelSupportsServiceTier(
    selectedEffectiveModel,
    configuredServiceTier
  )
    ? configuredServiceTier
    : (selectedEffectiveModel?.defaultServiceTier ?? null)
  const configuredReasoningEffort =
    effectiveAppSettings.chat.forceReasoning === appChatManualDropdownValue
      ? reasoningEffort
      : effectiveAppSettings.chat.forceReasoning
  const effectiveReasoningEffort = modelSupportsReasoningEffort(
    selectedEffectiveModel,
    configuredReasoningEffort
  )
    ? configuredReasoningEffort
    : getDefaultReasoningEffort(selectedEffectiveModel)
  const hasForcedChatDropdown =
    effectiveAppSettings.chat.forceAccess !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceReview !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceModel !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceReasoning !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceSpeed !== appChatManualDropdownValue
  const settingsConfiguredModel =
    settingsPanelSettings.chat.forceModel === appChatManualDropdownValue
      ? model
      : settingsPanelSettings.chat.forceModel
  const settingsEffectiveModel = models.some(
    (candidateModel) => candidateModel.id === settingsConfiguredModel
  )
    ? settingsConfiguredModel
    : getDefaultModel(models).id
  const settingsSelectedEffectiveModel = models.find(
    (candidateModel) => candidateModel.id === settingsEffectiveModel
  )
  useEffect(() => {
    if (models.length === 0) return

    let active = true
    queueMicrotask(() => {
      if (!active) return

      setAppSettings((currentSettings) => {
        const currentChatSettings = currentSettings.chat
        let forceModel = currentChatSettings.forceModel
        let forceReasoning = currentChatSettings.forceReasoning
        let forceSpeed = currentChatSettings.forceSpeed

        if (
          forceModel !== appChatManualDropdownValue &&
          !models.some((candidateModel) => candidateModel.id === forceModel)
        ) {
          forceModel = appChatManualDropdownValue
        }

        const configuredForcedModel = forceModel === appChatManualDropdownValue ? model : forceModel
        const configuredForcedProviderModel =
          models.find((candidateModel) => candidateModel.id === configuredForcedModel) ??
          getDefaultModel(models)

        if (
          forceReasoning !== appChatManualDropdownValue &&
          !modelSupportsReasoningEffort(configuredForcedProviderModel, forceReasoning)
        ) {
          forceReasoning = appChatManualDropdownValue
        }

        if (forceSpeed !== appChatManualDropdownValue) {
          const configuredForcedServiceTier =
            forceSpeed === appChatStandardSpeedValue ? null : forceSpeed
          if (
            !modelHasServiceTierOptions(configuredForcedProviderModel) ||
            !modelSupportsServiceTier(configuredForcedProviderModel, configuredForcedServiceTier)
          ) {
            forceSpeed = appChatManualDropdownValue
          }
        }

        if (
          forceModel === currentChatSettings.forceModel &&
          forceReasoning === currentChatSettings.forceReasoning &&
          forceSpeed === currentChatSettings.forceSpeed
        ) {
          return currentSettings
        }

        return {
          ...currentSettings,
          chat: {
            ...currentChatSettings,
            forceModel,
            forceReasoning,
            forceSpeed
          }
        }
      })
    })

    return () => {
      active = false
    }
  }, [model, models])
  const forceAccessOptions: DropdownOption<AppChatDropdownSettings['forceAccess']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the access selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...sandboxModes.map((mode) => ({
      value: mode.id,
      label: mode.label,
      description: mode.description || undefined,
      icon: chatSandboxModeIcons[mode.id]
    }))
  ]
  const forceReviewOptions: DropdownOption<AppChatDropdownSettings['forceReview']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the review mode selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...approvalModes.map((mode) => ({
      value: mode.id,
      label: mode.label,
      description: mode.description || undefined,
      icon: chatApprovalModeIcons[mode.id]
    }))
  ]
  const forceModelOptions: DropdownOption<AppChatDropdownSettings['forceModel']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the model selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...models.map((candidateModel) => ({
      value: candidateModel.id,
      label: formatModelLabel(candidateModel.label),
      description: candidateModel.description || undefined,
      icon: <Bot aria-hidden="true" />
    }))
  ]
  const forceReasoningOptions: DropdownOption<AppChatDropdownSettings['forceReasoning']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the reasoning effort selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...(settingsSelectedEffectiveModel?.supportedReasoningEfforts ?? []).map((option) => {
      const presentation = getReasoningEffortPresentation(option.id)

      return {
        value: option.id,
        label: presentation.isKnown
          ? presentation.label
          : formatSelectionLabel(option.label || option.id),
        description: option.description || undefined,
        icon: presentation.icon
      }
    })
  ]
  const forceSpeedOptions: DropdownOption<AppChatDropdownSettings['forceSpeed']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the speed selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...(modelHasServiceTierOptions(settingsSelectedEffectiveModel)
      ? [
          {
            value: appChatStandardSpeedValue,
            label: 'Standard',
            description: 'Standard response speed and credit usage',
            icon: getChatServiceTierIcon(appChatStandardSpeedValue)
          } satisfies DropdownOption<AppChatDropdownSettings['forceSpeed']>
        ]
      : []),
    ...(settingsSelectedEffectiveModel?.supportedServiceTiers ?? []).map((option) => ({
      value: option.id,
      label: option.label,
      description: option.description || undefined,
      icon: getChatServiceTierIcon(option.id, option.label)
    }))
  ]

  const handleToggleCwdGroup = (groupKey: string): void => {
    setCollapsedCwdGroups((currentGroups) => ({
      ...currentGroups,
      [groupKey]: !getCollapsedGroupState(groupKey, currentGroups)
    }))
  }

  const handleToggleChatGrouping = (): void => {
    setChatGroupingPreference((currentPreference) => {
      const nextPreference = currentPreference === 'grouped' ? 'ungrouped' : 'grouped'
      writeChatGroupingPreference(nextPreference)
      return nextPreference
    })
  }

  const handleLoadMoreChatsInGroup = (group: ChatListGroupData): void => {
    setVisibleChatPageCountsByGroup((currentPageCounts) => ({
      ...currentPageCounts,
      [group.key]: (currentPageCounts[group.key] ?? 1) + 1
    }))
  }

  const handleShowLessChatsInGroup = (group: ChatListGroupData): void => {
    setVisibleChatPageCountsByGroup((currentPageCounts) => {
      const nextPageCounts = { ...currentPageCounts }
      delete nextPageCounts[group.key]
      return nextPageCounts
    })
  }

  const handleCwdNotesChange = (
    group: Pick<ChatListGroupData, 'key' | 'cwd'>,
    notes: ProviderCwdNote[]
  ): void => {
    setCwdNotesByGroup((currentNotes) => ({
      ...currentNotes,
      [group.key]: notes
    }))

    void providerApi
      .setCwdNotes('codex', group.cwd, notes)
      .then((storedNotes) => {
        setCwdNotesByGroup((currentNotes) => ({
          ...currentNotes,
          [group.key]: storedNotes
        }))
      })
      .catch(() => {
        // Keep the optimistic note list visible if local persistence fails.
      })
  }

  const handleSelectProjectIcon = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'cwd') return

    let icon: AppProjectIcon | null = null
    try {
      icon = await appApi.selectProjectIcon({ cwd: group.cwd })
    } catch {
      return
    }

    setProjectIconsByGroup((currentIcons) => ({
      ...currentIcons,
      [group.key]: icon
    }))
  }

  const handleSelectChat = (chat: ProviderChat): void => {
    const selectingCurrentChat =
      selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id
    const seenUpdatedAt = chat.updatedAt
    const cachedDetail = getRecentCachedChatDetail(chat)
    const seenChat = {
      ...chat,
      seenUpdatedAt:
        chat.seenUpdatedAt == null ? seenUpdatedAt : Math.max(chat.seenUpdatedAt, seenUpdatedAt)
    }

    resetChatSearch()
    setSendState('idle')
    setEditingMessage(null)
    setNewChatOpen(false)
    setSearchOpen(false)
    setSearchQuery('')

    if (selectingCurrentChat && chatLoadState === 'ready' && chatDetail?.id === chat.id) {
      markSelectedChatSeen()
      return
    }

    markSelectedChatSeen()
    selectedChatKeyRef.current = getChatKey(chat)
    selectedChatUpdatedAtRef.current = chat.updatedAt
    chatDetailRef.current = null
    setSelectedChat(seenChat)
    setChatDetail(null)
    setChatLoadState('loading')
    if (cachedDetail) {
      const nextCachedDetail = {
        ...cachedDetail,
        seenUpdatedAt:
          cachedDetail.seenUpdatedAt == null
            ? seenUpdatedAt
            : Math.max(cachedDetail.seenUpdatedAt, seenUpdatedAt)
      }
      chatDetailRef.current = nextCachedDetail
      startTransition(() => {
        setChatDetail(nextCachedDetail)
        setChatLoadState('ready')
      })
    }
    markChatSeenAt(chat.providerId, chat.id, seenUpdatedAt)

    if (selectingCurrentChat && !cachedDetail) {
      setChatLoadRequest((currentRequest) => currentRequest + 1)
    }
  }

  const handleBack = (): void => {
    markSelectedChatSeen()
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    resetChatSearch()
    chatDetailRef.current = null
    setSelectedChat(null)
    setChatDetail(null)
    setNewChatOpen(false)
    setSendState('idle')
    setEditingMessage(null)
  }

  const handleNewChat = (): void => {
    const currentChat = selectedChat
      ? chatDetail?.id === selectedChat.id
        ? chatDetail
        : selectedChat
      : null
    const projectCwd = currentChat ? getChatProjectCwd(currentChat) : undefined
    const projectContainer = currentChat?.container ?? undefined
    markSelectedChatSeen()
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    showNewChatView(projectCwd, projectContainer)
  }

  const handleNewChatInCwd = (group: ChatListGroupData): void => {
    if (group.kind !== 'cwd') return

    markSelectedChatSeen()
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    showNewChatView(group.cwd)
  }

  const handleCloseSearch = (): void => {
    setSearchOpen(false)
    setSearchQuery('')
  }

  const handleChatSearchNavigation = (direction: -1 | 1): void => {
    const matches = chatSearchMatchesRef.current
    if (matches.length === 0) return

    const activeIndex =
      (chatSearchActiveIndexRef.current + direction + matches.length) % matches.length
    chatSearchActiveIndexRef.current = activeIndex
    setChatSearchActiveIndex(activeIndex)
    setChatSearchHighlights(matches, activeIndex)
    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null

    const activeMatch = matches[activeIndex]
    const scrollContainer = contentRef.current
    if (activeMatch && scrollContainer) {
      scrollChatSearchMatchIntoView(activeMatch, scrollContainer)
    }
  }

  const updateAppSettings = (update: (settings: AppSettings) => AppSettings): void => {
    setAppSettings((currentSettings) => update(currentSettings))
  }

  const updateProjectSettings = (
    update: (overrides: AppProjectSettingsOverrides) => AppProjectSettingsOverrides
  ): void => {
    if (!settingsProjectCwd) return

    setProjectSettingsByCwd((currentSettings) => {
      const currentOverrides = currentSettings[settingsProjectCwd] ?? {}
      const nextOverrides = update(currentOverrides)
      return setAppProjectSettingsForCwd(currentSettings, settingsProjectCwd, nextOverrides)
    })
  }

  const updateScopedSetting = (
    path: AppProjectSettingPath,
    value: unknown,
    updateGlobal: (settings: AppSettings) => AppSettings
  ): void => {
    if (settingsViewIsProject && settingsProjectCwd) {
      updateProjectSettings((currentOverrides) =>
        setAppProjectSettingOverrideValue(currentOverrides, path, value)
      )
      return
    }

    updateAppSettings(updateGlobal)
  }

  const handleEditProjectSetting = (path: AppProjectSettingPath): void => {
    if (!settingsProjectCwd) return

    updateProjectSettings((currentOverrides) =>
      setAppProjectSettingOverrideValue(
        currentOverrides,
        path,
        getAppProjectSettingValue(effectiveAppSettings, path)
      )
    )
  }

  const handleResetProjectSetting = (path: AppProjectSettingPath): void => {
    if (!settingsProjectCwd) return

    setAppearanceZoomLevelInputDraft(null)
    setAppearanceFontSizeInputDraft(null)
    updateProjectSettings((currentOverrides) =>
      clearAppProjectSettingOverrideValue(currentOverrides, path)
    )
  }

  const isProjectSettingOverrideEnabled = (path: AppProjectSettingPath): boolean =>
    settingsViewIsProject && isAppProjectSettingOverridden(settingsProjectOverrides, path)

  const isScopedSettingControlDisabled = (path: AppProjectSettingPath, disabled = false): boolean =>
    disabled || (settingsViewIsProject && !isProjectSettingOverrideEnabled(path))

  const getSettingsFieldClassName = (
    ...classNames: (string | false | null | undefined)[]
  ): string =>
    [
      'settings-dialog__field',
      settingsViewIsProject ? 'settings-dialog__field--with-project-action' : null,
      ...classNames
    ]
      .filter(Boolean)
      .join(' ')

  const renderProjectSettingAction = (
    path: AppProjectSettingPath,
    label: string
  ): React.ReactElement | null => {
    if (!settingsViewIsProject) return null

    const overridden = isProjectSettingOverrideEnabled(path)
    const actionLabel = overridden ? `Reset ${label}` : `Edit ${label}`

    return (
      <span className="settings-dialog__project-action">
        <Button
          id={getProjectSettingPathId(path)}
          aria-label={actionLabel}
          title={actionLabel}
          callback={() =>
            overridden ? handleResetProjectSetting(path) : handleEditProjectSetting(path)
          }
          icon={overridden ? <Undo2 aria-hidden="true" /> : <SquarePen aria-hidden="true" />}
          size="small"
          theme="transparent"
        />
      </span>
    )
  }

  const handleActionsChange = (actions: AppAction[]): void => {
    updateAppSettings((currentSettings) => {
      const lastActionId = actions.some((action) => action.id === currentSettings.lastActionId)
        ? currentSettings.lastActionId
        : null

      return {
        ...currentSettings,
        actions,
        lastActionId
      }
    })
  }

  const handleLastActionChange = (actionId: string | null): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      lastActionId: actionId
    }))
  }

  const handleThemePreferenceChange = (theme: AppThemePreference): void => {
    updateScopedSetting({ section: 'appearance', key: 'theme' }, theme, (currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        theme
      }
    }))
  }

  const handleAppearanceZoomLevelInputChange = (value: string): void => {
    setAppearanceZoomLevelInputDraft({ key: settingsScopeKey, value })

    const trimmedValue = value.trim()
    if (!trimmedValue || trimmedValue === '-' || trimmedValue === '+') return

    const zoomLevel = Number(trimmedValue)
    if (!Number.isFinite(zoomLevel)) return

    updateAppearanceZoomLevel(zoomLevel)
  }

  const handleAppearanceZoomLevelInputBlur = (): void => {
    setAppearanceZoomLevelInputDraft(null)
  }

  const handleAppearancePositionChange = (position: AppAppearancePositionPreference): void => {
    updateScopedSetting(
      { section: 'appearance', key: 'position' },
      position,
      (currentSettings) => ({
        ...currentSettings,
        appearance: {
          ...currentSettings.appearance,
          position
        }
      })
    )
  }

  const handleAppearanceStyleChange = (style: AppAppearanceStylePreference): void => {
    updateScopedSetting({ section: 'appearance', key: 'style' }, style, (currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        style
      }
    }))
  }

  const handleAppearanceControlStyleChange = (
    controlStyle: AppAppearanceControlStylePreference
  ): void => {
    updateScopedSetting(
      { section: 'appearance', key: 'controlStyle' },
      controlStyle,
      (currentSettings) => ({
        ...currentSettings,
        appearance: {
          ...currentSettings.appearance,
          controlStyle
        }
      })
    )
  }

  const updateAppearanceFont = (key: AppearanceFontKey, font: AppFontSetting): void => {
    updateScopedSetting({ section: 'appearance', key }, font, (currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        [key]: font
      }
    }))
  }

  const handleAppearanceFontFamilyChange = (key: AppearanceFontKey, family: string): void => {
    updateAppearanceFont(key, {
      ...settingsPanelSettings.appearance[key],
      family
    })
  }

  const handleAppearanceFontSizeInputChange = (key: AppearanceFontKey, value: string): void => {
    const draftKey = `${settingsScopeKey}:${key}`
    setAppearanceFontSizeInputDraft({ key: draftKey, value })

    const trimmedValue = value.trim()
    if (!trimmedValue) return

    const size = Number(trimmedValue)
    if (!Number.isFinite(size)) return

    const currentFont = settingsPanelSettings.appearance[key]
    updateAppearanceFont(key, {
      ...currentFont,
      size: normalizeAppFontSize(size, currentFont.size)
    })
  }

  const handleAppearanceFontSizeInputBlur = (): void => {
    setAppearanceFontSizeInputDraft(null)
  }

  const handleExternalLinkBehaviorChange = (behavior: AppExternalLinkBehavior): void => {
    updateScopedSetting({ section: 'links', key: 'behavior' }, behavior, (currentSettings) => ({
      ...currentSettings,
      links: {
        behavior
      }
    }))
  }

  const handleChatUsageDisplayChange = (displayUsage: AppChatUsageDisplay): void => {
    updateScopedSetting(
      { section: 'chat', key: 'displayUsage' },
      displayUsage,
      (currentSettings) => ({
        ...currentSettings,
        chat: {
          ...currentSettings.chat,
          displayUsage
        }
      })
    )
  }

  const handleChatDropdownPreferenceChange = (key: ChatBooleanSettingKey, value: boolean): void => {
    updateScopedSetting({ section: 'chat', key }, value, (currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        [key]: value
      }
    }))
  }

  const handleChatForcedDropdownChange = <Key extends keyof AppChatDropdownSettings>(
    key: Key,
    value: AppChatDropdownSettings[Key]
  ): void => {
    updateScopedSetting({ section: 'chat', key }, value, (currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        [key]: value
      }
    }))
  }

  const handlePerformancePreferenceChange = (key: 'disableShadows', value: boolean): void => {
    updateScopedSetting({ section: 'performance', key }, value, (currentSettings) => ({
      ...currentSettings,
      performance: {
        ...currentSettings.performance,
        [key]: value
      }
    }))
  }

  const handleMaxChatsRenderedChange = (value: number): void => {
    if (!Number.isFinite(value)) return

    const maxChatsRendered = normalizeAppMaxChatsRendered(value)
    updateScopedSetting(
      { section: 'performance', key: 'maxChatsRendered' },
      maxChatsRendered,
      (currentSettings) => ({
        ...currentSettings,
        performance: {
          ...currentSettings.performance,
          maxChatsRendered
        }
      })
    )
  }

  const handleRecentChatCacheLimitChange = (value: number): void => {
    if (!Number.isFinite(value)) return

    const recentChatCacheLimit = Math.min(Math.max(Math.floor(value), 0), 50)
    recentChatCacheLimitRef.current = recentChatCacheLimit
    if (recentChatCacheLimit === 0) {
      recentChatCacheRef.current.clear()
    } else {
      trimRecentChatCache(recentChatCacheRef.current, recentChatCacheLimit)
      if (selectedChat && chatDetail?.id === selectedChat.id) {
        cacheRecentChatDetail(selectedChat.providerId, chatDetail, selectedChat.updatedAt, true)
      }
    }

    updateScopedSetting(
      { section: 'chat', key: 'recentChatCacheLimit' },
      recentChatCacheLimit,
      (currentSettings) => ({
        ...currentSettings,
        chat: {
          ...currentSettings.chat,
          recentChatCacheLimit
        }
      })
    )
  }

  const handleContinuePromptChange = (continuePrompt: string): void => {
    updateScopedSetting(
      { section: 'chat', key: 'continuePrompt' },
      continuePrompt,
      (currentSettings) => ({
        ...currentSettings,
        chat: {
          ...currentSettings.chat,
          continuePrompt
        }
      })
    )
  }

  const handleGitCommitModelChange = (nextModel: string): void => {
    const commitModel = nextModel === gitCurrentChatModelValue ? null : nextModel

    updateScopedSetting({ section: 'git', key: 'commitModel' }, commitModel, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        commitModel
      }
    }))
  }

  const handleGitCommitPromptChange = (
    key: keyof AppGitCommitPromptSettings,
    value: string
  ): void => {
    updateScopedSetting({ section: 'gitCommitPrompt', key }, value, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        commitPrompt: {
          ...currentSettings.git.commitPrompt,
          [key]: value
        }
      }
    }))
  }

  const handleGitCommitMessageGenerationChange = (
    key: keyof AppGitCommitMessageGenerationSettings,
    value: string
  ): void => {
    updateScopedSetting(
      { section: 'gitCommitMessageGeneration', key },
      value,
      (currentSettings) => ({
        ...currentSettings,
        git: {
          ...currentSettings.git,
          commitMessageGeneration: {
            ...currentSettings.git.commitMessageGeneration,
            [key]: value
          }
        }
      })
    )
  }

  const handleGitWorktreeChange = (key: keyof AppGitWorktreeSettings, value: string): void => {
    updateScopedSetting({ section: 'gitWorktree', key }, value, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        worktree: {
          ...currentSettings.git.worktree,
          [key]: value
        }
      }
    }))
  }

  const rememberProject = useCallback(async (cwd: string | null | undefined): Promise<void> => {
    const normalizedCwd = cwd?.trim()
    if (!normalizedCwd) return

    try {
      const project = await appApi.addProject({ cwd: normalizedCwd })
      setProjects((currentProjects) => mergeProjects(currentProjects, [project]))
    } catch {
      // Keep the project selected even if local persistence fails.
    }
  }, [])

  const handleSelectNewSessionFolder = async (): Promise<void> => {
    try {
      const folder = await appApi.selectFolder({ defaultPath: newSessionCwd })
      if (folder) {
        setNewSessionCwd(folder)
        await rememberProject(folder)
      }
    } catch {
      // Keep the current folder if the native dialog cannot be opened.
    }
  }

  const handleModelChange = (nextModelId: ProviderModelId): void => {
    modelManuallySelectedRef.current = true
    setModel(nextModelId)

    const nextModel = models.find((candidateModel) => candidateModel.id === nextModelId)
    if (!nextModel) return

    setReasoningEffort((currentReasoningEffort) => {
      if (!modelHasReasoningEffortOptions(nextModel)) {
        reasoningManuallySelectedRef.current = false
        return getDefaultReasoningEffort(nextModel)
      }
      if (
        reasoningManuallySelectedRef.current &&
        modelSupportsReasoningEffort(nextModel, currentReasoningEffort)
      ) {
        return currentReasoningEffort
      }

      reasoningManuallySelectedRef.current = false
      return getDefaultReasoningEffort(nextModel)
    })
  }

  const handleReasoningEffortChange = (nextReasoningEffort: ProviderReasoningEffort): void => {
    reasoningManuallySelectedRef.current = true
    setReasoningEffort(nextReasoningEffort)
  }

  const handleApprovalModeChange = (nextApprovalMode: ProviderApprovalMode): void => {
    if (sandboxMode === 'danger-full-access') return

    approvalModeManuallySelectedRef.current = true
    setApprovalMode(nextApprovalMode)
  }

  const handleSandboxModeChange = (nextSandboxMode: ProviderSandboxMode): void => {
    sandboxModeManuallySelectedRef.current = true

    if (nextSandboxMode === 'danger-full-access') {
      if (sandboxMode !== 'danger-full-access') {
        approvalModeBeforeFullAccessRef.current = approvalMode === 'never' ? null : approvalMode
      }
      setApprovalMode('never')
    } else if (
      sandboxMode === 'danger-full-access' &&
      approvalMode === 'never' &&
      approvalModeBeforeFullAccessRef.current
    ) {
      setApprovalMode(approvalModeBeforeFullAccessRef.current)
      approvalModeBeforeFullAccessRef.current = null
    }

    setSandboxMode(nextSandboxMode)
  }

  const updateProviderUpdatePreference = (
    providerId: ProviderId,
    update: (preference: ProviderUpdatePreference) => ProviderUpdatePreference
  ): void => {
    setProviderUpdatePreferences((currentPreferences) => ({
      ...currentPreferences,
      [providerId]: update(getProviderUpdatePreference(currentPreferences, providerId))
    }))
  }

  const handleSkipProviderUpdate = (): void => {
    setProviderUpdateSuggestion(null)
    setProviderUpdateError(null)
  }

  const handleNeverSuggestProviderUpdate = (): void => {
    const suggestion = providerUpdateSuggestion
    if (!suggestion) return

    updateProviderUpdatePreference(suggestion.providerId, (preference) => ({
      ...preference,
      neverSuggest: true
    }))
    setProviderUpdateSuggestion(null)
    setProviderUpdateError(null)
  }

  const handleNeverSuggestProviderUpdateVersion = (): void => {
    const suggestion = providerUpdateSuggestion
    if (!suggestion) return

    updateProviderUpdatePreference(suggestion.providerId, (preference) => ({
      ...preference,
      ignoredVersions: Array.from(
        new Set([...preference.ignoredVersions, suggestion.latestVersion])
      )
    }))
    setProviderUpdateSuggestion(null)
    setProviderUpdateError(null)
  }

  const handleUpdateProvider = async (): Promise<void> => {
    const suggestion = providerUpdateSuggestion
    if (!suggestion || providerUpdateState === 'updating') return

    setProviderUpdateState('updating')
    setProviderUpdateError(null)

    try {
      const availability = await providerApi.updateProvider(suggestion.providerId, {
        container: normalizeContainerTarget(newSessionContainer)
      })
      setProviderUpdateSuggestion(
        availability &&
          shouldSuggestProviderUpdate(
            providerUpdatePreferences,
            suggestion.providerId,
            availability
          )
          ? { ...availability, providerId: suggestion.providerId }
          : null
      )
    } catch (error) {
      setProviderUpdateError(
        getErrorMessage(error, `Unable to update ${providerLabels[suggestion.providerId]}.`)
      )
    } finally {
      setProviderUpdateState('idle')
    }
  }

  const providerUpdateInProgress = providerUpdateState === 'updating'
  const requestErrorVisible = sendState === 'error'
  const requestErrorSummary =
    sendState === 'error' && sendError ? sendError : 'Unable to complete request.'

  const handleSendFailure = useCallback((error: unknown, fallback: string): void => {
    setSendError(getErrorMessage(error, fallback))
    setSendState('error')
  }, [])

  const handleDismissSendError = (): void => {
    setSendState('idle')
    setSendError(null)
  }

  const handleMarkChatDone = async (chat: ProviderChat, done = true): Promise<void> => {
    try {
      const metadata = await providerApi.markChatDone(chat.providerId, chat.id, done)
      applyChatMetadata([metadata])
      if (metadata.done) removeRecentChatCacheEntry(chat.providerId, chat.id)

      if (done && selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id) {
        const currentChat = chatDetail?.id === selectedChat.id ? chatDetail : selectedChat
        showNewChatView(
          getChatProjectCwd(currentChat),
          currentChat.container ?? newSessionContainer
        )
      }
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }

  const handleRenameChat = async (chat: ProviderChat, title: string): Promise<void> => {
    const detail = await providerApi.setChatTitle(chat.providerId, chat.id, title)
    applyChatDetail(chat.providerId, detail)
  }

  const handleToggleChatPinned = async (chat: ProviderChat): Promise<void> => {
    try {
      const metadata = await providerApi.setChatPinned(chat.providerId, chat.id, !chat.pinned)
      applyChatMetadata([metadata])
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }

  const handleReorderPinnedChats = (orderedChats: ProviderChat[]): void => {
    if (orderedChats.length < 2) return

    const mutationId = ++pinnedOrderMutationRef.current
    const previousOrderByChatKey = new Map(
      orderedChats.map((chat) => [getChatKey(chat), chat.pinnedOrder])
    )
    const nextOrderByChatKey = new Map(
      orderedChats.map((chat, pinnedOrder) => [getChatKey(chat), pinnedOrder])
    )

    setChats((currentChats) =>
      currentChats.map((chat) => {
        const pinnedOrder = nextOrderByChatKey.get(getChatKey(chat))
        return pinnedOrder === undefined ? chat : { ...chat, pinnedOrder }
      })
    )

    void providerApi
      .setPinnedChatOrder(orderedChats.map((chat) => chat.id))
      .then((metadataList) => {
        if (pinnedOrderMutationRef.current === mutationId) applyChatMetadata(metadataList)
      })
      .catch(() => {
        if (pinnedOrderMutationRef.current !== mutationId) return

        setChats((currentChats) =>
          currentChats.map((chat) => {
            const pinnedOrder = previousOrderByChatKey.get(getChatKey(chat))
            return pinnedOrder === undefined ? chat : { ...chat, pinnedOrder }
          })
        )
      })
  }

  const handleUnpinPinnedChats = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'pinned') return

    try {
      const metadataList = await Promise.all(
        group.chats.map((chat) => providerApi.setChatPinned(chat.providerId, chat.id, false))
      )
      applyChatMetadata(metadataList)
    } catch {
      // Leave the group as-is if local metadata cannot be updated.
    }
  }

  const handleMarkCwdChatsDone = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'cwd') return

    try {
      const providerIds = Array.from(new Set(group.chats.map((chat) => chat.providerId)))
      const groupCwds = Array.from(new Set(group.chats.map((chat) => chat.cwd ?? null)))
      const metadataGroups = await Promise.all(
        providerIds.flatMap((providerId) =>
          groupCwds.map((cwd) => providerApi.markCwdChatsDone(providerId, cwd))
        )
      )
      applyChatMetadata(metadataGroups.flat())

      if (
        selectedChat &&
        !selectedChat.done &&
        getChatCwdGroupKey(getChatProjectCwd(selectedChat)) === getChatCwdGroupKey(group.cwd)
      ) {
        const currentChat = chatDetail?.id === selectedChat.id ? chatDetail : selectedChat
        showNewChatView(group.cwd, currentChat.container ?? newSessionContainer)
      }
    } catch {
      // Leave the group as-is if local metadata cannot be updated.
    }
  }

  const handleEditMessage = useCallback(
    (message: ProviderMessage): void => {
      if (
        message.role !== 'user' ||
        !chatDetail?.capabilities.editMessages ||
        sendInFlightRef.current
      ) {
        return
      }

      setSendState('idle')
      setEditingMessage({
        type: 'message',
        id: message.id,
        content: message.content
      })
    },
    [chatDetail?.capabilities.editMessages]
  )

  const handleEditPendingMessage = useCallback(
    (message: ProviderPendingMessage): void => {
      if (!selectedChatId || sendInFlightRef.current) return

      setSendState('idle')
      setEditingMessage({
        type: 'pending',
        id: message.id,
        kind: message.kind,
        content: message.content
      })
    },
    [selectedChatId]
  )

  const handleCancelEditMessage = useCallback((): void => {
    setSendState('idle')
    setEditingMessage(null)
  }, [])

  const normalizeTurnOptionsForModels = useCallback(
    (turnOptions: ProviderTurnOptions): ProviderTurnOptions => {
      const resolvedModel =
        models.find((candidateModel) => candidateModel.id === turnOptions.model) ??
        getDefaultModel(models)
      const {
        reasoningEffort: configuredReasoningEffort,
        serviceTier: configuredServiceTier,
        ...remainingOptions
      } = turnOptions
      const reasoningEffort = modelHasReasoningEffortOptions(resolvedModel)
        ? modelSupportsReasoningEffort(resolvedModel, configuredReasoningEffort)
          ? configuredReasoningEffort
          : getDefaultReasoningEffort(resolvedModel)
        : undefined
      const serviceTier = modelSupportsServiceTier(resolvedModel, configuredServiceTier)
        ? configuredServiceTier
        : (resolvedModel.defaultServiceTier ?? null)

      return {
        ...remainingOptions,
        model: resolvedModel.id,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        serviceTier
      }
    },
    [models]
  )

  const getCurrentTurnOptions = (): ProviderTurnOptions =>
    normalizeTurnOptionsForModels({
      ...getApprovalAccessOptions(effectiveApprovalMode, effectiveSandboxMode),
      container: changesContainer,
      model: effectiveModel,
      ...(modelHasReasoningEffortOptions(selectedEffectiveModel)
        ? { reasoningEffort: effectiveReasoningEffort }
        : {}),
      sandboxMode: effectiveSandboxMode,
      serviceTier: effectiveServiceTier
    })

  const getGitTurnOptions = (): ProviderTurnOptions => {
    const commitModel = effectiveAppSettings.git.commitModel
    const turnOptions = getCurrentTurnOptions()
    if (!commitModel) return turnOptions

    const selectedCommitModel = models.find((candidateModel) => candidateModel.id === commitModel)
    const resolvedCommitModel = selectedCommitModel ?? getDefaultModel(models)

    return normalizeTurnOptionsForModels({
      ...turnOptions,
      model: resolvedCommitModel.id,
      serviceTier: turnOptions.serviceTier
    })
  }

  const handleCancelWorktreeCreation = useCallback(async (): Promise<void> => {
    worktreeCreationCanceledRef.current = true
    setWorktreeCreationState('canceling')

    const generation = worktreeBranchGenerationRef.current
    if (!generation) return

    await providerApi.cancelOneShot(generation.providerId, generation.generationId).catch(() => {})
  }, [])

  const handleSendMessage = async (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments: AppSelectedAttachment[] = [],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills: ProviderSkillInput[] = [],
    apps: ProviderAppInput[] = [],
    turnOptionsOverride?: ProviderTurnOptions,
    sendTarget?: 'current' | 'new'
  ): Promise<boolean> => {
    if (providerUpdateInProgress || sendInFlightRef.current) return false
    sendInFlightRef.current = true
    chatAutoScrollEnabledRef.current = true
    const messageWithComposerMentions = serializeComposerMessage(message, skills, apps)
    const serializedMessage = review
      ? serializeReviewMessage(messageWithComposerMentions, review)
      : messageWithComposerMentions
    const baseTurnOptions = {
      ...normalizeTurnOptionsForModels(turnOptionsOverride ?? getCurrentTurnOptions()),
      review: review
        ? {
            ...review,
            prompt: messageWithComposerMentions.trim()
          }
        : undefined,
      skills: skills.length > 0 ? skills : undefined
    }
    const imagePaths = attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => attachment.path)
    const filePaths = attachments
      .filter((attachment) => attachment.kind === 'file')
      .map((attachment) => attachment.path)
    const turnOptions =
      attachments.length > 0
        ? {
            ...baseTurnOptions,
            files: filePaths.length > 0 ? filePaths.map((path) => ({ path })) : undefined,
            images: imagePaths.length > 0 ? imagePaths.map((path) => ({ path })) : undefined
          }
        : baseTurnOptions

    if (editingMessage && !sendTarget) {
      if (!selectedChat) {
        sendInFlightRef.current = false
        return false
      }

      setSendState('sending')

      try {
        const detail =
          editingMessage.type === 'pending'
            ? await providerApi.editPendingMessage(
                selectedChat.providerId,
                selectedChat.id,
                editingMessage.id,
                serializedMessage,
                turnOptions
              )
            : await providerApi.editMessage(
                selectedChat.providerId,
                selectedChat.id,
                editingMessage.id,
                serializedMessage,
                turnOptions
              )
        applyViewedChatDetail(selectedChat.providerId, detail)
        setEditingMessage(null)
        setSendState('idle')
        return true
      } catch (error) {
        handleSendFailure(error, 'Unable to edit message.')
        return false
      } finally {
        sendInFlightRef.current = false
      }
    }

    if (!selectedChat || sendTarget === 'new') {
      setSendState('sending')

      try {
        const startingSelectedChat = sendTarget === 'new' ? selectedChat : null
        const startingProviderId = startingSelectedChat?.providerId ?? newSessionProvider
        const startingCwd = startingSelectedChat ? changesProjectCwd : newSessionCwd
        let sessionCwd = startingCwd ?? undefined

        if (!startingSelectedChat && newSessionLocation === 'worktree') {
          if (!newSessionCwd) throw new Error('Choose a folder before creating a worktree.')

          const generationId = crypto.randomUUID()
          worktreeCreationCanceledRef.current = false
          worktreeBranchGenerationRef.current = { generationId, providerId: newSessionProvider }
          setWorktreeCreationState('creating')

          const generatedName = await providerApi.generateOneShot(
            newSessionProvider,
            getWorktreeBranchGenerationPrompt(
              messageWithComposerMentions.trim() || serializedMessage.trim() || 'File attachment',
              effectiveAppSettings.git.worktree
            ),
            {
              ...getGitTurnOptions(),
              cwd: newSessionCwd,
              generationId
            }
          )
          if (worktreeCreationCanceledRef.current) {
            setSendState('idle')
            return true
          }

          const worktreeName = normalizeGeneratedWorktreeName(generatedName)
          if (!worktreeName) throw new Error('AI did not return a branch name.')

          const worktree = await appApi.createGitWorktree({
            container: changesContainer,
            cwd: newSessionCwd,
            name: worktreeName
          })
          if (worktreeCreationCanceledRef.current) {
            setSendState('idle')
            return true
          }

          sessionCwd = worktree.worktreePath
        }

        const detail = await providerApi.startChat(startingProviderId, serializedMessage, {
          ...turnOptions,
          cwd: sessionCwd
        })
        applyViewedChatDetail(
          startingProviderId,
          detail.items.length === 0
            ? {
                ...detail,
                items: getOptimisticItems([], messageWithComposerMentions, attachments, review)
              }
            : detail,
          { select: true }
        )
        if (startingCwd?.trim() && startingCwd.trim() === defaultCwd?.trim()) {
          void rememberProject(startingCwd)
        }
        setSendState('idle')
        return true
      } catch (error) {
        if (
          worktreeCreationCanceledRef.current ||
          (error instanceof Error && error.message === providerOneShotGenerationCanceledMessage)
        ) {
          setSendState('idle')
          return true
        } else {
          handleSendFailure(error, 'Unable to start chat.')
          return false
        }
      } finally {
        worktreeBranchGenerationRef.current = null
        worktreeCreationCanceledRef.current = false
        setWorktreeCreationState('idle')
        sendInFlightRef.current = false
      }
    }

    const providerId = selectedChat.providerId
    const chatId = selectedChat.id
    setSendState('sending')

    if (chatHasActiveTurn && chatDetail?.capabilities.activeMessages) {
      try {
        const summary = await providerApi.sendActiveChatMessageSummary(
          providerId,
          chatId,
          serializedMessage,
          activeMode ?? 'queue',
          turnOptions
        )
        applyChatSummary(providerId, summary, false)
        markChatSeenAt(providerId, chatId, Date.now())
        setSendState('idle')
        return true
      } catch (error) {
        handleSendFailure(error, 'Unable to send message.')
        return false
      } finally {
        sendInFlightRef.current = false
      }
    }

    if (chatDetail?.id === chatId) {
      applyViewedChatDetail(providerId, {
        ...chatDetail,
        status: 'active',
        contextUsage: chatDetail.contextUsage,
        items: getOptimisticItems(
          chatDetail.items,
          messageWithComposerMentions,
          attachments,
          review
        )
      })
    }

    try {
      const summary = await providerApi.continueChatSummary(
        providerId,
        chatId,
        serializedMessage,
        turnOptions
      )
      applyChatSummary(providerId, summary, false)
      markChatSeenAt(providerId, chatId, Date.now())
      setSendState('idle')
      return true
    } catch (error) {
      void providerApi
        .getChat(providerId, chatId)
        .then((detail) => applyViewedChatDetail(providerId, detail))
        .catch(() => {})
      handleSendFailure(error, 'Unable to send message.')
      return false
    } finally {
      sendInFlightRef.current = false
    }
  }

  const handleContinueStoppedTurn = async (
    workingStepId: string,
    prompt: string
  ): Promise<void> => {
    if (selectedChatKey) {
      setContinuedStoppedWorkingStepsByChat((currentStepsByChat) => {
        const currentStepIds = currentStepsByChat[selectedChatKey] ?? []
        if (currentStepIds.includes(workingStepId)) return currentStepsByChat

        return {
          ...currentStepsByChat,
          [selectedChatKey]: [...currentStepIds, workingStepId]
        }
      })
    }

    await handleSendMessage(prompt)
  }

  const handleLoadWorkingStep = useCallback(async (workingStepId: string): Promise<void> => {
    const chat = selectedChatRef.current
    if (!chat) throw new Error('No chat selected')

    const chatKey = getChatKey(chat)
    const workingStep = await providerApi.getChatWorkingStep(
      chat.providerId,
      chat.id,
      workingStepId
    )
    if (selectedChatKeyRef.current !== chatKey) return

    setChatDetail((currentDetail) => {
      if (currentDetail?.id !== chat.id) return currentDetail

      const itemIndex = currentDetail.items.findIndex((item) => item.id === workingStepId)
      const currentItem = currentDetail.items[itemIndex]
      if (currentItem?.type !== 'working' || currentItem.itemsLoaded !== false) {
        return currentDetail
      }

      const items = [...currentDetail.items]
      items[itemIndex] = {
        ...workingStep,
        itemsLoaded: true,
        itemCount: workingStep.items.length
      }
      const nextDetail = { ...currentDetail, items }
      chatDetailRef.current = nextDetail
      return nextDetail
    })
  }, [])

  const handleRetryStoppedTurn = useCallback(
    async (message: ProviderMessage): Promise<void> => {
      if (
        providerUpdateInProgress ||
        !selectedProviderId ||
        !selectedChatId ||
        !chatDetail?.capabilities.editMessages ||
        sendInFlightRef.current
      ) {
        return
      }

      const attachments = message.attachments ?? []
      const imagePaths = attachments.flatMap((attachment) =>
        attachment.kind === 'image' && attachment.path ? [attachment.path] : []
      )
      const filePaths = attachments.flatMap((attachment) =>
        attachment.kind === 'file' && attachment.path ? [attachment.path] : []
      )
      const reviewAttachment = attachments.find(
        (attachment): attachment is Extract<(typeof attachments)[number], { kind: 'review' }> =>
          attachment.kind === 'review'
      )
      const review = reviewAttachment
        ? {
            id: reviewAttachment.id,
            comments: reviewAttachment.comments
          }
        : null
      const turnOptions = normalizeTurnOptionsForModels({
        ...getApprovalAccessOptions(effectiveApprovalMode, effectiveSandboxMode),
        model: effectiveModel,
        reasoningEffort: effectiveReasoningEffort,
        sandboxMode: effectiveSandboxMode,
        serviceTier: effectiveServiceTier,
        review: review
          ? {
              ...review,
              prompt: message.content
            }
          : undefined,
        images: imagePaths.length > 0 ? imagePaths.map((path) => ({ path })) : undefined,
        files: filePaths.length > 0 ? filePaths.map((path) => ({ path })) : undefined
      })

      sendInFlightRef.current = true
      chatAutoScrollEnabledRef.current = true
      setSendState('sending')

      try {
        const detail = await providerApi.editMessage(
          selectedProviderId,
          selectedChatId,
          message.id,
          review ? serializeReviewMessage(message.content, review) : message.content,
          turnOptions
        )
        applyViewedChatDetail(selectedProviderId, detail)
        markChatSeenAt(selectedProviderId, selectedChatId, Date.now())
        setSendState('idle')
      } catch (error) {
        handleSendFailure(error, 'Unable to retry message.')
      } finally {
        sendInFlightRef.current = false
      }
    },
    [
      applyViewedChatDetail,
      chatDetail?.capabilities.editMessages,
      effectiveApprovalMode,
      effectiveModel,
      effectiveReasoningEffort,
      effectiveSandboxMode,
      effectiveServiceTier,
      handleSendFailure,
      markChatSeenAt,
      normalizeTurnOptionsForModels,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId
    ]
  )

  const resolveChatApproval = async (
    chat: ProviderChat,
    approval: NonNullable<ProviderChat['pendingApproval']>,
    decision: ProviderApprovalDecision,
    options: { markViewed: boolean }
  ): Promise<void> => {
    if (providerUpdateInProgress || approvalResolution.decision) return

    const approvalId = approval.id
    setApprovalResolution({ approvalId, decision, error: null })

    try {
      const detail = await providerApi.resolveApproval(chat.providerId, chat.id, decision)
      if (options.markViewed) applyViewedChatDetail(chat.providerId, detail)
      else applyChatDetail(chat.providerId, detail)
    } catch {
      setApprovalResolution({
        approvalId,
        decision: null,
        error: 'Unable to resolve approval.'
      })
    } finally {
      setApprovalResolution((currentResolution) =>
        currentResolution.approvalId === approvalId
          ? { ...currentResolution, decision: null }
          : currentResolution
      )
    }
  }

  const handleResolveApproval = async (decision: ProviderApprovalDecision): Promise<void> => {
    if (!selectedChat || !pendingApproval || approvalDecisionInFlight) return

    await resolveChatApproval(selectedChat, pendingApproval, decision, { markViewed: true })
  }

  const handleResolveChatApproval = async (
    chat: ProviderChat,
    decision: ProviderApprovalDecision
  ): Promise<void> => {
    const approval =
      chat.pendingApproval ??
      (selectedChat?.providerId === chat.providerId && chatDetail?.id === chat.id
        ? chatDetail.pendingApproval
        : null)
    if (!approval) return

    await resolveChatApproval(chat, approval, decision, { markViewed: false })
  }

  const resolveSelectedUserInput = async (
    response: { kind: 'answer'; answer: string; wasFreeform: boolean } | { kind: 'cancel' }
  ): Promise<void> => {
    if (!selectedChat || !pendingUserInput || userInputResolving || providerUpdateInProgress) return

    const requestId = pendingUserInput.id
    setUserInputResolution({ requestId, resolving: true, error: null })

    try {
      const detail = await providerApi.resolveUserInput(
        selectedChat.providerId,
        selectedChat.id,
        requestId,
        response
      )
      applyViewedChatDetail(selectedChat.providerId, detail)
    } catch (error) {
      setUserInputResolution({
        requestId,
        resolving: false,
        error: getErrorMessage(error, 'Unable to resolve Copilot question.')
      })
      return
    }

    setUserInputResolution((currentResolution) =>
      currentResolution.requestId === requestId
        ? { ...currentResolution, resolving: false }
        : currentResolution
    )
  }

  const handleStopChat = async (): Promise<void> => {
    if (providerUpdateInProgress || !selectedChat || sendInFlightRef.current) return
    sendInFlightRef.current = true
    setSendState('sending')

    try {
      const summary = await providerApi.stopChatSummary(selectedChat.providerId, selectedChat.id)
      applyChatSummary(selectedChat.providerId, summary, true)
      markChatSeenAt(selectedChat.providerId, selectedChat.id, Date.now())
      setSendState('idle')
    } catch (error) {
      handleSendFailure(error, 'Unable to stop chat.')
    } finally {
      sendInFlightRef.current = false
    }
  }

  const handleDeletePendingMessage = useCallback(
    async (message: ProviderPendingMessage): Promise<void> => {
      if (providerUpdateInProgress || !selectedProviderId || !selectedChatId) return

      try {
        const detail = await providerApi.deletePendingMessage(
          selectedProviderId,
          selectedChatId,
          message.id
        )
        applyViewedChatDetail(selectedProviderId, detail)
        if (sendState === 'error') setSendState('idle')
      } catch (error) {
        handleSendFailure(error, 'Unable to delete queued message.')
      }
    },
    [
      applyViewedChatDetail,
      handleSendFailure,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId,
      sendState
    ]
  )

  const handleInterruptPendingMessage = useCallback(
    async (message: ProviderPendingMessage): Promise<void> => {
      if (
        providerUpdateInProgress ||
        !selectedProviderId ||
        !selectedChatId ||
        sendInFlightRef.current
      ) {
        return
      }
      sendInFlightRef.current = true
      setSendState('sending')

      try {
        const detail = await providerApi.interruptPendingMessage(
          selectedProviderId,
          selectedChatId,
          message.id
        )
        applyViewedChatDetail(selectedProviderId, detail)
        setSendState('idle')
      } catch (error) {
        handleSendFailure(error, 'Unable to send queued message.')
      } finally {
        sendInFlightRef.current = false
      }
    },
    [
      applyViewedChatDetail,
      handleSendFailure,
      providerUpdateInProgress,
      selectedChatId,
      selectedProviderId
    ]
  )

  const handleChatContentScroll = (): boolean => {
    const contentElement = contentRef.current
    if (!contentElement) return false

    const currentTurnWindow = chatTurnWindowRef.current
    const adjustmentTarget = chatScrollAdjustmentTargetRef.current
    const isScrollAdjustment = Boolean(
      adjustmentTarget?.element === contentElement &&
      Math.abs(adjustmentTarget.top - contentElement.scrollTop) <= 1
    )
    if (adjustmentTarget?.element === contentElement) {
      chatScrollAdjustmentTargetRef.current = null
    }

    const previousScrollTop = previousChatScrollTopRef.current
    if (
      !isScrollAdjustment &&
      previousScrollTop !== null &&
      Math.abs(contentElement.scrollTop - previousScrollTop) >= 0.5
    ) {
      chatTurnScrollDirectionRef.current =
        contentElement.scrollTop < previousScrollTop ? 'up' : 'down'
    }
    previousChatScrollTopRef.current = contentElement.scrollTop

    const atConversationBottom = Boolean(
      isScrolledToBottom(contentElement) &&
      currentTurnWindow &&
      currentTurnWindow.endIndex >= currentTurnWindow.totalCount
    )
    setChatAtConversationBottom(atConversationBottom)

    const chatKey = currentTurnWindow?.chatKey
    const updateViewportAnchor = (): void => {
      chatViewportAnchorRef.current = chatKey ? readChatScrollAnchor(contentElement, chatKey) : null
    }

    if (isScrollAdjustment) {
      updateViewportAnchor()
      return false
    }

    if (atConversationBottom) {
      chatAutoScrollEnabledRef.current = true
      chatUserScrollIntentRef.current = false
      chatAutoScrollTargetRef.current = {
        element: contentElement,
        top: contentElement.scrollTop
      }
      updateViewportAnchor()
      return true
    }

    const autoScrollTarget = chatAutoScrollTargetRef.current
    if (
      !chatUserScrollIntentRef.current &&
      chatAutoScrollEnabledRef.current &&
      autoScrollTarget?.element === contentElement &&
      autoScrollTarget.top === contentElement.scrollTop
    ) {
      scheduleChatAutoScroll(contentElement)
      updateViewportAnchor()
      return true
    }

    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null
    chatUserScrollIntentRef.current = false
    updateViewportAnchor()
    return true
  }

  const handleChatContentWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY !== 0) {
      chatTurnScrollDirectionRef.current = event.deltaY < 0 ? 'up' : 'down'
    }
    chatUserScrollIntentRef.current = event.deltaY < 0
    if (!chatUserScrollIntentRef.current || chatUserScrollIntentFrameRef.current !== null) return

    chatUserScrollIntentFrameRef.current = window.requestAnimationFrame(() => {
      chatUserScrollIntentFrameRef.current = null
      chatUserScrollIntentRef.current = false
    })
  }

  const renderChatGroup = (group: ChatListGroupData, contentId: string): React.ReactElement => {
    const groupOpen =
      searchTerms.length > 0 || !getCollapsedGroupState(group.key, collapsedCwdGroups)
    const chatPageSize = effectiveAppSettings.performance.maxChatsRendered
    const visibleChatCount =
      group.kind === 'pinned'
        ? group.chats.length
        : (visibleChatPageCountsByGroup[group.key] ?? 1) * chatPageSize

    return (
      <ChatListGroup
        contentId={contentId}
        group={group}
        key={group.key}
        open={groupOpen}
        selectedChatKey={selectedChat ? getChatKey(selectedChat) : null}
        committingChatKeys={committingChatKeys}
        canReorderChats={searchTerms.length === 0}
        visibleChatCount={visibleChatCount}
        chatPageSize={chatPageSize}
        onLoadMoreChats={group.kind === 'pinned' ? undefined : handleLoadMoreChatsInGroup}
        onShowLessChats={group.kind === 'pinned' ? undefined : handleShowLessChatsInGroup}
        projectIconSrc={projectIconsByGroup[group.key]?.dataUrl ?? null}
        onMarkChatDone={handleMarkChatDone}
        onMarkCwdChatsDone={(nextGroup) => void handleMarkCwdChatsDone(nextGroup)}
        onNewChatInCwd={handleNewChatInCwd}
        onRenameChat={handleRenameChat}
        onSelectProjectIcon={(nextGroup) => void handleSelectProjectIcon(nextGroup)}
        onResolveApproval={(chat, decision) => void handleResolveChatApproval(chat, decision)}
        onReorderPinnedChats={handleReorderPinnedChats}
        onSelectChat={handleSelectChat}
        onToggle={handleToggleCwdGroup}
        onToggleChatPinned={handleToggleChatPinned}
        onUnpinPinnedChats={(nextGroup) => void handleUnpinPinnedChats(nextGroup)}
        resolvingApprovalId={resolvingApprovalId}
      />
    )
  }

  const chatHasActiveTurn = isActiveChatStatus(chatDetail?.status)
  const chatHasPendingSteeringMessage = hasPendingSteeringMessage(chatDetail)
  const chatIsBusy =
    chatHasActiveTurn || (sendState === 'sending' && hasActiveWorkingStep(chatDetail))

  const handleQuoteSelectedMessageText = useCallback((content: string): void => {
    setMessageBoxQuoteRequest((currentRequest) => ({
      id: (currentRequest?.id ?? 0) + 1,
      content
    }))
  }, [])

  useEffect(() => {
    runPromptActionRef.current = async (prompt, target) => {
      await handleSendMessage(prompt, undefined, [], null, [], [], undefined, target)
    }
  })

  const messageBoxProviderAvailable = selectedChat ? true : newSessionProviderAvailable
  const messageBoxDisabled = selectedChat
    ? providerUpdateInProgress ||
      chatLoadState !== 'ready' ||
      Boolean(selectedChatAiCommitAction) ||
      (chatHasActiveTurn && !chatDetail?.capabilities.activeMessages)
    : providerUpdateInProgress || !newSessionProviderAvailable
  const canEditOwnMessages = Boolean(
    selectedChat &&
    chatDetail?.capabilities.editMessages &&
    chatLoadState === 'ready' &&
    sendState !== 'sending' &&
    !providerUpdateInProgress &&
    !editingMessage
  )
  const visibleChatItems = useMemo(() => chatDetail?.items ?? [], [chatDetail?.items])
  const chatConversationModel = useMemo(
    () => buildChatConversationModel(visibleChatItems),
    [visibleChatItems]
  )
  const chatTurns = chatConversationModel.turns
  const defaultChatTurnWindow = useMemo<ChatTurnWindow | null>(() => {
    if (!selectedChatKey) return null
    return getLatestChatTurnWindow(selectedChatKey, chatTurns.length, chatTurnPageSize)
  }, [chatTurns.length, selectedChatKey])
  const effectiveChatTurnWindow =
    chatTurnWindow?.chatKey === selectedChatKey ? chatTurnWindow : defaultChatTurnWindow
  const renderedChatTurns = useMemo(
    () =>
      effectiveChatTurnWindow
        ? chatConversationModel.turns.slice(
            effectiveChatTurnWindow.startIndex,
            effectiveChatTurnWindow.endIndex
          )
        : [],
    [chatConversationModel, effectiveChatTurnWindow]
  )

  useEffect(() => {
    let active = true
    chatTurnPageLoadRequestRef.current += 1
    chatTurnPageLoadInFlightRef.current = false
    chatTurnScrollDirectionRef.current = null
    queueMicrotask(() => {
      if (!active) return
      setChatTurnPageLoadDirection(null)

      if (!selectedChatKey) {
        chatTurnWindowRef.current = null
        setChatTurnWindow(null)
        return
      }

      setChatTurnWindow((currentWindow) => {
        const totalCount = chatTurns.length
        const viewingLatest =
          currentWindow?.chatKey !== selectedChatKey ||
          currentWindow.endIndex >= currentWindow.totalCount ||
          chatAutoScrollEnabledRef.current
        const nextWindow: ChatTurnWindow = viewingLatest
          ? getLatestChatTurnWindow(selectedChatKey, totalCount, chatTurnPageSize)
          : {
              chatKey: selectedChatKey,
              startIndex: Math.min(currentWindow.startIndex, totalCount),
              endIndex: Math.min(currentWindow.endIndex, totalCount),
              totalCount
            }
        chatTurnWindowRef.current = nextWindow
        if (viewingLatest) scrollToLatestTurnAfterRenderRef.current = true
        return nextWindow
      })
    })

    return () => {
      active = false
    }
  }, [chatTurns.length, selectedChatKey])

  useLayoutEffect(() => {
    const anchor = pendingChatScrollAnchorRef.current
    if (!anchor || anchor.chatKey !== selectedChatKey) return

    pendingChatScrollAnchorRef.current = null
    const contentElement = contentRef.current
    if (!contentElement || !restoreChatScrollAnchor(contentElement, anchor)) return

    chatScrollAdjustmentTargetRef.current = {
      element: contentElement,
      top: contentElement.scrollTop
    }
    chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, anchor.chatKey)
  }, [effectiveChatTurnWindow?.endIndex, effectiveChatTurnWindow?.startIndex, selectedChatKey])

  useLayoutEffect(() => {
    if (!scrollToLatestTurnAfterRenderRef.current || renderedChatTurns.length === 0) return
    scrollToLatestTurnAfterRenderRef.current = false
    pendingChatScrollAnchorRef.current = null
    const contentElement = contentRef.current
    if (contentElement) scrollChatContentToBottom(contentElement)
  }, [effectiveChatTurnWindow?.endIndex, renderedChatTurns.length, scrollChatContentToBottom])

  const loadChatTurnPage = useCallback(
    async (direction: ChatTurnPageLoadDirection): Promise<void> => {
      const chat = selectedChatRef.current
      const currentWindow = chatTurnWindowRef.current
      if (
        !chat ||
        !currentWindow ||
        currentWindow.chatKey !== getChatKey(chat) ||
        chatTurnPageLoadInFlightRef.current
      ) {
        return
      }

      if (direction === 'older' && currentWindow.startIndex === 0) return
      if (direction === 'newer' && currentWindow.endIndex >= currentWindow.totalCount) return

      const requestId = chatTurnPageLoadRequestRef.current + 1
      chatTurnPageLoadRequestRef.current = requestId
      chatTurnPageLoadInFlightRef.current = true
      setChatTurnPageLoadDirection(direction)

      try {
        if (direction === 'latest') {
          const detail = await providerApi.getChat(chat.providerId, chat.id)
          if (
            chatTurnPageLoadRequestRef.current !== requestId ||
            selectedChatKeyRef.current !== currentWindow.chatKey
          ) {
            return
          }

          const totalCount = getProviderChatTurns(detail.items).length
          const nextWindow = getLatestChatTurnWindow(
            currentWindow.chatKey,
            totalCount,
            chatTurnPageSize
          )
          chatAutoScrollEnabledRef.current = true
          chatTurnScrollDirectionRef.current = 'down'
          scrollToLatestTurnAfterRenderRef.current = true
          pendingChatScrollAnchorRef.current = null
          chatViewportAnchorRef.current = null
          chatTurnWindowRef.current = nextWindow
          setChatTurnWindow(nextWindow)
          applyViewedChatDetail(chat.providerId, detail)
          return
        }

        const startIndex =
          direction === 'older'
            ? Math.max(0, currentWindow.startIndex - chatTurnPageSize)
            : currentWindow.endIndex
        const limit =
          direction === 'older' ? currentWindow.startIndex - startIndex : chatTurnPageSize
        const page = await providerApi.getChatTurnPage(chat.providerId, chat.id, startIndex, limit)
        if (
          chatTurnPageLoadRequestRef.current !== requestId ||
          selectedChatKeyRef.current !== currentWindow.chatKey
        ) {
          return
        }

        const latestWindow = chatTurnWindowRef.current
        if (!latestWindow || latestWindow.chatKey !== currentWindow.chatKey) return

        const totalCount = Math.max(latestWindow.totalCount, page.totalCount)
        const loadedEndIndex = Math.min(totalCount, page.startIndex + limit)
        const nextWindow = shiftChatTurnWindow(
          latestWindow,
          direction,
          page.startIndex,
          loadedEndIndex,
          totalCount,
          chatTurnWindowSize
        )
        const contentElement = contentRef.current
        pendingChatScrollAnchorRef.current = contentElement
          ? readChatScrollAnchor(contentElement, latestWindow.chatKey, nextWindow)
          : null
        chatAutoScrollEnabledRef.current = false
        chatAutoScrollTargetRef.current = null
        chatTurnWindowRef.current = nextWindow

        flushSync(() => {
          setChatDetail((currentDetail) => {
            if (currentDetail?.id !== chat.id) return currentDetail
            const mergedDetail = mergeLoadedChatTurnItems(currentDetail, page.items)
            const items = unloadChatItemsOutsideTurnRange(
              mergedDetail.items,
              nextWindow.startIndex,
              nextWindow.endIndex
            )
            const nextDetail =
              items === mergedDetail.items ? mergedDetail : { ...mergedDetail, items }
            chatDetailRef.current = nextDetail
            return nextDetail
          })
          setChatTurnWindow(nextWindow)
        })

        if (!pendingChatScrollAnchorRef.current && contentElement) {
          chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, latestWindow.chatKey)
        }
      } finally {
        if (chatTurnPageLoadRequestRef.current === requestId) {
          chatTurnPageLoadInFlightRef.current = false
          setChatTurnPageLoadDirection(null)
        }
      }
    },
    [applyViewedChatDetail]
  )

  const handleNativeChatContentScroll = (): void => {
    if (!handleChatContentScroll()) return

    const contentElement = contentRef.current
    const currentWindow = chatTurnWindowRef.current
    if (!contentElement || !currentWindow || chatTurnPageLoadInFlightRef.current) return

    if (
      chatTurnScrollDirectionRef.current === 'up' &&
      contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      currentWindow.startIndex > 0
    ) {
      void loadChatTurnPage('older')
      return
    }

    if (
      chatTurnScrollDirectionRef.current === 'down' &&
      getScrollBottomTop(contentElement) - contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      currentWindow.endIndex < currentWindow.totalCount
    ) {
      void loadChatTurnPage('newer')
    }
  }

  const handleNativeChatContentWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    handleChatContentWheel(event)
    const contentElement = contentRef.current
    const currentWindow = chatTurnWindowRef.current
    if (!contentElement || !currentWindow || chatTurnPageLoadInFlightRef.current) return

    if (
      event.deltaY < 0 &&
      contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      currentWindow.startIndex > 0
    ) {
      void loadChatTurnPage('older')
    } else if (
      event.deltaY > 0 &&
      getScrollBottomTop(contentElement) - contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      currentWindow.endIndex < currentWindow.totalCount
    ) {
      void loadChatTurnPage('newer')
    }
  }

  const stoppedTurnRetryMessages = chatConversationModel.stoppedTurnRetryMessages
  const canRetryStoppedTurns = Boolean(selectedChat && chatDetail?.capabilities.editMessages)
  const stoppedTurnActionDisabled =
    chatLoadState !== 'ready' ||
    sendState === 'sending' ||
    providerUpdateInProgress ||
    chatHasActiveTurn ||
    Boolean(editingMessage) ||
    Boolean(selectedChatAiCommitAction)
  const workingStepIdsWithNextWorkingStep = chatConversationModel.workingStepIdsWithNextWorkingStep
  const followingWorkingStepsById = chatConversationModel.followingWorkingStepsById
  const continuedStoppedWorkingStepIds = useMemo(
    () => new Set(selectedChatKey ? continuedStoppedWorkingStepsByChat[selectedChatKey] : []),
    [continuedStoppedWorkingStepsByChat, selectedChatKey]
  )
  const firstPendingChatItemId = chatConversationModel.firstPendingItemId
  const chatItemIndexesById = chatConversationModel.itemIndexesById
  const [
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers
  ] = useMemo(() => {
    const visibleItemsById = new Map(visibleChatItems.map((item) => [item.id, item]))
    const allItemIds = chatConversationModel.itemIds
    const markersByBeforeItemId = new Map<string, ChatCommitMarker[]>()
    const markersByAfterItemId = new Map<string, ChatCommitMarker[]>()
    const trailingMarkers: ChatCommitMarker[] = []

    const placeMarkerByTime = (marker: ChatCommitMarker): void => {
      const placementTime = getChatCommitMarkerPlacementTime(marker)
      const nextItem = visibleChatItems.find((item) => {
        const createdAt = getChatItemCreatedAt(item)
        return createdAt !== null && createdAt > placementTime
      })

      if (!nextItem) {
        trailingMarkers.push(marker)
        return
      }

      const markersBeforeItem = markersByBeforeItemId.get(nextItem.id) ?? []
      markersBeforeItem.push(marker)
      markersByBeforeItemId.set(nextItem.id, markersBeforeItem)
    }

    selectedChatCommitMarkers.forEach((marker) => {
      if (!marker.afterItemId) {
        placeMarkerByTime(marker)
        return
      }
      const anchorItem = visibleItemsById.get(marker.afterItemId)
      if (!anchorItem) {
        if (!allItemIds.has(marker.afterItemId)) placeMarkerByTime(marker)
        return
      }
      if (anchorItem.type === 'pendingMessage') {
        placeMarkerByTime(marker)
        return
      }

      const anchorItemIndex = chatItemIndexesById.get(marker.afterItemId)
      const anchorTimelineTime =
        marker.finishedAt !== null && anchorItemIndex !== undefined
          ? visibleChatItems
              .slice(0, anchorItemIndex + 1)
              .findLast((item) => getChatItemCreatedAt(item) !== null)
          : null
      const anchorCreatedAt = anchorTimelineTime ? getChatItemCreatedAt(anchorTimelineTime) : null
      if (
        marker.finishedAt !== null &&
        anchorCreatedAt !== null &&
        anchorCreatedAt > marker.finishedAt
      ) {
        placeMarkerByTime(marker)
        return
      }

      const anchoredMarkers = markersByAfterItemId.get(marker.afterItemId) ?? []
      anchoredMarkers.push(marker)
      markersByAfterItemId.set(marker.afterItemId, anchoredMarkers)
    })

    return [markersByBeforeItemId, markersByAfterItemId, trailingMarkers] as const
  }, [chatConversationModel, chatItemIndexesById, selectedChatCommitMarkers, visibleChatItems])
  const lastStreamingChatItem = chatHasActiveTurn ? chatConversationModel.lastNonPendingItem : null
  const streamingChatItemId =
    lastStreamingChatItem?.type === 'message' && lastStreamingChatItem.role === 'assistant'
      ? lastStreamingChatItem.id
      : null
  useEffect(() => {
    let recentChatCacheItemCount = 0
    for (const entry of recentChatCacheRef.current.values()) {
      recentChatCacheItemCount += entry.detail.items.length
    }

    const rootDataset = document.documentElement.dataset
    rootDataset.selectedChatItemCount = String(chatDetail?.items.length ?? 0)
    rootDataset.recentChatCacheEntryCount = String(recentChatCacheRef.current.size)
    rootDataset.recentChatCacheItemCount = String(recentChatCacheItemCount)
    rootDataset.selectedChatTurnCount = String(chatTurns.length)
    rootDataset.renderedChatTurnCount = String(renderedChatTurns.length)
    rootDataset.chatSearchOpen = chatSearchOpen ? 'true' : 'false'

    return () => {
      delete rootDataset.selectedChatItemCount
      delete rootDataset.recentChatCacheEntryCount
      delete rootDataset.recentChatCacheItemCount
      delete rootDataset.selectedChatTurnCount
      delete rootDataset.renderedChatTurnCount
      delete rootDataset.chatSearchOpen
    }
  }, [
    chatDetail?.items.length,
    chatSearchOpen,
    chatTurns.length,
    renderedChatTurns.length,
    selectedChatKey
  ])

  const messageBoxContextUsage = useMemo(() => {
    const contextUsage = chatDetail?.contextUsage ?? null
    if (contextUsage) {
      return {
        source: 'exact' as const,
        usedTokens: contextUsage.usedTokens,
        maxTokens: contextUsage.maxTokens
      }
    }

    const estimatedTokens = getEstimatedContextTokens(chatDetail?.items)
    return {
      source: estimatedTokens == null ? ('unavailable' as const) : ('estimated' as const),
      usedTokens: estimatedTokens,
      maxTokens: null
    }
  }, [chatDetail?.contextUsage, chatDetail?.items])
  const chatPanelOpen = Boolean(selectedChat) || newChatOpen
  const patchChangeSourceSelected = isPatchChangeSource(changeSource)
  const patchSourceChangedFiles = useMemo(() => {
    if (changeSource === 'chat') return getChatChangedFiles(visibleChatItems)
    if (changeSource === 'lastTurn') return getLastTurnChangedFiles(visibleChatItems)

    return []
  }, [changeSource, visibleChatItems])
  const patchSourcePatches = useMemo(
    () => getCommitPatches(patchSourceChangedFiles),
    [patchSourceChangedFiles]
  )
  const patchFilterSignature = useMemo(
    () => getPatchFilterSignature(patchSourcePatches),
    [patchSourcePatches]
  )
  const patchFilterMatches = isPatchFilterScope(
    uncommittedPatchFilter?.scope ?? null,
    changesContainerKey,
    changesCwd,
    changeSource,
    patchFilterSignature
  )
  const patchChangedFiles = useMemo(
    () =>
      patchFilterMatches
        ? filterChangedFilesByPatches(
            patchSourceChangedFiles,
            uncommittedPatchFilter?.patches ?? []
          )
        : [],
    [patchFilterMatches, patchSourceChangedFiles, uncommittedPatchFilter?.patches]
  )
  useEffect(() => {
    if (!changesCwd || !isPatchChangeSource(changeSource) || !patchFilterMatches) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setCachedPatchChangedFiles({
        containerKey: changesContainerKey,
        cwd: changesCwd,
        source: changeSource,
        files: patchChangedFiles
      })
    })

    return () => {
      active = false
    }
  }, [changeSource, changesContainerKey, changesCwd, patchChangedFiles, patchFilterMatches])
  const currentGitChangeSource: GitChangeSource | null =
    changeSource === 'uncommitted' ? 'uncommitted' : null
  const gitChangesMatchCurrentSource = isGitChangesScope(
    gitChangesScope,
    gitAvailabilityScopeKey,
    changesCwd,
    currentGitChangeSource
  )
  const displayedGitChanges = gitChangesMatchCurrentSource ? gitChanges : null
  const gitChangedFiles = useMemo(
    () => (changesCwd ? getGitChangedFiles(displayedGitChanges) : []),
    [changesCwd, displayedGitChanges]
  )
  const uncommittedGitChangesMatchCurrentCwd = isGitChangesScope(
    gitChangesScope,
    gitAvailabilityScopeKey,
    changesCwd,
    'uncommitted'
  )
  const uncommittedChangedFiles = useMemo(
    () =>
      changesCwd && uncommittedGitChangesMatchCurrentCwd ? getGitChangedFiles(gitChanges) : [],
    [changesCwd, gitChanges, uncommittedGitChangesMatchCurrentCwd]
  )
  const fileTreeMatchesCurrentCwd = isFileTreeScope(fileTreeScope, changesContainerKey, changesCwd)
  const displayedFileTree = fileTreeMatchesCurrentCwd ? fileTree : null
  const rawRepositoryFiles = useMemo(
    () => (changesCwd ? getRepositoryFiles(displayedFileTree) : []),
    [changesCwd, displayedFileTree]
  )
  const repositoryFilesDisplayRoot =
    displayedFileTree?.repositoryRoot ?? changesProjectCwd ?? changesCwd ?? null
  const repositoryFiles = useMemo(
    () => getTreeFilesWithDisplayPaths(rawRepositoryFiles, repositoryFilesDisplayRoot),
    [rawRepositoryFiles, repositoryFilesDisplayRoot]
  )
  const gitChangeLoadMatchesCurrentSource = isGitChangesScope(
    gitChangeLoadScope,
    gitAvailabilityScopeKey,
    changesCwd,
    currentGitChangeSource
  )
  const changesLoadState =
    patchChangeSourceSelected && patchSourcePatches.length > 0
      ? patchFilterMatches
        ? uncommittedPatchFilterState
        : 'loading'
      : patchChangeSourceSelected || !changesCwd
        ? 'ready'
        : gitChangeLoadMatchesCurrentSource
          ? gitChangeLoadState
          : 'loading'
  const fileTreeLoadMatchesCurrentCwd = isFileTreeScope(
    fileTreeLoadScope,
    changesContainerKey,
    changesCwd
  )
  const filesLoadState = !changesCwd
    ? 'ready'
    : fileTreeLoadMatchesCurrentCwd
      ? fileTreeLoadState
      : 'loading'
  const visibleFilesLoadState =
    filesLoadState === 'loading' && displayedFileTree ? 'ready' : filesLoadState
  const cachedPatchChangedFilesMatch = Boolean(
    cachedPatchChangedFiles &&
    changesCwd &&
    isPatchChangeSource(changeSource) &&
    cachedPatchChangedFiles.containerKey === changesContainerKey &&
    cachedPatchChangedFiles.cwd === changesCwd &&
    cachedPatchChangedFiles.source === changeSource
  )
  const displayedPatchChangedFiles =
    changesLoadState === 'loading' && cachedPatchChangedFilesMatch
      ? (cachedPatchChangedFiles?.files ?? [])
      : patchChangedFiles
  const preserveDisplayedGitChanges =
    changeSource === 'uncommitted' && displayedGitChanges !== null && changesLoadState !== 'ready'
  const visibleChangesLoadState =
    preserveDisplayedGitChanges ||
    (changesLoadState === 'loading' &&
      patchChangeSourceSelected &&
      displayedPatchChangedFiles.length > 0)
      ? 'ready'
      : changesLoadState
  const rawChangedFiles =
    changeSource === 'chat'
      ? displayedPatchChangedFiles
      : changeSource === 'lastTurn'
        ? displayedPatchChangedFiles
        : gitChangedFiles
  const changedFilesDisplayRoot =
    displayedGitChanges?.repositoryRoot ?? changesProjectCwd ?? changesCwd ?? null
  const changedFiles = useMemo(
    () => getTreeFilesWithDisplayPaths(rawChangedFiles, changedFilesDisplayRoot),
    [changedFilesDisplayRoot, rawChangedFiles]
  )
  const fileEditorDiffTargets = useMemo<FileEditorTarget[]>(
    () =>
      changesCwd
        ? changedFiles.map((file) => ({
            container: changesContainer,
            cwd: changesCwd,
            path: file.path,
            displayPath: getChangedFileDisplayPath(file),
            kind: file.kind,
            previousPath: file.previousPath ?? null
          }))
        : [],
    [changedFiles, changesContainer, changesCwd]
  )
  const gitSyncMetadata = changesCwd && gitChangesScope?.cwd === changesCwd ? gitChanges : null
  const unpulledCount = gitSyncMetadata?.unpulledCount ?? 0
  const unpushedCount = gitSyncMetadata?.unpushedCount ?? 0
  const hasUnpulledChanges = unpulledCount > 0
  const hasUnpushedChanges = unpushedCount > 0
  const hasSyncChanges = hasUnpulledChanges || hasUnpushedChanges
  const primarySyncAction: GitSyncAction =
    hasUnpulledChanges && hasUnpushedChanges ? 'pullAndPush' : hasUnpulledChanges ? 'pull' : 'push'
  const syncButtonTitle = [
    hasUnpulledChanges ? `${unpulledCount} commit${unpulledCount === 1 ? '' : 's'} to pull` : null,
    hasUnpushedChanges ? `${unpushedCount} commit${unpushedCount === 1 ? '' : 's'} to push` : null
  ]
    .filter(Boolean)
    .join(', ')
  const changesGitMetadata = changesCwd && gitChangesScope?.cwd === changesCwd ? gitChanges : null
  const filesMetadata = changesCwd && fileTreeScope?.cwd === changesCwd ? fileTree : null
  const branchMetadata = changesCwd && gitBranchesScope?.cwd === changesCwd ? gitBranches : null
  const currentBranchName =
    branchMetadata?.currentBranch ??
    (changesPaneView === 'files' ? filesMetadata?.branchName : changesGitMetadata?.branchName) ??
    changesGitMetadata?.branchName ??
    selectedChat?.branchName ??
    null
  const branchNames = branchMetadata?.branches ?? (currentBranchName ? [currentBranchName] : [])
  const newSessionLocationOptions = useMemo<DropdownOption<NewSessionLocation>[]>(
    () => [
      {
        value: 'folder',
        label: 'Folder',
        icon: <FolderKanban aria-hidden="true" />
      },
      {
        value: 'worktree',
        label: 'Worktree',
        menuLabel: currentBranchName ? `Worktree · ${currentBranchName}` : 'Worktree',
        icon: <GitBranch aria-hidden="true" />
      }
    ],
    [currentBranchName]
  )
  const commitInputValue = commitInput.trim()
  const commitFiles = useMemo(() => getCommitFiles(changedFiles), [changedFiles])
  const syncInProgress = syncState === 'sending'
  const commitMessageGenerationInProgress = commitMessageGenerationState === 'sending'
  const visibleSyncRecovery = syncRecovery && syncRecovery.cwd === changesCwd ? syncRecovery : null
  const currentProjectCommitActivities = useMemo(() => {
    const currentProjectKey = getChatCwdGroupKey(changesProjectCwd ?? changesCwd)

    return [...Object.values(scopedCommitActivities), ...Object.values(directCommitActivities)]
      .filter((activity) => getChatCwdGroupKey(activity.projectCwd) === currentProjectKey)
      .sort((firstActivity, secondActivity) => firstActivity.startedAt - secondActivity.startedAt)
  }, [changesCwd, changesProjectCwd, directCommitActivities, scopedCommitActivities])
  const projectCommitInProgress = currentProjectCommitActivities.length > 0
  const directProjectCommitInProgress = currentProjectCommitActivities.some(
    (activity) => activity.source === 'git'
  )
  const currentChatAiCommitInProgress = currentProjectCommitActivities.some(
    (activity) =>
      activity.source === 'ai' &&
      (selectedChat
        ? activity.providerId === selectedChat.providerId &&
          activity.sourceChatId === selectedChat.id
        : activity.sourceChatId == null)
  )
  const aiCommitUnavailable =
    sendState === 'sending' ||
    Boolean(editingMessage) ||
    (selectedChat ? !chatDetail || chatLoadState !== 'ready' || chatIsBusy : false)
  const commitBaseDisabled =
    providerUpdateInProgress ||
    commitFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    commitState === 'sending' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress ||
    syncInProgress
  const getCommitActionDisabled = (
    action: GitCommitPromptAction,
    message = commitInputValue
  ): boolean => commitBaseDisabled || !changesCwd || (action === 'commit' && !message)
  const commitDisabled = getCommitActionDisabled('commit')
  const aiCommitBaseDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
    uncommittedChangedFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    commitState === 'sending' ||
    commitMessageGenerationInProgress ||
    directProjectCommitInProgress ||
    currentChatAiCommitInProgress ||
    syncInProgress ||
    aiCommitUnavailable
  const getAiCommitActionDisabled = (): boolean => aiCommitBaseDisabled
  const commitMessageGenerationDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
    uncommittedChangedFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    commitState === 'sending' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress ||
    syncInProgress
  const commitInputLabel = 'Commit message or AI instructions'
  const syncDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
    gitAvailableForCurrentSource === false ||
    syncInProgress ||
    commitState === 'sending' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress
  const branchSwitchDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
    gitAvailableForCurrentSource === false ||
    gitBranchActionState === 'sending' ||
    syncInProgress ||
    commitState === 'sending' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress ||
    chatIsBusy
  const syncDropdownActions: ButtonDropdownAction[] = [
    ...(hasUnpulledChanges
      ? [
          {
            id: 'pull',
            label: `Pull ${unpulledCount}`,
            disabled: syncDisabled,
            callback: () => void handleSyncChanges('pull'),
            icon: <Download aria-hidden="true" />
          }
        ]
      : []),
    ...(hasUnpushedChanges
      ? [
          {
            id: 'push',
            label: `Push ${unpushedCount}`,
            disabled: syncDisabled,
            callback: () => void handleSyncChanges('push'),
            icon: <Upload aria-hidden="true" />
          }
        ]
      : [])
  ]
  const gitAiResolutionDisabled =
    providerUpdateInProgress ||
    syncInProgress ||
    sendState === 'sending' ||
    Boolean(editingMessage) ||
    (selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false)
  const changesEmptyMessage = getChangesEmptyMessage(changeSource, changesCwd)
  const filesEmptyMessage = getFileTreeEmptyMessage(changesCwd)
  const changeTree = useMemo(() => buildChangeTree(changedFiles), [changedFiles])
  const repositoryFileTree = useMemo(
    () => buildProgressiveFileTree(repositoryFiles, lastOpenedFileTreeFolderPath),
    [lastOpenedFileTreeFolderPath, repositoryFiles]
  )
  const changeTreeFolderPaths = useMemo(() => getTreeFolderPaths(changeTree), [changeTree])
  const repositoryFileTreeFolderPaths = useMemo(
    () => getTreeFolderPaths(repositoryFileTree),
    [repositoryFileTree]
  )
  const activeTreeFolderPaths =
    changesPaneView === 'files' ? repositoryFileTreeFolderPaths : changeTreeFolderPaths
  const activeCollapsedTreeFolders =
    changesPaneView === 'files' ? collapsedFileTreeFolders : collapsedChangeTreeFolders
  const hasCollapsedActiveTreeFolders = activeTreeFolderPaths.some(
    (folderPath) => activeCollapsedTreeFolders[folderPath]
  )
  const treeToggleLabel = hasCollapsedActiveTreeFolders ? 'Expand all' : 'Collapse all'
  const activeSidebarLoadState = changesPaneView === 'files' ? filesLoadState : changesLoadState
  const refreshSidebarLabel = changesPaneView === 'files' ? 'Refresh files' : 'Refresh changes'
  const usePercentagePaneTracks = Boolean(panePercents) || panelsWidth > 0
  const panelsStyle = {
    '--chat-sidebar-width': usePercentagePaneTracks
      ? formatChatPanePercent(displayedPanePercents.sidebar)
      : `${chatSidebarDefaultWidth}px`,
    '--chat-changes-width': usePercentagePaneTracks
      ? formatChatPanePercent(displayedPanePercents.changes)
      : `${changesSidebarDefaultWidth}px`
  } as CSSProperties

  const getChangeTreeRowStyle = (depth: number): CSSProperties =>
    ({ '--change-tree-depth': depth }) as CSSProperties

  const handleToggleChangeTreeFolder = (folderPath: string): void => {
    setCollapsedChangeTreeFolders((currentFolders) => ({
      ...currentFolders,
      [folderPath]: !currentFolders[folderPath]
    }))
  }

  const handleToggleFileTreeFolder = (folderPath: string, childrenPrecomputed: boolean): void => {
    const collapsed = !childrenPrecomputed || Boolean(collapsedFileTreeFolders[folderPath])

    if (collapsed) setLastOpenedFileTreeFolderPath(folderPath)

    setCollapsedFileTreeFolders((currentFolders) => {
      const nextFolders = { ...currentFolders }

      if (collapsed) {
        delete nextFolders[folderPath]
        if (changesCwd) lastOpenedFileTreeFolderByCwdRef.current.set(changesCwd, folderPath)
      } else {
        nextFolders[folderPath] = true
      }

      if (changesCwd) collapsedFileTreeFoldersByCwdRef.current.set(changesCwd, nextFolders)

      return nextFolders
    })
  }

  const handleSwitchBranch = async (branchName: string, create: boolean): Promise<boolean> => {
    if (branchSwitchDisabled || !changesCwd) return false

    const cwd = changesCwd
    const requestId = ++gitBranchRequestIdRef.current
    setGitBranchActionState('sending')
    setGitBranchError(null)
    setGitBranchDeleteRetry(null)
    setGitBranchWorktreeDeleteRetry(null)

    try {
      const result = await appApi.switchGitBranch({
        branchName,
        container: changesContainer,
        create,
        cwd
      })
      if (gitBranchRequestIdRef.current === requestId) {
        setGitBranches(result)
        setGitBranchesScope({ sourceKey: gitAvailabilityScopeKey, cwd })
        setGitBranchLoadState('ready')
        setGitBranchActionState('idle')
        setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
        setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
      }
      return true
    } catch (error) {
      if (gitBranchRequestIdRef.current === requestId) {
        setGitBranchActionState('error')
        setGitBranchError(
          getErrorMessage(
            error,
            create ? 'Unable to create this branch.' : 'Unable to switch branches.'
          )
        )
      }
      return false
    }
  }

  const handleDeleteBranch = async (
    branchName: string,
    scope?: AppGitDeleteBranchScope,
    force = false,
    removeWorktree = false
  ): Promise<void> => {
    if (branchSwitchDisabled || !changesCwd) return

    const cwd = changesCwd
    const requestId = ++gitBranchRequestIdRef.current
    setGitBranchActionState('sending')
    setGitBranchError(null)
    setGitBranchDeleteRetry(null)
    setGitBranchWorktreeDeleteRetry(null)

    try {
      const result = await appApi.deleteGitBranch({
        branchName,
        container: changesContainer,
        cwd,
        force,
        removeWorktree,
        scope
      })
      if (gitBranchRequestIdRef.current !== requestId) return

      if (result.branches) {
        setGitBranches(result.branches)
        setGitBranchesScope({ sourceKey: gitAvailabilityScopeKey, cwd })
        setGitBranchLoadState('ready')
      }

      if (result.cancelled) {
        setGitBranchActionState('idle')
        return
      }

      if (result.deleted) {
        setGitBranchActionState('idle')
        setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
        setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
        return
      }

      setGitBranchActionState('error')
      setGitBranchError(result.error ?? 'Unable to delete this branch.')
      if (result.forceSuggested && result.scope) {
        setGitBranchDeleteRetry({ branchName, scope: result.scope })
      }
      if (result.worktreePath && result.scope) {
        setGitBranchWorktreeDeleteRetry({
          branchName,
          force: result.force,
          scope: result.scope,
          worktreePath: result.worktreePath
        })
      }
    } catch (error) {
      if (gitBranchRequestIdRef.current !== requestId) return

      setGitBranchActionState('error')
      setGitBranchError(getErrorMessage(error, 'Unable to delete this branch.'))
    }
  }

  const handleForceDeleteBranch = async (): Promise<void> => {
    if (!gitBranchDeleteRetry) return

    await handleDeleteBranch(gitBranchDeleteRetry.branchName, gitBranchDeleteRetry.scope, true)
  }

  const handleDeleteBranchWorktree = async (): Promise<void> => {
    if (!gitBranchWorktreeDeleteRetry) return

    await handleDeleteBranch(
      gitBranchWorktreeDeleteRetry.branchName,
      gitBranchWorktreeDeleteRetry.scope,
      gitBranchWorktreeDeleteRetry.force,
      true
    )
  }

  const handleToggleActiveTreeFolders = (): void => {
    if (activeTreeFolderPaths.length === 0) return

    const nextCollapsedFolders = hasCollapsedActiveTreeFolders
      ? {}
      : getCollapsedTreeFolders(activeTreeFolderPaths)

    if (changesPaneView === 'files') {
      if (changesCwd) {
        collapsedFileTreeFoldersByCwdRef.current.set(changesCwd, nextCollapsedFolders)
      }
      setCollapsedFileTreeFolders(nextCollapsedFolders)
      return
    }

    setCollapsedChangeTreeFolders(nextCollapsedFolders)
  }

  const handleOpenFile = (file: TreeFile): void => {
    if (!changesCwd) return

    setFileEditorTarget({
      container: changesContainer,
      cwd: changesCwd,
      path: file.path,
      displayPath: getChangedFileDisplayPath(file),
      kind: file.kind ?? null,
      previousPath: file.previousPath ?? null
    })
  }

  const handleOpenFileLink = useCallback(
    (path: string, displayPath: string, line?: number, endLine?: number): void => {
      if (!changesCwd) return

      const normalizedCwd = changesCwd.replace(/\\/g, '/').replace(/\/+$/, '')
      const normalizedDisplayPath = displayPath.replace(/\\/g, '/')
      const relativeDisplayPath = normalizedDisplayPath.startsWith(`${normalizedCwd}/`)
        ? normalizedDisplayPath.slice(normalizedCwd.length + 1)
        : normalizedDisplayPath

      setFileEditorTarget({
        container: changesContainer,
        cwd: changesCwd,
        path,
        displayPath: relativeDisplayPath,
        line,
        endLine
      })
    },
    [changesContainer, changesCwd]
  )

  const handleOpenAttachment = useCallback(
    (attachment: AppSelectedAttachment): void => {
      if (!changesCwd) return

      setFileEditorTarget({
        cwd: changesCwd,
        path: attachment.path,
        displayPath: attachment.name
      })
    },
    [changesCwd]
  )

  const handleCloseFileEditor = useCallback((): void => {
    setFileEditorTarget(null)
  }, [])
  const handleReviewCommentsChange = useCallback((comments: ProviderReviewComment[]): void => {
    setReviewCommentsDraft(comments)
    setSelectedReview((review) => (review ? { ...review, comments } : null))
  }, [])
  const handleContinueReview = useCallback((comments: ProviderReviewComment[]): void => {
    setReviewCommentsDraft(comments)
    setSelectedReview((review) => ({
      id: review?.id ?? crypto.randomUUID(),
      comments
    }))
    setFileEditorTarget(null)
  }, [])
  const handleSelectedReviewChange = useCallback(
    (review: Omit<ProviderReview, 'prompt'> | null): void => {
      setSelectedReview(review)
      setReviewCommentsDraft(review?.comments ?? [])
    },
    []
  )
  const handleSelectFileEditorTarget = useCallback((target: FileEditorTarget): void => {
    setFileEditorTarget(target)
  }, [])

  const renderTreeNode = <TFile extends TreeFile>(
    node: ChangeTreeNode<TFile>,
    depth: number,
    options: {
      collapsedFolders: Record<string, boolean>
      onToggleFolder: (folderPath: string, childrenPrecomputed: boolean) => void
    }
  ): React.ReactElement => {
    if (node.type === 'folder') {
      const collapsed = !node.childrenPrecomputed || Boolean(options.collapsedFolders[node.path])

      return (
        <li
          className="changes-sidebar__tree-item changes-sidebar__tree-item--folder"
          key={node.path}
          role="treeitem"
          aria-expanded={!collapsed}
        >
          <button
            className="changes-sidebar__tree-row changes-sidebar__tree-row--folder"
            type="button"
            title={node.path}
            style={getChangeTreeRowStyle(depth)}
            onClick={() => options.onToggleFolder(node.path, node.childrenPrecomputed)}
          >
            <span className="changes-sidebar__tree-chevron" aria-hidden="true">
              {collapsed ? <ChevronRight /> : <ChevronDown />}
            </span>
            <span className="changes-sidebar__tree-icon" aria-hidden="true">
              <SymbolsFolderIcon folderName={node.name} />
            </span>
            <span className="changes-sidebar__tree-name">{node.name}</span>
          </button>
          {!collapsed && node.children.length > 0 && (
            <ul className="changes-sidebar__tree-group" role="group">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1, options))}
            </ul>
          )}
        </li>
      )
    }

    const previousDisplayPath = getChangedFileDisplayPreviousPath(node.file)
    const displayPath = getChangedFileDisplayPath(node.file)
    const fileTitle = previousDisplayPath ? `${previousDisplayPath} -> ${displayPath}` : displayPath
    const changeKind = node.file.kind ?? null
    const fileItemClassName = [
      'changes-sidebar__tree-item',
      'changes-sidebar__tree-item--file',
      changeKind ? 'changes-sidebar__tree-item--changed' : null,
      changeKind ? `changes-sidebar__tree-item--${changeKind}` : null
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <li className={fileItemClassName} key={node.file.path} role="treeitem">
        <button
          className="changes-sidebar__tree-row changes-sidebar__tree-row--file"
          type="button"
          aria-label={`Open ${displayPath}`}
          title={fileTitle}
          style={getChangeTreeRowStyle(depth)}
          onClick={() => handleOpenFile(node.file)}
        >
          <span className="changes-sidebar__tree-spacer" aria-hidden="true" />
          <span className="changes-sidebar__tree-icon" aria-hidden="true">
            <SymbolsFileIcon fileName={node.name} autoAssign />
          </span>
          <span className="changes-sidebar__tree-name" title={fileTitle}>
            {node.name}
          </span>
        </button>
      </li>
    )
  }

  const renderChangeTreeNode = (
    node: ChangeTreeNode<DisplayTreeFile<ChangedFile>>,
    depth: number
  ): React.ReactElement =>
    renderTreeNode(node, depth, {
      collapsedFolders: collapsedChangeTreeFolders,
      onToggleFolder: handleToggleChangeTreeFolder
    })

  const renderRepositoryFileTreeNode = (
    node: ChangeTreeNode<DisplayTreeFile<RepositoryFile>>,
    depth: number
  ): React.ReactElement =>
    renderTreeNode(node, depth, {
      collapsedFolders: collapsedFileTreeFolders,
      onToggleFolder: handleToggleFileTreeFolder
    })

  const handleScopedChatCommit = async (
    action: GitCommitPromptAction,
    extraInstructions: string
  ): Promise<boolean> => {
    if (providerUpdateInProgress) return false
    if (selectedChat && !chatDetail) return false
    if (!selectedChat && !changesCwd) return false
    if (sendInFlightRef.current) return false

    const prompt = getScopedChatCommitPrompt(
      action,
      extraInstructions,
      effectiveAppSettings.git.commitPrompt
    )
    const providerId = selectedChat?.providerId ?? newSessionProvider
    const chatId = selectedChat?.id ?? null
    const turnOptions = getGitTurnOptions()
    const useForkedChat = chatId != null && turnOptions.model !== model
    const useHiddenChat = chatId == null || useForkedChat
    const markerId = chatId ? createChatCommitMarkerId() : null
    const markerStartedAt = Date.now()
    const sourceAnchorItemId =
      chatId && chatDetail?.id === chatId ? getLastChatCommitMarkerAnchorId(chatDetail.items) : null

    sendInFlightRef.current = true
    chatAutoScrollEnabledRef.current = true
    setCommitState('sending')
    setCommitError(null)
    setSendState('sending')

    if (chatId && markerId) {
      setChatCommitMarkers((currentMarkers) => ({
        ...currentMarkers,
        [markerId]: {
          id: markerId,
          providerId,
          sourceChatId: chatId,
          commitChatId: null,
          commitAction: action,
          status: 'pending',
          afterItemId: null,
          startedAt: markerStartedAt,
          finishedAt: null
        }
      }))
      setStartingScopedCommitActivity({
        providerId,
        sourceChatId: chatId,
        markerId,
        commitAction: action
      })
    }

    if (chatId && !useForkedChat && chatDetail?.id === chatId) {
      applyViewedChatDetail(providerId, {
        ...chatDetail,
        status: 'active',
        contextUsage: chatDetail.contextUsage,
        items: getOptimisticItems(chatDetail.items, prompt)
      })
    }

    try {
      const detail =
        chatId == null
          ? await providerApi.startChat(
              providerId,
              prompt,
              {
                ...turnOptions,
                cwd: changesCwd ?? undefined
              },
              'commit'
            )
          : useForkedChat
            ? await providerApi.continueChatInFork(
                providerId,
                chatId,
                prompt,
                'commit',
                turnOptions
              )
            : await providerApi.continueChat(providerId, chatId, prompt, turnOptions)
      if (useHiddenChat) applyChatDetail(providerId, detail)
      else applyViewedChatDetail(providerId, detail)

      setCommitInput('')
      if (markerId) {
        setChatCommitMarkers((currentMarkers) => {
          const marker = currentMarkers[markerId]
          if (!marker) return currentMarkers

          return {
            ...currentMarkers,
            [markerId]: {
              ...marker,
              commitChatId: detail.id,
              status: isActiveChatStatus(detail.status)
                ? 'pending'
                : getChatCommitMarkerTerminalStatus(detail),
              afterItemId: useHiddenChat
                ? sourceAnchorItemId
                : getLastChatCommitMarkerAnchorId(detail.items, sourceAnchorItemId),
              finishedAt: isActiveChatStatus(detail.status) ? null : Date.now()
            }
          }
        })
      }
      if (isActiveChatStatus(detail.status)) {
        const activityKey = getProviderChatKey(providerId, detail.id)
        const activity = {
          source: 'ai',
          providerId,
          chatId: detail.id,
          sourceChatId: chatId,
          markerId: markerId ?? `untracked:${providerId}:${detail.id}:${markerStartedAt}`,
          projectCwd: changesProjectCwd ?? changesCwd,
          commitAction: action,
          currentAction: getCommitActivityCurrentAction(detail, action),
          startedAt: markerStartedAt
        } satisfies ScopedCommitActivity

        setScopedCommitActivities((currentActivities) => {
          const nextActivities = {
            ...currentActivities,
            [activityKey]: activity
          }
          scopedCommitActivitiesRef.current = nextActivities
          return nextActivities
        })
      }
      setCommitState('idle')
      setSendState('idle')
      return true
    } catch (error) {
      if (markerId) {
        setChatCommitMarkers((currentMarkers) => {
          const marker = currentMarkers[markerId]
          if (!marker || marker.status !== 'pending') return currentMarkers

          return {
            ...currentMarkers,
            [markerId]: {
              ...marker,
              status: 'failed',
              afterItemId: sourceAnchorItemId,
              finishedAt: Date.now()
            }
          }
        })
      }
      if (chatId && !useForkedChat) {
        void providerApi
          .getChat(providerId, chatId)
          .then((detail) => applyViewedChatDetail(providerId, detail))
          .catch(() => {})
      }
      setCommitState('error')
      setCommitError(getErrorMessage(error, 'Unable to start scoped commit in chat.'))
      handleSendFailure(error, 'Unable to start scoped commit in chat.')
      return false
    } finally {
      setStartingScopedCommitActivity((currentActivity) =>
        currentActivity?.providerId === providerId && currentActivity.sourceChatId === chatId
          ? null
          : currentActivity
      )
      sendInFlightRef.current = false
    }
  }

  const handleGenerateCommitMessage = async (): Promise<boolean> => {
    if (commitMessageGenerationDisabled || !changesCwd) return false
    if (commitMessageGenerationInFlightRef.current) return false

    const generationCwd = changesCwd
    const providerId = selectedChat?.providerId ?? newSessionProvider
    commitMessageGenerationInFlightRef.current = true
    setCommitMessageGenerationState('sending')
    setCommitState('idle')
    setCommitError(null)

    try {
      const [{ diff }, { messages }] = await Promise.all([
        appApi.getUncommittedGitDiff({ container: changesContainer, cwd: generationCwd }),
        appApi.getRecentGitCommitMessages({
          container: changesContainer,
          cwd: generationCwd,
          limit: 5
        })
      ])
      if (!diff.trim()) throw new Error('There is no uncommitted diff to describe.')

      const generatedMessage = await providerApi.generateOneShot(
        providerId,
        getCommitMessageGenerationPrompt(
          diff,
          messages,
          commitInputValue,
          effectiveAppSettings.git.commitMessageGeneration
        ),
        {
          ...getGitTurnOptions(),
          cwd: generationCwd
        }
      )
      const commitMessage = normalizeGeneratedCommitMessage(generatedMessage)
      if (!commitMessage) throw new Error('AI did not return a commit name.')

      if (changesCwdRef.current === generationCwd) setCommitInput(commitMessage)
      setCommitMessageGenerationState('idle')
      return true
    } catch (error) {
      setCommitMessageGenerationState('error')
      setCommitError(getErrorMessage(error, 'Unable to generate a commit name.'))
      return false
    } finally {
      commitMessageGenerationInFlightRef.current = false
    }
  }

  const handleCommitChangedFiles = async (
    action: GitCommitPromptAction = 'commit',
    message = commitInputValue
  ): Promise<boolean> => {
    const commitMessage = message.trim()
    if (providerUpdateInProgress) return false
    if (commitInFlightRef.current) return false
    if (getCommitActionDisabled(action, commitMessage)) return false
    if (!changesCwd) return false

    commitInFlightRef.current = true
    const activityId = `git:${changesCwd}:${action}:${Date.now()}`
    const activity = {
      source: 'git',
      id: activityId,
      projectCwd: changesProjectCwd ?? changesCwd,
      commitAction: action,
      currentAction: getDirectCommitActivityAction(action),
      startedAt: Date.now()
    } satisfies DirectCommitActivity

    try {
      setCommitState('sending')
      setCommitError(null)
      setDirectCommitActivities((currentActivities) => ({
        ...currentActivities,
        [activityId]: activity
      }))

      await appApi.commitGitChanges({
        action,
        container: changesContainer,
        cwd: changesCwd,
        files: commitFiles,
        message: action === 'amend' ? null : commitMessage
      })
      setCommitInput('')
      setCommitState('idle')
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
      return true
    } catch (error) {
      setCommitState('error')
      setCommitError(getErrorMessage(error, 'Unable to commit these files.'))
      return false
    } finally {
      setDirectCommitActivities((currentActivities) => {
        if (!currentActivities[activityId]) return currentActivities

        const nextActivities = { ...currentActivities }
        delete nextActivities[activityId]
        return nextActivities
      })
      commitInFlightRef.current = false
    }
  }

  const handleAiCommitChangedFiles = async (
    action: GitCommitPromptAction = 'commit'
  ): Promise<boolean> => {
    if (providerUpdateInProgress) return false
    if (commitInFlightRef.current) return false
    if (getAiCommitActionDisabled()) return false

    commitInFlightRef.current = true
    try {
      return await handleScopedChatCommit(action, commitInputValue)
    } finally {
      commitInFlightRef.current = false
    }
  }

  const handleCancelAiCommit = async (activity: ScopedCommitActivity): Promise<void> => {
    const activityKey = getProviderChatKey(activity.providerId, activity.chatId)
    if (providerUpdateInProgress || cancelingAiCommitKeys.has(activityKey)) return

    setCancelingAiCommitKeys((currentKeys) => new Set(currentKeys).add(activityKey))
    setCommitState('idle')
    setCommitError(null)

    try {
      const detail = await providerApi.stopChat(activity.providerId, activity.chatId)
      applyChatDetail(activity.providerId, detail)
      setChatCommitMarkers((currentMarkers) => {
        const marker = currentMarkers[activity.markerId]
        if (!marker || marker.status !== 'pending') return currentMarkers

        return {
          ...currentMarkers,
          [marker.id]: {
            ...marker,
            status: 'stopped',
            afterItemId:
              activity.chatId === activity.sourceChatId
                ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                : marker.afterItemId,
            finishedAt: Date.now()
          }
        }
      })
      setScopedCommitActivities((currentActivities) => {
        if (!currentActivities[activityKey]) return currentActivities

        const nextActivities = { ...currentActivities }
        delete nextActivities[activityKey]
        return nextActivities
      })
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
    } catch (error) {
      setCommitState('error')
      setCommitError(getErrorMessage(error, 'Unable to cancel the AI commit.'))
    } finally {
      setCancelingAiCommitKeys((currentKeys) => {
        if (!currentKeys.has(activityKey)) return currentKeys

        const nextKeys = new Set(currentKeys)
        nextKeys.delete(activityKey)
        return nextKeys
      })
    }
  }

  const renderChatCommitMarker = (marker: ChatCommitMarker): React.ReactElement => {
    const activity = scopedCommitActivitiesByMarkerId.get(marker.id)
    const activityKey = activity ? getProviderChatKey(activity.providerId, activity.chatId) : null

    return (
      <ChatCommitMarkerItem
        marker={marker}
        canceling={
          providerUpdateInProgress || Boolean(activityKey && cancelingAiCommitKeys.has(activityKey))
        }
        key={marker.id}
        onCancel={activity ? () => handleCancelAiCommit(activity) : undefined}
      />
    )
  }

  const showRecoverableGitFailure = (
    cwd: string,
    requestedAction: GitSyncAction,
    failedAction: GitSyncStep,
    failure: AppGitRecoverableFailure
  ): void => {
    setSyncState('error')
    setSyncError(null)
    setSyncRecovery({
      cwd,
      requestedAction,
      failedAction,
      failure,
      error: null
    })
  }

  const runSyncChanges = async (
    action: GitSyncAction,
    cwd: string,
    options: {
      pullStrategy?: AppGitPullStrategy
      rememberStrategy?: boolean
      recovery?: GitSyncRecoveryState | null
    } = {}
  ): Promise<void> => {
    if (providerUpdateInProgress) return

    setSyncState('sending')
    setSyncError(null)
    setSyncRecovery(options.recovery ? { ...options.recovery, error: null } : null)

    let currentAction: GitSyncStep = action === 'push' ? 'push' : 'pull'

    try {
      if (action === 'pull' || action === 'pullAndPush') {
        currentAction = 'pull'
        const pullResult = await appApi.pullGitChanges({
          container: changesContainer,
          cwd,
          rememberStrategy: options.rememberStrategy,
          strategy: options.pullStrategy
        })

        if (pullResult.failure) {
          showRecoverableGitFailure(cwd, action, 'pull', pullResult.failure)
          return
        }
      }

      if (action === 'push' || action === 'pullAndPush') {
        currentAction = 'push'
        const pushResult = await appApi.pushGitChanges({ container: changesContainer, cwd })

        if (pushResult.failure) {
          showRecoverableGitFailure(cwd, action, 'push', pushResult.failure)
          return
        }
      }

      setSyncState('idle')
      setSyncRecovery(null)
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
    } catch (error) {
      const message = getErrorMessage(
        error,
        currentAction === 'pull' ? 'Unable to pull changes.' : 'Unable to push changes.'
      )

      setSyncState('error')
      if (options.recovery) {
        setSyncRecovery({ ...options.recovery, error: message })
        setSyncError(null)
        return
      }

      setSyncRecovery(null)
      setSyncError(message)
    }
  }

  const handleSyncChanges = async (action: GitSyncAction): Promise<void> => {
    if (syncDisabled || !changesCwd) return

    await runSyncChanges(action, changesCwd)
  }

  const handleDismissGitSyncRecovery = (): void => {
    setSyncRecovery(null)
    setSyncState('idle')
    setSyncError(null)
  }

  const handleGitSyncRecoveryAction = async (
    actionId: AppGitRecoveryActionId,
    options: GitSyncRecoveryActionOptions = {}
  ): Promise<void> => {
    const recovery = visibleSyncRecovery
    if (!recovery || syncInProgress) return

    if (actionId === 'pull-and-push') {
      await runSyncChanges('pullAndPush', recovery.cwd, { recovery })
      return
    }

    const pullStrategy = getGitRecoveryPullStrategy(actionId)
    if (!pullStrategy) return

    await runSyncChanges(
      recovery.requestedAction === 'pullAndPush' ? 'pullAndPush' : 'pull',
      recovery.cwd,
      { pullStrategy, recovery, rememberStrategy: options.rememberStrategy }
    )
  }

  const handleGitAiResolution = async (rememberStrategy = false): Promise<void> => {
    const recovery = visibleSyncRecovery
    if (!recovery || gitAiResolutionDisabled) return

    setSyncRecovery(null)
    setSyncState('idle')
    setSyncError(null)
    await handleSendMessage(
      getGitAiResolutionPrompt(recovery, rememberStrategy),
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions()
    )
  }

  const handleMinimizeWindow = (): void => {
    void appApi.minimizeWindow()
  }

  const handleToggleWindowMaximized = (): void => {
    void appApi
      .toggleWindowMaximized()
      .then((nextWindowState) => setWindowState(nextWindowState))
      .catch(() => {})
  }

  const handleCloseWindow = (): void => {
    void appApi.closeWindow()
  }

  const settingsProjectLabel = settingsProjectCwd ? getFolderName(settingsProjectCwd) : 'Project'
  const appearanceZoomLevelInput =
    appearanceZoomLevelInputDraft?.key === settingsScopeKey
      ? appearanceZoomLevelInputDraft.value
      : String(settingsPanelSettings.appearance.zoomLevel)
  const windowControlsHidden = settingsPanelSettings.appearance.position === 'hidden'

  const renderSettingsPanel = (): React.ReactElement => {
    const renderChatBooleanSettingField = (field: ChatBooleanSettingField): React.ReactElement => {
      const path = { section: 'chat', key: field.key } satisfies AppProjectSettingPath

      return (
        <div className={getSettingsFieldClassName()} key={field.key}>
          <div className="settings-dialog__field-header">
            <h3 id={field.id}>{field.label}</h3>
            {field.description && <p>{field.description}</p>}
          </div>
          {renderProjectSettingAction(path, field.label)}
          <Switch
            className="settings-switch"
            aria-labelledby={field.id}
            checked={settingsPanelSettings.chat[field.key]}
            disabled={isScopedSettingControlDisabled(path)}
            onChange={(event) =>
              handleChatDropdownPreferenceChange(field.key, event.currentTarget.checked)
            }
          />
        </div>
      )
    }
    const chatDisplayUsagePath = {
      section: 'chat',
      key: 'displayUsage'
    } satisfies AppProjectSettingPath
    const chatForceAccessPath = {
      section: 'chat',
      key: 'forceAccess'
    } satisfies AppProjectSettingPath
    const chatForceReviewPath = {
      section: 'chat',
      key: 'forceReview'
    } satisfies AppProjectSettingPath
    const chatForceModelPath = {
      section: 'chat',
      key: 'forceModel'
    } satisfies AppProjectSettingPath
    const chatForceReasoningPath = {
      section: 'chat',
      key: 'forceReasoning'
    } satisfies AppProjectSettingPath
    const chatForceSpeedPath = {
      section: 'chat',
      key: 'forceSpeed'
    } satisfies AppProjectSettingPath
    const chatContinuePromptPath = {
      section: 'chat',
      key: 'continuePrompt'
    } satisfies AppProjectSettingPath
    const performanceDisableShadowsPath = {
      section: 'performance',
      key: 'disableShadows'
    } satisfies AppProjectSettingPath
    const performanceMaxChatsRenderedPath = {
      section: 'performance',
      key: 'maxChatsRendered'
    } satisfies AppProjectSettingPath
    const chatRecentCacheLimitPath = {
      section: 'chat',
      key: 'recentChatCacheLimit'
    } satisfies AppProjectSettingPath
    const gitCommitModelPath = {
      section: 'git',
      key: 'commitModel'
    } satisfies AppProjectSettingPath
    const gitCommitGenerationPromptPath = {
      section: 'gitCommitMessageGeneration',
      key: 'prompt'
    } satisfies AppProjectSettingPath
    const gitCommitGenerationPrefixPath = {
      section: 'gitCommitMessageGeneration',
      key: 'aiInstructionsPrefix'
    } satisfies AppProjectSettingPath
    const gitWorktreeBranchPromptPath = {
      section: 'gitWorktree',
      key: 'branchNamePrompt'
    } satisfies AppProjectSettingPath
    const linkBehaviorPath = { section: 'links', key: 'behavior' } satisfies AppProjectSettingPath
    const appearanceThemePath = {
      section: 'appearance',
      key: 'theme'
    } satisfies AppProjectSettingPath
    const appearanceZoomPath = {
      section: 'appearance',
      key: 'zoomLevel'
    } satisfies AppProjectSettingPath
    const appearancePositionPath = {
      section: 'appearance',
      key: 'position'
    } satisfies AppProjectSettingPath
    const appearanceStylePath = {
      section: 'appearance',
      key: 'style'
    } satisfies AppProjectSettingPath
    const appearanceControlStylePath = {
      section: 'appearance',
      key: 'controlStyle'
    } satisfies AppProjectSettingPath
    const appearanceFontFields = [
      {
        key: 'applicationFont',
        label: 'Application font',
        specialOptions: [{ value: appFontSystemValue, label: 'System Default' }]
      },
      {
        key: 'chatFont',
        label: 'Chat font',
        specialOptions: [
          { value: appFontInheritValue, label: 'Inherit Application' },
          { value: appFontSystemValue, label: 'System Default' }
        ]
      },
      {
        key: 'codeFont',
        label: 'Code font',
        specialOptions: [{ value: appFontMonospaceValue, label: 'System Monospace' }]
      }
    ] satisfies readonly {
      key: AppearanceFontKey
      label: string
      specialOptions: readonly DropdownOption<string>[]
    }[]

    if (settingsTab === 'chat') {
      return (
        <section
          className="settings-dialog__panel"
          id="settings-panel-chat"
          role="tabpanel"
          aria-label="Chat settings"
        >
          <section className="settings-dialog__section" aria-labelledby="settings-chat-prompt-box">
            <h2 className="settings-dialog__section-heading" id="settings-chat-prompt-box">
              Prompt Box
            </h2>
            <div className="settings-dialog__section-cards">
              {chatPromptBoxSettingFields.map(renderChatBooleanSettingField)}
            </div>
          </section>
          <section className="settings-dialog__section" aria-labelledby="settings-chat-limits">
            <h2 className="settings-dialog__section-heading" id="settings-chat-limits">
              Limits
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Display usage</h3>
                </div>
                {renderProjectSettingAction(chatDisplayUsagePath, 'Display usage')}
                <SegmentedControl
                  aria-label="Display usage"
                  disabled={isScopedSettingControlDisabled(chatDisplayUsagePath)}
                  options={chatUsageDisplayOptions}
                  value={settingsPanelSettings.chat.displayUsage}
                  onChange={handleChatUsageDisplayChange}
                />
              </div>
            </div>
          </section>
          <section className="settings-dialog__section" aria-labelledby="settings-chat-dropdowns">
            <h2 className="settings-dialog__section-heading" id="settings-chat-dropdowns">
              Dropdowns
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Force access</h3>
                  <p>Hide the chat dropdown and always use this access mode.</p>
                </div>
                {renderProjectSettingAction(chatForceAccessPath, 'Force access')}
                <Dropdown
                  id="settings-chat-force-access"
                  aria-label="Force access"
                  disabled={isScopedSettingControlDisabled(chatForceAccessPath)}
                  menuAlign="end"
                  options={forceAccessOptions}
                  value={settingsPanelSettings.chat.forceAccess}
                  onChange={(value) => handleChatForcedDropdownChange('forceAccess', value)}
                />
              </div>
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Force review</h3>
                  <p>Hide the chat dropdown and always use this review mode.</p>
                </div>
                {renderProjectSettingAction(chatForceReviewPath, 'Force review')}
                <Dropdown
                  id="settings-chat-force-review"
                  aria-label="Force review"
                  disabled={isScopedSettingControlDisabled(chatForceReviewPath)}
                  menuAlign="end"
                  options={forceReviewOptions}
                  value={settingsPanelSettings.chat.forceReview}
                  onChange={(value) => handleChatForcedDropdownChange('forceReview', value)}
                />
              </div>
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Force model</h3>
                  <p>Hide the chat dropdown and always use this model.</p>
                </div>
                {renderProjectSettingAction(chatForceModelPath, 'Force model')}
                <Dropdown
                  id="settings-chat-force-model"
                  aria-label="Force model"
                  disabled={isScopedSettingControlDisabled(
                    chatForceModelPath,
                    forceModelOptions.length <= 1
                  )}
                  menuAlign="end"
                  options={forceModelOptions}
                  value={settingsPanelSettings.chat.forceModel}
                  onChange={(value) => handleChatForcedDropdownChange('forceModel', value)}
                />
              </div>
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Force reasoning</h3>
                  <p>Hide the chat dropdown and always use this reasoning effort.</p>
                </div>
                {renderProjectSettingAction(chatForceReasoningPath, 'Force reasoning')}
                <Dropdown
                  id="settings-chat-force-reasoning"
                  aria-label="Force reasoning"
                  disabled={isScopedSettingControlDisabled(
                    chatForceReasoningPath,
                    forceReasoningOptions.length <= 1
                  )}
                  menuAlign="end"
                  options={forceReasoningOptions}
                  value={settingsPanelSettings.chat.forceReasoning}
                  onChange={(value) => handleChatForcedDropdownChange('forceReasoning', value)}
                />
              </div>
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Force speed</h3>
                  <p>Hide the chat dropdown and always use this speed.</p>
                </div>
                {renderProjectSettingAction(chatForceSpeedPath, 'Force speed')}
                <Dropdown
                  id="settings-chat-force-speed"
                  aria-label="Force speed"
                  disabled={isScopedSettingControlDisabled(
                    chatForceSpeedPath,
                    forceSpeedOptions.length <= 1
                  )}
                  menuAlign="end"
                  options={forceSpeedOptions}
                  value={settingsPanelSettings.chat.forceSpeed}
                  onChange={(value) => handleChatForcedDropdownChange('forceSpeed', value)}
                />
              </div>
              {chatDropdownSettingFields.map(renderChatBooleanSettingField)}
            </div>
          </section>
          <section className="settings-dialog__section" aria-labelledby="settings-chat-thoughts">
            <h2 className="settings-dialog__section-heading" id="settings-chat-thoughts">
              Thoughts
            </h2>
            <div className="settings-dialog__section-cards">
              {chatThoughtSettingFields.map(renderChatBooleanSettingField)}
            </div>
          </section>
          <section
            className="settings-dialog__section"
            aria-labelledby="settings-chat-stopped-turns"
          >
            <h2 className="settings-dialog__section-heading" id="settings-chat-stopped-turns">
              Stopped Turns
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-chat-continue-prompt"
                >
                  <h3>Continue prompt</h3>
                  <p>Sent as a new message when Continue is selected on a stopped turn.</p>
                </label>
                {renderProjectSettingAction(chatContinuePromptPath, 'Continue prompt')}
                <textarea
                  id="settings-chat-continue-prompt"
                  className="settings-dialog__prompt-textarea"
                  rows={3}
                  disabled={isScopedSettingControlDisabled(chatContinuePromptPath)}
                  value={settingsPanelSettings.chat.continuePrompt}
                  onChange={(event) => handleContinuePromptChange(event.currentTarget.value)}
                />
              </div>
            </div>
          </section>
        </section>
      )
    }

    if (settingsTab === 'performance') {
      return (
        <section
          className="settings-dialog__panel"
          id="settings-panel-performance"
          role="tabpanel"
          aria-label="Performance settings"
        >
          <section
            className="settings-dialog__section"
            aria-labelledby="settings-performance-rendering"
          >
            <h2 className="settings-dialog__section-heading" id="settings-performance-rendering">
              Rendering
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName()}>
                <div className="settings-dialog__field-header">
                  <h3 id="settings-performance-disable-shadows">Disable shadows</h3>
                  <p>Remove box shadows throughout the app.</p>
                </div>
                {renderProjectSettingAction(performanceDisableShadowsPath, 'Disable shadows')}
                <Switch
                  className="settings-switch"
                  aria-labelledby="settings-performance-disable-shadows"
                  checked={settingsPanelSettings.performance.disableShadows}
                  disabled={isScopedSettingControlDisabled(performanceDisableShadowsPath)}
                  onChange={(event) =>
                    handlePerformancePreferenceChange('disableShadows', event.currentTarget.checked)
                  }
                />
              </div>
              <div className={getSettingsFieldClassName()}>
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-performance-max-chats-rendered"
                >
                  <h3>Max chats rendered</h3>
                  <p>
                    Render this many chats at a time in each sidebar group. Pinned chats are always
                    rendered.
                  </p>
                </label>
                {renderProjectSettingAction(performanceMaxChatsRenderedPath, 'Max chats rendered')}
                <Input
                  className="settings-dialog__number-input"
                  id="settings-performance-max-chats-rendered"
                  type="number"
                  min={appMaxChatsRenderedMin}
                  max={appMaxChatsRenderedMax}
                  step={1}
                  disabled={isScopedSettingControlDisabled(performanceMaxChatsRenderedPath)}
                  value={settingsPanelSettings.performance.maxChatsRendered}
                  onChange={(event) =>
                    handleMaxChatsRenderedChange(event.currentTarget.valueAsNumber)
                  }
                />
              </div>
            </div>
          </section>
          <section
            className="settings-dialog__section"
            aria-labelledby="settings-performance-chat-cache"
          >
            <h2 className="settings-dialog__section-heading" id="settings-performance-chat-cache">
              Chat Cache
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName()}>
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-chat-cache-limit"
                >
                  <h3>Cache recent chats</h3>
                  <p>
                    Keep this many recent chats that haven’t been marked done in memory. Use 0 to
                    disable.
                  </p>
                </label>
                {renderProjectSettingAction(chatRecentCacheLimitPath, 'Cache recent chats')}
                <Input
                  className="settings-dialog__number-input"
                  id="settings-chat-cache-limit"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  disabled={isScopedSettingControlDisabled(chatRecentCacheLimitPath)}
                  value={settingsPanelSettings.chat.recentChatCacheLimit}
                  onChange={(event) =>
                    handleRecentChatCacheLimitChange(event.currentTarget.valueAsNumber)
                  }
                />
              </div>
            </div>
          </section>
        </section>
      )
    }

    if (settingsTab === 'git') {
      return (
        <section
          className="settings-dialog__panel"
          id="settings-panel-git"
          role="tabpanel"
          aria-label="Git settings"
        >
          <section className="settings-dialog__section" aria-labelledby="settings-git-model">
            <h2 className="settings-dialog__section-heading" id="settings-git-model">
              AI model
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Commit model</h3>
                </div>
                {renderProjectSettingAction(gitCommitModelPath, 'Commit model')}
                <Dropdown
                  id="settings-git-commit-model"
                  aria-label="Commit model"
                  disabled={isScopedSettingControlDisabled(gitCommitModelPath)}
                  menuAlign="end"
                  options={gitCommitModelOptions}
                  value={gitCommitModelValue}
                  onChange={handleGitCommitModelChange}
                />
              </div>
            </div>
          </section>
          <section
            className="settings-dialog__section"
            aria-labelledby="settings-git-ai-chat-commit"
          >
            <h2 className="settings-dialog__section-heading" id="settings-git-ai-chat-commit">
              AI Chat Commit
            </h2>
            <div className="settings-dialog__section-cards">
              {gitCommitPromptFieldOptions.map((field) => {
                const fieldId = `settings-git-commit-prompt-${field.key}`
                const path = {
                  section: 'gitCommitPrompt',
                  key: field.key
                } satisfies AppProjectSettingPath

                return (
                  <div
                    className={getSettingsFieldClassName('settings-dialog__field--stack')}
                    key={field.key}
                  >
                    <label className="settings-dialog__field-header" htmlFor={fieldId}>
                      <h3>{field.label}</h3>
                    </label>
                    {renderProjectSettingAction(path, field.label)}
                    <textarea
                      id={fieldId}
                      className="settings-dialog__prompt-textarea"
                      rows={field.rows}
                      spellCheck={false}
                      disabled={isScopedSettingControlDisabled(path)}
                      value={settingsPanelSettings.git.commitPrompt[field.key]}
                      onChange={(event) =>
                        handleGitCommitPromptChange(field.key, event.currentTarget.value)
                      }
                    />
                  </div>
                )
              })}
            </div>
          </section>
          <section
            className="settings-dialog__section"
            aria-labelledby="settings-git-commit-name-generation"
          >
            <h2
              className="settings-dialog__section-heading"
              id="settings-git-commit-name-generation"
            >
              Commit name generation
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-git-commit-generation-prompt"
                >
                  <h3>Generation prompt</h3>
                </label>
                {renderProjectSettingAction(gitCommitGenerationPromptPath, 'Generation prompt')}
                <textarea
                  id="settings-git-commit-generation-prompt"
                  className="settings-dialog__prompt-textarea"
                  rows={4}
                  spellCheck={false}
                  disabled={isScopedSettingControlDisabled(gitCommitGenerationPromptPath)}
                  value={settingsPanelSettings.git.commitMessageGeneration.prompt}
                  onChange={(event) =>
                    handleGitCommitMessageGenerationChange('prompt', event.currentTarget.value)
                  }
                />
              </div>
              <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-git-ai-instructions-prefix"
                >
                  <h3>AI instructions prefix</h3>
                </label>
                {renderProjectSettingAction(
                  gitCommitGenerationPrefixPath,
                  'AI instructions prefix'
                )}
                <Input
                  id="settings-git-ai-instructions-prefix"
                  disabled={isScopedSettingControlDisabled(gitCommitGenerationPrefixPath)}
                  value={settingsPanelSettings.git.commitMessageGeneration.aiInstructionsPrefix}
                  onChange={(event) =>
                    handleGitCommitMessageGenerationChange(
                      'aiInstructionsPrefix',
                      event.currentTarget.value
                    )
                  }
                />
              </div>
            </div>
          </section>
          <section className="settings-dialog__section" aria-labelledby="settings-git-worktree">
            <h2 className="settings-dialog__section-heading" id="settings-git-worktree">
              Worktree
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-git-worktree-branch-name-prompt"
                >
                  <h3>Branch name prompt</h3>
                </label>
                {renderProjectSettingAction(gitWorktreeBranchPromptPath, 'Branch name prompt')}
                <textarea
                  id="settings-git-worktree-branch-name-prompt"
                  className="settings-dialog__prompt-textarea"
                  rows={4}
                  spellCheck={false}
                  disabled={isScopedSettingControlDisabled(gitWorktreeBranchPromptPath)}
                  value={settingsPanelSettings.git.worktree.branchNamePrompt}
                  onChange={(event) =>
                    handleGitWorktreeChange('branchNamePrompt', event.currentTarget.value)
                  }
                />
              </div>
            </div>
          </section>
        </section>
      )
    }

    if (settingsTab === 'links') {
      return (
        <section
          className="settings-dialog__panel"
          id="settings-panel-links"
          role="tabpanel"
          aria-label="Link settings"
        >
          <section className="settings-dialog__section" aria-labelledby="settings-links-handling">
            <h2 className="settings-dialog__section-heading" id="settings-links-handling">
              External Links
            </h2>
            <div className="settings-dialog__section-cards">
              <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
                <div className="settings-dialog__field-header">
                  <h3>Behavior</h3>
                  <p>Manual asks each time. Copy and Open always use that action.</p>
                </div>
                {renderProjectSettingAction(linkBehaviorPath, 'External link behavior')}
                <SegmentedControl
                  aria-label="External link behavior"
                  disabled={isScopedSettingControlDisabled(linkBehaviorPath)}
                  options={externalLinkOptions}
                  value={settingsPanelSettings.links.behavior}
                  onChange={handleExternalLinkBehaviorChange}
                />
              </div>
            </div>
          </section>
        </section>
      )
    }

    return (
      <section
        className="settings-dialog__panel"
        id="settings-panel-appearance"
        role="tabpanel"
        aria-label="Appearance settings"
      >
        <section className="settings-dialog__section" aria-labelledby="settings-appearance-window">
          <h2 className="settings-dialog__section-heading" id="settings-appearance-window">
            Window
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Theme</h3>
              </div>
              {renderProjectSettingAction(appearanceThemePath, 'Theme')}
              <SegmentedControl
                aria-label="Theme"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(appearanceThemePath)}
                options={themeOptions}
                value={settingsPanelSettings.appearance.theme}
                onChange={handleThemePreferenceChange}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-appearance-zoom-level"
              >
                <h3>Zoom</h3>
              </label>
              {renderProjectSettingAction(appearanceZoomPath, 'Zoom')}
              <Input
                className="settings-dialog__number-input"
                id="settings-appearance-zoom-level"
                type="number"
                min={appAppearanceZoomLevelMin}
                max={appAppearanceZoomLevelMax}
                step={1}
                disabled={isScopedSettingControlDisabled(appearanceZoomPath)}
                value={appearanceZoomLevelInput}
                onBlur={handleAppearanceZoomLevelInputBlur}
                onChange={(event) =>
                  handleAppearanceZoomLevelInputChange(event.currentTarget.value)
                }
              />
            </div>
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-appearance-window-controls"
        >
          <h2 className="settings-dialog__section-heading" id="settings-appearance-window-controls">
            Window Controls
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Position</h3>
              </div>
              {renderProjectSettingAction(appearancePositionPath, 'Position')}
              <SegmentedControl
                aria-label="Position"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(appearancePositionPath)}
                options={appearancePositionOptions}
                value={settingsPanelSettings.appearance.position}
                onChange={handleAppearancePositionChange}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Style</h3>
              </div>
              {renderProjectSettingAction(appearanceStylePath, 'Window control style')}
              <SegmentedControl
                aria-label="Window control style"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(appearanceStylePath, windowControlsHidden)}
                options={appearanceStyleOptions}
                value={settingsPanelSettings.appearance.style}
                onChange={handleAppearanceStyleChange}
              />
            </div>
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-appearance-buttons">
          <h2 className="settings-dialog__section-heading" id="settings-appearance-buttons">
            Buttons
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Style</h3>
              </div>
              {renderProjectSettingAction(appearanceControlStylePath, 'Button style')}
              <SegmentedControl
                aria-label="Button style"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(appearanceControlStylePath)}
                options={appearanceControlStyleOptions}
                value={settingsPanelSettings.appearance.controlStyle}
                onChange={handleAppearanceControlStyleChange}
              />
            </div>
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-appearance-fonts">
          <h2 className="settings-dialog__section-heading" id="settings-appearance-fonts">
            Fonts
          </h2>
          <div className="settings-dialog__section-cards">
            {appearanceFontFields.map((field) => {
              const path = {
                section: 'appearance',
                key: field.key
              } satisfies AppProjectSettingPath
              const font = settingsPanelSettings.appearance[field.key]
              const specialValues = new Set(field.specialOptions.map((option) => option.value))
              const selectedFontIsMissing =
                !specialValues.has(font.family) &&
                !installedFontFamilies.some((family) => family === font.family)
              const options = [
                ...field.specialOptions,
                ...(selectedFontIsMissing
                  ? [{ value: font.family, label: `${font.family} (Unavailable)` }]
                  : []),
                ...installedFontOptions
              ]
              const draftKey = `${settingsScopeKey}:${field.key}`
              const sizeInput =
                appearanceFontSizeInputDraft?.key === draftKey
                  ? appearanceFontSizeInputDraft.value
                  : String(font.size)
              const disabled = isScopedSettingControlDisabled(path)

              return (
                <div
                  className={getSettingsFieldClassName('settings-dialog__field--inline')}
                  key={field.key}
                >
                  <div className="settings-dialog__field-header">
                    <h3>{field.label}</h3>
                    {!installedFontsLoaded && <p>Loading installed fonts…</p>}
                  </div>
                  {renderProjectSettingAction(path, field.label)}
                  <div className="settings-dialog__font-controls">
                    <Dropdown
                      aria-label={field.label}
                      className="settings-dialog__font-dropdown"
                      disabled={disabled}
                      options={options}
                      value={font.family}
                      onChange={(family) => handleAppearanceFontFamilyChange(field.key, family)}
                    />
                    <label className="settings-dialog__font-size">
                      <span className="sr-only">{field.label} size</span>
                      <Input
                        aria-label={`${field.label} size`}
                        type="number"
                        min={appFontSizeMin}
                        max={appFontSizeMax}
                        step={0.025}
                        disabled={disabled}
                        value={sizeInput}
                        onBlur={handleAppearanceFontSizeInputBlur}
                        onChange={(event) =>
                          handleAppearanceFontSizeInputChange(field.key, event.currentTarget.value)
                        }
                      />
                      <span aria-hidden="true">rem</span>
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </section>
    )
  }

  const renderSettingsDialog = (): React.ReactElement | null => {
    if (!settingsOpen) return null

    return (
      <div
        className="settings-overlay"
        role="presentation"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false)
        }}
      >
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
          <aside className="settings-dialog__sidebar">
            <div className="settings-dialog__sidebar-top">
              <h2>Settings</h2>
              <Button
                ref={settingsCloseButtonRef}
                aria-label="Close settings"
                callback={() => setSettingsOpen(false)}
                icon={<X aria-hidden="true" />}
                size="small"
                theme="transparent"
                title="Close settings"
              />
            </div>
            <nav
              className="settings-dialog__nav"
              aria-label="Settings sections"
              aria-orientation="vertical"
              role="tablist"
            >
              {settingsTabOptions.map((option, index) => {
                const selected = option.value === settingsTab

                return (
                  <button
                    className={`settings-dialog__nav-item${
                      selected ? ' settings-dialog__nav-item--active' : ''
                    }`}
                    id={`settings-tab-${option.value}`}
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-controls={`settings-panel-${option.value}`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setSettingsTab(option.value)}
                    onKeyDown={(event) => {
                      let nextIndex: number | null = null
                      if (event.key === 'ArrowDown') {
                        nextIndex = (index + 1) % settingsTabOptions.length
                      } else if (event.key === 'ArrowUp') {
                        nextIndex =
                          (index - 1 + settingsTabOptions.length) % settingsTabOptions.length
                      } else if (event.key === 'Home') {
                        nextIndex = 0
                      } else if (event.key === 'End') {
                        nextIndex = settingsTabOptions.length - 1
                      }
                      if (nextIndex === null) return

                      event.preventDefault()
                      const nextTab = settingsTabOptions[nextIndex]
                      setSettingsTab(nextTab.value)
                      document
                        .getElementById(`settings-tab-${nextTab.value}`)
                        ?.focus({ preventScroll: true })
                    }}
                  >
                    <span className="settings-dialog__nav-icon" aria-hidden="true">
                      {option.icon}
                    </span>
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </nav>
            <div className="settings-dialog__scope">
              <SegmentedControl<SettingsScope>
                aria-label="Settings scope"
                className="settings-dialog__scope-switcher"
                options={[
                  { value: 'global', label: 'Global' },
                  {
                    value: 'project',
                    label: settingsProjectLabel,
                    disabled: !settingsProjectCwd,
                    title: settingsProjectCwd ?? 'No project selected'
                  }
                ]}
                size="small"
                value={settingsViewIsProject ? 'project' : 'global'}
                onChange={(scope) => {
                  if (scope === 'project' && !settingsProjectCwd) return
                  setAppearanceZoomLevelInputDraft(null)
                  setAppearanceFontSizeInputDraft(null)
                  setSettingsScope(scope)
                }}
              />
            </div>
          </aside>
          <div className="settings-dialog__body">{renderSettingsPanel()}</div>
        </section>
      </div>
    )
  }

  const renderWindowControls = (placement: 'darwin' | 'default'): React.ReactElement | null =>
    windowControlsHidden ? null : (
      <div className={`window-controls window-controls--${placement}`} aria-label="Window controls">
        <button
          className="window-control window-control--minimize"
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={handleMinimizeWindow}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          className="window-control window-control--maximize"
          type="button"
          aria-label={windowState.isMaximized ? 'Restore' : 'Maximize'}
          title={windowState.isMaximized ? 'Restore' : 'Maximize'}
          onClick={handleToggleWindowMaximized}
        >
          {windowState.isMaximized ? (
            <Minimize2 aria-hidden="true" />
          ) : (
            <Maximize2 aria-hidden="true" />
          )}
        </button>
        <button
          className="window-control window-control--close"
          type="button"
          aria-label="Close"
          title="Close"
          onClick={handleCloseWindow}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    )

  const chromeControlTheme =
    effectiveAppSettings.appearance.controlStyle === 'transparent' ? 'transparent' : 'secondary'

  const renderSettingsButton = (): React.ReactElement => (
    <Button
      theme={chromeControlTheme}
      aria-label="Settings"
      title="Settings"
      callback={() => setSettingsOpen(true)}
      icon={<Settings aria-hidden="true" />}
    />
  )

  const renderChatGroupingButton = (): React.ReactElement => {
    const nextPreference = chatGroupingPreference === 'grouped' ? 'ungrouped' : 'grouped'

    return (
      <Button
        theme={chromeControlTheme}
        aria-label={`Chat grouping: ${chatGroupingPreference}. Switch to ${nextPreference}`}
        aria-pressed={chatGroupingPreference === 'grouped'}
        title={chatGroupingPreference === 'grouped' ? 'Grouped' : 'Ungrouped'}
        callback={handleToggleChatGrouping}
        icon={
          chatGroupingPreference === 'grouped' ? (
            <FolderTree aria-hidden="true" />
          ) : (
            <LayoutList aria-hidden="true" />
          )
        }
      />
    )
  }

  const renderChatTurn = (turnIndex: number, turn: ProviderChatTurn): React.ReactElement => {
    const turnIsLatestRendered = turn === renderedChatTurns.at(-1)

    return (
      <div
        className="chat-detail__turn"
        data-chat-turn-id={turn.id}
        data-chat-turn-index={turnIndex}
        key={turn.id}
      >
        {turn.items.map((item) => {
          const itemIndex = chatItemIndexesById.get(item.id) ?? -1
          const followingWorkingStep = followingWorkingStepsById.get(item.id)

          return (
            <Fragment key={item.id}>
              {chatCommitMarkersByBeforeItemId.get(item.id)?.map(renderChatCommitMarker)}
              {item.id === firstPendingChatItemId &&
                trailingChatCommitMarkers.map(renderChatCommitMarker)}
              <ChatDetailItem
                canEditOwnMessages={canEditOwnMessages}
                container={changesContainer}
                continuePrompt={effectiveAppSettings.chat.continuePrompt}
                continueStoppedTurnDisabled={stoppedTurnActionDisabled}
                continuedStoppedTurn={continuedStoppedWorkingStepIds.has(item.id)}
                followingWorkingStepHasNext={followingWorkingStep?.hasNextWorkingStep}
                followingWorkingStepStatus={followingWorkingStep?.status}
                hasNextWorkingStep={workingStepIdsWithNextWorkingStep.has(item.id)}
                item={item}
                cwd={changesCwd}
                modelLabelsById={modelLabelsById}
                onDeletePendingMessage={handleDeletePendingMessage}
                onEditPendingMessage={handleEditPendingMessage}
                onInterruptPendingMessage={
                  chatHasActiveTurn ? handleInterruptPendingMessage : undefined
                }
                onContinueStoppedTurn={
                  item.type === 'working' && item.status === 'stopped'
                    ? handleContinueStoppedTurn
                    : undefined
                }
                onEditMessage={handleEditMessage}
                onLoadWorkingStep={handleLoadWorkingStep}
                onOpenFileLink={changesCwd ? handleOpenFileLink : undefined}
                onRetryStoppedTurn={handleRetryStoppedTurn}
                previousItem={itemIndex > 0 ? visibleChatItems[itemIndex - 1] : null}
                projectCwd={changesProjectCwd}
                retryMessage={canRetryStoppedTurns ? stoppedTurnRetryMessages.get(item.id) : null}
                retryStoppedTurnDisabled={stoppedTurnActionDisabled}
                selectedModelId={model}
                streaming={item.id === streamingChatItemId}
                thoughtSettings={effectiveAppSettings.chat}
              />
              {chatCommitMarkersByAfterItemId.get(item.id)?.map(renderChatCommitMarker)}
            </Fragment>
          )
        })}
        {turnIsLatestRendered &&
          effectiveChatTurnWindow?.endIndex === effectiveChatTurnWindow?.totalCount &&
          !firstPendingChatItemId &&
          trailingChatCommitMarkers.map(renderChatCommitMarker)}
      </div>
    )
  }

  const showChatTurnDownButton = Boolean(
    effectiveChatTurnWindow &&
    (!chatAtConversationBottom ||
      effectiveChatTurnWindow.endIndex < effectiveChatTurnWindow.totalCount)
  )

  return (
    <main className={`chat${chatPanelOpen ? ' chat--has-selection' : ' chat--no-selection'}`}>
      {renderSettingsDialog()}
      {sshEnvironmentDialogOpen && (
        <SshEnvironmentDialog
          environment={editingSshEnvironment}
          open
          onClose={() => {
            setSshEnvironmentDialogOpen(false)
            setEditingSshEnvironment(null)
          }}
          onSave={handleSaveSshEnvironment}
        />
      )}
      {fileEditorTarget && (
        <FileEditorDialog
          diffTargets={fileEditorTarget.kind ? fileEditorDiffTargets : []}
          initialReviewComments={reviewCommentsDraft}
          target={fileEditorTarget}
          onClose={handleCloseFileEditor}
          onContinueReview={handleContinueReview}
          onReviewCommentsChange={handleReviewCommentsChange}
          onSelectTarget={handleSelectFileEditorTarget}
        />
      )}
      <div className="chat__panels" ref={panelsRef} style={panelsStyle}>
        <div className="chat__sidebar-panel" data-panel="true" id="sidebar">
          <aside className="chat-sidebar" aria-label="Recent conversations">
            <header
              className={`chat-home__header${searchOpen ? ' chat-home__header--searching' : ''}`}
            >
              {renderWindowControls('darwin')}
              {searchOpen ? (
                <>
                  <label className="sr-only" htmlFor="chat-search">
                    Search conversations
                  </label>
                  <div className="chat-home__search-field">
                    <Input
                      ref={searchInputRef}
                      id="chat-search"
                      type="search"
                      value={searchQuery}
                      placeholder="Search conversations"
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') handleCloseSearch()
                      }}
                    />
                  </div>
                  <Button
                    theme={chromeControlTheme}
                    aria-label="Close search"
                    aria-controls="chat-search"
                    title="Close search"
                    callback={handleCloseSearch}
                    icon={<X aria-hidden="true" />}
                  />
                </>
              ) : (
                <div className="chat-home__actions">
                  <div className="chat-home__actions-left">
                    <span className="chat-home__settings-action">{renderSettingsButton()}</span>
                    {renderChatGroupingButton()}
                  </div>
                  <div className="chat-home__actions-right">
                    <Button
                      theme={chromeControlTheme}
                      aria-label="New chat"
                      title="New chat"
                      callback={handleNewChat}
                      icon={<SquarePen aria-hidden="true" />}
                    />
                    <Button
                      theme={chromeControlTheme}
                      aria-label="Search conversations"
                      aria-expanded={false}
                      title="Search conversations"
                      callback={() => setSearchOpen(true)}
                      icon={<Search aria-hidden="true" />}
                    />
                  </div>
                </div>
              )}
            </header>
            <div className="chat-sidebar__body">
              {loadState === 'loading' && chats.length === 0 && (
                <ChatSidebarLoadingState label="Loading conversations" />
              )}
              {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
              {loadState === 'ready' && chats.length === 0 && (
                <p className="chat__status">No chats found.</p>
              )}
              {loadState === 'ready' && chats.length > 0 && filteredChats.length === 0 && (
                <p className="chat__status">No matching chats.</p>
              )}
              {filteredChats.length > 0 && (
                <div className="chat-list-stack">
                  {pinnedChatGroup && renderChatGroup(pinnedChatGroup, 'pinned-chats-list')}
                  {displayedActiveChatGroups.map((group, groupIndex) =>
                    renderChatGroup(group, `cwd-chats-list-${groupIndex}`)
                  )}
                  {doneChatGroup && renderChatGroup(doneChatGroup, 'cwd-chats-list-done')}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div
          className="chat__resize-handle"
          ref={resizeHandleRef}
          id="chat-sidebar-resize"
          role="separator"
          aria-label="Resize chat from left"
          aria-orientation="vertical"
          onFocus={(event) => event.currentTarget.blur()}
          onPointerDown={(event) => handleStartChatResize('left', event)}
          onPointerUp={(event) => event.currentTarget.blur()}
        />

        <div className="chat__detail-panel" data-panel="true" id="detail">
          {(selectedChat || newChatOpen) && (
            <header className="chat-detail__header">
              <div className="chat-detail__drag-region">
                <div className="chat-detail__header-inner">
                  <span className="chat-detail__back-slot">
                    <Button
                      theme="transparent"
                      aria-label="Back"
                      title="Back"
                      callback={handleBack}
                      icon={<ArrowLeft aria-hidden="true" />}
                    />
                  </span>
                </div>
              </div>
            </header>
          )}
          <section
            className={`chat-panel${selectedChat ? ' chat-panel--selected' : ' chat-panel--empty'}${newChatOpen ? ' chat-panel--new' : ''}`}
            aria-label={selectedChat?.title ?? 'No chat selected'}
          >
            {selectedChat && chatSearchOpen && (
              <div className="chat-detail__search" role="search" aria-label="Find in conversation">
                <label className="sr-only" htmlFor="chat-detail-search">
                  Find in conversation
                </label>
                <Input
                  ref={chatSearchInputRef}
                  className="chat-detail__search-input"
                  id="chat-detail-search"
                  type="search"
                  value={chatSearchQuery}
                  placeholder="Find in conversation"
                  aria-controls="chat-search-content"
                  onChange={(event) => setChatSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return

                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleChatSearchNavigation(event.shiftKey ? -1 : 1)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      closeChatSearch()
                    }
                  }}
                />
                <span
                  className="chat-detail__search-status"
                  id="chat-detail-search-status"
                  role="status"
                  aria-live="polite"
                >
                  {chatSearchQuery
                    ? chatSearchMatchCount > 0
                      ? `${chatSearchActiveIndex + 1} of ${chatSearchMatchCount}`
                      : 'No matches'
                    : ''}
                </span>
                <div className="chat-detail__search-actions">
                  <Button
                    theme="transparent"
                    size="small"
                    disabled={chatSearchMatchCount === 0}
                    aria-label="Previous match"
                    title="Previous match (Shift+Enter)"
                    callback={() => handleChatSearchNavigation(-1)}
                    icon={<ChevronUp aria-hidden="true" />}
                  />
                  <Button
                    theme="transparent"
                    size="small"
                    disabled={chatSearchMatchCount === 0}
                    aria-label="Next match"
                    title="Next match (Enter)"
                    callback={() => handleChatSearchNavigation(1)}
                    icon={<ChevronDown aria-hidden="true" />}
                  />
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label="Close chat search"
                    title="Close chat search (Escape)"
                    callback={closeChatSearch}
                    icon={<X aria-hidden="true" />}
                  />
                </div>
              </div>
            )}
            {selectedChat && (
              <div className="chat-detail__messages-shell">
                <div
                  className="chat-detail__messages"
                  id="chat-search-content"
                  key={selectedChatKey}
                  onScroll={handleNativeChatContentScroll}
                  onWheel={handleNativeChatContentWheel}
                  ref={(element) => {
                    contentRef.current = element
                    chatSearchContentRef.current = element
                  }}
                >
                  <div className="chat-detail__messages-layout">
                    <div className="chat-detail__messages-header" />
                    <div className="chat-detail__messages-inner">
                      {renderedChatTurns.map((turn, index) =>
                        renderChatTurn((effectiveChatTurnWindow?.startIndex ?? 0) + index, turn)
                      )}
                    </div>
                    <div className="chat-detail__messages-footer" />
                  </div>
                </div>
                {chatLoadState === 'loading' && (
                  <p className="chat__status chat-detail__messages-status">Loading messages…</p>
                )}
                {chatLoadState === 'error' && (
                  <p className="chat__status chat-detail__messages-status">
                    Unable to load messages.
                  </p>
                )}
                {!editingMessage &&
                  chatLoadState === 'ready' &&
                  visibleChatItems.length === 0 &&
                  selectedChatCommitMarkers.length === 0 && (
                    <p className="chat__status chat-detail__messages-status">No messages found.</p>
                  )}
                {chatTurnPageLoadDirection && chatTurnPageLoadDirection !== 'latest' && (
                  <span
                    className={`chat-detail__turn-page-loading chat-detail__turn-page-loading--${chatTurnPageLoadDirection}`}
                    role="status"
                  >
                    Loading…
                  </span>
                )}
                {showChatTurnDownButton && (
                  <div className="chat-detail__down-button">
                    <Button
                      aria-label="Jump to latest messages"
                      disabled={chatTurnPageLoadDirection === 'latest'}
                      theme="secondary"
                      title="Jump to latest messages"
                      callback={() => loadChatTurnPage('latest')}
                      icon={<ChevronDown aria-hidden="true" />}
                    />
                  </div>
                )}
              </div>
            )}
            {selectedChat && (
              <MessageSelectionQuoteButton
                containerRef={contentRef}
                enabled={!editingMessage}
                key={selectedChatKey}
                onQuote={handleQuoteSelectedMessageText}
              />
            )}
            {!effectiveAppSettings.chat.hidePlans && (
              <ChatPlan key={selectedChatKey ?? 'no-chat'} plan={messageBoxPlan} />
            )}
            <div className="chat-panel__composer">
              <div className="chat-panel__composer-inner">
                {requestErrorVisible && (
                  <section
                    className="chat-approval chat-request-error"
                    aria-label="Request error"
                    role="alert"
                  >
                    <div className="chat-approval__main">
                      <span className="chat-approval__label">Request failed</span>
                      <span className="chat-approval__summary" title={requestErrorSummary}>
                        {requestErrorSummary}
                      </span>
                    </div>
                    <div className="chat-approval__actions">
                      <Button
                        aria-label="Dismiss error"
                        title="Dismiss error"
                        callback={handleDismissSendError}
                        icon={<X aria-hidden="true" />}
                        size="small"
                        theme="transparent"
                      />
                    </div>
                  </section>
                )}
                {!selectedChat && newChatOpen && remoteContainerSuggestionsError && (
                  <section
                    className="chat-approval chat-request-error"
                    aria-label="Container lookup error"
                    role="alert"
                  >
                    <div className="chat-approval__main">
                      <span className="chat-approval__label">Container lookup failed</span>
                      <span
                        className="chat-approval__summary"
                        title={remoteContainerSuggestionsError}
                      >
                        {remoteContainerSuggestionsError}
                      </span>
                    </div>
                    <div className="chat-approval__actions">
                      <Button
                        aria-label="Dismiss container lookup error"
                        title="Dismiss error"
                        callback={() => setRemoteContainerSuggestionsError(null)}
                        icon={<X aria-hidden="true" />}
                        size="small"
                        theme="transparent"
                      />
                    </div>
                  </section>
                )}
                {!selectedChat && newChatOpen && providerUpdateSuggestion && (
                  <section
                    className="chat-approval chat-provider-update"
                    aria-label={`${providerLabels[providerUpdateSuggestion.providerId]} update suggestion`}
                  >
                    <div className="chat-approval__main">
                      <span className="chat-approval__label">
                        {providerLabels[providerUpdateSuggestion.providerId]} update available
                      </span>
                      <span
                        className="chat-approval__summary"
                        title={getProviderUpdateSummary(providerUpdateSuggestion)}
                      >
                        {getProviderUpdateSummary(providerUpdateSuggestion)}
                      </span>
                      {providerUpdateError && (
                        <span className="chat-approval__error" role="status">
                          {providerUpdateError}
                        </span>
                      )}
                    </div>
                    <div className="chat-approval__actions">
                      <Button
                        disabled={providerUpdateState === 'updating'}
                        callback={handleSkipProviderUpdate}
                        dropdownActions={[
                          {
                            id: 'never-suggest-version',
                            label: 'Never suggest this version',
                            title: `Never suggest ${providerUpdateSuggestion.latestVersion}`,
                            disabled: providerUpdateState === 'updating',
                            icon: <X aria-hidden="true" />,
                            callback: handleNeverSuggestProviderUpdateVersion
                          },
                          {
                            id: 'never-suggest',
                            label: 'Never suggest',
                            disabled: providerUpdateState === 'updating',
                            icon: <BellOff aria-hidden="true" />,
                            callback: handleNeverSuggestProviderUpdate
                          }
                        ]}
                        dropdownLabel="Skip update options"
                        dropdownMenuAlign="end"
                        dropdownPlacement="top"
                        icon={<X aria-hidden="true" />}
                        label={<span>Skip</span>}
                        theme="secondary"
                      />
                      <Button
                        disabled={providerUpdateState === 'updating'}
                        callback={() => void handleUpdateProvider()}
                        icon={<Download aria-hidden="true" />}
                        label={
                          <span>{providerUpdateState === 'updating' ? 'Updating' : 'Update'}</span>
                        }
                        theme="primary"
                      />
                    </div>
                  </section>
                )}
                {!selectedChat && newChatOpen && (
                  <div className="chat-panel__new-session">
                    <span>New session of</span>
                    <Dropdown
                      aria-label="Project"
                      title={newSessionCwd ?? 'Choose folder'}
                      disabled={providerUpdateInProgress || sendState === 'sending'}
                      menuActions={[
                        {
                          id: 'add-project',
                          label: 'Add project..',
                          title: 'Add project..',
                          icon: <FolderPlus aria-hidden="true" />,
                          callback: () => void handleSelectNewSessionFolder()
                        }
                      ]}
                      options={projectOptions}
                      placement="top"
                      size="small"
                      value={newSessionProjectValue}
                      onChange={(cwd) => setNewSessionCwd(cwd)}
                    />
                    <span>with</span>
                    <Dropdown
                      aria-label="Provider"
                      disabled={
                        providerUpdateInProgress ||
                        sendState === 'sending' ||
                        newSessionProviderOptions.length === 0
                      }
                      emptyContent="No providers found"
                      options={newSessionProviderOptions}
                      placement="top"
                      size="small"
                      value={newSessionProvider}
                      valueContent={newSessionProviderValueContent}
                      onChange={setNewSessionProvider}
                    />
                    <span>in</span>
                    <Dropdown
                      aria-label="Session location"
                      disabled={providerUpdateInProgress || sendState === 'sending'}
                      options={newSessionLocationOptions}
                      placement="top"
                      size="small"
                      value={newSessionLocation}
                      onChange={setNewSessionLocation}
                    />
                    <span>{newSessionSshEnvironmentId ? 'over' : 'from'}</span>
                    <Dropdown
                      aria-label="Runtime"
                      disabled={providerUpdateInProgress || sendState === 'sending'}
                      menuActions={[
                        ...(sshEnvironmentError
                          ? [
                              {
                                id: 'environment-error',
                                label: sshEnvironmentError,
                                title: sshEnvironmentError,
                                disabled: true,
                                icon: <X aria-hidden="true" />,
                                callback: () => {}
                              }
                            ]
                          : []),
                        {
                          id: 'add-environment',
                          label: 'Add environment',
                          title: 'Add environment',
                          icon: <PackagePlus aria-hidden="true" />,
                          callback: () => {
                            setEditingSshEnvironment(null)
                            setSshEnvironmentError(null)
                            setSshEnvironmentDialogOpen(true)
                          }
                        }
                      ]}
                      options={containerOptions}
                      placement="top"
                      size="small"
                      value={newSessionContainerValue}
                      onChange={handleNewSessionContainerChange}
                    />
                    {newSessionSshEnvironmentId && newSessionRemoteRuntime && (
                      <>
                        <span>from</span>
                        <Dropdown
                          aria-label="Remote runtime"
                          disabled={
                            providerUpdateInProgress ||
                            sendState === 'sending' ||
                            remoteContainerSuggestionsLoading
                          }
                          options={remoteRuntimeOptions}
                          placement="top"
                          size="small"
                          value={getContainerTargetKey(newSessionRemoteRuntime)}
                          valueContent={remoteContainerSuggestionsLoading ? 'Checking' : undefined}
                          onChange={handleNewSessionRemoteRuntimeChange}
                        />
                      </>
                    )}
                  </div>
                )}
                {!selectedChat && newChatOpen && worktreeCreationState !== 'idle' && (
                  <section
                    className="chat-approval chat-worktree-creation"
                    aria-label="Worktree creation"
                  >
                    <div className="chat-approval__main">
                      <span className="chat-approval__label">Creating worktree</span>
                    </div>
                    <div className="chat-approval__actions">
                      <Button
                        disabled={worktreeCreationState === 'canceling'}
                        callback={() => void handleCancelWorktreeCreation()}
                        icon={<X aria-hidden="true" />}
                        label={<span>Cancel</span>}
                        theme="secondary"
                      />
                    </div>
                  </section>
                )}
                {selectedChat && pendingApproval && (
                  <section className="chat-approval" aria-label="Approval request">
                    <div className="chat-approval__main">
                      <span className="chat-approval__label">
                        {approvalTypeLabels[pendingApproval.type]}
                      </span>
                      <span
                        className="chat-approval__summary"
                        title={getApprovalSummary(pendingApproval)}
                      >
                        {getApprovalSummary(pendingApproval)}
                      </span>
                      {pendingApproval.cwd && pendingApproval.command && (
                        <span className="chat-approval__cwd" title={pendingApproval.cwd}>
                          {pendingApproval.cwd}
                        </span>
                      )}
                      {approvalError && (
                        <span className="chat-approval__error" role="status">
                          {approvalError}
                        </span>
                      )}
                    </div>
                    <div className="chat-approval__actions">
                      <Button
                        disabled={providerUpdateInProgress || Boolean(approvalDecisionInFlight)}
                        callback={() => void handleResolveApproval('deny')}
                        icon={<X aria-hidden="true" />}
                        label={<span>Deny</span>}
                        theme="secondary"
                      />
                      <Button
                        disabled={providerUpdateInProgress || Boolean(approvalDecisionInFlight)}
                        callback={() => void handleResolveApproval('allow')}
                        icon={<Check aria-hidden="true" />}
                        label={<span>Allow</span>}
                        theme="primary"
                      />
                    </div>
                  </section>
                )}
                {selectedChat && pendingUserInput && (
                  <UserInputRequestBox
                    disabled={providerUpdateInProgress || userInputResolving}
                    error={userInputError}
                    key={pendingUserInput.id}
                    request={pendingUserInput}
                    onCancel={() => resolveSelectedUserInput({ kind: 'cancel' })}
                    onSubmit={(answer, wasFreeform) =>
                      resolveSelectedUserInput({ kind: 'answer', answer, wasFreeform })
                    }
                  />
                )}
                <MessageBox
                  active={editingMessage ? false : chatHasActiveTurn}
                  activePrimaryMode="queue"
                  activeSteeringEnabled={!chatHasPendingSteeringMessage}
                  actions={appSettings.actions}
                  approvalMode={effectiveApprovalMode}
                  approvalModes={approvalModes}
                  autoFocus={!selectedChat && newChatOpen}
                  disabled={messageBoxDisabled}
                  editSession={editingMessage}
                  accountUsage={accountUsage}
                  accountUsageError={accountUsageError}
                  accountUsageState={accountUsageState}
                  container={changesContainer}
                  contextUsage={messageBoxContextUsage}
                  displayUsage={effectiveAppSettings.chat.displayUsage}
                  lastActionId={appSettings.lastActionId}
                  model={effectiveModel}
                  models={models}
                  modelsUnavailable={!messageBoxProviderAvailable}
                  notesContextKey={messageBoxNotesGroup?.key}
                  notes={
                    messageBoxNotesGroup
                      ? (cwdNotesByGroup[messageBoxNotesGroup.key] ?? [])
                      : undefined
                  }
                  notesLabel={messageBoxNotesGroup?.label}
                  operationsDisabled={
                    providerUpdateInProgress ||
                    Boolean(selectedChatAiCommitAction) ||
                    !messageBoxProviderAvailable
                  }
                  pending={sendState === 'sending'}
                  providerId={selectedChat?.providerId ?? newSessionProvider}
                  projectCwd={changesProjectCwd}
                  quoteRequest={messageBoxQuoteRequest}
                  cwd={changesCwd}
                  reasoningEffort={effectiveReasoningEffort}
                  sandboxMode={effectiveSandboxMode}
                  sandboxModes={sandboxModes}
                  selectedReview={selectedReview}
                  serviceTier={effectiveServiceTier}
                  showAccessSelector={
                    messageBoxProviderAvailable &&
                    effectiveAppSettings.chat.forceAccess === appChatManualDropdownValue
                  }
                  showActions={effectiveAppSettings.chat.enableActions}
                  showActionLabel={hasForcedChatDropdown}
                  showModelSelector={
                    effectiveAppSettings.chat.forceModel === appChatManualDropdownValue
                  }
                  showNotesButton={effectiveAppSettings.chat.enableNotesButton}
                  showReasoningSelector={
                    messageBoxProviderAvailable &&
                    effectiveAppSettings.chat.forceReasoning === appChatManualDropdownValue
                  }
                  showReviewSelector={
                    messageBoxProviderAvailable &&
                    effectiveAppSettings.chat.forceReview === appChatManualDropdownValue
                  }
                  showSpeedSelector={
                    messageBoxProviderAvailable &&
                    effectiveAppSettings.chat.forceSpeed === appChatManualDropdownValue
                  }
                  onActionsChange={handleActionsChange}
                  onLastActionChange={handleLastActionChange}
                  onApprovalModeChange={handleApprovalModeChange}
                  onCancelEdit={handleCancelEditMessage}
                  onModelChange={handleModelChange}
                  onNotesChange={
                    messageBoxNotesGroup
                      ? (notes) => handleCwdNotesChange(messageBoxNotesGroup, notes)
                      : undefined
                  }
                  onOpenAttachment={changesCwd ? handleOpenAttachment : undefined}
                  onOpenFileLink={changesCwd ? handleOpenFileLink : undefined}
                  onReasoningEffortChange={handleReasoningEffortChange}
                  onRunAction={handleRunAction}
                  onServiceTierChange={setServiceTier}
                  onSelectedReviewChange={handleSelectedReviewChange}
                  onSandboxModeChange={handleSandboxModeChange}
                  onStop={handleStopChat}
                  onUsageRefresh={refreshAccountUsage}
                  onUsageReset={resetAccountRateLimits}
                  onSend={handleSendMessage}
                />
              </div>
            </div>
          </section>
        </div>

        <div
          className="chat__resize-handle chat__resize-handle--changes"
          ref={changesResizeHandleRef}
          id="chat-changes-resize"
          role="separator"
          aria-label="Resize chat from right"
          aria-orientation="vertical"
          onFocus={(event) => event.currentTarget.blur()}
          onPointerDown={(event) => handleStartChatResize('right', event)}
          onPointerUp={(event) => event.currentTarget.blur()}
        />

        <div className="chat__changes-panel" data-panel="true" id="changes">
          <aside className="changes-sidebar" aria-label="Workspace sidebar">
            <header className="changes-sidebar__header">
              {renderWindowControls('default')}
              <div className="changes-sidebar__titlebar">
                <SegmentedControl
                  aria-label="Sidebar view"
                  className="changes-sidebar__view-toggle"
                  options={[
                    {
                      value: 'git',
                      label: null,
                      ariaLabel: 'Git',
                      title: 'Git',
                      icon: <GitBranch aria-hidden="true" />
                    },
                    {
                      value: 'files',
                      label: null,
                      ariaLabel: 'Files',
                      title: 'Files',
                      icon: <Files aria-hidden="true" />
                    },
                    {
                      value: 'terminal',
                      label: null,
                      ariaLabel: 'Terminal',
                      title: 'Terminal (Ctrl+`)',
                      icon: <Terminal aria-hidden="true" />
                    }
                  ]}
                  value={changesPaneView}
                  onChange={handleChangesPaneViewChange}
                />
                <div className="changes-sidebar__settings-slot">{renderSettingsButton()}</div>
              </div>
              {changesPaneView !== 'terminal' && (
                <div className="changes-sidebar__controls changes-sidebar__controls--files">
                  <label className="sr-only" htmlFor="changes-branch">
                    Branch
                  </label>
                  <BranchSwitcher
                    branches={branchNames}
                    busy={gitBranchActionState === 'sending'}
                    canForceDelete={Boolean(gitBranchDeleteRetry)}
                    currentBranch={currentBranchName}
                    deleteWorktreePath={gitBranchWorktreeDeleteRetry?.worktreePath}
                    disabled={branchSwitchDisabled}
                    error={gitBranchError}
                    id="changes-branch"
                    loading={gitBranchLoadState === 'loading'}
                    onClearError={() => {
                      setGitBranchError(null)
                      setGitBranchDeleteRetry(null)
                      setGitBranchWorktreeDeleteRetry(null)
                      if (gitBranchActionState === 'error') setGitBranchActionState('idle')
                    }}
                    onDelete={handleDeleteBranch}
                    onDeleteWorktree={handleDeleteBranchWorktree}
                    onForceDelete={handleForceDeleteBranch}
                    onOpen={() => setGitBranchLoadRequest((currentRequest) => currentRequest + 1)}
                    onSwitch={handleSwitchBranch}
                  />
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label={treeToggleLabel}
                    title={treeToggleLabel}
                    disabled={activeTreeFolderPaths.length === 0}
                    callback={handleToggleActiveTreeFolders}
                    icon={
                      hasCollapsedActiveTreeFolders ? (
                        <ListChevronsUpDown aria-hidden="true" />
                      ) : (
                        <ListChevronsDownUp aria-hidden="true" />
                      )
                    }
                  />
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label={refreshSidebarLabel}
                    title={refreshSidebarLabel}
                    disabled={!changesCwd || activeSidebarLoadState === 'loading'}
                    callback={() => {
                      if (changesPaneView === 'files') {
                        setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
                        return
                      }

                      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
                    }}
                    icon={<GitRefreshIcon />}
                  />
                </div>
              )}
            </header>
            <div
              className={`changes-sidebar__body${
                changesPaneView === 'terminal' ? ' changes-sidebar__body--terminal' : ''
              }`}
            >
              {changesPaneView !== 'terminal' && (
                <div className="changes-sidebar__content">
                  {changesPaneView === 'git' ? (
                    <>
                      {visibleChangesLoadState === 'loading' && (
                        <ChangesSidebarGitState active label="Loading changes" />
                      )}
                      {visibleChangesLoadState === 'error' && (
                        <p className="changes-sidebar__status">Unable to load changes.</p>
                      )}
                      {visibleChangesLoadState === 'ready' && changedFiles.length === 0 && (
                        <ChangesSidebarGitState active={false} label={changesEmptyMessage} />
                      )}
                      {visibleChangesLoadState === 'ready' && changedFiles.length > 0 && (
                        <ul className="changes-sidebar__tree" role="tree">
                          {changeTree.map((node) => renderChangeTreeNode(node, 0))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {visibleFilesLoadState === 'loading' && (
                        <ChangesSidebarGitState active label="Loading files" />
                      )}
                      {visibleFilesLoadState === 'error' && (
                        <p className="changes-sidebar__status">Unable to load files.</p>
                      )}
                      {visibleFilesLoadState === 'ready' && repositoryFiles.length === 0 && (
                        <p className="changes-sidebar__status">{filesEmptyMessage}</p>
                      )}
                      {visibleFilesLoadState === 'ready' && repositoryFiles.length > 0 && (
                        <ul className="changes-sidebar__tree" role="tree">
                          {repositoryFileTree.map((node) => renderRepositoryFileTreeNode(node, 0))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
              {terminalOpened && (
                <div
                  className={`changes-sidebar__terminal${
                    changesPaneView === 'terminal' ? ' changes-sidebar__terminal--active' : ''
                  }`}
                  aria-hidden={changesPaneView !== 'terminal'}
                >
                  <TerminalPanel
                    active={changesPaneView === 'terminal'}
                    commandLaunchRequest={terminalCommandLaunchRequest}
                    container={changesContainer}
                    cwd={changesCwd}
                    projectCwd={changesProjectCwd}
                    workspaceKey={terminalWorkspaceKey}
                  />
                </div>
              )}
            </div>
            {changesPaneView === 'git' && (
              <footer className="changes-sidebar__footer">
                <div className="changes-sidebar__input-row">
                  <label className="changes-sidebar__commit-message">
                    <span className="sr-only">{commitInputLabel}</span>
                    <Input
                      type="text"
                      value={commitInput}
                      placeholder={commitInputLabel}
                      disabled={
                        providerUpdateInProgress ||
                        commitState === 'sending' ||
                        commitMessageGenerationInProgress ||
                        directProjectCommitInProgress ||
                        currentChatAiCommitInProgress
                      }
                      onChange={(event) => {
                        setCommitState('idle')
                        setCommitMessageGenerationState('idle')
                        setCommitError(null)
                        setCommitInput(event.target.value)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !commitDisabled) {
                          void handleCommitChangedFiles()
                        }
                      }}
                    />
                  </label>
                  <Button
                    aria-label={
                      commitMessageGenerationInProgress
                        ? 'Generating commit name'
                        : 'Generate commit name with AI'
                    }
                    aria-busy={commitMessageGenerationInProgress}
                    title={
                      commitMessageGenerationInProgress
                        ? 'Generating commit name…'
                        : 'Generate commit name with AI'
                    }
                    disabled={commitMessageGenerationDisabled}
                    callback={() => void handleGenerateCommitMessage()}
                    icon={<Sparkles aria-hidden="true" />}
                    theme="secondary"
                  />
                </div>
                <div className="changes-sidebar__commit-row">
                  <Button
                    disabled={commitDisabled}
                    callback={() => void handleCommitChangedFiles('commit')}
                    dropdownActions={[
                      {
                        id: 'amend',
                        label: commitActionLabels.amend,
                        disabled: getCommitActionDisabled('amend'),
                        icon: <GitCommitHorizontal aria-hidden="true" />,
                        callback: () => void handleCommitChangedFiles('amend')
                      },
                      {
                        id: 'ai-chat-commit',
                        label: 'AI Chat Commit',
                        disabled: getAiCommitActionDisabled(),
                        icon: <Sparkles aria-hidden="true" />,
                        callback: () => void handleAiCommitChangedFiles('commit')
                      },
                      {
                        id: 'ai-chat-amend',
                        label: 'AI Chat Amend',
                        disabled: getAiCommitActionDisabled(),
                        icon: <Sparkles aria-hidden="true" />,
                        callback: () => void handleAiCommitChangedFiles('amend')
                      }
                    ]}
                    dropdownLabel="Commit actions"
                    dropdownMenuAlign="end"
                    dropdownPlacement="top"
                    icon={
                      commitState === 'sending' ? (
                        <AnimatedStatusIcon Icon={AnimatedGitCommitHorizontalIcon} active />
                      ) : (
                        <GitCommitHorizontal aria-hidden="true" />
                      )
                    }
                    label={<span>{commitActionLabels.commit}</span>}
                    theme="primary"
                    fill
                  />
                </div>
                {hasSyncChanges && (
                  <div className="changes-sidebar__sync-row">
                    <Button
                      title={syncButtonTitle}
                      disabled={syncDisabled}
                      callback={() => void handleSyncChanges(primarySyncAction)}
                      dropdownActions={syncDropdownActions}
                      dropdownLabel="Sync actions"
                      dropdownMenuAlign="end"
                      dropdownPlacement="top"
                      label={
                        <GitSyncCountsLabel
                          active={syncInProgress}
                          unpulledCount={unpulledCount}
                          unpushedCount={unpushedCount}
                        />
                      }
                      theme="secondary"
                      fill
                    />
                  </div>
                )}
                {visibleSyncRecovery && (
                  <section
                    className="chat-approval changes-sidebar__sync-recovery"
                    aria-label="Git recovery options"
                  >
                    <div className="changes-sidebar__sync-recovery-header">
                      <span className="chat-approval__label">
                        {visibleSyncRecovery.failure.title}
                      </span>
                      <Button
                        aria-label="Dismiss Git recovery options"
                        title="Dismiss"
                        disabled={syncInProgress}
                        callback={handleDismissGitSyncRecovery}
                        icon={<X aria-hidden="true" />}
                        theme="transparent"
                        size="small"
                      />
                    </div>
                    <span
                      className="chat-approval__summary"
                      title={visibleSyncRecovery.failure.message}
                    >
                      {visibleSyncRecovery.failure.message}
                    </span>
                    <span
                      className="chat-approval__cwd changes-sidebar__sync-recovery-command"
                      title={visibleSyncRecovery.failure.command}
                    >
                      {visibleSyncRecovery.failure.command}
                    </span>
                    {visibleSyncRecovery.error && (
                      <span className="chat-approval__error" role="status">
                        {visibleSyncRecovery.error}
                      </span>
                    )}
                    <div
                      className={`changes-sidebar__sync-recovery-actions${
                        visibleSyncRecovery.failure.actions.length === 1
                          ? ' changes-sidebar__sync-recovery-actions--single'
                          : ''
                      }`}
                    >
                      {visibleSyncRecovery.failure.actions.map((action, actionIndex) => {
                        const rememberLabel = getGitRecoveryRememberLabel(action.id)

                        return (
                          <Button
                            key={action.id}
                            title={action.description}
                            disabled={syncInProgress}
                            callback={() => void handleGitSyncRecoveryAction(action.id)}
                            dropdownActions={
                              rememberLabel
                                ? [
                                    {
                                      id: `${action.id}-remember`,
                                      label: rememberLabel,
                                      title: `${rememberLabel} for this repository`,
                                      callback: () =>
                                        void handleGitSyncRecoveryAction(action.id, {
                                          rememberStrategy: true
                                        })
                                    }
                                  ]
                                : undefined
                            }
                            dropdownLabel={`${action.label} options`}
                            dropdownMenuAlign="end"
                            dropdownPlacement="top"
                            icon={getGitRecoveryActionIcon(action.id)}
                            label={<span>{action.label}</span>}
                            theme={actionIndex === 0 ? 'primary' : 'secondary'}
                            size="small"
                            fill
                          />
                        )
                      })}
                    </div>
                    <div className="changes-sidebar__sync-recovery-ai">
                      <Button
                        title={`Ask ${providerLabels[configProviderId]} to resolve this Git sync issue once`}
                        disabled={gitAiResolutionDisabled}
                        callback={() => void handleGitAiResolution()}
                        dropdownActions={[
                          {
                            id: 'ai-remember',
                            label: 'Make it remember',
                            title: `Ask ${providerLabels[configProviderId]} to configure a repo-local pull strategy, then sync`,
                            callback: () => void handleGitAiResolution(true)
                          }
                        ]}
                        dropdownLabel="AI resolution options"
                        dropdownMenuAlign="end"
                        dropdownPlacement="top"
                        icon={<Sparkles aria-hidden="true" />}
                        label={<span>AI Resolution</span>}
                        theme="secondary"
                        size="small"
                        fill
                      />
                    </div>
                  </section>
                )}
                {(commitState === 'error' || commitMessageGenerationState === 'error') && (
                  <p className="changes-sidebar__commit-error" role="status">
                    {commitError ?? 'Unable to commit these files.'}
                  </p>
                )}
                {syncState === 'error' && !syncRecovery && (
                  <p className="changes-sidebar__commit-error" role="status">
                    {syncError ?? 'Unable to sync changes.'}
                  </p>
                )}
              </footer>
            )}
          </aside>
        </div>
      </div>
    </main>
  )
}
