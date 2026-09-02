import {
  BadgeCheck,
  FileLock,
  FolderPen,
  Gauge,
  ShieldQuestionMark,
  Sparkles,
  UnlockKeyhole,
  Zap
} from 'lucide-react'
import type {
  ProviderAgentMode,
  ProviderApprovalMode,
  ProviderApprovalPolicy,
  ProviderApprovalsReviewer,
  ProviderId,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderSandboxMode,
  ProviderServiceTier
} from '../../shared/provider'
import {
  isProviderAgentMode,
  isProviderApprovalMode,
  isProviderApprovalPolicy,
  isProviderApprovalsReviewer,
  isProviderSandboxMode,
  isProviderServiceTier,
  providerIds
} from '../../shared/provider'
import type { DropdownOption } from './components/Dropdown'
import { providerLabels } from './providerSettings'

type LegacyProviderAccessMode = 'sandbox' | 'auto' | 'full'

export type MessageBoxSelection = {
  agentMode: ProviderAgentMode
  approvalMode: ProviderApprovalMode
  model: ProviderModelId
  reasoningEffort: ProviderReasoningEffort
  sandboxMode: ProviderSandboxMode
  serviceTier: ProviderServiceTier | null
}

export type StoredMessageBoxSelection = Partial<MessageBoxSelection>
export type StoredMessageBoxSelections = Partial<Record<ProviderId, StoredMessageBoxSelection>>

const legacyMessageBoxSelectionStorageKey = 'sele:message-box-selection:v1'
const messageBoxSelectionsStorageKey = 'sele:message-box-selections:v2'

export const getApprovalAccessOptions = (
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

const getApprovalModeForPolicy = (
  approvalPolicy: ProviderApprovalPolicy,
  approvalsReviewer: ProviderApprovalsReviewer
): ProviderApprovalMode => {
  if (approvalPolicy === 'never') return 'never'
  if (approvalPolicy === 'on-request' && approvalsReviewer === 'auto_review') return 'auto-review'

  return 'ask-user'
}

const isLegacyProviderAccessMode = (value: unknown): value is LegacyProviderAccessMode =>
  value === 'sandbox' || value === 'auto' || value === 'full'

const getLegacyApprovalMode = (accessMode: LegacyProviderAccessMode): ProviderApprovalMode =>
  accessMode === 'sandbox' ? 'ask-user' : 'never'

const getLegacySandboxMode = (accessMode: LegacyProviderAccessMode): ProviderSandboxMode =>
  accessMode === 'full' ? 'danger-full-access' : 'workspace-write'

const isStoredSelectionString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const parseStoredMessageBoxSelection = (value: unknown): StoredMessageBoxSelection => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const parsedValue = value as Record<string, unknown>
  const selection: StoredMessageBoxSelection = {}
  if (isProviderAgentMode(parsedValue.agentMode)) selection.agentMode = parsedValue.agentMode
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

export const readStoredMessageBoxSelections = (): StoredMessageBoxSelections => {
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

export const writeStoredMessageBoxSelections = (selections: StoredMessageBoxSelections): void => {
  try {
    window.localStorage.setItem(messageBoxSelectionsStorageKey, JSON.stringify(selections))
  } catch {
    // Composer preferences are non-critical; ignore unavailable storage.
  }
}

const getDropdownOptions = <TValue extends string>(
  labels: Record<TValue, string>
): DropdownOption<TValue>[] =>
  Object.entries(labels).map(([value, label]) => ({
    value: value as TValue,
    label: label as string
  }))

export const providerOptions = getDropdownOptions(providerLabels)

export const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

export const formatSelectionLabel = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || value

const highlightedControlIconClassName = 'message-box__selected-control-icon'

export const chatApprovalModeIcons = {
  'ask-user': <ShieldQuestionMark aria-hidden="true" />,
  'auto-review': <Sparkles aria-hidden="true" />,
  never: <BadgeCheck aria-hidden="true" />
} satisfies Record<ProviderApprovalMode, React.ReactNode>

export const chatSandboxModeIcons = {
  'read-only': <FileLock aria-hidden="true" />,
  'workspace-write': <FolderPen aria-hidden="true" />,
  'danger-full-access': (
    <UnlockKeyhole className={highlightedControlIconClassName} aria-hidden="true" />
  )
} satisfies Record<ProviderSandboxMode, React.ReactNode>

export const getChatServiceTierIcon = (id: string, label = id): React.ReactNode =>
  id.toLocaleLowerCase() === 'fast' ||
  id.toLocaleLowerCase() === 'priority' ||
  label.toLocaleLowerCase() === 'fast' ? (
    <Zap className="message-box__fast-speed-icon" aria-hidden="true" />
  ) : (
    <Gauge aria-hidden="true" />
  )
