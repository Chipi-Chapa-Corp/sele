import type { ComponentProps, ReactElement } from 'react'
import type { ProviderChatTurn } from '../../../shared/chatTurns'
import type { ProviderChatItem, ProviderMessage } from '../../../shared/provider'
import type { FollowingWorkingStep } from '../chatConversationModel'
import type { ChatCommitMarker } from '../components/AppStatusStates'
import { ChatDetailItem } from '../components/ChatDetailItem'
import { DeferredChatTurn } from '../components/DeferredChatTurn'
import type { SubagentCompletion } from '../subagentTimeline'
import {
  getWorkingStepProgressPolicy,
  type WorkingStepDisclosureTarget
} from '../workingStepDisclosure'

// Conversation turns render from these explicit inputs only. Being outside the
// workspace hook, the renderers can't read anything else, so memoizing them on
// their inputs is exact: the message list rerenders when, and only when, a turn
// could render differently.

type ItemProps = ComponentProps<typeof ChatDetailItem>

export type SubagentCompletionPlacements = {
  before: ReadonlyMap<string, SubagentCompletion[]>
  after: ReadonlyMap<string, SubagentCompletion[]>
}

type SharedTurnInputs = {
  itemIndexesById: ReadonlyMap<string, number>
  visibleChatItems: readonly ProviderChatItem[]
  followingWorkingStepsById: ReadonlyMap<string, FollowingWorkingStep>
  workingStepIdsWithNextWorkingStep: ReadonlySet<string>
  steeredWorkingStepDisclosureTargets: ReadonlyMap<string, WorkingStepDisclosureTarget>
  subagentCompletions: SubagentCompletionPlacements
  renderSubagentCompletion: (completion: SubagentCompletion) => ReactElement
  container: ItemProps['container']
  cwd: ItemProps['cwd']
  projectCwd: ItemProps['projectCwd']
  modelLabelsById: ItemProps['modelLabelsById']
  resolvedModelIdsById: ItemProps['resolvedModelIdsById']
  progressSettings: ItemProps['progressSettings']
  selectedModelId: ItemProps['selectedModelId']
  onOpenFileLink: ItemProps['onOpenFileLink']
  onLoadWorkingStep: ItemProps['onLoadWorkingStep']
  onLoadWorkingItem: ItemProps['onLoadWorkingItem']
  onLoadWorkingToolPage: ItemProps['onLoadWorkingToolPage']
}

export type RootChatTurnInputs = SharedTurnInputs & {
  latestRenderedTurn: ProviderChatTurn | undefined
  windowIncludesLatest: boolean
  firstPendingChatItemId: string | null
  scheduleChatAutoScroll: () => void
  chatCommitMarkersByBeforeItemId: ReadonlyMap<string, ChatCommitMarker[]>
  chatCommitMarkersByAfterItemId: ReadonlyMap<string, ChatCommitMarker[]>
  trailingChatCommitMarkers: readonly ChatCommitMarker[]
  renderChatCommitMarker: (marker: ChatCommitMarker) => ReactElement
  mcpAppScopeProviderId: NonNullable<ItemProps['mcpAppScope']>['providerId'] | null
  mcpAppScopeChatId: string | null
  motionChatKey: ItemProps['motionChatKey']
  authenticationRequired: ItemProps['authenticationRequired']
  availableRateLimitResets: number
  canEditOwnMessages: boolean
  continuePrompt: ItemProps['continuePrompt']
  stoppedTurnActionDisabled: boolean
  continuedStoppedWorkingStepIds: ReadonlySet<string>
  pinnedChatMessageIds: ReadonlySet<string>
  rateLimitResetDisabled: boolean
  canRetryStoppedTurns: boolean
  stoppedTurnRetryMessages: ReadonlyMap<string, ProviderMessage>
  streamingChatItemId: string | null
  onDeletePendingMessage: ItemProps['onDeletePendingMessage']
  onEditPendingMessage: ItemProps['onEditPendingMessage']
  onSteerPendingMessage: ItemProps['onSteerPendingMessage']
  onInterruptPendingMessage: ItemProps['onInterruptPendingMessage']
  onContinueStoppedTurn: ItemProps['onContinueStoppedTurn']
  onEditMessage: ItemProps['onEditMessage']
  onForkMessage: ItemProps['onForkMessage']
  onDisclosureToggle: ItemProps['onDisclosureToggle']
  onToggleMessagePinned: ItemProps['onToggleMessagePinned']
  onRetryStoppedTurn: ItemProps['onRetryStoppedTurn']
  onManageAccounts: ItemProps['onManageAccounts']
  onReauthenticate: ItemProps['onReauthenticate']
  onUsageRefresh: ItemProps['onUsageRefresh']
  onUsageReset: ItemProps['onUsageReset']
}

export type SubagentChatTurnInputs = SharedTurnInputs

