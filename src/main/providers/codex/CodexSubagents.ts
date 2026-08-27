import type { ProviderChatItem, ProviderSubagent } from '../../../shared/provider'
import { getCodexSubagentTimelineAnchorId, type CodexTurn } from './CodexItemRenderers.ts'

export type CodexSubagentThread = {
  id: string
  name?: string | null
  parentThreadId?: string | null
  agentNickname?: string | null
  agentRole?: string | null
  source?: unknown
  preview: string
  createdAt: number
  updatedAt: number
  status: { type: 'notLoaded' | 'idle' | 'systemError' } | { type: 'active'; activeFlags: string[] }
}

const truncate = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getThreadSpawn = (source: unknown): Record<string, unknown> | null => {
  const sourceRecord = getRecord(source)
  if (!sourceRecord) return null

  const subagent = getRecord(
    sourceRecord.subAgent ?? sourceRecord.subagent ?? sourceRecord.sub_agent
  )
  return (
    getRecord(subagent?.threadSpawn ?? subagent?.thread_spawn) ??
    getRecord(sourceRecord.subAgentThreadSpawn ?? sourceRecord.sub_agent_thread_spawn)
  )
}

const getTaskNameFromPath = (path: string): string =>
  (path.split('/').filter(Boolean).at(-1) ?? path).replace(/[-_]+/g, ' ').trim()

export const getCodexSubagentTaskDescription = (thread: CodexSubagentThread): string | null => {
  const spawn = getThreadSpawn(thread.source)
  const agentPath = getString(spawn?.agentPath ?? spawn?.agent_path)
  if (agentPath) return getTaskNameFromPath(agentPath)

  return thread.agentRole?.trim() || null
}

export const isCodexSubagentThread = (thread: CodexSubagentThread): boolean =>
  Boolean(
    getThreadSpawn(thread.source) ||
    (thread.parentThreadId && (thread.agentNickname?.trim() || thread.agentRole?.trim()))
  )

const getStatus = (thread: CodexSubagentThread): ProviderSubagent['status'] => {
  if (thread.status.type === 'active') return 'running'
  if (thread.status.type === 'systemError') return 'failed'
  if (thread.status.type === 'idle') return 'completed'
  return 'unknown'
}

export const createCodexSubagentSummary = (
  thread: CodexSubagentThread,
  rootChatId: string,
  afterItemId?: string | null
): ProviderSubagent => {
  const taskDescription = getCodexSubagentTaskDescription(thread)
  const fallbackTitle = truncate(taskDescription || 'Subagent', 80)
  return {
    id: thread.id,
    parentId:
      thread.parentThreadId && thread.parentThreadId !== rootChatId ? thread.parentThreadId : null,
    ...(afterItemId ? { afterItemId } : {}),
    title:
      thread.agentNickname?.trim() ||
      thread.agentRole?.trim() ||
      thread.name?.trim() ||
      fallbackTitle,
    description: taskDescription,
    status: getStatus(thread),
    createdAt: Number.isFinite(thread.createdAt) ? thread.createdAt * 1_000 : null,
    updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt * 1_000 : null
  }
}

export const getCodexSubagentAfterItemIds = (turns: CodexTurn[]): Map<string, string> => {
  const afterItemIds = new Map<string, string>()

  turns.forEach((turn) => {
    turn.items.forEach((item) => {
      if (item.type === 'subAgentActivity' && item.kind === 'completed' && item.agentThreadId) {
        afterItemIds.set(
          item.agentThreadId,
          getCodexSubagentTimelineAnchorId(turn.id, item.agentThreadId)
        )
      }
    })
  })

  return afterItemIds
}

export const selectCodexSubagentTurns = (
  turns: CodexTurn[],
  threadCreatedAt: number
): CodexTurn[] => {
  const childTurnStartIndex = turns.findIndex((turn) => {
    if (typeof turn.startedAt !== 'number' || turn.startedAt < threadCreatedAt) return false

    const hasUserMessage = turn.items.some((item) => item.type === 'userMessage')
    const hasSubagentActivity = turn.items.some((item) => item.type === 'subAgentActivity')

    // Codex copies the spawning parent turn into a child rollout. That inherited turn can share
    // the child's creation second, so timestamps alone cannot distinguish it from the first real
    // child turn. The copied turn retains the parent's user message and interruption/activity
    // metadata; the delegated instruction itself is delivered out of band to the child.
    return !(hasUserMessage && (turn.status === 'interrupted' || hasSubagentActivity))
  })

  return childTurnStartIndex >= 0 ? turns.slice(childTurnStartIndex) : []
}

export const createCodexSubagentTranscriptItems = (
  summary: ProviderSubagent,
  items: ProviderChatItem[]
): ProviderChatItem[] => {
  const instruction = summary.description?.trim() || summary.title.trim()
  if (!instruction) return items

  return [
    {
      type: 'message',
      id: `${summary.id}:instruction`,
      role: 'user',
      content: instruction,
      createdAt: summary.createdAt
    },
    ...items
  ]
}
