import type { ReactNode } from 'react'
import {
  BrainCircuit,
  Flame,
  Gauge,
  Rocket,
  SlidersHorizontal,
  Zap,
  type LucideIcon
} from 'lucide-react'
import type { ProviderReasoningEffort } from '../../shared/provider'

type ReasoningEffortDefinition = {
  icon: LucideIcon
  label: string
  showStatusIcon?: boolean
}

export type ReasoningEffortPresentation = {
  icon: ReactNode
  isKnown: boolean
  label: string
  showStatusIcon: boolean
}

const highlightedIconClassName = 'message-box__selected-control-icon'

const reasoningEffortDefinitions: Record<string, ReasoningEffortDefinition> = {
  none: { icon: Gauge, label: 'None' },
  minimal: { icon: Gauge, label: 'Minimal' },
  low: { icon: Gauge, label: 'Low' },
  medium: { icon: SlidersHorizontal, label: 'Medium' },
  high: { icon: Zap, label: 'High' },
  xhigh: { icon: Flame, label: 'X High', showStatusIcon: true },
  max: { icon: BrainCircuit, label: 'Max', showStatusIcon: true },
  ultra: { icon: Rocket, label: 'Ultra', showStatusIcon: true }
}

const normalizeReasoningEffort = (reasoningEffort: ProviderReasoningEffort): string =>
  reasoningEffort.toLocaleLowerCase().replace(/[-_\s]+/g, '')

const formatReasoningEffortLabel = (reasoningEffort: ProviderReasoningEffort): string =>
  reasoningEffort
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || reasoningEffort

export const getReasoningEffortPresentation = (
  reasoningEffort: ProviderReasoningEffort
): ReasoningEffortPresentation => {
  const definition = reasoningEffortDefinitions[normalizeReasoningEffort(reasoningEffort)]
  const Icon = definition?.icon ?? SlidersHorizontal
  const showStatusIcon = definition?.showStatusIcon === true

  return {
    icon: (
      <Icon className={showStatusIcon ? highlightedIconClassName : undefined} aria-hidden="true" />
    ),
    isKnown: definition != null,
    label: definition?.label ?? formatReasoningEffortLabel(reasoningEffort),
    showStatusIcon
  }
}
