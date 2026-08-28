import type {
  ProviderApprovalMode,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderSandboxMode,
  ProviderServiceTier
} from '../../shared/provider'
import {
  isProviderApprovalMode,
  isProviderSandboxMode,
  isProviderServiceTier
} from '../../shared/provider'
import {
  appWindowZoomLevelDefault,
  appWindowZoomLevelMax,
  appWindowZoomLevelMin,
  appWindowZoomLevelToPercent,
  appWindowZoomPercentMax,
  appWindowZoomPercentMin,
  appWindowZoomPercentToLevel,
  normalizeAppWindowZoomLevel
} from '../../shared/app'
import type { AppExternalLinkAction } from '../../shared/app'
import type { AppAction } from './actions'
import { normalizeAppActions } from './actions'
import { appBrowserDefaultScaleDefault, normalizeAppBrowserDefaultScale } from './browserSettings'
import { appGitLegacyCommitModelKey, type AppGitCommitModels } from './gitCommitModels'
import {
  appMaxChatsRenderedDefault,
  appRecentlyOpenedFilesLimitDefault,
  appRecentsMessageLimitDefault,
  normalizeAppMaxChatsRendered,
  normalizeAppRecentlyOpenedFilesLimit,
  normalizeAppRecentsMessageLimit
} from './performanceSettings'
import {
  defaultGitErrorResolutionPrompt,
  defaultPermanentGitErrorResolutionPrompt
} from './gitErrorResolution'
import {
  defaultAppGitQuickActionsSettings,
  type AppGitQuickActionsSettings
} from './gitQuickActions'

export {
  defaultAppGitQuickActionsSettings,
  type AppGitQuickActionsSettings
} from './gitQuickActions'

export {
  appBrowserDefaultScaleMax,
  appBrowserDefaultScaleMin,
  normalizeAppBrowserDefaultScale
} from './browserSettings'

export {
  appMaxChatsRenderedMin,
  appRecentlyOpenedFilesLimitMax,
  appRecentlyOpenedFilesLimitMin,
  appRecentsMessageLimitMax,
  appRecentsMessageLimitMin,
  normalizeAppMaxChatsRendered,
  normalizeAppRecentlyOpenedFilesLimit,
  normalizeAppRecentsMessageLimit
} from './performanceSettings'

export type AppThemePreference = 'system' | 'light' | 'dark'
export type AppAppearancePositionPreference = 'system' | 'left' | 'right' | 'hidden'
export type AppAppearanceStylePreference = 'system' | 'sele' | 'macos'
export type AppAppearanceControlStylePreference = 'bordered' | 'transparent'
export type AppChatUsageDisplay = 'chatContext' | 'global'

export type AppFontSetting = {
  family: string
  size: number
}

export type AppGitCommitPromptSettings = {
  instructions: string
  workflow: string
  commitStep: string
  amendStep: string
  extraInstructionsPrefix: string
}

export type AppGitCommitMessageGenerationSettings = {
  prompt: string
  largeChangePrompt: string
  aiInstructionsPrefix: string
}

export type AppGitWorktreeSettings = {
  branchNamePrompt: string
}

export type AppChatThoughtSettings = {
  expandThoughtsOnStart: boolean
  collapseThoughtsOnFinish: boolean
  collapseThoughtsOnNextTurn: boolean
  expandStoppedTurns: boolean
  collapseStoppedOnNextTurn: boolean
}

export const appChatManualDropdownValue = 'manual'
export const appChatStandardSpeedValue = 'standard'

export type AppChatDropdownSettings = {
  forceAccess: typeof appChatManualDropdownValue | ProviderSandboxMode
  forceReview: typeof appChatManualDropdownValue | ProviderApprovalMode
  forceModel: typeof appChatManualDropdownValue | ProviderModelId
  forceReasoning: typeof appChatManualDropdownValue | ProviderReasoningEffort
  forceSpeed:
    typeof appChatManualDropdownValue | typeof appChatStandardSpeedValue | ProviderServiceTier
}

export type AppPerformanceSettings = {
  disableShadows: boolean
  maxChatsRendered: number
  recentlyOpenedFilesLimit: number
  recentsMessageLimit: number
}

export type AppExternalLinkBehavior = 'manual' | AppExternalLinkAction

export type AppExternalLinkSettings = {
  behavior: AppExternalLinkBehavior
}

export type AppBrowserView = 'chat' | 'project' | 'global'

export type AppBrowserSettings = {
  defaultScale: number
  enabled: boolean
  view: AppBrowserView
}

export const appAppearanceZoomLevelDefault = appWindowZoomLevelDefault
export const appAppearanceZoomLevelMin = appWindowZoomLevelMin
export const appAppearanceZoomLevelMax = appWindowZoomLevelMax
export const normalizeAppAppearanceZoomLevel = normalizeAppWindowZoomLevel
export const appAppearanceZoomPercentMin = appWindowZoomPercentMin
export const appAppearanceZoomPercentMax = appWindowZoomPercentMax
export const appAppearanceZoomLevelToPercent = appWindowZoomLevelToPercent
export const appAppearanceZoomPercentToLevel = appWindowZoomPercentToLevel
export const appFontSystemValue = 'sele:system-font'
export const appFontInheritValue = 'sele:inherit-application-font'
export const appFontMonospaceValue = 'sele:system-monospace-font'
export const appFontSizeMin = 0.5
export const appFontSizeMax = 2.5
export const appFontScalePercentMin = appFontSizeMin * 100
export const appFontScalePercentMax = appFontSizeMax * 100

export const normalizeAppFontSize = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(Math.max(value, appFontSizeMin), appFontSizeMax) * 1000) / 1000
}

export const appFontSizeToScalePercent = (size: number): number => Math.round(size * 1000) / 10

export const appFontScalePercentToSize = (percent: number, fallback: number): number =>
  normalizeAppFontSize(percent / 100, fallback)

export type AppSettings = {
  actions: AppAction[]
  lastActionId: string | null
  appearance: {
    theme: AppThemePreference
    zoomLevel: number
    position: AppAppearancePositionPreference
    style: AppAppearanceStylePreference
    controlStyle: AppAppearanceControlStylePreference
    applicationFont: AppFontSetting
    chatFont: AppFontSetting
    codeFont: AppFontSetting
  }
  chat: AppChatThoughtSettings & {
    continuePrompt: string
    recentChatCacheLimit: number
    displayUsage: AppChatUsageDisplay
    hidePlans: boolean
    enableActions: boolean
    enableNotesButton: boolean
    updateExistingChats: boolean
    updateNewChats: boolean
  } & AppChatDropdownSettings
  browser: AppBrowserSettings
  links: AppExternalLinkSettings
  performance: AppPerformanceSettings
  git: {
    commitModels: AppGitCommitModels
    errorResolutionPrompt: string
    permanentErrorResolutionPrompt: string
    untrackedFilesPrompt: string
    quickActions: AppGitQuickActionsSettings
    commitPrompt: AppGitCommitPromptSettings
    commitMessageGeneration: AppGitCommitMessageGenerationSettings
    worktree: AppGitWorktreeSettings
  }
}

export type AppProjectSettingsOverrides = {
  appearance?: Partial<AppSettings['appearance']>
  chat?: Partial<AppSettings['chat']>
  browser?: Partial<AppBrowserSettings>
  links?: Partial<AppExternalLinkSettings>
  performance?: Partial<AppPerformanceSettings>
  git?: {
    commitModels?: AppGitCommitModels
    errorResolutionPrompt?: string
    permanentErrorResolutionPrompt?: string
    untrackedFilesPrompt?: string
    quickActions?: Partial<AppGitQuickActionsSettings>
    commitPrompt?: Partial<AppGitCommitPromptSettings>
    commitMessageGeneration?: Partial<AppGitCommitMessageGenerationSettings>
    worktree?: Partial<AppGitWorktreeSettings>
  }
}

