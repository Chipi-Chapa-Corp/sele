import type { ReactElement } from 'react'
import { MessageSelectionQuoteButton } from '../../components/MessageSelectionQuoteButton'
import type { WorkspaceController } from '../../useWorkspaceController'

type ConversationQuoteActionProps = WorkspaceController['conversationQuote']

export function ConversationQuoteAction(props: ConversationQuoteActionProps): ReactElement | null {
  const { contentRef, editingMessage, handleQuoteSelectedMessageText, selectedChatKey, visible } =
    props

  if (!visible) return null

  return (
    <MessageSelectionQuoteButton
      containerRef={contentRef}
      enabled={!editingMessage}
      key={`quote:${selectedChatKey}`}
      onQuote={handleQuoteSelectedMessageText}
    />
  )
}
