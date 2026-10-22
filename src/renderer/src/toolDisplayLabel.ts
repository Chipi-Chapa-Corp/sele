import type { ProviderToolActivity, ProviderToolIcon } from '../../shared/provider'

export const activityLabels: Record<ProviderToolActivity, string> = {
  'image-view': 'read images',
  skill: 'used skills',
  read: 'read files',
  search: 'searched',
  git: 'used Git',
  edit: 'changed files',
  create: 'created files',
  delete: 'deleted files',
  npm: 'ran npm scripts',
  npx: 'ran npx tools',
  script: 'ran scripts',
  command: 'ran commands',
  other: 'used tools'
}

export const activeActivityLabels: Record<ProviderToolActivity, string> = {
  'image-view': 'Reading images',
  skill: 'Using skills',
  read: 'Reading files',
  search: 'Searching',
  git: 'Using Git',
  edit: 'Changing files',
  create: 'Creating files',
  delete: 'Deleting files',
  npm: 'Running npm scripts',
  npx: 'Running npx tools',
  script: 'Running scripts',
  command: 'Running commands',
  other: 'Using tools'
}

const activeLabelReplacements: Array<[RegExp, string]> = [
  [/^Read\b/, 'Reading'],
  [/^(?:Search|Searched)\b/, 'Searching'],
  [/^Checked\b/, 'Checking'],
  [/^Viewed\b/, 'Viewing'],
  [/^Ran\b/, 'Running'],
  [/^Used\b/, 'Using'],
  [/^Started\b/, 'Starting'],
  [/^(?:Edit|Edited|Changed)\b/, 'Changing'],
  [/^(?:Create|Created)\b/, 'Creating'],
  [/^(?:Delete|Deleted)\b/, 'Deleting'],
  [/^Applied\b/, 'Applying'],
  [/^Updated\b/, 'Updating'],
  [/^Fetched\b/, 'Fetching'],
  [/^Generated\b/, 'Generating'],
  [/^Waited\b/, 'Waiting'],
  [/^Opened\b/, 'Opening'],
  [/^Listed\b/, 'Listing'],
  [/^Navigated\b/, 'Navigating'],
  [/^Went\b/, 'Going'],
  [/^Reloaded\b/, 'Reloading'],
  [/^Closed\b/, 'Closing'],
  [/^Showed\b/, 'Showing'],
  [/^Handed\b/, 'Handing'],
  [/^Took\b/, 'Taking'],
  [/^Inspected\b/, 'Inspecting'],
  [/^Clicked\b/, 'Clicking'],
  [/^Dragged\b/, 'Dragging'],
  [/^Pressed\b/, 'Pressing'],
  [/^Scrolled\b/, 'Scrolling'],
  [/^Selected\b/, 'Selecting'],
  [/^Filled\b/, 'Filling'],
  [/^Typed\b/, 'Typing'],
  [/^Pasted\b/, 'Pasting'],
  [/^Interacted\b/, 'Interacting'],
  [/^Reset\b/, 'Resetting']
]

const getActiveToolLabel = (label: string, activity: ProviderToolActivity): string => {
  for (const [pattern, replacement] of activeLabelReplacements) {
    if (pattern.test(label)) return label.replace(pattern, replacement)
  }

  if (activity === 'other' && label && label !== 'Tool use') return `Using ${label}`
  return activeActivityLabels[activity]
}

const getFinishedToolLabel = (label: string, activity: ProviderToolActivity): string => {
  if (activeLabelReplacements.some(([pattern]) => pattern.test(label))) return label
  if (label && label !== 'Tool use') return activity === 'other' ? `Used ${label}` : label

  const fallback = activityLabels[activity] || activityLabels.other
  return fallback.charAt(0).toLocaleUpperCase() + fallback.slice(1)
}

/** Subagent labels are task descriptions ("Explore chat code"), so they read as-is without "Using". */
const getSubagentLabel = (label: string, active: boolean): string => {
  if (!label || label === 'Tool use') return active ? 'Running subagent' : 'Ran subagent'
  if (!active) return label
  for (const [pattern, replacement] of activeLabelReplacements) {
    if (pattern.test(label)) return label.replace(pattern, replacement)
  }
  return label
}

export const getToolDisplayLabel = (
  label: string,
  activity: ProviderToolActivity,
  active: boolean,
  icon?: ProviderToolIcon | null
): string => {
  if (label === 'Asking question' || label === 'Asked a question') return label
  if (icon === 'subagent') return getSubagentLabel(label, active)
  return active ? getActiveToolLabel(label, activity) : getFinishedToolLabel(label, activity)
}

/** A sequence heading describes every activity it contains, including completed children. */
export const getToolSequenceDisplayLabel = (
  activities: ProviderToolActivity[],
  active: boolean,
  otherToolLabels: string[] = []
): string => {
  const labels = active ? activeActivityLabels : activityLabels
  const namedLabels = [...new Set(otherToolLabels.filter(Boolean))].map((label) =>
    getToolDisplayLabel(label, 'other', active)
  )
  const label =
    [...new Set(activities)]
      .flatMap((activity) =>
        activity === 'other' && namedLabels.length ? namedLabels : [labels[activity]]
      )
      .join(', ') || labels.other
  return label.charAt(0).toLocaleUpperCase() + label.slice(1)
}
