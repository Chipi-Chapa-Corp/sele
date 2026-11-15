import type {
  AppGitCommitMessageGenerationSettings,
  AppGitCommitPromptSettings,
  AppGitQuickActionsSettings,
  AppGitWorktreeSettings,
  AppProjectSettingsByCwd,
  AppProjectSettingsOverrides,
  AppSettings
} from './settings'
import { isAppProjectSettingsOverridesEmpty, normalizeAppProjectSettingsCwd } from './settings'

export type ChatBooleanSettingKey = {
  [Key in keyof AppSettings['chat']]: AppSettings['chat'][Key] extends boolean ? Key : never
}[keyof AppSettings['chat']]

export type ChatBooleanSettingField = {
  key: ChatBooleanSettingKey
  label: string
  description?: string
  id: string
}

export type AppearanceFontKey = 'applicationFont' | 'chatFont' | 'codeFont'

export type AppProjectSettingPath =
  | { section: 'appearance'; key: keyof AppSettings['appearance'] }
  | { section: 'chat'; key: keyof AppSettings['chat'] }
  | { section: 'browser'; key: keyof AppSettings['browser'] }
  | { section: 'links'; key: keyof AppSettings['links'] }
  | { section: 'performance'; key: keyof AppSettings['performance'] }
  | {
      section: 'git'
      key:
        | 'enablePullRequests'
        | 'commitModels'
        | 'errorResolutionPrompt'
        | 'permanentErrorResolutionPrompt'
        | 'untrackedFilesPrompt'
    }
  | { section: 'gitCommitPrompt'; key: keyof AppGitCommitPromptSettings }
  | {
      section: 'gitCommitMessageGeneration'
      key: keyof AppGitCommitMessageGenerationSettings
    }
  | { section: 'gitQuickActions'; key: keyof AppGitQuickActionsSettings }
  | { section: 'gitWorktree'; key: keyof AppGitWorktreeSettings }

const hasSettingKey = (value: object | null | undefined, key: PropertyKey): boolean =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key))

export const getProjectSettingPathId = (path: AppProjectSettingPath): string =>
  `settings-project-action-${path.section}-${path.key}`

const dropEmptyGroups = <Value extends object>(
  value: Value,
  groupKeys: readonly (keyof Value)[]
): Value => {
  const nextValue = { ...value }
  for (const key of groupKeys) {
    const group = nextValue[key]
    if (group && Object.keys(group).length === 0) delete nextValue[key]
  }
  return nextValue
}