export type AppProjectSettingsByCwd = Record<string, AppProjectSettingsOverrides>

export const appSettingsStorageKey = 'sele:app-settings:v1'
export const appProjectSettingsStorageKey = 'sele:app-project-settings:v1'

export const defaultStoppedTurnContinuePrompt = 'Continue from where you left off'

export const defaultAppChatThoughtSettings: AppChatThoughtSettings = {
  expandThoughtsOnStart: true,
  collapseThoughtsOnFinish: true,
  collapseThoughtsOnNextTurn: false,
  expandStoppedTurns: false,
  collapseStoppedOnNextTurn: false
}

export const defaultAppChatDropdownSettings: AppChatDropdownSettings = {
  forceAccess: appChatManualDropdownValue,
  forceReview: appChatManualDropdownValue,
  forceModel: appChatManualDropdownValue,
  forceReasoning: appChatManualDropdownValue,
  forceSpeed: appChatManualDropdownValue
}

export const defaultAppPerformanceSettings: AppPerformanceSettings = {
  disableShadows: false,
  maxChatsRendered: appMaxChatsRenderedDefault,
  recentlyOpenedFilesLimit: appRecentlyOpenedFilesLimitDefault,
  recentsMessageLimit: appRecentsMessageLimitDefault
}

export const defaultAppGitUntrackedFilesPrompt =
  'There are many untracked files in this cwd. Was it meant to be in .gitignore? Resolve or explain'

export const defaultAppGitCommitPromptSettings: AppGitCommitPromptSettings = {
  instructions: [
    'Create one scoped Git commit containing all and only the work completed in this chat before this request.',
    '',
    'Parallel work may exist in the same files, so inspect the actual diffs before staging. Do not assume every changed file requires partial staging.',
    '',
    'Rules:',
    '- If all changes in a file belong to this chat, stage the whole file with `git add -- <file>`.',
    '- If a file contains both this chat’s changes and unrelated changes, stage only the relevant hunks using a minimal patch.',
    '- Include every change from this chat and exclude all unrelated changes.',
    '- Do not ask for review or confirmation.',
    '- If the changes cannot be scoped safely, do not commit and explain why.',
    '- Keep the process focused; do not investigate unrelated repository history or files.'
  ].join('\n'),
  workflow: [
    'Workflow:',
    '',
    '1. `git status --short`',
    '2. `git diff --name-only`',
    '3. Inspect each relevant file with:',
    '   `git diff -- <file>`',
    '4. Stage changes:',
    '   - Whole file belongs to this chat:',
    '     `git add -- <file>`',
    '   - File is mixed:',
    '     1. `git diff -U0 -- <file>`',
    '     2. Create a minimal patch by copying only the wanted hunks from that diff.',
    '     3. `git apply --cached --unidiff-zero < patch`',
    '5. `git diff --cached --name-status`',
    '6. Review the staged diff:',
    '   `git diff --cached`',
    '7. Search for a known unrelated marker only when there is a specific reason:',
    "   `git diff --cached | rg '<marker>'`",
    '8. `git diff --cached --check`'
  ].join('\n'),
  commitStep: '9. `git commit -m "<appropriate message>"`',
  amendStep: '9. `git commit --amend` (amend last commit instead of creating a new one)',
  extraInstructionsPrefix: 'Extra user instructions:'
}

export const defaultAppGitCommitMessageGenerationSettings: AppGitCommitMessageGenerationSettings = {
  prompt: [
    'Generate a concise Git commit name for the supplied Git changes.',
    'Match the style and conventions of the recent commit names.',
    'Return only one single-line commit name, with no quotes, Markdown, or explanation.'
  ].join('\n'),
  largeChangePrompt: [
    'The full diff was omitted because this is a large change.',
    'Use the supplied file paths and change counts to identify the main purpose of the change.',
    'Do not use tools except to read a few of the most important listed files. Do not create a plan, use subagents, modify files, run tests, or inspect unrelated files.',
    'Once ready, return only one single-line commit name, with no quotes, Markdown, or explanation.'
  ].join('\n'),
  aiInstructionsPrefix: 'AI instructions:'
}

export const defaultAppGitWorktreeSettings: AppGitWorktreeSettings = {
  branchNamePrompt:
    'Do not reason, do not use any tools, respond with a branch name for this prompt: ```{prompt}```. Do not add fences or any characters, your message will be used directly'
}

const legacyDefaultGitCommitPromptSettings: Partial<
  Record<keyof AppGitCommitPromptSettings, Set<string>>
> = {
  instructions: new Set([
    'You need to create a scoped Git commit for all work done in this chat before this commit request. There are highly likely some changes of parallel work in same files which were touched in this session, so you need to check actual diffs and create a scoped hunk patch to commit instead of committing entire file, to ensure that only work done in this chat gets committed. Do not include any unrelated changes and include all changes from this session. Do not ask for review or confirmation. If you cannot scope the changes, do not commit and explain why.'
  ]),
  workflow: new Set([
    [
      'Workflow:',
      '1. `git status --short`',
      '2. `git diff --name-only`',
      '3. For only candidate files: `git diff -U0 -- file`',
      '4. Write a small patch containing only the wanted hunks.',
      '5. `git apply --cached --unidiff-zero < patch`',
      '6. `git diff --cached --name-status`',
      '7. `git diff --cached | rg ...` only for known unrelated markers if files are mixed',
      '8. `git diff --cached --check`'
    ].join('\n'),
    [
      'Workflow:',
      '1. `git status --short`',
      '2. `git diff --name-only`',
      '3.1. For files changes in which are to be fully committed, add them with `git add`',
      '3.2.1. For only partial candidate files: `git diff -U0 -- file`',
      '3.2.2. Write a small patch containing only the wanted hunks.',
      '3.2.3. `git apply --cached --unidiff-zero < patch`',
      '6. `git diff --cached --name-status`',
      '7. `git diff --cached | rg ...` only for known unrelated markers if files are mixed',
      '8. `git diff --cached --check`'
    ].join('\n')
  ]),
  commitStep: new Set(['9. `git commit -m "..."`'])
}

const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && navigator.platform.toLocaleLowerCase().includes('mac')

export const defaultAppAppearanceSettings: AppSettings['appearance'] = {
  theme: 'system',
  zoomLevel: appAppearanceZoomLevelDefault,
  position: isMacPlatform() ? 'left' : 'system',
  style: isMacPlatform() ? 'macos' : 'system',
  controlStyle: 'bordered',
  applicationFont: {
    family: appFontSystemValue,
    size: 1
  },
  chatFont: {
    family: appFontInheritValue,
    size: 1
  },
  codeFont: {
    family: appFontMonospaceValue,
    size: 1
  }
}

export const defaultAppSettings: AppSettings = {
  actions: [],
  lastActionId: null,
  appearance: defaultAppAppearanceSettings,
  chat: {
    continuePrompt: defaultStoppedTurnContinuePrompt,
    recentChatCacheLimit: 10,
    displayUsage: 'chatContext',
    hidePlans: false,
    enableActions: true,
    enableNotesButton: true,
    updateExistingChats: false,
    updateNewChats: true,
    ...defaultAppChatDropdownSettings,
    ...defaultAppChatThoughtSettings
  },
  links: {
    behavior: 'manual'
  },
  browser: {
    defaultScale: appBrowserDefaultScaleDefault,
    enabled: true,
    view: 'project'
  },
  performance: defaultAppPerformanceSettings,
  git: {
    commitModels: {},
    errorResolutionPrompt: defaultGitErrorResolutionPrompt,
    permanentErrorResolutionPrompt: defaultPermanentGitErrorResolutionPrompt,
    untrackedFilesPrompt: defaultAppGitUntrackedFilesPrompt,
    quickActions: defaultAppGitQuickActionsSettings,
    commitPrompt: defaultAppGitCommitPromptSettings,
    commitMessageGeneration: defaultAppGitCommitMessageGenerationSettings,
    worktree: defaultAppGitWorktreeSettings
  }
}

