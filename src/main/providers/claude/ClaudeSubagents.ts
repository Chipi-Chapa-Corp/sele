import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderSubagent } from '../../../shared/provider'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

export type ClaudeSubagentSpawn = { description: string | null; agentType: string | null }

// Claude renamed its delegation tool from Task to Agent; transcripts contain both.
const subagentToolNames = new Set(['Agent', 'Task'])

/**
 * Maps each delegation call id to the short description and agent type it was given. Every record
 * of a subagent carries the id of that call as `parent_tool_use_id`. Root agents are spawned from
 * the main transcript, nested ones from their parent subagent's transcript.
 */
export const collectClaudeSubagentSpawns = (
  transcripts: Iterable<readonly { message?: unknown }[]>
): Map<string, ClaudeSubagentSpawn> => {
  const spawns = new Map<string, ClaudeSubagentSpawn>()
  for (const transcript of transcripts) {
    for (const record of transcript) {
      const content = isRecord(record.message) ? record.message.content : null
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          !isRecord(block) ||
          block.type !== 'tool_use' ||
          typeof block.name !== 'string' ||
          !subagentToolNames.has(block.name)
        )
          continue
        const id = getString(block.id)
        const input = isRecord(block.input) ? block.input : {}
        if (id && !spawns.has(id))
          spawns.set(id, {
            description: getString(input.description),
            agentType: getString(input.subagent_type)
          })
      }
    }
  }
  return spawns
}

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
  messages: SessionMessage[],
  spawns: ReadonlyMap<string, ClaudeSubagentSpawn> = new Map()
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
  const spawnId = messages
    .map((message) => message.parent_tool_use_id)
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  const spawn = spawnId ? spawns.get(spawnId) : undefined

  return {
    id: agentId,
    parentId: parentId ?? null,
    // The delegation's short description names the subagent. Without it, fall back to the agent
    // type, then the start of the prompt; forks copy the parent's context, so that is the least
    // specific.
    title: truncate(
      spawn?.description ||
        taskDescription ||
        spawn?.agentType ||
        agentType ||
        description ||
        `Subagent ${agentId}`,
      60
    ),
    description: taskDescription || description || null,
    status: 'unknown',
    createdAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
    updatedAt: timestamps.length > 0 ? Math.max(...timestamps) : null
  }
}
