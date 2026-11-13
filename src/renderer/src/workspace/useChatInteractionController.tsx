// biome-ignore-all lint/correctness/useExhaustiveDependencies: controller refs and state setters are stable inputs
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { FolderKanban, FolderTree } from 'lucide-react'
import type { ProviderMessage } from '../../../shared/provider'
import {
  ChatListGroup,
  type ChatListGroupData,
  type ChatListGroupProps
} from '../components/ChatListGroup'
import { Dropdown } from '../components/Dropdown'
import { providerApi } from '../providerApi'
import { renderProjectGlyph } from '../projectPresentation'
import { isScrolledToBottom, readChatScrollAnchor } from '../chatLayout'
import {
  getChatKey,
  getChatCwdGroupKey,
  getCollapsedGroupState,
  hasActiveWorkingStep,
  hasPendingSteeringMessage,
  isActiveChatStatus
} from './chatControllerUtils'
import { allDoneProjectsValue } from './controllerTypes'
import type { useWorkspaceChatErrors } from './features/useWorkspaceChatErrors'
import type { useWorkspaceProjectCatalog } from './features/useWorkspaceProjectCatalog'
import type { useWorkspaceNavigation } from './features/useWorkspaceNavigation'
import type { useWorkspaceSidebarActions } from './features/useWorkspaceSidebarActions'
import type { useWorkspaceSidebarModel } from './features/useWorkspaceSidebarModel'
import type { useWorkspaceProjectState } from './state/useWorkspaceProjectState'
import type { useChatListController } from './useChatListController'
import type { useChatMessagingController } from './useChatMessagingController'
import type { useWorkspaceSelection } from './useWorkspaceSelection'
import { useLatestHandler, useShallowStable } from './stableProps'
import type { WorkspaceSession } from './useWorkspaceSelection'

type ChatGroupRenderInputs = Pick<
  ReturnType<typeof useWorkspaceSidebarModel>,
  'searchTerms' | 'activeChatGroups' | 'projectNamesByCwd'
> &
  Pick<
    ReturnType<typeof useWorkspaceProjectState>,
    | 'collapsedCwdGroups'
    | 'visibleChatPageCountsByGroup'
    | 'chatGroupingPreference'
    | 'projectDropInsertionIndex'
    | 'doneProjectFilterValue'
    | 'draggedProjectGroupKey'
  > &
  Pick<ReturnType<typeof useWorkspaceSidebarActions>, 'handleDoneProjectFilterChange'> &
  Pick<ReturnType<typeof useWorkspaceProjectCatalog>, 'projectOptions'> &
  Pick<
    ReturnType<typeof useWorkspaceSelection>,
    'committingChatKeys' | 'latestCommitFinishedAtByChatKey' | 'resolvingApprovalId'
  > & {
    chatPageSize: number
    selectedChatKey: string | null
    projectIconsByCwd: Map<string, React.ReactElement>
    sidebarActions: SidebarActions
  }

type SidebarActions = Required<{
  [Name in keyof ChatListGroupProps as Name extends `on${string}`
    ? Name
    : never]: ChatListGroupProps[Name]
}>

