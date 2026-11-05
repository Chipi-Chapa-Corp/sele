import {
  BadgeCheck,
  FileLock,
  FolderPen,
  ShieldQuestionMark,
  Sparkles,
  UnlockKeyhole
} from 'lucide-react'
import { type ReactNode } from 'react'
import type {
  ProviderApprovalMode,
  ProviderReasoningEffort,
  ProviderSandboxMode
} from '../../../shared/provider'
import { getReasoningEffortPresentation } from '../reasoningEffortPresentation'

export const standardServiceTierValue = '__standard__'
export const fastServiceTierIconClassName = 'message-box__fast-speed-icon'
export const selectedControlIconClassName = 'message-box__selected-control-icon'

export const approvalModeIcons = {
  'ask-user': <ShieldQuestionMark aria-hidden="true" />,
  'auto-review': <Sparkles aria-hidden="true" />,
  never: <BadgeCheck aria-hidden="true" />
} satisfies Record<ProviderApprovalMode, ReactNode>

export const sandboxModeIcons = {
  'read-only': <FileLock aria-hidden="true" />,
  'workspace-write': <FolderPen aria-hidden="true" />,
  'danger-full-access': (
    <UnlockKeyhole className={selectedControlIconClassName} aria-hidden="true" />
  )
} satisfies Record<ProviderSandboxMode, ReactNode>

export const getReasoningEffortOptionLabel = (
  reasoningEffort: ProviderReasoningEffort,
  label: string
): string => {
  const presentation = getReasoningEffortPresentation(reasoningEffort)

  if (presentation.isKnown) return presentation.label
  if (label && label !== reasoningEffort) return label

  return presentation.label
}

export const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

export const getModelMenuLabel = (label: string, isDefault: boolean): string =>
  isDefault && !/\b(?:default|recommended)\b/i.test(label) ? `${label} (default)` : label

export const formatOptionLabel = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || value

export const isFastServiceTier = (id: string, label: string): boolean =>
  id.toLocaleLowerCase() === 'fast' ||
  id.toLocaleLowerCase() === 'priority' ||
  label.toLocaleLowerCase() === 'fast'