const cleanProjectSettingsOverrides = (
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsOverrides =>
  dropEmptyGroups(
    overrides.git
      ? {
          ...overrides,
          git: dropEmptyGroups(overrides.git, [
            'commitPrompt',
            'commitMessageGeneration',
            'quickActions',
            'worktree'
          ])
        }
      : overrides,
    ['appearance', 'chat', 'browser', 'links', 'performance', 'git']
  )

const gitGroupSections = {
  gitCommitPrompt: 'commitPrompt',
  gitCommitMessageGeneration: 'commitMessageGeneration',
  gitQuickActions: 'quickActions',
  gitWorktree: 'worktree'
} as const

type SettingSection = AppProjectSettingPath['section']

const isGitGroupSection = (section: SettingSection): section is keyof typeof gitGroupSections =>
  section in gitGroupSections

const getSettingGroup = (
  settings: AppProjectSettingsOverrides,
  section: SettingSection
): Record<string, unknown> | undefined =>
  isGitGroupSection(section) ? settings.git?.[gitGroupSections[section]] : settings[section]

const setSettingGroup = (
  overrides: AppProjectSettingsOverrides,
  section: SettingSection,
  group: Record<string, unknown>
): AppProjectSettingsOverrides =>
  cleanProjectSettingsOverrides(
    isGitGroupSection(section)
      ? { ...overrides, git: { ...overrides.git, [gitGroupSections[section]]: group } }
      : { ...overrides, [section]: group }
  )

export const getAppProjectSettingValue = (
  settings: AppSettings,
  path: AppProjectSettingPath
): unknown => getSettingGroup(settings, path.section)?.[path.key]

export const isAppProjectSettingOverridden = (
  overrides: AppProjectSettingsOverrides | null | undefined,
  path: AppProjectSettingPath
): boolean => hasSettingKey(overrides && getSettingGroup(overrides, path.section), path.key)

export const setAppProjectSettingOverrideValue = (
  overrides: AppProjectSettingsOverrides,
  path: AppProjectSettingPath,
  value: unknown
): AppProjectSettingsOverrides =>
  setSettingGroup(overrides, path.section, {
    ...getSettingGroup(overrides, path.section),
    [path.key]: value
  })

export const clearAppProjectSettingOverrideValue = (
  overrides: AppProjectSettingsOverrides,
  path: AppProjectSettingPath
): AppProjectSettingsOverrides => {
  const group = { ...getSettingGroup(overrides, path.section) }
  delete group[path.key]
  return setSettingGroup(overrides, path.section, group)
}

export const setAppProjectSettingsForCwd = (
  projectSettings: AppProjectSettingsByCwd,
  cwd: string,
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsByCwd => {
  const normalizedCwd = normalizeAppProjectSettingsCwd(cwd)
  if (!normalizedCwd) return projectSettings

  const nextProjectSettings = { ...projectSettings }
  if (isAppProjectSettingsOverridesEmpty(overrides)) {
    delete nextProjectSettings[normalizedCwd]
  } else {
    nextProjectSettings[normalizedCwd] = cleanProjectSettingsOverrides(overrides)
  }

  return nextProjectSettings
}

export const chatPromptBoxSettingFields = [
  {
    key: 'promptSuggestions',
    label: 'Show AI prompt suggestions',
    description:
      'Suggest the next prompt after a response when supported by your provider. Press Tab to accept.',
    id: 'settings-chat-prompt-suggestions'
  },
  {
    key: 'hidePlans',
    label: 'Hide plans in chats',
    description: 'Hide the expandable plan panel above the message box.',
    id: 'settings-chat-hide-plans'
  },
  {
    key: 'enableNotesButton',
    label: 'Enable notes button',
    description: 'Show workspace notes beside the prompt controls.',
    id: 'settings-chat-enable-notes'
  },
  {
    key: 'enableActions',
    label: 'Enable actions',
    description: 'Show saved workspace actions beside the prompt controls.',
    id: 'settings-chat-enable-actions'
  }
] satisfies ChatBooleanSettingField[]

export const chatDropdownSettingFields = [
  {
    key: 'presets',
    label: 'Presets',
    description:
      'Show saved configurations in the picker. Turn off to open configuration sections directly.',
    id: 'settings-chat-presets'
  },
  { key: 'updateExistingChats', label: 'Update all existing chats', id: 'settings-chat-existing' },
  { key: 'updateNewChats', label: 'Update all new chats', id: 'settings-chat-new' }
] satisfies ChatBooleanSettingField[]

export const chatProgressSettingFields = [
  {
    key: 'expandProgressOnStart',
    label: 'Expand progress on start',
    id: 'settings-chat-progress-expand-start'
  },
  {
    key: 'collapseProgressOnFinish',
    label: 'Collapse progress on finish',
    id: 'settings-chat-progress-collapse-finish'
  },
  {
    key: 'collapseProgressOnNextTurn',
    label: 'Collapse progress on next turn',
    id: 'settings-chat-progress-collapse-next-turn'
  }
] satisfies ChatBooleanSettingField[]

export const chatStoppedSteeredFailedProgressSettingFields = [
  {
    key: 'collapseStoppedSteeredFailedProgressOnFinish',
    label: 'Collapse progress on finish',
    id: 'settings-chat-exceptional-progress-collapse-finish'
  },
  {
    key: 'collapseStoppedSteeredFailedProgressOnNextTurn',
    label: 'Collapse progress on next turn',
    id: 'settings-chat-exceptional-progress-collapse-next-turn'
  }
] satisfies ChatBooleanSettingField[]
