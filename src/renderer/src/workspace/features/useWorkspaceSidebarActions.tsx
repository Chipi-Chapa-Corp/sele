import type { ProviderCwdNote } from '../../../../shared/provider'
import { writeStoredCollapsedProjectGroups } from '../../collapsedProjectGroups'
import { type ChatListGroupData } from '../../components/ChatListGroup'
import { providerApi } from '../../providerApi'
import { getCollapsedGroupState } from '../chatControllerUtils'
import { allDoneProjectsValue, doneGroupKey } from '../controllerTypes'
import type { WorkspaceSession } from '../useWorkspaceSelection'

export function useWorkspaceSidebarActions({ projectState }: WorkspaceSession) {
  const resetDoneChatPagination = (): void => {
    projectState.setVisibleChatPageCountsByGroup((currentPageCounts) => {
      if (!(doneGroupKey in currentPageCounts)) return currentPageCounts

      const nextPageCounts = { ...currentPageCounts }
      delete nextPageCounts[doneGroupKey]
      return nextPageCounts
    })
  }

  const resetDoneProjectFilter = (): void => {
    projectState.setDoneProjectFilterValue(allDoneProjectsValue)
    resetDoneChatPagination()
  }

  const handleDoneProjectFilterChange = (projectCwd: string): void => {
    // All sources already load into chats. Re-listing their complete histories on
    // every selection blocks provider work and repeats metadata hydration.
    projectState.setDoneProjectFilterValue(projectCwd)
    resetDoneChatPagination()
  }

  const handleToggleCwdGroup = (groupKey: string): void => {
    if (groupKey === doneGroupKey) resetDoneProjectFilter()

    const nextGroups = {
      ...projectState.collapsedCwdGroups,
      [groupKey]: !getCollapsedGroupState(groupKey, projectState.collapsedCwdGroups)
    }
    projectState.setCollapsedCwdGroups(nextGroups)
    writeStoredCollapsedProjectGroups(nextGroups)
  }

  const handleLoadMoreChatsInGroup = (group: ChatListGroupData): void => {
    projectState.setVisibleChatPageCountsByGroup((currentPageCounts) => ({
      ...currentPageCounts,
      [group.key]: (currentPageCounts[group.key] ?? 1) + 1
    }))
  }

  const handleShowLessChatsInGroup = (group: ChatListGroupData): void => {
    projectState.setVisibleChatPageCountsByGroup((currentPageCounts) => {
      const nextPageCounts = { ...currentPageCounts }
      delete nextPageCounts[group.key]
      return nextPageCounts
    })
  }

  const handleCwdNotesChange = (
    group: Pick<ChatListGroupData, 'key' | 'cwd'>,
    notes: ProviderCwdNote[]
  ): void => {
    projectState.setCwdNotesByGroup((currentNotes) => ({
      ...currentNotes,
      [group.key]: notes
    }))

    void providerApi
      .setCwdNotes('codex', group.cwd, notes)
      .then((storedNotes) => {
        projectState.setCwdNotesByGroup((currentNotes) => ({
          ...currentNotes,
          [group.key]: storedNotes
        }))
      })
      .catch((error: unknown) => {
        console.error('Unable to persist workspace notes.', error)
        // Keep the optimistic note list visible if local persistence fails.
      })
  }

  const handleSelectProjectIcon = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'cwd' || !group.cwd) return
    projectState.setEditingProjectCwd(group.cwd)
    projectState.setProjectDialogOpen(true)
  }
  return {
    handleDoneProjectFilterChange,
    handleToggleCwdGroup,
    handleLoadMoreChatsInGroup,
    handleShowLessChatsInGroup,
    handleCwdNotesChange,
    handleSelectProjectIcon
  }
}
