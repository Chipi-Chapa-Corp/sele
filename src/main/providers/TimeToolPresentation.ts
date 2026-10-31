import type { ProviderToolActivity, ProviderToolIcon } from '../../shared/provider'

export const getTimeToolPresentation = (
  names: string[]
): {
  activity: ProviderToolActivity
  icon: ProviderToolIcon
  label: string
  compact: boolean
} | null => {
  for (const name of names) {
    const normalized = name
      .replace(/^mcp__/, '')
      .replace(/__|\./g, '/')
      .replace(/^(clock|functions|collaboration)_/, '$1/')
    if (/^(?:clock\/)?sleep$/.test(normalized))
      return { activity: 'other', icon: 'time', label: 'Waited', compact: true }
    if (/^(?:collaboration\/)?wait_agent$/.test(normalized))
      return { activity: 'other', icon: 'time', label: 'Waited for subagent', compact: true }
    if (/^(?:functions\/)?wait$/.test(normalized))
      return { activity: 'other', icon: 'time', label: 'Waited', compact: false }
  }
  return null
}
