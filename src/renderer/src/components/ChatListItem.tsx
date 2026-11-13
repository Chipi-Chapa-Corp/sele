import { prefetchChatOpening } from '../chatOpening'
import { Spinner } from './Spinner'
import { useCompactLayout } from '../useCompactLayout'
import { useProviderLabels } from '../providerLabels'
import { isNoProjectChat, isNoProjectCwd } from '../../../shared/noProject'
import {
  Bed,
  Check,
  Folder,
  FolderKanban,
  GitCommitHorizontal,
  GitFork,
  GripVertical,
  Mail,
  MailOpen,
  MessageSquare,
  Pencil,
  Pin,
  Menu,
  Download,
  PinOff,
  Save,
  ShieldQuestionMark,
  Terminal,
  Undo2,
  X
} from 'lucide-react'
import {
  memo,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { toCssRem } from '../cssUnits'
import { getRenderableText } from '../renderableText'
import { getDefaultProjectName } from '../projectPresentation'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import { Input } from './Input'
import { ProviderIcon } from './ProviderIcon'
import './ChatListItem.css'
import { ActionMenu } from './ActionMenu'
import { providerApi } from '../providerApi'
import { useChatTerminalStatus } from '../useChatTerminalActivity'
import {
  ChatSleepActionsContext,
  getChatSleepKey,
  sleepChat,
  useChatWakeAt,
  wakeChat
} from '../chatSleep'
import { BedOff } from './BedOffIcon'
import { ChatSleepPanel, formatWakeIn } from './ChatSleepPanel'
import { ChatReadStateContext } from '../manualChatReadState'
import { useHoldActions } from '../useHoldActions'

type ChatListItemProps = {
  chat: ProviderChat
  projectDisplayName?: string | null
  projectIcon?: ReactNode
  selected: boolean
  childOpen?: boolean
  descendantWorking?: boolean
  committing?: boolean
  latestCommitFinishedAt?: number | null
  canMarkDone?: boolean
  canMarkUndone?: boolean
  /** Pinned reordering: shows the drag handle and reorder styles. */
  draggable?: boolean
  dragging?: boolean
  dropPosition?: 'before' | 'after' | null
  onClick: (chat: ProviderChat) => void
  onDragEnd?: React.DragEventHandler<HTMLElement>
  onDragOver?: (event: React.DragEvent<HTMLElement>, chat: ProviderChat) => void
  onDragStart?: (event: React.DragEvent<HTMLElement>, chat: ProviderChat) => void
  onMarkDone: (chat: ProviderChat, done?: boolean) => void
  onRename: (chat: ProviderChat, title: string) => Promise<void>
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onTogglePinned: (chat: ProviderChat) => void
  approvalDecisionInFlight?: ProviderApprovalDecision | null
}

const statusLabels = {
  active: 'In progress',
  error: 'Error',
  stopped: 'Stopped',
  waitingOnApproval: 'Waiting for approval',
  waitingOnUserInput: 'Waiting for your input'
} as const
const finishedUnseenLabel = 'Finished since last viewed'

const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const weekMs = 7 * dayMs
const monthMs = 30 * dayMs
const yearMs = 365 * dayMs

const getChatProjectName = (cwd: string | null): string => {
  if (isNoProjectCwd(cwd)) return 'No Project'
  const normalizedCwd = getRenderableText(cwd, '').trim()
  return normalizedCwd ? getDefaultProjectName(normalizedCwd) : 'Unknown cwd'
}

const formatShortAge = (timestamp: number, now: number): string => {
  const elapsed = Math.max(0, now - timestamp)

  if (elapsed < minuteMs) return 'now'
  if (elapsed < hourMs) return `${Math.floor(elapsed / minuteMs)}m`
  if (elapsed < dayMs) return `${Math.floor(elapsed / hourMs)}h`
  if (elapsed < weekMs) return `${Math.floor(elapsed / dayMs)}d`
  if (elapsed < monthMs) return `${Math.floor(elapsed / weekMs)}w`
  if (elapsed < yearMs) return `${Math.floor(elapsed / monthMs)}mo`
  return `${Math.floor(elapsed / yearMs)}y`
}

type DetailCardPosition = {
  left: number
  top: number
}

export const ChatListItem = memo(function ChatListItem({
  chat,
  projectDisplayName,
  projectIcon,
  selected,
  childOpen = false,
  descendantWorking = false,
  committing = false,
  latestCommitFinishedAt = null,
  canMarkDone = true,
  canMarkUndone = false,
  draggable = false,
  dragging = false,
  dropPosition = null,
  onClick,
  onDragEnd,
  onDragOver,
  onDragStart,
  onMarkDone,
  onRename,
  onResolveApproval,
  onTogglePinned,
  approvalDecisionInFlight = null
}: ChatListItemProps) {
  const providerLabels = useProviderLabels()
  const terminalActivity = useChatTerminalStatus(`${chat.providerId}:${chat.id}`)
  const sleepActionsEnabled = useContext(ChatSleepActionsContext)
  const { manuallyUnreadChatKeys, onMarkRead } = useContext(ChatReadStateContext)
  const sleepKey = getChatSleepKey(chat.providerId, chat.id)
  const wakeAt = useChatWakeAt(sleepKey)
  const sleeping = wakeAt !== undefined
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<string | null>(null)
  const exportChat = async (): Promise<void> => {
    setExporting(true)
    setExportResult(null)
    try {
      await providerApi.exportChat(chat.providerId, chat.id)
    } catch (error) {
      setExportResult(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExporting(false)
    }
  }
  const chatTitle = getRenderableText(chat.title, 'Untitled chat')
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(chatTitle)
  const [savingName, setSavingName] = useState(false)
  const [detailHovered, setDetailHovered] = useState(false)
  const [detailFocused, setDetailFocused] = useState(false)
  const [detailCardPosition, setDetailCardPosition] = useState<DetailCardPosition | null>(null)
  const itemRef = useRef<HTMLElement>(null)
  const holdActions = useHoldActions(itemRef)
  const compact = useCompactLayout()
  const [touchDragArmed, setTouchDragArmed] = useState(false)
  const detailCardRef = useRef<HTMLDivElement>(null)
  const detailCardId = useId()
  const now = useSemanticDateNow()
  const updatedAt = useMemo(
    () => formatSemanticLexicalDateDifference(chat.updatedAt, { now }),
    [chat.updatedAt, now]
  )
  const noProject = isNoProjectChat(chat)
  const isGitWorktree = !noProject && chat.cwdKind === 'gitWorktree'
  const branchName = getRenderableText(
    isGitWorktree ? chat.worktreeBaseBranchName : chat.branchName,
    'Unknown branch'
  )
  const projectName = noProject
    ? 'No Project'
    : getRenderableText(projectDisplayName, '').trim() ||
      getChatProjectName(chat.projectCwd ?? chat.cwd)
  const LocationIcon = noProject ? MessageSquare : isGitWorktree ? GitFork : Folder
  const approvalStatus = chat.status === 'waitingOnApproval' ? chat.status : null
  const userInputStatus = chat.status === 'waitingOnUserInput' ? chat.status : null
  const working =
    chat.status === 'active' || (descendantWorking && !approvalStatus && !userInputStatus)
  const turnOutcomeStatus =
    chat.lastTurnOutcome === 'failed'
      ? 'error'
      : chat.lastTurnOutcome === 'stopped'
        ? 'stopped'
        : null
  const pendingApproval = chat.pendingApproval
  const unreadUpdatedAt = Math.max(chat.updatedAt, latestCommitFinishedAt ?? 0)
  const markedUnread = manuallyUnreadChatKeys.has(`${chat.providerId}:${chat.id}`)
  const hasUnread = markedUnread || unreadUpdatedAt > (chat.seenUpdatedAt ?? 0)
  const unread = !chat.done && (markedUnread || (!selected && !childOpen && hasUnread))
  const finishedUnseen = unread && chat.status === null
  const showFinishedUnseen = !committing && !working && !approvalStatus && finishedUnseen
  const normalizedNameDraft = nameDraft.trim()
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const detailOpen =
    canHover && !holdActions.touch && (detailHovered || detailFocused) && !editingName && !dragging
  const shortUpdatedAge = formatShortAge(chat.updatedAt, now)
  const statusDot = (modifier: string, title: string) => ({
    title,
    icon: (
      <span
        className={`chat-list-item__status chat-list-item__status--${modifier}`}
        role="img"
        aria-label={title}
      />
    )
  })
  const iconStatus = (
    Icon: typeof Spinner | typeof Terminal,
    className: string,
    title: string
  ) => ({
    title,
    icon: <Icon className={className} aria-label={title} />
  })
  const leadingStatus = committing
    ? iconStatus(GitCommitHorizontal, 'chat-list-item__committing', 'Committing changes')
    : working
      ? iconStatus(Spinner, 'app-loading-spinner chat-list-item__loading', statusLabels.active)
      : approvalStatus
        ? iconStatus(
            ShieldQuestionMark,
            'chat-list-item__approval-icon',
            statusLabels[approvalStatus]
          )
        : userInputStatus
          ? statusDot(userInputStatus, statusLabels[userInputStatus])
          : terminalActivity.running
            ? iconStatus(Terminal, 'chat-list-item__terminal', 'Terminal task running')
            : turnOutcomeStatus
              ? statusDot(turnOutcomeStatus, statusLabels[turnOutcomeStatus])
              : showFinishedUnseen && statusDot('finished-unseen', finishedUnseenLabel)

  useLayoutEffect(() => {
    if (!detailOpen) return

    const updateDetailCardPosition = (): void => {
      const item = itemRef.current
      const detailCard = detailCardRef.current
      if (!item || !detailCard) return

      const itemBounds = item.getBoundingClientRect()
      const cardBounds = detailCard.getBoundingClientRect()
      const viewportPadding = 9.6
      const gap = 8
      let left = itemBounds.right + gap

      if (left + cardBounds.width > window.innerWidth - viewportPadding) {
        left = itemBounds.left - cardBounds.width - gap
      }

      left = Math.max(
        viewportPadding,
        Math.min(left, window.innerWidth - cardBounds.width - viewportPadding)
      )
      const top = Math.max(
        viewportPadding,
        Math.min(itemBounds.top, window.innerHeight - cardBounds.height - viewportPadding)
      )

      setDetailCardPosition((current) =>
        current?.left === left && current.top === top ? current : { left, top }
      )
    }

    updateDetailCardPosition()
    window.addEventListener('resize', updateDetailCardPosition)
    window.addEventListener('scroll', updateDetailCardPosition, true)
    const resizeObserver = new ResizeObserver(updateDetailCardPosition)
    if (itemRef.current) resizeObserver.observe(itemRef.current)
    if (detailCardRef.current) resizeObserver.observe(detailCardRef.current)

    return () => {
      window.removeEventListener('resize', updateDetailCardPosition)
      window.removeEventListener('scroll', updateDetailCardPosition, true)
      resizeObserver.disconnect()
    }
  }, [detailOpen])

  const beginEditingName = (): void => {
    setNameDraft(chatTitle)
    setDetailHovered(false)
    setDetailFocused(false)
    setEditingName(true)
  }

  const cancelEditingName = (): void => {
    setNameDraft(chatTitle)
    setDetailFocused(false)
    setEditingName(false)
  }

  const saveName = async (): Promise<void> => {
    if (savingName || !normalizedNameDraft) return
    if (normalizedNameDraft === chatTitle.trim()) {
      setDetailFocused(false)
      setEditingName(false)
      return
    }

    setSavingName(true)
    try {
      await onRename(chat, normalizedNameDraft)
      setDetailFocused(false)
      setEditingName(false)
    } catch (error) {
      console.error('[caught:ChatListItem:saveName]', error)
      // Keep the input open so the user can retry or cancel.
    } finally {
      setSavingName(false)
    }
  }

  const handleNameSubmit = (event: FormEvent<HTMLElement>): void => {
    event.preventDefault()
    void saveName()
  }

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    cancelEditingName()
  }

  const handleNameBlur = (event: FocusEvent<HTMLElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    cancelEditingName()
  }

  const MainContainer = editingName ? 'form' : 'button'

  return (
    <article
      ref={itemRef}
      data-chat-id={chat.id}
      data-touch-actions={holdActions.open ? 'open' : undefined}
      data-touch-input={holdActions.touch ? 'true' : undefined}
      className={`chat-list-item${!committing && working ? ' chat-list-item--working' : ''}${pendingApproval ? ' chat-list-item--approval' : ''}${chat.pinned ? ' chat-list-item--pinned' : ''}${selected ? ' chat-list-item--selected' : ''}${showFinishedUnseen ? ' chat-list-item--unread' : ''}${userInputStatus ? ' chat-list-item--waiting-input' : ''}${draggable ? ' chat-list-item--reorderable' : ''}${dragging ? ' chat-list-item--dragging' : ''}${dropPosition ? ` chat-list-item--drop-${dropPosition}` : ''}`}
      draggable={!editingName && (!compact || (holdActions.open && touchDragArmed))}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver?.(event, chat)}
      onDragStart={(event) => {
        if (compact && !(holdActions.open && touchDragArmed)) {
          event.preventDefault()
          return
        }
        onDragStart?.(event, chat)
      }}
      onFocusCapture={(event) => {
        if (!editingName) prefetchChatOpening(chat)
        if (editingName) {
          setDetailFocused(false)
          return
        }
        setDetailFocused(
          event.target instanceof HTMLElement && event.target.matches(':focus-visible')
        )
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDetailFocused(false)
      }}
      onPointerDown={(event) => {
        setTouchDragArmed(event.pointerType !== 'touch' || holdActions.open)
        setDetailFocused(false)
        if (event.pointerType === 'touch') setDetailHovered(false)
        holdActions.onPointerDown(event)
      }}
      onPointerMove={holdActions.onPointerMove}
      onPointerUp={holdActions.onPointerUp}
      onPointerCancel={holdActions.onPointerCancel}
      onContextMenu={holdActions.onContextMenu}
      onKeyDown={holdActions.onKeyDown}
      onPointerEnter={(event) => {
        prefetchChatOpening(chat)
        if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches)
          setDetailHovered(true)
      }}
      onPointerLeave={() => setDetailHovered(false)}
    >
      {draggable && (
        <span className="chat-list-item__drag-handle" title="Drag to reorder">
          <GripVertical aria-hidden="true" />
        </span>
      )}
      <MainContainer
        className="chat-list-item__main"
        {...(editingName
          ? { onBlur: handleNameBlur, onSubmit: handleNameSubmit }
          : {
              type: 'button' as const,
              'aria-current': selected ? ('true' as const) : undefined,
              'aria-describedby': detailOpen ? detailCardId : undefined,
              onClick: () => {
                holdActions.close()
                onClick(chat)
              }
            })}
      >
        <span className="chat-list-item__header">
          {leadingStatus && (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={leadingStatus.title}
            >
              {leadingStatus.icon}
            </span>
          )}
          {editingName ? (
            <>
              <Input
                autoFocus
                aria-label="Chat name"
                maxLength={100}
                readOnly={savingName}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={handleNameKeyDown}
              />
              <Button
                theme="secondary"
                size="small"
                aria-label="Save chat name"
                title="Save"
                callback={saveName}
                disabled={savingName || !normalizedNameDraft}
                icon={<Save aria-hidden="true" />}
              />
              <Button
                theme="secondary"
                size="small"
                aria-label="Cancel editing chat name"
                title="Cancel"
                callback={cancelEditingName}
                disabled={savingName}
                icon={<X aria-hidden="true" />}
              />
            </>
          ) : (
            <span className="chat-list-item__title">{chatTitle}</span>
          )}
        </span>
      </MainContainer>
      {!editingName && (
        <span className="chat-list-item__actions">
          {pendingApproval && (
            <>
              <Button
                aria-label={`Reject approval for ${chatTitle}`}
                callback={() => onResolveApproval(chat, 'deny')}
                disabled={Boolean(approvalDecisionInFlight)}
                icon={<X aria-hidden="true" />}
                size="small"
                theme="secondary"
                title="Reject"
              />
              <Button
                aria-label={`Approve approval for ${chatTitle}`}
                callback={() => onResolveApproval(chat, 'allow')}
                disabled={Boolean(approvalDecisionInFlight)}
                icon={<Check aria-hidden="true" />}
                size="small"
                theme="primary"
                title={
                  pendingApproval.type === 'permissions'
                    ? `Allow for this turn\n${pendingApproval.permissionDetails?.join('\n') ?? ''}`
                    : 'Approve'
                }
              />
            </>
          )}
          <Button
            theme="transparent"
            size="small"
            aria-label="Edit chat name"
            title="Edit name"
            callback={beginEditingName}
            icon={<Pencil aria-hidden="true" />}
          />
          {!chat.done && canMarkDone && (
            <Button
              theme="transparent"
              size="small"
              aria-label="Mark chat done"
              title="Mark done"
              callback={() => onMarkDone(chat, true)}
              icon={<Check aria-hidden="true" />}
            />
          )}
          {chat.done && canMarkUndone && (
            <Button
              theme="transparent"
              size="small"
              aria-label="Mark chat not done"
              title="Mark not done"
              callback={() => onMarkDone(chat, false)}
              icon={<Undo2 aria-hidden="true" />}
            />
          )}
          <ActionMenu
            className="chat-list-item__menu"
            label="Chat menu"
            content={
              exporting ? (
                <Spinner className="app-loading-spinner" aria-hidden="true" />
              ) : (
                <Menu aria-hidden="true" />
              )
            }
            disabled={exporting}
            actions={() => [
              ...(sleepActionsEnabled
                ? [
                    {
                      id: 'sleep',
                      label: sleeping ? 'Wake up' : 'Sleep',
                      icon: sleeping ? <BedOff /> : <Bed />,
                      callback: () => (sleeping ? wakeChat(sleepKey) : sleepChat(sleepKey)),
                      panel: {
                        ariaLabel: 'Sleep for a set time',
                        content: (close) => (
                          <ChatSleepPanel
                            wakeAt={wakeAt}
                            onSleep={(durationMs) => {
                              close()
                              sleepChat(sleepKey, durationMs)
                            }}
                          />
                        )
                      }
                    }
                  ]
                : []),
              {
                id: 'pin',
                label: chat.pinned ? 'Unpin' : 'Pin',
                icon: chat.pinned ? <PinOff /> : <Pin />,
                callback: () => onTogglePinned(chat)
              },
              { id: 'export', label: 'Export', icon: <Download />, callback: exportChat },
              ...(onMarkRead
                ? [
                    {
                      id: 'read-state',
                      label: hasUnread ? 'Mark read' : 'Mark unread',
                      icon: hasUnread ? <Mail /> : <MailOpen />,
                      callback: () => onMarkRead(chat, hasUnread)
                    }
                  ]
                : [])
            ]}
          />
        </span>
      )}
      {exportResult && (
        <span className="chat-list-item__export-result" role="status" title={exportResult}>
          {exportResult}
          <button
            type="button"
            aria-label="Dismiss export result"
            onClick={() => setExportResult(null)}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      )}
      {detailOpen &&
        createPortal(
          <div
            ref={detailCardRef}
            className="chat-list-item__detail-card"
            id={detailCardId}
            role="tooltip"
            style={{
              left: toCssRem(detailCardPosition?.left ?? 0),
              top: toCssRem(detailCardPosition?.top ?? 0),
              visibility: detailCardPosition ? 'visible' : 'hidden'
            }}
          >
            <div className="chat-list-item__detail-header">
              <strong>{chatTitle}</strong>
              {updatedAt && (
                <time dateTime={updatedAt.dateTime} title={`Last activity: ${updatedAt.title}`}>
                  {shortUpdatedAge}
                </time>
              )}
            </div>
            {chat.done && (
              <div className="chat-list-item__detail-location">
                <span className="chat-list-item__detail-project-icon" aria-hidden="true">
                  {noProject ? <MessageSquare /> : (projectIcon ?? <FolderKanban />)}
                </span>
                <span className="chat-list-item__detail-project">{projectName}</span>
              </div>
            )}
            {!noProject && (
              <div className="chat-list-item__detail-location">
                <LocationIcon
                  aria-label={isGitWorktree ? 'Worktree' : 'Folder'}
                  className="chat-list-item__detail-location-icon"
                />
                <span className="chat-list-item__detail-branch">{branchName}</span>
              </div>
            )}
            {sleeping && (
              <div className="chat-list-item__detail-location">
                <Bed aria-hidden="true" className="chat-list-item__detail-location-icon" />
                <span>{typeof wakeAt === 'number' ? formatWakeIn(wakeAt) : 'Sleeping'}</span>
              </div>
            )}
            <span className="chat-list-item__detail-provider">
              <ProviderIcon
                providerId={chat.providerId}
                className="chat-list-item__detail-location-icon"
                aria-hidden="true"
              />
              {providerLabels[chat.providerId]}
            </span>
          </div>,
          document.body
        )}
    </article>
  )
})
