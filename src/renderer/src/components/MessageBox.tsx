import { UsageIndicator, type ChatContextUsage } from './UsageIndicator'
import { captureMessageFlight } from '../motion/messageFlight'
import { composerMentionsEqual, getComposerMentionAtCaret } from '../composerMention'
import { ComposerPlaceholder } from './ComposerPlaceholder'
import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { FileIcon as SymbolsFileIcon } from './SymbolIcons'
import {
  ArrowUp,
  BadgeCheck,
  Blocks,
  CornerDownRight,
  FileLock,
  FolderPen,
  Gauge,
  ListPlus,
  LoaderCircle,
  MessageCircleQuestion,
  MessagesSquare,
  Package,
  Paperclip,
  ShieldQuestionMark,
  Sparkles,
  Square,
  Rocket,
  UnlockKeyhole,
  X,
  Zap
} from 'lucide-react'
import type {
  AppContainerTarget,
  AppFileTreeFile,
  AppSelectedAttachment
} from '../../../shared/app'
import { toCssRem } from '../cssUnits'
import type {
  ProviderActiveSendMode,
  ProviderAgentMode,
  ProviderAgentModeOption,
  ProviderApp,
  ProviderAppInput,
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderCwdNote,
  ProviderId,
  ProviderModel,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderServiceTier,
  ProviderReview,
  ProviderSandboxMode,
  ProviderSandboxModeOption,
  ProviderSkill,
  ProviderSkillInput,
  ProviderUsageOptions
} from '../../../shared/provider'
import { appApi } from '../appApi'
import type { MessageBoxSelection } from '../messageBoxPreferences'
import { getChatPresetChanges } from '../chatPresets'
import { selectionsEqual } from '../chatModelPreferences'
import type { AppAction } from '../actions'
import {
  addPromptDraft,
  appendPromptDraft,
  getComposerDraft,
  getPromptDrafts,
  removePromptDraft,
  restoreFailedComposerMessage,
  updateComposerDraft,
  type PromptDraft
} from '../composerDraft'
import { useComposerDrafts } from '../useComposerDrafts'
import { providerApi } from '../providerApi'
import { getReasoningEffortPresentation } from '../reasoningEffortPresentation'
import { getModifiedActiveSendMode } from '../messageSendMode'
import type { AppChatDropdownSelectionAction, AppChatUsageDisplay } from '../settings'
import { AttachmentChip } from './AttachmentChip'
import { useLinkedChatOpener } from './LinkedChatOpener'
import {
  buildLinkedChatPrompt,
  defaultLinkedChatSummaryPrompt,
  getLinkedChatKey,
  hasLinkedChatDrag,
  linkedChatDragType,
  maxLinkedChatCount,
  parseLinkedChatDrag,
  parseLinkedChatMessage,
  type ComposerLinkedChat,
  type LinkedChatReference
} from '../linkedChats'
import { ActionsButton } from './ActionsButton'
import { Button } from './Button'
import {
  ChatConfigDropdown,
  type ChatConfigSection,
  type ChatConfigOptionGroup,
  type SelectorIconItem,
  type ChatConfigPresetDetails
} from './ChatConfigDropdown'
import { ChatGoalButton } from './ChatGoalButton'
import { CwdNotesButton } from './CwdNotesButton'
import { Dropdown, type DropdownOption } from './Dropdown'
import { ImageLightbox } from './ImageLightbox'
import { PromptDraftsButton } from './PromptDraftsButton'
import { ProviderIcon } from './ProviderIcon'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import { useSwitchSettledDisabled } from '../useSwitchSettledDisabled'
import './MessageBox.css'

type MessageBoxProps = {
  agentMode: ProviderAgentMode
  agentModes: ProviderAgentModeOption[]
  agentModesLoading?: boolean
  approvalMode: ProviderApprovalMode
  approvalModes: ProviderApprovalModeOption[]
  active?: boolean
  activePrimaryMode?: Extract<ProviderActiveSendMode, 'steer' | 'queue'>
  activeSteeringEnabled?: boolean
  autoFocus?: boolean
  draftScopeKey: string
  chatId?: string | null
  /**
   * Gates sending and actions only, like `operationsDisabled` and `pending`. The prompt,
   * attachments, usage, chat settings and notes remain usable in every state.
   */
  disabled?: boolean
  editSession?: {
    id: string
    content: string
    attachments: AppSelectedAttachment[]
    type?: 'message' | 'pending'
  } | null
  error?: string | null
  /** Used when native compaction fails or leaves no readable summary for a linked chat. */
  linkedChatSummaryPrompt?: string
  container?: AppContainerTarget | null
  model: ProviderModelId
  models: ProviderModel[]
  modelsError?: string | null
  modelsLoading?: boolean
  modelsUnavailable?: boolean
  operationsDisabled?: boolean
  pending?: boolean
  providerId: ProviderId
  providerUpdating?: boolean
  providerResourcesRevision?: number
  projectCwd?: string | null
  quoteRequest?: MessageBoxQuoteRequest | null
  cwd?: string | null
  reasoningEffort: ProviderReasoningEffort
  serviceTier: ProviderServiceTier | null
  sandboxMode: ProviderSandboxMode
  sandboxModes: ProviderSandboxModeOption[]
  selectedReview?: Omit<ProviderReview, 'prompt'> | null
  accountUsage: ProviderAccountUsage | null
  accountUsageError: string | null
  accountUsageState: 'idle' | 'loading' | 'ready' | 'error'
  actions?: AppAction[]
  contextUsage: MessageBoxContextUsage
  displayUsage: AppChatUsageDisplay
  lastActionId?: string | null
  goalObjective?: string | null
  notes?: ProviderCwdNote[]
  notesContextKey?: string
  notesLabel?: string
  presetsEnabled?: boolean
  selectionAction?: AppChatDropdownSelectionAction
  onPresetChange: (selection: Partial<MessageBoxSelection>) => void
  showAccessSelector?: boolean
  showActions?: boolean
  showActionLabel?: boolean
  showModelSelector?: boolean
  showNotesButton?: boolean
  showReasoningSelector?: boolean
  showReviewSelector?: boolean
  showUsageIndicator?: boolean
  showSpeedSelector?: boolean
  onAgentModeChange: (agentMode: ProviderAgentMode) => void
  onApprovalModeChange: (approvalMode: ProviderApprovalMode) => void
  onActionsChange?: (actions: AppAction[]) => void
  onLastActionChange?: (actionId: string | null) => void
  onCancelEdit?: () => void
  onModelChange: (model: ProviderModelId) => void
  onSetGoal?: (objective: string) => Promise<void>
  onNotesChange?: (notes: ProviderCwdNote[]) => void
  onOpenAttachment?: (attachment: AppSelectedAttachment) => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onReasoningEffortChange: (reasoningEffort: ProviderReasoningEffort) => void
  onServiceTierChange: (serviceTier: ProviderServiceTier | null) => void
  onRunAction?: (action: AppAction) => Promise<void> | void
  onSelectedReviewChange?: (review: Omit<ProviderReview, 'prompt'> | null) => void
  onSandboxModeChange: (sandboxMode: ProviderSandboxMode) => void
  onCompact?: () => Promise<void> | void
  onStop?: () => Promise<void> | void
  onUsageRefresh?: (options?: ProviderUsageOptions) => Promise<void> | void
  onQueueLimitReset?: (prompt: string) => Promise<void>
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
  onSend: (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments?: AppSelectedAttachment[],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills?: ProviderSkillInput[],
    apps?: ProviderAppInput[]
  ) => Promise<boolean> | boolean
}

export type MessageBoxQuoteRequest = {
  id: number
  content: string
}

type MessageBoxContextUsage = ChatContextUsage

const maxSelectedAttachmentCount = 10
const maxSelectedSkillCount = 20
const copilotMultipleSkillsTooltip = "Copilot doesn't support multiple skills invocation"

const noLinkedChats: ComposerLinkedChat[] = []

const getComposerDragKind = (dataTransfer: DataTransfer): 'files' | 'chat' | null => {
  const types = Array.from(dataTransfer.types)
  if (types.includes('Files')) return 'files'
  return hasLinkedChatDrag(types) ? 'chat' : null
}

const getLinkedChatErrorMessage = (error: unknown): string =>
  (error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()
    : '') || 'Unable to load the linked chat.'
const standardServiceTierValue = '__standard__'
const fastServiceTierIconClassName = 'message-box__fast-speed-icon'
const maxSelectedAppCount = 20
const maxFileMentionResultCount = 50
const selectedControlIconClassName = 'message-box__selected-control-icon'
const formatQuote = (content: string): string =>
  content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

type ScrollSnapshot = {
  element: HTMLElement
  scrollLeft: number
  scrollTop: number
}

type FileMention = {
  start: number
  end: number
  query: string
}

type SkillMention = {
  start: number
  end: number
  query: string
}

type ProjectFileCache = {
  cwd: string
  files: AppFileTreeFile[]
  repositoryRoot: string
  sourceKey: string
}

type ComposerCache = {
  cwd: string | null
  providerId: ProviderId
  providerResourcesRevision: number
  sourceKey: string
  skills: ProviderSkill[]
  apps: ProviderApp[]
}

const isComposerCacheCurrent = (
  cache: ComposerCache | null,
  providerId: ProviderId,
  cwd: string | null,
  sourceKey: string,
  providerResourcesRevision: number
): cache is ComposerCache =>
  cache?.providerId === providerId &&
  cache.cwd === cwd &&
  cache.sourceKey === sourceKey &&
  cache.providerResourcesRevision === providerResourcesRevision

type ComposerResult = { kind: 'skill'; skill: ProviderSkill } | { kind: 'app'; app: ProviderApp }
type MentionMenuStyle = CSSProperties & {
  '--menu-surface-max-height': string
}

const getMentionMenuStyle = (anchorRect: DOMRect): MentionMenuStyle => {
  const viewportInset = 9.6
  const menuOffset = 6.4
  const maxMenuHeight = Math.min(336, window.innerHeight * 0.56)
  const menuWidth = Math.min(416, anchorRect.width, window.innerWidth - viewportInset * 2)
  const maxLeft = Math.max(viewportInset, window.innerWidth - menuWidth - viewportInset)
  const spaceAbove = Math.max(0, anchorRect.top - menuOffset - viewportInset)
  const spaceBelow = Math.max(
    0,
    window.innerHeight - anchorRect.bottom - menuOffset - viewportInset
  )
  const openUp = spaceAbove >= spaceBelow
  const availableHeight = Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow)
  const menuStyle: MentionMenuStyle = {
    '--menu-surface-max-height': toCssRem(availableHeight),
    left: toCssRem(Math.min(Math.max(viewportInset, anchorRect.left), maxLeft)),
    width: toCssRem(menuWidth)
  }

  if (openUp) {
    menuStyle.bottom = toCssRem(window.innerHeight - anchorRect.top + menuOffset)
  } else {
    menuStyle.top = toCssRem(anchorRect.bottom + menuOffset)
  }

  return menuStyle
}

const getFileMentionAtCaret = (message: string, caret: number): FileMention | null => {
  return getComposerMentionAtCaret(message, caret, '@')
}

const getSkillMentionAtCaret = (message: string, caret: number): SkillMention | null => {
  return getComposerMentionAtCaret(message, caret, '$')
}

const getMentionFileName = (path: string): string => path.split('/').pop() || path

const getMentionAttachmentPath = (repositoryRoot: string, path: string): string => {
  const separator = repositoryRoot.includes('\\') ? '\\' : '/'
  return `${repositoryRoot.replace(/[\\/]+$/, '')}${separator}${path.replace(/[\\/]/g, separator)}`
}

