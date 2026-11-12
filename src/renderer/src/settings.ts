import { defaultLinkedChatSummaryPrompt } from './linkedChats.ts'
import { preferences as preferenceStorage } from './preferences.ts'
import {
  defaultNetworkRetrySettings,
  normalizeNetworkRetryCount,
  normalizeNetworkRetryDelaySeconds
} from '../../shared/networkRetry'
import type {
  ProviderActiveSendMode,
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
export type AppChatUsageDisplay = {
  context: boolean
  short: boolean
  long: boolean
}

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

export type AppChatProgressSettings = {
  expandProgressOnStart: boolean
  collapseProgressOnFinish: boolean
  collapseProgressOnNextTurn: boolean
  collapseStoppedSteeredFailedProgressOnFinish: boolean
  collapseStoppedSteeredFailedProgressOnNextTurn: boolean
}

export const appChatManualDropdownValue = 'manual'
export const appChatStandardSpeedValue = 'standard'

export type AppChatDropdownSelectionAction = 'stay' | 'back' | 'close'

export const isAppChatDropdownSelectionAction = (
  value: unknown
): value is AppChatDropdownSelectionAction =>
  value === 'stay' || value === 'back' || value === 'close'

export type AppChatDropdownSettings = {
  defaultActiveAction: Extract<ProviderActiveSendMode, 'queue' | 'steer'>
  selectionAction: AppChatDropdownSelectionAction
  forceAccess: typeof appChatManualDropdownValue | ProviderSandboxMode
  forceReview: typeof appChatManualDropdownValue | ProviderApprovalMode
  forceModel: typeof appChatManualDropdownValue | ProviderModelId
  forceReasoning: typeof appChatManualDropdownValue | ProviderReasoningEffort
  forceSpeed:
    | typeof appChatManualDropdownValue
    | typeof appChatStandardSpeedValue
    | ProviderServiceTier
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

export type AppCodexProviderSettings = {
  showRecommendedPlugins: boolean
  nativeChrome: boolean
}

export const appAppearanceZoomLevelDefault = appWindowZoomLevelDefault
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
  chat: AppChatProgressSettings & {
    continuePrompt: string
    /** Summary request for linked chats whose provider has no readable native compaction. */
    linkedChatSummaryPrompt: string
    continueOnUsageReset: boolean
    networkRetryCount: number
    networkRetryDelaySeconds: number
    recentChatCacheLimit: number
    displayUsage: AppChatUsageDisplay
    promptSuggestions: boolean
    hidePlans: boolean
    presets: boolean
    enableActions: boolean
    enableNotesButton: boolean
    updateExistingChats: boolean
    updateNewChats: boolean
  } & AppChatDropdownSettings
  browser: AppBrowserSettings
  links: AppExternalLinkSettings
  performance: AppPerformanceSettings
  providers: {
    codex: AppCodexProviderSettings
    claude: { nativeChrome: boolean }
  }
  git: {
    enablePullRequests: boolean
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
    enablePullRequests?: boolean
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

export const defaultAppChatProgressSettings: AppChatProgressSettings = {
  expandProgressOnStart: true,
  collapseProgressOnFinish: true,
  collapseProgressOnNextTurn: false,
  collapseStoppedSteeredFailedProgressOnFinish: true,
  collapseStoppedSteeredFailedProgressOnNextTurn: false
}

export const defaultAppChatDropdownSettings: AppChatDropdownSettings = {
  defaultActiveAction: 'queue',
  selectionAction: 'back',
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
    linkedChatSummaryPrompt: defaultLinkedChatSummaryPrompt,
    continueOnUsageReset: true,
    networkRetryCount: defaultNetworkRetrySettings.count,
    networkRetryDelaySeconds: defaultNetworkRetrySettings.delaySeconds,
    recentChatCacheLimit: 10,
    displayUsage: { context: false, short: true, long: true },
    promptSuggestions: true,
    hidePlans: false,
    enableActions: true,
    enableNotesButton: true,
    updateExistingChats: false,
    updateNewChats: true,
    ...defaultAppChatDropdownSettings,
    presets: true,
    ...defaultAppChatProgressSettings
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
  providers: {
    codex: {
      showRecommendedPlugins: false,
      nativeChrome: false
    },
    claude: { nativeChrome: false }
  },
  git: {
    enablePullRequests: false,
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

type StoredRecord = Record<string, unknown>
type StoredReader<Value> = (value: unknown) => Value | undefined
type StoredReaders<Group> = { [Key in keyof Group]-?: StoredReader<Group[Key]> }

const readStoredRecord = (value: unknown): StoredRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as StoredRecord) : {}

const readStoredWhen =
  <Value>(isValue: (value: unknown) => value is Value): StoredReader<Value> =>
  (value) =>
    isValue(value) ? value : undefined

const readStoredBoolean = readStoredWhen((value): value is boolean => typeof value === 'boolean')
const readStoredString = readStoredWhen((value): value is string => typeof value === 'string')

const readStoredStrings = <Group extends Record<string, string>>(
  defaults: Group
): StoredReaders<Group> =>
  Object.fromEntries(
    Object.keys(defaults).map((key) => [key, readStoredString])
  ) as StoredReaders<Group>

const readStoredChatUsageDisplay: StoredReader<AppChatUsageDisplay> = (value) => {
  if (value === 'global' || value === 'short') return { context: false, short: true, long: true }
  if (value === 'chatContext') return { context: true, short: false, long: false }
  if (value === 'weekly') return { context: false, short: false, long: true }
  if (!value || typeof value !== 'object') return undefined
  const display = value as StoredRecord
  return {
    context: typeof display.context === 'boolean' ? display.context : false,
    short: typeof display.short === 'boolean' ? display.short : true,
    long: typeof display.long === 'boolean' ? display.long : true
  }
}

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

const readStoredFontSetting =
  (fallback: AppFontSetting): StoredReader<AppFontSetting> =>
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback

    const setting = value as StoredRecord
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

const readStoredGitCommitModels: StoredReader<AppGitCommitModels> = (value) => {
  const commitModels = Object.fromEntries(
    Object.entries(readStoredRecord(value)).filter(
      ([key, model]) =>
        (key === appGitLegacyCommitModelKey || (key.includes('\0') && key.length <= 1024)) &&
        (model === null || isStoredModel(model))
    )
  ) as AppGitCommitModels
  return Object.keys(commitModels).length > 0 ? commitModels : undefined
}

const readStoredForcedDropdown =
  <TValue extends string>(
    isValue: (candidate: unknown) => candidate is TValue
  ): StoredReader<typeof appChatManualDropdownValue | TValue> =>
  (value) =>
    value === appChatManualDropdownValue || isValue(value) ? value : appChatManualDropdownValue

const getStoredActionId = (value: unknown, actions: AppAction[]): string | null =>
  typeof value === 'string' && actions.some((action) => action.id === value) ? value : null

const appearanceReaders: StoredReaders<AppSettings['appearance']> = {
  theme: readStoredWhen(isAppThemePreference),
  zoomLevel: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? normalizeAppAppearanceZoomLevel(value)
      : undefined,
  position: readStoredWhen(isAppAppearancePositionPreference),
  style: readStoredWhen(isAppAppearanceStylePreference),
  controlStyle: readStoredWhen(isAppAppearanceControlStylePreference),
  applicationFont: readStoredFontSetting(defaultAppAppearanceSettings.applicationFont),
  chatFont: readStoredFontSetting(defaultAppAppearanceSettings.chatFont),
  codeFont: readStoredFontSetting(defaultAppAppearanceSettings.codeFont)
}

const chatReaders: StoredReaders<AppSettings['chat']> = {
  continueOnUsageReset: readStoredBoolean,
  networkRetryCount: normalizeNetworkRetryCount,
  networkRetryDelaySeconds: normalizeNetworkRetryDelaySeconds,
  continuePrompt: readStoredString,
  linkedChatSummaryPrompt: readStoredString,
  recentChatCacheLimit: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(Math.floor(value), 0), 50)
      : defaultAppSettings.chat.recentChatCacheLimit,
  displayUsage: readStoredChatUsageDisplay,
  promptSuggestions: readStoredBoolean,
  presets: readStoredBoolean,
  selectionAction: readStoredWhen(isAppChatDropdownSelectionAction),
  defaultActiveAction: readStoredWhen(
    (value): value is AppChatDropdownSettings['defaultActiveAction'] =>
      value === 'queue' || value === 'steer'
  ),
  hidePlans: readStoredBoolean,
  enableActions: readStoredBoolean,
  enableNotesButton: readStoredBoolean,
  updateExistingChats: readStoredBoolean,
  updateNewChats: readStoredBoolean,
  forceAccess: readStoredForcedDropdown(isProviderSandboxMode),
  forceReview: readStoredForcedDropdown(isProviderApprovalMode),
  forceModel: readStoredForcedDropdown(isStoredModel),
  forceReasoning: readStoredForcedDropdown(isStoredReasoningEffort),
  forceSpeed: readStoredForcedDropdown(isProviderServiceTier),
  expandProgressOnStart: readStoredBoolean,
  collapseProgressOnFinish: readStoredBoolean,
  collapseProgressOnNextTurn: readStoredBoolean,
  collapseStoppedSteeredFailedProgressOnFinish: readStoredBoolean,
  collapseStoppedSteeredFailedProgressOnNextTurn: readStoredBoolean
}

const legacyChatProgressKeys = [
  ['expandProgressOnStart', 'expandThoughtsOnStart'],
  ['collapseProgressOnFinish', 'collapseThoughtsOnFinish'],
  ['collapseProgressOnNextTurn', 'collapseThoughtsOnNextTurn'],
  ['collapseStoppedSteeredFailedProgressOnNextTurn', 'collapseStoppedOnNextTurn']
] as const

const readLegacyChatProgress = (chat: StoredRecord): Partial<AppChatProgressSettings> => {
  const progress: Partial<AppChatProgressSettings> = {}
  for (const [key, legacyKey] of legacyChatProgressKeys) {
    const legacyValue = chat[legacyKey]
    if (typeof chat[key] !== 'boolean' && typeof legacyValue === 'boolean') {
      progress[key] = legacyValue
    }
  }
  return progress
}

const browserReaders: StoredReaders<AppBrowserSettings> = {
  defaultScale: (value) =>
    typeof value === 'number' ? normalizeAppBrowserDefaultScale(value) : undefined,
  enabled: readStoredBoolean,
  view: readStoredWhen(isAppBrowserView)
}

const linkReaders: StoredReaders<AppExternalLinkSettings> = {
  behavior: readStoredWhen(isAppExternalLinkBehavior)
}

const performanceReaders: StoredReaders<AppPerformanceSettings> = {
  disableShadows: readStoredBoolean,
  maxChatsRendered: normalizeAppMaxChatsRendered,
  recentsMessageLimit: normalizeAppRecentsMessageLimit,
  recentlyOpenedFilesLimit: normalizeAppRecentlyOpenedFilesLimit
}

const codexProviderReaders: StoredReaders<AppCodexProviderSettings> = {
  showRecommendedPlugins: readStoredBoolean,
  nativeChrome: readStoredBoolean
}

const gitReaders: StoredReaders<
  Pick<
    AppSettings['git'],
    | 'enablePullRequests'
    | 'commitModels'
    | 'errorResolutionPrompt'
    | 'permanentErrorResolutionPrompt'
    | 'untrackedFilesPrompt'
  >
> = {
  enablePullRequests: readStoredBoolean,
  commitModels: readStoredGitCommitModels,
  errorResolutionPrompt: readStoredString,
  permanentErrorResolutionPrompt: readStoredString,
  untrackedFilesPrompt: readStoredString
}

const gitQuickActionReaders: StoredReaders<AppGitQuickActionsSettings> = {
  showManualCommit: readStoredBoolean,
  showAiInstructionsInput: readStoredBoolean
}
const gitCommitPromptReaders = readStoredStrings(defaultAppGitCommitPromptSettings)
const gitCommitMessageGenerationReaders = readStoredStrings(
  defaultAppGitCommitMessageGenerationSettings
)
const gitWorktreeReaders = readStoredStrings(defaultAppGitWorktreeSettings)

const storedKeys = <Group>(readers: StoredReaders<Group>): (keyof Group & string)[] =>
  Object.keys(readers) as (keyof Group & string)[]

const readStoredGroup = <Group>(
  value: unknown,
  readers: StoredReaders<Group>,
  defaults: NoInfer<Group>
): Group => {
  const stored = readStoredRecord(value)
  return Object.fromEntries(
    storedKeys(readers).map((key) => [key, readers[key](stored[key]) ?? defaults[key]])
  ) as Group
}

const readStoredOverrides = <Group>(
  value: unknown,
  readers: StoredReaders<Group>
): Partial<Group> => {
  const stored = readStoredRecord(value)
  const overrides: Partial<Group> = {}
  for (const key of storedKeys(readers)) {
    const override = hasOwnProperty(stored, key) ? readers[key](stored[key]) : undefined
    if (override !== undefined) overrides[key] = override
  }
  return overrides
}

const getStoredChanges = <Group>(
  group: NoInfer<Group>,
  readers: StoredReaders<Group>,
  defaults: NoInfer<Group>
): Partial<Group> => {
  const changes: Partial<Group> = {}
  for (const key of storedKeys(readers)) {
    const value = readers[key](group[key])
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(defaults[key])) {
      changes[key] = value
    }
  }
  return changes
}

const appGroupKeys = ['appearance', 'chat', 'browser', 'links', 'performance', 'providers', 'git']
const gitGroupKeys = [
  'commitModels',
  'quickActions',
  'commitPrompt',
  'commitMessageGeneration',
  'worktree'
]

const omitEmptyGroups = <Value extends object>(
  value: Value,
  groupKeys: readonly string[]
): Partial<Value> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, group]) => !groupKeys.includes(key) || (group && Object.keys(group).length > 0)
    )
  ) as Partial<Value>

