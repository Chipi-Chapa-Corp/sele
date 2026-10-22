import { AnimatePresence } from 'motion/react'
import { MotionListItem } from '../motion/MotionListItem'
import {
  forwardRef,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from 'react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import { linkedChatDragType, serializeLinkedChatDrag } from '../linkedChats'
import './ChatList.css'

type ChatListProps = {
  ariaLabel?: string
  chats: ProviderChat[]
  selectedChatKey: string | null
  workingSubagentChatKeys?: ReadonlySet<string>
  committingChatKeys?: ReadonlySet<string>
  latestCommitFinishedAtByChatKey?: ReadonlyMap<string, number>
  canMarkDone?: boolean
  canMarkUndone?: boolean
  reorderable?: boolean
  projectNamesByCwd?: ReadonlyMap<string, string>
  projectIconsByCwd?: ReadonlyMap<string, ReactNode>
  onMarkDone: (chat: ProviderChat, done?: boolean) => void
  onRename: (chat: ProviderChat, title: string) => Promise<void>
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onSelect: (chat: ProviderChat) => void
  onReorder?: (chats: ProviderChat[]) => void
  onTogglePinned: (chat: ProviderChat) => void
  resolvingApprovalId?: string | null
  /** Rendered directly below the selected chat, e.g. its subagent chats. */
  selectedChatChildren?: ReactNode
  /** One of the selected chat's children is open, so the chat row itself is not highlighted. */
  selectedChatChildOpen?: boolean
}

const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

// Memoize the animation wrapper as well as the row. Otherwise selecting one
// chat rerenders every MotionListItem even when its chat and position are unchanged.
const ChatListRow = memo(
  forwardRef<
    HTMLDivElement,
    ComponentProps<typeof ChatListItem> & {
      order: string
      layoutDisabled: boolean
    }
  >(function ChatListRow({ order, layoutDisabled, ...props }, ref) {
    return (
      <MotionListItem ref={ref} order={order} popLayout disabled={layoutDisabled}>
        <ChatListItem {...props} />
      </MotionListItem>
    )
  })
)

export const ChatList = memo(function ChatList({
  ariaLabel = 'Chats',
  chats,
  selectedChatKey,
  workingSubagentChatKeys,
  committingChatKeys,
  latestCommitFinishedAtByChatKey,
  canMarkDone = true,
  canMarkUndone = false,
  reorderable = false,
  projectNamesByCwd,
  projectIconsByCwd,
  onMarkDone,
  onRename,
  onResolveApproval,
  onSelect,
  onReorder,
  onTogglePinned,
  resolvingApprovalId = null,
  selectedChatChildren = null,
  selectedChatChildOpen = false
}: ChatListProps) {
  const [draggedChatKey, setDraggedChatKey] = useState<string | null>(null)
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(null)

  const resetDrag = (): void => {
    setDraggedChatKey(null)
    setDropInsertionIndex(null)
  }

  const handleDragStart = (event: React.DragEvent<HTMLElement>, chat: ProviderChat): void => {
    // Every row can be dropped into a composer as a linked chat.
    event.dataTransfer.setData(
      linkedChatDragType,
      serializeLinkedChatDrag({ providerId: chat.providerId, chatId: chat.id, name: chat.title })
    )
    if (!reorderable) {
      event.dataTransfer.effectAllowed = 'copy'
      return
    }

    const chatKey = getChatKey(chat)
    event.dataTransfer.effectAllowed = 'copyMove'
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

  // Parents provide fresh closures as workspace state changes. Keep row props
  // stable while dispatching to the latest committed handlers (never stale state).
  const handlers = {
    onMarkDone,
    onRename,
    onResolveApproval,
    onSelect,
    onTogglePinned,
    resetDrag,
    handleDragOver,
    handleDragStart
  }
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })
  const rowActions = useMemo(
    () => ({
      onMarkDone: (chat: ProviderChat, done?: boolean) =>
        handlersRef.current.onMarkDone(chat, done),
      onRename: (chat: ProviderChat, title: string) => handlersRef.current.onRename(chat, title),
      onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) =>
        handlersRef.current.onResolveApproval(chat, decision),
      onClick: (chat: ProviderChat) => handlersRef.current.onSelect(chat),
      onTogglePinned: (chat: ProviderChat) => handlersRef.current.onTogglePinned(chat),
      onDragEnd: () => handlersRef.current.resetDrag(),
      onDragOver: (event: React.DragEvent<HTMLElement>, chat: ProviderChat) =>
        handlersRef.current.handleDragOver(event, chat),
      onDragStart: (event: React.DragEvent<HTMLElement>, chat: ProviderChat) =>
        handlersRef.current.handleDragStart(event, chat)
    }),
    []
  )

  const showSelectedChatChildren =
    selectedChatChildren != null &&
    selectedChatKey != null &&
    chats.some((chat) => getChatKey(chat) === selectedChatKey)
  const order = chats
    .map(getChatKey)
    .join('\n')
    .concat(showSelectedChatChildren ? `\n${selectedChatKey}:children` : '')

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
      {/* Row order explicitly drives layout; selection must not invalidate every presence consumer. */}
      <AnimatePresence initial={false} mode="sync" presenceAffectsLayout={false}>
        {chats.map((chat, index) => {
          const chatKey = getChatKey(chat)
          const dropPosition =
            dropInsertionIndex === index
              ? 'before'
              : index === chats.length - 1 && dropInsertionIndex === chats.length
                ? 'after'
                : null

          const row = (
            <ChatListRow
              key={chatKey}
              order={order}
              layoutDisabled={Boolean(draggedChatKey)}
              chat={chat}
              projectDisplayName={projectNamesByCwd?.get(chat.projectCwd ?? chat.cwd ?? '')}
              projectIcon={projectIconsByCwd?.get(chat.projectCwd ?? chat.cwd ?? '')}
              selected={chatKey === selectedChatKey && !selectedChatChildOpen}
              childOpen={chatKey === selectedChatKey && selectedChatChildOpen}
              descendantWorking={workingSubagentChatKeys?.has(chatKey)}
              committing={committingChatKeys?.has(chatKey)}
              latestCommitFinishedAt={latestCommitFinishedAtByChatKey?.get(chatKey)}
              canMarkDone={canMarkDone}
              canMarkUndone={canMarkUndone}
              draggable={reorderable}
              linkDraggable
              dragging={chatKey === draggedChatKey}
              dropPosition={dropPosition}
              approvalDecisionInFlight={
                chat.pendingApproval && chat.pendingApproval.id === resolvingApprovalId
                  ? 'allow'
                  : null
              }
              {...rowActions}
            />
          )
          return showSelectedChatChildren && chatKey === selectedChatKey
            ? [
                row,
                <MotionListItem
                  key={`${chatKey}:children`}
                  order={order}
                  popLayout
                  disabled={Boolean(draggedChatKey)}
                >
                  {selectedChatChildren}
                </MotionListItem>
              ]
            : row
        })}
      </AnimatePresence>
    </section>
  )
})
