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

const getTurnTime = (turn: CodexTurn, kind: 'created' | 'updated'): number | null => {
  const timestamp = kind === 'updated' ? (turn.completedAt ?? turn.startedAt) : turn.startedAt
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp * 1_000 : null
}

const getActivityStatus = (value: string | undefined): ProviderSubagent['status'] | null => {
  switch (value?.toLocaleLowerCase()) {
    case 'pending':
    case 'starting':
      return 'pending'
    case 'active':
    case 'inprogress':
    case 'in_progress':
    case 'running':
    case 'started':
      return 'running'
    case 'completed':
    case 'idle':
    case 'finished':
      return 'completed'
    case 'failed':
    case 'error':
    case 'errored':
    case 'notfound':
    case 'not_found':
    case 'systemerror':
    case 'system_error':
      return 'failed'
    case 'stopped':
    case 'cancelled':
    case 'canceled':
    case 'interrupted':
    case 'shutdown':
      return 'stopped'
    default:
      return null
  }
}

const terminalStatuses = new Set<ProviderSubagent['status']>(['completed', 'failed', 'stopped'])

/**
 * Build the lightweight subagent markers carried by a bounded parent-turn page. Child-thread
 * transcripts are deliberately not read here; those remain click-to-load through getSubagent.
 */
export const getCodexTurnSubagents = (
  turns: CodexTurn[],
  rootChatId: string
): ProviderSubagent[] => {
  const subagents = new Map<string, ProviderSubagent>()

  turns.forEach((turn) => {
    turn.items.forEach((item) => {
      if (item.type === 'subAgentActivity' && item.agentThreadId) {
        const current = subagents.get(item.agentThreadId)
        const taskName = item.agentPath?.trim() ? getTaskNameFromPath(item.agentPath.trim()) : null
        const prompt = item.prompt?.trim() || null
        const activityStatus = getActivityStatus(item.kind)
        const status =
          activityStatus === 'completed' &&
          current &&
          terminalStatuses.has(current.status) &&
          current.status !== 'completed'
            ? current.status
            : (activityStatus ?? current?.status ?? 'unknown')
        const updatedAt = getTurnTime(turn, 'updated')

        subagents.set(item.agentThreadId, {
          id: item.agentThreadId,
          parentId:
            item.senderThreadId && item.senderThreadId !== rootChatId
              ? item.senderThreadId
              : (current?.parentId ?? null),
          turnId: turn.id,
          ...(item.kind === 'completed'
            ? {
                afterItemId: getCodexSubagentTimelineAnchorId(turn.id, item.agentThreadId)
              }
            : current?.afterItemId
              ? { afterItemId: current.afterItemId }
              : {}),
          title: truncate(taskName || current?.title || 'Subagent', 80),
          description: prompt ?? current?.description ?? taskName,
          status,
          createdAt: current?.createdAt ?? getTurnTime(turn, 'created'),
          updatedAt: updatedAt ?? current?.updatedAt ?? null
        })
        return
      }

      if (item.type !== 'collabAgentToolCall' || !item.agentsStates) return
      Object.entries(item.agentsStates).forEach(([agentThreadId, state]) => {
        const current = subagents.get(agentThreadId)
        const status = getActivityStatus(state.status)
        if (!current || !status) return

        subagents.set(agentThreadId, {
          ...current,
          status,
          updatedAt: getTurnTime(turn, 'updated') ?? current.updatedAt
        })
      })
    })
  })

  return [...subagents.values()]
}

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

export const selectCodexSubagentTurns = (
  turns: CodexTurn[],
  threadCreatedAt: number
): CodexTurn[] => {
  const childTurnStartIndex = turns.findIndex((turn) => {
    if (typeof turn.startedAt !== 'number' || turn.startedAt < threadCreatedAt) return false

    const hasUserMessage = turn.items.some((item) => item.type === 'userMessage')
    const hasSubagentActivity = turn.items.some((item) => item.type === 'subAgentActivity')

    // Codex copies the spawning parent turn into a child transcript. That inherited turn can share
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