const readPromptField = (
  storedPrompt: StoredRecord,
  key: keyof AppGitCommitPromptSettings
): string => {
  const storedValue = storedPrompt[key]
  if (typeof storedValue !== 'string') return defaultAppGitCommitPromptSettings[key]

  if (legacyDefaultGitCommitPromptSettings[key]?.has(storedValue)) {
    return defaultAppGitCommitPromptSettings[key]
  }

  return storedValue
}

const pruneAppProjectSettingsOverrides = (
  overrides: AppProjectSettingsOverrides
): AppProjectSettingsOverrides =>
  omitEmptyGroups(
    { ...overrides, git: overrides.git && omitEmptyGroups(overrides.git, gitGroupKeys) },
    appGroupKeys
  )

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
  if (!overrides || isAppProjectSettingsOverridesEmpty(overrides)) return settings

  const gitOverrides = overrides.git
  const projectCommitModels = gitOverrides?.commitModels
  const commitModels =
    projectCommitModels && hasOwnProperty(projectCommitModels, appGitLegacyCommitModelKey)
      ? { ...projectCommitModels }
      : {
          ...settings.git.commitModels,
          ...projectCommitModels
        }

  return {
    ...settings,
    appearance: {
      ...settings.appearance,
      ...overrides.appearance
    },
    chat: {
      ...settings.chat,
      ...overrides.chat
    },
    browser: {
      ...settings.browser,
      ...overrides.browser
    },
    links: {
      ...settings.links,
      ...overrides.links
    },
    performance: {
      ...settings.performance,
      ...overrides.performance
    },
    git: {
      ...settings.git,
      enablePullRequests: gitOverrides?.enablePullRequests ?? settings.git.enablePullRequests,
      commitModels,
      errorResolutionPrompt:
        gitOverrides?.errorResolutionPrompt ?? settings.git.errorResolutionPrompt,
      permanentErrorResolutionPrompt:
        gitOverrides?.permanentErrorResolutionPrompt ?? settings.git.permanentErrorResolutionPrompt,
      untrackedFilesPrompt: gitOverrides?.untrackedFilesPrompt ?? settings.git.untrackedFilesPrompt,
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
    const storedValue = preferenceStorage.getItem(appSettingsStorageKey)
    if (!storedValue) return defaultAppSettings

    const parsedValue = JSON.parse(storedValue) as StoredRecord | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return defaultAppSettings
    }

    const appearance = readStoredRecord(parsedValue.appearance)
    const chat = readStoredRecord(parsedValue.chat)
    const links = readStoredRecord(parsedValue.links)
    const providers = readStoredRecord(parsedValue.providers)
    const git = readStoredRecord(parsedValue.git)
    const commitPrompt = readStoredRecord(git.commitPrompt)
    const actions = normalizeAppActions(parsedValue.actions)

    return {
      actions,
      lastActionId: getStoredActionId(parsedValue.lastActionId, actions),
      appearance: readStoredGroup(appearance, appearanceReaders, defaultAppSettings.appearance),
      chat: {
        ...readStoredGroup(chat, chatReaders, defaultAppSettings.chat),
        ...readLegacyChatProgress(chat)
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
      browser: readStoredGroup(parsedValue.browser, browserReaders, defaultAppSettings.browser),
      performance: readStoredGroup(
        parsedValue.performance,
        performanceReaders,
        defaultAppSettings.performance
      ),
      providers: {
        codex: readStoredGroup(
          providers.codex,
          codexProviderReaders,
          defaultAppSettings.providers.codex
        ),
        claude: { nativeChrome: readStoredRecord(providers.claude).nativeChrome === true }
      },
      git: {
        ...readStoredGroup(git, gitReaders, defaultAppSettings.git),
        ...(!hasOwnProperty(git, 'commitModels') &&
          isStoredModel(git.commitModel) && {
            commitModels: { [appGitLegacyCommitModelKey]: git.commitModel }
          }),
        quickActions: readStoredGroup(
          git.quickActions,
          gitQuickActionReaders,
          defaultAppGitQuickActionsSettings
        ),
        commitPrompt: {
          instructions: readPromptField(commitPrompt, 'instructions'),
          workflow: readPromptField(commitPrompt, 'workflow'),
          commitStep: readPromptField(commitPrompt, 'commitStep'),
          amendStep: readPromptField(commitPrompt, 'amendStep'),
          extraInstructionsPrefix: readPromptField(commitPrompt, 'extraInstructionsPrefix')
        },
        commitMessageGeneration: readStoredGroup(
          git.commitMessageGeneration,
          gitCommitMessageGenerationReaders,
          defaultAppGitCommitMessageGenerationSettings
        ),
        worktree: readStoredGroup(git.worktree, gitWorktreeReaders, defaultAppGitWorktreeSettings)
      }
    }
  } catch (error) {
    console.error('[caught:settings:readStoredAppSettings]', error)
    return defaultAppSettings
  }
}

