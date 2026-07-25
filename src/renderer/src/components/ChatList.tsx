import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import './ChatList.css'

type ChatListProps = {
  ariaLabel?: string
  chats: ProviderChat[]
  selectedChatKey: string | null
  committingChatKeys?: ReadonlySet<string>
  canMarkDone?: boolean
  canMarkUndone?: boolean
  showProjects?: boolean
  onMarkDone: (chat: ProviderChat, done?: boolean) => void
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onSelect: (chat: ProviderChat) => void
  onTogglePinned: (chat: ProviderChat) => void
  resolvingApprovalId?: string | null
}

const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

export const ChatList: React.FC<ChatListProps> = ({
  ariaLabel = 'Chats',
  chats,
  selectedChatKey,
  committingChatKeys,
  canMarkDone = true,
  canMarkUndone = false,
  showProjects = false,
  onMarkDone,
  onResolveApproval,
  onSelect,
  onTogglePinned,
  resolvingApprovalId = null
}) => (
  <section className="chat-list" aria-label={ariaLabel}>
    {chats.map((chat) => {
      const chatKey = getChatKey(chat)

      return (
        <ChatListItem
          key={chatKey}
          chat={chat}
          selected={chatKey === selectedChatKey}
          committing={committingChatKeys?.has(chatKey)}
          canMarkDone={canMarkDone}
          canMarkUndone={canMarkUndone}
          showProject={showProjects}
          approvalDecisionInFlight={
            chat.pendingApproval && chat.pendingApproval.id === resolvingApprovalId ? 'allow' : null
          }
          onMarkDone={(done) => onMarkDone(chat, done)}
          onClick={() => onSelect(chat)}
          onResolveApproval={(decision) => onResolveApproval(chat, decision)}
          onTogglePinned={() => onTogglePinned(chat)}
        />
      )
    })}
  </section>
)
