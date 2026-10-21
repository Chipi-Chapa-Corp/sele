import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderKanban,
  PinOff,
  SquarePen
} from 'lucide-react'
import {
  memo,
  forwardRef,
  useDeferredValue,
  useMemo,
  type DragEvent,
  type DragEventHandler,
  type ReactNode
} from 'react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { appMaxChatsRenderedDefault } from '../performanceSettings'
import { formatProjectLabel } from '../projectPresentation'
import { Button } from './Button'
import { ChatList } from './ChatList'
import { MotionListItem } from '../motion/MotionListItem'
import { DisclosureToggle } from './DisclosureToggle'
import './ChatListGroup.css'

export type ChatListGroupData = {
  key: string
  cwd: string | null
  label: string
  projectName?: string | null
  chats: ProviderChat[]
  kind: 'pinned' | 'cwd' | 'active' | 'done' | 'imported'
}

export type ChatListGroupProps = {
  contentId: string
  group: ChatListGroupData
  open: boolean
  selectedChatKey: string | null
  workingSubagentChatKeys?: ReadonlySet<string>
  committingChatKeys?: ReadonlySet<string>
  latestCommitFinishedAtByChatKey?: ReadonlyMap<string, number>
  canReorderChats?: boolean
  projectDraggable?: boolean
  projectDragging?: boolean
  projectDropPosition?: 'before' | 'after' | null
  visibleChatCount?: number
  chatPageSize?: number
  deferItems?: boolean
  emptyContent?: ReactNode
  headerAction?: ReactNode
  projectIcon?: ReactNode
  projectNamesByCwd?: ReadonlyMap<string, string>
  projectIconsByCwd?: ReadonlyMap<string, ReactNode>
  onLoadMoreChats?: (group: ChatListGroupData) => void
  onShowLessChats?: (group: ChatListGroupData) => void
  onMarkChatDone: (chat: ProviderChat, done?: boolean) => void
  onProjectDragEnd?: DragEventHandler<HTMLElement>
  onProjectDragStart?: (event: DragEvent<HTMLElement>, group: ChatListGroupData) => void
  onMarkCwdChatsDone: (group: ChatListGroupData) => void
  onNewChatInCwd: (group: ChatListGroupData) => void
  onRenameChat: (chat: ProviderChat, title: string) => Promise<void>
  onSelectProjectIcon?: (group: ChatListGroupData) => void
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onReorderChats: (group: ChatListGroupData, chats: ProviderChat[]) => void
  onSelectChat: (chat: ProviderChat) => void
  onToggle: (groupKey: string) => void
  onToggleChatPinned: (chat: ProviderChat) => void
  onUnpinPinnedChats: (group: ChatListGroupData) => void
  resolvingApprovalId?: string | null
  selectedChatChildren?: ReactNode
  selectedChatChildOpen?: boolean
}

// Only changes visible in this group should rebuild its list/presence tree.
// Callback props are compared too; callers keep their dispatch stable and current.
export const areChatListGroupPropsEqual = (
  previous: ChatListGroupProps,
  next: ChatListGroupProps
): boolean => {
  const collections = new Set([
    'group',
    'workingSubagentChatKeys',
    'committingChatKeys',
    'latestCommitFinishedAtByChatKey',
    'projectNamesByCwd',
    'projectIconsByCwd'
  ])
  for (const key of Object.keys({ ...previous, ...next }) as (keyof ChatListGroupProps)[]) {
    if (!collections.has(key) && previous[key] !== next[key]) return false
  }
  const before = previous.group
  const after = next.group
  if (
    before !== after &&
    (before.key !== after.key ||
      before.cwd !== after.cwd ||
      before.label !== after.label ||
      before.kind !== after.kind ||
      before.projectName !== after.projectName ||
      before.chats.length !== after.chats.length ||
      (before.chats !== after.chats &&
        before.chats.some((chat, index) => chat !== after.chats[index])))
  )
    return false
  for (const chat of after.chats) {
    const key = `${chat.providerId}:${chat.id}`
    const cwd = chat.projectCwd ?? chat.cwd ?? ''
    if (
      (previous.workingSubagentChatKeys !== next.workingSubagentChatKeys &&
        Boolean(previous.workingSubagentChatKeys?.has(key)) !==
          Boolean(next.workingSubagentChatKeys?.has(key))) ||
      (previous.committingChatKeys !== next.committingChatKeys &&
        Boolean(previous.committingChatKeys?.has(key)) !==
          Boolean(next.committingChatKeys?.has(key))) ||
      (previous.latestCommitFinishedAtByChatKey !== next.latestCommitFinishedAtByChatKey &&
        previous.latestCommitFinishedAtByChatKey?.get(key) !==
          next.latestCommitFinishedAtByChatKey?.get(key)) ||
      (previous.projectNamesByCwd !== next.projectNamesByCwd &&
        previous.projectNamesByCwd?.get(cwd) !== next.projectNamesByCwd?.get(cwd)) ||
      (previous.projectIconsByCwd !== next.projectIconsByCwd &&
        previous.projectIconsByCwd?.get(cwd) !== next.projectIconsByCwd?.get(cwd))
    )
      return false
  }
  return true
}

