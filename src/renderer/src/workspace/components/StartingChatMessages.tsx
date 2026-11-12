import { useLayoutEffect, useRef } from 'react'
import type { StartingChat } from '../../startingChat'
import { LazyChatDetailItem } from '../../components/LazyChatDetailItem'
import { ChatWorkingPlaceholder } from '../../components/ChatWorkingPlaceholder'

export function StartingChatMessages({ chat }: { chat: StartingChat }): React.JSX.Element {
  const viewport = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = viewport.current
    if (element) element.scrollTop = element.scrollHeight
  }, [])
  return (
    <div className="chat-detail__messages-shell">
      <div className="chat-detail__messages" ref={viewport}>
        <div className="chat-detail__messages-layout">
          <div className="chat-detail__messages-header" />
          <div className="chat-detail__messages-inner">
            {chat.items.map((item) =>
              item.type === 'working' ? (
                <ChatWorkingPlaceholder key={item.id} item={item} />
              ) : (
                <LazyChatDetailItem
                  key={item.id}
                  item={item}
                  motionChatKey={chat.scopeKey}
                  container={chat.container}
                  cwd={chat.cwd}
                  projectCwd={chat.cwd}
                />
              )
            )}
          </div>
          <div className="chat-detail__messages-footer" />
        </div>
      </div>
    </div>
  )
}
