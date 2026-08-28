export const appGitQuickActions = [
  'commit',
  'commit-push',
  'chat-commit',
  'chat-commit-push',
  'chat-amend',
  'chat-amend-push'
] as const

export type AppGitQuickAction = (typeof appGitQuickActions)[number]

export type AppGitQuickActionsSettings = {
  showManualCommit: boolean
  showAiInstructionsInput: boolean
  defaultAction: AppGitQuickAction
}

export const defaultAppGitQuickActionsSettings: AppGitQuickActionsSettings = {
  showManualCommit: true,
  showAiInstructionsInput: true,
  defaultAction: 'commit'
}

const appGitQuickActionSet = new Set<unknown>(appGitQuickActions)

export const isAppGitQuickAction = (value: unknown): value is AppGitQuickAction =>
  appGitQuickActionSet.has(value)
