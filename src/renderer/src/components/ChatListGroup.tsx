import { CheckCheck, ChevronDown, ChevronUp, FolderKanban, PinOff, SquarePen } from 'lucide-react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { Button } from './Button'
import { ChatList } from './ChatList'
import { DisclosureToggle } from './DisclosureToggle'
import './ChatListGroup.css'

export type ChatListGroupData = {
  key: string
  cwd: string | null
  label: string
  chats: ProviderChat[]
  kind: 'pinned' | 'cwd' | 'done'
}

type ChatListGroupProps = {
  contentId: string
  group: ChatListGroupData
  open: boolean
  selectedChatKey: string | null
  committingChatKeys?: ReadonlySet<string>
  visibleChatCount?: number
  chatPageSize?: number
  projectIconSrc?: string | null
  onLoadMoreChats?: (group: ChatListGroupData) => void
  onShowLessChats?: (group: ChatListGroupData) => void
  onMarkChatDone: (chat: ProviderChat, done?: boolean) => void
  onMarkCwdChatsDone: (group: ChatListGroupData) => void
  onNewChatInCwd: (group: ChatListGroupData) => void
  onSelectProjectIcon?: (group: ChatListGroupData) => void
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
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
  visibleChatCount = group.chats.length,
  chatPageSize = 20,
  projectIconSrc = null,
  onLoadMoreChats,
  onShowLessChats,
  onMarkChatDone,
  onMarkCwdChatsDone,
  onNewChatInCwd,
  onSelectProjectIcon,
  onResolveApproval,
  onSelectChat,
  onToggle,
  onToggleChatPinned,
  onUnpinPinnedChats,
  resolvingApprovalId = null
}) => {
  const visibleChats = group.chats.slice(0, visibleChatCount)
  const remainingChatCount = Math.max(0, group.chats.length - visibleChats.length)
  const nextChatCount = Math.min(chatPageSize, remainingChatCount)
  const canShowLessChats = visibleChatCount > chatPageSize
  const showChatPaginationActions =
    (remainingChatCount > 0 && onLoadMoreChats) || (canShowLessChats && onShowLessChats)
  const toggle = (
    <DisclosureToggle
      className="chat-list-group__toggle"
      chevronClassName="chat-list-group__chevron"
      contentClassName={
        group.kind === 'cwd' ? 'chat-list-group__toggle-content--project' : undefined
      }
      aria-controls={contentId}
      open={open}
      title={group.cwd ?? group.label}
      onClick={() => onToggle(group.key)}
    >
      <span className="chat-list-group__title">{group.label}</span>
    </DisclosureToggle>
  )

  return (
    <section
      className={`chat-list-group chat-list-group--${group.kind}${open ? ' chat-list-group--open' : ''}`}
      aria-label={`${group.label} chats`}
    >
      <div className="chat-list-group__header">
        {group.kind === 'cwd' ? (
          <span className="chat-list-group__project-toggle">
            <button
              className="chat-list-group__project-icon-button"
              type="button"
              aria-label={`Project: ${group.label}`}
              title="Choose project image"
              onClick={() => onSelectProjectIcon?.(group)}
            >
              {projectIconSrc ? (
                <img className="chat-list-group__project-icon-image" src={projectIconSrc} alt="" />
              ) : (
                <FolderKanban aria-hidden="true" />
              )}
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
              aria-label={`New chat in ${group.label}`}
              title="New chat"
              callback={() => onNewChatInCwd(group)}
              icon={<SquarePen aria-hidden="true" />}
            />
            <Button
              theme="transparent"
              size="small"
              aria-label={`Mark all ${group.label} chats done`}
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
            ariaLabel={`${group.label} chats`}
            chats={visibleChats}
            selectedChatKey={selectedChatKey}
            committingChatKeys={committingChatKeys}
            canMarkDone={group.kind !== 'done'}
            canMarkUndone={group.kind === 'done'}
            showProjects={group.kind === 'pinned' || group.kind === 'done'}
            onMarkDone={onMarkChatDone}
            onResolveApproval={onResolveApproval}
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
                  aria-label={`Show fewer ${group.label} chats`}
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
                  aria-label={`Load next ${nextChatCount} ${group.label} chats`}
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
