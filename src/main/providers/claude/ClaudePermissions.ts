import type { PermissionMode, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderTurnOptions } from '../../../shared/provider'

export const claudeReadOnlyAllowedTools = [
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'Read',
  'Skill',
  'TodoWrite',
  'WebFetch',
  'WebSearch'
] as const

export type ClaudePermissionAction =
  | { kind: 'userQuestion' }
  | { kind: 'resolve'; result: PermissionResult }
  | { kind: 'requestApproval' }

/**
 * Keep the SDK permission callback active for every interactive query. In particular,
 * AskUserQuestion is delivered through canUseTool, while the callback itself implements the
 * no-approval policy by allowing tool requests immediately.
 */
export const getClaudePermissionMode = (
  options: ProviderTurnOptions | undefined
): PermissionMode => {
  if (options?.approvalsReviewer === 'auto_review') return 'auto'
  return 'default'
}

export const getClaudePermissionAction = (
  options: ProviderTurnOptions | undefined,
  toolName: string,
  input: Record<string, unknown>
): ClaudePermissionAction => {
  if (toolName === 'AskUserQuestion') return { kind: 'userQuestion' }
  if (
    options?.sandboxMode === 'read-only' &&
    !claudeReadOnlyAllowedTools.includes(toolName as (typeof claudeReadOnlyAllowedTools)[number])
  ) {
    return {
      kind: 'resolve',
      result: { behavior: 'deny', message: 'This chat is in read-only mode.' }
    }
  }
  if (options?.approvalPolicy === 'never') {
    return { kind: 'resolve', result: { behavior: 'allow', updatedInput: input } }
  }
  if (options?.approvalsReviewer === 'auto_review') {
    return {
      kind: 'resolve',
      result: { behavior: 'deny', message: 'Claude auto-mode could not approve this tool request.' }
    }
  }
  return { kind: 'requestApproval' }
}
