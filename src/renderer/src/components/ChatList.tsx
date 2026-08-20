import { useState } from 'react'
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
  reorderable?: boolean
  projectNamesByCwd?: ReadonlyMap<string, string>
  onMarkDone: (chat: ProviderChat, done?: boolean) => void
  onRename: (chat: ProviderChat, title: string) => Promise<void>
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onSelect: (chat: ProviderChat) => void
  onReorder?: (chats: ProviderChat[]) => void
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
  reorderable = false,
  projectNamesByCwd,
  onMarkDone,
  onRename,
  onResolveApproval,
  onSelect,
  onReorder,
  onTogglePinned,
  resolvingApprovalId = null
}) => {
  const [draggedChatKey, setDraggedChatKey] = useState<string | null>(null)
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(null)

  const resetDrag = (): void => {
    setDraggedChatKey(null)
    setDropInsertionIndex(null)
  }

  const handleDragStart = (event: React.DragEvent<HTMLElement>, chat: ProviderChat): void => {
    if (!reorderable) return

    const chatKey = getChatKey(chat)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chatKey)
    setDraggedChatKey(chatKey)
    setDropInsertionIndex(null)
  }

  const handleDragOver = (event: React.DragEvent<HTMLElement>, chat: ProviderChat): void => {
    if (!draggedChatKey) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const targetChatKey = getChatKey(chat)
    if (targetChatKey === draggedChatKey) {
      setDropInsertionIndex(null)
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const targetIndex = chats.findIndex((candidate) => getChatKey(candidate) === targetChatKey)
    if (targetIndex < 0) return

    const insertionIndex = targetIndex + (event.clientY < bounds.top + bounds.height / 2 ? 0 : 1)
    setDropInsertionIndex(insertionIndex)
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    if (draggedChatKey && dropInsertionIndex !== null) {
      const draggedIndex = chats.findIndex((chat) => getChatKey(chat) === draggedChatKey)
      if (draggedIndex >= 0) {
        const nextChats = [...chats]
        const [draggedChat] = nextChats.splice(draggedIndex, 1)
        const insertionIndex =
          draggedIndex < dropInsertionIndex ? dropInsertionIndex - 1 : dropInsertionIndex
        nextChats.splice(insertionIndex, 0, draggedChat)
        const orderChanged = nextChats.some(
          (chat, index) => getChatKey(chat) !== getChatKey(chats[index])
        )
        if (orderChanged) onReorder?.(nextChats)
      }
    }
    resetDrag()
  }

  return (
    <section
      className={`chat-list${draggedChatKey ? ' chat-list--dragging' : ''}`}
      aria-label={ariaLabel}
      onDragOver={(event) => {
        if (!draggedChatKey) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={handleDrop}
    >
      {chats.map((chat, index) => {
        const chatKey = getChatKey(chat)
        const dropPosition =
          dropInsertionIndex === index
            ? 'before'
            : index === chats.length - 1 && dropInsertionIndex === chats.length
              ? 'after'
              : null

        return (
          <ChatListItem
            key={chatKey}
            chat={chat}
            projectDisplayName={projectNamesByCwd?.get(chat.projectCwd ?? chat.cwd ?? '')}
            selected={chatKey === selectedChatKey}
            committing={committingChatKeys?.has(chatKey)}
            canMarkDone={canMarkDone}
            canMarkUndone={canMarkUndone}
            draggable={reorderable}
            dragging={chatKey === draggedChatKey}
            dropPosition={dropPosition}
            approvalDecisionInFlight={
              chat.pendingApproval && chat.pendingApproval.id === resolvingApprovalId
                ? 'allow'
                : null
            }
            onMarkDone={(done) => onMarkDone(chat, done)}
            onRename={(title) => onRename(chat, title)}
            onClick={() => onSelect(chat)}
            onDragEnd={resetDrag}
            onDragOver={(event) => handleDragOver(event, chat)}
            onDragStart={(event) => handleDragStart(event, chat)}
            onResolveApproval={(decision) => onResolveApproval(chat, decision)}
            onTogglePinned={() => onTogglePinned(chat)}
          />
        )
      })}
    </section>
  )
}
