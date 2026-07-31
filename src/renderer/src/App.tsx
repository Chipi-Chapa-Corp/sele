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
import {
  Apple,
  AppWindow,
  ArrowLeft,
  BadgeCheck,
  BellOff,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Check,
  Download,
  FileLock,
  Files,
  FolderKanban,
  FolderPen,
  FolderPlus,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  Link2,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  MessageSquare,
  ShieldQuestionMark,
  Sparkles,
  SquarePen,
  Sun,
  Terminal,
  Upload,
  UnlockKeyhole,
  X,
  Zap
} from 'lucide-react'
import {
  DownloadIcon as AnimatedDownloadIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  GitCommitHorizontalIcon as AnimatedGitCommitHorizontalIcon,
  UploadIcon as AnimatedUploadIcon
} from 'lucide-animated'
import {
  FileIcon as SymbolsFileIcon,
  FolderIcon as SymbolsFolderIcon
} from '@react-symbols/icons/utils'
import type {
  AppSelectedAttachment,
  AppFileTreeResult,
  AppGitBranchesResult,
  AppGitChangeKind,
  AppGitChangesResult,
  AppGitCommitAction,
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
  providerIds
} from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { ChatListGroup, type ChatListGroupData } from './components/ChatListGroup'
import { BranchSwitcher } from './components/BranchSwitcher'
import { Button, type ButtonDropdownAction } from './components/Button'
import { ChatPlan, type ChatPlanData, type ChatPlanItem } from './components/ChatPlan'
import { Dropdown, type DropdownOption } from './components/Dropdown'
import { FileEditorDialog, type FileEditorTarget } from './components/FileEditorDialog'
import { getReasoningEffortPresentation } from './reasoningEffortPresentation'
import { Input } from './components/Input'
import { MessageBox } from './components/MessageBox'
import { SegmentedControl } from './components/SegmentedControl'
import {
  TerminalPanel,
  type AgentTerminalSnapshot,
  type TerminalCommandLaunchRequest,
  type TerminalLaunchRequest
} from './components/TerminalPanel'
import type { AppAction } from './actions'
import { getAppActionKeybindingFromEvent } from './actions'
import { appApi } from './appApi'
import { providerApi } from './providerApi'
import { terminalApi } from './terminalApi'
import {
  type AppAppearancePositionPreference,
  type AppAppearanceControlStylePreference,
  type AppAppearanceStylePreference,
  type AppGitCommitMessageGenerationSettings,
  type AppGitCommitPromptSettings,
  type AppChatDropdownSettings,
  type AppChatUsageDisplay,
  type AppExternalLinkBehavior,
  type AppSettings,
  type AppThemePreference,
  appChatManualDropdownValue,
  appChatStandardSpeedValue,
  readStoredAppSettings,
  writeStoredAppSettings
} from './settings'
import { setThemePreference } from './systemColorScheme'
import {
  clearChatSearchHighlights,
  findChatSearchMatches,
  scrollChatSearchMatchIntoView,
  setChatSearchHighlights
} from './chatSearch'
import './App.css'

type LoadState = 'loading' | 'ready' | 'error'
type SendState = 'idle' | 'sending' | 'error'
type ApplyChatDetailOptions = {
  select?: boolean
}
type CommittedChatUpdate = {
  sequence: number
  detailApplied: boolean
}
type EditingMessage =
  | (Pick<ProviderMessage, 'id' | 'content'> & { type: 'message' })
  | (Pick<ProviderPendingMessage, 'id' | 'content' | 'kind'> & { type: 'pending' })
