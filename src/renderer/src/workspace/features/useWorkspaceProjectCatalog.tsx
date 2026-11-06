import { FolderKanban, MessageSquare, Trash2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import type { AppProject } from '../../../../shared/app'
import { isNoProjectCwd } from '../../../../shared/noProject'
import { appApi } from '../../appApi'
import type { DropdownOption } from '../../components/Dropdown'
import { getProjectDisplayName, renderProjectGlyph } from '../../projectPresentation'
import {
  getChatCwdGroupKey,
  getChatProjectCwd,
  getErrorMessage,
  getFolderDescription,
  getFolderName
} from '../chatControllerUtils'
import { newSessionNoProjectValue, newSessionProjectPlaceholderValue } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspaceProjectCatalogDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
}

export function useWorkspaceProjectCatalog({
  chatState,
  projectState,
  sourceState
}: WorkspaceProjectCatalogDependencies) {
  // Chat summaries change on every switch (seen times) and update. The project
  // options only depend on each project's latest chat, so rebuild them, with
  // their icon elements, only when that changes.
  const chatProjectCreatedAtKey = useMemo(() => {
    const latestCreatedAtByCwd = new Map<string, number>()
    for (const chat of chatState.chats) {
      if (chat.imported) continue
      const cwd = getChatProjectCwd(chat)?.trim()
      if (!cwd || isNoProjectCwd(cwd)) continue
      latestCreatedAtByCwd.set(cwd, Math.max(latestCreatedAtByCwd.get(cwd) ?? 0, chat.createdAt))
    }
    // Streaming changes sidebar order without changing a project's newest chat.
    return JSON.stringify(
      [...latestCreatedAtByCwd].sort(([first], [second]) => first.localeCompare(second))
    )
  }, [chatState.chats])

  const handleDeleteProject = useCallback(async (cwd: string, name: string): Promise<void> => {
    if (
      projectState.deletingProjectRef.current ||
      !window.confirm(
        `Remove the project “${name}” from the project list? Its files and chats will be kept.`
      )
    )
      return

    projectState.deletingProjectRef.current = true
    projectState.setDeletingProject(true)
    chatState.setSendError(null)
    try {
      await appApi.deleteProject(cwd)
      projectState.setProjects((current) => current.filter((project) => project.cwd !== cwd))
      projectState.setDeletedProjectCwds((current) => new Set([...current, cwd]))
      sourceState.setNewSessionProjectSelection((current) =>
        current === cwd ? newSessionNoProjectValue : current
      )
    } catch (error) {
      console.error('Unable to remove the project.', error)
      chatState.setSendError(getErrorMessage(error, 'Unable to remove the project.'))
    } finally {
      projectState.deletingProjectRef.current = false
      projectState.setDeletingProject(false)
    }
  }, [])

  const projectOptions = useMemo<DropdownOption<string>[]>(() => {
    const projectsByCwd = new Map<
      string,
      { cwd: string; latestChatCreatedAt: number; project: AppProject | null }
    >()

    const addProject = (
      cwd: string | null,
      latestChatCreatedAt: number,
      project: AppProject | null = null
    ): void => {
      const normalizedCwd = cwd?.trim()
      if (
        !normalizedCwd ||
        isNoProjectCwd(normalizedCwd) ||
        projectState.deletedProjectCwds.has(normalizedCwd)
      )
        return

      const existingProject = projectsByCwd.get(normalizedCwd)
      if (!existingProject || latestChatCreatedAt > existingProject.latestChatCreatedAt) {
        projectsByCwd.set(normalizedCwd, {
          cwd: normalizedCwd,
          latestChatCreatedAt,
          project: project ?? existingProject?.project ?? null
        })
      }
    }

    // History affects recency, but only explicitly added projects are choices.
    const latestCreatedAtByCwd = new Map<string, number>(JSON.parse(chatProjectCreatedAtKey))
    projectState.projects.forEach((project) => {
      if (!project.orderOnly)
        addProject(project.cwd, latestCreatedAtByCwd.get(project.cwd) ?? 0, project)
    })

    const getProjectOptionIcon = (
      cwd: string | null,
      project: AppProject | null = null
    ): React.ReactElement => {
      const projectImage = projectState.projectIconsByGroup[getChatCwdGroupKey(cwd)]
      const usesProjectImage = project?.icon === 'image' || project?.icon == null

      if (usesProjectImage && projectImage?.dataUrl) {
        return <img src={projectImage.dataUrl} alt="" />
      }
      if (project?.icon && project.icon !== 'image') return renderProjectGlyph(project.icon)
      return <FolderKanban aria-hidden="true" />
    }

    const options = Array.from(projectsByCwd.values())
      .sort((firstProject, secondProject) => {
        if (secondProject.latestChatCreatedAt !== firstProject.latestChatCreatedAt) {
          return secondProject.latestChatCreatedAt - firstProject.latestChatCreatedAt
        }

        return getFolderName(firstProject.cwd).localeCompare(getFolderName(secondProject.cwd))
      })
      .map((project) => ({
        value: project.cwd,
        label: project.project
          ? getProjectDisplayName(project.project)
          : getFolderName(project.cwd),
        menuLabel: project.project
          ? getProjectDisplayName(project.project)
          : getFolderName(project.cwd),
        description: getFolderDescription(project.cwd),
        icon: getProjectOptionIcon(project.cwd, project.project),
        inlineActions: [
          {
            id: 'delete-project',
            closeOnSelect: false,
            ariaLabel: `Remove project ${project.project ? getProjectDisplayName(project.project) : getFolderName(project.cwd)}`,
            title: 'Remove project',
            icon: <Trash2 aria-hidden="true" />,
            disabled: projectState.deletingProject,
            callback: () =>
              handleDeleteProject(
                project.cwd,
                project.project
                  ? getProjectDisplayName(project.project)
                  : getFolderName(project.cwd)
              )
          }
        ]
      }))

    return [
      {
        value: newSessionNoProjectValue,
        label: 'No Project',
        icon: <MessageSquare aria-hidden="true" />
      },
      ...(!sourceState.newSessionCwd && !sourceState.newSessionNoProject
        ? [
            {
              value: newSessionProjectPlaceholderValue,
              label: 'Choose folder',
              icon: getProjectOptionIcon(null),
              disabled: true
            }
          ]
        : []),
      ...options
    ]
  }, [
    chatProjectCreatedAtKey,
    sourceState.newSessionCwd,
    sourceState.newSessionNoProject,
    projectState.projects,
    projectState.projectIconsByGroup,
    projectState.deletedProjectCwds,
    projectState.deletingProject,
    handleDeleteProject
  ])

  const newSessionProjectValue = sourceState.newSessionNoProject
    ? newSessionNoProjectValue
    : (sourceState.newSessionCwd ?? newSessionProjectPlaceholderValue)
  return { projectOptions, newSessionProjectValue }
}
