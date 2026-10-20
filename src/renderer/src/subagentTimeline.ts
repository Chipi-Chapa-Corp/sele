import type { ProviderChatItem, ProviderSubagent } from '../../shared/provider'
import { getWorkingSubagentIds } from './subagentUi.ts'

export type SubagentCompletion = {
  id: string
  subagent: ProviderSubagent
  itemId: string
  position: 'before' | 'after'
}

/** Placement belongs to the completion event, never the changing end of the conversation. */
export class SubagentCompletionTimeline {
  private entries = new Map<string, SubagentCompletion>()

  reconcile(
    items: readonly ProviderChatItem[],
    subagents: readonly ProviderSubagent[],
    parentId: string | null,
    atLatest: boolean
  ): { before: Map<string, SubagentCompletion[]>; after: Map<string, SubagentCompletion[]> } {
    const itemIds = new Set(items.map((item) => item.id))
    const children = subagents.filter((agent) => agent.parentId === parentId)
    const working = getWorkingSubagentIds(subagents)
    for (const agent of children) {
      const anchors = items.filter(
        (item) =>
          item.type === 'timelineAnchor' && item.id.endsWith(`:subagent-completed:${agent.id}`)
      )
      const currentAnchor = anchors.find(
        (anchor) =>
          (!agent.afterItemId || anchor.id === agent.afterItemId) &&
          (!agent.turnId || anchor.id.startsWith(`${agent.turnId}:`))
      )
      for (const anchor of anchors) {
        // A previously completed run stays in history even when this agent is resumed.
        if (
          working.has(agent.id) &&
          anchor === currentAnchor &&
          agent.status !== 'running' &&
          agent.status !== 'pending'
        )
          continue
        if (this.entries.has(anchor.id)) continue
        const terminal = ['completed', 'failed', 'stopped'].includes(agent.status)
        this.entries.set(anchor.id, {
          id: anchor.id,
          subagent: {
            ...agent,
            status: terminal && anchor === currentAnchor ? agent.status : 'completed'
          },
          itemId: anchor.id,
          position: 'after'
        })
      }
      if (working.has(agent.id) || !['completed', 'failed', 'stopped'].includes(agent.status))
        continue
      const eventId = `${agent.id}:${agent.turnId ?? ''}:${agent.updatedAt ?? 'finished'}`
      if (currentAnchor) {
        // A native marker supersedes an interim placement for this completion only.
        for (const [id, entry] of this.entries) {
          if (
            !id.includes(':subagent-completed:') &&
            entry.subagent.id === agent.id &&
            entry.subagent.updatedAt === agent.updatedAt
          )
            this.entries.delete(id)
        }
        continue
      }
      if (this.entries.has(eventId)) continue
      let itemId: string | undefined
      let position: 'before' | 'after' = 'after'
      if (agent.beforeItemId && itemIds.has(agent.beforeItemId)) {
        itemId = agent.beforeItemId
        position = 'before'
      } else if (
        agent.afterItemId &&
        itemIds.has(agent.afterItemId) &&
        !agent.afterItemId.includes(':subagent-completed:')
      ) {
        itemId = agent.afterItemId
      } else {
        const turnItems = agent.turnId
          ? items.filter((item) => item.id.startsWith(`${agent.turnId}:`))
          : []
        // Do not attach a completion from an unloaded turn to an unrelated history page.
        const time = agent.updatedAt ?? agent.createdAt
        const timestamps = items.flatMap((item) =>
          'createdAt' in item && typeof item.createdAt === 'number' ? [item.createdAt] : []
        )
        if (
          turnItems.length === 0 &&
          (time == null || (timestamps.length > 0 && time < Math.min(...timestamps)))
        )
          continue
        const next =
          time == null
            ? undefined
            : items.find(
                (item) =>
                  'createdAt' in item && typeof item.createdAt === 'number' && item.createdAt > time
              )
        if (next) {
          itemId = next.id
          position = 'before'
        } else if (atLatest) {
          itemId = (turnItems.at(-1) ?? items.at(-1))?.id
        }
      }
      if (itemId)
        this.entries.set(eventId, { id: eventId, subagent: { ...agent }, itemId, position })
    }
    const before = new Map<string, SubagentCompletion[]>()
    const after = new Map<string, SubagentCompletion[]>()
    for (const entry of this.entries.values()) {
      if (!itemIds.has(entry.itemId)) continue
      const placements = entry.position === 'before' ? before : after
      const existing = placements.get(entry.itemId) ?? []
      existing.push(entry)
      placements.set(entry.itemId, existing)
    }
    return { before, after }
  }
}
