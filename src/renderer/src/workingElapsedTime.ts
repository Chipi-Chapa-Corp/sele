import type { ProviderWorkingStep } from '../../shared/provider'

export const formatWorkingDuration = (milliseconds: number): string => {
  if (!Number.isFinite(milliseconds) || milliseconds < 1000) return ''
  const seconds = Math.floor(milliseconds / 1000)
  return [
    [Math.floor(seconds / 3600), 'h'],
    [Math.floor((seconds % 3600) / 60), 'm'],
    [seconds % 60, 's']
  ]
    .filter(([value]) => value !== 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ')
}

export const getWorkingElapsedTime = (
  item: Pick<ProviderWorkingStep, 'status' | 'startedAt' | 'completedAt'>,
  now: number
): string => {
  if (item.startedAt == null || item.status === 'queued') return ''
  const end = item.status === 'working' ? now : item.completedAt
  return end == null ? '' : formatWorkingDuration(end - item.startedAt)
}
