import type { SDKActiveGoalMessage, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderChatGoal } from '../../../shared/provider.ts'

const clearAliases = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel'])

export const getClaudeGoalCommand = (objective: string | null): string => {
  const condition = objective?.trim()
  if (!condition) return '/goal clear'
  if (condition.length > 4000)
    throw new Error('Claude goal conditions are limited to 4,000 characters.')
  if (clearAliases.has(condition.toLowerCase()))
    throw new Error(
      'Describe a completion condition; this word is reserved for clearing Claude goals.'
    )
  return `/goal ${condition}`
}

export const mapClaudeActiveGoal = (
  sessionId: string,
  value: SDKActiveGoalMessage['value'],
  now = Date.now()
): ProviderChatGoal | null =>
  value
    ? {
        threadId: sessionId,
        objective: value.condition,
        status: 'active',
        tokenBudget: null,
        // The event supplies a baseline, not cumulative token consumption.
        tokensUsed: 0,
        timeUsedSeconds: Math.max(0, (now - value.set_at) / 1000),
        createdAt: value.set_at,
        updatedAt: now
      }
    : null

/** Native goal attachments survive resume and compaction; ordinary /goal text is not state. */
export const readClaudeHistoryGoal = (
  sessionId: string,
  entries: SessionStoreEntry[],
  now = Date.now()
): ProviderChatGoal | null | undefined => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.isSidechain || entry.teamName || entry.type !== 'attachment') continue
    const attachment = entry.attachment as Record<string, unknown> | undefined
    if (attachment?.type !== 'goal_status' || typeof attachment.condition !== 'string') continue
    // A clear sentinel also uses met:true. Do not mistake it for completed work.
    if (attachment.met === true || attachment.failed === true) return null
    const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : now
    return mapClaudeActiveGoal(
      sessionId,
      {
        condition: attachment.condition,
        iterations: 0,
        set_at: Number.isFinite(timestamp) ? timestamp : now,
        tokens_at_start: 0
      },
      now
    )
  }
  return undefined
}
