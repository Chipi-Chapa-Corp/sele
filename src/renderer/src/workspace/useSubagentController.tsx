import { useLayoutEffect, useRef } from 'react'
import { mergeWorkingStepPage, mergeWorkingToolPage } from '../chatDetailWindow'
import { readChatScrollAnchor, restoreChatScrollAnchor, type ChatScrollAnchor } from '../chatLayout'
import type { SubagentChatView } from './controllerTypes'
import {
  chatWorkingItemPageSize,
  chatWorkingItemWindowSize,
  chatWorkingToolPageSize,
  chatWorkingToolWindowSize
} from './controllerTypes'
import type {
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderSubagent
} from '../../../shared/provider'
import { providerSubagentTurnPageSize } from '../../../shared/provider'
import { providerApi } from '../providerApi'
import { ChatCommitMarkerItem, type ChatCommitMarker } from '../components/AppStatusStates'
import { getErrorMessage, getProviderChatKey } from './chatControllerUtils'
import type { SubagentControllerDependencies } from './controllerDependencies'
import { beginSubagentPageNavigation, getWorkingSubagentIds } from '../subagentUi'

const subagentPageRequests = new WeakMap<object, number>()

// Return shape is inferred from the controller declarations below.
export function useSubagentController(dependencies: SubagentControllerDependencies) {
  const {
    activeSubagentChatView,
    subagents = [],
    selectedProviderId,
    selectedChatId,
    selectedChatKey,
    subagentChatLoadRequestRef,
    resetChatSearch,
    setEditingMessage,
    setSubagentChatView,
    selectedChatKeyRef,
    subagentContentRef,
    scrollChatContentToBottom,
    cancelingSubagentIds,
    setCancelingSubagentIds,
    setSubagentListState,
    contentRef,
    chatAutoScrollEnabledRef,
    chatViewportAnchorRef,
    chatScrollAdjustmentTargetRef,
    previousChatScrollTopRef,
    markSelectedChatSeen,
    scopedCommitActivitiesByMarkerId,
    providerUpdateInProgress,
    cancelingAiCommitKeys,
    openingAiCommitChatIds,
    handleCancelAiCommit,
    handleOpenAiCommitChat
  } = dependencies

  // Navigation belongs to the root conversation. Keep each opened viewport (and
  // a child's loaded history page) until the user leaves that conversation.
  const navigation = useRef({
    root: selectedChatKey,
    positions: new Map<
      string,
      {
        top: number
        anchor: ChatScrollAnchor | null
        autoScroll: boolean
        view: SubagentChatView | null
      }
    >(),
    restore: null as string | null
  })
  if (navigation.current.root !== selectedChatKey) {
    navigation.current = { root: selectedChatKey, positions: new Map(), restore: null }
  }
  const rememberViewport = (): void => {
    if (!selectedChatKey) return
    const element = activeSubagentChatView ? subagentContentRef.current : contentRef.current
    if (!element) return
    navigation.current.positions.set(activeSubagentChatView?.summary.id ?? '', {
      top: element.scrollTop,
      anchor: readChatScrollAnchor(element, selectedChatKey),
      autoScroll: chatAutoScrollEnabledRef.current,
      view: activeSubagentChatView
    })
  }
  useLayoutEffect(() => {
    const scope = activeSubagentChatView?.summary.id ?? ''
    if (
      navigation.current.restore !== scope ||
      (activeSubagentChatView && activeSubagentChatView.loadState !== 'ready')
    )
      return
    const saved = navigation.current.positions.get(scope)
    const element = activeSubagentChatView ? subagentContentRef.current : contentRef.current
    if (!saved || !element || !selectedChatKey) return
    navigation.current.restore = null
    element.scrollTop = saved.top
    if (saved.anchor) restoreChatScrollAnchor(element, saved.anchor)
    if (!activeSubagentChatView) {
      chatAutoScrollEnabledRef.current = saved.autoScroll
      chatViewportAnchorRef.current = readChatScrollAnchor(element, selectedChatKey)
      chatScrollAdjustmentTargetRef.current = { element, top: element.scrollTop }
      previousChatScrollTopRef.current = element.scrollTop
    }
  }, [activeSubagentChatView?.summary.id, activeSubagentChatView?.loadState, selectedChatKey])

  const handleOpenSubagentChat = async (subagent: ProviderSubagent): Promise<void> => {
    if (!selectedProviderId || !selectedChatId || !selectedChatKey) return

    rememberViewport()
    navigation.current.restore = null
    markSelectedChatSeen()
    const requestId = subagentChatLoadRequestRef.current + 1
    subagentChatLoadRequestRef.current = requestId
    resetChatSearch()
    setEditingMessage(null)
    setSubagentChatView({
      rootChatKey: selectedChatKey,
      summary: subagent,
      detail: null,
      loadState: 'loading',
      error: null
    })

    try {
      const detail = await providerApi.getSubagent(selectedProviderId, selectedChatId, subagent.id)
      if (
        subagentChatLoadRequestRef.current !== requestId ||
        selectedChatKeyRef.current !== selectedChatKey
      ) {
        return
      }

      setSubagentChatView({
        rootChatKey: selectedChatKey,
        summary: detail,
        detail,
        loadState: 'ready',
        error: null
      })
      window.requestAnimationFrame(() => {
        const contentElement = subagentContentRef.current
        if (contentElement) scrollChatContentToBottom(contentElement)
      })
    } catch (error) {
      console.error('[caught:useSubagentController:handleOpenSubagentChat]', error)
      if (
        subagentChatLoadRequestRef.current !== requestId ||
        selectedChatKeyRef.current !== selectedChatKey
      ) {
        return
      }

      setSubagentChatView({
        rootChatKey: selectedChatKey,
        summary: subagent,
        detail: null,
        loadState: 'error',
        error: getErrorMessage(error, 'Unable to open this subagent chat.')
      })
    }
  }
  const updateWorkingStep = (
    requestId: number,
    subagentId: string,
    workingStepId: string,
    update: (step: ProviderWorkingStep) => ProviderWorkingStep
  ): void => {
    if (
      subagentChatLoadRequestRef.current !== requestId ||
      selectedChatKeyRef.current !== selectedChatKey
    )
      return
    setSubagentChatView((view) => {
      if (view?.rootChatKey !== selectedChatKey || view.summary.id !== subagentId || !view.detail)
        return view
      return {
        ...view,
        detail: {
          ...view.detail,
          items: view.detail.items.map((item) =>
            item.type === 'working' && item.id === workingStepId ? update(item) : item
          )
        }
      }
    })
  }
  const mapWorkingItems = (
    step: ProviderWorkingStep,
    map: (item: ProviderWorkingItem) => ProviderWorkingItem
  ): ProviderWorkingStep => ({
    ...step,
    items: step.items.map(map),
    itemSegments: step.itemSegments?.map((segment) => ({
      ...segment,
      items: segment.items.map(map)
    }))
  })
  const handleLoadSubagentWorkingStep = async (
    workingStepId: string,
    requestedStartIndex?: number
  ): Promise<void> => {
    if (!selectedProviderId || !activeSubagentChatView?.detail) return
    const subagentId = activeSubagentChatView.summary.id
    const requestId = subagentChatLoadRequestRef.current
    const step = activeSubagentChatView.detail.items.find(
      (item) => item.type === 'working' && item.id === workingStepId
    )
    if (step?.type !== 'working') return
    const startIndex = Math.max(
      0,
      requestedStartIndex ?? (step.itemCount ?? step.items.length) - chatWorkingItemPageSize
    )
    const page = await providerApi.getChatWorkingStepPage(
      selectedProviderId,
      subagentId,
      workingStepId,
      startIndex,
      chatWorkingItemPageSize,
      selectedChatId
    )
    updateWorkingStep(requestId, subagentId, workingStepId, (current) =>
      mergeWorkingStepPage(current, page, chatWorkingItemPageSize, chatWorkingItemWindowSize)
    )
  }
  const handleNavigateSubagentTurns = async (
    direction: 'older' | 'newer' | 'latest'
  ): Promise<void> => {
    if (!selectedProviderId || !selectedChatId || !activeSubagentChatView?.detail) return
    const requestId = subagentChatLoadRequestRef.current
    if (subagentPageRequests.get(subagentChatLoadRequestRef) === requestId) return
    const detail = activeSubagentChatView.detail
    const start = detail.itemsStartTurnIndex ?? 0
    const pageSize = providerSubagentTurnPageSize
    const nextStart =
      direction === 'latest'
        ? null
        : direction === 'older'
          ? Math.max(0, start - pageSize)
          : Math.min(Math.max(0, (detail.turnCount ?? 0) - pageSize), start + pageSize)
    if (nextStart === start) return
    const subagentId = activeSubagentChatView.summary.id
    beginSubagentPageNavigation(subagentChatLoadRequestRef)
    subagentPageRequests.set(subagentChatLoadRequestRef, requestId)
    setSubagentChatView((view) =>
      view?.summary.id === subagentId && view.rootChatKey === selectedChatKey
        ? { ...view, pageLoading: true, error: null }
        : view
    )
    try {
      const page = await providerApi.getSubagent(selectedProviderId, selectedChatId, subagentId, {
        startIndex: nextStart,
        limit: pageSize
      })
      if (
        requestId !== subagentChatLoadRequestRef.current ||
        selectedChatKeyRef.current !== selectedChatKey
      )
        return
      setSubagentChatView((view) =>
        view?.summary.id === subagentId && view.rootChatKey === selectedChatKey
          ? {
              ...view,
              summary: page,
              detail: page,
              followLatest: nextStart === null || nextStart + pageSize >= (page.turnCount ?? 0),
              pageLoading: true,
              loadState: 'ready',
              error: null
            }
          : view
      )
      window.requestAnimationFrame(() => {
        const element = subagentContentRef.current
        if (element) element.scrollTop = direction === 'older' ? element.scrollHeight : 0
        // Native scroll events from positioning the replacement page must not load it back.
        window.requestAnimationFrame(() => {
          if (subagentChatLoadRequestRef.current !== requestId) return
          setSubagentChatView((view) =>
            view?.summary.id === subagentId && view.rootChatKey === selectedChatKey
              ? { ...view, pageLoading: false }
              : view
          )
        })
      })
    } catch (error) {
      console.error('[caught:useSubagentController:handleNavigateSubagentTurns]', error)
      if (
        requestId !== subagentChatLoadRequestRef.current ||
        selectedChatKeyRef.current !== selectedChatKey
      )
        return
      setSubagentChatView((view) =>
        view?.summary.id === subagentId && view.rootChatKey === selectedChatKey
          ? {
              ...view,
              pageLoading: false,
              error: getErrorMessage(error, 'Unable to load subagent messages.')
            }
          : view
      )
    } finally {
      if (subagentPageRequests.get(subagentChatLoadRequestRef) === requestId) {
        // Polls that started during navigation must not replace the newly loaded page either.
        beginSubagentPageNavigation(subagentChatLoadRequestRef)
        subagentPageRequests.delete(subagentChatLoadRequestRef)
      }
    }
  }
  const handleLoadSubagentWorkingToolPage = async (
    workingStepId: string,
    workingItemId: string,
    startIndex: number
  ): Promise<void> => {
    if (!selectedProviderId || !activeSubagentChatView?.detail) return
    const subagentId = activeSubagentChatView.summary.id
    const requestId = subagentChatLoadRequestRef.current
    const page = await providerApi.getChatWorkingToolPage(
      selectedProviderId,
      subagentId,
      workingStepId,
      workingItemId,
      startIndex,
      chatWorkingToolPageSize,
      selectedChatId
    )
    updateWorkingStep(requestId, subagentId, workingStepId, (step) =>
      mapWorkingItems(step, (item) =>
        item.type === 'toolGroup' && item.id === workingItemId
          ? mergeWorkingToolPage(item, page, chatWorkingToolWindowSize)
          : item
      )
    )
  }
  const handleLoadSubagentWorkingItem = async (
    workingStepId: string,
    workingItemId: string
  ): Promise<void> => {
    if (!selectedProviderId || !activeSubagentChatView?.detail) return
    const subagentId = activeSubagentChatView.summary.id
    const requestId = subagentChatLoadRequestRef.current
    const loaded = await providerApi.getChatWorkingItem(
      selectedProviderId,
      subagentId,
      workingStepId,
      workingItemId,
      selectedChatId
    )
    updateWorkingStep(requestId, subagentId, workingStepId, (step) =>
      mapWorkingItems(step, (item) => {
        if (item.id === workingItemId) return loaded
        if (item.type !== 'toolGroup' || loaded.type !== 'tool') return item
        return {
          ...item,
          tools: item.tools.map((tool) => (tool.id === workingItemId ? loaded : tool))
        }
      })
    )
  }
  const handleCancelSubagent = async (subagent: ProviderSubagent): Promise<void> => {
    if (
      !selectedProviderId ||
      !selectedChatId ||
      !selectedChatKey ||
      cancelingSubagentIds.has(subagent.id)
    ) {
      return
    }

    const descendants = new Set<string>([subagent.id])
    for (let changed = true; changed; ) {
      changed = false
      for (const agent of subagents) {
        if (agent.parentId && descendants.has(agent.parentId) && !descendants.has(agent.id)) {
          descendants.add(agent.id)
          changed = true
        }
      }
    }
    const working = getWorkingSubagentIds(subagents)
    const targets = [...descendants].filter((id) => id === subagent.id || working.has(id))
    setCancelingSubagentIds((currentIds) => new Set([...currentIds, ...targets]))
    try {
      const results = await Promise.allSettled(
        targets.map((id) => providerApi.cancelSubagent(selectedProviderId, selectedChatId, id))
      )
      const stopped = new Set(targets.filter((_, index) => results[index].status === 'fulfilled'))
      const failure = results.find((result) => result.status === 'rejected')
      const error =
        failure?.status === 'rejected'
          ? getErrorMessage(failure.reason, 'Unable to stop this subagent.')
          : null
      const stopAgent = (agent: ProviderSubagent): ProviderSubagent =>
        stopped.has(agent.id) ? { ...agent, status: 'stopped', updatedAt: Date.now() } : agent
      setSubagentListState((state) =>
        state?.rootChatKey === selectedChatKey
          ? { ...state, items: state.items.map(stopAgent), loadState: 'ready', error }
          : state
      )
      setSubagentChatView((view) =>
        view?.rootChatKey === selectedChatKey && stopped.has(view.summary.id)
          ? {
              ...view,
              summary: stopAgent(view.summary),
              detail: view.detail ? { ...view.detail, ...stopAgent(view.detail) } : null
            }
          : view
      )
    } finally {
      setCancelingSubagentIds((currentIds) => {
        const next = new Set(currentIds)
        targets.forEach((id) => next.delete(id))
        return next
      })
    }
  }
  const returnToParent = (toRoot: boolean): void => {
    const parent = toRoot
      ? undefined
      : subagents.find((agent) => agent.id === activeSubagentChatView?.summary.parentId)
    rememberViewport()
    const scope = parent?.id ?? ''
    const saved = navigation.current.positions.get(scope)
    if (parent) {
      if (saved?.view) {
        subagentChatLoadRequestRef.current += 1
        resetChatSearch()
        navigation.current.restore = scope
        setSubagentChatView({ ...saved.view, summary: parent, pageLoading: false })
        return
      }
      void handleOpenSubagentChat(parent)
      return
    }
    subagentChatLoadRequestRef.current += 1
    resetChatSearch()
    markSelectedChatSeen()
    navigation.current.restore = saved ? '' : null
    if (saved) chatAutoScrollEnabledRef.current = saved.autoScroll
    setSubagentChatView(null)
  }
  const handleReturnFromSubagentChat = (): void => returnToParent(false)
  const handleReturnToRootChat = (): void => returnToParent(true)
  const renderChatCommitMarker = (marker: ChatCommitMarker): React.ReactElement => {
    const activity = scopedCommitActivitiesByMarkerId.get(marker.id)
    const activityKey = activity ? getProviderChatKey(activity.providerId, activity.chatId) : null

    return (
      <ChatCommitMarkerItem
        marker={marker}
        canceling={
          providerUpdateInProgress || Boolean(activityKey && cancelingAiCommitKeys.has(activityKey))
        }
        key={marker.id}
        opening={Boolean(marker.commitChatId && openingAiCommitChatIds.has(marker.commitChatId))}
        onCancel={activity ? () => handleCancelAiCommit(activity) : undefined}
        onOpen={marker.commitChatId ? () => handleOpenAiCommitChat(marker) : undefined}
      />
    )
  }

  return {
    handleNavigateSubagentTurns,
    handleLoadSubagentWorkingStep,
    handleLoadSubagentWorkingItem,
    handleLoadSubagentWorkingToolPage,
    handleReturnFromSubagentChat,
    handleReturnToRootChat,
    renderChatCommitMarker,
    handleOpenSubagentChat,
    handleCancelSubagent
  }
}
