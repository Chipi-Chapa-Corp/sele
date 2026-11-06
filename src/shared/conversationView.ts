import type { ProviderChat, ProviderChatDetail, ProviderChatItem } from './provider'
import { getProviderChatTurns, startsProviderChatTurn } from './chatTurns.ts'
import { asChatPreview } from './chatPreview.ts'

/** Sidebar discovery must not carry a saved transcript or other detail payloads. */
export const getConversationViewSummary = (
  view: ProviderChatDetail
): Omit<ProviderChat, 'providerId'> => ({
  id: view.id,
  accountId: view.accountId,
  imported: view.imported,
  noProject: view.noProject,
  title: view.title,
  preview: (view.items.findLast((item) => item.type === 'message')?.content ?? '')
    .trim()
    .slice(0, 500),
  createdAt: view.createdAt,
  updatedAt: view.updatedAt ?? view.createdAt,
  cwd: view.cwd,
  cwdKind: view.cwdKind,
  projectCwd: view.projectCwd,
  branchName: view.branchName,
  worktreeBaseBranchName: view.worktreeBaseBranchName,
  status: view.status,
  lastTurnOutcome: view.lastTurnOutcome,
  pinned: view.pinned,
  sidebarOrder: view.sidebarOrder,
  done: view.done,
  doneAt: view.doneAt,
  seenUpdatedAt: view.seenUpdatedAt,
  purpose: view.purpose,
  container: view.container,
  pendingApproval: null
})

/** Sidebar recovery can observe an interruption before the saved viewport is refreshed. */
export const restoreConversationView = (
  view: ProviderChatDetail,
  chat: ProviderChat
): ProviderChatDetail => {
  const restored = asChatPreview({ ...view, ...chat, conversationView: true })
  const outcome = chat.lastTurnOutcome
  if (
    (outcome !== 'stopped' && outcome !== 'failed') ||
    (chat.status !== null && chat.status !== 'error') ||
    !isConversationOpeningDetail({ ...view, historyPreview: false }) ||
    (chat.updatedAt ?? 0) < (view.updatedAt ?? 0)
  )
    return restored

  // Queued prompts have not run. Reconcile only the latest executed turn, leaving
  // historical sections, queue entries, and the durable snapshot itself intact.
  let end = view.items.length
  while (end > 0) {
    const item = view.items[end - 1]
    if (item.type !== 'pendingMessage' && !(item.type === 'working' && item.status === 'queued'))
      break
    end--
  }
  let start = end - 1
  while (start > 0 && !startsProviderChatTurn(view.items[start])) start--
  let changed = false
  const items = view.items.map((item, index) => {
    if (index < start || index >= end || item.type !== 'working' || item.status !== 'working')
      return item
    changed = true
    return { ...item, status: outcome }
  })
  return changed ? { ...restored, items } : restored
}

export const isConversationOpeningDetail = (detail: ProviderChatDetail): boolean =>
  !detail.historyPreview &&
  !detail.turnPagination?.newerCursor &&
  (Boolean(detail.turnPagination) ||
    detail.turnCount === undefined ||
    (detail.itemsStartTurnIndex ?? 0) + getProviderChatTurns(detail.items).length >=
      detail.turnCount)

/** A stable, bounded opening viewport; older pages remain independently pageable. */
export const createConversationView = (detail: ProviderChatDetail): ProviderChatDetail => {
  const turns = getProviderChatTurns(detail.items)
  const latest = turns.at(-1)
  return {
    ...asChatPreview(detail),
    conversationView: true,
    conversationViewSourceRevision: detail.conversationViewSourceRevision ?? detail.revision,
    items: latest?.items ?? [],
    itemsStartTurnIndex: (detail.itemsStartTurnIndex ?? 0) + Math.max(0, turns.length - 1),
    turnCount: detail.turnCount ?? turns.length
  }
}

/** Readable first viewport. Full turns remain in the durable view/history pages. */
export const createConversationOpening = (view: ProviderChatDetail): ProviderChatDetail => {
  const items: ProviderChatItem[] = []
  let messages = 0
  let working = false
  for (let index = view.items.length - 1; index >= 0; index--) {
    const item = view.items[index]
    if ((item.type === 'message' || item.type === 'pendingMessage') && messages < 2) {
      const truncated = item.content.length > 8192
      items.push({
        id: item.id,
        type: item.type,
        ...(item.type === 'message' ? { role: item.role } : { kind: item.kind, editable: false }),
        content: (truncated ? '…\n' : '') + item.content.slice(-8192),
        contentLoaded: truncated ? false : item.contentLoaded,
        contentTruncated: truncated || item.contentTruncated,
        contentCharacterCount: item.contentCharacterCount ?? item.content.length,
        createdAt: item.createdAt
      } as ProviderChatItem)
      messages++
    } else if (item.type === 'working' && !working) {
      items.push({
        type: 'working',
        id: item.id,
        status: item.status,
        failureReason: item.failureReason,
        items: [],
        itemsLoaded: false,
        itemCount: item.itemCount ?? item.items.length
      })
      working = true
    }
    if (messages === 2 && working) break
  }
  return {
    ...asChatPreview(view),
    openingPreview: true,
    items: items.reverse(),
    subagents: undefined,
    promptSuggestion: undefined,
    goal: undefined,
    tokenUsage: null,
    contextUsage: null
  }
}
