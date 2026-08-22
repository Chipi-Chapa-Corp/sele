import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderKanban,
  PinOff,
  SquarePen
} from 'lucide-react'
import type { DragEvent, DragEventHandler, ReactNode } from 'react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { appMaxChatsRenderedDefault } from '../performanceSettings'
import { formatProjectLabel } from '../projectPresentation'
import { Button } from './Button'
import { ChatList } from './ChatList'
import { DisclosureToggle } from './DisclosureToggle'
import './ChatListGroup.css'

export type ChatListGroupData = {
  key: string
  cwd: string | null
  label: string
  projectName?: string | null
  chats: ProviderChat[]
  kind: 'pinned' | 'cwd' | 'active' | 'done'
}

type ChatListGroupProps = {
  contentId: string
  group: ChatListGroupData
  open: boolean
  selectedChatKey: string | null
  committingChatKeys?: ReadonlySet<string>
  canReorderChats?: boolean
  projectDraggable?: boolean
  projectDragging?: boolean
  projectDropPosition?: 'before' | 'after' | null
  visibleChatCount?: number
  chatPageSize?: number
  projectIcon?: ReactNode
  projectNamesByCwd?: ReadonlyMap<string, string>
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
}

export const ChatListGroup: React.FC<ChatListGroupProps> = ({
  contentId,
  group,
  open,
  selectedChatKey,
  committingChatKeys,
  canReorderChats = true,
  projectDraggable = false,
  projectDragging = false,
  projectDropPosition = null,
  visibleChatCount = group.chats.length,
  chatPageSize = appMaxChatsRenderedDefault,
  projectIcon = null,
  projectNamesByCwd,
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
  resolvingApprovalId = null
}) => {
  const groupLabel =
    group.kind === 'cwd'
      ? group.projectName?.trim() || formatProjectLabel(group.label)
      : group.label
  const visibleChats = group.chats.slice(0, visibleChatCount)
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
        className={`ui-disclosure-toggle__content${group.kind === 'cwd' ? ' chat-list-group__toggle-content--project' : ''}`}
      >
        <span className="chat-list-group__title">{groupLabel}</span>
      </span>
    </>
  )
  const toggle =
    group.kind === 'cwd' ? (
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
        {group.kind === 'cwd' ? (
          <span className="chat-list-group__project-toggle">
            <button
              className="chat-list-group__project-icon-button"
              type="button"
              aria-label={`Project: ${groupLabel}`}
              title="Choose project image"
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
      </div>
      {open && (
        <blockquote className="chat-list-group__items" id={contentId}>
          <ChatList
            ariaLabel={`${groupLabel} chats`}
            chats={visibleChats}
            selectedChatKey={selectedChatKey}
            committingChatKeys={committingChatKeys}
            canMarkDone={group.kind !== 'done'}
            canMarkUndone={group.kind === 'done'}
            reorderable={canReorderChats}
            projectNamesByCwd={projectNamesByCwd}
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
          />
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
        </blockquote>
      )}
    </section>
  )
}
