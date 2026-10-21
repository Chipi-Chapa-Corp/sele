import type { ReactElement, ReactNode } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'

type ConversationPanelProps = WorkspaceController['conversationPanel'] & {
  header: ReactNode
  search: ReactNode
  messages: ReactNode
  quoteAction: ReactNode
  emptyState: ReactNode
  plan: ReactNode
  composer: ReactNode
}

export function ConversationPanel(props: ConversationPanelProps): ReactElement {
  const {
    activeSubagentChatView,
    composer,
    emptyState,
    header,
    messages,
    newChatOpen,
    plan,
    quoteAction,
    search,
    selectedChat
  } = props

  return (
    <div className="chat__detail-panel" data-panel="true" id="detail">
      {header}
      <section
        className={`chat-panel${selectedChat ? ' chat-panel--selected' : ' chat-panel--empty'}${newChatOpen ? ' chat-panel--new' : ''}`}
        aria-label={
          activeSubagentChatView?.summary.title ?? selectedChat?.title ?? 'No chat selected'
        }
      >
        {search}
        {messages}
        {quoteAction}
        {emptyState}
        {plan}
        {composer}
      </section>
    </div>
  )
}
