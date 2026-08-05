import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import {
  ArrowUp,
  BadgeCheck,
  Blocks,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  FileLock,
  FolderPen,
  Gauge,
  ListPlus,
  LoaderCircle,
  Package,
  Paperclip,
  RotateCcw,
  ShieldQuestionMark,
  Sparkles,
  Square,
  UnlockKeyhole,
  X,
  Zap
} from 'lucide-react'
import type {
  AppContainerTarget,
  AppFileTreeFile,
  AppSelectedAttachment
} from '../../../shared/app'
import type {
  ProviderActiveSendMode,
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
import type { AppAction } from '../actions'
import { providerApi } from '../providerApi'
import { getReasoningEffortPresentation } from '../reasoningEffortPresentation'
import type { AppChatUsageDisplay } from '../settings'
import { AttachmentChip } from './AttachmentChip'
import { ActionsButton } from './ActionsButton'
import { Button } from './Button'
import { CwdNotesButton } from './CwdNotesButton'
import { DisclosureToggle } from './DisclosureToggle'
import { Dropdown, type DropdownOption } from './Dropdown'
import { ImageLightbox } from './ImageLightbox'
import { MenuSurface } from './MenuSurface'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import { SegmentedControl } from './SegmentedControl'
import './MessageBox.css'

type MessageBoxProps = {
  approvalMode: ProviderApprovalMode
  approvalModes: ProviderApprovalModeOption[]
  active?: boolean
  activePrimaryMode?: Extract<ProviderActiveSendMode, 'steer' | 'queue'>
  activeSteeringEnabled?: boolean
  autoFocus?: boolean
  disabled?: boolean
  editSession?: { id: string; content: string; type?: 'message' | 'pending' } | null
  error?: string | null
  container?: AppContainerTarget | null
  model: ProviderModelId
  models: ProviderModel[]
  modelsUnavailable?: boolean
  operationsDisabled?: boolean
  pending?: boolean
  providerId: ProviderId
  projectCwd?: string | null
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
  notes?: ProviderCwdNote[]
  notesContextKey?: string
  notesLabel?: string
  showAccessSelector?: boolean
  showActions?: boolean
  showActionLabel?: boolean
  showModelSelector?: boolean
  showNotesButton?: boolean
  showReasoningSelector?: boolean
  showReviewSelector?: boolean
  showSpeedSelector?: boolean
  onApprovalModeChange: (approvalMode: ProviderApprovalMode) => void
  onActionsChange?: (actions: AppAction[]) => void
  onLastActionChange?: (actionId: string | null) => void
  onCancelEdit?: () => void
  onModelChange: (model: ProviderModelId) => void
  onNotesChange?: (notes: ProviderCwdNote[]) => void
  onOpenAttachment?: (attachment: AppSelectedAttachment) => void
  onOpenFileLink?: (path: string, displayPath: string, line?: number, endLine?: number) => void
  onReasoningEffortChange: (reasoningEffort: ProviderReasoningEffort) => void
  onServiceTierChange: (serviceTier: ProviderServiceTier | null) => void
  onRunAction?: (action: AppAction) => Promise<void> | void
  onSelectedReviewChange?: (review: Omit<ProviderReview, 'prompt'> | null) => void
  onSandboxModeChange: (sandboxMode: ProviderSandboxMode) => void
  onStop?: () => Promise<void> | void
  onUsageRefresh?: (options?: ProviderUsageOptions) => Promise<void> | void
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
  onSend: (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments?: AppSelectedAttachment[],
    review?: Omit<ProviderReview, 'prompt'> | null,
    skills?: ProviderSkillInput[],
    apps?: ProviderAppInput[]
  ) => Promise<void> | void
}

type MessageBoxContextUsage = {
  source: 'exact' | 'estimated' | 'unavailable'
  usedTokens: number | null
  maxTokens: number | null
}

type UsagePopoverView = 'usage' | 'statistics'
type AccountRateLimit = ProviderAccountUsage['rateLimits'][number]

const minTextareaHeight = 44
const maxTextareaHeight = 180
const maxSelectedAttachmentCount = 10
const maxSelectedSkillCount = 20
const copilotMultipleSkillsTooltip = "Copilot doesn't support multiple skills invocation"
const standardServiceTierValue = '__standard__'
const fastServiceTierIconClassName = 'message-box__fast-speed-icon'
const maxSelectedAppCount = 20
const maxFileMentionResultCount = 50
const selectedControlIconClassName = 'message-box__selected-control-icon'
const numberFormatter = new Intl.NumberFormat(undefined)
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: 'compact'
})

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
  sourceKey: string
  skills: ProviderSkill[]
  apps: ProviderApp[]
}

type ComposerResult = { kind: 'skill'; skill: ProviderSkill } | { kind: 'app'; app: ProviderApp }
type SelectorIconItem = {
  icon: ReactNode
  key: string
  title?: string
}
type ChatConfigSectionId = 'model' | 'reasoning' | 'access' | 'speed'

type ChatConfigOptionGroup = {
  id: string
  label?: string
  options: readonly DropdownOption<string>[]
  selectedValue: string
  onChange: (value: string) => void
}

type ChatConfigSection = {
  disabled?: boolean
  id: ChatConfigSectionId
  icon: ReactNode
  label: string
  groups: readonly ChatConfigOptionGroup[]
}

type ChatConfigDropdownProps = {
  disabled: boolean
  id: string
  modelLabel: string
  reasoningLabel?: string | null
  sections: readonly ChatConfigSection[]
  statusIcons: readonly SelectorIconItem[]
  title: string
}

type ChatConfigMenuStyle = CSSProperties & {
  '--chat-config-menu-max-height': string
}