const readStoredAppProjectSettingsOverride = (
  value: unknown
): AppProjectSettingsOverrides | null => {
  const stored = readStoredRecord(value)
  const chat = readStoredRecord(stored.chat)
  const git = readStoredRecord(stored.git)
  const overrides = pruneAppProjectSettingsOverrides({
    appearance: readStoredOverrides(stored.appearance, appearanceReaders),
    chat: { ...readStoredOverrides(chat, chatReaders), ...readLegacyChatProgress(chat) },
    links: readStoredOverrides(stored.links, linkReaders),
    browser: readStoredOverrides(stored.browser, browserReaders),
    performance: readStoredOverrides(stored.performance, performanceReaders),
    git: {
      ...readStoredOverrides(git, gitReaders),
      ...(!hasOwnProperty(git, 'commitModels') &&
        (git.commitModel === null || isStoredModel(git.commitModel)) && {
          commitModels: { [appGitLegacyCommitModelKey]: git.commitModel }
        }),
      quickActions: readStoredOverrides(git.quickActions, gitQuickActionReaders),
      commitPrompt: readStoredOverrides(git.commitPrompt, gitCommitPromptReaders),
      commitMessageGeneration: readStoredOverrides(
        git.commitMessageGeneration,
        gitCommitMessageGenerationReaders
      ),
      worktree: readStoredOverrides(git.worktree, gitWorktreeReaders)
    }
  })

  return Object.keys(overrides).length > 0 ? overrides : null
}

