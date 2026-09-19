import { mergeWorkingStepPage, mergeWorkingToolPage } from '../chatDetailWindow'
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
import { providerApi } from '../providerApi'
import {
  ChatCommitMarkerItem,
  ChatSubagentMarkerItem,
  type ChatCommitMarker
} from '../components/AppStatusStates'
import { getErrorMessage, getProviderChatKey } from './chatControllerUtils'
import type { SubagentControllerDependencies } from './controllerDependencies'

// Return shape is inferred from the controller declarations below.
export function useSubagentController(dependencies: SubagentControllerDependencies) {
  const {
    activeSubagentChatView,
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
    scopedCommitActivitiesByMarkerId,
    providerUpdateInProgress,
    cancelingAiCommitKeys,
    openingAiCommitChatIds,
    handleCancelAiCommit,
    handleOpenAiCommitChat
  } = dependencies

  const handleOpenSubagentChat = async (subagent: ProviderSubagent): Promise<void> => {
    if (!selectedProviderId || !selectedChatId || !selectedChatKey) return

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

    setCancelingSubagentIds((currentIds) => new Set(currentIds).add(subagent.id))
    try {
      await providerApi.cancelSubagent(selectedProviderId, selectedChatId, subagent.id)
      const stoppedSubagent: ProviderSubagent = {
        ...subagent,
        status: 'stopped',
        updatedAt: Date.now()
      }
      setSubagentListState((currentState) =>
        currentState?.rootChatKey === selectedChatKey
          ? {
              ...currentState,
              items: currentState.items.map((item) =>
                item.id === subagent.id ? stoppedSubagent : item
              ),
              loadState: 'ready',
              error: null
            }
          : currentState
      )
      setSubagentChatView((currentView) =>
        currentView?.rootChatKey === selectedChatKey && currentView.summary.id === subagent.id
          ? {
              ...currentView,
              summary: stoppedSubagent,
              detail: currentView.detail
                ? { ...currentView.detail, ...stoppedSubagent }
                : currentView.detail
            }
          : currentView
      )
    } catch (error) {
      console.error('[caught:useSubagentController:handleCancelSubagent]', error)
      setSubagentListState((currentState) =>
        currentState?.rootChatKey === selectedChatKey
          ? {
              ...currentState,
              error: getErrorMessage(error, 'Unable to cancel this subagent.')
            }
          : currentState
      )
    } finally {
      setCancelingSubagentIds((currentIds) => {
        if (!currentIds.has(subagent.id)) return currentIds
        const nextIds = new Set(currentIds)
        nextIds.delete(subagent.id)
        return nextIds
      })
    }
  }
  const handleReturnFromSubagentChat = (): void => {
    subagentChatLoadRequestRef.current += 1
    resetChatSearch()
    setSubagentChatView(null)
    window.requestAnimationFrame(() => {
      const contentElement = contentRef.current
      if (contentElement) scrollChatContentToBottom(contentElement)
    })
  }
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
  const renderChatSubagentMarker = (subagent: ProviderSubagent): React.ReactElement => (
    <ChatSubagentMarkerItem
      canceling={cancelingSubagentIds.has(subagent.id)}
      key={subagent.id}
      onCancel={
        subagent.status === 'pending' || subagent.status === 'running'
          ? () => handleCancelSubagent(subagent)
          : undefined
      }
      subagent={subagent}
      onOpen={() => handleOpenSubagentChat(subagent)}
    />
  )

  return {
    handleLoadSubagentWorkingStep,
    handleLoadSubagentWorkingItem,
    handleLoadSubagentWorkingToolPage,
    handleReturnFromSubagentChat,
    renderChatCommitMarker,
    renderChatSubagentMarker
  }
}
