import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { type ChatListGroupData } from '../../components/ChatListGroup'
import { getChatKey, getChatProjectCwd } from '../chatControllerUtils'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceSubagentPresentation } from './useWorkspaceSubagentPresentation'

import type { useWorkspaceInteractions } from '../wiring/useWorkspaceInteractions'
import type { useWorkspaceSession } from '../wiring/useWorkspaceSession'
type WorkspaceSidebarPresentationDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  subagentPresentation: ReturnType<typeof useWorkspaceSubagentPresentation>
  session: Pick<ReturnType<typeof useWorkspaceSession>, 'committingChatKeys' | 'selectedChatKey'>
  interactions: Pick<ReturnType<typeof useWorkspaceInteractions>, 'renderChatGroup'>
}

export function useWorkspaceSidebarPresentation({
  chatState,
  subagentState,
  subagentPresentation,
  session,
  interactions
}: WorkspaceSidebarPresentationDependencies) {
  const { committingChatKeys, selectedChatKey } = session
  const { renderChatGroup } = interactions

  const committedWorkingProjectCwds = useRef(new Set<string | null>())
  const workingProjectCwds = useMemo(() => {
    const cwds = new Set<string | null>()
    for (const chat of chatState.chats) {
      if (chat.imported) continue
      const key = getChatKey(chat)
      if (
        chat.status === 'active' ||
        committingChatKeys.has(key) ||
        subagentState.workingSubagentChatKeys.has(key)
      ) {
        cwds.add(getChatProjectCwd(chat))
      }
    }
    const before = committedWorkingProjectCwds.current
    return before.size === cwds.size && [...cwds].every((cwd) => before.has(cwd)) ? before : cwds
  }, [chatState.chats, committingChatKeys, subagentState.workingSubagentChatKeys])

  useLayoutEffect(() => {
    committedWorkingProjectCwds.current = workingProjectCwds
  }, [workingProjectCwds])

  const renderSidebarChatGroup = useCallback(
    (group: ChatListGroupData, contentId: string, layoutOrder?: string): React.ReactElement => {
      const holdsSelectedChat = Boolean(
        selectedChatKey &&
          group.chats.some(
            (chat) => getChatKey({ providerId: chat.providerId, id: chat.id }) === selectedChatKey
          )
      )
      return renderChatGroup(
        group.kind === 'cwd'
          ? {
              ...group,
              hasWorkingChat:
                chatState.activeChatSidebarFilter !== 'working' && workingProjectCwds.has(group.cwd)
            }
          : group,
        contentId,
        holdsSelectedChat ? subagentPresentation.selectedChatSubagentList : null,
        holdsSelectedChat && subagentPresentation.selectedSubagentChatOpen,
        subagentState.workingSubagentChatKeys,
        layoutOrder
      )
    },
    [
      chatState.activeChatSidebarFilter,
      renderChatGroup,
      selectedChatKey,
      subagentPresentation.selectedChatSubagentList,
      subagentPresentation.selectedSubagentChatOpen,
      workingProjectCwds,
      subagentState.workingSubagentChatKeys
    ]
  )
  return { renderSidebarChatGroup }
}
