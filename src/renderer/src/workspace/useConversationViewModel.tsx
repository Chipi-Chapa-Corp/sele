/* eslint-disable react-hooks/exhaustive-deps -- controller refs and state setters are stable inputs */
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { buildChatConversationModel } from '../chatConversationModel'
import { getRecentChatReferences, type PinnedChatTextReference } from '../chatRecents'
import { getSubagentMarkerPlacements } from '../subagentUi'
import { providerApi } from '../providerApi'
import { getDisplayedRecentChatReferences } from '../recentReferencePins'
import { getDisplayedRecentlyOpenedFiles } from '../recentlyOpenedFiles'
import {
  getEffectiveChatTurnWindow,
  getLatestChatTurnWindow,
  shiftChatTurnWindow,
  type ChatTurnWindow
} from '../chatTurnWindow'
import { getScrollBottomTop, readChatScrollAnchor, restoreChatScrollAnchor } from '../chatLayout'
import { type ChatCommitMarker } from '../components/AppStatusStates'
import {
  getChatDetailItemsStartTurnIndex,
  getChatDetailTurnCount,
  getLoadedChatDetailTurnEndIndex,
  mergeChatDetailTurnPage,
  replaceChatDetailWithCursorPage
} from '../chatDetailWindow'
import {
  chatTurnLoadThresholdPx,
  chatTurnPageSize,
  chatTurnWindowSize,
  type ChatTurnPageLoadDirection
} from './controllerTypes'
import {
  getChatCommitMarkerPlacementTime,
  getChatItemCreatedAt,
  getChatKey,
  getEstimatedContextTokens,
  getProviderChatKey
} from './chatControllerUtils'
import type { ConversationViewModelDependencies } from './viewModelDependencies'

