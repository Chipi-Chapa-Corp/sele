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
    continuePrompt = '',
    continueStoppedTurnDisabled = false,
    item,
    onLoadWorkingStep,
    onLoadWorkingItem,
    onLoadWorkingToolPage,
    onContinueStoppedTurn,
    onRetryStoppedTurn,
    progressSettings,
    retryMessage,
    retryStoppedTurnDisabled = false
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
      {...props}
      continueDisabled={continueStoppedTurnDisabled || !continuePrompt.trim()}
      item={item}
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
      onContinue={
        onContinueStoppedTurn
          ? () => onContinueStoppedTurn(item.id, continuePrompt.trim())
          : undefined
      }
      onRetry={
        retryMessage && onRetryStoppedTurn ? () => onRetryStoppedTurn(retryMessage) : undefined
      }
      progressSettings={resolvedProgressSettings}
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