export const isAppThemePreference = (value: unknown): value is AppThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

export const isAppAppearancePositionPreference = (
  value: unknown
): value is AppAppearancePositionPreference =>
  value === 'system' || value === 'left' || value === 'right' || value === 'hidden'

export const isAppAppearanceStylePreference = (
  value: unknown
): value is AppAppearanceStylePreference =>
  value === 'system' || value === 'sele' || value === 'macos'

export const isAppAppearanceControlStylePreference = (
  value: unknown
): value is AppAppearanceControlStylePreference => value === 'bordered' || value === 'transparent'

const isAppExternalLinkAction = (value: unknown): value is AppExternalLinkAction =>
  value === 'copy' || value === 'open'

const isAppExternalLinkBehavior = (value: unknown): value is AppExternalLinkBehavior =>
  value === 'manual' || isAppExternalLinkAction(value)

const isAppBrowserView = (value: unknown): value is AppBrowserView =>
  value === 'chat' || value === 'project' || value === 'global'

const isAppChatUsageDisplay = (value: unknown): value is AppChatUsageDisplay =>
  value === 'chatContext' || value === 'global'

const isStoredModel = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

const isStoredReasoningEffort = (value: unknown): value is ProviderReasoningEffort =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 64

const getStoredFontFamily = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback
  const family = value.trim()
  const hasControlCharacter = [...family].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
  return family && family.length <= 256 && !hasControlCharacter ? family : fallback
}

const getStoredFontSetting = (value: unknown, fallback: AppFontSetting): AppFontSetting => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback

  const setting = value as Record<string, unknown>
  const storedSize = setting.size
  const remSize = typeof storedSize === 'number' && storedSize >= 8 ? storedSize / 16 : storedSize
  return {
    family: getStoredFontFamily(setting.family, fallback.family),
    size: normalizeAppFontSize(remSize, fallback.size)
  }
}

const hasOwnProperty = <Key extends PropertyKey>(
  value: object,
  key: Key
): value is object & Record<Key, unknown> => Object.prototype.hasOwnProperty.call(value, key)

const getStoredGitCommitModels = (value: unknown): AppGitCommitModels => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, model]) =>
        (key === appGitLegacyCommitModelKey || (key.includes('\0') && key.length <= 1024)) &&
        (model === null || isStoredModel(model))
    )
  ) as AppGitCommitModels
}

const getStoredForcedDropdown = <TValue extends string>(
  value: unknown,
  isValue: (candidate: unknown) => candidate is TValue
): typeof appChatManualDropdownValue | TValue =>
  value === appChatManualDropdownValue || isValue(value) ? value : appChatManualDropdownValue

const getStoredActionId = (value: unknown, actions: AppAction[]): string | null =>
  typeof value === 'string' && actions.some((action) => action.id === value) ? value : null

const getStoredRecentChatCacheLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultAppSettings.chat.recentChatCacheLimit
  }

  return Math.min(Math.max(Math.floor(value), 0), 50)
}

const getStoredChatBoolean = (
  chat: Record<string, unknown>,
  key:
    | keyof AppChatThoughtSettings
    | 'enableActions'
    | 'enableNotesButton'
    | 'hidePlans'
    | 'updateExistingChats'
    | 'updateNewChats'
): boolean => (typeof chat[key] === 'boolean' ? chat[key] : defaultAppSettings.chat[key])

const getStoredPerformanceBoolean = (
  performance: Record<string, unknown>,
  key: 'disableShadows'
): boolean =>
  typeof performance[key] === 'boolean' ? performance[key] : defaultAppSettings.performance[key]

const getStoredMaxChatsRendered = (value: unknown): number => normalizeAppMaxChatsRendered(value)

const getStoredRecentsMessageLimit = (value: unknown): number =>
  normalizeAppRecentsMessageLimit(value)

const getStoredRecentlyOpenedFilesLimit = (value: unknown): number =>
  normalizeAppRecentlyOpenedFilesLimit(value)

const readProjectAppearanceOverrides = (
  appearance: Record<string, unknown>
): Partial<AppSettings['appearance']> => {
  const overrides: Partial<AppSettings['appearance']> = {}

  if (hasOwnProperty(appearance, 'theme') && isAppThemePreference(appearance.theme)) {
    overrides.theme = appearance.theme
  }
  if (
    hasOwnProperty(appearance, 'zoomLevel') &&
    typeof appearance.zoomLevel === 'number' &&
    Number.isFinite(appearance.zoomLevel)
  ) {
    overrides.zoomLevel = normalizeAppAppearanceZoomLevel(appearance.zoomLevel)
  }
  if (
    hasOwnProperty(appearance, 'position') &&
    isAppAppearancePositionPreference(appearance.position)
  ) {
    overrides.position = appearance.position
  }
  if (hasOwnProperty(appearance, 'style') && isAppAppearanceStylePreference(appearance.style)) {
    overrides.style = appearance.style
  }
  if (
    hasOwnProperty(appearance, 'controlStyle') &&
    isAppAppearanceControlStylePreference(appearance.controlStyle)
  ) {
    overrides.controlStyle = appearance.controlStyle
  }
  for (const key of ['applicationFont', 'chatFont', 'codeFont'] as const) {
    if (hasOwnProperty(appearance, key)) {
      overrides[key] = getStoredFontSetting(appearance[key], defaultAppSettings.appearance[key])
    }
  }

  return overrides
}

const readProjectChatOverrides = (chat: Record<string, unknown>): Partial<AppSettings['chat']> => {
  const overrides: Partial<AppSettings['chat']> = {}

  if (hasOwnProperty(chat, 'continuePrompt') && typeof chat.continuePrompt === 'string') {
    overrides.continuePrompt = chat.continuePrompt
  }
  if (hasOwnProperty(chat, 'recentChatCacheLimit')) {
    overrides.recentChatCacheLimit = getStoredRecentChatCacheLimit(chat.recentChatCacheLimit)
  }
  if (hasOwnProperty(chat, 'displayUsage') && isAppChatUsageDisplay(chat.displayUsage)) {
    overrides.displayUsage = chat.displayUsage
  }

  const booleanKeys = [
    'hidePlans',
    'enableActions',
    'enableNotesButton',
    'updateExistingChats',
    'updateNewChats',
    'expandThoughtsOnStart',
    'collapseThoughtsOnFinish',
    'collapseThoughtsOnNextTurn',
    'expandStoppedTurns',
    'collapseStoppedOnNextTurn'
  ] satisfies readonly (keyof AppSettings['chat'])[]

  for (const key of booleanKeys) {
    if (hasOwnProperty(chat, key) && typeof chat[key] === 'boolean') {
      overrides[key] = chat[key]
    }
  }

  if (hasOwnProperty(chat, 'forceAccess')) {
    overrides.forceAccess = getStoredForcedDropdown(chat.forceAccess, isProviderSandboxMode)
  }
  if (hasOwnProperty(chat, 'forceReview')) {
    overrides.forceReview = getStoredForcedDropdown(chat.forceReview, isProviderApprovalMode)
  }
  if (hasOwnProperty(chat, 'forceModel')) {
    overrides.forceModel = getStoredForcedDropdown(chat.forceModel, isStoredModel)
  }
  if (hasOwnProperty(chat, 'forceReasoning')) {
    overrides.forceReasoning = getStoredForcedDropdown(chat.forceReasoning, isStoredReasoningEffort)
  }
  if (hasOwnProperty(chat, 'forceSpeed')) {
    overrides.forceSpeed = getStoredForcedDropdown(chat.forceSpeed, isProviderServiceTier)
  }

  return overrides
}

