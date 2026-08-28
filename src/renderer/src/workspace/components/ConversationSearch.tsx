import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'

type ConversationSearchProps = WorkspaceController['conversationSearch']

export function ConversationSearch(props: ConversationSearchProps): ReactElement | null {
  if (!props.visible) return null

  const {
    chatSearchActiveIndex,
    chatSearchInputRef,
    chatSearchMatchCount,
    chatSearchQuery,
    closeChatSearch,
    handleChatSearchNavigation,
    setChatSearchQuery
  } = props

  return (
    <div className="chat-detail__search" role="search" aria-label="Find in conversation">
      <label className="sr-only" htmlFor="chat-detail-search">
        Find in conversation
      </label>
      <Input
        ref={chatSearchInputRef}
        className="chat-detail__search-input"
        id="chat-detail-search"
        type="search"
        value={chatSearchQuery}
        placeholder="Find in conversation"
        aria-controls="chat-search-content"
        onChange={(event) => setChatSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return

          if (event.key === 'Enter') {
            event.preventDefault()
            handleChatSearchNavigation(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeChatSearch()
          }
        }}
      />
      <span
        className="chat-detail__search-status"
        id="chat-detail-search-status"
        role="status"
        aria-live="polite"
      >
        {chatSearchQuery
          ? chatSearchMatchCount > 0
            ? `${chatSearchActiveIndex + 1} of ${chatSearchMatchCount}`
            : 'No matches'
          : ''}
      </span>
      <div className="chat-detail__search-actions">
        <Button
          theme="transparent"
          size="small"
          disabled={chatSearchMatchCount === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          callback={() => handleChatSearchNavigation(-1)}
          icon={<ChevronUp aria-hidden="true" />}
        />
        <Button
          theme="transparent"
          size="small"
          disabled={chatSearchMatchCount === 0}
          aria-label="Next match"
          title="Next match (Enter)"
          callback={() => handleChatSearchNavigation(1)}
          icon={<ChevronDown aria-hidden="true" />}
        />
        <Button
          theme="transparent"
          size="small"
          aria-label="Close chat search"
          title="Close chat search (Escape)"
          callback={closeChatSearch}
          icon={<X aria-hidden="true" />}
        />
      </div>
    </div>
  )
}