// Large turns mount item by item; the newest item and user prompts always mount first.
const shouldDeferItems = (turn: ProviderChatTurn): boolean =>
  turn.items.length > 12 ||
  turn.items.reduce(
    (total, item) => total + (item.type === 'message' ? item.content.length : 0),
    0
  ) > 24_000

const isEagerItem = (turn: ProviderChatTurn, item: ProviderChatItem, deferItems: boolean) =>
  !deferItems ||
  item === turn.items.at(-1) ||
  item.type === 'pendingMessage' ||
  (item.type === 'message' && item.role === 'user')

const getNextTurnStartItem = (
  inputs: SharedTurnInputs,
  turn: ProviderChatTurn
): ProviderChatItem | undefined => {
  const lastItemIndex = inputs.itemIndexesById.get(turn.items.at(-1)?.id ?? '')
  return lastItemIndex === undefined ? undefined : inputs.visibleChatItems[lastItemIndex + 1]
}

export const renderRootChatTurn = (
  inputs: RootChatTurnInputs,
  turnIndex: number,
  turn: ProviderChatTurn
): ReactElement => {
  const {
    itemIndexesById,
    visibleChatItems,
    followingWorkingStepsById,
    subagentCompletions,
    renderSubagentCompletion,
    chatCommitMarkersByBeforeItemId,
    chatCommitMarkersByAfterItemId,
    trailingChatCommitMarkers,
    renderChatCommitMarker,
    firstPendingChatItemId
  } = inputs
  const deferItems = shouldDeferItems(turn)
  const nextTurnStartItem = getNextTurnStartItem(inputs, turn)
  const mcpAppScope =
    inputs.mcpAppScopeProviderId && inputs.mcpAppScopeChatId
      ? { providerId: inputs.mcpAppScopeProviderId, chatId: inputs.mcpAppScopeChatId }
      : undefined

  return (
    <div
      className="chat-detail__turn"
      data-chat-turn-id={turn.id}
      data-chat-turn-index={turnIndex}
      key={turn.id}
    >
      {turn.items.map((item) => {
        const itemIndex = itemIndexesById.get(item.id) ?? -1
        const followingWorkingStep = followingWorkingStepsById.get(item.id)
        const rateLimitFailure = item.type === 'working' && item.failureReason === 'rateLimit'
        const stopped =
          item.type === 'working' && (item.status === 'stopped' || item.status === 'failed')

        return (
          <DeferredChatTurn
            key={item.id}
            priority={itemIndex}
            eager={isEagerItem(turn, item, deferItems)}
            onMount={inputs.scheduleChatAutoScroll}
          >
            {subagentCompletions.before.get(item.id)?.map(renderSubagentCompletion)}
            {chatCommitMarkersByBeforeItemId.get(item.id)?.map(renderChatCommitMarker)}
            {item.id === firstPendingChatItemId &&
              trailingChatCommitMarkers.map(renderChatCommitMarker)}
            <ChatDetailItem
              mcpAppScope={mcpAppScope}
              motionChatKey={inputs.motionChatKey}
              authenticationRequired={
                item.type === 'working' && item.failureReason === 'authentication'
                  ? inputs.authenticationRequired
                  : undefined
              }
              availableRateLimitResets={rateLimitFailure ? inputs.availableRateLimitResets : 0}
              canEditOwnMessages={
                item.type === 'message' && item.role === 'user' && inputs.canEditOwnMessages
              }
              container={inputs.container}
              continuePrompt={stopped ? inputs.continuePrompt : undefined}
              continueStoppedTurnDisabled={stopped && inputs.stoppedTurnActionDisabled}
              continuedStoppedTurn={inputs.continuedStoppedWorkingStepIds.has(item.id)}
              followingWorkingStepHasNext={followingWorkingStep?.hasNextWorkingStep}
              followingWorkingStepStatus={followingWorkingStep?.status}
              hasNextWorkingStep={inputs.workingStepIdsWithNextWorkingStep.has(item.id)}
              item={item}
              messagePinned={item.type === 'message' && inputs.pinnedChatMessageIds.has(item.id)}
              cwd={inputs.cwd}
              modelLabelsById={inputs.modelLabelsById}
              resolvedModelIdsById={inputs.resolvedModelIdsById}
              onDeletePendingMessage={inputs.onDeletePendingMessage}
              onEditPendingMessage={inputs.onEditPendingMessage}
              onSteerPendingMessage={
                item.type === 'pendingMessage' && item.kind === 'queued'
                  ? inputs.onSteerPendingMessage
                  : undefined
              }
              onInterruptPendingMessage={inputs.onInterruptPendingMessage}
              onContinueStoppedTurn={stopped ? inputs.onContinueStoppedTurn : undefined}
              onEditMessage={inputs.onEditMessage}
              onForkMessage={
                item.type === 'message' && item.role === 'assistant'
                  ? inputs.onForkMessage
                  : undefined
              }
              onLoadWorkingStep={inputs.onLoadWorkingStep}
              onLoadWorkingItem={inputs.onLoadWorkingItem}
              onLoadWorkingToolPage={inputs.onLoadWorkingToolPage}
              onDisclosureToggle={inputs.onDisclosureToggle}
              onOpenFileLink={inputs.onOpenFileLink}
              onToggleMessagePinned={inputs.onToggleMessagePinned}
              onRetryStoppedTurn={inputs.onRetryStoppedTurn}
              onManageAccounts={inputs.onManageAccounts}
              onReauthenticate={inputs.onReauthenticate}
              onUsageRefresh={rateLimitFailure ? inputs.onUsageRefresh : undefined}
              onUsageReset={rateLimitFailure ? inputs.onUsageReset : undefined}
              previousItem={itemIndex > 0 ? visibleChatItems[itemIndex - 1] : null}
              projectCwd={inputs.projectCwd}
              progressPolicy={
                item.type === 'working'
                  ? getWorkingStepProgressPolicy(item, turn.items, nextTurnStartItem)
                  : undefined
              }
              progressSettings={inputs.progressSettings}
              progressDisclosureTarget={inputs.steeredWorkingStepDisclosureTargets.get(item.id)}
              rateLimitResetDisabled={rateLimitFailure && inputs.rateLimitResetDisabled}
              retryMessage={
                stopped && inputs.canRetryStoppedTurns
                  ? (inputs.stoppedTurnRetryMessages.get(item.id) ?? null)
                  : null
              }
              retryStoppedTurnDisabled={stopped && inputs.stoppedTurnActionDisabled}
              selectedModelId={inputs.selectedModelId}
              streaming={item.id === inputs.streamingChatItemId}
              turnIndex={turnIndex}
            />
            {chatCommitMarkersByAfterItemId.get(item.id)?.map(renderChatCommitMarker)}
            {subagentCompletions.after.get(item.id)?.map(renderSubagentCompletion)}
          </DeferredChatTurn>
        )
      })}
      {turn === inputs.latestRenderedTurn &&
        inputs.windowIncludesLatest &&
        !firstPendingChatItemId &&
        trailingChatCommitMarkers.map(renderChatCommitMarker)}
    </div>
  )
}

