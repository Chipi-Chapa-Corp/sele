import {
  Check,
  Folder,
  GitCommitHorizontal,
  GitFork,
  GripVertical,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  Save,
  ShieldQuestionMark,
  Undo2,
  X
} from 'lucide-react'
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { toCssRem } from '../cssUnits'
import { getDefaultProjectName } from '../projectPresentation'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import { Input } from './Input'
import './ChatListItem.css'

type ChatListItemProps = {
  chat: ProviderChat
  projectDisplayName?: string | null
  selected: boolean
  committing?: boolean
  canMarkDone?: boolean
  canMarkUndone?: boolean
  draggable?: boolean
  dragging?: boolean
  dropPosition?: 'before' | 'after' | null
  onClick: () => void
  onDragEnd?: React.DragEventHandler<HTMLElement>
  onDragOver?: React.DragEventHandler<HTMLElement>
  onDragStart?: React.DragEventHandler<HTMLElement>
  onMarkDone: (done?: boolean) => void
  onRename: (title: string) => Promise<void>
  onResolveApproval: (decision: ProviderApprovalDecision) => void
  onTogglePinned: () => void
  approvalDecisionInFlight?: ProviderApprovalDecision | null
}

const statusLabels = {
  active: 'In progress',
  error: 'Error',
  waitingOnApproval: 'Waiting for approval',
  waitingOnUserInput: 'Waiting for your input'
} as const
const finishedUnseenLabel = 'Finished since last viewed'

const providerLabels = {
  codex: 'Codex',
  claude: 'Claude',
  copilot: 'Copilot',
  opencode: 'OpenCode'
} as const

const workingStatuses = new Set<NonNullable<ProviderChat['status']>>(['active'])
const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const weekMs = 7 * dayMs
const monthMs = 30 * dayMs
const yearMs = 365 * dayMs

const getChatProjectName = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
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