type ApprovalResolutionState = {
  approvalId: string | null
  decision: ProviderApprovalDecision | null
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
type CachedPatchChangedFiles = {
  cwd: string
  source: PatchChangeSource
  files: ChangedFile[]
}
type FileTreeScope = {
  cwd: string
}
type GitBranchesScope = {
  cwd: string
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
}
type ChangeTreeNode<TFile extends TreeFile = TreeFile> =
  ChangeTreeFolderNode<TFile> | ChangeTreeFileNode<TFile>
type MutableChangeTreeFolder<TFile extends TreeFile = TreeFile> = {
  name: string
  path: string
  folders: Map<string, MutableChangeTreeFolder<TFile>>
  files: ChangeTreeFileNode<TFile>[]
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
type ChatBooleanSettingKey = {
  [Key in keyof AppSettings['chat']]: AppSettings['chat'][Key] extends boolean ? Key : never
}[keyof AppSettings['chat']]
type ChatBooleanSettingField = {
  key: ChatBooleanSettingKey
  label: string
  description?: string
  id: string
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
type ChatResizeEdge = 'left' | 'right'
type GitChangesScope = {
  cwd: string
  source: GitChangeSource
}
type PatchFilterScope = {
  cwd: string
  source: PatchChangeSource
  signature: string
}
type UncommittedPatchFilter = {
  scope: PatchFilterScope
  patches: AppGitPatchChange[]
}
type ProjectOptionData = {
  cwd: string
  updatedAt: number
}

const chatPageSize = 20
const chatSidebarDefaultWidth = 280
const changesSidebarDefaultWidth = 240
const chatSidebarMinWidth = 220
const changesSidebarMinWidth = 220
const chatBlockMinWidth = 320
const chatResizeHandleWidth = 9
const chatResizeHandleCount = 2
const chatPaneDefaultReferenceWidth = 1200
const chatPanePreferenceStorageKey = 'sele:chat-pane-preference:v1'
const messageBoxSelectionStorageKey = 'sele:message-box-selection:v1'
const providerUpdatePreferenceStorageKey = 'sele:provider-update-preferences:v1'
const scopedCommitActivitiesStorageKey = 'sele:scoped-commit-activities:v1'
const chatCommitMarkersStorageKey = 'sele:chat-commit-markers:v1'
const gitCurrentChatModelValue = '__sele_current_chat_model__'
const pinnedGroupKey = 'pinned'
const unknownCwdGroupKey = 'cwd:unknown'
const doneGroupKey = 'done'
const newSessionProjectPlaceholderValue = '__sele_new_session_project_placeholder__'
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
const refreshIconReplayMs = 1_050

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
  'plan'
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

const GitRefreshIcon: React.FC = () => (
  <RefreshCw className="changes-sidebar__refresh-icon" aria-hidden="true" />
)

const ChangesAnimatedIcon: React.FC<{
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
      className={['changes-sidebar__animated-icon', className].filter(Boolean).join(' ')}
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
        <ChangesAnimatedIcon
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
      <ChangesAnimatedIcon
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
            <ChangesAnimatedIcon
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
            <ChangesAnimatedIcon
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
  element.scrollTop >= getScrollBottomTop(element)

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

const readStoredMessageBoxSelection = (): StoredMessageBoxSelection => {
  try {
    const storedValue = window.localStorage.getItem(messageBoxSelectionStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const selection: StoredMessageBoxSelection = {}
    if (isProviderApprovalMode(parsedValue.approvalMode)) {
      selection.approvalMode = parsedValue.approvalMode
    } else if (isProviderApprovalPolicy(parsedValue.approvalPolicy)) {
      const approvalsReviewer = isProviderApprovalsReviewer(parsedValue.approvalsReviewer)
        ? parsedValue.approvalsReviewer
        : 'user'

      selection.approvalMode = getApprovalModeForPolicy(
        parsedValue.approvalPolicy,
        approvalsReviewer
      )
    }
    if (isProviderSandboxMode(parsedValue.sandboxMode))
      selection.sandboxMode = parsedValue.sandboxMode
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
  } catch {
    return {}
  }
}

const writeStoredMessageBoxSelection = (selection: MessageBoxSelection): void => {
  try {
    window.localStorage.setItem(messageBoxSelectionStorageKey, JSON.stringify(selection))
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
  if (appearance.buttonElevation) {
    delete root.dataset.buttonElevation
  } else {
    root.dataset.buttonElevation = 'false'
  }
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
  reasoningEffort: ProviderReasoningEffort
): boolean =>
  !model ||
  model.supportedReasoningEfforts.length === 0 ||
  model.supportedReasoningEfforts.some((option) => option.id === reasoningEffort)

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

const groupChatsForSidebar = (chats: ProviderChat[]): ChatListGroupData[] => {
  const groupsByCwd = new Map<string, ChatListGroupData>()
  const pinnedChats: ProviderChat[] = []
  const doneChats: ProviderChat[] = []

  for (const chat of chats) {
    if (chat.pinned) {
      pinnedChats.push(chat)
      continue
    }

    if (chat.done) {
      doneChats.push(chat)
      continue
    }

    const projectCwd = getChatProjectCwd(chat)
    const key = getChatCwdGroupKey(projectCwd)
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
  const pinnedGroups =
    pinnedChats.length === 0
      ? []
      : [
          {
            key: pinnedGroupKey,
            cwd: null,
            label: 'Pinned',
            chats: sortChatsForGroup(pinnedChats),
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
  createdAt: existingChat?.createdAt ?? updatedAt,
  updatedAt,
  status: detail.status,
  pendingApproval: detail.pendingApproval,
  seenUpdatedAt: detail.seenUpdatedAt ?? existingChat?.seenUpdatedAt ?? null,
  pinned: detail.pinned ?? existingChat?.pinned ?? false,
  done: detail.done ?? existingChat?.done ?? false,
  purpose: detail.purpose ?? existingChat?.purpose ?? null
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
  currentDetail: ProviderChatDetail | null
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

  const mergedItems: ProviderChatItem[] =
    chatItemsStartIndex === 0 ? [] : currentDetail!.items.slice(0, chatItemsStartIndex)
  for (const [index, item] of items.entries()) {
    if (item.type !== 'working') {
      mergedItems.push(item)
      continue
    }

    const mergedWorkingStep = getWorkingStepFromUpdate(
      item,
      currentDetail?.items[chatItemsStartIndex + index]
    )
    if (!mergedWorkingStep) return null
    mergedItems.push(mergedWorkingStep)
  }

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
  title: summary.title,
  cwd: summary.cwd,
  cwdKind: summary.cwdKind,
  projectCwd: summary.projectCwd,
  branchName: summary.branchName,
  status: summary.status,
  pendingApproval: summary.pendingApproval,
  pinned: summary.pinned,
  done: summary.done,
  seenUpdatedAt: summary.seenUpdatedAt,
  purpose: summary.purpose
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

const areChatsEqual = (first: ProviderChat, second: ProviderChat): boolean =>
  first.id === second.id &&
  first.providerId === second.providerId &&
  first.title === second.title &&
  first.preview === second.preview &&
  first.cwd === second.cwd &&
  first.cwdKind === second.cwdKind &&
  first.projectCwd === second.projectCwd &&
  first.branchName === second.branchName &&
  first.createdAt === second.createdAt &&
  first.updatedAt === second.updatedAt &&
  first.status === second.status &&
  arePendingApprovalsEqual(first.pendingApproval, second.pendingApproval) &&
  first.pinned === second.pinned &&
  first.done === second.done &&
  first.seenUpdatedAt === second.seenUpdatedAt &&
  first.purpose === second.purpose

const getChatFromUpdateSummary = (
  providerId: ProviderId,
  summary: ProviderChatUpdateSummary,
  existingChat: ProviderChat | null,
  turnCompleted: boolean
): ProviderChat => {
  const summaryChanged =
    !existingChat ||
    existingChat.title !== summary.title ||
    existingChat.cwd !== summary.cwd ||
    existingChat.cwdKind !== summary.cwdKind ||
    existingChat.projectCwd !== summary.projectCwd ||
    existingChat.branchName !== summary.branchName ||
    existingChat.status !== summary.status ||
    !arePendingApprovalsEqual(existingChat.pendingApproval, summary.pendingApproval) ||
    existingChat.pinned !== summary.pinned ||
    existingChat.done !== summary.done ||
    existingChat.seenUpdatedAt !== summary.seenUpdatedAt ||
    existingChat.purpose !== summary.purpose

  return {
    id: summary.id,
    providerId,
    title: summary.title,
    preview: !existingChat || turnCompleted ? summary.preview : existingChat.preview,
    cwd: summary.cwd,
    cwdKind: summary.cwdKind,
    projectCwd: summary.projectCwd,
    branchName: summary.branchName,
    createdAt: existingChat?.createdAt ?? summary.updatedAt,
    updatedAt:
      !existingChat || summaryChanged || turnCompleted ? summary.updatedAt : existingChat.updatedAt,
    status: summary.status,
    pendingApproval: summary.pendingApproval,
    pinned: summary.pinned,
    done: summary.done,
    seenUpdatedAt:
      existingChat?.seenUpdatedAt == null
        ? summary.seenUpdatedAt
        : summary.seenUpdatedAt == null
          ? existingChat.seenUpdatedAt
          : Math.max(existingChat.seenUpdatedAt, summary.seenUpdatedAt),
    purpose: summary.purpose
  }
}

const getOptimisticItems = (
  items: ProviderChatItem[],
  message: string,
  attachments: AppSelectedAttachment[] = [],
  review?: Omit<ProviderReview, 'prompt'> | null
): ProviderChatItem[] => {
  const createdAt = Date.now()
  const id = `optimistic:${createdAt}`

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

const hasActiveWorkingStep = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'working' && item.status === 'working') ?? false

const hasPendingSteeringMessage = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'pendingMessage' && item.kind === 'steering') ?? false

const getWorkingStepTurnId = (item: ProviderWorkingStep): string | null =>
  item.id.match(/^(.*):working(?::\d+)?$/)?.[1] ?? null

const getStoppedTurnRetryMessages = (
  items: ProviderChatItem[]
): ReadonlyMap<string, ProviderMessage> => {
  const retryMessages = new Map<string, ProviderMessage>()

  items.forEach((item, itemIndex) => {
    if (item.type !== 'working' || item.status !== 'stopped') return

    const turnId = getWorkingStepTurnId(item)
    if (!turnId) return

    const userMessage = items.find(
      (candidate, candidateIndex): candidate is ProviderMessage =>
        candidateIndex < itemIndex &&
        candidate.type === 'message' &&
        candidate.role === 'user' &&
        candidate.id.startsWith(`${turnId}:`)
    )
    if (userMessage) retryMessages.set(item.id, userMessage)
  })

  return retryMessages
}

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
  path: string
): MutableChangeTreeFolder<TFile> => ({
  name,
  path,
  folders: new Map(),
  files: []
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
      children: finalizeChangeTreeFolder(childFolder)
    }))

  const files = [...folder.files].sort((firstFile, secondFile) =>
    firstFile.name.localeCompare(secondFile.name)
  )

  return [...folders, ...files]
}

const buildChangeTree = <TFile extends TreeFile>(files: TFile[]): ChangeTreeNode<TFile>[] => {
  const root = createMutableChangeTreeFolder<TFile>('', '')

  for (const file of files) {
    const displayPath = getChangedFileDisplayPath(file)
    const pathParts = getPathParts(displayPath)
    const fileName = pathParts.pop() ?? displayPath
    let folder = root
    let folderPath = ''

    for (const folderName of pathParts) {
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName
      let childFolder = folder.folders.get(folderName)

      if (!childFolder) {
        childFolder = createMutableChangeTreeFolder(folderName, folderPath)
        folder.folders.set(folderName, childFolder)
      }

      folder = childFolder
    }

    folder.files.push({
      type: 'file',
      name: fileName,
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

const getDefaultFileTreeCollapsedFolders = (files: RepositoryFile[]): Record<string, boolean> => {
  const folderPaths = getTreeFolderPaths(buildChangeTree(files))

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
  cwd: string | null,
  source: ChangeSource,
  signature: string
): boolean =>
  Boolean(
    scope &&
    cwd &&
    isPatchChangeSource(source) &&
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
  cwd: string | null,
  source: GitChangeSource | null
): boolean => Boolean(scope && cwd && source && scope.cwd === cwd && scope.source === source)

const isFileTreeScope = (scope: FileTreeScope | null, cwd: string | null): boolean =>
  Boolean(scope && cwd && scope.cwd === cwd)

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
  const storedMessageBoxSelection = useMemo(() => readStoredMessageBoxSelection(), [])
  const [appSettings, setAppSettings] = useState<AppSettings>(readStoredAppSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const [fileEditorTarget, setFileEditorTarget] = useState<FileEditorTarget | null>(null)
  const [selectedReview, setSelectedReview] = useState<Omit<ProviderReview, 'prompt'> | null>(null)
  const [reviewCommentsDraft, setReviewCommentsDraft] = useState<ProviderReviewComment[]>([])
  const [terminalCwd, setTerminalCwd] = useState<string | null | undefined>(undefined)
  const [terminalLaunchRequest, setTerminalLaunchRequest] = useState<TerminalLaunchRequest | null>(
    null
  )
  const [terminalCommandLaunchRequest, setTerminalCommandLaunchRequest] =
    useState<TerminalCommandLaunchRequest | null>(null)
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [extractedChatPlan, setExtractedChatPlan] = useState<ChatPlanData | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('ready')
  const [chatLoadRequest, setChatLoadRequest] = useState(0)
  const [committedChatUpdate, setCommittedChatUpdate] = useState<CommittedChatUpdate | null>(null)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null)
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
  const [providerUpdateSuggestion, setProviderUpdateSuggestion] =
    useState<ProviderUpdateSuggestion | null>(null)
  const [providerUpdateState, setProviderUpdateState] = useState<ProviderUpdateState>('idle')
  const [providerUpdateError, setProviderUpdateError] = useState<string | null>(null)
  const [providerUpdatePreferences, setProviderUpdatePreferences] =
    useState<ProviderUpdatePreferences>(readStoredProviderUpdatePreferences)
  const [accountUsage, setAccountUsage] = useState<ProviderAccountUsage | null>(null)
  const [accountUsageState, setAccountUsageState] = useState<UsageLoadState>('idle')
  const [accountUsageError, setAccountUsageError] = useState<string | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(true)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')
  const configProviderId = selectedChat?.providerId ?? newSessionProvider
  const [projectHistory, setProjectHistory] = useState<ProjectOptionData[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [chatSearchMatchCount, setChatSearchMatchCount] = useState(0)
  const [chatSearchActiveIndex, setChatSearchActiveIndex] = useState(0)
  const [collapsedCwdGroups, setCollapsedCwdGroups] = useState<Record<string, boolean>>({})
  const [visibleChatCountsByGroup, setVisibleChatCountsByGroup] = useState<Record<string, number>>(
    {}
  )
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
  const recentChatCacheLimitRef = useRef(appSettings.chat.recentChatCacheLimit)
  const recentChatCacheRef = useRef(new Map<string, RecentChatCacheEntry>())
  const changesCwdRef = useRef<string | null>(null)
  const initialChatCommitMarkersRef = useRef(chatCommitMarkers)
  const scopedCommitActivitiesRef =
    useRef<Record<string, ScopedCommitActivity>>(scopedCommitActivities)
  const loadingCwdNotesRef = useRef(new Set<string>())
  const loadingProjectIconsRef = useRef(new Set<string>())
  const modelManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.model))
  const reasoningManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.reasoningEffort))
  const approvalModeManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.approvalMode))
  const sandboxModeManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.sandboxMode))
  const approvalModeBeforeFullAccessRef = useRef<ProviderApprovalMode | null>(null)
  const collapsedFileTreeFoldersByCwdRef = useRef(new Map<string, Record<string, boolean>>())
  const lastNonTerminalChangesPaneViewRef = useRef<Exclude<ChangesPaneView, 'terminal'>>('git')

  const scrollChatContentToBottom = useCallback((contentElement: HTMLElement): void => {
    const top = getScrollBottomTop(contentElement)
    chatAutoScrollTargetRef.current = { element: contentElement, top }
    contentElement.scrollTop = top
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
    selectedChatKeyRef.current = selectedChat ? getChatKey(selectedChat) : null
    selectedChatUpdatedAtRef.current = selectedChat?.updatedAt ?? null
  }, [selectedChat])

  useEffect(() => {
    chatDetailRef.current = chatDetail
  }, [chatDetail])

  useEffect(() => {
    const limit = appSettings.chat.recentChatCacheLimit
    recentChatCacheLimitRef.current = limit
    if (limit === 0) {
      recentChatCacheRef.current.clear()
      return
    }

    trimRecentChatCache(recentChatCacheRef.current, limit)
  }, [appSettings.chat.recentChatCacheLimit])

  useEffect(() => {
    scopedCommitActivitiesRef.current = scopedCommitActivities
    writeStoredScopedCommitActivities(scopedCommitActivities)
  }, [scopedCommitActivities])

  useEffect(() => {
    writeStoredChatCommitMarkers(chatCommitMarkers)
  }, [chatCommitMarkers])

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
    setThemePreference(appSettings.appearance.theme)
  }, [appSettings])

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
      const behavior = appSettings.links.behavior
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
  }, [appSettings.links])

  useLayoutEffect(() => {
    applyShadowPreference(appSettings.performance.disableShadows)
  }, [appSettings.performance.disableShadows])

  useLayoutEffect(() => {
    applyWindowControlAppearancePreferences(appSettings.appearance)
  }, [appSettings.appearance])

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
    writeStoredMessageBoxSelection({
      approvalMode,
      model,
      reasoningEffort,
      sandboxMode,
      serviceTier
    })
  }, [approvalMode, model, reasoningEffort, sandboxMode, serviceTier])

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
    const queueProviderUpdateClear = (): void => {
      queueMicrotask(() => {
        setProviderUpdateSuggestion(null)
        setProviderUpdateError(null)
      })
    }

    if (selectedChat || !newChatOpen) {
      queueProviderUpdateClear()
      return undefined
    }

    const providerId = newSessionProvider
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
      .getUpdateAvailability(providerId)
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
  }, [newChatOpen, newSessionProvider, providerUpdatePreferences, selectedChat])

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
      const results = await Promise.allSettled(
        providerIds.map((providerId) =>
          providerApi.getChats(providerId, {
            cursor: null,
            limit: chatPageSize
          })
        )
      )
      if (!active) return

      const loadedChats = results.flatMap((result) =>
        result.status === 'fulfilled' ? result.value.chats : []
      )
      setChats((currentChats) => mergeChats(currentChats, loadedChats))
      setLoadState(results.some((result) => result.status === 'fulfilled') ? 'ready' : 'error')
    }

    void loadInitialChats()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadProjectHistory = async (): Promise<void> => {
      const projectsByCwd = new Map<string, ProjectOptionData>()
      const loadedChats: ProviderChat[] = []

      await Promise.allSettled(
        providerIds.map(async (providerId) => {
          let cursor: string | null = null
          do {
            const page = await providerApi.getChats(providerId, {
              cursor,
              limit: 100
            })
            if (!active) return

            loadedChats.push(...page.chats)
            page.chats.forEach((chat) => {
              const cwd = getChatProjectCwd(chat)
              if (!cwd) return

              const existingProject = projectsByCwd.get(cwd)
              if (!existingProject || chat.updatedAt > existingProject.updatedAt) {
                projectsByCwd.set(cwd, { cwd, updatedAt: chat.updatedAt })
              }
            })
            cursor = page.nextCursor
          } while (cursor)
        })
      )

      if (active) {
        setProjectHistory(Array.from(projectsByCwd.values()))
        setChats((currentChats) => mergeChats(currentChats, loadedChats))
      }
    }

    void loadProjectHistory()

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

    queueMicrotask(() => {
      if (active) setModels(fallbackModels)
    })

    providerApi
      .getModels(configProviderId)
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
  }, [configProviderId])

  useEffect(() => {
    if (models.length === 0) return

    const defaultModel = getDefaultModel(models)

    setModel((currentModel) => {
      const currentModelExists = models.some((nextModel) => nextModel.id === currentModel)

      if (!currentModelExists) return defaultModel.id
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
      if (!reasoningManuallySelectedRef.current) return getDefaultReasoningEffort(selectedModel)
      if (modelSupportsReasoningEffort(selectedModel, currentReasoningEffort)) {
        return currentReasoningEffort
      }

      return getDefaultReasoningEffort(selectedModel)
    })

    setServiceTier((currentServiceTier) =>
      modelSupportsServiceTier(selectedModel, currentServiceTier)
        ? currentServiceTier
        : (selectedModel.defaultServiceTier ?? null)
    )
  }, [model, models])

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
    (projectCwd?: string | null): void => {
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
      setNewChatOpen(true)
    },
    [resetChatSearch]
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
        detail: {
          ...entry.detail,
          pinned: metadata.pinned,
          done: metadata.done,
          seenUpdatedAt: metadata.seenUpdatedAt,
          purpose: metadata.purpose
        }
      })
    }

    setChats((currentChats) =>
      currentChats.map((chat) => {
        const metadata = metadataById.get(chat.id)
        return metadata
          ? {
              ...chat,
              pinned: metadata.pinned,
              done: metadata.done,
              seenUpdatedAt: metadata.seenUpdatedAt,
              purpose: metadata.purpose
            }
          : chat
      })
    )
    setSelectedChat((currentChat) => {
      if (!currentChat) return currentChat

      const metadata = metadataById.get(currentChat.id)
      return metadata
        ? {
            ...currentChat,
            pinned: metadata.pinned,
            done: metadata.done,
            seenUpdatedAt: metadata.seenUpdatedAt,
            purpose: metadata.purpose
          }
        : currentChat
    })
    setChatDetail((currentDetail) => {
      if (!currentDetail) return currentDetail

      const metadata = metadataById.get(currentDetail.id)
      return metadata
        ? {
            ...currentDetail,
            pinned: metadata.pinned,
            done: metadata.done,
            seenUpdatedAt: metadata.seenUpdatedAt,
            purpose: metadata.purpose
          }
        : currentDetail
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
            ? getChatDetailFromUpdate(event.detail, chatDetailRef.current)
            : null

        if (selectedDetail) {
          applyChatDetail(event.providerId, selectedDetail)
          setCommittedChatUpdate({
            sequence: event.sequence,
            detailApplied: true
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
    providerApi.acknowledgeChatUpdate(
      committedChatUpdate.sequence,
      committedChatUpdate.detailApplied
    )
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
      appSettings.chat.hidePlans ||
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
    appSettings.chat.hidePlans,
    chatDetail?.id,
    chatDetail?.items,
    selectedChatId,
    selectedChatKey
  ])
  const usageProviderId = selectedProviderId ?? newSessionProvider
  const changesCwd = selectedChat ? (chatDetail?.cwd ?? selectedChat.cwd) : newSessionCwd

  const handleChangesPaneViewChange = useCallback(
    (view: ChangesPaneView): void => {
      if (view === 'terminal') {
        setTerminalCwd((currentCwd) => (currentCwd === undefined ? changesCwd : currentCwd))
      } else {
        lastNonTerminalChangesPaneViewRef.current = view
      }

      setChangesPaneView(view)
    },
    [changesCwd]
  )

  const handleToggleTerminal = useCallback((): void => {
    handleChangesPaneViewChange(
      changesPaneView === 'terminal' ? lastNonTerminalChangesPaneViewRef.current : 'terminal'
    )
  }, [changesPaneView, handleChangesPaneViewChange])

  const handleOpenAgentTerminal = useCallback(
    (tool: ProviderWorkingTool): void => {
      if (!selectedChat || !tool.agentTerminal) return

      const targetCwd = tool.cwd ?? changesCwd
      setTerminalCwd((currentCwd) => (currentCwd === undefined ? targetCwd : currentCwd))
      setTerminalLaunchRequest({
        id: crypto.randomUUID(),
        providerId: selectedChat.providerId,
        chatId: selectedChat.id,
        turnId: tool.agentTerminal.turnId,
        itemId: tool.agentTerminal.itemId,
        processId: tool.agentTerminal.processId,
        command: tool.command ?? tool.label,
        cwd: targetCwd,
        output: tool.stdout,
        status: tool.status
      })
      handleChangesPaneViewChange('terminal')
    },
    [changesCwd, handleChangesPaneViewChange, selectedChat]
  )

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

      if (action.openInTerminal) {
        setTerminalCwd((currentCwd) => (currentCwd === undefined ? targetCwd : currentCwd))
        setTerminalCommandLaunchRequest({
          id: crypto.randomUUID(),
          command: action.command,
          cwd: targetCwd,
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
        cwd: targetCwd
      })
      markActionUsed()
    },
    [changesCwd, handleChangesPaneViewChange]
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

      const action = appSettings.actions.find(
        (candidateAction) => candidateAction.keybinding === keybinding
      )
      if (!action) return

      event.preventDefault()
      event.stopPropagation()
      void handleRunAction(action)
    }

    document.addEventListener('keydown', handleActionShortcut, true)
    return () => document.removeEventListener('keydown', handleActionShortcut, true)
  }, [appSettings.actions, fileEditorTarget, handleRunAction, settingsOpen])
  const changesProjectCwd = selectedChat
    ? (chatDetail?.projectCwd ?? selectedChat.projectCwd ?? changesCwd)
    : newSessionCwd
  useEffect(() => {
    changesCwdRef.current = changesCwd
  }, [changesCwd])
  const pendingApproval = chatDetail?.pendingApproval ?? null
  const currentApprovalResolution =
    approvalResolution.approvalId === pendingApproval?.id ? approvalResolution : null
  const approvalDecisionInFlight = currentApprovalResolution?.decision ?? null
  const resolvingApprovalId = approvalResolution.decision ? approvalResolution.approvalId : null
  const approvalError = currentApprovalResolution?.error ?? null

  const refreshAccountUsage = useCallback(
    async (options: ProviderUsageOptions = {}): Promise<void> => {
      const providerId = usageProviderId
      setAccountUsageState('loading')
      setAccountUsageError(null)

      try {
        const usage = await providerApi.getUsage(providerId, options)
        setAccountUsage((currentUsage) => mergeAccountUsage(currentUsage, usage))
        setAccountUsageState('ready')
      } catch (error) {
        setAccountUsageState('error')
        setAccountUsageError(getErrorMessage(error, 'Unable to load usage.'))
      }
    },
    [usageProviderId]
  )

  const resetAccountRateLimits = useCallback(
    () => providerApi.resetRateLimits(usageProviderId),
    [usageProviderId]
  )

  useEffect(() => {
    let active = true
    const providerId = usageProviderId

    queueMicrotask(() => {
      if (!active) return
      setAccountUsageState('loading')
      setAccountUsageError(null)
    })

    providerApi
      .getUsage(providerId)
      .then((usage) => {
        if (!active) return
        setAccountUsage(usage)
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
  }, [usageProviderId])

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
    chatAutoScrollEnabledRef.current = true
    chatAutoScrollTargetRef.current = null
    scheduleChatAutoScroll()
    resetDocumentScroll()
  }, [scheduleChatAutoScroll, selectedProviderId, selectedChatId])

  useEffect(() => {
    if (!selectedChatKey) return

    const contentElement = contentRef.current
    const contentInnerElement = chatSearchContentRef.current
    if (!contentElement || !contentInnerElement) return

    const observer = new ResizeObserver(() => {
      if (
        contentRef.current !== contentElement ||
        chatSearchContentRef.current !== contentInnerElement
      ) {
        return
      }

      scheduleChatAutoScroll(contentElement)
    })
    observer.observe(contentElement)
    observer.observe(contentInnerElement)

    return () => observer.disconnect()
  }, [scheduleChatAutoScroll, selectedChatKey])

  useEffect(() => {
    if (selectedChat) return

    chatAutoScrollEnabledRef.current = true
    chatAutoScrollTargetRef.current = null
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
    chatAutoScrollEnabledRef.current = contentElement ? isScrolledToBottom(contentElement) : true
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
        if (active) setNewSessionCwd(cwd)
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

    const scope: GitBranchesScope = { cwd: changesCwd }

    queueMicrotask(() => {
      if (!active || gitBranchRequestIdRef.current !== requestId) return
      setGitBranchLoadState('loading')
      setGitBranchError(null)
    })

    appApi
      .getGitBranches({ cwd: changesCwd })
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
  }, [changesCwd, gitBranchLoadRequest])

  useEffect(() => {
    if (!changesCwd) return

    let active = true
    const gitChangeSource: GitChangeSource = 'uncommitted'
    const gitChangeScope: GitChangesScope = {
      cwd: changesCwd,
      source: gitChangeSource
    }

    if (changeSource === 'uncommitted') {
      queueMicrotask(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadState('loading')
      })
    }

    appApi
      .getGitChanges({
        cwd: changesCwd,
        source: gitChangeSource
      })
      .then((result) => {
        if (!active) return
        setGitChanges(result)
        setGitChangesScope(gitChangeScope)
        setGitChangeLoadScope(gitChangeScope)
        if (changeSource === 'uncommitted') setGitChangeLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        if (changeSource === 'uncommitted') setGitChangeLoadState('error')
      })

    return () => {
      active = false
    }
  }, [changeSource, changesCwd, gitChangeLoadRequest])

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
      .getUncommittedGitPatchChanges({ cwd: changesCwd, patches })
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
  }, [changeSource, changesCwd, chatDetail?.items, gitChangeLoadRequest])

  useEffect(() => {
    if (changesPaneView !== 'files' || !changesCwd) return

    let active = true
    const nextFileTreeScope: FileTreeScope = { cwd: changesCwd }

    queueMicrotask(() => {
      if (!active) return
      setFileTreeLoadScope(nextFileTreeScope)
      setFileTreeLoadState('loading')
    })

    appApi
      .getFileTree({ cwd: changesCwd })
      .then((result) => {
        if (!active) return
        setFileTree(result)
        setFileTreeScope(nextFileTreeScope)
        setFileTreeLoadScope(nextFileTreeScope)
        setFileTreeLoadState('ready')
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
  }, [changesCwd, changesPaneView, fileTreeLoadRequest])

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
    projectHistory.forEach((project) => addProjectIconEntry(project.cwd))
    chats.forEach((chat) => addProjectIconEntry(getChatProjectCwd(chat)))
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
  }, [activeChatGroups, chats, newSessionCwd, projectHistory, projectIconsByGroup])

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

    projectHistory.forEach((project) => addProject(project.cwd, project.updatedAt))
    chats.forEach((chat) => addProject(getChatProjectCwd(chat), chat.updatedAt))
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
  }, [chats, newSessionCwd, projectHistory, projectIconsByGroup])
  const newSessionProjectValue = newSessionCwd ?? newSessionProjectPlaceholderValue
  const savedGitCommitModel = appSettings.git.commitModel
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
    appSettings.chat.forceAccess === appChatManualDropdownValue
      ? sandboxMode
      : appSettings.chat.forceAccess
  const configuredApprovalMode =
    appSettings.chat.forceReview === appChatManualDropdownValue
      ? approvalMode
      : appSettings.chat.forceReview
  const effectiveApprovalMode =
    effectiveSandboxMode === 'danger-full-access' ? 'never' : configuredApprovalMode
  const configuredModel =
    appSettings.chat.forceModel === appChatManualDropdownValue ? model : appSettings.chat.forceModel
  const effectiveModel = models.some((candidateModel) => candidateModel.id === configuredModel)
    ? configuredModel
    : getDefaultModel(models).id
  const selectedEffectiveModel = models.find(
    (candidateModel) => candidateModel.id === effectiveModel
  )
  const configuredServiceTier =
    appSettings.chat.forceSpeed === appChatManualDropdownValue
      ? serviceTier
      : appSettings.chat.forceSpeed === appChatStandardSpeedValue
        ? null
        : appSettings.chat.forceSpeed
  const effectiveServiceTier = modelSupportsServiceTier(
    selectedEffectiveModel,
    configuredServiceTier
  )
    ? configuredServiceTier
    : (selectedEffectiveModel?.defaultServiceTier ?? null)
  const configuredReasoningEffort =
    appSettings.chat.forceReasoning === appChatManualDropdownValue
      ? reasoningEffort
      : appSettings.chat.forceReasoning
  const effectiveReasoningEffort = modelSupportsReasoningEffort(
    selectedEffectiveModel,
    configuredReasoningEffort
  )
    ? configuredReasoningEffort
    : getDefaultReasoningEffort(selectedEffectiveModel)
  const hasForcedChatDropdown =
    appSettings.chat.forceAccess !== appChatManualDropdownValue ||
    appSettings.chat.forceReview !== appChatManualDropdownValue ||
    appSettings.chat.forceModel !== appChatManualDropdownValue ||
    appSettings.chat.forceReasoning !== appChatManualDropdownValue ||
    appSettings.chat.forceSpeed !== appChatManualDropdownValue
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
  if (
    appSettings.chat.forceModel !== appChatManualDropdownValue &&
    !forceModelOptions.some((option) => option.value === appSettings.chat.forceModel)
  ) {
    forceModelOptions.push({
      value: appSettings.chat.forceModel,
      label: formatModelLabel(appSettings.chat.forceModel),
      icon: <Bot aria-hidden="true" />
    })
  }
  const forceReasoningOptions: DropdownOption<AppChatDropdownSettings['forceReasoning']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the reasoning effort selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...(selectedEffectiveModel?.supportedReasoningEfforts ?? []).map((option) => {
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
  if (
    appSettings.chat.forceReasoning !== appChatManualDropdownValue &&
    !forceReasoningOptions.some((option) => option.value === appSettings.chat.forceReasoning)
  ) {
    const presentation = getReasoningEffortPresentation(appSettings.chat.forceReasoning)
    forceReasoningOptions.push({
      value: appSettings.chat.forceReasoning,
      label: presentation.label,
      icon: presentation.icon
    })
  }
  const forceSpeedOptions: DropdownOption<AppChatDropdownSettings['forceSpeed']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the speed selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    {
      value: appChatStandardSpeedValue,
      label: 'Standard',
      description: 'Standard response speed and credit usage',
      icon: getChatServiceTierIcon(appChatStandardSpeedValue)
    },
    ...(selectedEffectiveModel?.supportedServiceTiers ?? []).map((option) => ({
      value: option.id,
      label: option.label,
      description: option.description || undefined,
      icon: getChatServiceTierIcon(option.id, option.label)
    }))
  ]
  if (
    appSettings.chat.forceSpeed !== appChatManualDropdownValue &&
    !forceSpeedOptions.some((option) => option.value === appSettings.chat.forceSpeed)
  ) {
    forceSpeedOptions.push({
      value: appSettings.chat.forceSpeed,
      label: formatSelectionLabel(appSettings.chat.forceSpeed),
      icon: getChatServiceTierIcon(appSettings.chat.forceSpeed)
    })
  }

  const handleToggleCwdGroup = (groupKey: string): void => {
    setCollapsedCwdGroups((currentGroups) => ({
      ...currentGroups,
      [groupKey]: !getCollapsedGroupState(groupKey, currentGroups)
    }))
  }

  const handleLoadMoreChatsInGroup = (group: ChatListGroupData): void => {
    setVisibleChatCountsByGroup((currentCounts) => ({
      ...currentCounts,
      [group.key]: (currentCounts[group.key] ?? chatPageSize) + chatPageSize
    }))
  }

  const handleShowLessChatsInGroup = (group: ChatListGroupData): void => {
    setVisibleChatCountsByGroup((currentCounts) => {
      const nextCounts = { ...currentCounts }
      delete nextCounts[group.key]
      return nextCounts
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
    const projectCwd = selectedChat
      ? getChatProjectCwd(chatDetail?.id === selectedChat.id ? chatDetail : selectedChat)
      : undefined
    markSelectedChatSeen()
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    showNewChatView(projectCwd)
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
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        theme
      }
    }))
  }

  const handleAppearancePositionChange = (position: AppAppearancePositionPreference): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        position
      }
    }))
  }

  const handleAppearanceStyleChange = (style: AppAppearanceStylePreference): void => {
    updateAppSettings((currentSettings) => ({
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
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        controlStyle
      }
    }))
  }

  const handleAppearanceButtonElevationChange = (buttonElevation: boolean): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        buttonElevation
      }
    }))
  }

  const handleExternalLinkBehaviorChange = (behavior: AppExternalLinkBehavior): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      links: {
        behavior
      }
    }))
  }

  const handleChatUsageDisplayChange = (displayUsage: AppChatUsageDisplay): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        displayUsage
      }
    }))
  }

  const handleChatDropdownPreferenceChange = (key: ChatBooleanSettingKey, value: boolean): void => {
    updateAppSettings((currentSettings) => ({
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
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        [key]: value
      }
    }))
  }

  const handlePerformancePreferenceChange = (
    key: keyof AppSettings['performance'],
    value: boolean
  ): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      performance: {
        ...currentSettings.performance,
        [key]: value
      }
    }))
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

    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        recentChatCacheLimit
      }
    }))
  }

  const handleContinuePromptChange = (continuePrompt: string): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        continuePrompt
      }
    }))
  }

  const handleGitCommitModelChange = (nextModel: string): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        commitModel: nextModel === gitCurrentChatModelValue ? null : nextModel
      }
    }))
  }

  const handleGitCommitPromptChange = (
    key: keyof AppGitCommitPromptSettings,
    value: string
  ): void => {
    updateAppSettings((currentSettings) => ({
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
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        commitMessageGeneration: {
          ...currentSettings.git.commitMessageGeneration,
          [key]: value
        }
      }
    }))
  }

  const handleSelectNewSessionFolder = async (): Promise<void> => {
    try {
      const folder = await appApi.selectFolder({ defaultPath: newSessionCwd })
      if (folder) setNewSessionCwd(folder)
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
      if (
        reasoningManuallySelectedRef.current &&
        modelSupportsReasoningEffort(nextModel, currentReasoningEffort)
      ) {
        return currentReasoningEffort
      }

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
      const availability = await providerApi.updateProvider(suggestion.providerId)
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

  const handleMarkChatDone = async (chat: ProviderChat, done = true): Promise<void> => {
    try {
      const metadata = await providerApi.markChatDone(chat.providerId, chat.id, done)
      applyChatMetadata([metadata])
      if (metadata.done) removeRecentChatCacheEntry(chat.providerId, chat.id)

      if (done && selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id) {
        showNewChatView()
      }
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }

  const handleToggleChatPinned = async (chat: ProviderChat): Promise<void> => {
    try {
      const metadata = await providerApi.setChatPinned(chat.providerId, chat.id, !chat.pinned)
      applyChatMetadata([metadata])
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
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
        showNewChatView()
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

  const getCurrentTurnOptions = (): ProviderTurnOptions => ({
    ...getApprovalAccessOptions(effectiveApprovalMode, effectiveSandboxMode),
    model: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    sandboxMode: effectiveSandboxMode,
    serviceTier: effectiveServiceTier
  })

  const getGitTurnOptions = (): ProviderTurnOptions => {
    const commitModel = appSettings.git.commitModel
    const turnOptions = getCurrentTurnOptions()
    if (!commitModel) return turnOptions

    const selectedCommitModel = models.find((candidateModel) => candidateModel.id === commitModel)
    const resolvedCommitModel = selectedCommitModel ?? getDefaultModel(models)

    return {
      ...turnOptions,
      model: resolvedCommitModel.id,
      reasoningEffort: modelSupportsReasoningEffort(
        resolvedCommitModel,
        turnOptions.reasoningEffort
      )
        ? turnOptions.reasoningEffort
        : getDefaultReasoningEffort(resolvedCommitModel),
      serviceTier: modelSupportsServiceTier(resolvedCommitModel, turnOptions.serviceTier)
        ? turnOptions.serviceTier
        : (resolvedCommitModel.defaultServiceTier ?? null)
    }
  }

  const handleSendMessage = async (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments: AppSelectedAttachment[] = [],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills: ProviderSkillInput[] = [],
    apps: ProviderAppInput[] = [],
    turnOptionsOverride?: ProviderTurnOptions
  ): Promise<void> => {
    if (providerUpdateInProgress || sendInFlightRef.current) return
    sendInFlightRef.current = true
    chatAutoScrollEnabledRef.current = true
    const messageWithComposerMentions = serializeComposerMessage(message, skills, apps)
    const serializedMessage = review
      ? serializeReviewMessage(messageWithComposerMentions, review)
      : messageWithComposerMentions
    const baseTurnOptions = {
      ...(turnOptionsOverride ?? getCurrentTurnOptions()),
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

    if (editingMessage) {
      if (!selectedChat) {
        sendInFlightRef.current = false
        return
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
      } catch (error) {
        setSendState('error')
        throw error
      } finally {
        sendInFlightRef.current = false
      }

      return
    }

    if (!selectedChat) {
      setSendState('sending')

      try {
        const detail = await providerApi.startChat(newSessionProvider, serializedMessage, {
          ...turnOptions,
          cwd: newSessionCwd ?? undefined
        })
        applyViewedChatDetail(newSessionProvider, detail, { select: true })
        setSendState('idle')
      } catch {
        setSendState('error')
      } finally {
        sendInFlightRef.current = false
      }

      return
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
      } catch {
        setSendState('error')
      } finally {
        sendInFlightRef.current = false
      }

      return
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
    } catch {
      void providerApi
        .getChat(providerId, chatId)
        .then((detail) => applyViewedChatDetail(providerId, detail))
        .catch(() => {})
      setSendState('error')
    } finally {
      sendInFlightRef.current = false
    }
  }

  const handleContinueStoppedTurn = (prompt: string): Promise<void> => handleSendMessage(prompt)

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
      const turnOptions: ProviderTurnOptions = {
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
      }

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
      } catch {
        setSendState('error')
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
      markChatSeenAt,
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

  const handleStopChat = async (): Promise<void> => {
    if (providerUpdateInProgress || !selectedChat || sendInFlightRef.current) return
    sendInFlightRef.current = true
    setSendState('sending')

    try {
      const summary = await providerApi.stopChatSummary(selectedChat.providerId, selectedChat.id)
      applyChatSummary(selectedChat.providerId, summary, true)
      markChatSeenAt(selectedChat.providerId, selectedChat.id, Date.now())
      setSendState('idle')
    } catch {
      setSendState('error')
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
      } catch {
        setSendState('error')
      }
    },
    [applyViewedChatDetail, providerUpdateInProgress, selectedChatId, selectedProviderId, sendState]
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
      } catch {
        setSendState('error')
      } finally {
        sendInFlightRef.current = false
      }
    },
    [applyViewedChatDetail, providerUpdateInProgress, selectedChatId, selectedProviderId]
  )

  const handleChatContentScroll = (): void => {
    const contentElement = contentRef.current
    if (!contentElement) return

    if (isScrolledToBottom(contentElement)) {
      chatAutoScrollEnabledRef.current = true
      chatUserScrollIntentRef.current = false
      chatAutoScrollTargetRef.current = {
        element: contentElement,
        top: contentElement.scrollTop
      }
      return
    }

    const autoScrollTarget = chatAutoScrollTargetRef.current
    if (
      !chatUserScrollIntentRef.current &&
      chatAutoScrollEnabledRef.current &&
      autoScrollTarget?.element === contentElement &&
      autoScrollTarget.top === contentElement.scrollTop
    ) {
      scheduleChatAutoScroll(contentElement)
      return
    }

    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null
    chatUserScrollIntentRef.current = false
  }

  const handleChatContentWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
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
    const visibleChatCount = visibleChatCountsByGroup[group.key] ?? chatPageSize

    return (
      <ChatListGroup
        contentId={contentId}
        group={group}
        key={group.key}
        open={groupOpen}
        selectedChatKey={selectedChat ? getChatKey(selectedChat) : null}
        committingChatKeys={committingChatKeys}
        visibleChatCount={visibleChatCount}
        chatPageSize={chatPageSize}
        onLoadMoreChats={handleLoadMoreChatsInGroup}
        onShowLessChats={handleShowLessChatsInGroup}
        projectIconSrc={projectIconsByGroup[group.key]?.dataUrl ?? null}
        onMarkChatDone={handleMarkChatDone}
        onMarkCwdChatsDone={(nextGroup) => void handleMarkCwdChatsDone(nextGroup)}
        onNewChatInCwd={handleNewChatInCwd}
        onSelectProjectIcon={(nextGroup) => void handleSelectProjectIcon(nextGroup)}
        onResolveApproval={(chat, decision) => void handleResolveChatApproval(chat, decision)}
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
  const messageBoxDisabled = selectedChat
    ? providerUpdateInProgress ||
      chatLoadState !== 'ready' ||
      Boolean(selectedChatAiCommitAction) ||
      (chatHasActiveTurn && !chatDetail?.capabilities.activeMessages)
    : providerUpdateInProgress
  const canEditOwnMessages = Boolean(
    selectedChat &&
    chatDetail?.capabilities.editMessages &&
    chatLoadState === 'ready' &&
    sendState !== 'sending' &&
    !providerUpdateInProgress &&
    !editingMessage
  )
  const visibleChatItems = useMemo(() => chatDetail?.items ?? [], [chatDetail?.items])
  const agentTerminalSnapshots = useMemo((): AgentTerminalSnapshot[] => {
    if (!selectedChat) return []

    const snapshots: AgentTerminalSnapshot[] = []
    const addTool = (tool: ProviderWorkingTool): void => {
      if (!tool.agentTerminal) return

      snapshots.push({
        providerId: selectedChat.providerId,
        chatId: selectedChat.id,
        turnId: tool.agentTerminal.turnId,
        itemId: tool.agentTerminal.itemId,
        processId: tool.agentTerminal.processId,
        command: tool.command ?? tool.label,
        cwd: tool.cwd ?? changesCwd,
        output: tool.stdout,
        status: tool.status
      })
    }

    visibleChatItems.forEach((item) => {
      if (item.type !== 'working') return

      item.items.forEach((workingItem) => {
        if (workingItem.type === 'tool') {
          addTool(workingItem)
          return
        }

        if (workingItem.type === 'toolGroup') workingItem.tools.forEach(addTool)
      })
    })

    return snapshots
  }, [changesCwd, selectedChat, visibleChatItems])
  const stoppedTurnRetryMessages = useMemo(
    () => getStoppedTurnRetryMessages(visibleChatItems),
    [visibleChatItems]
  )
  const canRetryStoppedTurns = Boolean(selectedChat && chatDetail?.capabilities.editMessages)
  const stoppedTurnActionDisabled =
    chatLoadState !== 'ready' ||
    sendState === 'sending' ||
    providerUpdateInProgress ||
    chatHasActiveTurn ||
    Boolean(editingMessage) ||
    Boolean(selectedChatAiCommitAction)
  const workingStepIdsWithNextWorkingStep = useMemo(() => {
    const ids = new Set<string>()
    let hasLaterWorkingStep = false

    for (let itemIndex = visibleChatItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = visibleChatItems[itemIndex]
      if (item.type !== 'working') continue

      if (hasLaterWorkingStep) ids.add(item.id)
      hasLaterWorkingStep = true
    }

    return ids
  }, [visibleChatItems])
  const firstPendingChatItemId =
    visibleChatItems.find((item) => item.type === 'pendingMessage')?.id ?? null
  const [
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers
  ] = useMemo(() => {
    const visibleItemsById = new Map(visibleChatItems.map((item) => [item.id, item]))
    const visibleItemIndexesById = new Map(
      visibleChatItems.map((item, itemIndex) => [item.id, itemIndex])
    )
    const allItemIds = new Set(chatDetail?.items.map((item) => item.id) ?? [])
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

      const anchorItemIndex = visibleItemIndexesById.get(marker.afterItemId)
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
  }, [chatDetail?.items, selectedChatCommitMarkers, visibleChatItems])
  const lastStreamingChatItem = chatHasActiveTurn
    ? visibleChatItems.findLast((item) => item.type !== 'pendingMessage')
    : null
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
    rootDataset.chatSearchOpen = chatSearchOpen ? 'true' : 'false'

    return () => {
      delete rootDataset.selectedChatItemCount
      delete rootDataset.recentChatCacheEntryCount
      delete rootDataset.recentChatCacheItemCount
      delete rootDataset.chatSearchOpen
    }
  }, [chatDetail?.items.length, chatSearchOpen, selectedChatKey])

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
        cwd: changesCwd,
        source: changeSource,
        files: patchChangedFiles
      })
    })

    return () => {
      active = false
    }
  }, [changeSource, changesCwd, patchChangedFiles, patchFilterMatches])
  const currentGitChangeSource: GitChangeSource | null =
    changeSource === 'uncommitted' ? 'uncommitted' : null
  const gitChangesMatchCurrentSource = isGitChangesScope(
    gitChangesScope,
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
    changesCwd,
    'uncommitted'
  )
  const uncommittedChangedFiles = useMemo(
    () =>
      changesCwd && uncommittedGitChangesMatchCurrentCwd ? getGitChangedFiles(gitChanges) : [],
    [changesCwd, gitChanges, uncommittedGitChangesMatchCurrentCwd]
  )
  const fileTreeMatchesCurrentCwd = isFileTreeScope(fileTreeScope, changesCwd)
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
  const fileTreeLoadMatchesCurrentCwd = isFileTreeScope(fileTreeLoadScope, changesCwd)
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
    cachedPatchChangedFiles.cwd === changesCwd &&
    cachedPatchChangedFiles.source === changeSource
  )
  const displayedPatchChangedFiles =
    changesLoadState === 'loading' && cachedPatchChangedFilesMatch
      ? (cachedPatchChangedFiles?.files ?? [])
      : patchChangedFiles
  const visibleChangesLoadState =
    changesLoadState === 'loading' &&
    (displayedGitChanges || (patchChangeSourceSelected && displayedPatchChangedFiles.length > 0))
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
            cwd: changesCwd,
            path: file.path,
            displayPath: getChangedFileDisplayPath(file),
            kind: file.kind,
            previousPath: file.previousPath ?? null
          }))
        : [],
    [changedFiles, changesCwd]
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
    syncInProgress ||
    commitState === 'sending' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress
  const branchSwitchDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
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
  const repositoryFileTree = useMemo(() => buildChangeTree(repositoryFiles), [repositoryFiles])
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

  const handleToggleFileTreeFolder = (folderPath: string): void => {
    setCollapsedFileTreeFolders((currentFolders) => {
      const nextFolders = {
        ...currentFolders,
        [folderPath]: !currentFolders[folderPath]
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

    try {
      const result = await appApi.switchGitBranch({ cwd, branchName, create })
      if (gitBranchRequestIdRef.current === requestId) {
        setGitBranches(result)
        setGitBranchesScope({ cwd })
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
        cwd: changesCwd,
        path,
        displayPath: relativeDisplayPath,
        line,
        endLine
      })
    },
    [changesCwd]
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
      onToggleFolder: (folderPath: string) => void
    }
  ): React.ReactElement => {
    if (node.type === 'folder') {
      const collapsed = Boolean(options.collapsedFolders[node.path])

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
            onClick={() => options.onToggleFolder(node.path)}
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
      appSettings.git.commitPrompt
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
      setSendState('error')
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
        appApi.getUncommittedGitDiff({ cwd: generationCwd }),
        appApi.getRecentGitCommitMessages({ cwd: generationCwd, limit: 5 })
      ])
      if (!diff.trim()) throw new Error('There is no uncommitted diff to describe.')

      const generatedMessage = await providerApi.generateOneShot(
        providerId,
        getCommitMessageGenerationPrompt(
          diff,
          messages,
          commitInputValue,
          appSettings.git.commitMessageGeneration
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
        cwd: changesCwd,
        action,
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
        const pushResult = await appApi.pushGitChanges({ cwd })

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

  const renderSettingsPanel = (): React.ReactElement => {
    const renderChatBooleanSettingField = (field: ChatBooleanSettingField): React.ReactElement => (
      <div className="settings-dialog__field" key={field.key}>
        <div className="settings-dialog__field-header">
          <h3 id={field.id}>{field.label}</h3>
          {field.description && <p>{field.description}</p>}
        </div>
        <label className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            aria-labelledby={field.id}
            checked={appSettings.chat[field.key]}
            onChange={(event) =>
              handleChatDropdownPreferenceChange(field.key, event.currentTarget.checked)
            }
          />
          <span className="settings-switch__control" aria-hidden="true" />
        </label>
      </div>
    )

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
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Display usage</h3>
                </div>
                <SegmentedControl
                  aria-label="Display usage"
                  options={chatUsageDisplayOptions}
                  value={appSettings.chat.displayUsage}
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
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Force access</h3>
                  <p>Hide the chat dropdown and always use this access mode.</p>
                </div>
                <Dropdown
                  id="settings-chat-force-access"
                  aria-label="Force access"
                  menuAlign="end"
                  options={forceAccessOptions}
                  value={appSettings.chat.forceAccess}
                  onChange={(value) => handleChatForcedDropdownChange('forceAccess', value)}
                />
              </div>
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Force review</h3>
                  <p>Hide the chat dropdown and always use this review mode.</p>
                </div>
                <Dropdown
                  id="settings-chat-force-review"
                  aria-label="Force review"
                  menuAlign="end"
                  options={forceReviewOptions}
                  value={appSettings.chat.forceReview}
                  onChange={(value) => handleChatForcedDropdownChange('forceReview', value)}
                />
              </div>
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Force model</h3>
                  <p>Hide the chat dropdown and always use this model.</p>
                </div>
                <Dropdown
                  id="settings-chat-force-model"
                  aria-label="Force model"
                  menuAlign="end"
                  options={forceModelOptions}
                  value={appSettings.chat.forceModel}
                  onChange={(value) => handleChatForcedDropdownChange('forceModel', value)}
                />
              </div>
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Force reasoning</h3>
                  <p>Hide the chat dropdown and always use this reasoning effort.</p>
                </div>
                <Dropdown
                  id="settings-chat-force-reasoning"
                  aria-label="Force reasoning"
                  menuAlign="end"
                  options={forceReasoningOptions}
                  value={appSettings.chat.forceReasoning}
                  onChange={(value) => handleChatForcedDropdownChange('forceReasoning', value)}
                />
              </div>
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Force speed</h3>
                  <p>Hide the chat dropdown and always use this speed.</p>
                </div>
                <Dropdown
                  id="settings-chat-force-speed"
                  aria-label="Force speed"
                  menuAlign="end"
                  options={forceSpeedOptions}
                  value={appSettings.chat.forceSpeed}
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
              <div className="settings-dialog__field settings-dialog__field--stack">
                <label
                  className="settings-dialog__field-header"
                  htmlFor="settings-chat-continue-prompt"
                >
                  <h3>Continue prompt</h3>
                  <p>Sent as a new message when Continue is selected on a stopped turn.</p>
                </label>
                <textarea
                  id="settings-chat-continue-prompt"
                  className="settings-dialog__prompt-textarea"
                  rows={3}
                  value={appSettings.chat.continuePrompt}
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
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3 id="settings-performance-disable-shadows">Disable shadows</h3>
                  <p>Remove box shadows throughout the app.</p>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="settings-performance-disable-shadows"
                    checked={appSettings.performance.disableShadows}
                    onChange={(event) =>
                      handlePerformancePreferenceChange(
                        'disableShadows',
                        event.currentTarget.checked
                      )
                    }
                  />
                  <span className="settings-switch__control" aria-hidden="true" />
                </label>
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
              <div className="settings-dialog__field">
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
                <Input
                  className="settings-dialog__number-input"
                  id="settings-chat-cache-limit"
                  type="number"
                  min={0}
                  max={50}
                  step={1}
                  value={appSettings.chat.recentChatCacheLimit}
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
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Commit model</h3>
                </div>
                <Dropdown
                  id="settings-git-commit-model"
                  aria-label="Commit model"
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

                return (
                  <div
                    className="settings-dialog__field settings-dialog__field--stack"
                    key={field.key}
                  >
                    <label className="settings-dialog__field-header" htmlFor={fieldId}>
                      <h3>{field.label}</h3>
                    </label>
                    <textarea
                      id={fieldId}
                      className="settings-dialog__prompt-textarea"
                      rows={field.rows}
                      spellCheck={false}
                      value={appSettings.git.commitPrompt[field.key]}
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
              <div className="settings-dialog__field settings-dialog__field--stack settings-dialog__field--prompt-groups">
                <div className="settings-dialog__prompt-group">
                  <label
                    className="settings-dialog__field-header"
                    htmlFor="settings-git-commit-generation-prompt"
                  >
                    <h3>Generation prompt</h3>
                  </label>
                  <textarea
                    id="settings-git-commit-generation-prompt"
                    className="settings-dialog__prompt-textarea"
                    rows={4}
                    spellCheck={false}
                    value={appSettings.git.commitMessageGeneration.prompt}
                    onChange={(event) =>
                      handleGitCommitMessageGenerationChange('prompt', event.currentTarget.value)
                    }
                  />
                </div>
                <div className="settings-dialog__prompt-group">
                  <label
                    className="settings-dialog__field-header"
                    htmlFor="settings-git-ai-instructions-prefix"
                  >
                    <h3>AI instructions prefix</h3>
                  </label>
                  <Input
                    id="settings-git-ai-instructions-prefix"
                    value={appSettings.git.commitMessageGeneration.aiInstructionsPrefix}
                    onChange={(event) =>
                      handleGitCommitMessageGenerationChange(
                        'aiInstructionsPrefix',
                        event.currentTarget.value
                      )
                    }
                  />
                </div>
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
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>Behavior</h3>
                  <p>Manual asks each time. Copy and Open always use that action.</p>
                </div>
                <SegmentedControl
                  aria-label="External link behavior"
                  options={externalLinkOptions}
                  value={appSettings.links.behavior}
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
        <div className="settings-dialog__field settings-dialog__field--inline">
          <div className="settings-dialog__field-header">
            <h3>Theme</h3>
          </div>
          <SegmentedControl
            aria-label="Theme"
            className="settings-dialog__appearance-toggle"
            options={themeOptions}
            value={appSettings.appearance.theme}
            onChange={handleThemePreferenceChange}
          />
        </div>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-appearance-window-controls"
        >
          <h2 className="settings-dialog__section-heading" id="settings-appearance-window-controls">
            Window Controls
          </h2>
          <div className="settings-dialog__section-cards">
            <div className="settings-dialog__field settings-dialog__field--inline">
              <div className="settings-dialog__field-header">
                <h3>Position</h3>
              </div>
              <SegmentedControl
                aria-label="Position"
                className="settings-dialog__appearance-toggle"
                options={appearancePositionOptions}
                value={appSettings.appearance.position}
                onChange={handleAppearancePositionChange}
              />
            </div>
            <div className="settings-dialog__field settings-dialog__field--inline">
              <div className="settings-dialog__field-header">
                <h3>Style</h3>
              </div>
              <SegmentedControl
                aria-label="Window control style"
                className="settings-dialog__appearance-toggle"
                options={appearanceStyleOptions}
                value={appSettings.appearance.style}
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
            <div className="settings-dialog__field settings-dialog__field--inline">
              <div className="settings-dialog__field-header">
                <h3>Style</h3>
              </div>
              <SegmentedControl
                aria-label="Button style"
                className="settings-dialog__appearance-toggle"
                options={appearanceControlStyleOptions}
                value={appSettings.appearance.controlStyle}
                onChange={handleAppearanceControlStyleChange}
              />
            </div>
            <div className="settings-dialog__field settings-dialog__field--inline">
              <div className="settings-dialog__field-header">
                <h3 id="settings-appearance-button-elevation">Elevation</h3>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-labelledby="settings-appearance-button-elevation"
                  checked={appSettings.appearance.buttonElevation}
                  onChange={(event) =>
                    handleAppearanceButtonElevationChange(event.currentTarget.checked)
                  }
                />
                <span className="settings-switch__control" aria-hidden="true" />
              </label>
            </div>
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
          </aside>
          <div className="settings-dialog__body">{renderSettingsPanel()}</div>
        </section>
      </div>
    )
  }

  const renderWindowControls = (placement: 'darwin' | 'default'): React.ReactElement => (
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
    appSettings.appearance.controlStyle === 'transparent' ? 'transparent' : 'secondary'

  const renderSettingsButton = (): React.ReactElement => (
    <Button
      theme={chromeControlTheme}
      aria-label="Settings"
      title="Settings"
      callback={() => setSettingsOpen(true)}
      icon={<Settings aria-hidden="true" />}
    />
  )

  return (
    <main className={`chat${chatPanelOpen ? ' chat--has-selection' : ' chat--no-selection'}`}>
      {renderSettingsDialog()}
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
                  <div className="chat-home__actions-left chat-home__settings-action">
                    {renderSettingsButton()}
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
              {loadState === 'loading' && <p className="chat__status">Loading chats…</p>}
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
                  {activeChatGroups.map((group, groupIndex) =>
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
              <div
                className="chat-detail__messages"
                ref={contentRef}
                onScroll={handleChatContentScroll}
                onWheel={handleChatContentWheel}
              >
                <div
                  className="chat-detail__messages-inner"
                  id="chat-search-content"
                  ref={chatSearchContentRef}
                >
                  {chatLoadState === 'loading' && <p className="chat__status">Loading messages…</p>}
                  {chatLoadState === 'error' && (
                    <p className="chat__status">Unable to load messages.</p>
                  )}
                  {!editingMessage &&
                    chatLoadState === 'ready' &&
                    visibleChatItems.length === 0 &&
                    selectedChatCommitMarkers.length === 0 && (
                      <p className="chat__status">No messages found.</p>
                    )}
                  {visibleChatItems.map((item, itemIndex) => (
                    <Fragment key={item.id}>
                      {chatCommitMarkersByBeforeItemId.get(item.id)?.map(renderChatCommitMarker)}
                      {item.id === firstPendingChatItemId &&
                        trailingChatCommitMarkers.map(renderChatCommitMarker)}
                      <ChatDetailItem
                        canEditOwnMessages={canEditOwnMessages}
                        continuePrompt={appSettings.chat.continuePrompt}
                        continueStoppedTurnDisabled={stoppedTurnActionDisabled}
                        hasNextWorkingStep={workingStepIdsWithNextWorkingStep.has(item.id)}
                        item={item}
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
                        onOpenFileLink={changesCwd ? handleOpenFileLink : undefined}
                        onOpenAgentTerminal={handleOpenAgentTerminal}
                        onRetryStoppedTurn={handleRetryStoppedTurn}
                        previousItem={visibleChatItems[itemIndex - 1] ?? null}
                        projectCwd={changesProjectCwd}
                        retryMessage={
                          canRetryStoppedTurns ? stoppedTurnRetryMessages.get(item.id) : null
                        }
                        retryStoppedTurnDisabled={stoppedTurnActionDisabled}
                        selectedModelId={model}
                        streaming={item.id === streamingChatItemId}
                        thoughtSettings={appSettings.chat}
                      />
                      {chatCommitMarkersByAfterItemId.get(item.id)?.map(renderChatCommitMarker)}
                    </Fragment>
                  ))}
                  {!firstPendingChatItemId && trailingChatCommitMarkers.map(renderChatCommitMarker)}
                </div>
              </div>
            )}
            {!appSettings.chat.hidePlans && (
              <ChatPlan key={selectedChatKey ?? 'no-chat'} plan={messageBoxPlan} />
            )}
            <div className="chat-panel__composer">
              <div className="chat-panel__composer-inner">
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
                    <span>New session in</span>
                    <Dropdown
                      aria-label="Project"
                      appearance="inline"
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
                      appearance="inline"
                      disabled={providerUpdateInProgress || sendState === 'sending'}
                      options={providerOptions}
                      placement="top"
                      size="small"
                      value={newSessionProvider}
                      onChange={setNewSessionProvider}
                    />
                  </div>
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
                  error={sendState === 'error' ? 'Unable to complete request.' : null}
                  accountUsage={accountUsage}
                  accountUsageError={accountUsageError}
                  accountUsageState={accountUsageState}
                  contextUsage={messageBoxContextUsage}
                  displayUsage={appSettings.chat.displayUsage}
                  lastActionId={appSettings.lastActionId}
                  model={effectiveModel}
                  models={models}
                  notesContextKey={messageBoxNotesGroup?.key}
                  notes={
                    messageBoxNotesGroup
                      ? (cwdNotesByGroup[messageBoxNotesGroup.key] ?? [])
                      : undefined
                  }
                  notesLabel={messageBoxNotesGroup?.label}
                  operationsDisabled={
                    providerUpdateInProgress || Boolean(selectedChatAiCommitAction)
                  }
                  pending={sendState === 'sending'}
                  providerId={selectedChat?.providerId ?? newSessionProvider}
                  projectCwd={changesProjectCwd}
                  cwd={changesCwd}
                  reasoningEffort={effectiveReasoningEffort}
                  sandboxMode={effectiveSandboxMode}
                  sandboxModes={sandboxModes}
                  selectedReview={selectedReview}
                  serviceTier={effectiveServiceTier}
                  showAccessSelector={appSettings.chat.forceAccess === appChatManualDropdownValue}
                  showActions={appSettings.chat.enableActions}
                  showActionLabel={hasForcedChatDropdown}
                  showModelSelector={appSettings.chat.forceModel === appChatManualDropdownValue}
                  showNotesButton={appSettings.chat.enableNotesButton}
                  showReasoningSelector={
                    appSettings.chat.forceReasoning === appChatManualDropdownValue
                  }
                  showReviewSelector={appSettings.chat.forceReview === appChatManualDropdownValue}
                  showSpeedSelector={appSettings.chat.forceSpeed === appChatManualDropdownValue}
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
                    currentBranch={currentBranchName}
                    disabled={branchSwitchDisabled}
                    error={gitBranchError}
                    id="changes-branch"
                    loading={gitBranchLoadState === 'loading'}
                    onClearError={() => {
                      setGitBranchError(null)
                      if (gitBranchActionState === 'error') setGitBranchActionState('idle')
                    }}
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
              {terminalCwd !== undefined && (
                <div
                  className={`changes-sidebar__terminal${
                    changesPaneView === 'terminal' ? ' changes-sidebar__terminal--active' : ''
                  }`}
                  aria-hidden={changesPaneView !== 'terminal'}
                >
                  <TerminalPanel
                    agentTerminalSnapshots={agentTerminalSnapshots}
                    commandLaunchRequest={terminalCommandLaunchRequest}
                    cwd={terminalCwd}
                    launchRequest={terminalLaunchRequest}
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
                        <ChangesAnimatedIcon Icon={AnimatedGitCommitHorizontalIcon} active />
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
