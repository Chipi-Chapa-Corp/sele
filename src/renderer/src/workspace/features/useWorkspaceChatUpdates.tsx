import { startTransition, useEffect } from 'react'
import type { ProviderChatDetail } from '../../../../shared/provider'
import { getChatCommitMarkerTerminalStatus } from '../../chatCommitMarker'
import {
  getChatDetailTurnCount,
  retainLoadedChatDetailTurnWindow,
  shouldPreserveOptimisticTurnUntilUserMessage
} from '../../chatDetailWindow'
import { chatTerminalActivity } from '../../chatTerminalActivity'
import { getEffectiveChatTurnWindow, getLatestChatTurnWindow } from '../../chatTurnWindow'
import { conversationViews } from '../../conversationViews'
import { providerApi } from '../../providerApi'
import {
  getChatDetailFromUpdate,
  getChatKey,
  getCommitActivityCurrentAction,
  getCommitActivityCurrentActionFromSummary,
  getLastChatCommitMarkerAnchorId,
  isActiveChatStatus,
  isChatDetailSnapshotStale
} from '../chatControllerUtils'
import { chatTurnWindowSize, streamingChatUpdateIntervalMs } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useWorkspaceChatProjection } from './useWorkspaceChatProjection'

type WorkspaceChatUpdatesDependencies = {
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  chatProjection: ReturnType<typeof useWorkspaceChatProjection>
  gitState: ReturnType<typeof useWorkspaceGitState>
}

