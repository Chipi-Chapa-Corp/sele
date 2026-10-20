import { mergeWorkingStepPage } from './chatDetailWindow.ts'

const subagentPageNavigationEpochs = new WeakMap<object, number>()
export const getSubagentPageNavigationEpoch = (requestRef: object): number =>
  subagentPageNavigationEpochs.get(requestRef) ?? 0
export const beginSubagentPageNavigation = (requestRef: object): number => {
  const next = getSubagentPageNavigationEpoch(requestRef) + 1
  subagentPageNavigationEpochs.set(requestRef, next)
  return next
}
import type {
  ProviderChatItem,
  ProviderSubagent,
  ProviderSubagentDetail,
  ProviderWorkingItem
} from '../../shared/provider'

/**
 * Identifies the subagent delegation rows in a parent transcript and their states. Its change
 * means a subagent started or finished, so the sidebar's subagent list is stale.
 */
export const getSubagentToolSignature = (items: readonly ProviderChatItem[]): string => {
  const parts: string[] = []
  const visit = (item: ProviderWorkingItem): void => {
    if (item.type === 'toolGroup') item.tools.forEach(visit)
    else if (item.type === 'tool' && item.icon === 'subagent')
      parts.push(`${item.id}:${item.status}`)
  }
  for (const item of items) {
    if (item.type !== 'working') continue
    item.items.forEach(visit)
    item.itemSegments?.forEach((segment) => segment.items.forEach(visit))
  }
  return parts.join('\n')
}

export type OrderedSubagent = { subagent: ProviderSubagent; depth: number }

export const getWorkingSubagentIds = (subagents: readonly ProviderSubagent[]): Set<string> => {
  const parents = new Map(subagents.map((agent) => [agent.id, agent.parentId]))
  const working = new Set<string>()
  for (const agent of subagents) {
    if (agent.status !== 'pending' && agent.status !== 'running') continue
    let id: string | null = agent.id
    const visited = new Set<string>()
    while (id && parents.has(id) && !visited.has(id)) {
      visited.add(id)
      working.add(id)
      id = parents.get(id) ?? null
    }
  }
  return working
}

/** Expand the selected branch, keeping other agents' descendants inside their own chats. */
export const getVisibleSubagentRows = (
  subagents: readonly ProviderSubagent[],
  openSubagentId: string | null
): OrderedSubagent[] => {
  const parents = new Map(subagents.map((agent) => [agent.id, agent.parentId]))
  const expanded = new Set<string>()
  let id = openSubagentId
  while (id && parents.has(id) && !expanded.has(id)) {
    expanded.add(id)
    id = parents.get(id) ?? null
  }
  const working = getWorkingSubagentIds(subagents)
  return orderSubagentTree(subagents).filter(
    ({ subagent }) =>
      (working.has(subagent.id) || expanded.has(subagent.id)) &&
      (!subagent.parentId || !parents.has(subagent.parentId) || expanded.has(subagent.parentId))
  )
}

const getSubagentStartTime = (subagent: ProviderSubagent): number =>
  subagent.createdAt ?? subagent.updatedAt ?? Number.MAX_SAFE_INTEGER

/**
 * Orders subagents depth-first by start time so each nested subagent directly follows the
 * subagent that spawned it. Parents outside the list (the root chat itself) count as the root.
 */
export const orderSubagentTree = (subagents: readonly ProviderSubagent[]): OrderedSubagent[] => {
  const ids = new Set(subagents.map((subagent) => subagent.id))
  const childrenByParent = new Map<string | null, ProviderSubagent[]>()
  for (const subagent of subagents) {
    const parentId =
      subagent.parentId && subagent.parentId !== subagent.id && ids.has(subagent.parentId)
        ? subagent.parentId
        : null
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(subagent)
    childrenByParent.set(parentId, siblings)
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((first, second) => getSubagentStartTime(first) - getSubagentStartTime(second))
  }

  const ordered: OrderedSubagent[] = []
  const visited = new Set<string>()
  const visit = (parentId: string | null, depth: number): void => {
    for (const subagent of childrenByParent.get(parentId) ?? []) {
      if (visited.has(subagent.id)) continue
      visited.add(subagent.id)
      ordered.push({ subagent, depth })
      visit(subagent.id, depth + 1)
    }
  }
  visit(null, 0)
  // Parent cycles have no root; keep them visible at the top level.
  for (const subagent of subagents) {
    if (visited.has(subagent.id)) continue
    visited.add(subagent.id)
    ordered.push({ subagent, depth: 0 })
    visit(subagent.id, 1)
  }
  return ordered
}

/** Preserve explicitly loaded history while polling the child transcript's latest tail. */
export const refreshSubagentDetail = (
  current: ProviderSubagentDetail | null,
  incoming: ProviderSubagentDetail,
  tailLimit: number,
  historyLimit: number,
  followLatest = true
): ProviderSubagentDetail => {
  if (current?.id !== incoming.id) return incoming
  if (!followLatest) {
    // Polls always fetch the newest page. Keep the reader's historical page in place.
    return {
      ...current,
      ...incoming,
      items: current.items,
      itemsStartTurnIndex: current.itemsStartTurnIndex,
      turnCount: Math.max(current.turnCount ?? 0, incoming.turnCount ?? 0)
    }
  }
  const previousItems = new Map(current.items.map((item) => [item.id, item]))
  return {
    ...incoming,
    items: incoming.items.map((item) => {
      const previous = previousItems.get(item.id)
      if (item.type !== 'working' || previous?.type !== 'working') return item
      // Completed sections are immutable; keep any expanded pages and tool payloads.
      if (
        previous.status !== 'working' &&
        previous.status === item.status &&
        (previous.itemCount ?? previous.items.length) === (item.itemCount ?? item.items.length)
      )
        return previous
      if (!previous.itemSegments?.length || item.itemsLoaded === false) return item
      const totalCount = item.itemCount ?? item.items.length
      return mergeWorkingStepPage(
        previous,
        {
          workingStepId: item.id,
          items: item.items,
          startIndex: item.itemsStartIndex ?? Math.max(0, totalCount - item.items.length),
          totalCount,
          status: item.status
        },
        tailLimit,
        historyLimit
      )
    })
  }
}