export const ChatListGroup = memo(function ChatListGroup({
  contentId,
  group,
  open,
  selectedChatKey,
  workingSubagentChatKeys,
  committingChatKeys,
  latestCommitFinishedAtByChatKey,
  canReorderChats = true,
  projectDraggable = false,
  projectDragging = false,
  projectDropPosition = null,
  visibleChatCount = group.chats.length,
  chatPageSize = appMaxChatsRenderedDefault,
  deferItems = false,
  emptyContent = null,
  headerAction = null,
  projectIcon = null,
  projectNamesByCwd,
  projectIconsByCwd,
  onLoadMoreChats,
  onShowLessChats,
  onMarkChatDone,
  onProjectDragEnd,
  onProjectDragStart,
  onMarkCwdChatsDone,
  onNewChatInCwd,
  onRenameChat,
  onSelectProjectIcon,
  onResolveApproval,
  onReorderChats,
  onSelectChat,
  onToggle,
  onToggleChatPinned,
  onUnpinPinnedChats,
  resolvingApprovalId = null,
  selectedChatChildren = null,
  selectedChatChildOpen = false
}: ChatListGroupProps) {
  const projectLike = group.kind === 'cwd' || group.kind === 'imported'
  const groupLabel =
    group.kind === 'cwd'
      ? group.projectName?.trim() || formatProjectLabel(group.label)
      : group.label
  const visibleChats = useMemo(
    () => group.chats.slice(0, visibleChatCount),
    [group.chats, visibleChatCount]
  )
  const deferredOpen = useDeferredValue(open)
  const renderItems = !deferItems || deferredOpen
  const remainingChatCount = Math.max(0, group.chats.length - visibleChats.length)
  const nextChatCount = Math.min(chatPageSize, remainingChatCount)
  const canShowLessChats = visibleChatCount > chatPageSize
  const showChatPaginationActions =
    (remainingChatCount > 0 && onLoadMoreChats) || (canShowLessChats && onShowLessChats)
  const toggleContent = (
    <>
      <ChevronRight
        className="ui-disclosure-toggle__chevron chat-list-group__chevron"
        aria-hidden="true"
      />
      <span
        className={`ui-disclosure-toggle__content${projectLike ? ' chat-list-group__toggle-content--project' : ''}`}
      >
        <span className="chat-list-group__title">{groupLabel}</span>
      </span>
    </>
  )
  const toggle = projectLike ? (
    <div
      className={`ui-disclosure-toggle chat-list-group__toggle${open ? ' ui-disclosure-toggle--open' : ''}`}
      role="button"
      tabIndex={0}
      aria-controls={contentId}
      aria-expanded={open}
      draggable={projectDraggable}
      title={group.cwd ?? groupLabel}
      onClick={() => onToggle(group.key)}
      onDragEnd={onProjectDragEnd}
      onDragStart={(event) => onProjectDragStart?.(event, group)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onToggle(group.key)
      }}
    >
      {toggleContent}
    </div>
  ) : (
    <DisclosureToggle
      className="chat-list-group__toggle"
      chevronClassName="chat-list-group__chevron"
      aria-controls={contentId}
      open={open}
      title={group.cwd ?? groupLabel}
      onClick={() => onToggle(group.key)}
    >
      <span className="chat-list-group__title">{groupLabel}</span>
    </DisclosureToggle>
  )

  return (
    <section
      className={`chat-list-group chat-list-group--${group.kind}${open ? ' chat-list-group--open' : ''}${projectDraggable ? ' chat-list-group--project-reorderable' : ''}${projectDragging ? ' chat-list-group--project-dragging' : ''}${projectDropPosition ? ` chat-list-group--project-drop-${projectDropPosition}` : ''}`}
      data-project-group-key={projectDraggable ? group.key : undefined}
      aria-label={`${groupLabel} chats`}
    >
      <div className="chat-list-group__header">
        {projectLike ? (
          <span className="chat-list-group__project-toggle">
            <button
              className="chat-list-group__project-icon-button"
              type="button"
              aria-label={`Project: ${groupLabel}`}
              title={group.kind === 'imported' ? 'Imported chats' : 'Choose project image'}
              disabled={group.kind === 'imported'}
              onClick={() => onSelectProjectIcon?.(group)}
            >
              {projectIcon ?? <FolderKanban aria-hidden="true" />}
            </button>
            {toggle}
          </span>
        ) : (
          toggle
        )}
        {group.kind === 'cwd' && (
          <span className="chat-list-group__action">
            <Button
              theme="transparent"
              size="small"
              aria-label={`New chat in ${groupLabel}`}
              title="New chat"
              callback={() => onNewChatInCwd(group)}
              icon={<SquarePen aria-hidden="true" />}
            />
            <Button
              theme="transparent"
              size="small"
              aria-label={`Mark all ${groupLabel} chats done`}
              title="Mark project chats done"
              callback={() => onMarkCwdChatsDone(group)}
              icon={<CheckCheck aria-hidden="true" />}
            />
          </span>
        )}
        {group.kind === 'pinned' && (
          <span className="chat-list-group__action">
            <Button
              theme="transparent"
              size="small"
              aria-label="Unpin all pinned chats"
              title="Unpin all"
              callback={() => onUnpinPinnedChats(group)}
              icon={<PinOff aria-hidden="true" />}
            />
          </span>
        )}
        {headerAction}
      </div>
      {open && (
        <blockquote
          className="chat-list-group__items"
          id={contentId}
          aria-busy={!renderItems || undefined}
        >
          {renderItems && (
            <>
              {visibleChats.length === 0 && emptyContent ? (
                emptyContent
              ) : (
                <ChatList
                  ariaLabel={`${groupLabel} chats`}
                  chats={visibleChats}
                  selectedChatKey={selectedChatKey}
                  workingSubagentChatKeys={workingSubagentChatKeys}
                  committingChatKeys={committingChatKeys}
                  latestCommitFinishedAtByChatKey={latestCommitFinishedAtByChatKey}
                  canMarkDone={group.kind !== 'done'}
                  canMarkUndone={group.kind === 'done' || group.kind === 'imported'}
                  reorderable={canReorderChats}
                  projectNamesByCwd={projectNamesByCwd}
                  projectIconsByCwd={projectIconsByCwd}
                  onMarkDone={onMarkChatDone}
                  onRename={onRenameChat}
                  onResolveApproval={onResolveApproval}
                  onReorder={(nextVisibleChats) =>
                    onReorderChats(group, [
                      ...nextVisibleChats,
                      ...group.chats.slice(nextVisibleChats.length)
                    ])
                  }
                  onSelect={onSelectChat}
                  onTogglePinned={onToggleChatPinned}
                  resolvingApprovalId={resolvingApprovalId}
                  selectedChatChildren={selectedChatChildren}
                  selectedChatChildOpen={selectedChatChildOpen}
                />
              )}
              {showChatPaginationActions && (
                <div className="chat-list-group__more">
                  {canShowLessChats && onShowLessChats && (
                    <Button
                      theme="secondary"
                      size="small"
                      fill
                      aria-label={`Show fewer ${groupLabel} chats`}
                      title="Show less"
                      callback={() => onShowLessChats(group)}
                      icon={<ChevronUp aria-hidden="true" />}
                      label="Show less"
                    />
                  )}
                  {remainingChatCount > 0 && onLoadMoreChats && (
                    <Button
                      theme="secondary"
                      size="small"
                      fill
                      aria-label={`Load next ${nextChatCount} ${groupLabel} chats`}
                      title={`Load next ${nextChatCount} chats`}
                      callback={() => onLoadMoreChats(group)}
                      icon={<ChevronDown aria-hidden="true" />}
                      label={`Load next ${nextChatCount}`}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </blockquote>
      )}
    </section>
  )
}, areChatListGroupPropsEqual)

// Keep the group animation boundary memoized too. Otherwise every workspace update
// schedules Motion's projection tree even when the group's children can bail out.
export const AnimatedChatListGroup = memo(
  forwardRef<HTMLDivElement, ChatListGroupProps & { layoutOrder?: string }>(
    function AnimatedChatListGroup({ layoutOrder, ...props }, ref) {
      return (
        <MotionListItem ref={ref} order={layoutOrder ?? props.group.key} popLayout>
          <ChatListGroup {...props} />
        </MotionListItem>
      )
    }
  ),
  areChatListGroupPropsEqual
)