export function useWorkspaceChatUpdates({
  subagentState,
  chatState,
  viewportState,
  chatProjection,
  gitState
}: WorkspaceChatUpdatesDependencies) {
  useEffect(
    () =>
      providerApi.onChatUpdated((event) => {
        if (event.conversationView)
          conversationViews.install(event.providerId, [event.conversationView], true)
        const updatedChatKey = getChatKey({ providerId: event.providerId, id: event.chatId })
        if (event.detail?.subagents)
          subagentState.updateSubagentWorkingChat(updatedChatKey, event.detail.subagents)
        chatTerminalActivity.requestProbe(updatedChatKey)
        const viewingUpdatedChat = chatState.selectedChatKeyRef.current === updatedChatKey
        const staleSelectedDetail = Boolean(
          viewingUpdatedChat &&
            event.detail &&
            isChatDetailSnapshotStale(event.detail, chatState.chatDetailRef.current)
        )
        const mergedSelectedDetail =
          viewingUpdatedChat && event.detail && !staleSelectedDetail
            ? getChatDetailFromUpdate(event.detail, chatState.chatDetailRef.current, {
                preserveCurrentTurnWindow: !viewportState.chatAutoScrollEnabledRef.current,
                preserveOptimisticTurnUntilUserMessage:
                  shouldPreserveOptimisticTurnUntilUserMessage(event.providerId)
              })
            : null
        const selectedDetail = (() => {
          if (!mergedSelectedDetail) return null
          const currentWindow = chatState.chatTurnWindowRef.current
          if (!currentWindow || currentWindow.chatKey !== updatedChatKey) {
            return mergedSelectedDetail.detail
          }

          const totalCount = getChatDetailTurnCount(mergedSelectedDetail.detail)
          const retainedWindow = getEffectiveChatTurnWindow(
            currentWindow,
            getLatestChatTurnWindow(updatedChatKey, totalCount, chatTurnWindowSize),
            viewportState.chatAutoScrollEnabledRef.current
          )
          return retainLoadedChatDetailTurnWindow(mergedSelectedDetail.detail, retainedWindow)
        })()
        const selectedDetailMatchesDeliveredTranscript = Boolean(
          selectedDetail &&
            mergedSelectedDetail?.detailApplied &&
            selectedDetail.revision === mergedSelectedDetail.detail.revision &&
            selectedDetail.items.length === mergedSelectedDetail.detail.items.length &&
            selectedDetail.items.every(
              (item, index) => item.id === mergedSelectedDetail.detail.items[index]?.id
            )
        )

        if (staleSelectedDetail) {
          // A direct history/latest read can complete while an older streamed snapshot is still
          // in flight. Do not let that packet replace the newer transcript or trigger a resync.
          providerApi.acknowledgeChatUpdate(event.sequence, false)
        } else if (selectedDetail) {
          chatState.chatDetailResyncRequestIdRef.current += 1
          chatState.chatDetailResyncRef.current = null
          const publish = (): void => {
            chatProjection.applyChatDetail(event.providerId, selectedDetail)
            // Acknowledge only when this same transcript update commits.
            chatState.setCommittedChatUpdate({
              detailApplied: selectedDetailMatchesDeliveredTranscript,
              sequence: event.sequence,
              turnCompleted: event.turnCompleted
            })
          }
          // Provider delivery, including the first or recovered snapshot, must
          // not promote a pending selection into a blocking workspace render.
          startTransition(publish)
        } else {
          // Other conversations can publish many summaries while the user types.
          // Keep their sidebar work interruptible, like the active transcript,
          // instead of promoting the entire workspace to an urgent render.
          startTransition(() => {
            chatProjection.applyChatSummary(event.providerId, event.summary, event.turnCompleted)
          })
          if (viewingUpdatedChat) {
            const retainedDetail =
              chatState.chatDetailRef.current ??
              conversationViews.get({
                ...event.summary,
                providerId: event.providerId
              })
            if (retainedDetail && !chatState.chatDetailRef.current) {
              chatState.chatDetailRef.current = retainedDetail
              startTransition(() => {
                chatState.setChatDetail(retainedDetail)
                chatState.setChatLoadState('ready')
              })
            }
            if (
              retainedDetail?.id === event.chatId &&
              (retainedDetail.historyPreview || retainedDetail.revision < event.summary.revision)
            ) {
              // Keep the selected chat interactive while recovering a missed or unmergeable
              // detail update. Clearing it would disable and blur the focused message composer.
              const currentResync = chatState.chatDetailResyncRef.current
              if (!currentResync || currentResync.chatKey !== updatedChatKey) {
                const requestId = chatState.chatDetailResyncRequestIdRef.current + 1
                chatState.chatDetailResyncRequestIdRef.current = requestId
                chatState.chatDetailResyncRef.current = { chatKey: updatedChatKey, requestId }

                void providerApi
                  .getChat(event.providerId, event.chatId)
                  .then((detail) => {
                    const pendingResync = chatState.chatDetailResyncRef.current
                    if (
                      pendingResync?.requestId !== requestId ||
                      pendingResync.chatKey !== updatedChatKey
                    ) {
                      return
                    }

                    chatState.chatDetailResyncRef.current = null
                    if (chatState.selectedChatKeyRef.current !== updatedChatKey) return
                    startTransition(() => chatProjection.applyChatDetail(event.providerId, detail))
                  })
                  .catch((error: unknown) => {
                    console.error('Unable to resynchronize an updated chat.', error)
                    if (chatState.chatDetailResyncRef.current?.requestId === requestId) {
                      chatState.chatDetailResyncRef.current = null
                    }
                  })
              }
            } else if (!retainedDetail) {
              chatState.chatDetailRef.current = null
              chatState.setChatDetail(null)
              chatState.setChatLoadState('loading')
              chatState.setChatLoadRequest((currentRequest) => currentRequest + 1)
            }
          }
          providerApi.acknowledgeChatUpdate(event.sequence, false)
        }
        if (
          event.turnCompleted &&
          gitState.changesCwdRef.current &&
          event.summary.cwd === gitState.changesCwdRef.current
        ) {
          gitState.setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
          gitState.setGitBranchLoadRequest((currentRequest) => currentRequest + 1)
          gitState.setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
        }
        const commitActivity = gitState.scopedCommitActivitiesRef.current[updatedChatKey]
        if (commitActivity && !isActiveChatStatus(event.summary.status)) {
          const finishCommitActivity = (detail: ProviderChatDetail): void => {
            gitState.setChatCommitMarkers((currentMarkers) => {
              const marker = currentMarkers[commitActivity.markerId]
              if (!marker || marker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...marker,
                  status: getChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    commitActivity.chatId === commitActivity.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                      : marker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
            gitState.setScopedCommitActivities((currentActivities) => {
              if (!currentActivities[updatedChatKey]) return currentActivities

              const nextActivities = { ...currentActivities }
              delete nextActivities[updatedChatKey]
              return nextActivities
            })
          }

          if (selectedDetail) {
            finishCommitActivity(selectedDetail)
          } else {
            void providerApi
              .getChat(event.providerId, event.chatId)
              .then(finishCommitActivity)
              .catch((error: unknown) => {
                console.error('Unable to load a chat while finishing commit activity.', error)
                // Keep the activity pending so startup recovery can finish it later.
              })
          }
        }
        if (commitActivity && isActiveChatStatus(event.summary.status)) {
          gitState.setScopedCommitActivities((currentActivities) => {
            const currentActivity = currentActivities[updatedChatKey]
            if (!currentActivity) return currentActivities

            return {
              ...currentActivities,
              [updatedChatKey]: {
                ...currentActivity,
                currentAction: selectedDetail
                  ? getCommitActivityCurrentAction(selectedDetail, currentActivity.commitAction)
                  : getCommitActivityCurrentActionFromSummary(
                      event.summary,
                      currentActivity.commitAction
                    )
              }
            }
          })
        }
      }),
    [
      chatProjection.applyChatDetail,
      chatProjection.applyChatSummary,
      subagentState.updateSubagentWorkingChat,
      chatState.chatDetailRef,
      chatState.chatDetailResyncRef,
      chatState.chatDetailResyncRequestIdRef,
      chatState.chatTurnWindowRef,
      chatState.selectedChatKeyRef,
      chatState.setChatDetail,
      chatState.setChatLoadRequest,
      chatState.setChatLoadState,
      chatState.setCommittedChatUpdate,
      gitState.changesCwdRef,
      gitState.scopedCommitActivitiesRef,
      gitState.setChatCommitMarkers,
      gitState.setFileTreeLoadRequest,
      gitState.setGitBranchLoadRequest,
      gitState.setGitChangeLoadRequest,
      gitState.setScopedCommitActivities,
      viewportState.chatAutoScrollEnabledRef
    ]
  )

  useEffect(() => {
    const committedChatUpdate = chatState.committedChatUpdate
    if (!committedChatUpdate) return
    if (committedChatUpdate.turnCompleted) {
      providerApi.acknowledgeChatUpdate(
        committedChatUpdate.sequence,
        committedChatUpdate.detailApplied
      )
      return
    }

    const timeout = window.setTimeout(() => {
      providerApi.acknowledgeChatUpdate(
        committedChatUpdate.sequence,
        committedChatUpdate.detailApplied
      )
    }, streamingChatUpdateIntervalMs)
    return () => window.clearTimeout(timeout)
  }, [chatState.committedChatUpdate])
  return {}
}