export const readStoredAppProjectSettings = (): AppProjectSettingsByCwd => {
  try {
    const storedValue = preferenceStorage.getItem(appProjectSettingsStorageKey)
    if (!storedValue) return {}

    const projectSettings: AppProjectSettingsByCwd = {}
    for (const [cwd, storedOverrides] of Object.entries(
      readStoredRecord(JSON.parse(storedValue))
    )) {
      const normalizedCwd = normalizeAppProjectSettingsCwd(cwd)
      if (!normalizedCwd) continue

      const overrides = readStoredAppProjectSettingsOverride(storedOverrides)
      if (overrides) projectSettings[normalizedCwd] = overrides
    }

    return projectSettings
  } catch (error) {
    console.error('[caught:settings:readStoredAppProjectSettings]', error)
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
      if (Object.keys(prunedOverrides).length > 0) {
        storedProjectSettings[normalizedCwd] = prunedOverrides
      }
    }

    if (Object.keys(storedProjectSettings).length === 0) {
      preferenceStorage.removeItem(appProjectSettingsStorageKey)
      return
    }

    preferenceStorage.setItem(appProjectSettingsStorageKey, JSON.stringify(storedProjectSettings))
  } catch (error) {
    console.error('[caught:settings:writeStoredAppProjectSettings]', error)
    // App settings are non-critical; ignore unavailable storage.
  }
}

