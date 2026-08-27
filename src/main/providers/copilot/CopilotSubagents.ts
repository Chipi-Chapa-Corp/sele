import type { SessionEvent } from '@github/copilot-sdk'
import type { ProviderChatItem, ProviderSubagent } from '../../../shared/provider'

export type CopilotAgentTask = {
  type: 'agent'
  id: string
  description: string
  status: 'running' | 'idle' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  agentType: string
  prompt: string
}

const truncate = (value: string, limit: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

const getTimestamp = (value: string | undefined): number | null => {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

const getTaskStatus = (status: CopilotAgentTask['status']): ProviderSubagent['status'] => {
  if (status === 'cancelled') return 'stopped'
  return status
}

export const createCopilotSubagentSummaries = (
  events: SessionEvent[],
  tasks: CopilotAgentTask[] = []
): ProviderSubagent[] => {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const agentIds = new Set(tasks.map((task) => task.id))
  events.forEach((event) => {
    if (event.agentId) agentIds.add(event.agentId)
  })

  return Array.from(agentIds, (agentId): ProviderSubagent => {
    const scopedEvents = events.filter((event) => event.agentId === agentId)
    const started = scopedEvents.find(
      (event): event is Extract<SessionEvent, { type: 'subagent.started' }> =>
        event.type === 'subagent.started'
    )
    const terminal = scopedEvents.findLast(
      (event): event is Extract<SessionEvent, { type: 'subagent.completed' | 'subagent.failed' }> =>
        event.type === 'subagent.completed' || event.type === 'subagent.failed'
    )
    const task = taskById.get(agentId)
    const eventTimestamps = scopedEvents
      .map((event) => getTimestamp(event.timestamp))
      .filter((timestamp): timestamp is number => timestamp !== null)
    const createdAt =
      getTimestamp(task?.startedAt) ??
      getTimestamp(started?.timestamp) ??
      (eventTimestamps.length > 0 ? Math.min(...eventTimestamps) : null)
    const updatedAt =
      getTimestamp(task?.completedAt) ??
      getTimestamp(terminal?.timestamp) ??
      (eventTimestamps.length > 0 ? Math.max(...eventTimestamps) : createdAt)
    const status: ProviderSubagent['status'] = task
      ? getTaskStatus(task.status)
      : terminal?.type === 'subagent.failed'
        ? 'failed'
        : terminal
          ? 'completed'
          : started
            ? 'running'
            : 'unknown'
    const title =
      task?.agentType.trim() ||
      started?.data.agentDisplayName.trim() ||
      started?.data.agentName.trim() ||
      `Subagent ${agentId}`
    const description =
      task?.description.trim() ||
      task?.prompt.trim() ||
      started?.data.agentDescription.trim() ||
      null

    return {
      id: agentId,
      parentId: null,
      title: truncate(title, 80),
      description,
      status,
      createdAt,
      updatedAt
    }
  }).sort(
    (first, second) =>
      (first.createdAt ?? Number.MAX_SAFE_INTEGER) - (second.createdAt ?? Number.MAX_SAFE_INTEGER)
  )
}

export const createCopilotSubagentTranscriptItems = (
  summary: ProviderSubagent,
  items: ProviderChatItem[]
): ProviderChatItem[] => {
  if (items.some((item) => item.type === 'message' && item.role === 'user')) return items

  const instruction = summary.description?.trim()
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
