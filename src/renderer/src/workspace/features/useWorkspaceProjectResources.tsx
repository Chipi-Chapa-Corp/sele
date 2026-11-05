import { useEffect, useMemo } from 'react'
import { isExpectedFileAbsenceError } from '../../../../shared/expectedAbsence.ts'
import { appApi } from '../../appApi'
import { providerApi } from '../../providerApi'
import { getChatCwdGroupKey, getChatCwdLabel } from '../chatControllerUtils'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import { useWorkspaceSidebarModel } from './useWorkspaceSidebarModel'

type WorkspaceProjectResourcesDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  session: ReturnType<typeof useWorkspaceSession>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  sidebarModel: ReturnType<typeof useWorkspaceSidebarModel>
  projectState: ReturnType<typeof useWorkspaceProjectState>
}

export function useWorkspaceProjectResources({
  chatState,
  session,
  sourceState,
  sidebarModel,
  projectState
}: WorkspaceProjectResourcesDependencies) {
  const messageBoxNotesCwd = chatState.selectedChat
    ? session.changesProjectCwd
    : sourceState.newSessionCwd

  const messageBoxNotesVisible = Boolean(chatState.selectedChat) || sourceState.newChatOpen

  const messageBoxNotesGroup = useMemo(
    () =>
      messageBoxNotesVisible
        ? {
            key: getChatCwdGroupKey(messageBoxNotesCwd),
            cwd: messageBoxNotesCwd,
            label: getChatCwdLabel(messageBoxNotesCwd)
          }
        : null,
    [messageBoxNotesCwd, messageBoxNotesVisible]
  )

  useEffect(() => {
    const notesGroups = new Map(
      sidebarModel.activeChatGroups.map((group) => [group.key, { key: group.key, cwd: group.cwd }])
    )
    if (messageBoxNotesGroup) {
      notesGroups.set(messageBoxNotesGroup.key, {
        key: messageBoxNotesGroup.key,
        cwd: messageBoxNotesGroup.cwd
      })
    }
    const groupsToLoad = Array.from(notesGroups.values()).filter(
      (group) =>
        !(group.key in projectState.cwdNotesByGroup) &&
        !projectState.loadingCwdNotesRef.current.has(group.key)
    )
    if (groupsToLoad.length === 0) return

    groupsToLoad.forEach((group) => projectState.loadingCwdNotesRef.current.add(group.key))

    void Promise.all(
      groupsToLoad.map((group) =>
        providerApi
          .getCwdNotes('codex', group.cwd)
          .then((notes) => ({ key: group.key, notes }))
          .catch((error: unknown) => {
            console.error(
              `Unable to load notes for ${group.cwd ?? 'the default workspace'}.`,
              error
            )
            return { key: group.key, notes: [] }
          })
      )
    ).then((groupNotes) => {
      groupNotes.forEach(({ key }) => projectState.loadingCwdNotesRef.current.delete(key))

      projectState.setCwdNotesByGroup((currentNotes) => {
        const nextNotes = { ...currentNotes }
        groupNotes.forEach(({ key, notes }) => {
          nextNotes[key] = notes
        })
        return nextNotes
      })
    })
  }, [sidebarModel.activeChatGroups, projectState.cwdNotesByGroup, messageBoxNotesGroup])

  useEffect(() => {
    const entriesByKey = new Map<string, { key: string; cwd: string | null }>()
    const addProjectIconEntry = (cwd: string | null): void => {
      const key = getChatCwdGroupKey(cwd)
      if (!entriesByKey.has(key)) entriesByKey.set(key, { key, cwd })
    }

    sidebarModel.activeChatGroups.forEach((group) => addProjectIconEntry(group.cwd))
    projectState.projects.forEach((project) => addProjectIconEntry(project.cwd))
    addProjectIconEntry(sourceState.newSessionCwd)

    const projectIconEntries = Array.from(entriesByKey.values())
    const iconsToLoad = projectIconEntries.filter(
      (entry) =>
        !(entry.key in projectState.projectIconsByGroup) &&
        !projectState.loadingProjectIconsRef.current.has(entry.key)
    )
    if (iconsToLoad.length === 0) return

    iconsToLoad.forEach((entry) => projectState.loadingProjectIconsRef.current.add(entry.key))

    void Promise.all(
      iconsToLoad.map((entry) =>
        appApi
          .getProjectIcon({ cwd: entry.cwd })
          .then((icon) => ({ key: entry.key, icon }))
          .catch((error: unknown) => {
            if (isExpectedFileAbsenceError(error)) return { key: entry.key, icon: null }
            console.error(
              `Unable to load the project icon for ${entry.cwd ?? 'the home view'}.`,
              error
            )
            return { key: entry.key, icon: null }
          })
      )
    ).then((groupIcons) => {
      groupIcons.forEach(({ key }) => projectState.loadingProjectIconsRef.current.delete(key))

      projectState.setProjectIconsByGroup((currentIcons) => {
        const nextIcons = { ...currentIcons }
        groupIcons.forEach(({ key, icon }) => {
          nextIcons[key] = icon
        })
        return nextIcons
      })
    })
  }, [
    sidebarModel.activeChatGroups,
    sourceState.newSessionCwd,
    projectState.projects,
    projectState.projectIconsByGroup
  ])
  return { messageBoxNotesGroup }
}
