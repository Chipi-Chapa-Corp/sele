import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'
import {
  ArrowUp,
  BadgeCheck,
  Bot,
  CornerDownRight,
  FileLock,
  Flame,
  FolderPen,
  Gauge,
  ListPlus,
  MessageSquare,
  Paperclip,
  RotateCcw,
  ShieldQuestionMark,
  SlidersHorizontal,
  Sparkles,
  Square,
  UnlockKeyhole,
  X,
  Zap
} from 'lucide-react'
import type { AppSelectedAttachment } from '../../../shared/app'
import type {
  ProviderActiveSendMode,
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderCwdNote,
  ProviderModel,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderReview,
  ProviderSandboxMode,
  ProviderSandboxModeOption,
  ProviderUsageOptions
} from '../../../shared/provider'
import { appApi } from '../appApi'
import { Button } from './Button'
import { CwdNotesButton } from './CwdNotesButton'
import { DisclosureToggle } from './DisclosureToggle'
import { Dropdown, type DropdownOption } from './Dropdown'
import { ImageLightbox } from './ImageLightbox'
import { SegmentedControl } from './SegmentedControl'
import './MessageBox.css'

type MessageBoxProps = {
  approvalMode: ProviderApprovalMode
  approvalModes: ProviderApprovalModeOption[]
  active?: boolean
  activePrimaryMode?: Extract<ProviderActiveSendMode, 'steer' | 'queue'>
  autoFocus?: boolean
  disabled?: boolean
  editSession?: { id: string; content: string; type?: 'message' | 'pending' } | null
  error?: string | null
  model: ProviderModelId
  models: ProviderModel[]
  operationsDisabled?: boolean
  pending?: boolean
  reasoningEffort: ProviderReasoningEffort
  sandboxMode: ProviderSandboxMode
  sandboxModes: ProviderSandboxModeOption[]
  selectedReview?: Omit<ProviderReview, 'prompt'> | null
  accountUsage: ProviderAccountUsage | null
  accountUsageError: string | null
  accountUsageState: 'idle' | 'loading' | 'ready' | 'error'
  contextUsage: MessageBoxContextUsage
  notes?: ProviderCwdNote[]
  notesContextKey?: string
  notesLabel?: string
  onApprovalModeChange: (approvalMode: ProviderApprovalMode) => void
  onCancelEdit?: () => void
  onModelChange: (model: ProviderModelId) => void
  onNotesChange?: (notes: ProviderCwdNote[]) => void
  onOpenAttachment?: (attachment: AppSelectedAttachment) => void
  onReasoningEffortChange: (reasoningEffort: ProviderReasoningEffort) => void
  onSelectedReviewChange?: (review: Omit<ProviderReview, 'prompt'> | null) => void
  onSandboxModeChange: (sandboxMode: ProviderSandboxMode) => void
  onStop?: () => Promise<void> | void
  onUsageRefresh?: (options?: ProviderUsageOptions) => Promise<void> | void
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
  onSend: (
    message: string,
    activeMode?: ProviderActiveSendMode,
    attachments?: AppSelectedAttachment[],
    review?: Omit<ProviderReview, 'prompt'> | null
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

const reasoningEffortLabels = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X High',
  max: 'Max',
  ultra: 'Ultra'
} satisfies Record<string, string>

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

const reasoningEffortIcons = {
  none: <Gauge aria-hidden="true" />,
  minimal: <Gauge aria-hidden="true" />,
  low: <Gauge aria-hidden="true" />,
  medium: <SlidersHorizontal aria-hidden="true" />,
  high: <Zap aria-hidden="true" />,
  xhigh: <Flame className={selectedControlIconClassName} aria-hidden="true" />,
  max: <Sparkles aria-hidden="true" />,
  ultra: <Sparkles aria-hidden="true" />
} satisfies Record<string, ReactNode>

const getReasoningEffortLabel = (reasoningEffort: ProviderReasoningEffort): string => {
  const fallbackLabel =
    reasoningEffort
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
      .join(' ') || reasoningEffort

  return reasoningEffortLabels[reasoningEffort] ?? fallbackLabel
}

const getReasoningEffortOptionLabel = (
  reasoningEffort: ProviderReasoningEffort,
  label: string
): string => {
  if (reasoningEffortLabels[reasoningEffort]) return reasoningEffortLabels[reasoningEffort]
  if (label && label !== reasoningEffort) return label

  return getReasoningEffortLabel(reasoningEffort)
}

const getReasoningEffortIcon = (reasoningEffort: ProviderReasoningEffort): ReactNode =>
  reasoningEffortIcons[reasoningEffort] ?? <SlidersHorizontal aria-hidden="true" />

const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

const formatOptionLabel = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || value

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

export const MessageBox: React.FC<MessageBoxProps> = ({
  approvalMode,
  approvalModes,
  active = false,
  activePrimaryMode = 'steer',
  autoFocus = false,
  disabled = false,
  editSession = null,
  error = null,
  accountUsage,
  accountUsageError,
  accountUsageState,
  contextUsage,
  notes = [],
  notesContextKey,
  notesLabel,
  model,
  models,
  operationsDisabled = false,
  pending = false,
  reasoningEffort,
  sandboxMode,
  sandboxModes,
  selectedReview = null,
  onApprovalModeChange,
  onCancelEdit,
  onModelChange,
  onNotesChange,
  onOpenAttachment,
  onReasoningEffortChange,
  onSelectedReviewChange,
  onSandboxModeChange,
  onStop,
  onUsageRefresh,
  onUsageReset,
  onSend
}) => {
  const usagePopoverId = useId().replace(/:/g, '')
  const [message, setMessage] = useState('')
  const [selectedAttachments, setSelectedAttachments] = useState<AppSelectedAttachment[]>([])
  const [openedImage, setOpenedImage] = useState<Extract<
    AppSelectedAttachment,
    { kind: 'image' }
  > | null>(null)
  const [attachmentSelectionPending, setAttachmentSelectionPending] = useState(false)
  const [attachmentSelectionError, setAttachmentSelectionError] = useState<string | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageView, setUsageView] = useState<UsagePopoverView>('usage')
  const [otherLimitsOpen, setOtherLimitsOpen] = useState(false)
  const [rateLimitResetPending, setRateLimitResetPending] = useState(false)
  const [rateLimitResetMessage, setRateLimitResetMessage] = useState<string | null>(null)
  const editSessionIdRef = useRef<string | null>(null)
  const messageRef = useRef(message)
  const selectedAttachmentsRef = useRef(selectedAttachments)
  const messageBeforeEditRef = useRef<string | null>(null)
  const attachmentsBeforeEditRef = useRef<AppSelectedAttachment[] | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const usageControlRef = useRef<HTMLDivElement>(null)
  const editing = Boolean(editSession)
  const fullAccessSelected = sandboxMode === 'danger-full-access'
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
  const modelOptions = models.map((candidateModel): DropdownOption<ProviderModelId> => ({
    value: candidateModel.id,
    label: formatModelLabel(candidateModel.label),
    menuLabel: candidateModel.isDefault
      ? `${formatModelLabel(candidateModel.label)} (default)`
      : formatModelLabel(candidateModel.label),
    description: candidateModel.description || undefined,
    icon: <Bot aria-hidden="true" />
  }))
  const displayedModelOptions = modelOptions.some((option) => option.value === model)
    ? modelOptions
    : [
        ...modelOptions,
        {
          value: model,
          label: formatModelLabel(model),
          icon: <Bot aria-hidden="true" />
        }
      ]
  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts ?? []
  const reasoningEffortOptions = supportedReasoningEfforts.map((option) => {
    const label = getReasoningEffortOptionLabel(option.id, option.label)

    return {
      value: option.id,
      label,
      menuLabel: option.isDefault ? `${label} (default)` : label,
      description: option.description || undefined,
      icon: getReasoningEffortIcon(option.id)
    } satisfies DropdownOption<ProviderReasoningEffort>
  })
  const displayedReasoningEffortOptions = reasoningEffortOptions.some(
    (option) => option.value === reasoningEffort
  )
    ? reasoningEffortOptions
    : [
        ...reasoningEffortOptions,
        {
          value: reasoningEffort,
          label: getReasoningEffortLabel(reasoningEffort),
          icon: getReasoningEffortIcon(reasoningEffort)
        }
      ]
  const selectedModelTitle = selectedModel?.description
    ? `${formatModelLabel(selectedModel.label)}: ${selectedModel.description}`
    : formatModelLabel(selectedModel?.label ?? model)
  const selectedApprovalModeTitle = selectedApprovalMode?.description
    ? `${selectedApprovalMode.label}: ${selectedApprovalMode.description}`
    : (selectedApprovalMode?.label ?? formatOptionLabel(effectiveApprovalMode))
  const selectedSandboxModeTitle = selectedSandboxMode?.description
    ? `${selectedSandboxMode.label}: ${selectedSandboxMode.description}`
    : (selectedSandboxMode?.label ?? formatOptionLabel(sandboxMode))
  const selectedReasoningEffortLabel = getReasoningEffortLabel(reasoningEffort)
  const textareaDisabled = operationsDisabled || (active ? false : disabled || pending)
  const activePrimaryLabel = activePrimaryMode === 'queue' ? 'Queue message' : 'Steer current turn'
  const editingPendingMessage = editSession?.type === 'pending'
  const usageDisabled = operationsDisabled || (!active && (disabled || pending))
  const usageMenuOpen = usageOpen && !usageDisabled

  useEffect(() => {
    messageRef.current = message
  }, [message])

  useEffect(() => {
    selectedAttachmentsRef.current = selectedAttachments
  }, [selectedAttachments])

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

  useEffect(() => {
    if (!editSession) {
      editSessionIdRef.current = null
      messageBeforeEditRef.current = null
      attachmentsBeforeEditRef.current = null
      return
    }

    if (editSessionIdRef.current === editSession.id) return

    editSessionIdRef.current = editSession.id
    messageBeforeEditRef.current = messageRef.current
    attachmentsBeforeEditRef.current = selectedAttachmentsRef.current
    setMessage(editSession.content)
    setSelectedAttachments([])
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
    const submittingReview = editing ? null : selectedReview
    if (
      (!nextMessage && selectedAttachments.length === 0 && !submittingReview) ||
      operationsDisabled ||
      (!active && (disabled || pending))
    ) {
      return
    }

    if (editing) {
      void Promise.resolve(onSend(nextMessage))
        .then(() => {
          setMessage(messageBeforeEditRef.current ?? '')
          setSelectedAttachments(attachmentsBeforeEditRef.current ?? [])
          editSessionIdRef.current = null
          messageBeforeEditRef.current = null
          attachmentsBeforeEditRef.current = null
        })
        .catch(() => {})
      return
    }

    setMessage('')
    setSelectedAttachments([])
    onSelectedReviewChange?.(null)
    setAttachmentSelectionError(null)
    void onSend(nextMessage, active ? activeMode : undefined, selectedAttachments, submittingReview)
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
    editSessionIdRef.current = null
    messageBeforeEditRef.current = null
    attachmentsBeforeEditRef.current = null
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

  const handleOpenAttachment = (attachment: AppSelectedAttachment): void => {
    if (attachment.kind === 'image') {
      setOpenedImage(attachment)
      return
    }

    onOpenAttachment?.(attachment)
  }

  const handleMessageKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
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
    Boolean(message.trim()) || selectedAttachments.length > 0 || Boolean(selectedReview && !editing)
  const activeWithContent = active && hasContent
  const buttonLabel = activeWithContent
    ? activePrimaryLabel
    : active
      ? 'Stop response'
      : editing
        ? 'Save edit'
        : 'Send message'
  const selectorsDisabled = operationsDisabled || (!active && pending)
  const approvalSelectorDisabled = selectorsDisabled || fullAccessSelected
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
  const contextPercent = getContextPercent(contextUsage)
  const contextPercentLabel = contextPercent == null ? null : formatPercent(contextPercent)
  const usageButtonLabel = contextPercentLabel
    ? `Chat context ${contextPercentLabel} used`
    : contextUsage.usedTokens
      ? `Chat context ${formatTokenCount(contextUsage.usedTokens)} used`
      : 'No chat context used'
  const usageButtonStyle = {
    '--message-box-usage-degrees': `${(contextPercent ?? 0) * 3.6}deg`
  } as CSSProperties
  const accountUsageErrors = accountUsage?.errors ?? []
  const statisticsLoading =
    usageView === 'statistics' && accountUsageState === 'loading' && !accountUsage?.statisticsLoaded
  const statisticsLoadError =
    usageView === 'statistics' && accountUsageState === 'error' && !accountUsage?.statisticsLoaded
  const rateLimits = accountUsage?.rateLimits ?? []
  const mainRateLimits = rateLimits.filter(isMainRateLimit)
  const visibleRateLimits = mainRateLimits.length > 0 ? mainRateLimits : rateLimits.slice(0, 1)
  const detailedRateLimits =
    mainRateLimits.length > 0
      ? rateLimits.filter((limit) => !isMainRateLimit(limit))
      : rateLimits.slice(1)
  const availableRateLimitResets = accountUsage?.rateLimitResetCredits?.availableCount ?? 0

  const handleUsageToggle = (): void => {
    if (usageDisabled) return

    const nextOpen = !usageMenuOpen
    setUsageOpen(nextOpen)
    if (nextOpen) void onUsageRefresh?.({ includeStatistics: usageView === 'statistics' })
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
      const outcome = await onUsageReset()
      setRateLimitResetMessage(getRateLimitResetMessage(outcome))
      await onUsageRefresh?.()
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
          <strong>
            {formatPercent(roundedUsedPercent)} · {formatPercent(100 - roundedUsedPercent)} left
          </strong>
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

  return (
    <form className="message-box" aria-busy={pending} onSubmit={handleSubmit}>
      {(attachmentSelectionError || error) && (
        <p className="message-box__error" role="status">
          {attachmentSelectionError ?? error}
        </p>
      )}
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      <label className="sr-only" htmlFor="sandbox-mode">
        Sandbox mode
      </label>
      <label className="sr-only" htmlFor="approval-mode">
        Approval mode
      </label>
      <label className="sr-only" htmlFor="model-mode">
        Model
      </label>
      <label className="sr-only" htmlFor="reasoning-effort">
        Reasoning effort
      </label>
      <div className="message-box__input">
        {(selectedAttachments.length > 0 || showSelectedReview) && (
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
            {(selectedFiles.length > 0 || showSelectedReview) && (
              <div
                className="message-box__attachment-preview-group message-box__attachment-preview-group--other"
                aria-label="Other selected attachments"
                role="list"
              >
                {selectedFiles.map((attachment) => (
                  <div
                    className="message-box__attachment-preview message-box__attachment-preview--file"
                    key={attachment.path}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="message-box__attachment-open message-box__file-tile"
                      aria-label={`Open ${attachment.name}`}
                      title={`Open ${attachment.name}`}
                      disabled={!onOpenAttachment}
                      onClick={() => handleOpenAttachment(attachment)}
                    >
                      <span className="message-box__file-tile-icon" aria-hidden="true">
                        <SymbolsFileIcon fileName={attachment.name} autoAssign />
                      </span>
                      <span className="message-box__attachment-label">{attachment.name}</span>
                    </button>
                    <Button
                      aria-label={`Remove ${attachment.name}`}
                      callback={() => handleRemoveAttachment(attachment.path)}
                      disabled={textareaDisabled || editing}
                      icon={<X aria-hidden="true" />}
                      size="small"
                      theme="transparent"
                      title={`Remove ${attachment.name}`}
                    />
                  </div>
                ))}
                {selectedReview && showSelectedReview && (
                  <div
                    className="message-box__attachment-preview message-box__attachment-preview--review"
                    role="listitem"
                  >
                    <div className="message-box__review-tile">
                      <MessageSquare aria-hidden="true" />
                      <span>
                        Review <span aria-hidden="true">·</span> {selectedReview.comments.length}
                      </span>
                    </div>
                    <Button
                      aria-label="Remove review"
                      callback={() => onSelectedReviewChange?.(null)}
                      disabled={textareaDisabled || editing}
                      icon={<X aria-hidden="true" />}
                      size="small"
                      theme="transparent"
                      title="Remove review"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          id="message-input"
          disabled={textareaDisabled}
          rows={1}
          value={message}
          placeholder="Message the assistant"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleMessageKeyDown}
          onPaste={(event) => void handlePaste(event)}
        />
        <div className="message-box__controls">
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
          <div className="message-box__selectors">
            <span className="message-box__select message-box__sandbox">
              <Dropdown
                id="sandbox-mode"
                disabled={selectorsDisabled}
                icon={sandboxModeIcons[sandboxMode]}
                options={displayedSandboxModeOptions}
                placement="top"
                value={sandboxMode}
                title={selectedSandboxModeTitle}
                onChange={onSandboxModeChange}
              />
            </span>
            <span className="message-box__select message-box__approval">
              <Dropdown
                id="approval-mode"
                disabled={approvalSelectorDisabled}
                icon={approvalModeIcons[effectiveApprovalMode]}
                options={displayedApprovalModeOptions}
                placement="top"
                value={effectiveApprovalMode}
                title={
                  fullAccessSelected
                    ? 'Full access runs without approval prompts.'
                    : selectedApprovalModeTitle
                }
                onChange={onApprovalModeChange}
              />
            </span>
            <span className="message-box__select message-box__model">
              <Dropdown
                id="model-mode"
                disabled={selectorsDisabled}
                icon={<Bot aria-hidden="true" />}
                options={displayedModelOptions}
                placement="top"
                value={model}
                title={selectedModelTitle}
                onChange={onModelChange}
              />
            </span>
            <span className="message-box__select message-box__reasoning">
              <Dropdown
                id="reasoning-effort"
                disabled={selectorsDisabled}
                icon={getReasoningEffortIcon(reasoningEffort)}
                options={displayedReasoningEffortOptions}
                placement="top"
                value={reasoningEffort}
                title={`${selectedReasoningEffortLabel} reasoning`}
                onChange={onReasoningEffortChange}
              />
            </span>
            {notesLabel && onNotesChange && (
              <CwdNotesButton
                key={notesContextKey}
                label={notesLabel}
                notes={notes}
                onNotesChange={onNotesChange}
              />
            )}
          </div>
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
                theme="secondary"
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
                      { value: 'statistics', label: 'Statistics' }
                    ]}
                    size="small"
                    value={usageView}
                    onChange={handleUsageViewChange}
                  />

                  {usageView === 'usage' ? (
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
                        {statisticsLoading && (
                          <p className="message-box__usage-status">Loading statistics...</p>
                        )}
                        {statisticsLoadError && (
                          <p className="message-box__usage-status">
                            {accountUsageError ?? 'Usage unavailable.'}
                          </p>
                        )}
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
                  <ArrowUp aria-hidden="true" />
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
