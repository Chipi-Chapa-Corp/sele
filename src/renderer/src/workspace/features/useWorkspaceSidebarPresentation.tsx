import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { type ChatListGroupData } from '../../components/ChatListGroup'
import { getChatKey, getChatProjectCwd } from '../chatControllerUtils'
import { useWorkspaceSubagentPresentation } from './useWorkspaceSubagentPresentation'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function useWorkspaceSidebarPresentation({
  chatState,
  sidebarModel,
  subagentState,
  subagentPresentation,
  session,
  interactions
}: WorkspaceChanges & {
  subagentPresentation: ReturnType<typeof useWorkspaceSubagentPresentation>
}) {
  const { selectedChatKey } = session
  const { renderChatGroup } = interactions
  const { isWorkingChat } = sidebarModel

  const committedWorkingProjectCwds = useRef(new Set<string | null>())
  const workingProjectCwds = useMemo(() => {
    const cwds = new Set<string | null>()
    for (const chat of chatState.chats) {
      if (!chat.imported && isWorkingChat(chat)) cwds.add(getChatProjectCwd(chat))
    }
    const before = committedWorkingProjectCwds.current
    return before.size === cwds.size && [...cwds].every((cwd) => before.has(cwd)) ? before : cwds
  }, [chatState.chats, isWorkingChat])

  useLayoutEffect(() => {
    committedWorkingProjectCwds.current = workingProjectCwds
  }, [workingProjectCwds])

  const renderSidebarChatGroup = useCallback(
    (group: ChatListGroupData): React.ReactElement => {
      const holdsSelectedChat = Boolean(
        selectedChatKey && group.chats.some((chat) => getChatKey(chat) === selectedChatKey)
      )
      return renderChatGroup(
        group.kind === 'cwd'
          ? {
              ...group,
              hasWorkingChat:
                chatState.visibleChatSidebarTabs.working &&
                chatState.activeChatSidebarFilter !== 'working' &&
                chatState.activeChatSidebarFilter !== 'all' &&
                workingProjectCwds.has(group.cwd)
            }
          : group,
        holdsSelectedChat ? subagentPresentation.selectedChatSubagentList : null,
        holdsSelectedChat && subagentPresentation.selectedSubagentChatOpen,
        subagentState.workingSubagentChatKeys
      )
    },
    [
      chatState.visibleChatSidebarTabs.working,
      chatState.activeChatSidebarFilter,
      renderChatGroup,
      selectedChatKey,
      subagentPresentation.selectedChatSubagentList,
      subagentPresentation.selectedSubagentChatOpen,
      workingProjectCwds,
      subagentState.workingSubagentChatKeys
    ]
  )
  return { renderSidebarChatGroup, hasWorkingChats: workingProjectCwds.size > 0 }
}