export const renderSubagentChatTurn = (
  inputs: SubagentChatTurnInputs,
  turnIndex: number,
  turn: ProviderChatTurn
): ReactElement => {
  const { itemIndexesById, visibleChatItems, subagentCompletions, renderSubagentCompletion } =
    inputs
  const deferItems = shouldDeferItems(turn)
  const nextTurnStartItem = getNextTurnStartItem(inputs, turn)

  return (
    <div
      className="chat-detail__turn"
      data-chat-turn-id={turn.id}
      data-chat-turn-index={turnIndex}
      key={turn.id}
    >
      {turn.items.map((item) => {
        const itemIndex = itemIndexesById.get(item.id) ?? -1
        const followingWorkingStep = inputs.followingWorkingStepsById.get(item.id)

        return (
          <DeferredChatTurn
            key={item.id}
            priority={itemIndex}
            eager={isEagerItem(turn, item, deferItems)}
          >
            {subagentCompletions.before.get(item.id)?.map(renderSubagentCompletion)}
            <ChatDetailItem
              container={inputs.container}
              followingWorkingStepHasNext={followingWorkingStep?.hasNextWorkingStep}
              followingWorkingStepStatus={followingWorkingStep?.status}
              hasNextWorkingStep={inputs.workingStepIdsWithNextWorkingStep.has(item.id)}
              item={item}
              key={item.id}
              cwd={inputs.cwd}
              modelLabelsById={inputs.modelLabelsById}
              resolvedModelIdsById={inputs.resolvedModelIdsById}
              onLoadWorkingStep={inputs.onLoadWorkingStep}
              onLoadWorkingItem={inputs.onLoadWorkingItem}
              onLoadWorkingToolPage={inputs.onLoadWorkingToolPage}
              onOpenFileLink={inputs.onOpenFileLink}
              previousItem={itemIndex > 0 ? visibleChatItems[itemIndex - 1] : null}
              projectCwd={inputs.projectCwd}
              progressPolicy={
                item.type === 'working'
                  ? getWorkingStepProgressPolicy(item, turn.items, nextTurnStartItem)
                  : undefined
              }
              progressSettings={inputs.progressSettings}
              progressDisclosureTarget={inputs.steeredWorkingStepDisclosureTargets.get(item.id)}
              selectedModelId={inputs.selectedModelId}
              turnIndex={turnIndex}
            />
            {subagentCompletions.after.get(item.id)?.map(renderSubagentCompletion)}
          </DeferredChatTurn>
        )
      })}
    </div>
  )
}