// Module scope keeps this pure: everything it shows comes from `inputs`, so the
// memoized sidebar rerenders exactly when one of those inputs changes.
const renderChatListGroup = (
  inputs: ChatGroupRenderInputs,
  group: ChatListGroupData,
  selectedChatChildren: React.ReactNode = null,
  selectedChatChildOpen = false,
  workingSubagentChatKeys?: ReadonlySet<string>
): React.ReactElement => {
  const {
    searchTerms,
    collapsedCwdGroups,
    chatPageSize,
    visibleChatPageCountsByGroup,
    activeChatGroups,
    chatGroupingPreference,
    projectDropInsertionIndex,
    doneProjectFilterValue,
    handleDoneProjectFilterChange,
    projectOptions,
    selectedChatKey,
    committingChatKeys,
    latestCommitFinishedAtByChatKey,
    draggedProjectGroupKey,
    projectNamesByCwd,
    projectIconsByCwd,
    sidebarActions,
    resolvingApprovalId
  } = inputs
  const groupOpen = searchTerms.length > 0 || !getCollapsedGroupState(group.key, collapsedCwdGroups)
  const visibleChatCount =
    group.kind === 'pinned'
      ? group.chats.length
      : (visibleChatPageCountsByGroup[group.key] ?? 1) * chatPageSize
  const projectGroupIndex = activeChatGroups.findIndex((candidate) => candidate.key === group.key)
  const projectDraggable =
    group.kind === 'cwd' &&
    chatGroupingPreference === 'grouped' &&
    searchTerms.length === 0 &&
    projectGroupIndex >= 0
  const projectDropPosition =
    projectDraggable && projectDropInsertionIndex === projectGroupIndex
      ? 'before'
      : projectDraggable &&
          projectGroupIndex === activeChatGroups.length - 1 &&
          projectDropInsertionIndex === activeChatGroups.length
        ? 'after'
        : null
  const doneProjectFilter =
    group.kind === 'done' && groupOpen ? (
      <span className="chat-list-group__done-filter">
        <Dropdown
          fill
          emptyContent="No matching projects"
          icon={
            doneProjectFilterValue === allDoneProjectsValue ? (
              <FolderTree aria-hidden="true" />
            ) : undefined
          }
          menuActions={[
            {
              id: 'all-projects',
              label: 'All projects',
              icon: <FolderTree aria-hidden="true" />,
              callback: () => handleDoneProjectFilterChange(allDoneProjectsValue)
            }
          ]}
          options={projectOptions}
          placement="top"
          searchable
          searchPlaceholder="Search projects"
          size="small"
          value={doneProjectFilterValue}
          valueLabel={doneProjectFilterValue === allDoneProjectsValue ? 'All projects' : undefined}
          aria-label="Filter done chats by project"
          onChange={handleDoneProjectFilterChange}
        />
      </span>
    ) : null
  const doneProjectFilterEmptyContent =
    group.kind !== 'done' || group.chats.length > 0 ? null : (
      <p className="chat-list-group__empty">
        {searchTerms.length > 0
          ? 'No matching done chats in this project.'
          : 'No done chats in this project.'}
      </p>
    )

  return (
    <ChatListGroup
      group={group}
      key={group.key}
      open={groupOpen}
      selectedChatKey={
        selectedChatKey && group.chats.some((chat) => getChatKey(chat) === selectedChatKey)
          ? selectedChatKey
          : null
      }
      workingSubagentChatKeys={workingSubagentChatKeys}
      committingChatKeys={committingChatKeys}
      latestCommitFinishedAtByChatKey={latestCommitFinishedAtByChatKey}
      canReorderChats={group.kind !== 'done' && searchTerms.length === 0}
      projectDraggable={projectDraggable}
      projectDragging={group.key === draggedProjectGroupKey}
      projectDropPosition={projectDropPosition}
      visibleChatCount={visibleChatCount}
      chatPageSize={chatPageSize}
      emptyContent={doneProjectFilterEmptyContent}
      headerAction={doneProjectFilter}
      projectNamesByCwd={projectNamesByCwd}
      projectIconsByCwd={projectIconsByCwd}
      {...sidebarActions}
      onLoadMoreChats={group.kind === 'pinned' ? undefined : sidebarActions.onLoadMoreChats}
      onShowLessChats={group.kind === 'pinned' ? undefined : sidebarActions.onShowLessChats}
      projectIcon={projectIconsByCwd.get(group.cwd ?? '')}
      onProjectDragEnd={projectDraggable ? sidebarActions.onProjectDragEnd : undefined}
      onProjectDragStart={projectDraggable ? sidebarActions.onProjectDragStart : undefined}
      resolvingApprovalId={resolvingApprovalId}
      selectedChatChildren={selectedChatChildren}
      selectedChatChildOpen={selectedChatChildOpen}
    />
  )
}

