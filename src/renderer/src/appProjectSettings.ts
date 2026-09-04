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
import type { AppGitCommitModels } from './gitCommitModels'

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

const cleanProjectSettingsOverrides = (
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsOverrides => {
  const nextOverrides: AppProjectSettingsOverrides = { ...overrides }

  if (nextOverrides.appearance && Object.keys(nextOverrides.appearance).length === 0) {
    delete nextOverrides.appearance
  }
  if (nextOverrides.chat && Object.keys(nextOverrides.chat).length === 0) {
    delete nextOverrides.chat
  }
  if (nextOverrides.browser && Object.keys(nextOverrides.browser).length === 0) {
    delete nextOverrides.browser
  }
  if (nextOverrides.links && Object.keys(nextOverrides.links).length === 0) {
    delete nextOverrides.links
  }
  if (nextOverrides.performance && Object.keys(nextOverrides.performance).length === 0) {
    delete nextOverrides.performance
  }

  if (nextOverrides.git) {
    const gitOverrides = { ...nextOverrides.git }
    if (gitOverrides.commitPrompt && Object.keys(gitOverrides.commitPrompt).length === 0) {
      delete gitOverrides.commitPrompt
    }
    if (
      gitOverrides.commitMessageGeneration &&
      Object.keys(gitOverrides.commitMessageGeneration).length === 0
    ) {
      delete gitOverrides.commitMessageGeneration
    }
    if (gitOverrides.quickActions && Object.keys(gitOverrides.quickActions).length === 0) {
      delete gitOverrides.quickActions
    }
    if (gitOverrides.worktree && Object.keys(gitOverrides.worktree).length === 0) {
      delete gitOverrides.worktree
    }

    if (Object.keys(gitOverrides).length === 0) {
      delete nextOverrides.git
    } else {
      nextOverrides.git = gitOverrides
    }
  }

  return nextOverrides
}

export const getAppProjectSettingValue = (
  settings: AppSettings,
  path: AppProjectSettingPath
): unknown => {
  switch (path.section) {
    case 'appearance':
      return settings.appearance[path.key]
    case 'chat':
      return settings.chat[path.key]
    case 'browser':
      return settings.browser[path.key]
    case 'links':
      return settings.links[path.key]
    case 'performance':
      return settings.performance[path.key]
    case 'git':
      return settings.git[path.key]
    case 'gitCommitPrompt':
      return settings.git.commitPrompt[path.key]
    case 'gitCommitMessageGeneration':
      return settings.git.commitMessageGeneration[path.key]
    case 'gitQuickActions':
      return settings.git.quickActions[path.key]
    case 'gitWorktree':
      return settings.git.worktree[path.key]
  }
}

export const isAppProjectSettingOverridden = (
  overrides: AppProjectSettingsOverrides | null | undefined,
  path: AppProjectSettingPath
): boolean => {
  switch (path.section) {
    case 'appearance':
      return hasSettingKey(overrides?.appearance, path.key)
    case 'chat':
      return hasSettingKey(overrides?.chat, path.key)
    case 'browser':
      return hasSettingKey(overrides?.browser, path.key)
    case 'links':
      return hasSettingKey(overrides?.links, path.key)
    case 'performance':
      return hasSettingKey(overrides?.performance, path.key)
    case 'git':
      return hasSettingKey(overrides?.git, path.key)
    case 'gitCommitPrompt':
      return hasSettingKey(overrides?.git?.commitPrompt, path.key)
    case 'gitCommitMessageGeneration':
      return hasSettingKey(overrides?.git?.commitMessageGeneration, path.key)
    case 'gitQuickActions':
      return hasSettingKey(overrides?.git?.quickActions, path.key)
    case 'gitWorktree':
      return hasSettingKey(overrides?.git?.worktree, path.key)
  }
}

export const setAppProjectSettingOverrideValue = (
  overrides: AppProjectSettingsOverrides,
  path: AppProjectSettingPath,
  value: unknown
): AppProjectSettingsOverrides => {
  switch (path.section) {
    case 'appearance':
      return cleanProjectSettingsOverrides({
        ...overrides,
        appearance: {
          ...overrides.appearance,
          [path.key]: value
        } as Partial<AppSettings['appearance']>
      })
    case 'chat':
      return cleanProjectSettingsOverrides({
        ...overrides,
        chat: {
          ...overrides.chat,
          [path.key]: value
        } as Partial<AppSettings['chat']>
      })
    case 'browser':
      return cleanProjectSettingsOverrides({
        ...overrides,
        browser: {
          ...overrides.browser,
          [path.key]: value
        } as Partial<AppSettings['browser']>
      })
    case 'links':
      return cleanProjectSettingsOverrides({
        ...overrides,
        links: {
          ...overrides.links,
          [path.key]: value
        } as Partial<AppSettings['links']>
      })
    case 'performance':
      return cleanProjectSettingsOverrides({
        ...overrides,
        performance: {
          ...overrides.performance,
          [path.key]: value
        } as Partial<AppSettings['performance']>
      })
    case 'git':
      if (path.key !== 'commitModels') {
        return cleanProjectSettingsOverrides({
          ...overrides,
          git: {
            ...overrides.git,
            [path.key]: value as string
          }
        })
      }

      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          commitModels: value as AppGitCommitModels
        }
      })
    case 'gitCommitPrompt':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          commitPrompt: {
            ...overrides.git?.commitPrompt,
            [path.key]: value
          } as Partial<AppGitCommitPromptSettings>
        }
      })
    case 'gitCommitMessageGeneration':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          commitMessageGeneration: {
            ...overrides.git?.commitMessageGeneration,
            [path.key]: value
          } as Partial<AppGitCommitMessageGenerationSettings>
        }
      })
    case 'gitQuickActions':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          quickActions: {
            ...overrides.git?.quickActions,
            [path.key]: value
          } as Partial<AppGitQuickActionsSettings>
        }
      })
    case 'gitWorktree':
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: {
          ...overrides.git,
          worktree: {
            ...overrides.git?.worktree,
            [path.key]: value
          } as Partial<AppGitWorktreeSettings>
        }
      })
  }
}

