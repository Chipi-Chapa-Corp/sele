import type { AppProject } from '../../shared/app'
import type { ProviderChat } from '../../shared/provider'

type SidebarOrderedChat = Pick<ProviderChat, 'providerId' | 'id' | 'createdAt' | 'sidebarOrder'>

const getChatKey = (chat: SidebarOrderedChat): string => `${chat.providerId}:${chat.id}`

export const compareChatsBySidebarOrder = (
  firstChat: SidebarOrderedChat,
  secondChat: SidebarOrderedChat
): number => {
  if (firstChat.sidebarOrder !== null && secondChat.sidebarOrder !== null) {
    const orderDifference = firstChat.sidebarOrder - secondChat.sidebarOrder
    if (orderDifference !== 0) return orderDifference
  } else if (firstChat.sidebarOrder === null && secondChat.sidebarOrder !== null) {
    return -1
  } else if (firstChat.sidebarOrder !== null && secondChat.sidebarOrder === null) {
    return 1
  }

  if (secondChat.createdAt !== firstChat.createdAt) {
    return secondChat.createdAt - firstChat.createdAt
  }

  return getChatKey(firstChat).localeCompare(getChatKey(secondChat))
}

export const sortChatsForSidebarSection = <Chat extends SidebarOrderedChat>(
  chats: Chat[]
): Chat[] => [...chats].sort(compareChatsBySidebarOrder)

type SidebarProjectGroup = {
  key: string
  cwd: string | null
  label: string
}

type SidebarProjectRecord = Pick<AppProject, 'addedAt' | 'sidebarOrder'>

const getProjectAddedAt = (
  group: SidebarProjectGroup,
  projectsByCwd: ReadonlyMap<string, SidebarProjectRecord>
): number | null => {
  if (!group.cwd) return null
  const addedAt = projectsByCwd.get(group.cwd)?.addedAt
  return typeof addedAt === 'number' && Number.isFinite(addedAt) ? addedAt : null
}

export const sortProjectGroupsForSidebar = <Group extends SidebarProjectGroup>(
  groups: Group[],
  projectsByCwd: ReadonlyMap<string, SidebarProjectRecord>
): Group[] =>
  [...groups].sort((firstGroup, secondGroup) => {
    const firstOrder = firstGroup.cwd
      ? (projectsByCwd.get(firstGroup.cwd)?.sidebarOrder ?? null)
      : null
    const secondOrder = secondGroup.cwd
      ? (projectsByCwd.get(secondGroup.cwd)?.sidebarOrder ?? null)
      : null

    if (firstOrder !== null && secondOrder !== null && firstOrder !== secondOrder) {
      return firstOrder - secondOrder
    }
    if (firstOrder === null && secondOrder !== null) return -1
    if (firstOrder !== null && secondOrder === null) return 1

    const firstAddedAt = getProjectAddedAt(firstGroup, projectsByCwd)
    const secondAddedAt = getProjectAddedAt(secondGroup, projectsByCwd)

    if (firstAddedAt !== null && secondAddedAt !== null && firstAddedAt !== secondAddedAt) {
      return secondAddedAt - firstAddedAt
    }
    if (firstAddedAt === null && secondAddedAt !== null) return 1
    if (firstAddedAt !== null && secondAddedAt === null) return -1

    const labelDifference = firstGroup.label.localeCompare(secondGroup.label)
    return labelDifference || firstGroup.key.localeCompare(secondGroup.key)
  })

export const getExpandedProjectGroupKeys = (
  projectGroupKeys: string[],
  collapsedGroups: Readonly<Record<string, boolean>>
): Set<string> => new Set(projectGroupKeys.filter((groupKey) => collapsedGroups[groupKey] !== true))

export const collapseProjectGroups = (
  collapsedGroups: Readonly<Record<string, boolean>>,
  projectGroupKeys: string[]
): Record<string, boolean> => {
  const nextGroups = { ...collapsedGroups }
  projectGroupKeys.forEach((groupKey) => {
    nextGroups[groupKey] = true
  })
  return nextGroups
}

export const restoreExpandedProjectGroups = (
  collapsedGroups: Readonly<Record<string, boolean>>,
  projectGroupKeys: string[],
  expandedProjectGroupKeys: ReadonlySet<string>
): Record<string, boolean> => {
  const nextGroups = { ...collapsedGroups }
  projectGroupKeys.forEach((groupKey) => {
    nextGroups[groupKey] = !expandedProjectGroupKeys.has(groupKey)
  })
  return nextGroups
}