const getChatConfigMenuStyle = (buttonRect: DOMRect): ChatConfigMenuStyle => {
  const viewportInset = 12
  const menuOffset = 6
  const maxMenuHeight = 760
  const menuWidth = Math.min(360, Math.max(260, window.innerWidth - viewportInset * 2))
  const maxLeft = Math.max(viewportInset, window.innerWidth - menuWidth - viewportInset)
  const spaceAbove = Math.max(0, buttonRect.top - menuOffset - viewportInset)
  const spaceBelow = Math.max(
    0,
    window.innerHeight - buttonRect.bottom - menuOffset - viewportInset
  )
  const openUp = spaceAbove >= spaceBelow
  const availableHeight = Math.min(maxMenuHeight, openUp ? spaceAbove : spaceBelow)

  const menuStyle: ChatConfigMenuStyle = {
    '--chat-config-menu-max-height': `${availableHeight}px`,
    left: Math.min(Math.max(viewportInset, buttonRect.left), maxLeft),
    minWidth: buttonRect.width,
    width: menuWidth
  }

  if (openUp) {
    menuStyle.bottom = window.innerHeight - buttonRect.top + menuOffset
  } else {
    menuStyle.top = buttonRect.bottom + menuOffset
  }

  return menuStyle
}

const ChatConfigDropdown: React.FC<ChatConfigDropdownProps> = ({
  disabled,
  id,
  modelLabel,
  reasoningLabel,
  sections,
  statusIcons,
  title
}) => {
  const reactId = useId().replace(/:/g, '')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<ChatConfigSectionId | null>(null)
  const menuId = `${id}-${reactId}-menu`
  const menuOpen = open && sections.length > 0
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setMenuStyle(null)
    setActiveSectionId(null)
  }, [])

  const focusFirstMenuButton = useCallback((): void => {
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getChatConfigMenuStyle(buttonRect))
  }, [])

  const openMenu = useCallback((): void => {
    if (disabled || sections.length === 0) return

    updateMenuPosition()
    setActiveSectionId(null)
    setOpen(true)
    focusFirstMenuButton()
  }, [disabled, focusFirstMenuButton, sections.length, updateMenuPosition])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return

      closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    const handleScroll = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return

      updateMenuPosition()
    }

    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeMenu, menuOpen, updateMenuPosition])

  useEffect(() => {
    if (!open || sections.length > 0) return

    const frame = window.requestAnimationFrame(closeMenu)
    return () => window.cancelAnimationFrame(frame)
  }, [closeMenu, open, sections.length])

  const handleTriggerClick = (): void => {
    if (menuOpen) {
      closeMenu()
      return
    }

    openMenu()
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowUp') {
      if (event.key !== 'ArrowDown') return
    }

    event.preventDefault()
    openMenu()
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      buttonRef.current?.focus({ preventScroll: true })
      return
    }

    if ((event.key === 'ArrowLeft' || event.key === 'Backspace') && activeSection) {
      event.preventDefault()
      setActiveSectionId(null)
      focusFirstMenuButton()
    }
  }

  const renderSectionRoot = (): ReactNode => (
    <div className="message-box__chat-config-sections">
      {sections.map((section) => (
        <button
          className="message-box__chat-config-section-button"
          disabled={disabled || section.disabled}
          key={section.id}
          type="button"
          onClick={() => {
            setActiveSectionId(section.id)
            focusFirstMenuButton()
          }}
        >
          <span className="message-box__chat-config-section-icon" aria-hidden="true">
            {section.icon}
          </span>
          <span className="message-box__chat-config-section-label">{section.label}</span>
          <ChevronRight className="message-box__chat-config-section-chevron" aria-hidden="true" />
        </button>
      ))}
    </div>
  )

  const renderSectionOptions = (section: ChatConfigSection): ReactNode => (
    <>
      <div className="message-box__chat-config-header">
        <button
          className="message-box__chat-config-back"
          type="button"
          onClick={() => {
            setActiveSectionId(null)
            focusFirstMenuButton()
          }}
        >
          <ChevronLeft aria-hidden="true" />
          <span>Back</span>
        </button>
      </div>
      <div className="message-box__chat-config-option-groups">
        {section.groups.map((group, groupIndex) => (
          <div
            className="message-box__chat-config-option-group"
            key={group.id}
            role="group"
            aria-label={group.label}
          >
            {groupIndex > 0 && (
              <div className="message-box__chat-config-separator" role="presentation" />
            )}
            {group.options.map((option) => {
              const selected = option.value === group.selectedValue

              return (
                <button
                  className={[
                    'message-box__chat-config-option',
                    option.icon ? 'message-box__chat-config-option--has-icon' : null,
                    option.description ? 'message-box__chat-config-option--has-description' : null,
                    selected ? 'message-box__chat-config-option--selected' : null
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={disabled || option.disabled}
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  title={option.description}
                  onClick={() => group.onChange(option.value)}
                >
                  {option.description ? (
                    <span className="message-box__chat-config-option-copy">
                      <span className="message-box__chat-config-option-row">
                        {option.icon && (
                          <span className="message-box__chat-config-option-icon" aria-hidden="true">
                            {option.icon}
                          </span>
                        )}
                        <span className="message-box__chat-config-option-label">
                          {option.menuLabel ?? option.label}
                        </span>
                        {selected && (
                          <Check className="message-box__chat-config-check" aria-hidden="true" />
                        )}
                      </span>
                      <span className="message-box__chat-config-option-description">
                        {option.description}
                      </span>
                    </span>
                  ) : (
                    <>
                      {option.icon && (
                        <span className="message-box__chat-config-option-icon" aria-hidden="true">
                          {option.icon}
                        </span>
                      )}
                      <span className="message-box__chat-config-option-copy">
                        <span className="message-box__chat-config-option-label">
                          {option.menuLabel ?? option.label}
                        </span>
                      </span>
                      {selected && (
                        <Check className="message-box__chat-config-check" aria-hidden="true" />
                      )}
                    </>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )

  const menu = menuOpen ? (
    <div
      ref={menuRef}
      className="message-box__chat-config-menu-root"
      style={menuStyle ?? undefined}
      onKeyDown={handleMenuKeyDown}
    >
      <MenuSurface
        className="message-box__chat-config-menu"
        id={menuId}
        role="dialog"
        aria-label="Chat settings"
      >
        {activeSection ? renderSectionOptions(activeSection) : renderSectionRoot()}
      </MenuSurface>
    </div>
  ) : null

  return (
    <span className="message-box__chat-config">
      <button
        ref={buttonRef}
        className="message-box__chat-config-trigger"
        id={id}
        type="button"
        aria-controls={menuOpen ? menuId : undefined}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        disabled={(disabled && !menuOpen) || sections.length === 0}
        title={title}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="message-box__chat-config-value">
          {statusIcons.length > 0 && (
            <span className="message-box__chat-config-status-icons">
              {statusIcons.map((item) => (
                <span
                  className="message-box__chat-config-status-icon"
                  key={item.key}
                  title={item.title}
                  aria-label={item.title}
                >
                  {item.icon}
                </span>
              ))}
            </span>
          )}
          <span className="message-box__chat-config-label">
            <span className="message-box__chat-config-label-part">{modelLabel}</span>
            {reasoningLabel && (
              <>
                <span className="message-box__chat-config-dot" aria-hidden="true" />
                <span className="message-box__chat-config-label-part">{reasoningLabel}</span>
              </>
            )}
          </span>
        </span>
        <ChevronDown className="message-box__chat-config-trigger-chevron" aria-hidden="true" />
      </button>
      {menu && createPortal(menu, document.body)}
    </span>
  )
}

const getFileMentionAtCaret = (message: string, caret: number): FileMention | null => {
  const prefix = message.slice(0, caret)
  const match = /(^|[\s([{])@([^@\s]*)$/.exec(prefix)
  if (!match) return null

  const query = match[2] ?? ''
  return {
    start: caret - query.length - 1,
    end: caret,
    query
  }
}

const getSkillMentionAtCaret = (message: string, caret: number): SkillMention | null => {
  const prefix = message.slice(0, caret)
  const match = /(^|[\s([{])\$([^$\s]*)$/.exec(prefix)
  if (!match) return null

  const query = match[2] ?? ''
  return {
    start: caret - query.length - 1,
    end: caret,
    query
  }
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

const getNumberValue = (value: number | string | null | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null

  const numericValue = Number(value)
  return Number.isSafeInteger(numericValue) ? numericValue : null
}

const formatTokenCount = (value: number | string | null | undefined): string => {
  const numericValue = getNumberValue(value)
  if (numericValue != null) {
    if (numericValue >= 10_000) return compactNumberFormatter.format(numericValue)
    return numberFormatter.format(numericValue)
  }

  return typeof value === 'string' && value
    ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : 'Unknown'
}

const formatPercent = (value: number): string => `${Math.round(value)}%`

const clampPercent = (value: number): number => Math.min(Math.max(value, 0), 100)

const getContextPercent = (contextUsage: MessageBoxContextUsage): number | null => {
  if (contextUsage.usedTokens == null || contextUsage.maxTokens == null) return null
  if (contextUsage.maxTokens <= 0) return null

  return clampPercent((contextUsage.usedTokens / contextUsage.maxTokens) * 100)
}

const isMainRateLimit = (limit: AccountRateLimit): boolean =>
  limit.id == null || limit.id === 'codex' || limit.label.toLocaleLowerCase() === 'codex'

const formatWindowLabel = (windowMinutes: number | null): string => {
  if (windowMinutes == null) return 'current window'
  if (windowMinutes === 60) return 'hourly'
  if (windowMinutes === 1_440) return 'daily'
  if (windowMinutes === 10_080) return 'weekly'

  if (windowMinutes % 10_080 === 0) {
    const weeks = windowMinutes / 10_080
    return weeks === 1 ? 'weekly' : `${weeks} weeks`
  }

  if (windowMinutes % 1_440 === 0) {
    const days = windowMinutes / 1_440
    return days === 1 ? 'daily' : `${days} days`
  }

  if (windowMinutes % 60 === 0) {
    const hours = windowMinutes / 60
    return hours === 1 ? 'hourly' : `${hours} hours`
  }

  return `${windowMinutes} min`
}

const formatResetTime = (resetsAt: number | null): string | null => {
  if (!resetsAt) return null

  const timestamp = resetsAt > 1_000_000_000_000 ? resetsAt : resetsAt * 1_000
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

const formatDurationSeconds = (value: string | null | undefined): string => {
  const seconds = getNumberValue(value)
  if (seconds == null) return 'Unknown'
  if (seconds < 60) return `${numberFormatter.format(seconds)} sec`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${numberFormatter.format(minutes)} min`

  const hours = Math.round(minutes / 60)
  return `${numberFormatter.format(hours)} hr`
}

const formatDayCount = (value: string | null | undefined): string => {
  const days = getNumberValue(value)
  if (days == null) return 'Unknown'

  return days === 1 ? '1 day' : `${numberFormatter.format(days)} days`
}

const getRateLimitResetMessage = (outcome: ProviderAccountRateLimitResetOutcome): string => {
  if (outcome === 'reset') return 'Rate limits reset.'
  if (outcome === 'nothingToReset') return 'There is no used limit to reset.'
  if (outcome === 'noCredit') return 'No reset credits are available.'
  return 'That reset credit was already used.'
}

const getRateLimitUsageFingerprint = (usage: ProviderAccountUsage | null): string =>
  JSON.stringify(usage?.rateLimits ?? null)

export const MessageBox: React.FC<MessageBoxProps> = ({
  approvalMode,
  approvalModes,
  active = false,
  activePrimaryMode = 'queue',
  activeSteeringEnabled = true,
  autoFocus = false,
  disabled = false,
  editSession = null,
  error = null,
  container = null,
  accountUsage,
  accountUsageError,
  accountUsageState,
  actions = [],
  contextUsage,
  displayUsage,
  lastActionId,
  notes = [],
  notesContextKey,
  notesLabel,
  showAccessSelector = true,
  showActions = false,
  showActionLabel = false,
  showModelSelector = true,
  showNotesButton = false,
  showReasoningSelector = true,
  showReviewSelector = true,
  showSpeedSelector = true,
  model,
  models,
  modelsUnavailable = false,
  operationsDisabled = false,
  pending = false,
  providerId,
  projectCwd,
  cwd = null,
  reasoningEffort,
  serviceTier,
  sandboxMode,
  sandboxModes,
  selectedReview = null,
  onApprovalModeChange,
  onActionsChange,
  onLastActionChange,
  onCancelEdit,
  onModelChange,
  onNotesChange,
  onOpenAttachment,
  onOpenFileLink,
  onReasoningEffortChange,
  onServiceTierChange,
  onRunAction,
  onSelectedReviewChange,
  onSandboxModeChange,
  onStop,
  onUsageRefresh,
  onUsageReset,
  onSend
}) => {
  const usagePopoverId = useId().replace(/:/g, '')
  const fileMentionListboxId = useId().replace(/:/g, '')
  const skillMentionListboxId = useId().replace(/:/g, '')
  const [message, setMessage] = useState('')
  const [selectedAttachments, setSelectedAttachments] = useState<AppSelectedAttachment[]>([])
  const [selectedSkills, setSelectedSkills] = useState<ProviderSkill[]>([])
  const [selectedApps, setSelectedApps] = useState<ProviderApp[]>([])
  const [openedImage, setOpenedImage] = useState<Extract<
    AppSelectedAttachment,
    { kind: 'image' }
  > | null>(null)
  const [attachmentSelectionPending, setAttachmentSelectionPending] = useState(false)
  const [attachmentSelectionError, setAttachmentSelectionError] = useState<string | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageView, setUsageView] = useState<UsagePopoverView>('usage')
  const [otherLimitsOpen, setOtherLimitsOpen] = useState(false)
  const [rateLimitResetPending, setRateLimitResetPending] = useState(false)
  const [rateLimitResetMessage, setRateLimitResetMessage] = useState<string | null>(null)
  const [rateLimitRefreshBaseline, setRateLimitRefreshBaseline] = useState<string | null>(null)
  const [fileMention, setFileMention] = useState<FileMention | null>(null)
  const [projectFileCache, setProjectFileCache] = useState<ProjectFileCache | null>(null)
  const [projectFilesErrorCwd, setProjectFilesErrorCwd] = useState<string | null>(null)
  const [activeFileMentionIndex, setActiveFileMentionIndex] = useState(0)
  const [skillMention, setSkillMention] = useState<SkillMention | null>(null)
  const [composerCache, setComposerCache] = useState<ComposerCache | null>(null)
  const [composerLoadErrorScope, setComposerLoadErrorScope] = useState<string | null>(null)
  const [activeSkillMentionIndex, setActiveSkillMentionIndex] = useState(0)
  const editSessionIdRef = useRef<string | null>(null)
  const messageRef = useRef(message)
  const selectedAttachmentsRef = useRef(selectedAttachments)
  const selectedSkillsRef = useRef(selectedSkills)
  const selectedAppsRef = useRef(selectedApps)
  const messageBeforeEditRef = useRef<string | null>(null)
  const attachmentsBeforeEditRef = useRef<AppSelectedAttachment[] | null>(null)
  const skillsBeforeEditRef = useRef<ProviderSkill[] | null>(null)
  const appsBeforeEditRef = useRef<ProviderApp[] | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const usageControlRef = useRef<HTMLDivElement>(null)
  const editing = Boolean(editSession)
  const fullAccessSelected = sandboxMode === 'danger-full-access'
  const reviewSelectorVisible = showReviewSelector && !fullAccessSelected
  const effectiveApprovalMode = fullAccessSelected ? 'never' : approvalMode
  const selectedApprovalMode = approvalModes.find((mode) => mode.id === effectiveApprovalMode)
  const approvalModeOptions = approvalModes.map((mode): DropdownOption<ProviderApprovalMode> => ({
    value: mode.id,
    label: mode.label,
    menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
    description: mode.description || undefined,
    icon: approvalModeIcons[mode.id]
  }))
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
  const sandboxModeOptions = sandboxModes.map((mode): DropdownOption<ProviderSandboxMode> => ({
    value: mode.id,
    label: mode.label,
    menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
    description: mode.description || undefined,
    icon: sandboxModeIcons[mode.id]
  }))
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
  const modelSelectionUnavailable = modelsUnavailable || models.length === 0
  const modelOptions = modelSelectionUnavailable
    ? []
    : models.map((candidateModel): DropdownOption<ProviderModelId> => ({
        value: candidateModel.id,
        label: formatModelLabel(candidateModel.label),
        menuLabel: candidateModel.isDefault
          ? `${formatModelLabel(candidateModel.label)} (default)`
          : formatModelLabel(candidateModel.label),
        description: candidateModel.description || undefined,
        icon: <Bot aria-hidden="true" />
      }))
  const displayedModelOptions = modelSelectionUnavailable
    ? [
        {
          value: model,
          label: 'No models',
          icon: <Bot aria-hidden="true" />,
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
            icon: <Bot aria-hidden="true" />
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
  const selectedApprovalModeTitle = selectedApprovalMode?.description
    ? `${selectedApprovalMode.label}: ${selectedApprovalMode.description}`
    : (selectedApprovalMode?.label ?? formatOptionLabel(effectiveApprovalMode))
  const selectedReasoningEffortLabel = selectedReasoningEffortPresentation.label
  const selectorsDisabled = operationsDisabled || (!active && (disabled || pending))
  const approvalSelectorDisabled = selectorsDisabled || fullAccessSelected
  const selectedServiceTierValue = selectedServiceTier ?? standardServiceTierValue
  const selectedModelLabel = modelSelectionUnavailable
    ? 'No models'
    : formatModelLabel(selectedModel?.label ?? model)
  const selectedSandboxModeLabel = selectedSandboxMode?.label ?? formatOptionLabel(sandboxMode)
  const selectedServiceTierLabel = selectedServiceTierOption?.label ?? 'Standard'
  const chatConfigSections: ChatConfigSection[] = [
    ...(showModelSelector
      ? [
          {
            id: 'model',
            icon: <Bot aria-hidden="true" />,
            label: 'Model',
            groups: [
              {
                id: 'model',
                options: displayedModelOptions.map((option) => ({
                  ...option,
                  disabled:
                    modelSelectionUnavailable ||
                    selectorsDisabled ||
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
            disabled: !reasoningSelectionAvailable,
            icon: reasoningSelectionAvailable ? (
              selectedReasoningEffortPresentation.icon
            ) : (
              <Sparkles />
            ),
            label: 'Reasoning',
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
    ...(showAccessSelector || reviewSelectorVisible
      ? [
          {
            id: 'access',
            icon: showAccessSelector
              ? sandboxModeIcons[sandboxMode]
              : approvalModeIcons[effectiveApprovalMode],
            label: 'Access',
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
            disabled: !serviceTierSelectionAvailable,
            icon: selectedServiceTierOption?.icon ?? <Gauge aria-hidden="true" />,
            label: 'Speed',
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
          : [])
      ]
  const selectorsVisible =
    showAccessSelector ||
    reviewSelectorVisible ||
    showModelSelector ||
    showReasoningSelector ||
    showSpeedSelector
  const notesButtonVisible = Boolean(showNotesButton && notesLabel && onNotesChange)
  const actionsButtonVisible = Boolean(
    showActions && onActionsChange && onLastActionChange && onRunAction
  )
  const workspaceControlsVisible = notesButtonVisible || actionsButtonVisible
  const promptControlsVisible = selectorsVisible || workspaceControlsVisible
  const controlsClassName = [
    'message-box__controls',
    promptControlsVisible ? null : 'message-box__controls--no-selectors'
  ]
    .filter(Boolean)
    .join(' ')
  const textareaDisabled = operationsDisabled || (active ? false : disabled || pending)
  const activePrimaryLabel = activePrimaryMode === 'queue' ? 'Queue message' : 'Steer current turn'
  const editingPendingMessage = editSession?.type === 'pending'
  const usageDisabled = operationsDisabled || (!active && (disabled || pending))
  const usageMenuOpen = usageOpen && !usageDisabled
  const fileMentionMenuOpen = Boolean(
    fileMention &&
    !textareaDisabled &&
    !editing &&
    selectedAttachments.length < maxSelectedAttachmentCount
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
    !textareaDisabled &&
    (selectedSkills.length < maxSelectedSkillCount || selectedApps.length < maxSelectedAppCount)
  )
  const composerResults = useMemo(
    () =>
      getComposerResults(
        composerCache?.providerId === providerId &&
          composerCache.cwd === cwd &&
          composerCache.sourceKey === composerSourceKey
          ? composerCache.skills
          : [],
        composerCache?.providerId === providerId &&
          composerCache.cwd === cwd &&
          composerCache.sourceKey === composerSourceKey
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
      .catch(() => {
        if (!active) return
        setProjectFilesErrorCwd(projectCwd)
      })

    return () => {
      active = false
    }
  }, [composerSourceKey, container, fileMentionMenuOpen, projectCwd, projectFileCache])

  useEffect(() => {
    if (
      !skillMentionMenuOpen ||
      (composerCache?.providerId === providerId &&
        composerCache.cwd === cwd &&
        composerCache.sourceKey === composerSourceKey)
    ) {
      return
    }

    let active = true

    void Promise.allSettled([
      providerApi.getSkills(providerId, cwd, { container }),
      providerApi.getApps(providerId, { container })
    ]).then(([skillsResult, appsResult]) => {
      if (!active) return

      if (skillsResult.status === 'rejected' && appsResult.status === 'rejected') {
        setComposerLoadErrorScope(skillScope)
        return
      }

      setComposerCache({
        cwd,
        providerId,
        sourceKey: composerSourceKey,
        skills: skillsResult.status === 'fulfilled' ? skillsResult.value : [],
        apps: appsResult.status === 'fulfilled' ? appsResult.value : []
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
    skillMentionMenuOpen,
    skillScope
  ])

  useEffect(() => {
    if (!usageMenuOpen) return

    const handleClick = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && usageControlRef.current?.contains(target)) return

      setUsageOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setUsageOpen(false)
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [usageMenuOpen])

  const rateLimitUsageFingerprint = getRateLimitUsageFingerprint(accountUsage)

  useEffect(() => {
    if (rateLimitRefreshBaseline === null) return

    if (rateLimitUsageFingerprint !== rateLimitRefreshBaseline) {
      let active = true

      queueMicrotask(() => {
        if (active) setRateLimitRefreshBaseline(null)
      })

      return () => {
        active = false
      }
    }

    let active = true
    let refreshTimeout: number | null = null

    const scheduleRefresh = (): void => {
      refreshTimeout = window.setTimeout(() => {
        void (async () => {
          try {
            await onUsageRefresh?.()
          } catch {
            // Keep polling after transient refresh failures.
          } finally {
            if (active) scheduleRefresh()
          }
        })()
      }, 1_000)
    }

    scheduleRefresh()

    return () => {
      active = false
      if (refreshTimeout !== null) window.clearTimeout(refreshTimeout)
    }
  }, [onUsageRefresh, rateLimitRefreshBaseline, rateLimitUsageFingerprint])

  useEffect(() => {
    if (!editSession) {
      editSessionIdRef.current = null
      messageBeforeEditRef.current = null
      attachmentsBeforeEditRef.current = null
      skillsBeforeEditRef.current = null
      appsBeforeEditRef.current = null
      return
    }

    if (editSessionIdRef.current === editSession.id) return

    editSessionIdRef.current = editSession.id
    messageBeforeEditRef.current = messageRef.current
    attachmentsBeforeEditRef.current = selectedAttachmentsRef.current
    skillsBeforeEditRef.current = selectedSkillsRef.current
    appsBeforeEditRef.current = selectedAppsRef.current
    setMessage(editSession.content)
    setSelectedAttachments([])
    setSelectedSkills([])
    setSelectedApps([])
    setAttachmentSelectionError(null)

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [editSession])

  useEffect(() => {
    if (!autoFocus || operationsDisabled || disabled || pending) return

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [autoFocus, operationsDisabled, disabled, pending])

  useEffect(() => {
    if (!selectedReview || editing) return
    const frame = window.requestAnimationFrame(() =>
      textareaRef.current?.focus({ preventScroll: true })
    )
    return () => window.cancelAnimationFrame(frame)
  }, [editing, selectedReview])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = `${minTextareaHeight}px`
    textarea.style.overflowY = 'hidden'

    const nextHeight = Math.min(textarea.scrollHeight, maxTextareaHeight)
    textarea.style.height = `${Math.max(minTextareaHeight, nextHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxTextareaHeight ? 'auto' : 'hidden'
  }, [message])

  const submitMessage = (activeMode: ProviderActiveSendMode = activePrimaryMode): void => {
    const nextMessage = message.trim()
    const typedSkillInputs = getSelectedSkillInputs(
      nextMessage,
      composerCache?.providerId === providerId &&
        composerCache.cwd === cwd &&
        composerCache.sourceKey === composerSourceKey
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
        !submittingReview) ||
      operationsDisabled ||
      (!active && (disabled || pending))
    ) {
      return
    }

    if (editing) {
      void Promise.resolve(
        onSend(nextMessage, undefined, [], undefined, selectedSkillInputs, selectedAppInputs)
      )
        .then(() => {
          setMessage(messageBeforeEditRef.current ?? '')
          setSelectedAttachments(attachmentsBeforeEditRef.current ?? [])
          setSelectedSkills(skillsBeforeEditRef.current ?? [])
          setSelectedApps(appsBeforeEditRef.current ?? [])
          editSessionIdRef.current = null
          messageBeforeEditRef.current = null
          attachmentsBeforeEditRef.current = null
          skillsBeforeEditRef.current = null
          appsBeforeEditRef.current = null
        })
        .catch(() => {})
      return
    }

    setMessage('')
    setSelectedAttachments([])
    setSelectedSkills([])
    setSelectedApps([])
    onSelectedReviewChange?.(null)
    setAttachmentSelectionError(null)
    void onSend(
      nextMessage,
      active ? activeMode : undefined,
      selectedAttachments,
      submittingReview,
      selectedSkillInputs,
      selectedAppInputs
    )
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
    if (attachmentSelectionPending || textareaDisabled || editing) return

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const attachments = await appApi.selectMessageAttachments()
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
      setAttachmentSelectionError(
        selectionError instanceof Error ? selectionError.message : 'Unable to attach files.'
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
    if (attachmentSelectionPending || textareaDisabled || editing) return
    if (selectedAttachments.length >= maxSelectedAttachmentCount) {
      setAttachmentSelectionError(`Attach up to ${maxSelectedAttachmentCount} files per message.`)
      return
    }

    setAttachmentSelectionPending(true)
    setAttachmentSelectionError(null)

    try {
      const image = await appApi.getClipboardImage()
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
    setFileMention(getFileMentionAtCaret(nextMessage, event.currentTarget.selectionStart))
    setSkillMention(getSkillMentionAtCaret(nextMessage, event.currentTarget.selectionStart))
    setActiveFileMentionIndex(0)
    setActiveSkillMentionIndex(0)
  }

  const handleMessageSelect = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const textarea = event.currentTarget
    const nextFileMention = getFileMentionAtCaret(textarea.value, textarea.selectionStart)
    const nextSkillMention = getSkillMentionAtCaret(textarea.value, textarea.selectionStart)
    const fileMentionChanged =
      nextFileMention?.start !== fileMention?.start ||
      nextFileMention?.end !== fileMention?.end ||
      nextFileMention?.query !== fileMention?.query
    const skillMentionChanged =
      nextSkillMention?.start !== skillMention?.start ||
      nextSkillMention?.end !== skillMention?.end ||
      nextSkillMention?.query !== skillMention?.query

    setFileMention(nextFileMention)
    setSkillMention(nextSkillMention)
    if (fileMentionChanged) setActiveFileMentionIndex(0)
    if (skillMentionChanged) setActiveSkillMentionIndex(0)
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

    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    submitMessage()
  }

  const hasContent =
    Boolean(message.trim()) ||
    selectedAttachments.length > 0 ||
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
        ...(activePrimaryMode === 'steer'
          ? [
              {
                id: 'queue',
                label: 'Queue',
                title: 'Send this as the next turn after the current response finishes',
                callback: () => submitMessage('queue'),
                disabled: operationsDisabled,
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
                  disabled: operationsDisabled,
                  icon: <CornerDownRight aria-hidden="true" />
                }
              ]
            : []),
        {
          id: 'interrupt',
          label: 'Interrupt',
          title: 'Stop the current response and send this message',
          callback: () => submitMessage('interrupt'),
          disabled: operationsDisabled,
          icon: <Square aria-hidden="true" />
        }
      ]
    : undefined
  const accountUsageErrors = accountUsage?.errors ?? []
  const statisticsReported = Boolean(
    accountUsage?.statisticsLoaded &&
    accountUsage.summary &&
    Object.values(accountUsage.summary).some((value) => value !== null)
  )
  const visibleUsageView: UsagePopoverView = statisticsReported ? usageView : 'usage'
  const statisticsLoading = accountUsageState === 'loading' && !statisticsReported
  const rateLimits = accountUsage?.rateLimits ?? []
  const mainRateLimits = rateLimits.filter(isMainRateLimit)
  const visibleRateLimits = mainRateLimits.length > 0 ? mainRateLimits : rateLimits.slice(0, 1)
  const detailedRateLimits =
    mainRateLimits.length > 0
      ? rateLimits.filter((limit) => !isMainRateLimit(limit))
      : rateLimits.slice(1)
  const globalRateLimit = visibleRateLimits[0] ?? null
  const contextPercent = getContextPercent(contextUsage)
  const contextPercentLabel = contextPercent == null ? null : formatPercent(contextPercent)
  const globalPercent = globalRateLimit ? clampPercent(globalRateLimit.usedPercent) : null
  const displayedUsagePercent = displayUsage === 'global' ? globalPercent : contextPercent
  const usageButtonLabel =
    displayUsage === 'global'
      ? globalPercent == null
        ? accountUsageState === 'loading'
          ? 'Global usage loading'
          : 'Global usage unavailable'
        : `Global usage ${formatPercent(globalPercent)} used`
      : contextPercentLabel
        ? `Chat context ${contextPercentLabel} used`
        : contextUsage.usedTokens
          ? `Chat context ${formatTokenCount(contextUsage.usedTokens)} used`
          : 'No chat context used'
  const usageButtonStyle = {
    '--message-box-usage-degrees': `${(displayedUsagePercent ?? 0) * 3.6}deg`
  } as CSSProperties
  const availableRateLimitResets = accountUsage?.rateLimitResetCredits?.availableCount ?? 0

  const handleUsageToggle = (): void => {
    if (usageDisabled) return

    const nextOpen = !usageMenuOpen
    setUsageOpen(nextOpen)
    if (nextOpen) {
      if (!statisticsReported) setUsageView('usage')
      void onUsageRefresh?.({ includeStatistics: true })
    }
  }

  const handleUsageViewChange = (nextView: UsagePopoverView): void => {
    setUsageView(nextView)
    if (nextView === 'statistics' && !accountUsage?.statisticsLoaded) {
      void onUsageRefresh?.({ includeStatistics: true })
    }
  }

  const handleRateLimitReset = async (): Promise<void> => {
    if (!onUsageReset || rateLimitResetPending || availableRateLimitResets <= 0) return

    const resetCountLabel =
      availableRateLimitResets === 1
        ? 'your last remaining reset'
        : `one of your ${numberFormatter.format(availableRateLimitResets)} remaining resets`
    if (!window.confirm(`Use ${resetCountLabel} to reset your Codex rate limits?`)) return

    setRateLimitResetPending(true)
    setRateLimitResetMessage(null)

    try {
      const usageBeforeReset = getRateLimitUsageFingerprint(accountUsage)
      const outcome = await onUsageReset()
      setRateLimitResetMessage(getRateLimitResetMessage(outcome))
      await onUsageRefresh?.()
      if (outcome === 'reset' && onUsageRefresh) {
        setRateLimitRefreshBaseline(usageBeforeReset)
      }
    } catch (resetError) {
      setRateLimitResetMessage(
        resetError instanceof Error ? resetError.message : 'Unable to reset rate limits.'
      )
    } finally {
      setRateLimitResetPending(false)
    }
  }

  const renderRateLimit = (limit: AccountRateLimit, key: string): ReactNode => {
    const usedPercent = clampPercent(limit.usedPercent)
    const roundedUsedPercent = Math.round(usedPercent)
    const resetTime = formatResetTime(limit.resetsAt)
    const windowLabel = formatWindowLabel(limit.windowMinutes)
    const limitLabel = `${limit.label} ${windowLabel}${
      limit.kind === 'secondary' ? ' secondary' : ''
    }`

    return (
      <div className="message-box__limit" key={key}>
        <div className="message-box__usage-row">
          <span>{limitLabel}</span>
          <strong>{formatPercent(100 - roundedUsedPercent)} left</strong>
        </div>
        <div className="message-box__usage-meter" aria-hidden="true">
          <span style={{ width: `${usedPercent}%` }} />
        </div>
        {resetTime && (
          <div className="message-box__usage-row message-box__usage-row--muted">
            <span>Resets</span>
            <strong>{resetTime}</strong>
          </div>
        )}
      </div>
    )
  }

  const selectedImages = selectedAttachments.filter((attachment) => attachment.kind === 'image')
  const selectedFiles = selectedAttachments.filter((attachment) => attachment.kind === 'file')
  const showSelectedReview = Boolean(selectedReview && !editing)
  const mentionDropdownEmptyContent = skillMentionMenuOpen ? (
    composerLoadErrorScope === skillScope ? (
      <div className="message-box__file-mention-status">Unable to load skills and apps</div>
    ) : composerCache?.providerId !== providerId ||
      composerCache.cwd !== cwd ||
      composerCache.sourceKey !== composerSourceKey ? (
      <div className="message-box__file-mention-status">Loading skills and apps…</div>
    ) : (
      <div className="message-box__file-mention-status">No matching skills or apps</div>
    )
  ) : !projectCwd ? (
    <div className="message-box__file-mention-status">No project selected</div>
  ) : projectFilesErrorCwd === projectCwd ? (
    <div className="message-box__file-mention-status">Unable to load files</div>
  ) : projectFileCache?.cwd !== projectCwd || projectFileCache.sourceKey !== composerSourceKey ? (
    <div className="message-box__file-mention-status">Searching files…</div>
  ) : (
    <div className="message-box__file-mention-status">No matching files</div>
  )
  const messageBoxError =
    attachmentSelectionError ?? (error && error !== dismissedError ? error : null)
  const messageBoxErrorLabel = attachmentSelectionError ? 'Attachment failed' : 'Request failed'

  const handleDismissMessageBoxError = (): void => {
    if (attachmentSelectionError) {
      setAttachmentSelectionError(null)
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
      <div className="message-box__input">
        {(selectedAttachments.length > 0 ||
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
                      disabled={textareaDisabled || editing}
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
              selectedSkills.length > 0 ||
              selectedApps.length > 0 ||
              showSelectedReview) && (
              <div
                className="message-box__attachment-preview-group message-box__attachment-preview-group--other"
                aria-label="Selected context"
                role="list"
              >
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
                      removeDisabled={textareaDisabled}
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
                    removeDisabled={textareaDisabled}
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
                    removeDisabled={textareaDisabled || editing}
                    removeTitle={`Remove ${attachment.name}`}
                  />
                ))}
                {selectedReview && showSelectedReview && (
                  <ReviewCommentsButton
                    comments={selectedReview.comments}
                    disabled={textareaDisabled || editing}
                    onOpenFileLink={onOpenFileLink}
                    onRemove={() => onSelectedReviewChange?.(null)}
                    projectCwd={projectCwd}
                  />
                )}
              </div>
            )}
          </div>
        )}
        <div className="message-box__textarea-wrap">
          {(skillMentionMenuOpen || fileMentionMenuOpen) && (
            <div className="message-box__file-mention-menu">
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
            </div>
          )}
          <textarea
            ref={textareaRef}
            id="message-input"
            disabled={textareaDisabled}
            rows={1}
            value={message}
            placeholder="Message the assistant"
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
              disabled={
                textareaDisabled ||
                editing ||
                attachmentSelectionPending ||
                selectedAttachments.length >= maxSelectedAttachmentCount
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
                  disabled={selectorsDisabled}
                  id="chat-config-mode"
                  modelLabel={selectedModelLabel}
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
            <div className="message-box__usage-control" ref={usageControlRef}>
              <Button
                aria-label={usageButtonLabel}
                aria-controls={`message-usage-${usagePopoverId}`}
                aria-expanded={usageMenuOpen}
                callback={handleUsageToggle}
                data-pressed={usageMenuOpen ? 'true' : undefined}
                disabled={usageDisabled}
                icon={<span className="message-box__usage-ring" />}
                size="small"
                style={usageButtonStyle}
                theme="transparent"
                title={usageButtonLabel}
              />
              {usageMenuOpen && (
                <div
                  className="message-box__usage-popover"
                  id={`message-usage-${usagePopoverId}`}
                  role="dialog"
                  aria-label="Usage"
                >
                  <SegmentedControl
                    aria-label="Usage views"
                    className="message-box__usage-tabs"
                    options={[
                      { value: 'usage', label: 'Usage' },
                      {
                        value: 'statistics',
                        label: statisticsLoading
                          ? 'Statistics'
                          : statisticsReported
                            ? 'Statistics'
                            : 'No statistics',
                        ariaLabel: statisticsLoading
                          ? 'Statistics loading'
                          : statisticsReported
                            ? 'Statistics'
                            : 'No statistics available',
                        disabled: !statisticsReported,
                        icon: statisticsLoading ? (
                          <LoaderCircle className="message-box__usage-loading-icon" />
                        ) : undefined
                      }
                    ]}
                    size="small"
                    value={visibleUsageView}
                    onChange={handleUsageViewChange}
                  />

                  {visibleUsageView === 'usage' ? (
                    <div className="message-box__usage-page" role="tabpanel">
                      <section className="message-box__usage-section">
                        <div className="message-box__usage-row">
                          <span>Context</span>
                          <strong>
                            {contextUsage.usedTokens == null || contextUsage.usedTokens === 0
                              ? '0'
                              : contextUsage.maxTokens
                                ? `${formatTokenCount(
                                    contextUsage.usedTokens
                                  )} / ${formatTokenCount(contextUsage.maxTokens)}`
                                : `${formatTokenCount(contextUsage.usedTokens)} ${
                                    contextUsage.source === 'estimated' ? 'estimated' : 'used'
                                  }`}
                          </strong>
                        </div>
                        {contextPercentLabel && (
                          <div className="message-box__usage-meter" aria-hidden="true">
                            <span style={{ width: contextPercentLabel }} />
                          </div>
                        )}
                      </section>

                      <section className="message-box__usage-section">
                        {accountUsageState === 'loading' && !accountUsage && (
                          <p className="message-box__usage-status">Loading usage...</p>
                        )}
                        {accountUsageState === 'error' && !accountUsage && (
                          <p className="message-box__usage-status">
                            {accountUsageError ?? 'Usage unavailable.'}
                          </p>
                        )}
                        {visibleRateLimits.map((limit, index) =>
                          renderRateLimit(
                            limit,
                            `${limit.id ?? limit.label}:${limit.kind}:${index}`
                          )
                        )}
                        {detailedRateLimits.length > 0 && (
                          <div className="message-box__limits-details">
                            <DisclosureToggle
                              className="message-box__limits-toggle"
                              open={otherLimitsOpen}
                              aria-controls={`message-other-limits-${usagePopoverId}`}
                              onClick={() => setOtherLimitsOpen((currentOpen) => !currentOpen)}
                            >
                              Other limits
                            </DisclosureToggle>
                            {otherLimitsOpen && (
                              <div
                                className="message-box__limits-details-body"
                                id={`message-other-limits-${usagePopoverId}`}
                              >
                                {detailedRateLimits.map((limit, index) =>
                                  renderRateLimit(
                                    limit,
                                    `detail:${limit.id ?? limit.label}:${limit.kind}:${index}`
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {availableRateLimitResets > 0 && onUsageReset && (
                          <div className="message-box__usage-reset">
                            <span>
                              {numberFormatter.format(availableRateLimitResets)}{' '}
                              {availableRateLimitResets === 1 ? 'reset' : 'resets'} left
                            </span>
                            <Button
                              callback={handleRateLimitReset}
                              disabled={rateLimitResetPending}
                              icon={<RotateCcw aria-hidden="true" />}
                              label={rateLimitResetPending ? 'Resetting...' : 'Reset limits'}
                              size="small"
                              theme="secondary"
                            />
                          </div>
                        )}
                        {rateLimitResetMessage && (
                          <p className="message-box__usage-status" role="status">
                            {rateLimitResetMessage}
                          </p>
                        )}
                        {accountUsage &&
                          accountUsage.rateLimits.length === 0 &&
                          accountUsageErrors.length === 0 && (
                            <p className="message-box__usage-status">Usage unavailable.</p>
                          )}
                        {accountUsageErrors.map((usageError, index) => (
                          <p className="message-box__usage-status" key={`${usageError}:${index}`}>
                            {usageError}
                          </p>
                        ))}
                      </section>
                    </div>
                  ) : (
                    <div className="message-box__usage-page" role="tabpanel">
                      <section className="message-box__usage-section">
                        {accountUsage?.statisticsLoaded && accountUsage.summary && (
                          <>
                            <div className="message-box__usage-row">
                              <span>Lifetime tokens</span>
                              <strong>
                                {formatTokenCount(accountUsage.summary.lifetimeTokens)}
                              </strong>
                            </div>
                            <div className="message-box__usage-row">
                              <span>Peak day</span>
                              <strong>
                                {formatTokenCount(accountUsage.summary.peakDailyTokens)}
                              </strong>
                            </div>
                            <div className="message-box__usage-row">
                              <span>Longest turn</span>
                              <strong>
                                {formatDurationSeconds(accountUsage.summary.longestRunningTurnSec)}
                              </strong>
                            </div>
                            <div className="message-box__usage-row">
                              <span>Current streak</span>
                              <strong>
                                {formatDayCount(accountUsage.summary.currentStreakDays)}
                              </strong>
                            </div>
                            <div className="message-box__usage-row">
                              <span>Longest streak</span>
                              <strong>
                                {formatDayCount(accountUsage.summary.longestStreakDays)}
                              </strong>
                            </div>
                          </>
                        )}
                        {accountUsage?.statisticsLoaded && !accountUsage.summary && (
                          <p className="message-box__usage-status">Statistics unavailable.</p>
                        )}
                        {accountUsageErrors.map((usageError, index) => (
                          <p className="message-box__usage-status" key={`${usageError}:${index}`}>
                            {usageError}
                          </p>
                        ))}
                      </section>
                    </div>
                  )}
                </div>
              )}
            </div>
            <Button
              aria-label={buttonLabel}
              title={buttonLabel}
              disabled={
                operationsDisabled ||
                (activeWithContent ? false : active ? false : disabled || pending || !hasContent)
              }
              callback={activeWithContent ? submitMessage : active ? handleStop : submitMessage}
              dropdownActions={activeDropdownActions}
              dropdownLabel="Message actions"
              dropdownMenuAlign="end"
              dropdownPlacement="top"
              icon={
                editingPendingMessage ? (
                  <ListPlus aria-hidden="true" />
                ) : activeWithContent && activePrimaryMode === 'steer' ? (
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
          dataUrl={openedImage.dataUrl}
          name={openedImage.name}
          path={openedImage.path}
          onClose={() => setOpenedImage(null)}
        />
      )}
    </form>
  )
}
