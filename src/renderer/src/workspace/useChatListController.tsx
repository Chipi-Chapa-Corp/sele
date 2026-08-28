import type { ProviderChat } from '../../../shared/provider'
import { type ChatListGroupData } from '../components/ChatListGroup'
import { appApi } from '../appApi'
import {
  collapseProjectGroups,
  getExpandedProjectGroupKeys,
  restoreExpandedProjectGroups
} from '../chatSidebarOrder'
import { providerApi } from '../providerApi'
import {
  getChatCwdGroupKey,
  getChatKey,
  getChatProjectCwd,
  mergeProjects
} from './chatControllerUtils'
import type { ChatListControllerDependencies } from './featureControllerDependencies'

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useChatListController(dependencies: ChatListControllerDependencies) {
  const {
    applyChatMetadata,
    removeRecentChatCacheEntry,
    selectedChat,
    chatDetail,
    showNewChatView,
    newSessionContainer,
    applyChatDetail,
    chatOrderMutationsRef,
    setChats,
    projectCollapseFrameRef,
    expandedProjectGroupsBeforeDragRef,
    draggedProjectGroupKeyRef,
    projectDropInsertionIndexRef,
    setDraggedProjectGroupKey,
    setProjectDropInsertionIndex,
    activeChatGroups,
    setCollapsedCwdGroups,
    projectOrderMutationRef,
    projects,
    setProjects,
    chatGroupingPreference,
    searchTerms,
    collapsedCwdGroups
  } = dependencies

  const handleMarkChatDone = async (chat: ProviderChat, done = true): Promise<void> => {
    try {
      const metadata = await providerApi.markChatDone(chat.providerId, chat.id, done)
      applyChatMetadata([metadata])
      if (metadata.done) removeRecentChatCacheEntry(chat.providerId, chat.id)

      if (done && selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id) {
        const currentChat = chatDetail?.id === selectedChat.id ? chatDetail : selectedChat
        showNewChatView(
          getChatProjectCwd(currentChat),
          currentChat.container ?? newSessionContainer
        )
      }
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }
  const handleRenameChat = async (chat: ProviderChat, title: string): Promise<void> => {
    const detail = await providerApi.setChatTitle(chat.providerId, chat.id, title)
    applyChatDetail(chat.providerId, detail)
  }
  const handleToggleChatPinned = async (chat: ProviderChat): Promise<void> => {
    try {
      const metadata = await providerApi.setChatPinned(chat.providerId, chat.id, !chat.pinned)
      applyChatMetadata([metadata])
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }
  const handleReorderChats = (group: ChatListGroupData, orderedChats: ProviderChat[]): void => {
    if (orderedChats.length < 2) return

    const mutationId = (chatOrderMutationsRef.current.get(group.key) ?? 0) + 1
    chatOrderMutationsRef.current.set(group.key, mutationId)
    const previousOrderByChatKey = new Map(
      orderedChats.map((chat) => [getChatKey(chat), chat.sidebarOrder])
    )
    const nextOrderByChatKey = new Map(
      orderedChats.map((chat, sidebarOrder) => [getChatKey(chat), sidebarOrder])
    )

    setChats((currentChats) =>
      currentChats.map((chat) => {
        const sidebarOrder = nextOrderByChatKey.get(getChatKey(chat))
        return sidebarOrder === undefined ? chat : { ...chat, sidebarOrder }
      })
    )

    void providerApi
      .setChatOrder(orderedChats.map((chat) => chat.id))
      .then((metadataList) => {
        if (chatOrderMutationsRef.current.get(group.key) === mutationId) {
          applyChatMetadata(metadataList)
        }
      })
      .catch(() => {
        if (chatOrderMutationsRef.current.get(group.key) !== mutationId) return

        setChats((currentChats) =>
          currentChats.map((chat) => {
            const sidebarOrder = previousOrderByChatKey.get(getChatKey(chat))
            return sidebarOrder === undefined ? chat : { ...chat, sidebarOrder }
          })
        )
      })
  }
  const restoreExpandedProjectsAfterDrag = (): void => {
    if (projectCollapseFrameRef.current !== null) {
      window.cancelAnimationFrame(projectCollapseFrameRef.current)
      projectCollapseFrameRef.current = null
    }
    const expandedProjectGroupKeys = expandedProjectGroupsBeforeDragRef.current
    expandedProjectGroupsBeforeDragRef.current = null
    draggedProjectGroupKeyRef.current = null
    projectDropInsertionIndexRef.current = null
    setDraggedProjectGroupKey(null)
    setProjectDropInsertionIndex(null)
    if (!expandedProjectGroupKeys) return

    const projectGroupKeys = activeChatGroups.map((group) => group.key)
    setCollapsedCwdGroups((currentGroups) =>
      restoreExpandedProjectGroups(currentGroups, projectGroupKeys, expandedProjectGroupKeys)
    )
  }
  const handlePersistProjectOrder = (orderedGroups: ChatListGroupData[]): void => {
    const orderedCwds = orderedGroups.flatMap((group) => (group.cwd ? [group.cwd] : []))
    if (orderedCwds.length < 2) return

    const mutationId = ++projectOrderMutationRef.current
    const reorderedAt = Date.now()
    const previousProjectsByCwd = new Map(projects.map((project) => [project.cwd, project]))
    const reorderedCwds = new Set(orderedCwds)
    const optimisticProjects = orderedCwds.map((cwd, sidebarOrder) => {
      const project = previousProjectsByCwd.get(cwd)
      return project
        ? { ...project, sidebarOrder }
        : {
            cwd,
            name: '',
            icon: null,
            additionalCwds: [],
            sidebarOrder,
            addedAt: reorderedAt,
            updatedAt: reorderedAt
          }
    })

    setProjects((currentProjects) => mergeProjects(currentProjects, optimisticProjects))

    void appApi
      .setProjectOrder(orderedCwds)
      .then((storedProjects) => {
        if (projectOrderMutationRef.current !== mutationId) return
        setProjects((currentProjects) => mergeProjects(currentProjects, storedProjects))
      })
      .catch(() => {
        if (projectOrderMutationRef.current !== mutationId) return
        setProjects((currentProjects) =>
          currentProjects.flatMap((project) => {
            if (!reorderedCwds.has(project.cwd)) return [project]
            const previousProject = previousProjectsByCwd.get(project.cwd)
            if (previousProject) {
              return [{ ...project, sidebarOrder: previousProject.sidebarOrder }]
            }
            return project.updatedAt > reorderedAt ? [project] : []
          })
        )
      })
  }
  const applyProjectDrop = (draggedProjectKey: string, dropInsertionIndex: number | null): void => {
    if (dropInsertionIndex !== null) {
      const draggedIndex = activeChatGroups.findIndex((group) => group.key === draggedProjectKey)
      if (draggedIndex >= 0) {
        const nextGroups = [...activeChatGroups]
        const [draggedGroup] = nextGroups.splice(draggedIndex, 1)
        const insertionIndex =
          draggedIndex < dropInsertionIndex ? dropInsertionIndex - 1 : dropInsertionIndex
        nextGroups.splice(insertionIndex, 0, draggedGroup)
        if (nextGroups.some((group, index) => group.key !== activeChatGroups[index]?.key)) {
          handlePersistProjectOrder(nextGroups)
        }
      }
    }
  }
  const handleProjectDragStart = (
    event: React.DragEvent<HTMLElement>,
    group: ChatListGroupData
  ): void => {
    if (group.kind !== 'cwd' || chatGroupingPreference !== 'grouped' || searchTerms.length > 0) {
      return
    }

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', group.key)
    const projectGroupKeys = activeChatGroups.map((candidate) => candidate.key)
    expandedProjectGroupsBeforeDragRef.current = getExpandedProjectGroupKeys(
      projectGroupKeys,
      collapsedCwdGroups
    )
    draggedProjectGroupKeyRef.current = group.key
    projectDropInsertionIndexRef.current = null
    setDraggedProjectGroupKey(group.key)
    setProjectDropInsertionIndex(null)
    projectCollapseFrameRef.current = window.requestAnimationFrame(() => {
      projectCollapseFrameRef.current = null
      if (draggedProjectGroupKeyRef.current !== group.key) return
      setCollapsedCwdGroups((currentGroups) =>
        collapseProjectGroups(currentGroups, projectGroupKeys)
      )
    })
  }
  const handleProjectStackDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!draggedProjectGroupKeyRef.current) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const projectElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(':scope > [data-project-group-key]')
    )
    let insertionIndex = projectElements.length

    for (let index = 0; index < projectElements.length; index += 1) {
      const bounds = projectElements[index].getBoundingClientRect()
      if (event.clientY < bounds.top + bounds.height / 2) {
        insertionIndex = index
        break
      }
    }

    projectDropInsertionIndexRef.current = insertionIndex
    setProjectDropInsertionIndex(insertionIndex)
  }
  const handleProjectDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    const draggedProjectKey = draggedProjectGroupKeyRef.current
    if (!draggedProjectKey) return

    event.preventDefault()
    event.stopPropagation()
    applyProjectDrop(draggedProjectKey, projectDropInsertionIndexRef.current)
    restoreExpandedProjectsAfterDrag()
  }
  const handleUnpinPinnedChats = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'pinned') return

    try {
      const metadataList = await Promise.all(
        group.chats.map((chat) => providerApi.setChatPinned(chat.providerId, chat.id, false))
      )
      applyChatMetadata(metadataList)
    } catch {
      // Leave the group as-is if local metadata cannot be updated.
    }
  }
  const handleMarkCwdChatsDone = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'cwd') return

    try {
      const providerIds = Array.from(new Set(group.chats.map((chat) => chat.providerId)))
      const groupCwds = Array.from(new Set(group.chats.map((chat) => chat.cwd ?? null)))
      const metadataGroups = await Promise.all(
        providerIds.flatMap((providerId) =>
          groupCwds.map((cwd) => providerApi.markCwdChatsDone(providerId, cwd))
        )
      )
      applyChatMetadata(metadataGroups.flat())

      if (
        selectedChat &&
        !selectedChat.done &&
        getChatCwdGroupKey(getChatProjectCwd(selectedChat)) === getChatCwdGroupKey(group.cwd)
      ) {
        const currentChat = chatDetail?.id === selectedChat.id ? chatDetail : selectedChat
        showNewChatView(group.cwd, currentChat.container ?? newSessionContainer)
      }
    } catch {
      // Leave the group as-is if local metadata cannot be updated.
    }
  }

  return {
    handleMarkChatDone,
    handleMarkCwdChatsDone,
    handleProjectDragStart,
    handleProjectDrop,
    handleProjectStackDragOver,
    handleRenameChat,
    handleReorderChats,
    handleToggleChatPinned,
    handleUnpinPinnedChats,
    restoreExpandedProjectsAfterDrag
  }
}
