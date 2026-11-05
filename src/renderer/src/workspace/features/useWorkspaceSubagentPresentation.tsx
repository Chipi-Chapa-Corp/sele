import { useCallback, useEffect, useMemo } from 'react'
import type { ProviderChatItem } from '../../../../shared/provider'
import { ChatSubagentList } from '../../components/ChatSubagentList'
import { SubagentCompletionBubble } from '../../components/SubagentCompletionBubble'
import { getRenderableText } from '../../renderableText'
import { SubagentCompletionTimeline, type SubagentCompletion } from '../../subagentTimeline'
import { getVisibleSubagentRows } from '../../subagentUi'
import { useLatestHandler } from '../stableProps'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'

import type { useWorkspaceConversation } from '../wiring/useWorkspaceConversation'
import type { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import type { useWorkspaceSubagents } from '../wiring/useWorkspaceSubagents'
type WorkspaceSubagentPresentationDependencies = {
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  session: Pick<
    ReturnType<typeof useWorkspaceSession>,
    'selectedChatKey' | 'selectedChatSubagents' | 'activeSubagentChatView'
  >
  conversation: Pick<
    ReturnType<typeof useWorkspaceConversation>,
    | 'effectiveChatTurnWindow'
    | 'visibleChatItems'
    | 'subagentChatConversationModel'
    | 'subagentVisibleChatItems'
  >
  subagents: Pick<
    ReturnType<typeof useWorkspaceSubagents>,
    'handleOpenSubagentChat' | 'handleCancelSubagent'
  >
}

export function useWorkspaceSubagentPresentation({
  subagentState,
  chatState,
  session,
  conversation,
  subagents
}: WorkspaceSubagentPresentationDependencies) {
  const { selectedChatKey, selectedChatSubagents, activeSubagentChatView } = session
  const {
    effectiveChatTurnWindow,
    visibleChatItems,
    subagentChatConversationModel,
    subagentVisibleChatItems
  } = conversation
  const { handleOpenSubagentChat, handleCancelSubagent } = subagents

  useEffect(() => {
    if (
      selectedChatKey &&
      subagentState.subagentListState?.rootChatKey === selectedChatKey &&
      subagentState.subagentListState.loadState === 'ready'
    ) {
      subagentState.updateSubagentWorkingChat(selectedChatKey, selectedChatSubagents)
    }
  }, [
    selectedChatKey,
    selectedChatSubagents,
    subagentState.subagentListState,
    subagentState.updateSubagentWorkingChat
  ])

  const getSubagentCompletionPlacements = (
    scope: string,
    items: readonly ProviderChatItem[],
    parentId: string | null,
    atLatest: boolean
  ) => {
    let timeline = subagentState.subagentCompletionTimelines.current.get(scope)
    if (!timeline) {
      timeline = new SubagentCompletionTimeline()
      subagentState.subagentCompletionTimelines.current.set(scope, timeline)
    }
    return timeline.reconcile(items, selectedChatSubagents, parentId, atLatest)
  }

  // Placements depend only on these arguments (reconciling the same ones again
  // returns the same result), so memoize them: the turn renderers use them as inputs.
  const rootCompletionsAtLatest =
    !chatState.chatDetail?.turnPagination?.newerCursor &&
    (!effectiveChatTurnWindow ||
      effectiveChatTurnWindow.endIndex === effectiveChatTurnWindow.totalCount)

  const rootSubagentCompletions = useMemo(
    () =>
      getSubagentCompletionPlacements(
        selectedChatKey ?? '',
        visibleChatItems,
        null,
        rootCompletionsAtLatest
      ),
    [rootCompletionsAtLatest, selectedChatKey, selectedChatSubagents, visibleChatItems]
  )

  const activeSubagentSummaryId = activeSubagentChatView?.summary.id ?? null

  const childCompletionsAtLatest =
    !activeSubagentChatView?.detail?.turnCount ||
    (activeSubagentChatView.detail.itemsStartTurnIndex ?? 0) +
      subagentChatConversationModel.turns.length >=
      activeSubagentChatView.detail.turnCount

  const childSubagentCompletions = useMemo(
    () =>
      getSubagentCompletionPlacements(
        `${selectedChatKey}:${activeSubagentSummaryId ?? ''}`,
        subagentVisibleChatItems,
        activeSubagentSummaryId,
        childCompletionsAtLatest
      ),
    [
      activeSubagentSummaryId,
      childCompletionsAtLatest,
      selectedChatKey,
      selectedChatSubagents,
      subagentVisibleChatItems
    ]
  )

  const openCompletedSubagentChat = useLatestHandler(handleOpenSubagentChat)

  const renderSubagentCompletion = useCallback(
    (completion: SubagentCompletion): React.ReactElement => (
      <SubagentCompletionBubble
        key={completion.id}
        subagent={completion.subagent}
        onOpen={(agent) => void openCompletedSubagentChat(agent)}
      />
    ),
    [openCompletedSubagentChat]
  )

  const selectedChatSubagentError =
    subagentState.subagentListState?.rootChatKey === selectedChatKey
      ? subagentState.subagentListState.error
      : null

  // The sidebar is memoized; this element and the group renderer below must only
  // change when what they show changes.
  const cancelSubagent = useLatestHandler(handleCancelSubagent)

  const openSubagentChat = useLatestHandler(handleOpenSubagentChat)

  const activeSubagentId = activeSubagentChatView?.summary.id ?? null

  const selectedChatTitle = chatState.selectedChat
    ? getRenderableText(chatState.selectedChat.title, 'Untitled chat')
    : null

  const selectedChatSubagentList = useMemo(
    () =>
      selectedChatTitle !== null &&
      (getVisibleSubagentRows(selectedChatSubagents, activeSubagentId).length > 0 ||
        selectedChatSubagentError) ? (
        <ChatSubagentList
          activeSubagentId={activeSubagentId}
          cancelingSubagentIds={subagentState.cancelingSubagentIds}
          error={selectedChatSubagentError}
          parentTitle={selectedChatTitle}
          subagents={selectedChatSubagents}
          onCancel={(subagent) => void cancelSubagent(subagent)}
          onOpen={(subagent) => void openSubagentChat(subagent)}
        />
      ) : null,
    [
      activeSubagentId,
      cancelSubagent,
      subagentState.cancelingSubagentIds,
      openSubagentChat,
      selectedChatSubagentError,
      selectedChatSubagents,
      selectedChatTitle
    ]
  )

  // Only the group holding the selected chat receives the subagent list, so other groups keep
  // their memoized rows.
  const selectedSubagentChatOpen = Boolean(activeSubagentChatView)
  return {
    rootSubagentCompletions,
    childSubagentCompletions,
    renderSubagentCompletion,
    selectedChatSubagentList,
    selectedSubagentChatOpen
  }
}
