// biome-ignore-all lint/correctness/useExhaustiveDependencies: controller refs and state setters are stable inputs
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { FolderKanban, FolderTree } from 'lucide-react'
import type { ProviderMessage } from '../../../shared/provider'
import { AnimatedChatListGroup, type ChatListGroupData } from '../components/ChatListGroup'
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
import type { ChatInteractionControllerDependencies } from './featureControllerDependencies'

// Return shape is inferred from the controller declarations below.
export function useChatInteractionController(dependencies: ChatInteractionControllerDependencies) {
  const {
    contentRef,
    chatTurnWindowRef,
    chatScrollAdjustmentTargetRef,
    previousChatScrollTopRef,
    chatTurnScrollDirectionRef,
    setChatAtConversationBottom,
    chatViewportAnchorRef,
    chatAutoScrollEnabledRef,
    chatUserScrollIntentRef,
    chatAutoScrollTargetRef,
    scheduleChatAutoScroll,
    chatUserScrollIntentFrameRef,
    searchTerms,
    collapsedCwdGroups,
    effectiveAppSettings,
    visibleChatPageCountsByGroup,
    projectRecordsByCwd,
    projectIconsByGroup,
    activeChatGroups,
    chatGroupingPreference,
    doneProjectFilterValue,
    projectOptions,
    projectDropInsertionIndex,
    selectedChat,
    committingChatKeys,
    latestCommitFinishedAtByChatKey,
    draggedProjectGroupKey,
    projectNamesByCwd,
    handleDoneProjectFilterChange,
    resolvingApprovalId,
    chatDetail,
    sendState,
    providerUpdateInProgress,
    forkInFlightRef,
    setSendState,
    setSendError,
    setForkingMessageId,
    applyViewedChatDetail,
    handleSendFailure,
    setMessageBoxQuoteRequest,
    runPromptActionRef,
    handleSendMessage
  } = dependencies

  // Memoized groups must always invoke handlers from the latest committed workspace.
  const sidebarActionsRef = useRef(dependencies)
  useLayoutEffect(() => {
    sidebarActionsRef.current = dependencies
  })
  const sidebarActions = useMemo(
    () => ({
      onLoadMoreChats: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleLoadMoreChatsInGroup']>
      ) => sidebarActionsRef.current.handleLoadMoreChatsInGroup(...args),
      onShowLessChats: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleShowLessChatsInGroup']>
      ) => sidebarActionsRef.current.handleShowLessChatsInGroup(...args),
      onMarkChatDone: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleMarkChatDone']>
      ) => sidebarActionsRef.current.handleMarkChatDone(...args),
      onProjectDragEnd: (
        ...args: Parameters<
          ChatInteractionControllerDependencies['restoreExpandedProjectsAfterDrag']
        >
      ) => sidebarActionsRef.current.restoreExpandedProjectsAfterDrag(...args),
      onProjectDragStart: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleProjectDragStart']>
      ) => sidebarActionsRef.current.handleProjectDragStart(...args),
      onMarkCwdChatsDone: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleMarkCwdChatsDone']>
      ) => sidebarActionsRef.current.handleMarkCwdChatsDone(...args),
      onNewChatInCwd: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleNewChatInCwd']>
      ) => sidebarActionsRef.current.handleNewChatInCwd(...args),
      onRenameChat: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleRenameChat']>
      ) => sidebarActionsRef.current.handleRenameChat(...args),
      onSelectProjectIcon: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleSelectProjectIcon']>
      ) => sidebarActionsRef.current.handleSelectProjectIcon(...args),
      onResolveApproval: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleResolveChatApproval']>
      ) => sidebarActionsRef.current.handleResolveChatApproval(...args),
      onReorderChats: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleReorderChats']>
      ) => sidebarActionsRef.current.handleReorderChats(...args),
      onSelectChat: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleSelectChat']>
      ) => sidebarActionsRef.current.handleSelectChat(...args),
      onToggle: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleToggleCwdGroup']>
      ) => sidebarActionsRef.current.handleToggleCwdGroup(...args),
      onToggleChatPinned: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleToggleChatPinned']>
      ) => sidebarActionsRef.current.handleToggleChatPinned(...args),
      onUnpinPinnedChats: (
        ...args: Parameters<ChatInteractionControllerDependencies['handleUnpinPinnedChats']>
      ) => sidebarActionsRef.current.handleUnpinPinnedChats(...args)
    }),
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
    setChatAtConversationBottom(atConversationBottom)

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
  const renderChatGroup = (
    group: ChatListGroupData,
    contentId: string,
    selectedChatChildren: React.ReactNode = null,
    selectedChatChildOpen = false,
    workingSubagentChatKeys?: ReadonlySet<string>,
    layoutOrder?: string
  ): React.ReactElement => {
    const groupOpen =
      searchTerms.length > 0 || !getCollapsedGroupState(group.key, collapsedCwdGroups)
    const chatPageSize = effectiveAppSettings.performance.maxChatsRendered
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
            valueLabel={
              doneProjectFilterValue === allDoneProjectsValue ? 'All projects' : undefined
            }
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
      <AnimatedChatListGroup
        layoutOrder={layoutOrder}
        contentId={contentId}
        group={group}
        key={group.key}
        open={groupOpen}
        selectedChatKey={
          selectedChat && group.chats.some((chat) => getChatKey(chat) === getChatKey(selectedChat))
            ? getChatKey(selectedChat)
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
        deferItems={group.kind === 'done'}
        emptyContent={doneProjectFilterEmptyContent}
        headerAction={doneProjectFilter}
        projectNamesByCwd={projectNamesByCwd}
        projectIconsByCwd={projectIconsByCwd}
        onLoadMoreChats={group.kind === 'pinned' ? undefined : sidebarActions.onLoadMoreChats}
        onShowLessChats={group.kind === 'pinned' ? undefined : sidebarActions.onShowLessChats}
        projectIcon={projectIconsByCwd.get(group.cwd ?? '')}
        onMarkChatDone={sidebarActions.onMarkChatDone}
        onProjectDragEnd={projectDraggable ? sidebarActions.onProjectDragEnd : undefined}
        onProjectDragStart={projectDraggable ? sidebarActions.onProjectDragStart : undefined}
        onMarkCwdChatsDone={sidebarActions.onMarkCwdChatsDone}
        onNewChatInCwd={sidebarActions.onNewChatInCwd}
        onRenameChat={sidebarActions.onRenameChat}
        onSelectProjectIcon={sidebarActions.onSelectProjectIcon}
        onResolveApproval={sidebarActions.onResolveApproval}
        onReorderChats={sidebarActions.onReorderChats}
        onSelectChat={sidebarActions.onSelectChat}
        onToggle={sidebarActions.onToggle}
        onToggleChatPinned={sidebarActions.onToggleChatPinned}
        onUnpinPinnedChats={sidebarActions.onUnpinPinnedChats}
        resolvingApprovalId={resolvingApprovalId}
        selectedChatChildren={selectedChatChildren}
        selectedChatChildOpen={selectedChatChildOpen}
      />
    )
  }
  const chatHasActiveTurn = isActiveChatStatus(chatDetail?.status)
  const chatHasPendingSteeringMessage = hasPendingSteeringMessage(chatDetail)
  const chatIsBusy =
    chatHasActiveTurn || (sendState === 'sending' && hasActiveWorkingStep(chatDetail))
  const handleForkMessage = useCallback(
    async (message: ProviderMessage): Promise<void> => {
      if (
        message.role !== 'assistant' ||
        !selectedChat ||
        chatHasActiveTurn ||
        providerUpdateInProgress ||
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
      handleSendFailure,
      providerUpdateInProgress,
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
  const handleQuoteSelectedMessageText = useCallback((content: string): void => {
    setMessageBoxQuoteRequest((currentRequest) => ({
      id: (currentRequest?.id ?? 0) + 1,
      content
    }))
  }, [])
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
