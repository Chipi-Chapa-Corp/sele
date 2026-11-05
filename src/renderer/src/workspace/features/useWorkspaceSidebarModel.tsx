import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { AppContainerTarget, AppProject } from '../../../../shared/app'
import { noProjectGroupKey } from '../../../../shared/noProject'
import type { ProviderChat } from '../../../../shared/provider'
import { matchesChatSidebarFilter } from '../../chatSidebarFilter'
import { reuseChatGroups } from '../../chatSidebarGroups'
import { getChatSleepKey } from '../../chatSleep'
import { type ChatListGroupData } from '../../components/ChatListGroup'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerSelection'
import { getProjectDisplayName } from '../../projectPresentation'
import {
  getChatCwdLabel,
  getChatKey,
  getChatProjectCwd,
  groupChatsForSidebar,
  mergeChats,
  sortChatsForGroup
} from '../chatControllerUtils'
import { activeGroupKey, allDoneProjectsValue, doneGroupKey } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useSidebarSearch } from '../useSidebarSearch'
import { useWorkspaceChatReadState } from './useWorkspaceChatReadState'

import type { useWorkspaceSession } from '../wiring/useWorkspaceSession'
type WorkspaceSidebarModelDependencies = {
  searchState: ReturnType<typeof useWorkspaceSearchState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  projectRecordsByCwd: Map<string, AppProject>
  session: Pick<
    ReturnType<typeof useWorkspaceSession>,
    'latestCommitFinishedAtByChatKey' | 'committingChatKeys'
  >
}

