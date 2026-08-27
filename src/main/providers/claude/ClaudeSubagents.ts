import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderSubagent } from '../../../shared/provider'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

const getText = (message: unknown): string => {
  if (!isRecord(message)) return ''
  const content = message.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block): string[] =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )
    .join('\n')
    .trim()
}

const getTimestamp = (message: SessionMessage): number | null => {
  const timestamp = 'timestamp' in message ? message.timestamp : undefined
  if (typeof timestamp !== 'string') return null
  const value = Date.parse(timestamp)
  return Number.isFinite(value) ? value : null
}

export const createClaudeSubagentSummary = (
  agentId: string,
  messages: SessionMessage[]
): ProviderSubagent => {
  const extendedMessages = messages as Array<
    SessionMessage & { subagent_type?: unknown; task_description?: unknown }
  >
  const description = messages
    .filter((message) => message.type === 'user')
    .map((message) => getText(message.message))
    .find(Boolean)
  const agentType = extendedMessages
    .map((message) => getString(message.subagent_type))
    .find(Boolean)
  const taskDescription = extendedMessages
    .map((message) => getString(message.task_description))
    .find(Boolean)
  const timestamps = messages
    .map(getTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null)
  const parentId = messages
    .map((message) => message.parent_agent_id)
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)

  return {
    id: agentId,
    parentId: parentId ?? null,
    title: agentType || truncate(taskDescription || description || `Subagent ${agentId}`, 80),
    description: taskDescription || description || null,
    status: 'unknown',
    createdAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
    updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : null
  }
}
