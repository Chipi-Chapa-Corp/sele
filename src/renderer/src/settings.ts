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
import type { AppExternalLinkAction } from '../../shared/app'
import type { AppAction } from './actions'
import { normalizeAppActions } from './actions'

export type AppThemePreference = 'system' | 'light' | 'dark'
export type AppChatUsageDisplay = 'chatContext' | 'global'

export type AppGitCommitPromptSettings = {
  instructions: string
  workflow: string
  commitStep: string
  amendStep: string
  extraInstructionsPrefix: string
}

export type AppGitCommitMessageGenerationSettings = {
  prompt: string
  aiInstructionsPrefix: string
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
}

export type AppExternalLinkBehavior = 'manual' | AppExternalLinkAction

export type AppExternalLinkSettings = {
  behavior: AppExternalLinkBehavior
}

export type AppSettings = {
  actions: AppAction[]
  lastActionId: string | null
  appearance: {
    theme: AppThemePreference
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
  links: AppExternalLinkSettings
  performance: AppPerformanceSettings
  git: {
    commitModel: ProviderModelId | null
    commitPrompt: AppGitCommitPromptSettings
    commitMessageGeneration: AppGitCommitMessageGenerationSettings
  }
}

export const appSettingsStorageKey = 'sele:app-settings:v1'

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
  disableShadows: false
}

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
    'Generate a concise Git commit name for the supplied diff.',
    'Match the style and conventions of the recent commit names.',
    'Return only one single-line commit name, with no quotes, Markdown, or explanation.'
  ].join('\n'),
  aiInstructionsPrefix: 'AI instructions:'
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

export const defaultAppSettings: AppSettings = {
  actions: [],
  lastActionId: null,
  appearance: {
    theme: 'system'
  },
  chat: {
    continuePrompt: defaultStoppedTurnContinuePrompt,
    recentChatCacheLimit: 10,
    displayUsage: 'chatContext',
    hidePlans: false,
    enableActions: true,
    enableNotesButton: true,
    updateExistingChats: true,
    updateNewChats: true,
    ...defaultAppChatDropdownSettings,
    ...defaultAppChatThoughtSettings
  },
  links: {
    behavior: 'manual'
  },
  performance: defaultAppPerformanceSettings,
  git: {
    commitModel: null,
    commitPrompt: defaultAppGitCommitPromptSettings,
    commitMessageGeneration: defaultAppGitCommitMessageGenerationSettings
  }
}

export const isAppThemePreference = (value: unknown): value is AppThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

const isAppExternalLinkAction = (value: unknown): value is AppExternalLinkAction =>
  value === 'copy' || value === 'open'

const isAppExternalLinkBehavior = (value: unknown): value is AppExternalLinkBehavior =>
  value === 'manual' || isAppExternalLinkAction(value)

const isAppChatUsageDisplay = (value: unknown): value is AppChatUsageDisplay =>
  value === 'chatContext' || value === 'global'

const isStoredModel = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

const isStoredReasoningEffort = (value: unknown): value is ProviderReasoningEffort =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 64

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
  key: keyof AppPerformanceSettings
): boolean =>
  typeof performance[key] === 'boolean' ? performance[key] : defaultAppSettings.performance[key]

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

    const actions = normalizeAppActions(parsedValue.actions)

    return {
      actions,
      lastActionId: getStoredActionId(parsedValue.lastActionId, actions),
      appearance: {
        theme: isAppThemePreference(appearance.theme)
          ? appearance.theme
          : defaultAppSettings.appearance.theme
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
      performance: {
        disableShadows: getStoredPerformanceBoolean(performance, 'disableShadows')
      },
      git: {
        commitModel:
          git.commitModel == null
            ? defaultAppSettings.git.commitModel
            : isStoredModel(git.commitModel)
              ? git.commitModel
              : defaultAppSettings.git.commitModel,
        commitPrompt: {
          instructions: readPromptField(commitPrompt, 'instructions'),
          workflow: readPromptField(commitPrompt, 'workflow'),
          commitStep: readPromptField(commitPrompt, 'commitStep'),
          amendStep: readPromptField(commitPrompt, 'amendStep'),
          extraInstructionsPrefix: readPromptField(commitPrompt, 'extraInstructionsPrefix')
        },
        commitMessageGeneration: {
          prompt: readCommitMessageGenerationField(commitMessageGeneration, 'prompt'),
          aiInstructionsPrefix: readCommitMessageGenerationField(
            commitMessageGeneration,
            'aiInstructionsPrefix'
          )
        }
      }
    }
  } catch {
    return defaultAppSettings
  }
}

export const writeStoredAppSettings = (settings: AppSettings): void => {
  try {
    const storedSettings: {
      actions?: AppAction[]
      lastActionId?: string
      appearance?: Partial<AppSettings['appearance']>
      chat?: Partial<AppSettings['chat']>
      links?: Partial<AppExternalLinkSettings>
      performance?: Partial<AppPerformanceSettings>
      git?: {
        commitModel?: ProviderModelId | null
        commitPrompt?: Partial<AppGitCommitPromptSettings>
        commitMessageGeneration?: Partial<AppGitCommitMessageGenerationSettings>
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

    const storedLinks: Partial<AppExternalLinkSettings> = {}
    if (settings.links.behavior !== defaultAppSettings.links.behavior) {
      storedLinks.behavior = settings.links.behavior
    }
    if (Object.keys(storedLinks).length > 0) storedSettings.links = storedLinks

    const storedPerformance: Partial<AppPerformanceSettings> = {}
    if (settings.performance.disableShadows !== defaultAppSettings.performance.disableShadows) {
      storedPerformance.disableShadows = settings.performance.disableShadows
    }
    if (Object.keys(storedPerformance).length > 0) {
      storedSettings.performance = storedPerformance
    }

    const storedGit: {
      commitModel?: ProviderModelId | null
      commitPrompt?: Partial<AppGitCommitPromptSettings>
      commitMessageGeneration?: Partial<AppGitCommitMessageGenerationSettings>
    } = {}
    if (settings.git.commitModel !== defaultAppSettings.git.commitModel) {
      storedGit.commitModel = settings.git.commitModel
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