const getFileMentionResults = (files: AppFileTreeFile[], query: string): AppFileTreeFile[] => {
  const normalizedQuery = query.toLocaleLowerCase()

  return files
    .flatMap((file) => {
      const normalizedPath = file.path.toLocaleLowerCase()
      const normalizedName = getMentionFileName(file.path).toLocaleLowerCase()
      if (normalizedQuery && !normalizedPath.includes(normalizedQuery)) return []

      const rank =
        !normalizedQuery || normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedPath.startsWith(normalizedQuery)
              ? 2
              : normalizedName.includes(normalizedQuery)
                ? 3
                : 4

      return [{ file, rank }]
    })
    .sort(
      (firstResult, secondResult) =>
        firstResult.rank - secondResult.rank ||
        firstResult.file.path.localeCompare(secondResult.file.path)
    )
    .slice(0, maxFileMentionResultCount)
    .map((result) => result.file)
}

const getComposerResultLabel = (result: ComposerResult): string =>
  result.kind === 'skill' ? result.skill.displayName || result.skill.name : result.app.name

const getFirstSentence = (value: string): string => {
  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  if (!normalizedValue) return ''

  return /^.*?[.!?](?=\s|$)/.exec(normalizedValue)?.[0] ?? normalizedValue
}

const getSkillSummary = (skill: ProviderSkill): string =>
  getFirstSentence(skill.description || skill.shortDescription || '')

const getComposerResults = (
  skills: ProviderSkill[],
  apps: ProviderApp[],
  query: string
): ComposerResult[] => {
  const normalizedQuery = query.toLocaleLowerCase()

  return [
    ...skills.flatMap((skill): Array<{ result: ComposerResult; rank: number }> => {
      const normalizedName = skill.name.toLocaleLowerCase()
      const normalizedDisplayName = skill.displayName?.toLocaleLowerCase() ?? ''
      const normalizedDescription = (
        skill.shortDescription || skill.description
      ).toLocaleLowerCase()
      if (
        normalizedQuery &&
        !normalizedName.includes(normalizedQuery) &&
        !normalizedDisplayName.includes(normalizedQuery) &&
        !normalizedDescription.includes(normalizedQuery)
      ) {
        return []
      }

      const rank =
        !normalizedQuery || normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedDisplayName.startsWith(normalizedQuery)
              ? 2
              : normalizedName.includes(normalizedQuery)
                ? 3
                : 4

      return [{ result: { kind: 'skill', skill }, rank }]
    }),
    ...apps.flatMap((app): Array<{ result: ComposerResult; rank: number }> => {
      const normalizedName = app.name.toLocaleLowerCase()
      const normalizedDescription = app.description.toLocaleLowerCase()
      if (
        normalizedQuery &&
        !normalizedName.includes(normalizedQuery) &&
        !normalizedDescription.includes(normalizedQuery)
      ) {
        return []
      }

      const rank =
        !normalizedQuery || normalizedName === normalizedQuery
          ? 0
          : normalizedName.startsWith(normalizedQuery)
            ? 1
            : normalizedName.includes(normalizedQuery)
              ? 2
              : 3

      return [{ result: { kind: 'app', app }, rank }]
    })
  ]
    .sort(
      (firstResult, secondResult) =>
        firstResult.rank - secondResult.rank ||
        getComposerResultLabel(firstResult.result).localeCompare(
          getComposerResultLabel(secondResult.result)
        )
    )
    .map((result) => result.result)
}

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getSelectedSkillInputs = (message: string, skills: ProviderSkill[]): ProviderSkillInput[] =>
  skills
    .flatMap((skill) =>
      new RegExp(
        `(^|[\\s([{])\\$${escapeRegularExpression(skill.name)}(?=$|[\\s)\\]},.!?;:])`
      ).test(message)
        ? [{ name: skill.name, path: skill.path }]
        : []
    )
    .slice(0, maxSelectedSkillCount)

const restoreAncestorScrollAfterNativeNavigation = (element: HTMLElement): void => {
  const snapshots: ScrollSnapshot[] = []
  const addSnapshot = (candidate: HTMLElement): void => {
    if (candidate === element || snapshots.some((snapshot) => snapshot.element === candidate)) {
      return
    }

    snapshots.push({
      element: candidate,
      scrollLeft: candidate.scrollLeft,
      scrollTop: candidate.scrollTop
    })
  }

  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    addSnapshot(ancestor)
  }

  if (document.scrollingElement instanceof HTMLElement) {
    addSnapshot(document.scrollingElement)
  }

  if (snapshots.length === 0) return

  const restoreSnapshots = (): void => {
    snapshots.forEach((snapshot) => {
      snapshot.element.scrollLeft = snapshot.scrollLeft
      snapshot.element.scrollTop = snapshot.scrollTop
    })
  }

  window.requestAnimationFrame(() => {
    restoreSnapshots()
    window.requestAnimationFrame(restoreSnapshots)
  })
}

const approvalModeIcons = {
  'ask-user': <ShieldQuestionMark aria-hidden="true" />,
  'auto-review': <Sparkles aria-hidden="true" />,
  never: <BadgeCheck aria-hidden="true" />
} satisfies Record<ProviderApprovalMode, ReactNode>

const sandboxModeIcons = {
  'read-only': <FileLock aria-hidden="true" />,
  'workspace-write': <FolderPen aria-hidden="true" />,
  'danger-full-access': (
    <UnlockKeyhole className={selectedControlIconClassName} aria-hidden="true" />
  )
} satisfies Record<ProviderSandboxMode, ReactNode>

const getReasoningEffortOptionLabel = (
  reasoningEffort: ProviderReasoningEffort,
  label: string
): string => {
  const presentation = getReasoningEffortPresentation(reasoningEffort)

  if (presentation.isKnown) return presentation.label
  if (label && label !== reasoningEffort) return label

  return presentation.label
}

const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

const getModelMenuLabel = (label: string, isDefault: boolean): string =>
  isDefault && !/\b(?:default|recommended)\b/i.test(label) ? `${label} (default)` : label

const formatOptionLabel = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || value

const isFastServiceTier = (id: string, label: string): boolean =>
  id.toLocaleLowerCase() === 'fast' ||
  id.toLocaleLowerCase() === 'priority' ||
  label.toLocaleLowerCase() === 'fast'

