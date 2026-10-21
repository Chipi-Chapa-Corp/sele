import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import type { ProviderPermissionOptions } from '../../../shared/provider'

const getMutationAction = (options?: ProviderPermissionOptions): 'allow' | 'ask' =>
  options?.sandboxMode === 'danger-full-access' || options?.approvalPolicy === 'never'
    ? 'allow'
    : 'ask'

export const getOpenCodePermissionRules = (
  options?: ProviderPermissionOptions,
  browserEnabled = false
): PermissionRuleset => {
  const sandboxMode = options?.sandboxMode ?? 'workspace-write'
  const mutationAction = sandboxMode === 'read-only' ? 'deny' : getMutationAction(options)
  const externalAction =
    sandboxMode === 'danger-full-access'
      ? getMutationAction(options)
      : options?.approvalPolicy === 'never'
        ? 'deny'
        : 'ask'
  const defaultAction = mutationAction
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
      action: getMutationAction(options)
    },
    { permission: 'question', pattern: '*', action: 'allow' },
    {
      permission: 'sele_browser_*',
      pattern: '*',
      action: browserEnabled && sandboxMode !== 'read-only' ? getMutationAction(options) : 'deny'
    }
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
