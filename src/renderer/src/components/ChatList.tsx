import { AnimatePresence } from 'motion/react'
import { MotionListItem } from '../motion/MotionListItem'
import {
  forwardRef,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type ComponentProps,
  type ReactNode
} from 'react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import { linkedChatDragType, serializeLinkedChatDrag } from '../linkedChats'
import './ChatList.css'
import { ChatListDragContext } from './ChatListDragContext'

type ChatListProps = {
  /** Virtual rows keep only their own chat in props; drag ordering reads the group on demand. */
  getReorderChats?: () => ProviderChat[]
  reorderOffset?: number
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
      layoutDisabled: boolean
      virtual?: boolean
    }
  >(function ChatListRow({ layoutDisabled, virtual, ...props }, ref) {
    if (virtual)
      return (
        <div ref={ref}>
          <ChatListItem {...props} />
        </div>
      )
    return (
      <MotionListItem ref={ref} popLayout disabled={layoutDisabled}>
        <ChatListItem {...props} />
      </MotionListItem>
    )
  })
)

export const ChatList = memo(function ChatList({
  getReorderChats,
  reorderOffset = 0,
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
  const sharedDrag = useContext(ChatListDragContext)
  const [localDraggedChatKey, setLocalDraggedChatKey] = useState<string | null>(null)
  const [localDropInsertionIndex, setLocalDropInsertionIndex] = useState<number | null>(null)
  const draggedChatKey = sharedDrag
    ? sharedDrag.key &&
      (getReorderChats?.() ?? chats).some((chat) => getChatKey(chat) === sharedDrag.key)
      ? sharedDrag.key
      : null
    : localDraggedChatKey
  const dropInsertionIndex = sharedDrag
    ? draggedChatKey
      ? sharedDrag.index
      : null
    : localDropInsertionIndex
  const setDraggedChatKey = sharedDrag?.setKey ?? setLocalDraggedChatKey
  const setDropInsertionIndex = sharedDrag?.setIndex ?? setLocalDropInsertionIndex

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
    const targetIndex = (getReorderChats?.() ?? chats).findIndex(
      (candidate) => getChatKey(candidate) === targetChatKey
    )
    if (targetIndex < 0) return

    const insertionIndex = targetIndex + (event.clientY < bounds.top + bounds.height / 2 ? 0 : 1)
    setDropInsertionIndex(insertionIndex)
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    if (draggedChatKey && dropInsertionIndex !== null) {
      const source = getReorderChats?.() ?? chats
      const draggedIndex = source.findIndex((chat) => getChatKey(chat) === draggedChatKey)
      if (draggedIndex >= 0) {
        const nextChats = [...source]
        const [draggedChat] = nextChats.splice(draggedIndex, 1)
        const insertionIndex =
          draggedIndex < dropInsertionIndex ? dropInsertionIndex - 1 : dropInsertionIndex
        nextChats.splice(insertionIndex, 0, draggedChat)
        const orderChanged = nextChats.some(
          (chat, index) => getChatKey(chat) !== getChatKey(source[index])
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

  const renderRow = (chat: ProviderChat, index: number): ReactNode => {
    index += reorderOffset
    const chatKey = getChatKey(chat)
    const dropPosition =
      dropInsertionIndex === index
        ? 'before'
        : index === (getReorderChats?.() ?? chats).length - 1 &&
            dropInsertionIndex === (getReorderChats?.() ?? chats).length
          ? 'after'
          : null

    const row = (
      <ChatListRow
        key={chatKey}
        virtual={getReorderChats !== undefined}
        layoutDisabled={Boolean(draggedChatKey) || getReorderChats !== undefined}
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
          chat.pendingApproval && chat.pendingApproval.id === resolvingApprovalId ? 'allow' : null
        }
        {...rowActions}
      />
    )
    return showSelectedChatChildren && chatKey === selectedChatKey
      ? [
          row,
          getReorderChats ? (
            <div key={`${chatKey}:children`}>{selectedChatChildren}</div>
          ) : (
            <MotionListItem
              key={`${chatKey}:children`}
              popLayout
              disabled={Boolean(draggedChatKey)}
            >
              {selectedChatChildren}
            </MotionListItem>
          )
        ]
      : row
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
      {/* Presence controls only local enter/exit motion, without a layout projection tree. */}
      {getReorderChats ? (
        chats.map(renderRow)
      ) : (
        <AnimatePresence initial={false} mode="sync" presenceAffectsLayout={false}>
          {chats.map(renderRow)}
        </AnimatePresence>
      )}
    </section>
  )
})
