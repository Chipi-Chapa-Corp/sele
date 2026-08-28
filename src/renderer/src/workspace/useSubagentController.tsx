import type { ProviderSubagent } from '../../../shared/provider'
import { providerApi } from '../providerApi'
import {
  ChatCommitMarkerItem,
  ChatSubagentMarkerItem,
  type ChatCommitMarker
} from '../components/AppStatusStates'
import { getErrorMessage, getProviderChatKey } from './chatControllerUtils'
import type { SubagentControllerDependencies } from './controllerDependencies'

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSubagentController(dependencies: SubagentControllerDependencies) {
  const {
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

  return { handleReturnFromSubagentChat, renderChatCommitMarker, renderChatSubagentMarker }
}