export const writeStoredAppSettings = (settings: AppSettings): void => {
  try {
    const lastActionId = getStoredActionId(settings.lastActionId, settings.actions)
    const { appearance, chat, browser, links, performance, providers, git } = settings
    const storedSettings = omitEmptyGroups(
      {
        ...(settings.actions.length > 0 && { actions: normalizeAppActions(settings.actions) }),
        ...(lastActionId && { lastActionId }),
        appearance: getStoredChanges(appearance, appearanceReaders, defaultAppSettings.appearance),
        chat: getStoredChanges(chat, chatReaders, defaultAppSettings.chat),
        browser: getStoredChanges(browser, browserReaders, defaultAppSettings.browser),
        links: getStoredChanges(links, linkReaders, defaultAppSettings.links),
        performance: getStoredChanges(
          performance,
          performanceReaders,
          defaultAppSettings.performance
        ),
        providers:
          providers.codex.showRecommendedPlugins !==
            defaultAppSettings.providers.codex.showRecommendedPlugins ||
          providers.codex.nativeChrome ||
          providers.claude.nativeChrome
            ? {
                codex: {
                  showRecommendedPlugins: providers.codex.showRecommendedPlugins,
                  nativeChrome: providers.codex.nativeChrome
                },
                claude: { nativeChrome: providers.claude.nativeChrome }
              }
            : {},
        git: omitEmptyGroups(
          {
            ...getStoredChanges(git, gitReaders, defaultAppSettings.git),
            quickActions: getStoredChanges(
              git.quickActions,
              gitQuickActionReaders,
              defaultAppGitQuickActionsSettings
            ),
            commitPrompt: getStoredChanges(
              git.commitPrompt,
              gitCommitPromptReaders,
              defaultAppGitCommitPromptSettings
            ),
            commitMessageGeneration: getStoredChanges(
              git.commitMessageGeneration,
              gitCommitMessageGenerationReaders,
              defaultAppGitCommitMessageGenerationSettings
            ),
            worktree: getStoredChanges(
              git.worktree,
              gitWorktreeReaders,
              defaultAppGitWorktreeSettings
            )
          },
          gitGroupKeys
        )
      },
      appGroupKeys
    )

    if (Object.keys(storedSettings).length === 0) {
      preferenceStorage.removeItem(appSettingsStorageKey)
      return
    }

    preferenceStorage.setItem(appSettingsStorageKey, JSON.stringify(storedSettings))
  } catch (error) {
    console.error('[caught:settings:writeStoredAppSettings]', error)
    // App settings are non-critical; ignore unavailable storage.
  }
}