const readProjectLinkOverrides = (
  links: Record<string, unknown>
): Partial<AppExternalLinkSettings> => {
  const overrides: Partial<AppExternalLinkSettings> = {}

  if (hasOwnProperty(links, 'behavior') && isAppExternalLinkBehavior(links.behavior)) {
    overrides.behavior = links.behavior
  }

  return overrides
}

const readProjectBrowserOverrides = (
  browser: Record<string, unknown>
): Partial<AppBrowserSettings> => {
  const overrides: Partial<AppBrowserSettings> = {}

  if (hasOwnProperty(browser, 'enabled') && typeof browser.enabled === 'boolean') {
    overrides.enabled = browser.enabled
  }
  if (hasOwnProperty(browser, 'defaultScale') && typeof browser.defaultScale === 'number') {
    overrides.defaultScale = normalizeAppBrowserDefaultScale(browser.defaultScale)
  }
  if (hasOwnProperty(browser, 'view') && isAppBrowserView(browser.view)) {
    overrides.view = browser.view
  }

  return overrides
}

const readProjectPerformanceOverrides = (
  performance: Record<string, unknown>
): Partial<AppPerformanceSettings> => {
  const overrides: Partial<AppPerformanceSettings> = {}

  if (
    hasOwnProperty(performance, 'disableShadows') &&
    typeof performance.disableShadows === 'boolean'
  ) {
    overrides.disableShadows = performance.disableShadows
  }
  if (hasOwnProperty(performance, 'maxChatsRendered')) {
    overrides.maxChatsRendered = getStoredMaxChatsRendered(performance.maxChatsRendered)
  }
  if (hasOwnProperty(performance, 'recentsMessageLimit')) {
    overrides.recentsMessageLimit = getStoredRecentsMessageLimit(performance.recentsMessageLimit)
  }
  if (hasOwnProperty(performance, 'recentlyOpenedFilesLimit')) {
    overrides.recentlyOpenedFilesLimit = getStoredRecentlyOpenedFilesLimit(
      performance.recentlyOpenedFilesLimit
    )
  }

  return overrides
}

const readProjectGitOverrides = (
  git: Record<string, unknown>
): AppProjectSettingsOverrides['git'] => {
  const overrides: NonNullable<AppProjectSettingsOverrides['git']> = {}

  if (hasOwnProperty(git, 'commitModels')) {
    const commitModels = getStoredGitCommitModels(git.commitModels)
    if (Object.keys(commitModels).length > 0) overrides.commitModels = commitModels
  } else if (hasOwnProperty(git, 'commitModel')) {
    if (git.commitModel == null || isStoredModel(git.commitModel)) {
      overrides.commitModels = { [appGitLegacyCommitModelKey]: git.commitModel ?? null }
    }
  }
  if (hasOwnProperty(git, 'untrackedFilesPrompt') && typeof git.untrackedFilesPrompt === 'string') {
    overrides.untrackedFilesPrompt = git.untrackedFilesPrompt
  }
  if (
    hasOwnProperty(git, 'errorResolutionPrompt') &&
    typeof git.errorResolutionPrompt === 'string'
  ) {
    overrides.errorResolutionPrompt = git.errorResolutionPrompt
  }
  if (
    hasOwnProperty(git, 'permanentErrorResolutionPrompt') &&
    typeof git.permanentErrorResolutionPrompt === 'string'
  ) {
    overrides.permanentErrorResolutionPrompt = git.permanentErrorResolutionPrompt
  }

  const quickActions =
    git.quickActions && typeof git.quickActions === 'object' && !Array.isArray(git.quickActions)
      ? (git.quickActions as Record<string, unknown>)
      : {}
  const storedQuickActions: Partial<AppGitQuickActionsSettings> = {}
  if (
    hasOwnProperty(quickActions, 'showManualCommit') &&
    typeof quickActions.showManualCommit === 'boolean'
  ) {
    storedQuickActions.showManualCommit = quickActions.showManualCommit
  }
  if (
    hasOwnProperty(quickActions, 'showAiInstructionsInput') &&
    typeof quickActions.showAiInstructionsInput === 'boolean'
  ) {
    storedQuickActions.showAiInstructionsInput = quickActions.showAiInstructionsInput
  }
  if (Object.keys(storedQuickActions).length > 0) {
    overrides.quickActions = storedQuickActions
  }

  const commitPrompt =
    git.commitPrompt && typeof git.commitPrompt === 'object' && !Array.isArray(git.commitPrompt)
      ? (git.commitPrompt as Record<string, unknown>)
      : {}
  const storedCommitPrompt: Partial<AppGitCommitPromptSettings> = {}
  for (const key of Object.keys(
    defaultAppGitCommitPromptSettings
  ) as (keyof AppGitCommitPromptSettings)[]) {
    if (hasOwnProperty(commitPrompt, key) && typeof commitPrompt[key] === 'string') {
      storedCommitPrompt[key] = commitPrompt[key]
    }
  }
  if (Object.keys(storedCommitPrompt).length > 0) {
    overrides.commitPrompt = storedCommitPrompt
  }

  const commitMessageGeneration =
    git.commitMessageGeneration &&
    typeof git.commitMessageGeneration === 'object' &&
    !Array.isArray(git.commitMessageGeneration)
      ? (git.commitMessageGeneration as Record<string, unknown>)
      : {}
  const storedCommitMessageGeneration: Partial<AppGitCommitMessageGenerationSettings> = {}
  for (const key of Object.keys(
    defaultAppGitCommitMessageGenerationSettings
  ) as (keyof AppGitCommitMessageGenerationSettings)[]) {
    if (
      hasOwnProperty(commitMessageGeneration, key) &&
      typeof commitMessageGeneration[key] === 'string'
    ) {
      storedCommitMessageGeneration[key] = commitMessageGeneration[key]
    }
  }
  if (Object.keys(storedCommitMessageGeneration).length > 0) {
    overrides.commitMessageGeneration = storedCommitMessageGeneration
  }

  const worktree =
    git.worktree && typeof git.worktree === 'object' && !Array.isArray(git.worktree)
      ? (git.worktree as Record<string, unknown>)
      : {}
  const storedWorktree: Partial<AppGitWorktreeSettings> = {}
  for (const key of Object.keys(
    defaultAppGitWorktreeSettings
  ) as (keyof AppGitWorktreeSettings)[]) {
    if (hasOwnProperty(worktree, key) && typeof worktree[key] === 'string') {
      storedWorktree[key] = worktree[key]
    }
  }
  if (Object.keys(storedWorktree).length > 0) {
    overrides.worktree = storedWorktree
  }

  return overrides
}

const readPromptField = (
  storedPrompt: Record<string, unknown>,
  key: keyof AppGitCommitPromptSettings
): string => {
  const storedValue = storedPrompt[key]
  if (typeof storedValue !== 'string') return defaultAppGitCommitPromptSettings[key]

  if (legacyDefaultGitCommitPromptSettings[key]?.has(storedValue)) {
    return defaultAppGitCommitPromptSettings[key]
  }

  return storedValue
}

const readCommitMessageGenerationField = (
  storedSettings: Record<string, unknown>,
  key: keyof AppGitCommitMessageGenerationSettings
): string => {
  const storedValue = storedSettings[key]
  return typeof storedValue === 'string'
    ? storedValue
    : defaultAppGitCommitMessageGenerationSettings[key]
}