export const MessageBox: React.FC<MessageBoxProps> = ({
  agentMode,
  agentModes,
  agentModesLoading = false,
  approvalMode,
  approvalModes,
  active = false,
  activePrimaryMode = 'queue',
  activeSteeringEnabled = true,
  autoFocus = false,
  draftScopeKey,
  disabled = false,
  editSession = null,
  error = null,
  container = null,
  accountUsage,
  accountUsageError,
  accountUsageState,
  actions = [],
  contextUsage,
  chatId,
  displayUsage,
  lastActionId,
  goalObjective,
  notes = [],
  notesContextKey,
  notesLabel,
  presetsEnabled = true,
  selectionAction = 'back',
  onPresetChange,
  showAccessSelector = true,
  showActions = false,
  showActionLabel = false,
  showModelSelector = true,
  showNotesButton = false,
  showReasoningSelector = true,
  showReviewSelector = true,
  showUsageIndicator = true,
  showSpeedSelector = true,
  model,
  models,
  modelsError = null,
  modelsLoading = false,
  modelsUnavailable = false,
  linkedChatSummaryPrompt,
  operationsDisabled = false,
  pending = false,
  providerId,
  providerUpdating = false,
  providerResourcesRevision = 0,
  projectCwd,
  quoteRequest = null,
  cwd = null,
  reasoningEffort,
  serviceTier,
  sandboxMode,
  sandboxModes,
  selectedReview = null,
  onAgentModeChange,
  onApprovalModeChange,
  onActionsChange,
  onLastActionChange,
  onCancelEdit,
  onModelChange,
  onSetGoal,
  onNotesChange,
  onOpenAttachment,
  onOpenFileLink,
  onReasoningEffortChange,
  onServiceTierChange,
  onRunAction,
  onSelectedReviewChange,
  onSandboxModeChange,
  onCompact,
  onStop,
  onUsageRefresh,
  onUsageReset,
  onQueueLimitReset,
  onSend
}) => {
  const fileMentionListboxId = useId().replace(/:/g, '')
  const skillMentionListboxId = useId().replace(/:/g, '')
  const { composerDrafts, setComposerDrafts, promptDraftsByScope, setPromptDraftsByScope } =
    useComposerDrafts(Boolean(editSession))
  const composerDraft = getComposerDraft(composerDrafts, draftScopeKey)
  const promptDrafts = getPromptDrafts(promptDraftsByScope, draftScopeKey)
  const message = composerDraft.message
  const selectedAttachments = composerDraft.attachments
  const selectedSkills = composerDraft.skills
  const selectedApps = composerDraft.apps
  const setMessage = useCallback<Dispatch<SetStateAction<string>>>(
    (action) => {
      setComposerDrafts((drafts) => updateComposerDraft(drafts, draftScopeKey, 'message', action))
    },
    [draftScopeKey]
  )
  const setSelectedAttachments = useCallback<Dispatch<SetStateAction<AppSelectedAttachment[]>>>(
    (action) => {
      setComposerDrafts((drafts) =>
        updateComposerDraft(drafts, draftScopeKey, 'attachments', action)
      )
    },
    [draftScopeKey]
  )
  const setSelectedSkills = useCallback<Dispatch<SetStateAction<ProviderSkill[]>>>(
    (action) => {
      setComposerDrafts((drafts) => updateComposerDraft(drafts, draftScopeKey, 'skills', action))
    },
    [draftScopeKey]
  )
  const setSelectedApps = useCallback<Dispatch<SetStateAction<ProviderApp[]>>>(
    (action) => {
      setComposerDrafts((drafts) => updateComposerDraft(drafts, draftScopeKey, 'apps', action))
    },
    [draftScopeKey]
  )
  const [openedImage, setOpenedImage] = useState<Extract<
    AppSelectedAttachment,
    { kind: 'image' }
  > | null>(null)
  const [attachmentSelectionPending, setAttachmentSelectionPending] = useState(false)
  const [attachmentSelectionError, setAttachmentSelectionError] = useState<string | null>(null)
  const [attachmentDragActive, setAttachmentDragActive] = useState(false)
  const [attachmentDragKind, setAttachmentDragKind] = useState<'files' | 'chat'>('files')
  // Linked chats are summarized live and are not persisted with drafts.
  const [linkedChatsByScope, setLinkedChatsByScope] = useState<
    Record<string, ComposerLinkedChat[]>
  >({})
  const loadingLinkedChatOperationsRef = useRef(new Set<string>())
  const openLinkedChat = useLinkedChatOpener()
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [fileMention, setFileMention] = useState<FileMention | null>(null)
  const [projectFileCache, setProjectFileCache] = useState<ProjectFileCache | null>(null)
  const [projectFilesErrorCwd, setProjectFilesErrorCwd] = useState<string | null>(null)
  const [projectFilesError, setProjectFilesError] = useState<string | null>(null)
  const [activeFileMentionIndex, setActiveFileMentionIndex] = useState(0)
  const [skillMention, setSkillMention] = useState<SkillMention | null>(null)
  const [composerCache, setComposerCache] = useState<ComposerCache | null>(null)
  const [composerLoadErrorScope, setComposerLoadErrorScope] = useState<string | null>(null)
  const [activeSkillMentionIndex, setActiveSkillMentionIndex] = useState(0)
  const [mentionMenuStyle, setMentionMenuStyle] = useState<MentionMenuStyle | null>(null)
  const [controlPressed, setControlPressed] = useState(false)
  const editSessionIdRef = useRef<string | null>(null)
  const handledQuoteRequestIdRef = useRef<number | null>(null)
  const messageRef = useRef(message)
  const selectedAttachmentsRef = useRef(selectedAttachments)
  const selectedSkillsRef = useRef(selectedSkills)
  const selectedAppsRef = useRef(selectedApps)
  const messageBeforeEditRef = useRef<string | null>(null)
  const attachmentsBeforeEditRef = useRef<AppSelectedAttachment[] | null>(null)
  const skillsBeforeEditRef = useRef<ProviderSkill[] | null>(null)
  const appsBeforeEditRef = useRef<ProviderApp[] | null>(null)
  // The composer's own linked chats, set aside while a sent message is edited in their place.
  const linkedChatsBeforeEditRef = useRef<{ scope: string; chats: ComposerLinkedChat[] } | null>(
    null
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textareaWrapRef = useRef<HTMLDivElement>(null)
  const mentionMenuRef = useRef<HTMLDivElement>(null)
  const attachmentDragDepthRef = useRef(0)
  const editing = Boolean(editSession)
  const linkedChats = linkedChatsByScope[draftScopeKey] ?? noLinkedChats
  const linkedChatsRef = useRef(linkedChats)
  const linkedChatsByScopeRef = useRef(linkedChatsByScope)
  const linkedChatsLoading = linkedChats.some((chat) => chat.status === 'loading')
  const failedLinkedChat = linkedChats.find((chat) => chat.status === 'failed')
  const linkedChatsBlockSend = linkedChatsLoading || Boolean(failedLinkedChat)

  const updateLinkedChats = useCallback(
    (scope: string, update: (chats: ComposerLinkedChat[]) => ComposerLinkedChat[]): void => {
      setLinkedChatsByScope((current) => {
        const next = update(current[scope] ?? noLinkedChats)
        if (next === current[scope]) return current
        const nextByScope = { ...current }
        if (next.length > 0) nextByScope[scope] = next
        else delete nextByScope[scope]
        return nextByScope
      })
    },
    []
  )

  // Leaving the composer abandons unfinished summaries; their hidden forks stop as well.
  useEffect(() => {
    const operations = loadingLinkedChatOperationsRef.current
    return () => {
      for (const operationId of operations) {
        void providerApi.cancelLinkedChatContext(operationId).catch((error: unknown) => {
          console.error('Unable to cancel linked chat preparation.', error)
        })
      }
      operations.clear()
    }
  }, [])

  const handleLinkChat = (reference: LinkedChatReference): void => {
    const scope = draftScopeKey
    if (reference.providerId === providerId && reference.chatId === chatId) {
      setAttachmentSelectionError('A chat cannot be linked to itself.')
      return
    }
    if (linkedChats.some((chat) => getLinkedChatKey(chat) === getLinkedChatKey(reference))) {
      textareaRef.current?.focus({ preventScroll: true })
      return
    }
    if (linkedChats.length >= maxLinkedChatCount) {
      setAttachmentSelectionError(`Link up to ${maxLinkedChatCount} chats per message.`)
      return
    }

    const operationId = crypto.randomUUID()
    const settle = (patch: Partial<ComposerLinkedChat>): void => {
      loadingLinkedChatOperationsRef.current.delete(operationId)
      updateLinkedChats(scope, (chats) =>
        chats.some((chat) => chat.operationId === operationId)
          ? chats.map((chat) => (chat.operationId === operationId ? { ...chat, ...patch } : chat))
          : chats
      )
    }
    loadingLinkedChatOperationsRef.current.add(operationId)
    setAttachmentSelectionError(null)
    updateLinkedChats(scope, (chats) => [
      ...chats,
      { ...reference, operationId, status: 'loading' }
    ])
    textareaRef.current?.focus({ preventScroll: true })
    void providerApi
      .prepareLinkedChatContext(reference.providerId, reference.chatId, {
        operationId,
        summaryPrompt: linkedChatSummaryPrompt?.trim() || defaultLinkedChatSummaryPrompt
      })
      .then((context) => {
        // Null means the chip was removed (and the preparation cancelled) meanwhile.
        if (!context) {
          loadingLinkedChatOperationsRef.current.delete(operationId)
          return
        }
        settle({ status: 'ready', summary: context.summary })
      })
      .catch((linkError: unknown) => {
        console.error('Unable to prepare the linked chat.', linkError)
        settle({
          status: 'failed',
          error: getLinkedChatErrorMessage(linkError)
        })
      })
  }

  /** Ends an edit's linked chats: unfinished ones stop, and the saved draft chats return. */
  const restoreLinkedChatsBeforeEdit = useCallback((): void => {
    const saved = linkedChatsBeforeEditRef.current
    if (!saved) return
    linkedChatsBeforeEditRef.current = null
    const keptOperations = new Set(saved.chats.map((chat) => chat.operationId))
    for (const chat of linkedChatsByScopeRef.current[saved.scope] ?? noLinkedChats) {
      if (
        !keptOperations.has(chat.operationId) &&
        loadingLinkedChatOperationsRef.current.delete(chat.operationId)
      ) {
        void providerApi.cancelLinkedChatContext(chat.operationId).catch((error: unknown) => {
          console.error('Unable to cancel linked chat preparation.', error)
        })
      }
    }
    updateLinkedChats(saved.scope, () => saved.chats)
  }, [updateLinkedChats])

  const handleRemoveLinkedChat = (linkedChat: ComposerLinkedChat): void => {
    if (loadingLinkedChatOperationsRef.current.delete(linkedChat.operationId)) {
      void providerApi.cancelLinkedChatContext(linkedChat.operationId).catch((error: unknown) => {
        console.error('Unable to cancel linked chat preparation.', error)
      })
    }
    updateLinkedChats(draftScopeKey, (chats) =>
      chats.filter((chat) => chat.operationId !== linkedChat.operationId)
    )
    textareaRef.current?.focus({ preventScroll: true })
  }
  const fullAccessSelected = sandboxMode === 'danger-full-access'
  const reviewSelectorVisible = showReviewSelector && !fullAccessSelected
  const effectiveApprovalMode = fullAccessSelected ? 'never' : approvalMode
  const selectedApprovalMode = approvalModes.find((mode) => mode.id === effectiveApprovalMode)
  const approvalModeOptions = approvalModes.map(
    (mode): DropdownOption<ProviderApprovalMode> => ({
      value: mode.id,
      label: mode.label,
      menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
      description: mode.description || undefined,
      icon: approvalModeIcons[mode.id]
    })
  )
  const displayedApprovalModeOptions = approvalModeOptions.some(
    (option) => option.value === effectiveApprovalMode
  )
    ? approvalModeOptions
    : [
        ...approvalModeOptions,
        {
          value: effectiveApprovalMode,
          label: formatOptionLabel(effectiveApprovalMode),
          icon: approvalModeIcons[effectiveApprovalMode]
        }
      ]
  const selectedSandboxMode = sandboxModes.find((mode) => mode.id === sandboxMode)
  const sandboxModeOptions = sandboxModes.map(
    (mode): DropdownOption<ProviderSandboxMode> => ({
      value: mode.id,
      label: mode.label,
      menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
      description: mode.description || undefined,
      icon: sandboxModeIcons[mode.id]
    })
  )
  const displayedSandboxModeOptions = sandboxModeOptions.some(
    (option) => option.value === sandboxMode
  )
    ? sandboxModeOptions
    : [
        ...sandboxModeOptions,
        {
          value: sandboxMode,
          label: formatOptionLabel(sandboxMode),
          icon: sandboxModeIcons[sandboxMode]
        }
      ]
  const selectedModel = models.find((candidateModel) => candidateModel.id === model)
  const modelSelectionUnavailable = modelsUnavailable || modelsLoading || models.length === 0
  const unavailableModelLabel =
    modelsLoading && !modelsUnavailable ? 'Loading models…' : 'No models'
  // Typing changes the draft, not the model catalog. Keep this work out of the
  // synchronous input render, especially for OpenCode's large model lists.
  const modelOptions = useMemo(
    () =>
      modelSelectionUnavailable
        ? []
        : models.map(
            (candidateModel): DropdownOption<ProviderModelId> => ({
              value: candidateModel.id,
              label: formatModelLabel(candidateModel.label),
              menuLabel: getModelMenuLabel(
                formatModelLabel(candidateModel.label),
                candidateModel.isDefault
              ),
              description: candidateModel.description || undefined,
              icon: <ProviderIcon providerId={providerId} aria-hidden="true" />
            })
          ),
    [modelSelectionUnavailable, models, providerId]
  )
  const displayedModelOptions = modelSelectionUnavailable
    ? [
        {
          value: model,
          label: unavailableModelLabel,
          icon: <ProviderIcon providerId={providerId} aria-hidden="true" />,
          disabled: true
        }
      ]
    : modelOptions.some((option) => option.value === model)
      ? modelOptions
      : [
          ...modelOptions,
          {
            value: model,
            label: formatModelLabel(model),
            icon: <ProviderIcon providerId={providerId} aria-hidden="true" />
          }
        ]
  const supportedServiceTiers = selectedModel?.supportedServiceTiers ?? []
  const serviceTierSelectionAvailable = supportedServiceTiers.length > 0
  const serviceTierOptions: DropdownOption<string>[] = [
    {
      value: standardServiceTierValue,
      label: 'Standard',
      description: 'Standard response speed and credit usage',
      icon: <Gauge aria-hidden="true" />
    },
    ...supportedServiceTiers.map((option) => ({
      value: option.id,
      label: option.label,
      menuLabel: option.isDefault ? `${option.label} (default)` : option.label,
      description: option.description || undefined,
      icon: isFastServiceTier(option.id, option.label) ? (
        <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
      ) : (
        <Gauge aria-hidden="true" />
      )
    }))
  ]
  const displayedServiceTierOptions = serviceTierOptions
  const selectedServiceTier = serviceTier == null ? null : serviceTier
  const selectedServiceTierOption = displayedServiceTierOptions.find(
    (option) => option.value === (selectedServiceTier ?? standardServiceTierValue)
  )
  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts ?? []
  const reasoningSelectionAvailable = supportedReasoningEfforts.length > 0
  const reasoningEffortOptions = supportedReasoningEfforts.map((option) => {
    const presentation = getReasoningEffortPresentation(option.id)
    const label = getReasoningEffortOptionLabel(option.id, option.label)

    return {
      value: option.id,
      label,
      menuLabel: option.isDefault ? `${label} (default)` : label,
      description: option.description || undefined,
      icon: presentation.icon
    } satisfies DropdownOption<ProviderReasoningEffort>
  })
  const selectedReasoningEffortPresentation = getReasoningEffortPresentation(reasoningEffort)
  const displayedReasoningEffortOptions = reasoningEffortOptions
  const questionsSelectorVisible =
    providerId === 'copilot' && (agentModesLoading || agentModes.length > 0)
  const selectedAgentMode = agentModes.find((mode) => mode.id === agentMode)
  const questionModeOptions: DropdownOption<ProviderAgentMode>[] = agentModes.map((mode) => ({
    value: mode.id,
    label: mode.label,
    menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
    description: mode.description,
    icon:
      mode.id === 'autopilot' ? (
        <Rocket aria-hidden="true" />
      ) : (
        <MessageCircleQuestion aria-hidden="true" />
      )
  }))
  const selectedApprovalModeTitle = selectedApprovalMode?.description
    ? `${selectedApprovalMode.label}: ${selectedApprovalMode.description}`
    : (selectedApprovalMode?.label ?? formatOptionLabel(effectiveApprovalMode))
  const selectedReasoningEffortLabel = selectedReasoningEffortPresentation.label
  // Provider updates temporarily block model selection; other chat settings stay editable.
  const approvalSelectorDisabled = fullAccessSelected
  const selectedServiceTierValue = selectedServiceTier ?? standardServiceTierValue
  const selectedModelLabel = modelSelectionUnavailable
    ? unavailableModelLabel
    : formatModelLabel(selectedModel?.label ?? model)
  const selectedSandboxModeLabel = selectedSandboxMode?.label ?? formatOptionLabel(sandboxMode)
  const selectedServiceTierLabel = selectedServiceTierOption?.label ?? 'Standard'
  const chatConfigSections: ChatConfigSection[] = [
    ...(showModelSelector
      ? [
          {
            id: 'model',
            disabled: providerUpdating,
            icon: <ProviderIcon providerId={providerId} aria-hidden="true" />,
            label: modelSelectionUnavailable ? 'Model' : selectedModelLabel,
            groups: [
              {
                id: 'model',
                options: displayedModelOptions.map((option) => ({
                  ...option,
                  disabled:
                    providerUpdating ||
                    modelSelectionUnavailable ||
                    ('disabled' in option ? option.disabled : false)
                })),
                selectedValue: model,
                onChange: (value: string) => onModelChange(value as ProviderModelId)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(showReasoningSelector
      ? [
          {
            id: 'reasoning',
            disabled: modelSelectionUnavailable || !reasoningSelectionAvailable,
            icon: reasoningSelectionAvailable ? (
              selectedReasoningEffortPresentation.icon
            ) : (
              <Sparkles />
            ),
            label:
              !modelSelectionUnavailable && reasoningSelectionAvailable
                ? selectedReasoningEffortLabel
                : 'Reasoning',
            groups: [
              {
                id: 'reasoning',
                options: displayedReasoningEffortOptions,
                selectedValue: reasoningEffort,
                onChange: (value: string) =>
                  onReasoningEffortChange(value as ProviderReasoningEffort)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(questionsSelectorVisible
      ? [
          {
            id: 'questions',
            disabled: agentModesLoading || agentModes.length === 0,
            icon:
              agentMode === 'autopilot' ? (
                <Rocket aria-hidden="true" />
              ) : (
                <MessageCircleQuestion aria-hidden="true" />
              ),
            label:
              agentModesLoading || agentModes.length === 0
                ? 'Questions'
                : (selectedAgentMode?.label ?? formatOptionLabel(agentMode)),
            groups: [
              {
                id: 'questions',
                options: questionModeOptions,
                selectedValue: agentMode,
                onChange: (value: string) => onAgentModeChange(value as ProviderAgentMode)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(showAccessSelector || reviewSelectorVisible
      ? [
          {
            id: 'access',
            icon: showAccessSelector
              ? sandboxModeIcons[sandboxMode]
              : approvalModeIcons[effectiveApprovalMode],
            label: showAccessSelector
              ? selectedSandboxModeLabel
              : (selectedApprovalMode?.label ?? formatOptionLabel(effectiveApprovalMode)),
            groups: [
              ...(showAccessSelector
                ? [
                    {
                      id: 'access',
                      label: reviewSelectorVisible ? 'Access' : undefined,
                      options: displayedSandboxModeOptions,
                      selectedValue: sandboxMode,
                      onChange: (value: string) => onSandboxModeChange(value as ProviderSandboxMode)
                    } satisfies ChatConfigOptionGroup
                  ]
                : []),
              ...(reviewSelectorVisible
                ? [
                    {
                      id: 'review',
                      label: 'Review',
                      options: displayedApprovalModeOptions.map((option) => ({
                        ...option,
                        disabled:
                          approvalSelectorDisabled ||
                          ('disabled' in option ? option.disabled : false)
                      })),
                      selectedValue: effectiveApprovalMode,
                      onChange: (value: string) =>
                        onApprovalModeChange(value as ProviderApprovalMode)
                    } satisfies ChatConfigOptionGroup
                  ]
                : [])
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(showSpeedSelector
      ? [
          {
            id: 'speed',
            disabled: modelSelectionUnavailable || !serviceTierSelectionAvailable,
            icon: selectedServiceTierOption?.icon ?? <Gauge aria-hidden="true" />,
            label:
              !modelSelectionUnavailable && serviceTierSelectionAvailable
                ? selectedServiceTierLabel
                : 'Speed',
            groups: [
              {
                id: 'speed',
                options: displayedServiceTierOptions,
                selectedValue: selectedServiceTierValue,
                onChange: (value: string) =>
                  onServiceTierChange(value === standardServiceTierValue ? null : value)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : [])
  ]
  const chatConfigSelectorTitle = [
    `Model: ${selectedModelLabel}`,
    showReasoningSelector && !modelSelectionUnavailable && reasoningSelectionAvailable
      ? `Reasoning: ${selectedReasoningEffortLabel}`
      : null,
    questionsSelectorVisible
      ? `Questions: ${selectedAgentMode?.label ?? formatOptionLabel(agentMode)}`
      : null,
    showAccessSelector ? `Access: ${selectedSandboxModeLabel}` : null,
    reviewSelectorVisible ? `Review: ${selectedApprovalModeTitle}` : null,
    showSpeedSelector && serviceTierSelectionAvailable ? `Speed: ${selectedServiceTierLabel}` : null
  ]
    .filter(Boolean)
    .join(' · ')
  const fastSpeedSelected =
    selectedServiceTier != null &&
    isFastServiceTier(selectedServiceTierValue, selectedServiceTierOption?.label ?? '')
  const chatConfigStatusIcons: SelectorIconItem[] = modelSelectionUnavailable
    ? []
    : [
        ...(fullAccessSelected
          ? [
              {
                key: 'full-access',
                title: 'Full access',
                icon: sandboxModeIcons[sandboxMode]
              } satisfies SelectorIconItem
            ]
          : []),
        ...(selectedReasoningEffortPresentation.showStatusIcon && reasoningSelectionAvailable
          ? [
              {
                key: 'reasoning',
                title: `${selectedReasoningEffortLabel} reasoning`,
                icon: selectedReasoningEffortPresentation.icon
              } satisfies SelectorIconItem
            ]
          : []),
        ...(fastSpeedSelected
          ? [
              {
                key: 'speed',
                title: `${selectedServiceTierLabel} speed`,
                icon: <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
              } satisfies SelectorIconItem
            ]
          : []),
        ...(questionsSelectorVisible && agentMode === 'autopilot'
          ? [
              {
                key: 'autopilot',
                title: 'Autopilot',
                icon: <Rocket aria-hidden="true" />
              } satisfies SelectorIconItem
            ]
          : [])
      ]
  const currentPresetSelection: MessageBoxSelection = {
    agentMode,
    approvalMode: effectiveApprovalMode,
    model,
    reasoningEffort,
    sandboxMode,
    serviceTier
  }
  const presetEditableFields = {
    model: showModelSelector,
    reasoningEffort: showReasoningSelector,
    sandboxMode: showAccessSelector,
    approvalMode: showReviewSelector,
    agentMode: questionsSelectorVisible && !agentModesLoading,
    serviceTier: showSpeedSelector
  }
  const resolvePreset = (preset: MessageBoxSelection): MessageBoxSelection => {
    const resolved = {
      ...currentPresetSelection,
      ...getChatPresetChanges(preset, presetEditableFields)
    }
    if (resolved.sandboxMode === 'danger-full-access') resolved.approvalMode = 'never'
    return resolved
  }
  const getPresetDetails = (preset: MessageBoxSelection): ChatConfigPresetDetails => {
    const resolved = resolvePreset(preset)
    const presetModel = models.find((candidate) => candidate.id === resolved.model)
    const reasoning = getReasoningEffortPresentation(resolved.reasoningEffort)
    const hasReasoning = Boolean(presetModel?.supportedReasoningEfforts.length)
    const tier = presetModel?.supportedServiceTiers?.find(
      (option) => option.id === resolved.serviceTier
    )
    const fast =
      resolved.serviceTier != null && isFastServiceTier(resolved.serviceTier, tier?.label ?? '')
    const mode = agentModes.find((option) => option.id === resolved.agentMode)
    const access = sandboxModeOptions.find((option) => option.value === resolved.sandboxMode)
    const review = approvalModeOptions.find((option) => option.value === resolved.approvalMode)
    const modelLabel = formatModelLabel(presetModel?.label ?? resolved.model)
    const reasoningLabel = hasReasoning ? reasoning.label : null
    const speedLabel =
      resolved.serviceTier == null ? null : (tier?.label ?? formatOptionLabel(resolved.serviceTier))
    const disabled =
      providerUpdating ||
      modelSelectionUnavailable ||
      !presetModel ||
      (hasReasoning &&
        !presetModel.supportedReasoningEfforts.some(
          (option) => option.id === resolved.reasoningEffort
        )) ||
      (resolved.serviceTier != null && !tier) ||
      (showAccessSelector && !access) ||
      (showReviewSelector && resolved.sandboxMode !== 'danger-full-access' && !review) ||
      (presetEditableFields.agentMode && !mode)
    return {
      modelLabel,
      reasoningLabel,
      speedLabel,
      disabled,
      selected: selectionsEqual(resolved, currentPresetSelection),
      title: [
        `Model: ${modelLabel}`,
        hasReasoning ? `Reasoning: ${reasoning.label}` : null,
        `Access: ${access?.label ?? formatOptionLabel(resolved.sandboxMode)}`,
        `Review: ${review?.label ?? formatOptionLabel(resolved.approvalMode)}`,
        questionsSelectorVisible ? `Questions: ${mode?.label ?? resolved.agentMode}` : null,
        `Speed: ${speedLabel ?? 'Standard'}`,
        disabled ? 'Unavailable with the current provider or settings' : null
      ]
        .filter(Boolean)
        .join(' · '),
      statusIcons: [
        ...(resolved.sandboxMode === 'danger-full-access'
          ? [
              {
                key: 'full-access',
                title: 'Full access',
                icon: sandboxModeIcons[resolved.sandboxMode]
              }
            ]
          : []),
        ...(hasReasoning && reasoning.showStatusIcon
          ? [{ key: 'reasoning', title: `${reasoning.label} reasoning`, icon: reasoning.icon }]
          : []),
        ...(fast
          ? [
              {
                key: 'speed',
                title: `${speedLabel} speed`,
                icon: <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
              }
            ]
          : []),
        ...(questionsSelectorVisible && resolved.agentMode === 'autopilot'
          ? [{ key: 'autopilot', title: 'Autopilot', icon: <Rocket aria-hidden="true" /> }]
          : [])
      ]
    }
  }
  const selectorsVisible =
    showAccessSelector ||
    reviewSelectorVisible ||
    showModelSelector ||
    showReasoningSelector ||
    showSpeedSelector ||
    questionsSelectorVisible
  const notesButtonVisible = Boolean(showNotesButton && notesLabel && onNotesChange)
  const actionsButtonVisible = Boolean(
    showActions && onActionsChange && onLastActionChange && onRunAction
  )
  const workspaceControlsVisible = Boolean(onSetGoal) || notesButtonVisible || actionsButtonVisible
  const promptControlsVisible = selectorsVisible || workspaceControlsVisible
  const controlsClassName = [
    'message-box__controls',
    promptControlsVisible ? null : 'message-box__controls--no-selectors'
  ]
    .filter(Boolean)
    .join(' ')
  const modifiedActiveSendMode = getModifiedActiveSendMode(
    activePrimaryMode,
    activeSteeringEnabled,
    controlPressed
  )
  const activePrimaryLabel =
    modifiedActiveSendMode === 'queue' ? 'Queue message' : 'Steer current turn'
  const editingPendingMessage = editSession?.type === 'pending'
  // The prompt, attachments, usage, chat settings and notes stay usable in every state; only
  // the send button and actions are gated by pending, unavailable or read-only states.
  // Chat switches briefly report the next chat as loading; only show Send as blocked when that
  // outlasts the switch. submitMessage still checks the real `disabled` and `operationsDisabled`.
  const sendBlockedDisplay = useSwitchSettledDisabled(
    operationsDisabled || (!active && disabled),
    draftScopeKey
  )
  const fileMentionMenuOpen = Boolean(
    fileMention && !editing && selectedAttachments.length < maxSelectedAttachmentCount
  )
  const composerSourceKey = useMemo(() => JSON.stringify(container ?? null), [container])
  const fileMentionResults = useMemo(
    () =>
      getFileMentionResults(
        projectCwd &&
          projectFileCache?.cwd === projectCwd &&
          projectFileCache.sourceKey === composerSourceKey
          ? projectFileCache.files
          : [],
        fileMention?.query ?? ''
      ),
    [composerSourceKey, fileMention?.query, projectCwd, projectFileCache]
  )
  const skillScope = `${providerId}\0${cwd ?? ''}\0${composerSourceKey}`
  const skillMentionMenuOpen = Boolean(
    skillMention &&
      (selectedSkills.length < maxSelectedSkillCount || selectedApps.length < maxSelectedAppCount)
  )
  const composerResults = useMemo(
    () =>
      getComposerResults(
        isComposerCacheCurrent(
          composerCache,
          providerId,
          cwd,
          composerSourceKey,
          providerResourcesRevision
        )
          ? composerCache.skills
          : [],
        isComposerCacheCurrent(
          composerCache,
          providerId,
          cwd,
          composerSourceKey,
          providerResourcesRevision
        )
          ? composerCache.apps
          : [],
        skillMention?.query ?? ''
      ).filter((result) =>
        result.kind === 'skill'
          ? selectedSkills.length < maxSelectedSkillCount &&
            !selectedSkills.some((selectedSkill) => selectedSkill.path === result.skill.path)
          : selectedApps.length < maxSelectedAppCount &&
            !selectedApps.some((selectedApp) => selectedApp.id === result.app.id)
      ),
    [
      composerCache,
      composerSourceKey,
      cwd,
      providerId,
      providerResourcesRevision,
      selectedApps,
      selectedSkills,
      skillMention?.query
    ]
  )
  const mentionDropdownOptions = useMemo<DropdownOption<string>[]>(
    () =>
      skillMentionMenuOpen
        ? composerResults.map((result, index) => {
            const skill = result.kind === 'skill' ? result.skill : null
            const app = result.kind === 'app' ? result.app : null

            return {
              value: String(index),
              label: skill?.displayName || skill?.name || app?.name || '',
              description: skill ? getSkillSummary(skill) : 'App',
              icon: skill ? <Package aria-hidden="true" /> : <Blocks aria-hidden="true" />
            }
          })
        : fileMentionMenuOpen
          ? fileMentionResults.map((file, index) => ({
              value: String(index),
              label: getMentionFileName(file.path),
              description: file.path,
              icon: <SymbolsFileIcon fileName={getMentionFileName(file.path)} autoAssign />
            }))
          : [],
    [composerResults, fileMentionMenuOpen, fileMentionResults, skillMentionMenuOpen]
  )
  const mentionMenuOpen = skillMentionMenuOpen || fileMentionMenuOpen

  const updateMentionMenuPosition = useCallback((): void => {
    const anchorRect = textareaWrapRef.current?.getBoundingClientRect()

    if (
      !anchorRect ||
      anchorRect.bottom < 0 ||
      anchorRect.top > window.innerHeight ||
      anchorRect.width <= 0
    ) {
      setMentionMenuStyle(null)
      return
    }

    setMentionMenuStyle(getMentionMenuStyle(anchorRect))
  }, [])

  useLayoutEffect(() => {
    if (!mentionMenuOpen) return

    updateMentionMenuPosition()

    const handleScroll = (event: Event): void => {
      if (event.target instanceof Node && mentionMenuRef.current?.contains(event.target)) return

      updateMentionMenuPosition()
    }
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => updateMentionMenuPosition())

    if (textareaWrapRef.current) resizeObserver?.observe(textareaWrapRef.current)
    window.addEventListener('resize', updateMentionMenuPosition)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMentionMenuPosition)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [mentionMenuOpen, updateMentionMenuPosition])

  useEffect(() => {
    messageRef.current = message
  }, [message])

  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (active) setDismissedError(null)
    })

    return () => {
      active = false
    }
  }, [error])

  useEffect(() => {
    selectedAttachmentsRef.current = selectedAttachments
  }, [selectedAttachments])

  useEffect(() => {
    selectedSkillsRef.current = selectedSkills
  }, [selectedSkills])

  useEffect(() => {
    selectedAppsRef.current = selectedApps
  }, [selectedApps])

  useEffect(() => {
    linkedChatsRef.current = linkedChats
    linkedChatsByScopeRef.current = linkedChatsByScope
  }, [linkedChats, linkedChatsByScope])

  useEffect(() => {
    if (
      !fileMentionMenuOpen ||
      !projectCwd ||
      (projectFileCache?.cwd === projectCwd && projectFileCache.sourceKey === composerSourceKey)
    ) {
      return
    }

    let active = true

    void appApi
      .getFileTree({ container, cwd: projectCwd })
      .then((result) => {
        if (!active) return
        setProjectFileCache({
          cwd: projectCwd,
          files: result.files,
          repositoryRoot: result.repositoryRoot,
          sourceKey: composerSourceKey
        })
        setProjectFilesErrorCwd(null)
      })
      .catch((error: unknown) => {
        console.error('Unable to load files for composer mentions.', error)
        if (!active) return
        setProjectFilesErrorCwd(projectCwd)
        setProjectFilesError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      active = false
    }
  }, [composerSourceKey, container, fileMentionMenuOpen, projectCwd, projectFileCache])

  useEffect(() => {
    if (
      !skillMentionMenuOpen ||
      isComposerCacheCurrent(
        composerCache,
        providerId,
        cwd,
        composerSourceKey,
        providerResourcesRevision
      )
    ) {
      return
    }

    let active = true

    void Promise.allSettled([
      providerApi.getSkills(providerId, cwd, { container }),
      providerApi.getApps(providerId, { container })
    ]).then(([skillsResult, appsResult]) => {
      if (skillsResult.status === 'rejected') {
        console.error('Unable to load composer skills.', skillsResult.reason)
      }
      if (appsResult.status === 'rejected') {
        console.error('Unable to load composer apps.', appsResult.reason)
      }
      if (!active) return

      if (skillsResult.status === 'rejected' && appsResult.status === 'rejected') {
        setComposerLoadErrorScope(skillScope)
        return
      }

      setComposerCache({
        cwd,
        providerId,
        providerResourcesRevision,
        sourceKey: composerSourceKey,
        skills:
          skillsResult.status === 'fulfilled'
            ? skillsResult.value.filter((skill) => skill.enabled)
            : [],
        apps:
          appsResult.status === 'fulfilled'
            ? appsResult.value.filter((app) => app.enabled && app.callable)
            : []
      })
      setComposerLoadErrorScope(null)
    })

    return () => {
      active = false
    }
  }, [
    composerCache,
    composerSourceKey,
    container,
    cwd,
    providerId,
    providerResourcesRevision,
    skillMentionMenuOpen,
    skillScope
  ])

  useEffect(() => {
    if (!editSession) {
      editSessionIdRef.current = null
      messageBeforeEditRef.current = null
      attachmentsBeforeEditRef.current = null
      skillsBeforeEditRef.current = null
      appsBeforeEditRef.current = null
      restoreLinkedChatsBeforeEdit()
      return
    }

    if (editSessionIdRef.current === editSession.id) return

    editSessionIdRef.current = editSession.id
    if (messageBeforeEditRef.current === null) {
      messageBeforeEditRef.current = messageRef.current
      attachmentsBeforeEditRef.current = selectedAttachmentsRef.current
      skillsBeforeEditRef.current = selectedSkillsRef.current
      appsBeforeEditRef.current = selectedAppsRef.current
    }
    if (linkedChatsBeforeEditRef.current === null) {
      linkedChatsBeforeEditRef.current = { scope: draftScopeKey, chats: linkedChatsRef.current }
    }
    // The sent linked-chat section becomes chips again; saving rebuilds it from them.
    const editedMessage = parseLinkedChatMessage(editSession.content)
    updateLinkedChats(linkedChatsBeforeEditRef.current.scope, () =>
      editedMessage.linkedChats.map(
        (chat): ComposerLinkedChat => ({
          ...chat,
          operationId: crypto.randomUUID(),
          status: 'ready'
        })
      )
    )
    setMessage(editedMessage.content)
    setSelectedAttachments(editSession.attachments)
    setSelectedSkills([])
    setSelectedApps([])
    setAttachmentSelectionError(null)

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    draftScopeKey,
    editSession,
    restoreLinkedChatsBeforeEdit,
    setMessage,
    setSelectedApps,
    setSelectedAttachments,
    setSelectedSkills,
    updateLinkedChats
  ])

  useEffect(() => {
    if (!quoteRequest || editing || handledQuoteRequestIdRef.current === quoteRequest.id) {
      return
    }

    const quotedContent = formatQuote(quoteRequest.content.trim())
    if (!quotedContent) return

    let focusFrame: number | null = null
    const updateFrame = window.requestAnimationFrame(() => {
      handledQuoteRequestIdRef.current = quoteRequest.id
      setMessage(
        (currentMessage) => `${currentMessage ? `${currentMessage}\n` : ''}${quotedContent}\n\n`
      )
      setFileMention(null)
      setSkillMention(null)

      focusFrame = window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return

        textarea.focus({ preventScroll: true })
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      })
    })

    return () => {
      window.cancelAnimationFrame(updateFrame)
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame)
    }
  }, [editing, quoteRequest, setMessage])

  useEffect(() => {
    if (!autoFocus) return

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [autoFocus])

  useEffect(() => {
    let pressed = false
    const updateControlPressed = (next: boolean): void => {
      if (pressed === next) return
      pressed = next
      setControlPressed(next)
    }
    const handleControlChange = (event: KeyboardEvent): void => {
      updateControlPressed(event.ctrlKey)
    }
    const handleWindowBlur = (): void => updateControlPressed(false)

    window.addEventListener('keydown', handleControlChange)
    window.addEventListener('keyup', handleControlChange)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleControlChange)
      window.removeEventListener('keyup', handleControlChange)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  useEffect(() => {
    if (!selectedReview || editing) return
    const frame = window.requestAnimationFrame(() =>
      textareaRef.current?.focus({ preventScroll: true })
    )
    return () => window.cancelAnimationFrame(frame)
  }, [editing, selectedReview])

  const submitMessage = (activeMode: ProviderActiveSendMode = activePrimaryMode): void => {
    const nextMessage = message.trim()
    const typedSkillInputs = getSelectedSkillInputs(
      nextMessage,
      isComposerCacheCurrent(
        composerCache,
        providerId,
        cwd,
        composerSourceKey,
        providerResourcesRevision
      )
        ? composerCache.skills
        : []
    )
    const availableSkillInputs = Array.from(
      new Map(
        [
          ...selectedSkills.map((skill) => ({ name: skill.name, path: skill.path })),
          ...typedSkillInputs
        ].map((skill) => [skill.path, skill])
      ).values()
    ).slice(0, maxSelectedSkillCount)
    const selectedSkillInputs =
      providerId === 'copilot' ? availableSkillInputs.slice(-1) : availableSkillInputs
    const selectedAppInputs = selectedApps
      .map((app) => ({ id: app.id, name: app.name }))
      .slice(0, maxSelectedAppCount)
    const submittingReview = editing ? null : selectedReview
    if (
      (!nextMessage &&
        selectedAttachments.length === 0 &&
        selectedSkillInputs.length === 0 &&
        selectedAppInputs.length === 0 &&
        linkedChats.length === 0 &&
        !submittingReview) ||
      operationsDisabled ||
      providerUpdating ||
      attachmentSelectionPending ||
      linkedChatsBlockSend ||
      pending ||
      (!active && disabled)
    ) {
      return
    }

    textareaRef.current?.focus({ preventScroll: true })

    const sendScope = draftScopeKey
    const sentLinkedChats = linkedChats
    const outgoingMessage = buildLinkedChatPrompt(
      sentLinkedChats.map((chat) => ({
        providerId: chat.providerId,
        chatId: chat.chatId,
        name: chat.name,
        summary: chat.summary ?? ''
      })),
      nextMessage
    )
    const restoreLinkedChats = (): void => {
      if (sentLinkedChats.length === 0) return
      updateLinkedChats(sendScope, (chats) => [
        ...sentLinkedChats.filter(
          (sent) => !chats.some((chat) => getLinkedChatKey(chat) === getLinkedChatKey(sent))
        ),
        ...chats
      ])
    }

    if (editing) {
      const previousDraft = {
        message: messageBeforeEditRef.current ?? '',
        attachments: attachmentsBeforeEditRef.current ?? [],
        skills: skillsBeforeEditRef.current ?? [],
        apps: appsBeforeEditRef.current ?? []
      }
      void Promise.resolve(
        onSend(
          outgoingMessage,
          undefined,
          selectedAttachments,
          undefined,
          selectedSkillInputs,
          selectedAppInputs
        )
      )
        .then((sent) => {
          if (!sent) return

          restoreLinkedChatsBeforeEdit()
          setMessage(previousDraft.message)
          setSelectedAttachments(previousDraft.attachments)
          setSelectedSkills(previousDraft.skills)
          setSelectedApps(previousDraft.apps)
          editSessionIdRef.current = null
          messageBeforeEditRef.current = null
          attachmentsBeforeEditRef.current = null
          skillsBeforeEditRef.current = null
          appsBeforeEditRef.current = null
        })
        .catch((error: unknown) => {
          console.error('Unable to persist the cleared composer draft.', error)
        })
      return
    }

    const cancelFlight = captureMessageFlight(textareaRef.current, nextMessage, draftScopeKey)
    setMessage('')
    setSelectedAttachments([])
    setSelectedSkills([])
    setSelectedApps([])
    updateLinkedChats(sendScope, () => noLinkedChats)
    onSelectedReviewChange?.(null)
    setAttachmentSelectionError(null)
    void Promise.resolve(
      onSend(
        outgoingMessage,
        active ? activeMode : undefined,
        selectedAttachments,
        submittingReview,
        selectedSkillInputs,
        selectedAppInputs
      )
    )
      .then((sent) => {
        if (sent) return
        cancelFlight()
        restoreLinkedChats()
        if (!nextMessage) return

        setComposerDrafts((drafts) =>
          restoreFailedComposerMessage(drafts, draftScopeKey, nextMessage)
        )
      })
      .catch((error: unknown) => {
        cancelFlight()
        console.error('Unable to send the composer message.', error)
        restoreLinkedChats()
        if (!nextMessage) return

        setComposerDrafts((drafts) =>
          restoreFailedComposerMessage(drafts, draftScopeKey, nextMessage)
        )
      })
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    submitMessage()
  }

  const handleStop = (): void => {
    if (!onStop) return
    void onStop()
  }

  const handleCancelEdit = (): void => {
    restoreLinkedChatsBeforeEdit()
    setMessage(messageBeforeEditRef.current ?? '')
    setSelectedAttachments(attachmentsBeforeEditRef.current ?? [])
    setSelectedSkills(skillsBeforeEditRef.current ?? [])
    setSelectedApps(appsBeforeEditRef.current ?? [])
    editSessionIdRef.current = null
    messageBeforeEditRef.current = null
    attachmentsBeforeEditRef.current = null
    skillsBeforeEditRef.current = null
    appsBeforeEditRef.current = null
    onCancelEdit?.()
  }

  const handleSelectAttachments = async (): Promise<void> => {
    if (attachmentSelectionPending) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const attachments = await appApi.selectMessageAttachments()
      if (selectionEditId !== editSessionIdRef.current) return
      if (attachments.length === 0) return

      setSelectedAttachments((currentAttachments) => {
        const existingPaths = new Set(currentAttachments.map((attachment) => attachment.path))
        const nextAttachments = [
          ...currentAttachments,
          ...attachments.filter((attachment) => !existingPaths.has(attachment.path))
        ]

        if (nextAttachments.length > maxSelectedAttachmentCount) {
          setAttachmentSelectionError(
            `Attach up to ${maxSelectedAttachmentCount} files per message.`
          )
        }

        return nextAttachments.slice(0, maxSelectedAttachmentCount)
      })
      textareaRef.current?.focus({ preventScroll: true })
    } catch (selectionError) {
      console.error('Unable to attach selected files.', selectionError)
      setAttachmentSelectionError(
        selectionError instanceof Error ? selectionError.message : 'Unable to attach files.'
      )
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handleAttachmentDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    const kind = getComposerDragKind(event.dataTransfer)
    if (!kind) return

    event.preventDefault()
    attachmentDragDepthRef.current += 1
    setAttachmentDragKind(kind)
    if (kind === 'chat' || !attachmentSelectionPending) {
      setAttachmentDragActive(true)
    }
  }

  const handleAttachmentDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    const kind = getComposerDragKind(event.dataTransfer)
    if (!kind) return

    event.preventDefault()
    event.dataTransfer.dropEffect = kind === 'files' && attachmentSelectionPending ? 'none' : 'copy'
  }

  const handleAttachmentDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!getComposerDragKind(event.dataTransfer)) return

    event.preventDefault()
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1)
    if (attachmentDragDepthRef.current === 0) setAttachmentDragActive(false)
  }

  const handleAttachmentDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    const kind = getComposerDragKind(event.dataTransfer)
    if (!kind) return

    event.preventDefault()
    attachmentDragDepthRef.current = 0
    setAttachmentDragActive(false)

    if (kind === 'chat') {
      const reference = parseLinkedChatDrag(event.dataTransfer.getData(linkedChatDragType))
      if (reference) handleLinkChat(reference)
      return
    }

    if (attachmentSelectionPending) return

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }
    if (files.length > maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Drop up to ${maxSelectedAttachmentCount} files at a time.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const attachments = await appApi.getDroppedMessageAttachments(files)
      if (selectionEditId !== editSessionIdRef.current) return
      setSelectedAttachments((currentAttachments) => {
        const existingPaths = new Set(currentAttachments.map((attachment) => attachment.path))
        const nextAttachments = [
          ...currentAttachments,
          ...attachments.filter((attachment) => !existingPaths.has(attachment.path))
        ]

        if (nextAttachments.length > maxSelectedAttachmentCount) {
          setAttachmentSelectionError(
            `Attach up to ${maxSelectedAttachmentCount} files per message.`
          )
        }

        return nextAttachments.slice(0, maxSelectedAttachmentCount)
      })
      textareaRef.current?.focus({ preventScroll: true })
    } catch (dropError) {
      console.error('Unable to attach dropped files.', dropError)
      setAttachmentSelectionError(
        dropError instanceof Error ? dropError.message : 'Unable to attach dropped files.'
      )
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const hasImage = Array.from(event.clipboardData.items).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    if (!hasImage) return

    event.preventDefault()
    if (attachmentSelectionPending) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const selectionEditId = editSessionIdRef.current
      const image = await appApi.getClipboardImage()
      if (selectionEditId !== editSessionIdRef.current) return
      if (!image) throw new Error('Unable to read the pasted image.')

      setSelectedAttachments((currentAttachments) => {
        if (currentAttachments.length >= maxSelectedAttachmentCount) {
          setAttachmentSelectionError(
            `Attach up to ${maxSelectedAttachmentCount} files per message.`
          )
          return currentAttachments
        }
        return [...currentAttachments, image]
      })
    } catch (pasteError) {
      console.error('Unable to paste an image attachment.', pasteError)
      setAttachmentSelectionError(
        pasteError instanceof Error ? pasteError.message : 'Unable to paste this image.'
      )
    } finally {
      setAttachmentSelectionPending(false)
    }
  }

  const handleRemoveAttachment = (path: string): void => {
    setSelectedAttachments((attachments) =>
      attachments.filter((attachment) => attachment.path !== path)
    )
    setAttachmentSelectionError(null)
    textareaRef.current?.focus({ preventScroll: true })
  }

  const handleRemoveSkill = (path: string): void => {
    setSelectedSkills((skills) => skills.filter((skill) => skill.path !== path))
    textareaRef.current?.focus({ preventScroll: true })
  }

  const handleRemoveApp = (id: string): void => {
    setSelectedApps((apps) => apps.filter((app) => app.id !== id))
    textareaRef.current?.focus({ preventScroll: true })
  }

  const handleOpenAttachment = (attachment: AppSelectedAttachment): void => {
    if (attachment.kind === 'image') {
      setOpenedImage(attachment)
      return
    }

    onOpenAttachment?.(attachment)
  }

  const handleMessageChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextMessage = event.currentTarget.value
    setMessage(nextMessage)
    updateMessageMentions(event.currentTarget)
    setActiveFileMentionIndex(0)
    setActiveSkillMentionIndex(0)
  }

  const updateMessageMentions = (textarea: HTMLTextAreaElement): void => {
    const collapsed = textarea.selectionStart === textarea.selectionEnd
    const nextFileMention = collapsed
      ? getFileMentionAtCaret(textarea.value, textarea.selectionStart)
      : null
    const nextSkillMention = collapsed
      ? getSkillMentionAtCaret(textarea.value, textarea.selectionStart)
      : null
    if (!composerMentionsEqual(nextFileMention, fileMention)) {
      setFileMention(nextFileMention)
      setActiveFileMentionIndex(0)
    }
    if (!composerMentionsEqual(nextSkillMention, skillMention)) {
      setSkillMention(nextSkillMention)
      setActiveSkillMentionIndex(0)
    }
  }

  const handleMessageSelect = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    updateMessageMentions(event.currentTarget)
  }

  const handleSelectFileMention = (file: AppFileTreeFile): void => {
    if (
      !fileMention ||
      !projectCwd ||
      projectFileCache?.cwd !== projectCwd ||
      projectFileCache.sourceKey !== composerSourceKey
    ) {
      return
    }

    const attachmentPath = getMentionAttachmentPath(projectFileCache.repositoryRoot, file.path)
    const attachmentAlreadySelected = selectedAttachments.some(
      (attachment) => attachment.path === attachmentPath
    )
    if (!attachmentAlreadySelected && selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      setFileMention(null)
      return
    }

    const prefix = message.slice(0, fileMention.start)
    const suffix = message.slice(fileMention.end)
    const removeLeadingSuffixSpace =
      suffix.startsWith(' ') && (prefix.length === 0 || prefix.endsWith(' '))
    const nextSuffix = removeLeadingSuffixSpace ? suffix.slice(1) : suffix
    const nextMessage = prefix + nextSuffix
    const nextCaret = prefix.length

    setMessage(nextMessage)
    setFileMention(null)
    setAttachmentSelectionError(null)
    if (!attachmentAlreadySelected) {
      setSelectedAttachments((currentAttachments) => [
        ...currentAttachments,
        {
          kind: 'file',
          name: getMentionFileName(file.path),
          path: attachmentPath
        }
      ])
    }

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleSelectComposerMention = (result: ComposerResult): void => {
    if (!skillMention) return

    const prefix = message.slice(0, skillMention.start)
    const suffix = message.slice(skillMention.end)
    const removeLeadingSuffixSpace =
      suffix.startsWith(' ') && (prefix.length === 0 || prefix.endsWith(' '))
    const nextSuffix = removeLeadingSuffixSpace ? suffix.slice(1) : suffix
    const nextMessage = prefix + nextSuffix
    const nextCaret = prefix.length

    setMessage(nextMessage)
    setSkillMention(null)
    if (result.kind === 'skill') {
      setSelectedSkills((skills) =>
        skills.some((selectedSkill) => selectedSkill.path === result.skill.path)
          ? skills
          : [...skills, result.skill].slice(0, maxSelectedSkillCount)
      )
    } else {
      setSelectedApps((apps) =>
        apps.some((selectedApp) => selectedApp.id === result.app.id)
          ? apps
          : [...apps, result.app].slice(0, maxSelectedAppCount)
      )
    }

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleSelectMentionDropdown = (value: string): void => {
    const index = Number(value)
    if (!Number.isInteger(index) || index < 0) return

    if (skillMentionMenuOpen) {
      const result = composerResults[index]
      if (result) handleSelectComposerMention(result)
      return
    }

    const file = fileMentionResults[index]
    if (file) handleSelectFileMention(file)
  }

  const handleMessageKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (skillMentionMenuOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSkillMention(null)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (composerResults.length === 0) return

        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveSkillMentionIndex(
          (currentIndex) =>
            (currentIndex + direction + composerResults.length) % composerResults.length
        )
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selectedResult =
          composerResults[Math.min(activeSkillMentionIndex, composerResults.length - 1)]
        if (selectedResult) handleSelectComposerMention(selectedResult)
        return
      }

      if (event.key === 'Tab' && composerResults.length > 0) {
        event.preventDefault()
        handleSelectComposerMention(
          composerResults[Math.min(activeSkillMentionIndex, composerResults.length - 1)]
        )
        return
      }
    }

    if (fileMentionMenuOpen && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setFileMention(null)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (fileMentionResults.length === 0) return

        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveFileMentionIndex(
          (currentIndex) =>
            (currentIndex + direction + fileMentionResults.length) % fileMentionResults.length
        )
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const selectedFile =
          fileMentionResults[Math.min(activeFileMentionIndex, fileMentionResults.length - 1)]
        if (selectedFile) handleSelectFileMention(selectedFile)
        return
      }

      if (event.key === 'Tab' && fileMentionResults.length > 0) {
        event.preventDefault()
        handleSelectFileMention(
          fileMentionResults[Math.min(activeFileMentionIndex, fileMentionResults.length - 1)]
        )
        return
      }
    }

    if (
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.stopPropagation()
      restoreAncestorScrollAfterNativeNavigation(event.currentTarget)
    }

    if (event.key === 'Tab' && !event.nativeEvent.isComposing && !editing && message.trim()) {
      event.preventDefault()
      const prompt = message.trim()
      const draft: PromptDraft = {
        id: crypto.randomUUID(),
        prompt
      }

      setPromptDraftsByScope((drafts) => addPromptDraft(drafts, draftScopeKey, draft))
      setMessage('')
      setFileMention(null)
      setSkillMention(null)
      return
    }

    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    submitMessage(
      active
        ? getModifiedActiveSendMode(activePrimaryMode, activeSteeringEnabled, event.ctrlKey)
        : activePrimaryMode
    )
  }

  const handlePopPromptDraft = (draft: PromptDraft): void => {
    setPromptDraftsByScope((drafts) => removePromptDraft(drafts, draftScopeKey, draft.id))
    setMessage((currentMessage) => appendPromptDraft(currentMessage, draft.prompt))
    setFileMention(null)
    setSkillMention(null)

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return

      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

  const handleRemovePromptDraft = (draftId: string): void => {
    setPromptDraftsByScope((drafts) => removePromptDraft(drafts, draftScopeKey, draftId))
  }

  const hasContent =
    Boolean(message.trim()) ||
    selectedAttachments.length > 0 ||
    linkedChats.length > 0 ||
    selectedSkills.length > 0 ||
    selectedApps.length > 0 ||
    Boolean(selectedReview && !editing)
  const activeWithContent = active && hasContent
  const buttonLabel = activeWithContent
    ? activePrimaryLabel
    : active
      ? 'Stop response'
      : editing
        ? 'Save edit'
        : 'Send message'
  const activeDropdownActions = activeWithContent
    ? [
        ...(modifiedActiveSendMode === 'steer'
          ? [
              {
                id: 'queue',
                label: 'Queue',
                title: 'Send this as the next turn after the current response finishes',
                callback: () => submitMessage('queue'),
                disabled: operationsDisabled || providerUpdating,
                icon: <ListPlus aria-hidden="true" />
              }
            ]
          : activeSteeringEnabled
            ? [
                {
                  id: 'steer',
                  label: 'Steer',
                  title: 'Send this guidance to the current response',
                  callback: () => submitMessage('steer'),
                  disabled: operationsDisabled || providerUpdating,
                  icon: <CornerDownRight aria-hidden="true" />
                }
              ]
            : []),
        {
          id: 'interrupt',
          label: 'Interrupt',
          title: 'Stop the current response and send this message',
          callback: () => submitMessage('interrupt'),
          disabled: operationsDisabled || providerUpdating,
          icon: <Square aria-hidden="true" />
        }
      ]
    : undefined
  const selectedImages = selectedAttachments.filter((attachment) => attachment.kind === 'image')
  const selectedFiles = selectedAttachments.filter((attachment) => attachment.kind === 'file')
  const showSelectedReview = Boolean(selectedReview && !editing)
  const mentionDropdownEmptyContent = skillMentionMenuOpen ? (
    composerLoadErrorScope === skillScope ? (
      <div className="message-box__file-mention-status">Unable to load skills and apps</div>
    ) : !isComposerCacheCurrent(
        composerCache,
        providerId,
        cwd,
        composerSourceKey,
        providerResourcesRevision
      ) ? (
      <div className="message-box__file-mention-status">Loading skills and apps…</div>
    ) : (
      <div className="message-box__file-mention-status">No matching skills or apps</div>
    )
  ) : !projectCwd ? (
    <div className="message-box__file-mention-status">No project selected</div>
  ) : projectFilesErrorCwd === projectCwd ? (
    <div className="message-box__file-mention-status" role="alert">
      Could not list files in {projectCwd}: {projectFilesError}
    </div>
  ) : projectFileCache?.cwd !== projectCwd || projectFileCache.sourceKey !== composerSourceKey ? (
    <div className="message-box__file-mention-status">Searching files…</div>
  ) : (
    <div className="message-box__file-mention-status">No matching files</div>
  )
  const linkedChatError = failedLinkedChat
    ? `${failedLinkedChat.name}: ${failedLinkedChat.error ?? 'Unable to load the linked chat.'}`
    : null
  const messageBoxError =
    attachmentSelectionError ??
    linkedChatError ??
    (error && error !== dismissedError ? error : null)
  const messageBoxErrorLabel = attachmentSelectionError
    ? 'Attachment failed'
    : linkedChatError
      ? 'Linked chat failed'
      : 'Request failed'

  const handleDismissMessageBoxError = (): void => {
    if (attachmentSelectionError) {
      setAttachmentSelectionError(null)
      return
    }
    if (failedLinkedChat) {
      handleRemoveLinkedChat(failedLinkedChat)
      return
    }

    if (error) setDismissedError(error)
  }

  return (
    <form className="message-box" aria-busy={pending} onSubmit={handleSubmit}>
      {messageBoxError && (
        <div className="message-box__error" role="alert">
          <div className="message-box__error-main">
            <span className="message-box__error-label">{messageBoxErrorLabel}</span>
            <span className="message-box__error-summary">{messageBoxError}</span>
          </div>
          <div className="message-box__error-actions">
            <Button
              aria-label="Dismiss error"
              title="Dismiss error"
              callback={handleDismissMessageBoxError}
              icon={<X aria-hidden="true" />}
              size="small"
              theme="transparent"
            />
          </div>
        </div>
      )}
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      {selectorsVisible && (
        <label className="sr-only" htmlFor="chat-config-mode">
          Chat settings
        </label>
      )}
      <div
        className="message-box__input"
        onDragEnter={handleAttachmentDragEnter}
        onDragLeave={handleAttachmentDragLeave}
        onDragOver={handleAttachmentDragOver}
        onDrop={(event) => void handleAttachmentDrop(event)}
      >
        {attachmentDragActive && (
          <div className="message-box__attachment-drop-target" aria-hidden="true">
            {attachmentDragKind === 'chat' ? <MessagesSquare /> : <Paperclip />}
            <span>
              {attachmentDragKind === 'chat' ? 'Drop chat to attach' : 'Drop files to attach'}
            </span>
          </div>
        )}
        {(selectedAttachments.length > 0 ||
          linkedChats.length > 0 ||
          selectedSkills.length > 0 ||
          selectedApps.length > 0 ||
          showSelectedReview) && (
          <div className="message-box__attachment-previews">
            {selectedImages.length > 0 && (
              <div
                className="message-box__attachment-preview-group message-box__attachment-preview-group--images"
                aria-label="Selected images"
                role="list"
              >
                {selectedImages.map((attachment) => (
                  <div
                    className="message-box__attachment-preview message-box__attachment-preview--image"
                    key={attachment.path}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="message-box__attachment-open"
                      aria-label={`Open ${attachment.name}`}
                      title={`Open ${attachment.name}`}
                      onClick={() => handleOpenAttachment(attachment)}
                    >
                      <img src={attachment.dataUrl} alt="" />
                    </button>
                    <Button
                      aria-label={`Remove ${attachment.name}`}
                      callback={() => handleRemoveAttachment(attachment.path)}
                      icon={<X aria-hidden="true" />}
                      size="small"
                      theme="secondary"
                      title={`Remove ${attachment.name}`}
                    />
                  </div>
                ))}
              </div>
            )}
            {(selectedFiles.length > 0 ||
              linkedChats.length > 0 ||
              selectedSkills.length > 0 ||
              selectedApps.length > 0 ||
              showSelectedReview) && (
              <div
                className="message-box__attachment-preview-group message-box__attachment-preview-group--other"
                aria-label="Selected context"
                role="list"
              >
                {linkedChats.map((linkedChat) => (
                  <AttachmentChip
                    key={linkedChat.operationId}
                    className="message-box__linked-chat"
                    callback={() =>
                      openLinkedChat?.({
                        providerId: linkedChat.providerId,
                        chatId: linkedChat.chatId,
                        name: linkedChat.name
                      })
                    }
                    callbackAriaLabel={`Open linked chat ${linkedChat.name}`}
                    callbackDisabled={!openLinkedChat}
                    callbackTitle={
                      linkedChat.status === 'loading'
                        ? `Summarizing ${linkedChat.name}…`
                        : linkedChat.status === 'failed'
                          ? (linkedChat.error ?? 'Unable to load the linked chat.')
                          : `Open ${linkedChat.name}`
                    }
                    disabledAppearance={linkedChat.status === 'failed'}
                    icon={
                      linkedChat.status === 'loading' ? (
                        <LoaderCircle className="app-loading-spinner" aria-hidden="true" />
                      ) : (
                        <MessagesSquare aria-hidden="true" />
                      )
                    }
                    label={linkedChat.name}
                    removeAriaLabel={
                      linkedChat.status === 'loading'
                        ? `Cancel linking ${linkedChat.name}`
                        : `Remove linked chat ${linkedChat.name}`
                    }
                    removeCallback={() => handleRemoveLinkedChat(linkedChat)}
                    removeTitle={
                      linkedChat.status === 'loading' ? 'Cancel loading' : 'Remove linked chat'
                    }
                  />
                ))}
                {selectedSkills.map((skill, index) => {
                  const disabledByCopilot =
                    providerId === 'copilot' && index < selectedSkills.length - 1
                  const skillTitle = disabledByCopilot
                    ? copilotMultipleSkillsTooltip
                    : [skill.displayName || skill.name, getSkillSummary(skill)]
                        .filter(Boolean)
                        .join(' · ')

                  return (
                    <AttachmentChip
                      key={skill.path}
                      callback={() => textareaRef.current?.focus({ preventScroll: true })}
                      callbackAriaLabel={`Selected skill ${skill.name}`}
                      callbackDisabled
                      callbackTitle={skillTitle}
                      disabledAppearance={disabledByCopilot}
                      icon={<Package aria-hidden="true" />}
                      label={skill.displayName || skill.name}
                      removeAriaLabel={`Remove ${skill.name} skill`}
                      removeCallback={() => handleRemoveSkill(skill.path)}
                      removeTitle={`Remove ${skill.name} skill`}
                      title={disabledByCopilot ? copilotMultipleSkillsTooltip : undefined}
                    />
                  )
                })}
                {selectedApps.map((app) => (
                  <AttachmentChip
                    key={app.id}
                    callback={() => textareaRef.current?.focus({ preventScroll: true })}
                    callbackAriaLabel={`Selected app ${app.name}`}
                    callbackDisabled
                    callbackTitle={app.description ? `${app.name} · ${app.description}` : app.name}
                    icon={<Blocks aria-hidden="true" />}
                    label={`$${app.name}`}
                    removeAriaLabel={`Remove ${app.name} app`}
                    removeCallback={() => handleRemoveApp(app.id)}
                    removeTitle={`Remove ${app.name} app`}
                  />
                ))}
                {selectedFiles.map((attachment) => (
                  <AttachmentChip
                    key={attachment.path}
                    callback={() => handleOpenAttachment(attachment)}
                    callbackAriaLabel={`Open ${attachment.name}`}
                    callbackDisabled={!onOpenAttachment}
                    callbackTitle={`Open ${attachment.name}`}
                    icon={<SymbolsFileIcon fileName={attachment.name} autoAssign />}
                    label={attachment.name}
                    removeAriaLabel={`Remove ${attachment.name}`}
                    removeCallback={() => handleRemoveAttachment(attachment.path)}
                    removeTitle={`Remove ${attachment.name}`}
                  />
                ))}
                {selectedReview && showSelectedReview && (
                  <ReviewCommentsButton
                    comments={selectedReview.comments}
                    onOpenFileLink={onOpenFileLink}
                    onRemove={() => onSelectedReviewChange?.(null)}
                    projectCwd={projectCwd}
                  />
                )}
              </div>
            )}
          </div>
        )}
        <div ref={textareaWrapRef} className="message-box__textarea-wrap">
          {autoFocus && draftScopeKey.startsWith('new-chat:') && (
            <ComposerPlaceholder scope={draftScopeKey} empty={!message} />
          )}
          {mentionMenuOpen &&
            mentionMenuStyle &&
            createPortal(
              <div
                ref={mentionMenuRef}
                className="message-box__file-mention-menu"
                style={mentionMenuStyle}
              >
                <Dropdown
                  activeIndex={
                    skillMentionMenuOpen ? activeSkillMentionIndex : activeFileMentionIndex
                  }
                  aria-label={skillMentionMenuOpen ? 'Skills and apps' : 'Files'}
                  emptyContent={mentionDropdownEmptyContent}
                  listboxId={skillMentionMenuOpen ? skillMentionListboxId : fileMentionListboxId}
                  menuOnly
                  options={mentionDropdownOptions}
                  value=""
                  onActiveIndexChange={
                    skillMentionMenuOpen ? setActiveSkillMentionIndex : setActiveFileMentionIndex
                  }
                  onChange={handleSelectMentionDropdown}
                />
              </div>,
              document.body
            )}
          <textarea
            ref={textareaRef}
            id="message-input"
            rows={1}
            value={message}
            placeholder="Use @ for files and $ for skills"
            aria-autocomplete="list"
            aria-controls={
              skillMentionMenuOpen
                ? skillMentionListboxId
                : fileMentionMenuOpen
                  ? fileMentionListboxId
                  : undefined
            }
            aria-expanded={skillMentionMenuOpen || fileMentionMenuOpen}
            aria-activedescendant={
              skillMentionMenuOpen && composerResults.length > 0
                ? `${skillMentionListboxId}-option-${Math.min(
                    activeSkillMentionIndex,
                    composerResults.length - 1
                  )}`
                : fileMentionMenuOpen && fileMentionResults.length > 0
                  ? `${fileMentionListboxId}-option-${Math.min(
                      activeFileMentionIndex,
                      fileMentionResults.length - 1
                    )}`
                  : undefined
            }
            onBlur={() => {
              setFileMention(null)
              setSkillMention(null)
            }}
            onChange={handleMessageChange}
            onKeyDown={handleMessageKeyDown}
            onPaste={(event) => void handlePaste(event)}
            onSelect={handleMessageSelect}
          />
        </div>
        <div className={controlsClassName}>
          <div className="message-box__attachment-controls">
            <Button
              aria-label="Attach files"
              title={
                selectedAttachments.length > 0
                  ? `${selectedAttachments.length} file${selectedAttachments.length === 1 ? '' : 's'} attached`
                  : 'Attach files'
              }
              callback={handleSelectAttachments}
              icon={<Paperclip aria-hidden="true" />}
              theme="secondary"
            />
          </div>
          {promptControlsVisible && (
            <div className="message-box__selectors">
              {selectorsVisible && (
                <ChatConfigDropdown
                  id="chat-config-mode"
                  key={providerId}
                  presetsEnabled={presetsEnabled}
                  selectionAction={selectionAction}
                  providerId={providerId}
                  selection={currentPresetSelection}
                  getPresetDetails={getPresetDetails}
                  onPresetChange={(preset) =>
                    onPresetChange(getChatPresetChanges(preset, presetEditableFields))
                  }
                  modelsError={modelsError}
                  modelLabel={selectedModelLabel}
                  providerIcon={<ProviderIcon providerId={providerId} />}
                  reasoningLabel={
                    modelSelectionUnavailable || !reasoningSelectionAvailable
                      ? null
                      : selectedReasoningEffortLabel
                  }
                  sections={chatConfigSections}
                  statusIcons={chatConfigStatusIcons}
                  title={chatConfigSelectorTitle}
                />
              )}
              {onSetGoal && (
                <ChatGoalButton
                  key={`${providerId}:${chatId}`}
                  objective={goalObjective}
                  disabled={disabled || operationsDisabled || providerUpdating || pending}
                  onSetGoal={onSetGoal}
                />
              )}
              {notesButtonVisible && (
                <CwdNotesButton
                  key={notesContextKey}
                  label={notesLabel!}
                  notes={notes}
                  onNotesChange={onNotesChange!}
                />
              )}
              {actionsButtonVisible && (
                <ActionsButton
                  actions={actions}
                  label={notesLabel ?? 'Workspace'}
                  lastActionId={lastActionId}
                  projectCwd={projectCwd}
                  showLabel={showActionLabel}
                  onActionsChange={onActionsChange!}
                  onLastActionChange={onLastActionChange!}
                  onRunAction={onRunAction!}
                />
              )}
            </div>
          )}
          <div className="message-box__send-controls">
            {editing && (
              <Button
                disabled={pending}
                callback={handleCancelEdit}
                label="Cancel"
                theme="secondary"
              />
            )}
            {promptDrafts.length > 0 && (
              <PromptDraftsButton
                drafts={promptDrafts}
                disabled={editing}
                onPop={handlePopPromptDraft}
                onRemove={handleRemovePromptDraft}
              />
            )}
            {showUsageIndicator && (
              <UsageIndicator
                providerId={providerId}
                chatId={chatId}
                container={container}
                modelUsageScope={selectedModel?.usageScope}
                modelProviderId={selectedModel?.modelProvider?.id}
                accountUsage={accountUsage}
                accountUsageError={accountUsageError}
                accountUsageState={accountUsageState}
                contextUsage={contextUsage}
                displayUsage={displayUsage}
                compactDisabled={disabled || operationsDisabled || active || pending}
                onCompact={onCompact}
                onUsageRefresh={onUsageRefresh}
                onUsageReset={onUsageReset}
                onQueueLimitReset={onQueueLimitReset}
              />
            )}
            <Button
              aria-label={buttonLabel}
              title={buttonLabel}
              disabled={
                (activeWithContent ? operationsDisabled : sendBlockedDisplay) ||
                ((!active || activeWithContent) && providerUpdating) ||
                (attachmentSelectionPending && (!active || activeWithContent)) ||
                (linkedChatsBlockSend && (!active || activeWithContent)) ||
                (activeWithContent ? pending : active ? false : pending || !hasContent)
              }
              callback={activeWithContent ? submitMessage : active ? handleStop : submitMessage}
              onClick={
                activeWithContent
                  ? (event) => {
                      event.preventDefault()
                      submitMessage(
                        getModifiedActiveSendMode(
                          activePrimaryMode,
                          activeSteeringEnabled,
                          event.ctrlKey
                        )
                      )
                    }
                  : undefined
              }
              dropdownActions={activeDropdownActions}
              dropdownLabel="Message actions"
              dropdownMenuAlign="end"
              dropdownPlacement="top"
              icon={
                editingPendingMessage ? (
                  <ListPlus aria-hidden="true" />
                ) : activeWithContent && modifiedActiveSendMode === 'steer' ? (
                  <CornerDownRight aria-hidden="true" />
                ) : activeWithContent ? (
                  <ListPlus aria-hidden="true" />
                ) : active ? (
                  <Square aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )
              }
              theme="primary"
            />
            {activeWithContent && (
              <Button
                aria-label="Stop response"
                title="Stop response"
                disabled={operationsDisabled}
                callback={handleStop}
                icon={<Square aria-hidden="true" />}
                theme="secondary"
              />
            )}
          </div>
        </div>
      </div>
      {openedImage && (
        <ImageLightbox
          imageUrl={openedImage.dataUrl}
          name={openedImage.name}
          path={openedImage.path}
          onClose={() => setOpenedImage(null)}
        />
      )}
    </form>
  )
}