export const clearAppProjectSettingOverrideValue = (
  overrides: AppProjectSettingsOverrides,
  path: AppProjectSettingPath
): AppProjectSettingsOverrides => {
  switch (path.section) {
    case 'appearance': {
      const appearance = { ...(overrides.appearance ?? {}) }
      delete appearance[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, appearance })
    }
    case 'chat': {
      const chat = { ...(overrides.chat ?? {}) }
      delete chat[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, chat })
    }
    case 'browser': {
      const browser = { ...(overrides.browser ?? {}) }
      delete browser[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, browser })
    }
    case 'links': {
      const links = { ...(overrides.links ?? {}) }
      delete links[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, links })
    }
    case 'performance': {
      const performance = { ...(overrides.performance ?? {}) }
      delete performance[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, performance })
    }
    case 'git': {
      const git = { ...(overrides.git ?? {}) }
      delete git[path.key]
      return cleanProjectSettingsOverrides({ ...overrides, git })
    }
    case 'gitCommitPrompt': {
      const commitPrompt = { ...(overrides.git?.commitPrompt ?? {}) }
      delete commitPrompt[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), commitPrompt }
      })
    }
    case 'gitCommitMessageGeneration': {
      const commitMessageGeneration = { ...(overrides.git?.commitMessageGeneration ?? {}) }
      delete commitMessageGeneration[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), commitMessageGeneration }
      })
    }
    case 'gitQuickActions': {
      const quickActions = { ...(overrides.git?.quickActions ?? {}) }
      delete quickActions[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), quickActions }
      })
    }
    case 'gitWorktree': {
      const worktree = { ...(overrides.git?.worktree ?? {}) }
      delete worktree[path.key]
      return cleanProjectSettingsOverrides({
        ...overrides,
        git: { ...(overrides.git ?? {}), worktree }
      })
    }
  }
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