const readWorktreeField = (
  storedSettings: Record<string, unknown>,
  key: keyof AppGitWorktreeSettings
): string => {
  const storedValue = storedSettings[key]
  return typeof storedValue === 'string' ? storedValue : defaultAppGitWorktreeSettings[key]
}

const pruneAppProjectSettingsOverrides = (
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsOverrides => {
  const prunedOverrides: AppProjectSettingsOverrides = {}

  if (overrides.appearance && Object.keys(overrides.appearance).length > 0) {
    prunedOverrides.appearance = { ...overrides.appearance }
  }
  if (overrides.chat && Object.keys(overrides.chat).length > 0) {
    prunedOverrides.chat = { ...overrides.chat }
  }
  if (overrides.links && Object.keys(overrides.links).length > 0) {
    prunedOverrides.links = { ...overrides.links }
  }
  if (overrides.browser && Object.keys(overrides.browser).length > 0) {
    prunedOverrides.browser = { ...overrides.browser }
  }
  if (overrides.performance && Object.keys(overrides.performance).length > 0) {
    prunedOverrides.performance = { ...overrides.performance }
  }

  if (overrides.git) {
    const gitOverrides: NonNullable<AppProjectSettingsOverrides['git']> = {}

    if (overrides.git.commitModels && Object.keys(overrides.git.commitModels).length > 0) {
      gitOverrides.commitModels = { ...overrides.git.commitModels }
    }
    if (hasOwnProperty(overrides.git, 'untrackedFilesPrompt')) {
      gitOverrides.untrackedFilesPrompt = overrides.git.untrackedFilesPrompt
    }
    if (hasOwnProperty(overrides.git, 'errorResolutionPrompt')) {
      gitOverrides.errorResolutionPrompt = overrides.git.errorResolutionPrompt
    }
    if (hasOwnProperty(overrides.git, 'permanentErrorResolutionPrompt')) {
      gitOverrides.permanentErrorResolutionPrompt = overrides.git.permanentErrorResolutionPrompt
    }
    if (overrides.git.quickActions && Object.keys(overrides.git.quickActions).length > 0) {
      gitOverrides.quickActions = { ...overrides.git.quickActions }
    }
    if (overrides.git.commitPrompt && Object.keys(overrides.git.commitPrompt).length > 0) {
      gitOverrides.commitPrompt = { ...overrides.git.commitPrompt }
    }
    if (
      overrides.git.commitMessageGeneration &&
      Object.keys(overrides.git.commitMessageGeneration).length > 0
    ) {
      gitOverrides.commitMessageGeneration = { ...overrides.git.commitMessageGeneration }
    }
    if (overrides.git.worktree && Object.keys(overrides.git.worktree).length > 0) {
      gitOverrides.worktree = { ...overrides.git.worktree }
    }

    if (Object.keys(gitOverrides).length > 0) {
      prunedOverrides.git = gitOverrides
    }
  }

  return prunedOverrides
}

export const isAppProjectSettingsOverridesEmpty = (
  overrides: AppProjectSettingsOverrides | null | undefined
): boolean => !overrides || Object.keys(pruneAppProjectSettingsOverrides(overrides)).length === 0

export const normalizeAppProjectSettingsCwd = (cwd: string | null | undefined): string | null => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? normalizedCwd : null
}

export const resolveAppSettings = (
  settings: AppSettings,
  overrides: AppProjectSettingsOverrides | null | undefined
): AppSettings => {
  if (isAppProjectSettingsOverridesEmpty(overrides)) return settings

  const gitOverrides = overrides?.git
  const projectCommitModels = gitOverrides?.commitModels
  const commitModels =
    projectCommitModels && hasOwnProperty(projectCommitModels, appGitLegacyCommitModelKey)
      ? { ...projectCommitModels }
      : {
          ...settings.git.commitModels,
          ...projectCommitModels
        }
  const untrackedFilesPrompt =
    gitOverrides && hasOwnProperty(gitOverrides, 'untrackedFilesPrompt')
      ? (gitOverrides.untrackedFilesPrompt ?? settings.git.untrackedFilesPrompt)
      : settings.git.untrackedFilesPrompt
  const errorResolutionPrompt =
    gitOverrides && hasOwnProperty(gitOverrides, 'errorResolutionPrompt')
      ? (gitOverrides.errorResolutionPrompt ?? settings.git.errorResolutionPrompt)
      : settings.git.errorResolutionPrompt
  const permanentErrorResolutionPrompt =
    gitOverrides && hasOwnProperty(gitOverrides, 'permanentErrorResolutionPrompt')
      ? (gitOverrides.permanentErrorResolutionPrompt ?? settings.git.permanentErrorResolutionPrompt)
      : settings.git.permanentErrorResolutionPrompt

  return {
    ...settings,
    appearance: {
      ...settings.appearance,
      ...overrides?.appearance
    },
    chat: {
      ...settings.chat,
      ...overrides?.chat
    },
    browser: {
      ...settings.browser,
      ...overrides?.browser
    },
    links: {
      ...settings.links,
      ...overrides?.links
    },
    performance: {
      ...settings.performance,
      ...overrides?.performance
    },
    git: {
      ...settings.git,
      commitModels,
      errorResolutionPrompt,
      permanentErrorResolutionPrompt,
      untrackedFilesPrompt,
      quickActions: {
        ...settings.git.quickActions,
        ...gitOverrides?.quickActions
      },
      commitPrompt: {
        ...settings.git.commitPrompt,
        ...gitOverrides?.commitPrompt
      },
      commitMessageGeneration: {
        ...settings.git.commitMessageGeneration,
        ...gitOverrides?.commitMessageGeneration
      },
      worktree: {
        ...settings.git.worktree,
        ...gitOverrides?.worktree
      }
    }
  }
}

