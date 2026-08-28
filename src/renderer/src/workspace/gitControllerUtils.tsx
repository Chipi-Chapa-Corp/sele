import { GitBranch, GitMerge, GitPullRequestArrow, Upload } from 'lucide-react'

import type { AppGitPullStrategy, AppGitRecoveryActionId } from '../../../shared/app'

import type { ProviderChatDetail } from '../../../shared/provider'

import {
  type AppAppearancePositionPreference,
  type AppAppearanceStylePreference,
  type AppSettings
} from '../settings'

import { getGitAiResolutionPrompt } from '../gitErrorResolution'

import { providerLabels, type ProviderUpdateSuggestion } from '../providerSettings'

import { GitRefreshIcon } from '../components/AppStatusStates'

import { type GitSyncRecoveryState } from './controllerTypes'

export const getGitRecoveryPullStrategy = (
  actionId: AppGitRecoveryActionId
): AppGitPullStrategy | null => {
  if (actionId === 'pull-rebase') return 'rebase'
  if (actionId === 'pull-merge') return 'merge'

  return null
}

export const getGitRecoveryActionIcon = (actionId: AppGitRecoveryActionId): React.ReactNode => {
  if (actionId === 'pull-rebase') return <GitPullRequestArrow aria-hidden="true" />
  if (actionId === 'pull-merge') return <GitMerge aria-hidden="true" />
  if (actionId === 'set-upstream') return <GitBranch aria-hidden="true" />
  if (actionId === 'push-current-branch' || actionId === 'push-upstream-branch') {
    return <Upload aria-hidden="true" />
  }

  return <GitRefreshIcon />
}

export const getGitRecoveryRememberLabel = (actionId: AppGitRecoveryActionId): string | null => {
  if (actionId === 'pull-rebase') return 'Remember rebase'
  if (actionId === 'pull-merge') return 'Remember merge'

  return null
}

export const getGitRecoveryAiResolutionPrompt = (
  recovery: GitSyncRecoveryState,
  promptTemplate: string
): string =>
  getGitAiResolutionPrompt(
    {
      cwd: recovery.cwd,
      operation: recovery.failure.command,
      error: recovery.error ?? recovery.failure.error
    },
    promptTemplate
  )

export const applyShadowPreference = (disableShadows: boolean): void => {
  const root = document.documentElement

  if (disableShadows) {
    root.dataset.disableShadows = 'true'
  } else {
    delete root.dataset.disableShadows
  }
}

export const getEffectiveAppearancePosition = (
  preference: AppAppearancePositionPreference
): Exclude<AppAppearancePositionPreference, 'system'> => {
  if (preference !== 'system') return preference

  return document.documentElement.dataset.platform === 'darwin' ? 'left' : 'right'
}

export const getEffectiveAppearanceStyle = (
  preference: AppAppearanceStylePreference
): Exclude<AppAppearanceStylePreference, 'system'> => {
  if (preference !== 'system') return preference

  return document.documentElement.dataset.platform === 'darwin' ? 'macos' : 'sele'
}

export const applyWindowControlAppearancePreferences = (
  appearance: AppSettings['appearance']
): void => {
  const root = document.documentElement

  root.dataset.windowControlPosition = getEffectiveAppearancePosition(appearance.position)
  root.dataset.windowControlStyle = getEffectiveAppearanceStyle(appearance.style)
  root.dataset.controlStyle = appearance.controlStyle
}

export const getFileTreeEmptyMessage = (cwd: string | null): string =>
  cwd ? 'No files found.' : 'Choose a folder to see files.'

export const getApprovalSummary = (
  approval: NonNullable<ProviderChatDetail['pendingApproval']>
): string => {
  if (approval.command) return approval.command
  if (approval.reason) return approval.reason
  if (approval.cwd) return approval.cwd

  return approval.type === 'fileChange'
    ? 'File changes require approval'
    : 'Command requires approval'
}

export const getProviderUpdateSummary = (suggestion: ProviderUpdateSuggestion): string =>
  `Update ${providerLabels[suggestion.providerId]} from ${suggestion.currentVersion} to ${
    suggestion.latestVersion
  }`

export const isAppActionShortcutTargetBlocked = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false

  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], .terminal-panel, .browser-panel'
    )
  )
}