export function useWorkspaceSidebarModel({
  searchState,
  sourceState,
  chatState,
  chatRead,
  subagentState,
  projectState,
  projectRecordsByCwd,
  session
}: WorkspaceSidebarModelDependencies) {
  const { latestCommitFinishedAtByChatKey, committingChatKeys } = session

  const searchTerms = useMemo(
    () => searchState.searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean),
    [searchState.searchQuery]
  )

  const codexSearchSources = useMemo(() => {
    const sources = new Map<string, AppContainerTarget | null>()
    if (sourceState.newSessionAvailableProviderIds.includes('codex')) {
      sources.set(
        getContainerTargetKey(sourceState.newSessionContainer),
        normalizeContainerTarget(sourceState.newSessionContainer)
      )
    }
    for (const chat of chatState.chats) {
      if (chat.providerId === 'codex')
        sources.set(getContainerTargetKey(chat.container), chat.container)
    }
    return [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, source]) => source)
  }, [chatState.chats, sourceState.newSessionAvailableProviderIds, sourceState.newSessionContainer])

  const sidebarSearch = useSidebarSearch(
    searchState.searchQuery,
    codexSearchSources,
    searchState.searchOpen
  )

  useEffect(() => {
    if (!sidebarSearch.chats.length) return
    // Newly discovered threads must participate in ordinary metadata actions and selection.
    chatState.setChats((current) => {
      const known = new Set(current.map(getChatKey))
      const discovered = sidebarSearch.chats.filter((chat) => !known.has(getChatKey(chat)))
      return discovered.length ? mergeChats(current, discovered) : current
    })
  }, [sidebarSearch.chats, chatState.setChats])

  const nativeSidebarSearchKeys = useMemo(
    () => new Set(sidebarSearch.chats.map(getChatKey)),
    [sidebarSearch.chats]
  )

  const matchesChatSearch = useCallback(
    (chat: ProviderChat): boolean => {
      if (nativeSidebarSearchKeys.has(getChatKey(chat))) return true
      const title = chat.title.toLocaleLowerCase()
      const cwd = chat.cwd?.toLocaleLowerCase() ?? ''
      const cwdLabel = getChatCwdLabel(chat.cwd).toLocaleLowerCase()
      return searchTerms.every(
        (term) => title.includes(term) || cwd.includes(term) || cwdLabel.includes(term)
      )
    },
    [searchTerms, nativeSidebarSearchKeys]
  )

  const isSleepingChat = useCallback(
    (chat: ProviderChat): boolean =>
      chatState.sleepingChats.has(getChatSleepKey(chat.providerId, chat.id)),
    [chatState.sleepingChats]
  )

  const handleMarkChatRead = useCallback(
    (chat: ProviderChat, read: boolean): void => {
      const key = getChatKey(chat)
      if (read) {
        chatRead.markChatSeenAt(
          chat.providerId,
          chat.id,
          Math.max(Date.now(), chat.updatedAt, latestCommitFinishedAtByChatKey.get(key) ?? 0)
        )
      }
      chatState.setManuallyUnreadChatKeys((current) => {
        if (current.has(key) === !read) return current
        const next = new Set(current)
        if (read) next.delete(key)
        else next.add(key)
        return next
      })
    },
    [chatRead.markChatSeenAt, latestCommitFinishedAtByChatKey, chatState.setManuallyUnreadChatKeys]
  )

  const chatReadState = useMemo(
    () => ({
      manuallyUnreadChatKeys: chatState.manuallyUnreadChatKeys,
      onMarkRead: handleMarkChatRead
    }),
    [chatState.manuallyUnreadChatKeys, handleMarkChatRead]
  )

  const matchesSidebarFilter = useCallback(
    (chat: ProviderChat): boolean => {
      const key = getChatKey(chat)
      return matchesChatSidebarFilter(chat, chatState.activeChatSidebarFilter, {
        sleeping: isSleepingChat(chat),
        working: committingChatKeys.has(key) || subagentState.workingSubagentChatKeys.has(key),
        tabs: chatState.chatSidebarTabs
      })
    },
    [
      chatState.activeChatSidebarFilter,
      isSleepingChat,
      chatState.chatSidebarTabs,
      committingChatKeys,
      subagentState.workingSubagentChatKeys
    ]
  )

  const filteredChats = useMemo(() => {
    const tabChats = chatState.chats.filter(matchesSidebarFilter)
    if (searchTerms.length === 0) return tabChats
    const matching = new Map(
      tabChats.filter(matchesChatSearch).map((chat) => [getChatKey(chat), chat])
    )
    for (const chat of sidebarSearch.chats) {
      if (!matchesSidebarFilter(chat)) continue
      if (!matching.has(getChatKey(chat))) matching.set(getChatKey(chat), chat)
    }
    return [...matching.values()]
  }, [chatState.chats, matchesSidebarFilter, matchesChatSearch, searchTerms, sidebarSearch.chats])

  const projectNamesByCwd = useMemo(
    () =>
      new Map(
        projectState.projects.map((project) => [project.cwd, getProjectDisplayName(project)])
      ),
    [projectState.projects]
  )

  const previousChatGroupsRef = useRef<ChatListGroupData[]>([])

  const chatGroups = useMemo(
    () =>
      reuseChatGroups(
        groupChatsForSidebar(filteredChats, projectRecordsByCwd, previousChatGroupsRef.current).map(
          (group) => {
            if (group.kind !== 'cwd' || !group.cwd) return group

            const project = projectRecordsByCwd.get(group.cwd)
            return project ? { ...group, projectName: getProjectDisplayName(project) } : group
          }
        ),
        previousChatGroupsRef.current
      ),
    [filteredChats, projectRecordsByCwd]
  )

  useLayoutEffect(() => {
    previousChatGroupsRef.current = chatGroups
  }, [chatGroups])

  const importedChatGroup = chatGroups.find((group) => group.kind === 'imported') ?? null

  const pinnedChatGroup = chatGroups.find((group) => group.kind === 'pinned') ?? null

  const activeChatGroups = useMemo(() => {
    const general = chatGroups.find(
      (group) => group.key === noProjectGroupKey && group.chats.length > 0
    )
    return [
      ...(general ? [general] : []),
      ...chatGroups.filter((group) => group.kind === 'cwd' && group.key !== noProjectGroupKey)
    ]
  }, [chatGroups])

  const generalChatGroups = activeChatGroups.filter((group) => group.key === noProjectGroupKey)

  const projectChatGroups = activeChatGroups.filter((group) => group.key !== noProjectGroupKey)

  const displayedActiveChatGroups =
    projectState.chatGroupingPreference === 'grouped' || activeChatGroups.length === 0
      ? activeChatGroups
      : [
          ...generalChatGroups,
          ...(projectChatGroups.length > 0
            ? [
                {
                  key: activeGroupKey,
                  cwd: null,
                  label: 'Active',
                  chats: sortChatsForGroup(projectChatGroups.flatMap((group) => group.chats)),
                  kind: 'active' as const
                }
              ]
            : [])
        ]

  const unfilteredDoneChatGroup = chatGroups.find((group) => group.kind === 'done') ?? null

  const doneChatGroup = useMemo(
    () =>
      projectState.doneProjectFilterValue === allDoneProjectsValue
        ? unfilteredDoneChatGroup
        : {
            key: doneGroupKey,
            cwd: null,
            label: 'Done',
            kind: 'done' as const,
            chats: (unfilteredDoneChatGroup?.chats ?? []).filter(
              (chat) => getChatProjectCwd(chat) === projectState.doneProjectFilterValue
            )
          },
    [projectState.doneProjectFilterValue, unfilteredDoneChatGroup]
  )
  return {
    searchTerms,
    sidebarSearch,
    chatReadState,
    filteredChats,
    projectNamesByCwd,
    importedChatGroup,
    pinnedChatGroup,
    activeChatGroups,
    displayedActiveChatGroups,
    doneChatGroup
  }
}