export const readStoredAppSettings = (): AppSettings => {
  try {
    const storedValue = window.localStorage.getItem(appSettingsStorageKey)
    if (!storedValue) return defaultAppSettings

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return defaultAppSettings
    }

    const appearance =
      parsedValue.appearance &&
      typeof parsedValue.appearance === 'object' &&
      !Array.isArray(parsedValue.appearance)
        ? (parsedValue.appearance as Record<string, unknown>)
        : {}
    const chat =
      parsedValue.chat && typeof parsedValue.chat === 'object' && !Array.isArray(parsedValue.chat)
        ? (parsedValue.chat as Record<string, unknown>)
        : {}
    const links =
      parsedValue.links &&
      typeof parsedValue.links === 'object' &&
      !Array.isArray(parsedValue.links)
        ? (parsedValue.links as Record<string, unknown>)
        : {}
    const browser =
      parsedValue.browser &&
      typeof parsedValue.browser === 'object' &&
      !Array.isArray(parsedValue.browser)
        ? (parsedValue.browser as Record<string, unknown>)
        : {}
    const performance =
      parsedValue.performance &&
      typeof parsedValue.performance === 'object' &&
      !Array.isArray(parsedValue.performance)
        ? (parsedValue.performance as Record<string, unknown>)
        : {}
    const git =
      parsedValue.git && typeof parsedValue.git === 'object' && !Array.isArray(parsedValue.git)
        ? (parsedValue.git as Record<string, unknown>)
        : {}
    const commitPrompt =
      git.commitPrompt && typeof git.commitPrompt === 'object' && !Array.isArray(git.commitPrompt)
        ? (git.commitPrompt as Record<string, unknown>)
        : {}
    const commitMessageGeneration =
      git.commitMessageGeneration &&
      typeof git.commitMessageGeneration === 'object' &&
      !Array.isArray(git.commitMessageGeneration)
        ? (git.commitMessageGeneration as Record<string, unknown>)
        : {}
    const quickActions =
      git.quickActions && typeof git.quickActions === 'object' && !Array.isArray(git.quickActions)
        ? (git.quickActions as Record<string, unknown>)
        : {}
    const worktree =
      git.worktree && typeof git.worktree === 'object' && !Array.isArray(git.worktree)
        ? (git.worktree as Record<string, unknown>)
        : {}

    const actions = normalizeAppActions(parsedValue.actions)

    return {
      actions,
      lastActionId: getStoredActionId(parsedValue.lastActionId, actions),
      appearance: {
        theme: isAppThemePreference(appearance.theme)
          ? appearance.theme
          : defaultAppSettings.appearance.theme,
        zoomLevel: normalizeAppAppearanceZoomLevel(appearance.zoomLevel),
        position: isAppAppearancePositionPreference(appearance.position)
          ? appearance.position
          : defaultAppSettings.appearance.position,
        style: isAppAppearanceStylePreference(appearance.style)
          ? appearance.style
          : defaultAppSettings.appearance.style,
        controlStyle: isAppAppearanceControlStylePreference(appearance.controlStyle)
          ? appearance.controlStyle
          : defaultAppSettings.appearance.controlStyle,
        applicationFont: getStoredFontSetting(
          appearance.applicationFont,
          defaultAppSettings.appearance.applicationFont
        ),
        chatFont: getStoredFontSetting(appearance.chatFont, defaultAppSettings.appearance.chatFont),
        codeFont: getStoredFontSetting(appearance.codeFont, defaultAppSettings.appearance.codeFont)
      },
      chat: {
        continuePrompt:
          typeof chat.continuePrompt === 'string'
            ? chat.continuePrompt
            : defaultAppSettings.chat.continuePrompt,
        recentChatCacheLimit: getStoredRecentChatCacheLimit(chat.recentChatCacheLimit),
        displayUsage: isAppChatUsageDisplay(chat.displayUsage)
          ? chat.displayUsage
          : defaultAppSettings.chat.displayUsage,
        hidePlans: getStoredChatBoolean(chat, 'hidePlans'),
        enableActions: getStoredChatBoolean(chat, 'enableActions'),
        enableNotesButton: getStoredChatBoolean(chat, 'enableNotesButton'),
        updateExistingChats: getStoredChatBoolean(chat, 'updateExistingChats'),
        updateNewChats: getStoredChatBoolean(chat, 'updateNewChats'),
        forceAccess: getStoredForcedDropdown(chat.forceAccess, isProviderSandboxMode),
        forceReview: getStoredForcedDropdown(chat.forceReview, isProviderApprovalMode),
        forceModel: getStoredForcedDropdown(chat.forceModel, isStoredModel),
        forceReasoning: getStoredForcedDropdown(chat.forceReasoning, isStoredReasoningEffort),
        forceSpeed: getStoredForcedDropdown(chat.forceSpeed, isProviderServiceTier),
        expandThoughtsOnStart: getStoredChatBoolean(chat, 'expandThoughtsOnStart'),
        collapseThoughtsOnFinish: getStoredChatBoolean(chat, 'collapseThoughtsOnFinish'),
        collapseThoughtsOnNextTurn: getStoredChatBoolean(chat, 'collapseThoughtsOnNextTurn'),
        expandStoppedTurns: getStoredChatBoolean(chat, 'expandStoppedTurns'),
        collapseStoppedOnNextTurn: getStoredChatBoolean(chat, 'collapseStoppedOnNextTurn')
      },
      links: {
        behavior: isAppExternalLinkBehavior(links.behavior)
          ? links.behavior
          : links.always === true && isAppExternalLinkAction(links.action)
            ? links.action
            : isAppExternalLinkAction(appearance.externalLinks)
              ? appearance.externalLinks
              : defaultAppSettings.links.behavior
      },
      browser: {
        defaultScale: normalizeAppBrowserDefaultScale(browser.defaultScale),
        enabled:
          typeof browser.enabled === 'boolean'
            ? browser.enabled
            : defaultAppSettings.browser.enabled,
        view: isAppBrowserView(browser.view) ? browser.view : defaultAppSettings.browser.view
      },
      performance: {
        disableShadows: getStoredPerformanceBoolean(performance, 'disableShadows'),
        maxChatsRendered: getStoredMaxChatsRendered(performance.maxChatsRendered),
        recentlyOpenedFilesLimit: getStoredRecentlyOpenedFilesLimit(
          performance.recentlyOpenedFilesLimit
        ),
        recentsMessageLimit: getStoredRecentsMessageLimit(performance.recentsMessageLimit)
      },
      git: {
        commitModels: hasOwnProperty(git, 'commitModels')
          ? getStoredGitCommitModels(git.commitModels)
          : hasOwnProperty(git, 'commitModel') && isStoredModel(git.commitModel)
            ? { [appGitLegacyCommitModelKey]: git.commitModel }
            : defaultAppSettings.git.commitModels,
        errorResolutionPrompt:
          typeof git.errorResolutionPrompt === 'string'
            ? git.errorResolutionPrompt
            : defaultAppSettings.git.errorResolutionPrompt,
        permanentErrorResolutionPrompt:
          typeof git.permanentErrorResolutionPrompt === 'string'
            ? git.permanentErrorResolutionPrompt
            : defaultAppSettings.git.permanentErrorResolutionPrompt,
        untrackedFilesPrompt:
          typeof git.untrackedFilesPrompt === 'string'
            ? git.untrackedFilesPrompt
            : defaultAppSettings.git.untrackedFilesPrompt,
        quickActions: {
          showManualCommit:
            typeof quickActions.showManualCommit === 'boolean'
              ? quickActions.showManualCommit
              : defaultAppSettings.git.quickActions.showManualCommit,
          showAiInstructionsInput:
            typeof quickActions.showAiInstructionsInput === 'boolean'
              ? quickActions.showAiInstructionsInput
              : defaultAppSettings.git.quickActions.showAiInstructionsInput
        },
        commitPrompt: {
          instructions: readPromptField(commitPrompt, 'instructions'),
          workflow: readPromptField(commitPrompt, 'workflow'),
          commitStep: readPromptField(commitPrompt, 'commitStep'),
          amendStep: readPromptField(commitPrompt, 'amendStep'),
          extraInstructionsPrefix: readPromptField(commitPrompt, 'extraInstructionsPrefix')
        },
        commitMessageGeneration: {
          prompt: readCommitMessageGenerationField(commitMessageGeneration, 'prompt'),
          largeChangePrompt: readCommitMessageGenerationField(
            commitMessageGeneration,
            'largeChangePrompt'
          ),
          aiInstructionsPrefix: readCommitMessageGenerationField(
            commitMessageGeneration,
            'aiInstructionsPrefix'
          )
        },
        worktree: {
          branchNamePrompt: readWorktreeField(worktree, 'branchNamePrompt')
        }
      }
    }
  } catch {
    return defaultAppSettings
  }
}

