import type { ProviderChat, ProviderChatDetail } from './provider'
import {
  getProviderChatTurns,
  startsProviderChatTurn,
  unloadWorkingStepItems
} from './chatTurns.ts'
import { asChatPreview } from './chatPreview.ts'
import { finishWorkingStepsBeforeAnswers } from './chatWorkingLifecycle.ts'

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
  const restored = asChatPreview({
    ...view,
    ...chat,
    items: finishWorkingStepsBeforeAnswers(view.items),
    conversationView: true
  })
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
  return changed ? { ...restored, items: finishWorkingStepsBeforeAnswers(items) } : restored
}

export const isConversationOpeningDetail = (detail: ProviderChatDetail): boolean =>
  !detail.historyPreview &&
  !detail.turnPagination?.newerCursor &&
  (Boolean(detail.turnPagination) ||
    detail.turnCount === undefined ||
    (detail.itemsStartTurnIndex ?? 0) + getProviderChatTurns(detail.items).length >=
      detail.turnCount)

/** Persist the processed message list as-is, with no separate truncated opening. */
export const createConversationView = (detail: ProviderChatDetail): ProviderChatDetail => ({
  ...asChatPreview(detail),
  conversationView: true,
  openingPreview: undefined,
  conversationViewSourceRevision: detail.conversationViewSourceRevision ?? detail.revision,
  // Keep message text, attachments, ordering and pagination intact. Hidden tool
  // bodies are fetched on expansion through their existing page API.
  items: finishWorkingStepsBeforeAnswers(detail.items).map((item) =>
    item.type === 'working' && (item.items.length > 0 || item.itemSegments)
      ? unloadWorkingStepItems(item)
      : item
  ),
  itemsStartTurnIndex: detail.itemsStartTurnIndex ?? 0,
  turnCount: detail.turnCount ?? getProviderChatTurns(detail.items).length
})
