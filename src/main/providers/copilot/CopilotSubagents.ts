import type { SessionEvent } from '@github/copilot-sdk'
import type { ProviderChatItem, ProviderSubagent } from '../../../shared/provider'
import type { ProviderChatTurnWindow } from '../ProviderAdapter'
import { isCopilotSystemContextMessage, renderCopilotChatWindow } from './CopilotItemRenderers.ts'

export type CopilotAgentTask = {
  type: 'agent'
  id: string
  description: string
  status: 'running' | 'idle' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  agentType: string
  prompt: string
  toolCallId?: string
  executionMode?: 'sync' | 'background' | (string & {})
  canPromoteToBackground?: boolean
}

/** A message the user delivered to a subagent through `tasks.sendMessage`. */
export type CopilotSubagentFollowUp = {
  id: string
  agentId: string
  content: string
  timestamp: string
}

/**
 * Copilot only accepts follow-ups for background agents (write_agent semantics); a synchronous
 * agent qualifies once promoted. Finished agents cannot be resumed.
 */
export const canMessageCopilotTask = (task: CopilotAgentTask | undefined): boolean =>
  Boolean(
    task &&
    (task.status === 'running' || task.status === 'idle') &&
    (task.executionMode === 'background' || task.canPromoteToBackground === true)
  )

const getPromptArgument = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const prompt = (value as Record<string, unknown>).prompt
  return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : null
}

/**
 * `TaskAgentInfo.prompt` is replaced by every follow-up, so the original instruction comes from the
 * parent's spawning tool call.
 */
const getSpawnArguments = (events: SessionEvent[], toolCallId: string | undefined) => {
  if (!toolCallId) return null
  const start = events.find(
    (event): event is Extract<SessionEvent, { type: 'tool.execution_start' }> =>
      event.type === 'tool.execution_start' && event.data.toolCallId === toolCallId
  )
  return start?.data.arguments
}

const getOriginalInstruction = (events: SessionEvent[], toolCallId: string | undefined) =>
  getPromptArgument(getSpawnArguments(events, toolCallId))

const getSpawnDescription = (events: SessionEvent[], toolCallId: string | undefined) => {
  const args = getSpawnArguments(events, toolCallId)
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  const description = (args as Record<string, unknown>).description
  return typeof description === 'string' && description.trim() ? description.trim() : null
}

/**
 * Show follow-ups the user sent in the subagent transcript. The runtime delivers them out of band,
 * so a matching native user message (if one is ever recorded) takes precedence.
 */
export const mergeCopilotSubagentFollowUps = (
  events: SessionEvent[],
  followUps: CopilotSubagentFollowUp[]
): SessionEvent[] => {
  const pending = followUps.filter(
    (followUp) =>
      !events.some(
        (event) =>
          event.type === 'user.message' &&
          event.agentId === followUp.agentId &&
          event.data.content.trim() === followUp.content.trim()
      )
  )
  if (pending.length === 0) return events
  const merged = [...events]
  pending.forEach((followUp) => {
    const at = Date.parse(followUp.timestamp)
    const index = merged.findIndex((event) => Date.parse(event.timestamp) > at)
    const event = {
      type: 'user.message',
      id: followUp.id,
      parentId: null,
      agentId: followUp.agentId,
      timestamp: followUp.timestamp,
      data: { content: followUp.content }
    } as unknown as SessionEvent
    merged.splice(index < 0 ? merged.length : index, 0, event)
  })
  return merged
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
    const toolCallId = task?.toolCallId ?? started?.data.toolCallId
    // The delegation's short description names the subagent; the agent type is generic.
    const title =
      task?.description.trim() ||
      getSpawnDescription(events, toolCallId) ||
      started?.data.agentDisplayName.trim() ||
      task?.agentType.trim() ||
      started?.data.agentName.trim() ||
      `Subagent ${agentId}`
    const description =
      getOriginalInstruction(events, toolCallId) ||
      task?.description.trim() ||
      task?.prompt.trim() ||
      started?.data.agentDescription.trim() ||
      null

    return {
      id: agentId,
      parentId: started?.data.parentId?.trim() || null,
      title: truncate(title, 60),
      description,
      status,
      createdAt,
      updatedAt,
      canMessage: canMessageCopilotTask(task)
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

export const renderCopilotSubagentWindow = (
  summary: ProviderSubagent,
  events: SessionEvent[],
  window: ProviderChatTurnWindow
): {
  items: ProviderChatItem[]
  itemsStartTurnIndex: number
  turnCount: number
} => {
  const page = renderCopilotChatWindow(
    events,
    {
      agentId: summary.id,
      active: summary.status === 'pending' || summary.status === 'running',
      stopped: summary.status === 'stopped',
      failed: summary.status === 'failed'
    },
    window
  )
  const hasUserMessage = events.some(
    (event) =>
      event.agentId === summary.id &&
      event.type === 'user.message' &&
      !isCopilotSystemContextMessage(event)
  )
  if (hasUserMessage || !summary.description?.trim()) return page
  // An out-of-band instruction belongs at the beginning, never on every historical page.
  if (page.turnCount === 0) {
    const startIndex = window.startIndex === null ? 0 : Math.min(window.startIndex, 1)
    return {
      items: startIndex === 0 ? createCopilotSubagentTranscriptItems(summary, []) : [],
      itemsStartTurnIndex: startIndex,
      turnCount: 1
    }
  }
  return page.itemsStartTurnIndex === 0
    ? { ...page, items: createCopilotSubagentTranscriptItems(summary, page.items) }
    : page
}