const readStoredAppProjectSettingsOverride = (
  value: unknown
): AppProjectSettingsOverrides | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const storedOverrides = value as Record<string, unknown>
  const overrides: AppProjectSettingsOverrides = {}

  const appearance =
    storedOverrides.appearance &&
    typeof storedOverrides.appearance === 'object' &&
    !Array.isArray(storedOverrides.appearance)
      ? readProjectAppearanceOverrides(storedOverrides.appearance as Record<string, unknown>)
      : null
  if (appearance && Object.keys(appearance).length > 0) overrides.appearance = appearance

  const chat =
    storedOverrides.chat &&
    typeof storedOverrides.chat === 'object' &&
    !Array.isArray(storedOverrides.chat)
      ? readProjectChatOverrides(storedOverrides.chat as Record<string, unknown>)
      : null
  if (chat && Object.keys(chat).length > 0) overrides.chat = chat

  const links =
    storedOverrides.links &&
    typeof storedOverrides.links === 'object' &&
    !Array.isArray(storedOverrides.links)
      ? readProjectLinkOverrides(storedOverrides.links as Record<string, unknown>)
      : null
  if (links && Object.keys(links).length > 0) overrides.links = links

  const browser =
    storedOverrides.browser &&
    typeof storedOverrides.browser === 'object' &&
    !Array.isArray(storedOverrides.browser)
      ? readProjectBrowserOverrides(storedOverrides.browser as Record<string, unknown>)
      : null
  if (browser && Object.keys(browser).length > 0) overrides.browser = browser

  const performance =
    storedOverrides.performance &&
    typeof storedOverrides.performance === 'object' &&
    !Array.isArray(storedOverrides.performance)
      ? readProjectPerformanceOverrides(storedOverrides.performance as Record<string, unknown>)
      : null
  if (performance && Object.keys(performance).length > 0) overrides.performance = performance

  const git =
    storedOverrides.git &&
    typeof storedOverrides.git === 'object' &&
    !Array.isArray(storedOverrides.git)
      ? readProjectGitOverrides(storedOverrides.git as Record<string, unknown>)
      : null
  if (git && Object.keys(git).length > 0) overrides.git = git

  return isAppProjectSettingsOverridesEmpty(overrides) ? null : overrides
}

export const readStoredAppProjectSettings = (): AppProjectSettingsByCwd => {
  try {
    const storedValue = window.localStorage.getItem(appProjectSettingsStorageKey)
    if (!storedValue) return {}

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {}

    const projectSettings: AppProjectSettingsByCwd = {}
    for (const [cwd, storedOverrides] of Object.entries(parsedValue)) {
      const normalizedCwd = normalizeAppProjectSettingsCwd(cwd)
      if (!normalizedCwd) continue

      const overrides = readStoredAppProjectSettingsOverride(storedOverrides)
      if (overrides) projectSettings[normalizedCwd] = overrides
    }

    return projectSettings
  } catch {
    return {}
  }
}

export const writeStoredAppProjectSettings = (projectSettings: AppProjectSettingsByCwd): void => {
  try {
    const storedProjectSettings: AppProjectSettingsByCwd = {}

    for (const [cwd, overrides] of Object.entries(projectSettings)) {
      const normalizedCwd = normalizeAppProjectSettingsCwd(cwd)
      if (!normalizedCwd) continue

      const prunedOverrides = pruneAppProjectSettingsOverrides(overrides)
      if (!isAppProjectSettingsOverridesEmpty(prunedOverrides)) {
        storedProjectSettings[normalizedCwd] = prunedOverrides
      }
    }

    if (Object.keys(storedProjectSettings).length === 0) {
      window.localStorage.removeItem(appProjectSettingsStorageKey)
      return
    }

    window.localStorage.setItem(appProjectSettingsStorageKey, JSON.stringify(storedProjectSettings))
  } catch {
    // App settings are non-critical; ignore unavailable storage.
  }
}