// Return shape is inferred from the view-model declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useConversationViewModel(dependencies: ConversationViewModelDependencies) {
  const {
    selectedChat,
    newSessionProviderAvailable,
    providerUpdateInProgress,
    chatLoadState,
    activeSubagentChatView,
    chatHasActiveTurn,
    chatDetail,
    sendState,
    editingMessage,
    selectedChatSubagents,
    effectiveAppSettings,
    selectedChatId,
    selectedChatKey,
    recentChatReferencePage,
    recentChatReferencesCache,
    pinnedRecentChatReferences,
    recentlyOpenedFilesByWorkspace,
    recentlyOpenedFilesWorkspaceKey,
    changesPaneView,
    selectedProviderId,
    setRecentChatReferencePage,
    setRecentChatReferencesCache,
    chatTurnWindow,
    chatAtConversationBottom,
    pendingPinnedMessageNavigationRef,
    scrollPinnedChatMessageIntoView,
    chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef,
    setChatTurnPageLoadDirection,
    chatTurnWindowRef,
    setChatTurnWindow,
    chatAutoScrollEnabledRef,
    scrollToLatestTurnAfterRenderRef,
    pendingChatScrollAnchorRef,
    contentRef,
    chatScrollAdjustmentTargetRef,
    chatViewportAnchorRef,
    scrollChatContentToBottom,
    selectedChatRef,
    selectedChatKeyRef,
    applyViewedChatDetail,
    chatAutoScrollTargetRef,
    setChatDetail,
    chatDetailRef,
    handleChatContentScroll,
    handleChatContentWheel,
    continuedStoppedWorkingStepsByChat,
    selectedChatCommitMarkers
  } = dependencies

  const messageBoxProviderAvailable = selectedChat ? true : newSessionProviderAvailable
  const chatOpenedElsewhere = chatDetail?.writeAccess === 'readOnly'
  const messageBoxDisabled = selectedChat
    ? providerUpdateInProgress ||
      chatLoadState !== 'ready' ||
      chatOpenedElsewhere ||
      Boolean(activeSubagentChatView) ||
      (chatHasActiveTurn && !chatDetail?.capabilities.activeMessages)
    : providerUpdateInProgress || !newSessionProviderAvailable
  const canEditOwnMessages = Boolean(
    selectedChat &&
    !activeSubagentChatView &&
    !chatOpenedElsewhere &&
    chatDetail?.capabilities.editMessages &&
    chatLoadState === 'ready' &&
    sendState !== 'sending' &&
    !providerUpdateInProgress &&
    !editingMessage
  )
  const visibleChatItems = useMemo(() => chatDetail?.items ?? [], [chatDetail?.items])
  const subagentVisibleChatItems = useMemo(
    () => activeSubagentChatView?.detail?.items ?? [],
    [activeSubagentChatView?.detail?.items]
  )
  const chatConversationModel = useMemo(
    () => buildChatConversationModel(visibleChatItems),
    [visibleChatItems]
  )
  const subagentChatConversationModel = useMemo(
    () => buildChatConversationModel(subagentVisibleChatItems),
    [subagentVisibleChatItems]
  )
  const subagentChatItemIndexesById = subagentChatConversationModel.itemIndexesById
  const { workingStepId: subagentMarkersByWorkingStepId } = useMemo(
    () => getSubagentMarkerPlacements(selectedChatSubagents, visibleChatItems),
    [selectedChatSubagents, visibleChatItems]
  )
  const loadedChatTurnStartIndex = getChatDetailItemsStartTurnIndex(chatDetail)
  const loadedChatTurnEndIndex = getLoadedChatDetailTurnEndIndex(chatDetail)
  const totalChatTurnCount = getChatDetailTurnCount(chatDetail)
  const chatTurnPagination = chatDetail?.turnPagination
  const latestVisibleChatItemId = visibleChatItems.at(-1)?.id ?? null
  const recentsMessageLimit = effectiveAppSettings.performance.recentsMessageLimit
  const recentsStartTurnIndex = Math.max(0, totalChatTurnCount - recentsMessageLimit)
  const loadedChatItemsCoverRecents = Boolean(
    chatDetail?.id === selectedChatId &&
    (chatTurnPagination
      ? !chatTurnPagination.olderCursor || totalChatTurnCount >= recentsMessageLimit
      : loadedChatTurnStartIndex <= recentsStartTurnIndex &&
        loadedChatTurnEndIndex >= totalChatTurnCount)
  )
  const recentChatReferencePageMatches = Boolean(
    selectedChatKey &&
    recentChatReferencePage?.chatKey === selectedChatKey &&
    recentChatReferencePage.messageLimit === recentsMessageLimit &&
    (chatTurnPagination
      ? recentChatReferencePage.latestItemId === latestVisibleChatItemId
      : recentChatReferencePage.totalTurnCount === totalChatTurnCount)
  )
  const recentChatReferenceItems = loadedChatItemsCoverRecents
    ? visibleChatItems
    : recentChatReferencePageMatches
      ? (recentChatReferencePage?.items ?? visibleChatItems)
      : visibleChatItems
  const extractedRecentChatReferences = useMemo(
    () => getRecentChatReferences(recentChatReferenceItems, recentsMessageLimit),
    [recentChatReferenceItems, recentsMessageLimit]
  )
  const currentChatDetailIncludesLatest = Boolean(
    selectedChatKey &&
    chatDetail?.id === selectedChatId &&
    loadedChatTurnEndIndex >= totalChatTurnCount
  )
  const recentChatReferenceSourceIncludesLatest =
    currentChatDetailIncludesLatest || recentChatReferencePageMatches
  const recentChatReferences = useMemo(
    () =>
      recentChatReferenceSourceIncludesLatest
        ? extractedRecentChatReferences
        : recentChatReferencesCache?.chatKey === selectedChatKey
          ? recentChatReferencesCache.references
          : [],
    [
      extractedRecentChatReferences,
      recentChatReferencesCache,
      recentChatReferenceSourceIncludesLatest,
      selectedChatKey
    ]
  )
  const selectedPinnedRecentChatReferences = useMemo(
    () => (selectedChatKey ? (pinnedRecentChatReferences[selectedChatKey] ?? []) : []),
    [pinnedRecentChatReferences, selectedChatKey]
  )
  const displayedRecentChatReferences = useMemo(
    () =>
      getDisplayedRecentChatReferences(selectedPinnedRecentChatReferences, recentChatReferences),
    [recentChatReferences, selectedPinnedRecentChatReferences]
  )
  const pinnedChatMessageIds = useMemo(
    () =>
      new Set(
        displayedRecentChatReferences.pinnedReferences
          .filter((reference): reference is PinnedChatTextReference => reference.kind === 'text')
          .map((reference) => reference.messageId)
      ),
    [displayedRecentChatReferences.pinnedReferences]
  )
  const recentlyOpenedFiles = useMemo(() => {
    return getDisplayedRecentlyOpenedFiles(
      recentlyOpenedFilesByWorkspace[recentlyOpenedFilesWorkspaceKey] ?? [],
      [
        ...displayedRecentChatReferences.pinnedReferences,
        ...displayedRecentChatReferences.recentReferences
      ],
      effectiveAppSettings.performance.recentlyOpenedFilesLimit
    )
  }, [
    displayedRecentChatReferences.pinnedReferences,
    displayedRecentChatReferences.recentReferences,
    effectiveAppSettings.performance.recentlyOpenedFilesLimit,
    recentlyOpenedFilesByWorkspace,
    recentlyOpenedFilesWorkspaceKey
  ])
  useEffect(() => {
    if (
      changesPaneView !== 'recents' ||
      !selectedProviderId ||
      !selectedChatId ||
      !selectedChatKey ||
      chatDetail?.id !== selectedChatId ||
      loadedChatItemsCoverRecents ||
      recentChatReferencePageMatches ||
      totalChatTurnCount === 0
    ) {
      return
    }

    let active = true
    const pageRequest = chatTurnPagination
      ? providerApi.getChatTurnCursorPage(
          selectedProviderId,
          selectedChatId,
          'older',
          null,
          recentsMessageLimit
        )
      : providerApi.getChatTurnPage(
          selectedProviderId,
          selectedChatId,
          recentsStartTurnIndex,
          totalChatTurnCount - recentsStartTurnIndex
        )
    void pageRequest
      .then((page) => {
        if (!active) return
        setRecentChatReferencePage({
          chatKey: selectedChatKey,
          items: page.items,
          latestItemId: page.items.at(-1)?.id ?? null,
          messageLimit: recentsMessageLimit,
          totalTurnCount: page.totalCount
        })
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [
    chatDetail?.id,
    changesPaneView,
    latestVisibleChatItemId,
    loadedChatItemsCoverRecents,
    recentChatReferencePageMatches,
    recentsMessageLimit,
    recentsStartTurnIndex,
    selectedChatId,
    selectedChatKey,
    selectedProviderId,
    totalChatTurnCount
  ])
  useEffect(() => {
    if (!recentChatReferenceSourceIncludesLatest || !selectedChatKey) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setRecentChatReferencesCache((currentCache) =>
        currentCache?.chatKey === selectedChatKey &&
        currentCache.references === extractedRecentChatReferences
          ? currentCache
          : { chatKey: selectedChatKey, references: extractedRecentChatReferences }
      )
    })

    return () => {
      active = false
    }
  }, [extractedRecentChatReferences, recentChatReferenceSourceIncludesLatest, selectedChatKey])
  const defaultChatTurnWindow = useMemo<ChatTurnWindow | null>(() => {
    if (!selectedChatKey) return null
    return getLatestChatTurnWindow(selectedChatKey, totalChatTurnCount, chatTurnPageSize)
  }, [selectedChatKey, totalChatTurnCount])
  const effectiveChatTurnWindow = defaultChatTurnWindow
    ? getEffectiveChatTurnWindow(chatTurnWindow, defaultChatTurnWindow, chatAtConversationBottom)
    : null
  const renderedChatTurns = useMemo(
    () =>
      effectiveChatTurnWindow
        ? chatConversationModel.turns.slice(
            Math.max(0, effectiveChatTurnWindow.startIndex - loadedChatTurnStartIndex),
            Math.max(0, effectiveChatTurnWindow.endIndex - loadedChatTurnStartIndex)
          )
        : [],
    [chatConversationModel, effectiveChatTurnWindow, loadedChatTurnStartIndex]
  )
  useLayoutEffect(() => {
    const target = pendingPinnedMessageNavigationRef.current
    if (!target || selectedChatKey !== getProviderChatKey(target.providerId, target.chatId)) return

    if (scrollPinnedChatMessageIntoView(target.messageId)) {
      pendingPinnedMessageNavigationRef.current = null
      return
    }

    if (
      effectiveChatTurnWindow &&
      target.turnIndex >= effectiveChatTurnWindow.startIndex &&
      target.turnIndex < effectiveChatTurnWindow.endIndex
    ) {
      pendingPinnedMessageNavigationRef.current = null
    }
  }, [effectiveChatTurnWindow, renderedChatTurns, scrollPinnedChatMessageIntoView, selectedChatKey])
  useEffect(() => {
    let active = true
    chatTurnPageLoadRequestRef.current += 1
    chatTurnPageLoadInFlightRef.current = false
    chatTurnScrollDirectionRef.current = null
    queueMicrotask(() => {
      if (!active) return
      setChatTurnPageLoadDirection(null)

      if (!selectedChatKey) {
        chatTurnWindowRef.current = null
        setChatTurnWindow(null)
        return
      }

      setChatTurnWindow((currentWindow) => {
        const totalCount = totalChatTurnCount
        const viewingLatest =
          currentWindow?.chatKey !== selectedChatKey || chatAutoScrollEnabledRef.current
        const nextWindow: ChatTurnWindow = viewingLatest
          ? getLatestChatTurnWindow(selectedChatKey, totalCount, chatTurnPageSize)
          : {
              chatKey: selectedChatKey,
              startIndex: Math.min(currentWindow.startIndex, totalCount),
              endIndex: Math.min(currentWindow.endIndex, totalCount),
              totalCount
            }
        chatTurnWindowRef.current = nextWindow
        if (viewingLatest) scrollToLatestTurnAfterRenderRef.current = true
        return nextWindow
      })
    })

    return () => {
      active = false
    }
  }, [loadedChatTurnEndIndex, loadedChatTurnStartIndex, selectedChatKey, totalChatTurnCount])
  useLayoutEffect(() => {
    const anchor = pendingChatScrollAnchorRef.current
    if (!anchor || anchor.chatKey !== selectedChatKey) return

    pendingChatScrollAnchorRef.current = null
    const contentElement = contentRef.current
    if (!contentElement || !restoreChatScrollAnchor(contentElement, anchor)) return

    chatScrollAdjustmentTargetRef.current = {
      element: contentElement,
      top: contentElement.scrollTop
    }
    chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, anchor.chatKey)
  }, [effectiveChatTurnWindow?.endIndex, effectiveChatTurnWindow?.startIndex, selectedChatKey])
  useLayoutEffect(() => {
    if (!scrollToLatestTurnAfterRenderRef.current || renderedChatTurns.length === 0) return
    scrollToLatestTurnAfterRenderRef.current = false
    pendingChatScrollAnchorRef.current = null
    const contentElement = contentRef.current
    if (contentElement) scrollChatContentToBottom(contentElement)
  }, [effectiveChatTurnWindow?.endIndex, renderedChatTurns.length, scrollChatContentToBottom])
  const loadChatTurnPage = useCallback(
    async (direction: ChatTurnPageLoadDirection): Promise<void> => {
      const chat = selectedChatRef.current
      const currentWindow = chatTurnWindowRef.current
      if (
        !chat ||
        !currentWindow ||
        currentWindow.chatKey !== getChatKey(chat) ||
        chatTurnPageLoadInFlightRef.current
      ) {
        return
      }

      const currentDetail = chatDetailRef.current
      const cursorPagination = currentDetail?.id === chat.id ? currentDetail.turnPagination : null
      if (
        direction === 'older' &&
        (cursorPagination ? !cursorPagination.olderCursor : currentWindow.startIndex === 0)
      ) {
        return
      }
      if (
        direction === 'newer' &&
        (cursorPagination
          ? !cursorPagination.newerCursor
          : currentWindow.endIndex >= currentWindow.totalCount)
      ) {
        return
      }

      const requestId = chatTurnPageLoadRequestRef.current + 1
      chatTurnPageLoadRequestRef.current = requestId
      chatTurnPageLoadInFlightRef.current = true
      setChatTurnPageLoadDirection(direction)

      try {
        if (direction === 'latest') {
          const detail = await providerApi.getChat(chat.providerId, chat.id)
          if (
            chatTurnPageLoadRequestRef.current !== requestId ||
            selectedChatKeyRef.current !== currentWindow.chatKey
          ) {
            return
          }

          const totalCount = getChatDetailTurnCount(detail)
          const nextWindow = getLatestChatTurnWindow(
            currentWindow.chatKey,
            totalCount,
            chatTurnPageSize
          )
          chatAutoScrollEnabledRef.current = true
          chatTurnScrollDirectionRef.current = 'down'
          scrollToLatestTurnAfterRenderRef.current = true
          pendingChatScrollAnchorRef.current = null
          chatViewportAnchorRef.current = null
          chatTurnWindowRef.current = nextWindow
          setChatTurnWindow(nextWindow)
          applyViewedChatDetail(chat.providerId, detail)
          return
        }

        if (cursorPagination) {
          const cursor =
            direction === 'older' ? cursorPagination.olderCursor : cursorPagination.newerCursor
          if (!cursor) return
          const page = await providerApi.getChatTurnCursorPage(
            chat.providerId,
            chat.id,
            direction,
            cursor,
            chatTurnPageSize
          )
          if (
            chatTurnPageLoadRequestRef.current !== requestId ||
            selectedChatKeyRef.current !== currentWindow.chatKey
          ) {
            return
          }

          const pageTurnCount = page.totalCount
          const nextWindow: ChatTurnWindow = {
            chatKey: currentWindow.chatKey,
            startIndex: 0,
            endIndex: pageTurnCount,
            totalCount: pageTurnCount
          }
          chatAutoScrollEnabledRef.current = false
          chatAutoScrollTargetRef.current = null
          pendingChatScrollAnchorRef.current = null
          chatViewportAnchorRef.current = null
          chatTurnWindowRef.current = nextWindow

          flushSync(() => {
            setChatDetail((detail) => {
              if (detail?.id !== chat.id) return detail
              const nextDetail = replaceChatDetailWithCursorPage(detail, page)
              chatDetailRef.current = nextDetail
              return nextDetail
            })
            setChatTurnWindow(nextWindow)
          })

          const contentElement = contentRef.current
          if (contentElement) {
            if (direction === 'older') contentElement.scrollTop = getScrollBottomTop(contentElement)
            else contentElement.scrollTop = 0
          }
          return
        }

        const startIndex =
          direction === 'older'
            ? Math.max(0, currentWindow.startIndex - chatTurnPageSize)
            : currentWindow.endIndex
        const limit =
          direction === 'older' ? currentWindow.startIndex - startIndex : chatTurnPageSize
        const page = await providerApi.getChatTurnPage(chat.providerId, chat.id, startIndex, limit)
        if (
          chatTurnPageLoadRequestRef.current !== requestId ||
          selectedChatKeyRef.current !== currentWindow.chatKey
        ) {
          return
        }

        const latestWindow = chatTurnWindowRef.current
        if (!latestWindow || latestWindow.chatKey !== currentWindow.chatKey) return

        const totalCount = Math.max(latestWindow.totalCount, page.totalCount)
        const loadedEndIndex = Math.min(totalCount, page.startIndex + limit)
        const nextWindow = shiftChatTurnWindow(
          latestWindow,
          direction,
          page.startIndex,
          loadedEndIndex,
          totalCount,
          chatTurnWindowSize
        )
        const contentElement = contentRef.current
        pendingChatScrollAnchorRef.current = contentElement
          ? readChatScrollAnchor(contentElement, latestWindow.chatKey, nextWindow)
          : null
        chatAutoScrollEnabledRef.current = false
        chatAutoScrollTargetRef.current = null
        chatTurnWindowRef.current = nextWindow

        flushSync(() => {
          setChatDetail((currentDetail) => {
            if (currentDetail?.id !== chat.id) return currentDetail
            const nextDetail = mergeChatDetailTurnPage(currentDetail, page, nextWindow)
            chatDetailRef.current = nextDetail
            return nextDetail
          })
          setChatTurnWindow(nextWindow)
        })

        if (!pendingChatScrollAnchorRef.current && contentElement) {
          chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, latestWindow.chatKey)
        }
      } finally {
        if (chatTurnPageLoadRequestRef.current === requestId) {
          chatTurnPageLoadInFlightRef.current = false
          setChatTurnPageLoadDirection(null)
        }
      }
    },
    [applyViewedChatDetail]
  )
  const handleNativeChatContentScroll = (): void => {
    if (!handleChatContentScroll()) return

    const contentElement = contentRef.current
    const currentWindow = chatTurnWindowRef.current
    if (!contentElement || !currentWindow || chatTurnPageLoadInFlightRef.current) return

    if (
      chatTurnScrollDirectionRef.current === 'up' &&
      contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      (chatDetailRef.current?.turnPagination?.olderCursor || currentWindow.startIndex > 0)
    ) {
      void loadChatTurnPage('older')
      return
    }

    if (
      chatTurnScrollDirectionRef.current === 'down' &&
      getScrollBottomTop(contentElement) - contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      (chatDetailRef.current?.turnPagination?.newerCursor ||
        currentWindow.endIndex < currentWindow.totalCount)
    ) {
      void loadChatTurnPage('newer')
    }
  }
  const handleNativeChatContentWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    handleChatContentWheel(event)
    const contentElement = contentRef.current
    const currentWindow = chatTurnWindowRef.current
    if (!contentElement || !currentWindow || chatTurnPageLoadInFlightRef.current) return

    if (
      event.deltaY < 0 &&
      contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      (chatDetailRef.current?.turnPagination?.olderCursor || currentWindow.startIndex > 0)
    ) {
      void loadChatTurnPage('older')
    } else if (
      event.deltaY > 0 &&
      getScrollBottomTop(contentElement) - contentElement.scrollTop <= chatTurnLoadThresholdPx &&
      (chatDetailRef.current?.turnPagination?.newerCursor ||
        currentWindow.endIndex < currentWindow.totalCount)
    ) {
      void loadChatTurnPage('newer')
    }
  }
  const stoppedTurnRetryMessages = chatConversationModel.stoppedTurnRetryMessages
  const canRetryStoppedTurns = Boolean(selectedChat && chatDetail?.capabilities.editMessages)
  const stoppedTurnActionDisabled =
    chatLoadState !== 'ready' ||
    sendState === 'sending' ||
    providerUpdateInProgress ||
    chatHasActiveTurn ||
    Boolean(editingMessage)
  const workingStepIdsWithNextWorkingStep = chatConversationModel.workingStepIdsWithNextWorkingStep
  const followingWorkingStepsById = chatConversationModel.followingWorkingStepsById
  const continuedStoppedWorkingStepIds = useMemo(
    () => new Set(selectedChatKey ? continuedStoppedWorkingStepsByChat[selectedChatKey] : []),
    [continuedStoppedWorkingStepsByChat, selectedChatKey]
  )
  const firstPendingChatItemId = chatConversationModel.firstPendingItemId
  const chatItemIndexesById = chatConversationModel.itemIndexesById
  const [
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers
  ] = useMemo(() => {
    const visibleItemsById = new Map(visibleChatItems.map((item) => [item.id, item]))
    const allItemIds = chatConversationModel.itemIds
    const markersByBeforeItemId = new Map<string, ChatCommitMarker[]>()
    const markersByAfterItemId = new Map<string, ChatCommitMarker[]>()
    const trailingMarkers: ChatCommitMarker[] = []

    const placeMarkerByTime = (marker: ChatCommitMarker): void => {
      const placementTime = getChatCommitMarkerPlacementTime(marker)
      const nextItem = visibleChatItems.find((item) => {
        const createdAt = getChatItemCreatedAt(item)
        return createdAt !== null && createdAt > placementTime
      })

      if (!nextItem) {
        trailingMarkers.push(marker)
        return
      }

      const markersBeforeItem = markersByBeforeItemId.get(nextItem.id) ?? []
      markersBeforeItem.push(marker)
      markersByBeforeItemId.set(nextItem.id, markersBeforeItem)
    }

    selectedChatCommitMarkers.forEach((marker) => {
      if (!marker.afterItemId) {
        placeMarkerByTime(marker)
        return
      }
      const anchorItem = visibleItemsById.get(marker.afterItemId)
      if (!anchorItem) {
        if (!allItemIds.has(marker.afterItemId)) placeMarkerByTime(marker)
        return
      }
      if (anchorItem.type === 'pendingMessage') {
        placeMarkerByTime(marker)
        return
      }

      const anchorItemIndex = chatItemIndexesById.get(marker.afterItemId)
      const anchorTimelineTime =
        marker.finishedAt !== null && anchorItemIndex !== undefined
          ? visibleChatItems
              .slice(0, anchorItemIndex + 1)
              .findLast((item) => getChatItemCreatedAt(item) !== null)
          : null
      const anchorCreatedAt = anchorTimelineTime ? getChatItemCreatedAt(anchorTimelineTime) : null
      if (
        marker.finishedAt !== null &&
        anchorCreatedAt !== null &&
        anchorCreatedAt > marker.finishedAt
      ) {
        placeMarkerByTime(marker)
        return
      }

      const anchoredMarkers = markersByAfterItemId.get(marker.afterItemId) ?? []
      anchoredMarkers.push(marker)
      markersByAfterItemId.set(marker.afterItemId, anchoredMarkers)
    })

    return [markersByBeforeItemId, markersByAfterItemId, trailingMarkers] as const
  }, [chatConversationModel, chatItemIndexesById, selectedChatCommitMarkers, visibleChatItems])
  const lastStreamingChatItem = chatHasActiveTurn ? chatConversationModel.lastNonPendingItem : null
  const streamingChatItemId =
    lastStreamingChatItem?.type === 'message' && lastStreamingChatItem.role === 'assistant'
      ? lastStreamingChatItem.id
      : null
  const messageBoxContextUsage = useMemo(() => {
    const contextUsage = chatDetail?.contextUsage ?? null
    if (contextUsage) {
      return {
        source: 'exact' as const,
        usedTokens: contextUsage.usedTokens,
        maxTokens: contextUsage.maxTokens
      }
    }

    const estimatedTokens = getEstimatedContextTokens(chatDetail?.items)
    return {
      source: estimatedTokens == null ? ('unavailable' as const) : ('estimated' as const),
      usedTokens: estimatedTokens,
      maxTokens: null
    }
  }, [chatDetail?.contextUsage, chatDetail?.items])

  return {
    canEditOwnMessages,
    canRetryStoppedTurns,
    chatCommitMarkersByAfterItemId,
    chatCommitMarkersByBeforeItemId,
    chatItemIndexesById,
    continuedStoppedWorkingStepIds,
    displayedRecentChatReferences,
    effectiveChatTurnWindow,
    firstPendingChatItemId,
    followingWorkingStepsById,
    handleNativeChatContentScroll,
    handleNativeChatContentWheel,
    loadChatTurnPage,
    messageBoxContextUsage,
    messageBoxDisabled,
    messageBoxProviderAvailable,
    pinnedChatMessageIds,
    recentlyOpenedFiles,
    renderedChatTurns,
    stoppedTurnActionDisabled,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    subagentChatConversationModel,
    subagentChatItemIndexesById,
    subagentMarkersByWorkingStepId,
    subagentVisibleChatItems,
    trailingChatCommitMarkers,
    visibleChatItems,
    workingStepIdsWithNextWorkingStep
  }
}
