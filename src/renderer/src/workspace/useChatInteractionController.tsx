/* eslint-disable react-hooks/exhaustive-deps -- controller refs and state setters are stable inputs */
import { useCallback, useEffect } from 'react'
import { FolderKanban } from 'lucide-react'
import type { ProviderMessage } from '../../../shared/provider'
import { ChatListGroup, type ChatListGroupData } from '../components/ChatListGroup'
import { providerApi } from '../providerApi'
import { renderProjectGlyph } from '../projectPresentation'
import { isScrolledToBottom, readChatScrollAnchor } from '../chatLayout'
import {
  getChatKey,
  getCollapsedGroupState,
  hasActiveWorkingStep,
  hasPendingSteeringMessage,
  isActiveChatStatus
} from './chatControllerUtils'
import type { ChatInteractionControllerDependencies } from './featureControllerDependencies'

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
    projectDropInsertionIndex,
    selectedChat,
    committingChatKeys,
    draggedProjectGroupKey,
    projectNamesByCwd,
    handleLoadMoreChatsInGroup,
    handleShowLessChatsInGroup,
    handleMarkChatDone,
    restoreExpandedProjectsAfterDrag,
    handleProjectDragStart,
    handleMarkCwdChatsDone,
    handleNewChatInCwd,
    handleRenameChat,
    handleSelectProjectIcon,
    handleResolveChatApproval,
    handleReorderChats,
    handleSelectChat,
    handleToggleCwdGroup,
    handleToggleChatPinned,
    handleUnpinPinnedChats,
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

    const previousScrollTop = previousChatScrollTopRef.current
    if (
      !isScrollAdjustment &&
      previousScrollTop !== null &&
      Math.abs(contentElement.scrollTop - previousScrollTop) >= 0.5
    ) {
      chatTurnScrollDirectionRef.current =
        contentElement.scrollTop < previousScrollTop ? 'up' : 'down'
    }
    previousChatScrollTopRef.current = contentElement.scrollTop

    const atConversationBottom = Boolean(
      isScrolledToBottom(contentElement) &&
      currentTurnWindow &&
      currentTurnWindow.endIndex >= currentTurnWindow.totalCount
    )
    setChatAtConversationBottom(atConversationBottom)

    const chatKey = currentTurnWindow?.chatKey
    const updateViewportAnchor = (): void => {
      chatViewportAnchorRef.current = chatKey ? readChatScrollAnchor(contentElement, chatKey) : null
    }

    if (isScrollAdjustment) {
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

    const autoScrollTarget = chatAutoScrollTargetRef.current
    if (
      !chatUserScrollIntentRef.current &&
      chatAutoScrollEnabledRef.current &&
      autoScrollTarget?.element === contentElement &&
      autoScrollTarget.top === contentElement.scrollTop
    ) {
      scheduleChatAutoScroll(contentElement)
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
  const renderChatGroup = (group: ChatListGroupData, contentId: string): React.ReactElement => {
    const groupOpen =
      searchTerms.length > 0 || !getCollapsedGroupState(group.key, collapsedCwdGroups)
    const chatPageSize = effectiveAppSettings.performance.maxChatsRendered
    const visibleChatCount =
      group.kind === 'pinned'
        ? group.chats.length
        : (visibleChatPageCountsByGroup[group.key] ?? 1) * chatPageSize
    const project = group.cwd ? projectRecordsByCwd.get(group.cwd) : null
    const projectImage = projectIconsByGroup[group.key]
    const projectIcon =
      (project?.icon === 'image' || project?.icon == null) && projectImage?.dataUrl ? (
        <img className="chat-list-group__project-icon-image" src={projectImage.dataUrl} alt="" />
      ) : project?.icon && project.icon !== 'image' ? (
        renderProjectGlyph(project.icon)
      ) : (
        <FolderKanban aria-hidden="true" />
      )
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

    return (
      <ChatListGroup
        contentId={contentId}
        group={group}
        key={group.key}
        open={groupOpen}
        selectedChatKey={selectedChat ? getChatKey(selectedChat) : null}
        committingChatKeys={committingChatKeys}
        canReorderChats={searchTerms.length === 0}
        projectDraggable={projectDraggable}
        projectDragging={group.key === draggedProjectGroupKey}
        projectDropPosition={projectDropPosition}
        visibleChatCount={visibleChatCount}
        chatPageSize={chatPageSize}
        projectNamesByCwd={projectNamesByCwd}
        onLoadMoreChats={group.kind === 'pinned' ? undefined : handleLoadMoreChatsInGroup}
        onShowLessChats={group.kind === 'pinned' ? undefined : handleShowLessChatsInGroup}
        projectIcon={projectIcon}
        onMarkChatDone={handleMarkChatDone}
        onProjectDragEnd={projectDraggable ? restoreExpandedProjectsAfterDrag : undefined}
        onProjectDragStart={projectDraggable ? handleProjectDragStart : undefined}
        onMarkCwdChatsDone={(nextGroup) => void handleMarkCwdChatsDone(nextGroup)}
        onNewChatInCwd={handleNewChatInCwd}
        onRenameChat={handleRenameChat}
        onSelectProjectIcon={(nextGroup) => void handleSelectProjectIcon(nextGroup)}
        onResolveApproval={(chat, decision) => void handleResolveChatApproval(chat, decision)}
        onReorderChats={handleReorderChats}
        onSelectChat={handleSelectChat}
        onToggle={handleToggleCwdGroup}
        onToggleChatPinned={handleToggleChatPinned}
        onUnpinPinnedChats={(nextGroup) => void handleUnpinPinnedChats(nextGroup)}
        resolvingApprovalId={resolvingApprovalId}
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
