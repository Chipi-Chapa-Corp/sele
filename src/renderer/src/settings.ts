import type { ProviderModelId } from '../../shared/provider'

export type AppThemePreference = 'system' | 'light' | 'dark'

export type AppGitCommitPromptSettings = {
  instructions: string
  workflow: string
  commitStep: string
  amendStep: string
  extraInstructionsPrefix: string
}

export type AppSettings = {
  appearance: {
    theme: AppThemePreference
  }
  chat: {
    hidePlans: boolean
    updateExistingChats: boolean
    updateNewChats: boolean
  }
  git: {
    commitModel: ProviderModelId | null
    commitPrompt: AppGitCommitPromptSettings
  }
}

export const appSettingsStorageKey = 'sele:app-settings:v1'

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
  appearance: {
    theme: 'system'
  },
  chat: {
    hidePlans: false,
    updateExistingChats: true,
    updateNewChats: true
  },
  git: {
    commitModel: null,
    commitPrompt: defaultAppGitCommitPromptSettings
  }
}

export const isAppThemePreference = (value: unknown): value is AppThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

const isStoredModel = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

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
    const git =
      parsedValue.git && typeof parsedValue.git === 'object' && !Array.isArray(parsedValue.git)
        ? (parsedValue.git as Record<string, unknown>)
        : {}
    const commitPrompt =
      git.commitPrompt && typeof git.commitPrompt === 'object' && !Array.isArray(git.commitPrompt)
        ? (git.commitPrompt as Record<string, unknown>)
        : {}

    return {
      appearance: {
        theme: isAppThemePreference(appearance.theme)
          ? appearance.theme
          : defaultAppSettings.appearance.theme
      },
      chat: {
        hidePlans:
          typeof chat.hidePlans === 'boolean' ? chat.hidePlans : defaultAppSettings.chat.hidePlans,
        updateExistingChats:
          typeof chat.updateExistingChats === 'boolean'
            ? chat.updateExistingChats
            : defaultAppSettings.chat.updateExistingChats,
        updateNewChats:
          typeof chat.updateNewChats === 'boolean'
            ? chat.updateNewChats
            : defaultAppSettings.chat.updateNewChats
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
      appearance?: Partial<AppSettings['appearance']>
      chat?: Partial<AppSettings['chat']>
      git?: {
        commitModel?: ProviderModelId | null
        commitPrompt?: Partial<AppGitCommitPromptSettings>
      }
    } = {}

    if (settings.appearance.theme !== defaultAppSettings.appearance.theme) {
      storedSettings.appearance = {
        theme: settings.appearance.theme
      }
    }

    const storedChat: Partial<AppSettings['chat']> = {}
    if (settings.chat.hidePlans !== defaultAppSettings.chat.hidePlans) {
      storedChat.hidePlans = settings.chat.hidePlans
    }
    if (settings.chat.updateExistingChats !== defaultAppSettings.chat.updateExistingChats) {
      storedChat.updateExistingChats = settings.chat.updateExistingChats
    }
    if (settings.chat.updateNewChats !== defaultAppSettings.chat.updateNewChats) {
      storedChat.updateNewChats = settings.chat.updateNewChats
    }
    if (Object.keys(storedChat).length > 0) storedSettings.chat = storedChat

    const storedGit: {
      commitModel?: ProviderModelId | null
      commitPrompt?: Partial<AppGitCommitPromptSettings>
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