// Return shape is inferred from the controller declarations below.
export function useChatInteractionController({
  viewportState,
  chatState,
  scroll,
  sidebarModel,
  projectState,
  settings,
  projectRecordsByCwd,
  projectCatalog,
  session,
  sidebarActions: sidebarActionHandlers,
  listActions,
  navigation,
  messaging,
  chatRead,
  chatErrors
}: WorkspaceSession & {
  sidebarModel: ReturnType<typeof useWorkspaceSidebarModel>
  projectCatalog: ReturnType<typeof useWorkspaceProjectCatalog>
  sidebarActions: ReturnType<typeof useWorkspaceSidebarActions>
  listActions: ReturnType<typeof useChatListController>
  navigation: ReturnType<typeof useWorkspaceNavigation>
  messaging: ReturnType<typeof useChatMessagingController>
  chatErrors: ReturnType<typeof useWorkspaceChatErrors>
}) {
  const {
    contentRef,
    chatScrollAdjustmentTargetRef,
    previousChatScrollTopRef,
    chatTurnScrollDirectionRef,
    chatViewportAnchorRef,
    chatAutoScrollEnabledRef,
    chatUserScrollIntentRef,
    chatAutoScrollTargetRef,
    chatUserScrollIntentFrameRef
  } = viewportState
  const {
    chatTurnWindowRef,
    setChatAtConversationBottom,
    selectedChat,
    chatDetail,
    sendState,
    forkInFlightRef,
    setSendState,
    setSendError,
    setForkingMessageId,
    setMessageBoxQuoteRequest,
    runPromptActionRef
  } = chatState
  const { scheduleChatAutoScroll } = scroll
  const { searchTerms, activeChatGroups, projectNamesByCwd } = sidebarModel
  const {
    collapsedCwdGroups,
    visibleChatPageCountsByGroup,
    projectIconsByGroup,
    chatGroupingPreference,
    doneProjectFilterValue,
    projectDropInsertionIndex,
    draggedProjectGroupKey
  } = projectState
  const { effectiveAppSettings } = settings
  const { projectOptions } = projectCatalog
  const { committingChatKeys, latestCommitFinishedAtByChatKey, resolvingApprovalId } = session
  const {
    handleDoneProjectFilterChange,
    handleLoadMoreChatsInGroup,
    handleShowLessChatsInGroup,
    handleSelectProjectIcon,
    handleToggleCwdGroup
  } = sidebarActionHandlers
  const {
    handleMarkChatDone,
    restoreExpandedProjectsAfterDrag,
    handleProjectDragStart,
    handleMarkCwdChatsDone,
    handleRenameChat,
    handleReorderChats,
    handleToggleChatPinned,
    handleUnpinPinnedChats
  } = listActions
  const { handleNewChatInCwd, handleSelectChat } = navigation
  const { handleSendMessage, handleResolveChatApproval } = messaging
  const { applyViewedChatDetail } = chatRead
  const { handleSendFailure } = chatErrors

  // Memoized groups must always invoke handlers from the latest committed workspace.
  const sidebarHandlers = {
    onLoadMoreChats: handleLoadMoreChatsInGroup,
    onShowLessChats: handleShowLessChatsInGroup,
    onMarkChatDone: handleMarkChatDone,
    onProjectDragEnd: restoreExpandedProjectsAfterDrag,
    onProjectDragStart: handleProjectDragStart,
    onMarkCwdChatsDone: handleMarkCwdChatsDone,
    onNewChatInCwd: handleNewChatInCwd,
    onRenameChat: handleRenameChat,
    onSelectProjectIcon: handleSelectProjectIcon,
    onResolveApproval: handleResolveChatApproval,
    onReorderChats: handleReorderChats,
    onSelectChat: handleSelectChat,
    onToggle: handleToggleCwdGroup,
    onToggleChatPinned: handleToggleChatPinned,
    onUnpinPinnedChats: handleUnpinPinnedChats
  }
  const sidebarActionsRef = useRef<Record<string, (...args: never[]) => unknown>>(sidebarHandlers)
  useLayoutEffect(() => {
    sidebarActionsRef.current = sidebarHandlers
  })
  const sidebarActions = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(sidebarHandlers).map((name) => [
          name,
          (...args: never[]) => sidebarActionsRef.current[name](...args)
        ])
      ) as typeof sidebarHandlers,
    []
  )

  // Chat summaries and selection change far more often than project icons.
  // Depend on the directory set, not the freshly grouped chat objects: new icon
  // elements otherwise invalidate every memoized sidebar row on every update.
  const projectCwdsKey = JSON.stringify(
    [
      ...new Set([...projectRecordsByCwd.keys(), ...activeChatGroups.map((group) => group.cwd)])
    ].sort()
  )
  // Removing the last active chat changes the directory set. Reuse each
  // unchanged icon across that rebuild (and across asynchronous icon replies),
  // otherwise its new React element defeats every ChatListRow's memoization.
  const committedProjectIconsRef = useRef(
    new Map<string, { signature: string; element: React.ReactElement }>()
  )
  const { icons: projectIconsByCwd, cache: projectIconCache } = useMemo(() => {
    const cwds = JSON.parse(projectCwdsKey) as (string | null)[]
    const icons = new Map<string, React.ReactElement>()
    const cache = new Map<string, { signature: string; element: React.ReactElement }>()
    for (const cwd of cwds) {
      const project = cwd ? projectRecordsByCwd.get(cwd) : null
      const projectImage = projectIconsByGroup[getChatCwdGroupKey(cwd)]
      const dataUrl =
        project?.icon === 'image' || project?.icon == null ? projectImage?.dataUrl : null
      const glyph = project?.icon && project.icon !== 'image' ? project.icon : null
      const signature = JSON.stringify([dataUrl ?? null, glyph])
      const previous = committedProjectIconsRef.current.get(cwd ?? '')
      const element =
        previous?.signature === signature ? (
          previous.element
        ) : dataUrl ? (
          <img className="chat-list-group__project-icon-image" src={dataUrl} alt="" />
        ) : glyph ? (
          renderProjectGlyph(glyph)
        ) : (
          <FolderKanban aria-hidden="true" />
        )
      icons.set(cwd ?? '', element)
      cache.set(cwd ?? '', { signature, element })
    }
    return { icons, cache }
  }, [projectCwdsKey, projectRecordsByCwd, projectIconsByGroup])
  // Publish only committed values so an interrupted render cannot replace the
  // elements used to compare the next update. The cache retains current cwds only.
  useLayoutEffect(() => {
    committedProjectIconsRef.current = projectIconCache
  }, [projectIconCache])

  const handleChatContentScroll = (): boolean => {
    const contentElement = contentRef.current
    if (!contentElement) return false

    const currentTurnWindow = chatTurnWindowRef.current
    const adjustmentTarget = chatScrollAdjustmentTargetRef.current
    const isScrollAdjustment = Boolean(
      adjustmentTarget?.element === contentElement &&
        Math.abs(adjustmentTarget.top - contentElement.scrollTop) <= 1
    )
    if (adjustmentTarget?.element === contentElement) {
      chatScrollAdjustmentTargetRef.current = null
    }

    const autoScrollTarget = chatAutoScrollTargetRef.current
    const isAutoScroll = Boolean(
      !chatUserScrollIntentRef.current &&
        autoScrollTarget?.element === contentElement &&
        Math.abs(autoScrollTarget.top - contentElement.scrollTop) <= 1
    )
    const previousScrollTop = previousChatScrollTopRef.current
    if (
      !isScrollAdjustment &&
      !isAutoScroll &&
      previousScrollTop !== null &&
      Math.abs(contentElement.scrollTop - previousScrollTop) >= 0.5
    ) {
      chatTurnScrollDirectionRef.current =
        contentElement.scrollTop < previousScrollTop ? 'up' : 'down'
    }
    previousChatScrollTopRef.current = contentElement.scrollTop

    const atConversationBottom = Boolean(
      isScrolledToBottom(contentElement) &&
        !chatDetail?.turnPagination?.newerCursor &&
        currentTurnWindow &&
        currentTurnWindow.endIndex >= currentTurnWindow.totalCount
    )
    // Scroll following and user intent are held in refs above/below. Only the
    // jump-to-latest button needs React state; it must not flush the workspace.
    startTransition(() => setChatAtConversationBottom(atConversationBottom))

    const chatKey = currentTurnWindow?.chatKey
    const updateViewportAnchor = (): void => {
      chatViewportAnchorRef.current =
        !chatAutoScrollEnabledRef.current && chatKey
          ? readChatScrollAnchor(contentElement, chatKey)
          : null
    }

    if (isScrollAdjustment || isAutoScroll) {
      // Layout/auto-scroll corrections must not be mistaken for user history navigation.
      if (isAutoScroll && !atConversationBottom && chatAutoScrollEnabledRef.current) {
        scheduleChatAutoScroll(contentElement)
      }
      updateViewportAnchor()
      return false
    }

    if (atConversationBottom) {
      chatAutoScrollEnabledRef.current = true
      chatUserScrollIntentRef.current = false
      chatAutoScrollTargetRef.current = {
        element: contentElement,
        top: contentElement.scrollTop
      }
      updateViewportAnchor()
      return true
    }

    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null
    chatUserScrollIntentRef.current = false
    updateViewportAnchor()
    return true
  }
  const handleChatContentWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY !== 0) {
      chatTurnScrollDirectionRef.current = event.deltaY < 0 ? 'up' : 'down'
    }
    chatUserScrollIntentRef.current = event.deltaY < 0
    if (!chatUserScrollIntentRef.current || chatUserScrollIntentFrameRef.current !== null) return

    chatUserScrollIntentFrameRef.current = window.requestAnimationFrame(() => {
      chatUserScrollIntentFrameRef.current = null
      chatUserScrollIntentRef.current = false
    })
  }
  const selectedChatKey = selectedChat ? getChatKey(selectedChat) : null
  const doneProjectFilterChange = useLatestHandler(handleDoneProjectFilterChange)
  const chatGroupRenderInputs = useShallowStable<ChatGroupRenderInputs>({
    searchTerms,
    collapsedCwdGroups,
    chatPageSize: effectiveAppSettings.performance.maxChatsRendered,
    visibleChatPageCountsByGroup,
    activeChatGroups,
    chatGroupingPreference,
    projectDropInsertionIndex,
    doneProjectFilterValue,
    handleDoneProjectFilterChange: doneProjectFilterChange,
    projectOptions,
    selectedChatKey,
    committingChatKeys,
    latestCommitFinishedAtByChatKey,
    draggedProjectGroupKey,
    projectNamesByCwd,
    projectIconsByCwd,
    sidebarActions,
    resolvingApprovalId
  })
  const renderChatGroup = useCallback(
    (
      group: ChatListGroupData,
      selectedChatChildren: React.ReactNode = null,
      selectedChatChildOpen = false,
      workingSubagentChatKeys?: ReadonlySet<string>
    ): React.ReactElement =>
      renderChatListGroup(
        chatGroupRenderInputs,
        group,
        selectedChatChildren,
        selectedChatChildOpen,
        workingSubagentChatKeys
      ),
    [chatGroupRenderInputs]
  )
  const chatHasActiveTurn = isActiveChatStatus(chatDetail?.status)
  const chatHasPendingSteeringMessage = hasPendingSteeringMessage(chatDetail)
  const chatIsBusy =
    chatHasActiveTurn || (sendState === 'sending' && hasActiveWorkingStep(chatDetail))
  const handleForkMessage = useCallback(
    async (message: ProviderMessage): Promise<void> => {
      if (
        message.role !== 'assistant' ||
        chatDetail?.historyPreview ||
        !selectedChat ||
        chatHasActiveTurn ||
        forkInFlightRef.current
      ) {
        return
      }

      forkInFlightRef.current = true
      setSendState('idle')
      setSendError(null)
      setForkingMessageId(message.id)
      try {
        const detail = await providerApi.forkChat(
          selectedChat.providerId,
          selectedChat.id,
          message.id
        )
        applyViewedChatDetail(selectedChat.providerId, detail, { select: true })
      } catch (error) {
        console.error('[caught:useChatInteractionController:useChatInteractionController]', error)
        handleSendFailure(error, 'Unable to fork chat.')
      } finally {
        forkInFlightRef.current = false
        setForkingMessageId(null)
      }
    },
    [
      applyViewedChatDetail,
      chatHasActiveTurn,
      chatDetail?.historyPreview,
      handleSendFailure,
      selectedChat
    ]
  )
  useEffect(() => {
    const content = contentRef.current
    if (!content || !selectedChat) return
    const followUp = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const { prompt, reply } = event.detail
      if (typeof prompt !== 'string' || typeof reply !== 'function') return
      event.preventDefault()
      void handleSendMessage(prompt)
        .then((sent) => reply(sent ? undefined : 'Unable to send follow-up in this view.'))
        .catch((error) => {
          console.error('[caught:useChatInteractionController:followUp]', error)
          return reply('Unable to send follow-up.')
        })
    }
    content.addEventListener('sele:visualization-follow-up', followUp)
    return () => content.removeEventListener('sele:visualization-follow-up', followUp)
  }, [contentRef, selectedChat, handleSendMessage])
  const quoteRequestSequenceRef = useRef(0)
  const handleQuoteSelectedMessageText = useCallback(
    (content: string, comment: string): void => {
      if (!selectedChat) return
      setMessageBoxQuoteRequest({
        id: ++quoteRequestSequenceRef.current,
        scopeKey: getChatKey(selectedChat),
        content,
        comment
      })
    },
    [selectedChat]
  )
  useEffect(() => {
    runPromptActionRef.current = async (prompt, target) => {
      await handleSendMessage(prompt, undefined, [], null, [], [], undefined, target)
    }
  })

  return {
    chatHasActiveTurn,
    chatHasPendingSteeringMessage,
    chatIsBusy,
    handleChatContentScroll,
    handleChatContentWheel,
    handleForkMessage,
    handleQuoteSelectedMessageText,
    renderChatGroup
  }
}