export const writeStoredAppSettings = (settings: AppSettings): void => {
  try {
    const storedSettings: {
      actions?: AppAction[]
      lastActionId?: string
      appearance?: Partial<AppSettings['appearance']>
      chat?: Partial<AppSettings['chat']>
      browser?: Partial<AppBrowserSettings>
      links?: Partial<AppExternalLinkSettings>
      performance?: Partial<AppPerformanceSettings>
      git?: {
        commitModels?: AppGitCommitModels
        errorResolutionPrompt?: string
        permanentErrorResolutionPrompt?: string
        untrackedFilesPrompt?: string
        quickActions?: Partial<AppGitQuickActionsSettings>
        commitPrompt?: Partial<AppGitCommitPromptSettings>
        commitMessageGeneration?: Partial<AppGitCommitMessageGenerationSettings>
        worktree?: Partial<AppGitWorktreeSettings>
      }
    } = {}

    if (settings.actions.length > 0) {
      storedSettings.actions = normalizeAppActions(settings.actions)
    }
    const storedLastActionId = getStoredActionId(settings.lastActionId, settings.actions)
    if (storedLastActionId) {
      storedSettings.lastActionId = storedLastActionId
    }

    const storedAppearance: Partial<AppSettings['appearance']> = {}
    if (settings.appearance.theme !== defaultAppSettings.appearance.theme) {
      storedAppearance.theme = settings.appearance.theme
    }
    const zoomLevel = normalizeAppAppearanceZoomLevel(settings.appearance.zoomLevel)
    if (zoomLevel !== defaultAppSettings.appearance.zoomLevel) {
      storedAppearance.zoomLevel = zoomLevel
    }
    if (settings.appearance.position !== defaultAppSettings.appearance.position) {
      storedAppearance.position = settings.appearance.position
    }
    if (settings.appearance.style !== defaultAppSettings.appearance.style) {
      storedAppearance.style = settings.appearance.style
    }
    if (settings.appearance.controlStyle !== defaultAppSettings.appearance.controlStyle) {
      storedAppearance.controlStyle = settings.appearance.controlStyle
    }
    for (const key of ['applicationFont', 'chatFont', 'codeFont'] as const) {
      const font = settings.appearance[key]
      const defaultFont = defaultAppSettings.appearance[key]
      if (font.family !== defaultFont.family || font.size !== defaultFont.size) {
        storedAppearance[key] = {
          family: getStoredFontFamily(font.family, defaultFont.family),
          size: normalizeAppFontSize(font.size, defaultFont.size)
        }
      }
    }
    if (Object.keys(storedAppearance).length > 0) storedSettings.appearance = storedAppearance

    const storedChat: Partial<AppSettings['chat']> = {}
    if (settings.chat.continuePrompt !== defaultAppSettings.chat.continuePrompt) {
      storedChat.continuePrompt = settings.chat.continuePrompt
    }
    if (settings.chat.recentChatCacheLimit !== defaultAppSettings.chat.recentChatCacheLimit) {
      storedChat.recentChatCacheLimit = settings.chat.recentChatCacheLimit
    }
    if (settings.chat.displayUsage !== defaultAppSettings.chat.displayUsage) {
      storedChat.displayUsage = settings.chat.displayUsage
    }
    if (settings.chat.hidePlans !== defaultAppSettings.chat.hidePlans) {
      storedChat.hidePlans = settings.chat.hidePlans
    }
    if (settings.chat.enableActions !== defaultAppSettings.chat.enableActions) {
      storedChat.enableActions = settings.chat.enableActions
    }
    if (settings.chat.enableNotesButton !== defaultAppSettings.chat.enableNotesButton) {
      storedChat.enableNotesButton = settings.chat.enableNotesButton
    }
    if (settings.chat.updateExistingChats !== defaultAppSettings.chat.updateExistingChats) {
      storedChat.updateExistingChats = settings.chat.updateExistingChats
    }
    if (settings.chat.updateNewChats !== defaultAppSettings.chat.updateNewChats) {
      storedChat.updateNewChats = settings.chat.updateNewChats
    }
    if (settings.chat.forceAccess !== defaultAppSettings.chat.forceAccess) {
      storedChat.forceAccess = settings.chat.forceAccess
    }
    if (settings.chat.forceReview !== defaultAppSettings.chat.forceReview) {
      storedChat.forceReview = settings.chat.forceReview
    }
    if (settings.chat.forceModel !== defaultAppSettings.chat.forceModel) {
      storedChat.forceModel = settings.chat.forceModel
    }
    if (settings.chat.forceReasoning !== defaultAppSettings.chat.forceReasoning) {
      storedChat.forceReasoning = settings.chat.forceReasoning
    }
    if (settings.chat.forceSpeed !== defaultAppSettings.chat.forceSpeed) {
      storedChat.forceSpeed = settings.chat.forceSpeed
    }
    if (settings.chat.expandThoughtsOnStart !== defaultAppSettings.chat.expandThoughtsOnStart) {
      storedChat.expandThoughtsOnStart = settings.chat.expandThoughtsOnStart
    }
    if (
      settings.chat.collapseThoughtsOnFinish !== defaultAppSettings.chat.collapseThoughtsOnFinish
    ) {
      storedChat.collapseThoughtsOnFinish = settings.chat.collapseThoughtsOnFinish
    }
    if (
      settings.chat.collapseThoughtsOnNextTurn !==
      defaultAppSettings.chat.collapseThoughtsOnNextTurn
    ) {
      storedChat.collapseThoughtsOnNextTurn = settings.chat.collapseThoughtsOnNextTurn
    }
    if (settings.chat.expandStoppedTurns !== defaultAppSettings.chat.expandStoppedTurns) {
      storedChat.expandStoppedTurns = settings.chat.expandStoppedTurns
    }
    if (
      settings.chat.collapseStoppedOnNextTurn !== defaultAppSettings.chat.collapseStoppedOnNextTurn
    ) {
      storedChat.collapseStoppedOnNextTurn = settings.chat.collapseStoppedOnNextTurn
    }
    if (Object.keys(storedChat).length > 0) storedSettings.chat = storedChat

    const storedBrowser: Partial<AppBrowserSettings> = {}
    const defaultScale = normalizeAppBrowserDefaultScale(settings.browser.defaultScale)
    if (defaultScale !== defaultAppSettings.browser.defaultScale) {
      storedBrowser.defaultScale = defaultScale
    }
    if (settings.browser.enabled !== defaultAppSettings.browser.enabled) {
      storedBrowser.enabled = settings.browser.enabled
    }
    if (settings.browser.view !== defaultAppSettings.browser.view) {
      storedBrowser.view = settings.browser.view
    }
    if (Object.keys(storedBrowser).length > 0) storedSettings.browser = storedBrowser

    const storedLinks: Partial<AppExternalLinkSettings> = {}
    if (settings.links.behavior !== defaultAppSettings.links.behavior) {
      storedLinks.behavior = settings.links.behavior
    }
    if (Object.keys(storedLinks).length > 0) storedSettings.links = storedLinks

    const storedPerformance: Partial<AppPerformanceSettings> = {}
    if (settings.performance.disableShadows !== defaultAppSettings.performance.disableShadows) {
      storedPerformance.disableShadows = settings.performance.disableShadows
    }
    if (settings.performance.maxChatsRendered !== defaultAppSettings.performance.maxChatsRendered) {
      storedPerformance.maxChatsRendered = getStoredMaxChatsRendered(
        settings.performance.maxChatsRendered
      )
    }
    if (
      settings.performance.recentsMessageLimit !==
      defaultAppSettings.performance.recentsMessageLimit
    ) {
      storedPerformance.recentsMessageLimit = getStoredRecentsMessageLimit(
        settings.performance.recentsMessageLimit
      )
    }
    if (
      settings.performance.recentlyOpenedFilesLimit !==
      defaultAppSettings.performance.recentlyOpenedFilesLimit
    ) {
      storedPerformance.recentlyOpenedFilesLimit = getStoredRecentlyOpenedFilesLimit(
        settings.performance.recentlyOpenedFilesLimit
      )
    }
    if (Object.keys(storedPerformance).length > 0) {
      storedSettings.performance = storedPerformance
    }

    const storedGit: {
      commitModels?: AppGitCommitModels
      errorResolutionPrompt?: string
      permanentErrorResolutionPrompt?: string
      untrackedFilesPrompt?: string
      quickActions?: Partial<AppGitQuickActionsSettings>
      commitPrompt?: Partial<AppGitCommitPromptSettings>
      commitMessageGeneration?: Partial<AppGitCommitMessageGenerationSettings>
      worktree?: Partial<AppGitWorktreeSettings>
    } = {}
    if (Object.keys(settings.git.commitModels).length > 0) {
      storedGit.commitModels = getStoredGitCommitModels(settings.git.commitModels)
    }
    if (settings.git.errorResolutionPrompt !== defaultAppSettings.git.errorResolutionPrompt) {
      storedGit.errorResolutionPrompt = settings.git.errorResolutionPrompt
    }
    if (
      settings.git.permanentErrorResolutionPrompt !==
      defaultAppSettings.git.permanentErrorResolutionPrompt
    ) {
      storedGit.permanentErrorResolutionPrompt = settings.git.permanentErrorResolutionPrompt
    }
    if (settings.git.untrackedFilesPrompt !== defaultAppSettings.git.untrackedFilesPrompt) {
      storedGit.untrackedFilesPrompt = settings.git.untrackedFilesPrompt
    }

    const storedQuickActions: Partial<AppGitQuickActionsSettings> = {}
    for (const key of Object.keys(
      defaultAppGitQuickActionsSettings
    ) as (keyof AppGitQuickActionsSettings)[]) {
      if (settings.git.quickActions[key] !== defaultAppGitQuickActionsSettings[key]) {
        Object.assign(storedQuickActions, { [key]: settings.git.quickActions[key] })
      }
    }
    if (Object.keys(storedQuickActions).length > 0) {
      storedGit.quickActions = storedQuickActions
    }

    const storedCommitPrompt: Partial<AppGitCommitPromptSettings> = {}
    for (const key of Object.keys(
      defaultAppGitCommitPromptSettings
    ) as (keyof AppGitCommitPromptSettings)[]) {
      if (settings.git.commitPrompt[key] !== defaultAppGitCommitPromptSettings[key]) {
        storedCommitPrompt[key] = settings.git.commitPrompt[key]
      }
    }
    if (Object.keys(storedCommitPrompt).length > 0) {
      storedGit.commitPrompt = storedCommitPrompt
    }

    const storedCommitMessageGeneration: Partial<AppGitCommitMessageGenerationSettings> = {}
    for (const key of Object.keys(
      defaultAppGitCommitMessageGenerationSettings
    ) as (keyof AppGitCommitMessageGenerationSettings)[]) {
      if (
        settings.git.commitMessageGeneration[key] !==
        defaultAppGitCommitMessageGenerationSettings[key]
      ) {
        storedCommitMessageGeneration[key] = settings.git.commitMessageGeneration[key]
      }
    }
    if (Object.keys(storedCommitMessageGeneration).length > 0) {
      storedGit.commitMessageGeneration = storedCommitMessageGeneration
    }

    const storedWorktree: Partial<AppGitWorktreeSettings> = {}
    for (const key of Object.keys(
      defaultAppGitWorktreeSettings
    ) as (keyof AppGitWorktreeSettings)[]) {
      if (settings.git.worktree[key] !== defaultAppGitWorktreeSettings[key]) {
        storedWorktree[key] = settings.git.worktree[key]
      }
    }
    if (Object.keys(storedWorktree).length > 0) {
      storedGit.worktree = storedWorktree
    }
    if (Object.keys(storedGit).length > 0) storedSettings.git = storedGit

    if (Object.keys(storedSettings).length === 0) {
      window.localStorage.removeItem(appSettingsStorageKey)
      return
    }

    window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(storedSettings))
  } catch {
    // App settings are non-critical; ignore unavailable storage.
  }
}
