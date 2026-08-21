import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { ProviderOneShotOptions, ProviderTurnOptions } from '../../../shared/provider'

const getMutationAction = (
  options?: ProviderTurnOptions | ProviderOneShotOptions
): 'allow' | 'ask' => (options?.approvalPolicy === 'never' ? 'allow' : 'ask')

export const getOpenCodePermissionRules = (
  options?: ProviderTurnOptions | ProviderOneShotOptions
): PermissionRuleset => {
  const sandboxMode = options?.sandboxMode ?? 'workspace-write'
  const mutationAction = sandboxMode === 'read-only' ? 'deny' : getMutationAction(options)
  const externalAction =
    sandboxMode === 'danger-full-access'
      ? getMutationAction(options)
      : options?.approvalPolicy === 'never'
        ? 'deny'
        : 'ask'
  const defaultAction =
    sandboxMode === 'read-only' ? 'deny' : options?.approvalPolicy === 'never' ? 'allow' : 'ask'
  const rules: PermissionRuleset = [
    { permission: '*', pattern: '*', action: defaultAction },
    ...[
      'read',
      'glob',
      'grep',
      'list',
      'lsp',
      'skill',
      'todoread',
      'todowrite',
      'webfetch',
      'websearch',
      'codesearch'
    ].map((permission) => ({ permission, pattern: '*', action: 'allow' as const })),
    { permission: 'edit', pattern: '*', action: mutationAction },
    { permission: 'bash', pattern: '*', action: mutationAction },
    {
      permission: 'task',
      pattern: '*',
      action: sandboxMode === 'read-only' ? 'deny' : 'allow'
    },
    { permission: 'external_directory', pattern: '*', action: externalAction },
    {
      permission: 'doom_loop',
      pattern: '*',
      action: options?.approvalPolicy === 'never' ? 'allow' : 'ask'
    },
    { permission: 'question', pattern: '*', action: 'allow' }
  ]

  if (sandboxMode !== 'danger-full-access') {
    for (const directory of options?.additionalDirectories ?? []) {
      const normalized = directory.trim().replace(/[\\/]+$/, '')
      if (normalized) {
        rules.push({
          permission: 'external_directory',
          pattern: `${normalized}/**`,
          action: 'allow'
        })
      }
    }
  }

  return rules
}
