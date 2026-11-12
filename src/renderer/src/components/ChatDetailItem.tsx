import { memo, useRef } from 'react'
import 'react-diff-view/style/index.css'
import './ChatDetailItem.css'
import type { ChatDetailItemProps } from './ChatDetailItem.types'
import { ChatMediaScope } from './ChatMediaGallery'
import { ChatMessage } from './ChatMessage'
import { WorkingStep } from './ChatWorkingStep'
import { McpAppScope } from './McpApp'
import './UnifiedDiff.css'
import { WorkingDisclosureContext } from './WorkingDisclosure'
import { areChatDetailItemPropsEqual, getProgressSettings } from './chatDetailItemMemo'
export { ChatWorkingPlaceholder } from './ChatWorkingPlaceholder'
export { MarkdownMessage } from './MarkdownMessage'

const ChatDetailItemComponent: React.FC<ChatDetailItemProps> = (props) => {
  const {
    authenticationRequired,
    availableRateLimitResets = 0,
    rateLimitResetOptions,
    container,
    continuePrompt = '',
    continueStoppedTurnDisabled = false,
    continuedStoppedTurn = false,
    followingWorkingStepHasNext = false,
    followingWorkingStepStatus,
    hasNextWorkingStep = false,
    item,
    onLoadWorkingStep,
    onLoadWorkingItem,
    onLoadWorkingToolPage,
    onDisclosureToggle,
    onOpenFileLink,
    onContinueStoppedTurn,
    onRetryStoppedTurn,
    onManageAccounts,
    onReauthenticate,
    onUsageRefresh,
    onUsageReset,
    cwd,
    projectCwd,
    progressPolicy = 'regular',
    progressDisclosureTarget,
    progressSettings,
    rateLimitResetDisabled = false,
    retryMessage,
    retryStoppedTurnDisabled = false,
    workingStepContent
  } = props

  const resolvedProgressSettings = getProgressSettings(progressSettings)

  if (item.type === 'timelineAnchor') return null

  if (item.type === 'contextCompaction' || item.type === 'goalContinuation') {
    return (
      <div className="chat-detail__context-compaction">
        <span>
          {item.type === 'goalContinuation'
            ? 'Goal continuation'
            : 'Context Compacted Automatically'}
        </span>
      </div>
    )
  }
  if (item.type === 'message' || item.type === 'pendingMessage')
    return <ChatMessage {...props} item={item} />

  return (
    <WorkingStep
      authenticationRequired={authenticationRequired}
      activityContent={workingStepContent}
      availableRateLimitResets={availableRateLimitResets}
      rateLimitResetOptions={rateLimitResetOptions}
      container={container}
      continueDisabled={continueStoppedTurnDisabled || !continuePrompt.trim()}
      continuedStoppedTurn={continuedStoppedTurn}
      followingWorkingStepHasNext={followingWorkingStepHasNext}
      followingWorkingStepStatus={followingWorkingStepStatus}
      hasNextWorkingStep={hasNextWorkingStep}
      item={item}
      cwd={cwd}
      onLoad={
        onLoadWorkingStep ? (startIndex) => onLoadWorkingStep(item.id, startIndex) : undefined
      }
      onLoadItem={
        onLoadWorkingItem ? (workingItemId) => onLoadWorkingItem(item.id, workingItemId) : undefined
      }
      onLoadToolPage={
        onLoadWorkingToolPage
          ? (workingItemId, startIndex) => onLoadWorkingToolPage(item.id, workingItemId, startIndex)
          : undefined
      }
      onDisclosureToggle={onDisclosureToggle}
      onContinue={
        onContinueStoppedTurn
          ? () => onContinueStoppedTurn(item.id, continuePrompt.trim())
          : undefined
      }
      onOpenFileLink={onOpenFileLink}
      onRetry={
        retryMessage && onRetryStoppedTurn ? () => onRetryStoppedTurn(retryMessage) : undefined
      }
      onManageAccounts={onManageAccounts}
      onReauthenticate={onReauthenticate}
      onUsageRefresh={onUsageRefresh}
      onUsageReset={onUsageReset}
      projectCwd={projectCwd}
      progressPolicy={progressPolicy}
      progressDisclosureTarget={progressDisclosureTarget}
      progressSettings={resolvedProgressSettings}
      rateLimitResetDisabled={rateLimitResetDisabled}
      retryDisabled={retryStoppedTurnDisabled}
    />
  )
}

export const ChatDetailItem = memo((props: ChatDetailItemProps) => {
  const disclosureChoices = useRef(new Map<string, boolean>())
  return (
    <ChatMediaScope id={props.item.id}>
      <McpAppScope value={props.mcpAppScope}>
        <WorkingDisclosureContext.Provider value={disclosureChoices.current}>
          <ChatDetailItemComponent {...props} />
        </WorkingDisclosureContext.Provider>
      </McpAppScope>
    </ChatMediaScope>
  )
}, areChatDetailItemPropsEqual)