export const ChatListItem: React.FC<ChatListItemProps> = ({
  chat,
  projectDisplayName,
  selected,
  committing = false,
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
}) => {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(chat.title)
  const [savingName, setSavingName] = useState(false)
  const [detailHovered, setDetailHovered] = useState(false)
  const [detailFocused, setDetailFocused] = useState(false)
  const [detailCardPosition, setDetailCardPosition] = useState<DetailCardPosition | null>(null)
  const itemRef = useRef<HTMLElement>(null)
  const detailCardRef = useRef<HTMLDivElement>(null)
  const detailCardId = useId()
  const now = useSemanticDateNow()
  const updatedAt = formatSemanticLexicalDateDifference(chat.updatedAt, { now })
  const isGitWorktree = chat.cwdKind === 'gitWorktree'
  const branchName = isGitWorktree
    ? (chat.worktreeBaseBranchName ?? 'Unknown branch')
    : (chat.branchName ?? 'Unknown branch')
  const projectName = projectDisplayName?.trim() || getChatProjectName(chat.projectCwd ?? chat.cwd)
  const LocationIcon = isGitWorktree ? GitFork : Folder
  const workingStatus = chat.status && workingStatuses.has(chat.status) ? chat.status : null
  const approvalStatus = chat.status === 'waitingOnApproval' ? chat.status : null
  const userInputStatus = chat.status === 'waitingOnUserInput' ? chat.status : null
  const errorStatus = chat.status === 'error' ? chat.status : null
  const pendingApproval = chat.pendingApproval
  const unread = !selected && !chat.done && chat.updatedAt > (chat.seenUpdatedAt ?? chat.updatedAt)
  const finishedUnseen = unread && chat.status === null
  const showFinishedUnseen = !committing && !workingStatus && !approvalStatus && finishedUnseen
  const normalizedNameDraft = nameDraft.trim()
  const detailOpen = (detailHovered || detailFocused) && !editingName && !dragging
  const shortUpdatedAge = formatShortAge(chat.updatedAt, now)

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
    setNameDraft(chat.title)
    setDetailHovered(false)
    setDetailFocused(false)
    setEditingName(true)
  }

  const cancelEditingName = (): void => {
    setNameDraft(chat.title)
    setDetailFocused(false)
    setEditingName(false)
  }

  const saveName = async (): Promise<void> => {
    if (savingName || !normalizedNameDraft) return
    if (normalizedNameDraft === chat.title.trim()) {
      setDetailFocused(false)
      setEditingName(false)
      return
    }

    setSavingName(true)
    try {
      await onRename(normalizedNameDraft)
      setDetailFocused(false)
      setEditingName(false)
    } catch {
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
      className={`chat-list-item${pendingApproval ? ' chat-list-item--approval' : ''}${chat.pinned ? ' chat-list-item--pinned' : ''}${selected ? ' chat-list-item--selected' : ''}${showFinishedUnseen ? ' chat-list-item--unread' : ''}${userInputStatus ? ' chat-list-item--waiting-input' : ''}${draggable ? ' chat-list-item--reorderable' : ''}${dragging ? ' chat-list-item--dragging' : ''}${dropPosition ? ` chat-list-item--drop-${dropPosition}` : ''}`}
      draggable={editingName ? false : draggable}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onFocusCapture={(event) => {
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
      onPointerDown={() => setDetailFocused(false)}
      onPointerEnter={() => setDetailHovered(true)}
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
              onClick
            })}
      >
        <span className="chat-list-item__header">
          {committing ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title="Committing changes"
            >
              <GitCommitHorizontal
                className="chat-list-item__committing"
                aria-label="Committing changes"
              />
            </span>
          ) : workingStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[workingStatus]}
            >
              <LoaderCircle
                className="app-loading-spinner chat-list-item__loading"
                aria-label={statusLabels[workingStatus]}
              />
            </span>
          ) : approvalStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[approvalStatus]}
            >
              <ShieldQuestionMark
                className="chat-list-item__approval-icon"
                aria-label={statusLabels[approvalStatus]}
              />
            </span>
          ) : userInputStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[userInputStatus]}
            >
              <span
                className="chat-list-item__status chat-list-item__status--waitingOnUserInput"
                role="img"
                aria-label={statusLabels[userInputStatus]}
              />
            </span>
          ) : errorStatus ? (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[errorStatus]}
            >
              <span
                className="chat-list-item__status chat-list-item__status--error"
                role="img"
                aria-label={statusLabels[errorStatus]}
              />
            </span>
          ) : (
            showFinishedUnseen && (
              <span
                className="chat-list-item__status-container chat-list-item__status-container--leading"
                title={finishedUnseenLabel}
              >
                <span
                  className="chat-list-item__status chat-list-item__status--finished-unseen"
                  role="img"
                  aria-label={finishedUnseenLabel}
                />
              </span>
            )
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
            <span className="chat-list-item__title">{chat.title}</span>
          )}
        </span>
      </MainContainer>
      {!editingName && (
        <span className="chat-list-item__actions">
          {pendingApproval && (
            <>
              <Button
                aria-label={`Reject approval for ${chat.title}`}
                callback={() => onResolveApproval('deny')}
                disabled={Boolean(approvalDecisionInFlight)}
                icon={<X aria-hidden="true" />}
                size="small"
                theme="secondary"
                title="Reject"
              />
              <Button
                aria-label={`Approve approval for ${chat.title}`}
                callback={() => onResolveApproval('allow')}
                disabled={Boolean(approvalDecisionInFlight)}
                icon={<Check aria-hidden="true" />}
                size="small"
                theme="primary"
                title="Approve"
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
              callback={() => onMarkDone(true)}
              icon={<Check aria-hidden="true" />}
            />
          )}
          {chat.done && canMarkUndone && (
            <Button
              theme="transparent"
              size="small"
              aria-label="Mark chat not done"
              title="Mark not done"
              callback={() => onMarkDone(false)}
              icon={<Undo2 aria-hidden="true" />}
            />
          )}
          <Button
            theme={chat.pinned ? 'secondary' : 'transparent'}
            size="small"
            aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
            title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
            callback={onTogglePinned}
            icon={chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          />
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
              <strong>{chat.title}</strong>
              {updatedAt && (
                <time dateTime={updatedAt.dateTime} title={`Last activity: ${updatedAt.title}`}>
                  {shortUpdatedAge}
                </time>
              )}
            </div>
            <div className="chat-list-item__detail-location">
              <span className="chat-list-item__detail-project">{projectName}</span>
              <LocationIcon
                aria-label={isGitWorktree ? 'Worktree' : 'Folder'}
                className="chat-list-item__detail-location-icon"
              />
              <span className="chat-list-item__detail-branch">{branchName}</span>
            </div>
            <span className="chat-list-item__detail-provider">
              {providerLabels[chat.providerId]}
            </span>
          </div>,
          document.body
        )}
    </article>
  )
}
