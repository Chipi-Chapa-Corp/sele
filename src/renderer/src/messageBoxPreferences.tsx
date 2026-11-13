import { preferences as preferenceStorage } from './preferences.ts'
import { createAfterPaintWriter } from './afterPaintWriter'
import { Gauge, Zap } from 'lucide-react'
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
import { ProviderIcon } from './components/ProviderIcon'
import { fastServiceTierIconClassName, isFastServiceTier } from './composer/configPresentation'
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
    const storedValue = preferenceStorage.getItem(messageBoxSelectionsStorageKey)
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
  } catch (error) {
    console.error('Unable to read stored composer preferences.', error)
    // Fall through to the legacy single-provider preference.
  }

  try {
    const storedValue = preferenceStorage.getItem(legacyMessageBoxSelectionStorageKey)
    if (!storedValue) return {}

    const legacySelection = parseStoredMessageBoxSelection(JSON.parse(storedValue))
    if (Object.keys(legacySelection).length === 0) return {}

    return Object.fromEntries(providerIds.map((providerId) => [providerId, { ...legacySelection }]))
  } catch (error) {
    console.error('Unable to read legacy composer preferences.', error)
    return {}
  }
}

export const writeStoredMessageBoxSelections = (selections: StoredMessageBoxSelections): void => {
  try {
    preferenceStorage.setItem(messageBoxSelectionsStorageKey, JSON.stringify(selections))
  } catch (error) {
    console.error('Unable to store composer preferences.', error)
    // Composer preferences are non-critical; ignore unavailable storage.
  }
}

const chatMessageBoxSelectionsStorageKey = 'sele:chat-message-box-selections:v1'

export const readStoredChatMessageBoxSelections = (): Record<string, StoredMessageBoxSelection> => {
  try {
    // A remount before the scheduled write must see the most recent selection.
    chatSelectionsWriter.flush()
    const value = JSON.parse(preferenceStorage.getItem(chatMessageBoxSelectionsStorageKey) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).map(([key, selection]) => [
        key,
        parseStoredMessageBoxSelection(selection)
      ])
    )
  } catch (error) {
    console.error('Unable to read stored chat composer preferences.', error)
    return {}
  }
}

const chatSelectionsWriter = createAfterPaintWriter<Record<string, StoredMessageBoxSelection>>(
  (selections) => {
    try {
      preferenceStorage.setItem(chatMessageBoxSelectionsStorageKey, JSON.stringify(selections))
    } catch (error) {
      console.error('Unable to store chat composer preferences.', error)
      // Composer preferences are non-critical; ignore unavailable storage.
    }
  }
)

export const writeStoredChatMessageBoxSelections = (
  selections: Record<string, StoredMessageBoxSelection>
): void => chatSelectionsWriter.schedule(selections)

export const providerOptions = providerIds.map((value) => ({
  value,
  label: providerLabels[value],
  icon: <ProviderIcon providerId={value} aria-hidden="true" />
}))

export const getChatServiceTierIcon = (id: string, label = id): React.ReactNode =>
  isFastServiceTier(id, label) ? (
    <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
  ) : (
    <Gauge aria-hidden="true" />
  )
