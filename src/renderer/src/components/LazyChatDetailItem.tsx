import { lazy, memo, Suspense } from 'react'
import { areChatDetailItemPropsEqual } from './chatDetailItemMemo'
import type { ChatDetailItemProps } from './ChatDetailItem.types'

const loadContent = () =>
  import('./ChatDetailItem').then(({ ChatDetailItem }) => ({ default: ChatDetailItem }))
const Content = lazy(loadContent)
let preparing = false
export const preloadChatDetailItem = (): void => {
  if (preparing) return
  preparing = true
  void loadContent().catch((error: unknown) => {
    preparing = false
    console.warn('Unable to preload message rendering.', error)
  })
}

function MessagePreview({ item }: Pick<ChatDetailItemProps, 'item'>): React.JSX.Element | null {
  if (item.type !== 'message' && item.type !== 'pendingMessage') return null
  const role = item.type === 'message' ? item.role : 'user'
  return (
    <div
      className={`chat-detail__message-block chat-detail__message-block--${role}`}
      data-chat-message-id={item.type === 'message' ? item.id : undefined}
    >
      <div className={`chat-detail__message chat-detail__message--${role}`}>
        <div
          className="chat-detail__message-text"
          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {item.content.length > 8_192 ? '…\n' : ''}
          {item.content.slice(-8_192)}
        </div>
      </div>
    </div>
  )
}

// Loading the workspace must not evaluate Markdown, syntax highlighting and
// diff rendering before it has any transcript to display.
export const LazyChatDetailItem = memo(function LazyChatDetailItem(
  props: ChatDetailItemProps
): React.JSX.Element {
  return (
    <Suspense fallback={<MessagePreview item={props.item} />}>
      <Content {...props} />
    </Suspense>
  )
}, areChatDetailItemPropsEqual)
