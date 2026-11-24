import { Captions, ThumbsUp } from 'lucide-react'
import { Fragment, useCallback, useMemo } from 'react'
import {
  alignBenchmarkTurns,
  getBenchmarkTurnOutput,
  getUserTurnStart,
  splitBenchmarkSideHistory,
  toBenchmarkRound
} from '../../benchmark'
import { buildChatConversationModel } from '../../chatConversationModel'
import { getChatItemRenderKey } from '../../chatItemIdentity'
import { Button } from '../../components/Button'
import { getProviderChatTurns, type ProviderChatTurn } from '../../../../shared/chatTurns'
import { shouldDisableRateLimitReset } from '../../accountRateLimits'
import { providerApi } from '../../providerApi'
import {
  renderConversationTurn,
  renderConversationTurnContents,
  type ChatTurnInputs,
  type RootChatTurnInputs
} from '../chatTurnRendering'
import { useStableProps } from '../stableProps'
import { useWorkspaceSubagentPresentation } from './useWorkspaceSubagentPresentation'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function useWorkspaceTurnRendering({
  subagentPresentation,
  effectiveSelection,
  settings,
  providerState,
  scroll,
  chatState,
  chatErrors,
  benchmark,
  session,
  messaging,
  interactions,
  conversation,
  files,
  subagents
}: WorkspaceChanges & {
  subagentPresentation: ReturnType<typeof useWorkspaceSubagentPresentation>
}) {
  const {
    accountUsage,
    changesContainer,
    changesCwd,
    changesProjectCwd,
    selectedChatKey,
    refreshAccountUsage,
    resetAccountRateLimits,
    activeSubagentChatView
  } = session
  const {
    handleLoadWorkingStep,
    handleLoadWorkingItem,
    handleLoadWorkingToolPage,
    handleDeletePendingMessage,
    handleEditPendingMessage,
    handleSteerPendingMessage,
    handleInterruptPendingMessage,
    handleContinueStoppedTurn,
    handleEditMessage,
    handleRetryStoppedTurn,
    handleStartGoalChat
  } = messaging
  const { chatHasActiveTurn, chatHasPendingSteeringMessage, handleForkMessage } = interactions
  const {
    chatItemIndexesById,
    visibleChatItems,
    followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets,
    renderedChatTurns,
    effectiveChatTurnWindow,
    firstPendingChatItemId,
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers,
    canEditOwnMessages,
    stoppedTurnActionDisabled,
    continuedStoppedWorkingStepIds,
    pinnedChatMessageIds,
    canRetryStoppedTurns,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    subagentChatItemIndexesById,
    subagentVisibleChatItems,
    subagentChatConversationModel
  } = conversation
  const { handleOpenFileLink, handleToggleChatMessagePinned } = files
  const {
    renderChatCommitMarker,
    handleLoadSubagentWorkingStep,
    handleLoadSubagentWorkingItem,
    handleLoadSubagentWorkingToolPage
  } = subagents

  const rateLimitResetDisabled = shouldDisableRateLimitReset(
    accountUsage?.rateLimits ?? [],
    accountUsage?.rateLimitResetCredits?.credits ?? null,
    Date.now(),
    accountUsage?.rateLimitResetCredits?.options !== undefined
  )

  const sharedTurnInputs = {
    renderSubagentCompletion: subagentPresentation.renderSubagentCompletion,
    container: changesContainer,
    cwd: changesCwd,
    projectCwd: changesProjectCwd,
    modelLabelsById: effectiveSelection.modelLabelsById,
    resolvedModelIdsById: effectiveSelection.resolvedModelIdsById,
    progressSettings: settings.effectiveAppSettings.chat,
    selectedModelId: providerState.model,
    onOpenFileLink: changesCwd ? handleOpenFileLink : undefined
  }
  // Handlers call the current controller, but changing their closures must not
  // invalidate every cached message during unrelated workspace updates.
  const rootChatTurnInputs = useStableProps<RootChatTurnInputs>({
    ...sharedTurnInputs,
    itemIndexesById: chatItemIndexesById,
    visibleChatItems,
    followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets,
    subagentCompletions: subagentPresentation.rootSubagentCompletions,
    onLoadWorkingStep: handleLoadWorkingStep,
    onLoadWorkingItem: handleLoadWorkingItem,
    onLoadWorkingToolPage: handleLoadWorkingToolPage,
    latestRenderedTurn: renderedChatTurns.at(-1),
    windowIncludesLatest: effectiveChatTurnWindow?.endIndex === effectiveChatTurnWindow?.totalCount,
    firstPendingChatItemId,
    scheduleChatAutoScroll: scroll.scheduleChatAutoScroll,
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers,
    renderChatCommitMarker,
    mcpAppScopeProviderId: chatState.selectedChat?.providerId ?? null,
    mcpAppScopeChatId: chatState.selectedChat?.id ?? null,
    motionChatKey: selectedChatKey,
    authenticationRequired: chatErrors.authenticationRequired,
    availableRateLimitResets: accountUsage?.rateLimitResetCredits?.availableCount ?? 0,
    rateLimitResetOptions: accountUsage?.rateLimitResetCredits?.options,
    canEditOwnMessages: !benchmark.active && canEditOwnMessages,
    continuePrompt: settings.effectiveAppSettings.chat.continuePrompt,
    stoppedTurnActionDisabled,
    continuedStoppedWorkingStepIds,
    pinnedChatMessageIds,
    rateLimitResetDisabled,
    canRetryStoppedTurns: !benchmark.active && canRetryStoppedTurns,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    onDeletePendingMessage: handleDeletePendingMessage,
    onEditPendingMessage: benchmark.active ? undefined : handleEditPendingMessage,
    onSteerPendingMessage:
      (chatHasActiveTurn || benchmark.companionActive) && !chatHasPendingSteeringMessage
        ? handleSteerPendingMessage
        : undefined,
    onInterruptPendingMessage: handleInterruptPendingMessage,
    onContinueStoppedTurn: benchmark.active ? undefined : handleContinueStoppedTurn,
    onEditMessage: handleEditMessage,
    onForkMessage:
      benchmark.active ||
      chatHasActiveTurn ||
      chatState.forkingMessageId ||
      chatState.chatDetail?.historyPreview
        ? undefined
        : handleForkMessage,
    onDisclosureToggle: scroll.handleChatDisclosureToggle,
    onToggleMessagePinned: handleToggleChatMessagePinned,
    onRetryStoppedTurn: handleRetryStoppedTurn,
    onManageAccounts: chatErrors.handleManageChatAccounts,
    onReauthenticate: chatErrors.handleOpenChatReauthentication,
    onUsageRefresh: refreshAccountUsage,
    onUsageReset: resetAccountRateLimits
  })

  const subagentChatTurnInputs = useStableProps<ChatTurnInputs>({
    ...sharedTurnInputs,
    itemIndexesById: subagentChatItemIndexesById,
    visibleChatItems: subagentVisibleChatItems,
    followingWorkingStepsById: subagentChatConversationModel.followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep:
      subagentChatConversationModel.workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets:
      subagentChatConversationModel.steeredWorkingStepDisclosureTargets,
    subagentCompletions: subagentPresentation.childSubagentCompletions,
    onLoadWorkingStep: handleLoadSubagentWorkingStep,
    onLoadWorkingItem: handleLoadSubagentWorkingItem,
    onLoadWorkingToolPage: handleLoadSubagentWorkingToolPage
  })

  const secondaryModel = useMemo(
    () => buildChatConversationModel(benchmark.companionItems),
    [benchmark.companionItems]
  )
  const secondaryItemIndexes = useMemo(
    () => new Map(benchmark.companionItems.map(({ id }, index) => [id, index])),
    [benchmark.companionItems]
  )
  const secondaryChatTurnInputs = useStableProps<ChatTurnInputs>({
    ...sharedTurnInputs,
    cwd: benchmark.companion?.cwd ?? null,
    selectedModelId: benchmark.secondarySelection.model,
    itemIndexesById: secondaryItemIndexes,
    visibleChatItems: benchmark.companionItems,
    followingWorkingStepsById: secondaryModel.followingWorkingStepsById,
    workingStepIdsWithNextWorkingStep: secondaryModel.workingStepIdsWithNextWorkingStep,
    steeredWorkingStepDisclosureTargets: secondaryModel.steeredWorkingStepDisclosureTargets,
    subagentCompletions: { before: new Map(), after: new Map() },
    onLoadWorkingStep: benchmark.loadWorkingStep,
    onLoadWorkingItem: benchmark.loadWorkingItem,
    onLoadWorkingToolPage: benchmark.loadWorkingToolPage,
    mcpAppScopeProviderId: chatState.selectedChat?.providerId ?? null,
    mcpAppScopeChatId: benchmark.companion?.id,
    motionChatKey: benchmark.companion?.id ?? null,
    streamingChatItemId: benchmark.companionActive
      ? benchmark.companionItems.findLast(
          (item) => item.type === 'message' && item.role === 'assistant'
        )?.id
      : undefined,
    scheduleChatAutoScroll: scroll.scheduleChatAutoScroll
  })
  const benchmarkTranscript = useMemo(() => {
    const secondary = getProviderChatTurns(benchmark.companionItems)
    const split =
      benchmark.active && benchmark.sideHistory
        ? splitBenchmarkSideHistory(renderedChatTurns, secondary, benchmark.sideHistory)
        : null
    return {
      pairs: alignBenchmarkTurns(
        split?.primary ?? renderedChatTurns,
        split?.secondary ?? secondary
      ),
      trials: new Map(split?.trials.map(({ turn, side }) => [turn.id, side])),
      turns: split ? [...split.primary, ...split.trials.map(({ turn }) => turn)] : renderedChatTurns
    }
  }, [renderedChatTurns, benchmark.companionItems, benchmark.sideHistory, benchmark.active])
  const benchmarkTurn = useStableProps({
    active: benchmark.active,
    busy: benchmark.busy || chatState.sendState === 'sending',
    working: benchmark.working,
    round: benchmark.round,
    results: benchmark.results,
    vote: benchmark.vote,
    sync: benchmark.sync
  })
  const turnInputs = activeSubagentChatView ? subagentChatTurnInputs : rootChatTurnInputs
  const renderChatTurn = useCallback(
    (turnIndex: number, turn: ProviderChatTurn): React.ReactElement => {
      const pair = activeSubagentChatView ? undefined : benchmarkTranscript.pairs.get(turn.id)
      const trial = activeSubagentChatView ? undefined : benchmarkTranscript.trials.get(turn.id)
      const start = getUserTurnStart(turn)
      if ((!pair && !trial) || !start) return renderConversationTurn(turnInputs, turnIndex, turn)
      const outcome = benchmarkTurn.results.get(turn.id)?.outcome
      const single = outcome === 'primary' || outcome === 'secondary'
      const judged =
        pair && benchmarkTurn.active && !single
          ? benchmarkTurn.round?.turnId === turn.id
            ? benchmarkTurn.round
            : toBenchmarkRound(turn, pair)
          : null
      return (
        <div
          className="chat-detail__turn benchmark-round"
          data-benchmark-side={trial}
          data-chat-turn-id={turn.id}
          data-chat-turn-index={turnIndex}
          key={getChatItemRenderKey(start)}
        >
          {renderConversationTurnContents(
            trial === 'secondary' ? secondaryChatTurnInputs : turnInputs,
            turnIndex,
            { ...turn, items: [start] }
          )}
          <div
            className={
              single
                ? 'benchmark-round__answers benchmark-round__answers--single'
                : 'benchmark-round__answers'
            }
          >
            {(['primary', 'secondary'] as const).map((side) => {
              if (single && outcome !== side) return null
              const primary = side === 'primary'
              const label = primary ? 'Main agent' : 'Secondary agent'
              const output = trial
                ? trial === side
                  ? [turn]
                  : []
                : primary
                  ? [turn]
                  : pair
                    ? [pair.secondary, ...pair.trailing]
                    : []
              const inputs = primary ? turnInputs : secondaryChatTurnInputs
              const lastAnswer = output
                .findLast(({ items }) =>
                  items.some((item) => item.type === 'message' && item.role === 'assistant')
                )
                ?.items.findLast((item) => item.type === 'message' && item.role === 'assistant')
              const actions =
                benchmarkTurn.active && !benchmarkTurn.working && lastAnswer
                  ? {
                      itemId: lastAnswer.id,
                      content: (
                        <>
                          {judged?.votable && (
                            <Button
                              theme="secondary"
                              size="small"
                              title={`Like ${label.toLowerCase()} answer`}
                              aria-label={`Like ${label.toLowerCase()} answer`}
                              icon={<ThumbsUp aria-hidden="true" />}
                              disabled={benchmarkTurn.busy}
                              callback={() => benchmarkTurn.vote(side, judged)}
                            />
                          )}
                          <Button
                            theme="secondary"
                            size="small"
                            title={`Copy ${label.toLowerCase()} worktree to the other agent`}
                            aria-label={`Copy ${label.toLowerCase()} worktree to the other agent`}
                            icon={<Captions aria-hidden="true" />}
                            disabled={benchmarkTurn.busy}
                            callback={() => benchmarkTurn.sync(side)}
                          />
                        </>
                      )
                    }
                  : undefined
              return (
                <section className="benchmark-round__answer" aria-label={label} key={side}>
                  {output.map((part) => (
                    <Fragment key={part.id}>
                      {renderConversationTurnContents(
                        inputs,
                        turnIndex,
                        {
                          ...part,
                          items: getBenchmarkTurnOutput(part)
                        },
                        actions
                      )}
                    </Fragment>
                  ))}
                </section>
              )
            })}
          </div>
        </div>
      )
    },
    [
      turnInputs,
      secondaryChatTurnInputs,
      activeSubagentChatView,
      benchmarkTranscript,
      benchmarkTurn
    ]
  )

  const showChatTurnDownButton = Boolean(
    !activeSubagentChatView &&
      effectiveChatTurnWindow &&
      (!chatState.chatAtConversationBottom ||
        effectiveChatTurnWindow.endIndex < effectiveChatTurnWindow.totalCount ||
        Boolean(chatState.chatDetail?.turnPagination?.newerCursor))
  )

  const handleSaveGoalObjective = async (objective: string | null): Promise<void> => {
    if (!chatState.selectedChat) {
      if (objective) await handleStartGoalChat(objective)
      return
    }
    if (chatState.chatDetailRef.current?.historyPreview) return
    await providerApi.setChatGoal(
      chatState.selectedChat.providerId,
      chatState.selectedChat.id,
      objective
    )
  }
  return {
    renderChatTurn,
    renderedChatTurns: benchmarkTranscript.turns,
    showChatTurnDownButton,
    handleSaveGoalObjective
  }
}
