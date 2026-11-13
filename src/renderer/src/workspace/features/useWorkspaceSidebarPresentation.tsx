import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { type ChatListGroupData } from '../../components/ChatListGroup'
import { getChatKey, getChatProjectCwd } from '../chatControllerUtils'
import { useWorkspaceSubagentPresentation } from './useWorkspaceSubagentPresentation'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function useWorkspaceSidebarPresentation({
  chatState,
  subagentState,
  subagentPresentation,
  session,
  interactions
}: WorkspaceChanges & {
  subagentPresentation: ReturnType<typeof useWorkspaceSubagentPresentation>
}) {
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
    (group: ChatListGroupData): React.ReactElement => {
      const holdsSelectedChat = Boolean(
        selectedChatKey && group.chats.some((chat) => getChatKey(chat) === selectedChatKey)
      )
      return renderChatGroup(
        group.kind === 'cwd'
          ? {
              ...group,
              hasWorkingChat:
                chatState.chatSidebarTabs.working &&
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
      chatState.chatSidebarTabs.working,
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
